/**
 * Model-drop intake — the flow signal the paper was missing. Git Times' funnel is
 * GitHub-trending (a STOCK/popularity signal); a new model landing on Hugging Face
 * is the single highest-signal AI *event* of a given day and never showed up. This
 * pulls recent, high-traction model releases from the public HF API (no key) so the
 * front page can report what actually shipped this week.
 *
 * Strategy: HF's `sort=likes7d` returns what's hot right now; we then keep only
 * models genuinely CREATED inside a recent window (so an old model re-trending is
 * not reported as a "drop"), plus fresh releases from trusted labs before their
 * likes have accumulated.
 */

const { ageDays } = require("./recency");

// Labs whose releases are news the moment they land, before likes accumulate.
const TRUSTED_ORGS = new Set([
  "meta-llama", "mistralai", "Qwen", "deepseek-ai", "google", "microsoft",
  "nvidia", "allenai", "HuggingFaceTB", "ai21labs", "CohereForAI", "stabilityai",
  "black-forest-labs", "moonshotai", "zai-org", "openai", "xai-org", "apple",
  "ibm-granite", "tencent", "bytedance-research", "internlm", "01-ai", "THUDM",
  "microsoft", "kyutai", "nari-labs", "unsloth",
]);

// Community repackages/quantizations — a re-host of someone else's drop, not the
// primary event. Kept out of the band unless the author is itself a trusted lab.
const QUANT_RE = /[-_.](gguf|gptq|awq|exl2|exl3|mlx|bnb|4bit|8bit|int4|int8|fp8|onnx|mlc)$/i;

// HF tags that mark a model as DERIVED from someone else's release (a finetune,
// merge, adapter, or quant) rather than a primary "drop". `base_model:<kind>:<id>`
// is HF's canonical lineage tag; `merge`/`mergekit` are the bare merge markers.
const DERIVATIVE_TAG_RE = /^base_model:(finetune|merge|adapter|quantized):/i;
const DERIVATIVE_BARE = new Set(["merge", "mergekit"]);
// Roleplay / uncensored community models — never front-page news for a builder
// paper, and the single biggest source of "ridiculous drop" noise (e.g. the
// `-Claude-Mythos` uncensored Qwen finetunes that out-like real releases).
const ROLEPLAY_TAGS = new Set(["not-for-all-audiences", "uncensored", "roleplay", "nsfw"]);

const isDerivative = (tags) =>
  tags.some((t) => DERIVATIVE_TAG_RE.test(t) || DERIVATIVE_BARE.has(t.toLowerCase()));
const isRoleplay = (tags) => tags.some((t) => ROLEPLAY_TAGS.has(t.toLowerCase()));

/**
 * Rank + filter raw HF model records into clean drop objects. Pure (no I/O) so
 * it's unit-testable. Keeps genuinely-recent releases with real traction (or from
 * a trusted lab), dedupes by id, ranks biggest-first, caps at `limit`.
 * @param {Array} models - raw HF /api/models records (need id, likes, downloads, createdAt, pipeline_tag)
 * @param {object} [opts] - { limit, windowDays, minLikes, nowMs }
 * @returns {Array<{id,author,name,task,likes,downloads,createdAt,ageDays,url}>}
 */
