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

/**
 * Rank + filter raw HF model records into clean drop objects. Pure (no I/O) so
 * it's unit-testable. Keeps genuinely-recent releases with real traction (or from
 * a trusted lab), dedupes by id, ranks biggest-first, caps at `limit`.
 * @param {Array} models - raw HF /api/models records (need id, likes, downloads, createdAt, pipeline_tag)
 * @param {object} [opts] - { limit, windowDays, minLikes, nowMs }
 * @returns {Array<{id,author,name,task,likes,downloads,createdAt,ageDays,url}>}
 */
function selectModelDrops(models, opts = {}) {
  const { limit = 6, windowDays = 14, minLikes = 80, nowMs = Date.now() } = opts;
  if (!Array.isArray(models)) return [];
  const seen = new Set();
  return models
    .filter((m) => m && typeof m.id === "string" && m.id.includes("/"))
    .map((m) => {
      const author = m.id.split("/")[0];
      return {
        m,
        author,
        name: m.id.slice(author.length + 1) || m.id,
        likes: m.likes || 0,
        downloads: m.downloads || 0,
        age: ageDays(m.createdAt, nowMs),
        trusted: TRUSTED_ORGS.has(author),
        quant: QUANT_RE.test(m.id),
      };
    })
    // A "drop" must be genuinely recent — created inside the window, not just hot.
    .filter((x) => x.age <= windowDays)
    // Signal: a trusted lab (news immediately) OR real community traction. A bare
    // quantization re-host never qualifies on its own.
    .filter((x) => (x.trusted || x.likes >= minLikes) && (!x.quant || x.trusted))
    .filter((x) => {
      if (seen.has(x.m.id)) return false;
      seen.add(x.m.id);
      return true;
    })
    // Biggest drop first; downloads break ties. Age is shown, not ranked on, so a
    // 3k-like release still leads a 5-like one from the same day.
    .sort((a, b) => b.likes - a.likes || b.downloads - a.downloads)
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

  // Two lanes, merged: `likes7d` = what got traction this week; `createdAt` =
  // what JUST dropped (catches a fresh lab release before its likes accumulate —
  // selectModelDrops keeps only trusted-org rows from this noisy newest-first
  // list). full=true carries createdAt/likes/downloads.
  const base = "https://huggingface.co/api/models";
  const urls = [
    `${base}?sort=likes7d&direction=-1&limit=80&full=true&config=false`,
    `${base}?sort=createdAt&direction=-1&limit=100&full=true&config=false`,
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

  const [hot, fresh] = await Promise.all(urls.map(get));
  const drops = selectModelDrops([...hot, ...fresh], { limit, windowDays, minLikes, nowMs });
  console.log(`Model Drops: ${drops.length} recent model release(s) from Hugging Face`);
  return drops;
}

module.exports = { fetchModelDrops, selectModelDrops, TRUSTED_ORGS };