function selectModelDrops(models, opts = {}) {
  const {
    limit = 6,
    windowDays = 14,
    minLikes = 80,
    nowMs = Date.now(),
    gravity = 1.3,
    trustedBoost = 3,
  } = opts;
  if (!Array.isArray(models)) return [];
  const seen = new Set();
  // Freshness-decayed traction: what's NEW and getting picked up, not whatever
  // accreted the most likes across the whole window. Without this, the highest-
  // like model sits pinned at #1 for days and the band reads as "never updates".
  // Trusted labs get a boost so a genuine release leads even before likes land.
  const dropScore = (x) =>
    ((x.likes + 1) / Math.pow(Math.max(0, x.age) + 2, gravity)) * (x.trusted ? trustedBoost : 1);
  return models
    .filter((m) => m && typeof m.id === "string" && m.id.includes("/"))
    .map((m) => {
      const author = m.id.split("/")[0];
      const tags = Array.isArray(m.tags) ? m.tags.map(String) : [];
      return {
        m,
        author,
        name: m.id.slice(author.length + 1) || m.id,
        likes: m.likes || 0,
        downloads: m.downloads || 0,
        age: ageDays(m.createdAt, nowMs),
        trusted: TRUSTED_ORGS.has(author),
        quant: QUANT_RE.test(m.id),
        derivative: isDerivative(tags),
        roleplay: isRoleplay(tags),
      };
    })
    // A "drop" must be genuinely recent — created inside the window, not just hot.
    .filter((x) => x.age <= windowDays)
    // Roleplay / uncensored community models are never a builder-paper drop.
    .filter((x) => !x.roleplay)
    // A trusted lab is news immediately. Everyone else must be a PRIMARY release
    // (not a finetune/merge/adapter/quant re-host) WITH real community traction.
    .filter((x) => x.trusted || (!x.derivative && !x.quant && x.likes >= minLikes))
    .filter((x) => {
      if (seen.has(x.m.id)) return false;
      seen.add(x.m.id);
      return true;
    })
    // Freshest, most-picked-up first; downloads break ties.
    .sort((a, b) => dropScore(b) - dropScore(a) || b.downloads - a.downloads)
    .slice(0, limit)
    .map((x) => ({
      id: x.m.id,
      author: x.author,
      name: x.name,
      task: x.m.pipeline_tag || null,
      likes: x.likes,
      downloads: x.downloads,
      createdAt: x.m.createdAt || null,
      ageDays: Number.isFinite(x.age) ? Math.floor(x.age) : null,
      url: `https://huggingface.co/${x.m.id}`,
    }));
}

/**
 * Fetch recent high-signal model drops from Hugging Face. Returns [] on any
 * failure — the drops band is a bonus block, never a reason to fail the edition.
 * @param {object} [options] - { limit, windowDays, minLikes, fetchImpl, nowMs, timeoutMs }
 * @returns {Promise<Array>}
 */
async function fetchModelDrops(options = {}) {
  const {
    limit = 6,
    windowDays = 14,
    minLikes = 80,
    fetchImpl = globalThis.fetch,
    nowMs = Date.now(),
    timeoutMs = 10_000,
  } = options;

  if (typeof fetchImpl !== "function") {
    console.warn("Model Drops: no fetch available, skipping");
    return [];
  }

  // Three lanes, merged: `likes7d` = what got traction this week; `createdAt` =
  // what JUST dropped (catches a fresh lab release before its likes accumulate —
  // selectModelDrops keeps only trusted-org rows from this noisy newest-first
  // list); one `author=<org>` query per trusted lab, because the global newest-100
  // list turns over in minutes on HF — a trusted drop from even a few hours before
  // publish can miss BOTH global lanes and never be considered. The per-org lane
  // guarantees every trusted lab's latest repos enter the pool on day one.
  // full=true carries createdAt/likes/downloads.
  const base = "https://huggingface.co/api/models";
  const urls = [
    `${base}?sort=likes7d&direction=-1&limit=80&full=true&config=false`,
    `${base}?sort=createdAt&direction=-1&limit=100&full=true&config=false`,
    ...[...TRUSTED_ORGS].map(
      (org) =>
        `${base}?author=${encodeURIComponent(org)}&sort=createdAt&direction=-1&limit=4&full=true&config=false`
    ),
  ];

  const AbortCtor = globalThis.AbortController;
  const get = async (url) => {
    const controller = typeof AbortCtor === "function" ? new AbortCtor() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, controller ? { signal: controller.signal } : {});
      if (!res || !res.ok) {
        console.warn(`Model Drops: HF fetch returned ${res ? res.status : "no response"}`);
        return [];
      }
      return (await res.json()) || [];
    } catch (err) {
      console.warn(`Model Drops: fetch failed (non-fatal): ${err.message}`);
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const pages = await Promise.all(urls.map(get));
  const drops = selectModelDrops(pages.flat(), { limit, windowDays, minLikes, nowMs });
  console.log(`Model Drops: ${drops.length} recent model release(s) from Hugging Face`);
  return drops;
}

module.exports = { fetchModelDrops, selectModelDrops, TRUSTED_ORGS };
