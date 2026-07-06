/**
 * GitHub Releases intake — the second flow source (Model Drops is the first).
 * Git Times' funnel is GitHub-trending, a STOCK/popularity signal: a release
 * only surfaced if its repo happened to be trending that week. But a new vllm
 * or llama.cpp release is an *event* worth the wire regardless of the repo's
 * star velocity. This watches a curated set of AI/dev-infra repos and reports
 * their significant recent releases on the front page.
 *
 * Strategy: one bounded API call per watched repo (never a global release
 * firehose — no clean API lane exists for that and it's rate-limit suicide),
 * then a pure noise gate: drafts/prereleases out, patch-bump spam out unless
 * it earned real reactions, ranked by freshness-decayed traction — never raw
 * stars.
 */

const { ageDays } = require("./recency");

// Hard ceiling on per-run API calls — the watchlist IS the request budget.
const MAX_WATCHED = 60;

// Repos whose releases are wire-worthy the moment they land, even when the
// repo isn't in today's trending set. Curated and grouped for easy editing;
// each entry costs one API call per run, so keep the list under MAX_WATCHED.
const WATCHED_REPOS = [
  // Inference & serving
  "vllm-project/vllm",
  "ggml-org/llama.cpp",
  "sgl-project/sglang",
  "ollama/ollama",
  "huggingface/text-generation-inference",
  "NVIDIA/TensorRT-LLM",
  // Core frameworks & training
  "pytorch/pytorch",
  "jax-ml/jax",
  "huggingface/transformers",
  "huggingface/diffusers",
  "huggingface/peft",
  "huggingface/trl",
  "Lightning-AI/pytorch-lightning",
  "axolotl-ai-cloud/axolotl",
  "unslothai/unsloth",
  "hiyouga/LLaMA-Factory",
  // Kernels & runtimes
  "triton-lang/triton",
  "Dao-AILab/flash-attention",
  "microsoft/onnxruntime",
  "ml-explore/mlx",
  // Agents & coding assistants
  "langchain-ai/langchain",
  "langchain-ai/langgraph",
  "run-llama/llama_index",
  "crewAIInc/crewAI",
  "microsoft/autogen",
  "pydantic/pydantic-ai",
  "browser-use/browser-use",
  "All-Hands-AI/OpenHands",
  "Aider-AI/aider",
  "cline/cline",
  "openai/codex",
  "anthropics/claude-code",
  "google-gemini/gemini-cli",
  // Creative & local UIs
  "comfyanonymous/ComfyUI",
  "open-webui/open-webui",
  // RAG, vector stores & observability
  "qdrant/qdrant",
  "chroma-core/chroma",
  "milvus-io/milvus",
  "weaviate/weaviate",
  "pgvector/pgvector",
  "infiniflow/ragflow",
  "langfuse/langfuse",
  // Dev infra builders actually ship with
  "astral-sh/uv",
  "astral-sh/ruff",
  "oven-sh/bun",
  "denoland/deno",
  "zed-industries/zed",
];

// Belt-and-suspenders prerelease sniff — some repos tag an rc/beta without
// setting GitHub's `prerelease` flag.
const PRERELEASE_TAG_RE = /[-_.](rc|alpha|beta|dev|nightly|preview)[-._]?\d*$/i;

// First X.Y[.Z] anywhere in the tag — tolerates prefixes like "v", "release-".
const VERSION_RE = /(\d+)\.(\d+)(?:\.(\d+))?/;

/**
 * Patch-bump spam gate. A vX.Y.0 (or vX.Y) release is news by default; a
 * patch bump (vX.Y.Z, Z>0) is routine maintenance. Tags with no X.Y version
 * at all (llama.cpp-style `b6432` build tags, date stamps) are a firehose and
 * treated the same. Noisy releases can still surface — but only by earning
 * real reactions (see selectReleases' minPatchReactions).
 */
function isPatchNoise(tag) {
  const m = VERSION_RE.exec(String(tag));
  if (!m) return true;
  return m[3] != null && Number(m[3]) > 0;
}

/**
 * Rank + filter raw GitHub release records into clean release objects. Pure
 * (no I/O) so it's unit-testable. Input records are the REST /releases shape
 * plus a `repo` field ("owner/name") the fetcher annotates. Keeps genuinely
 * recent, stable, non-spam releases; one per repo; caps at `limit`.
 * @param {Array} items - release records (need repo, tag_name, published_at, draft, prerelease, html_url, reactions)
 * @param {object} [opts] - { limit, windowDays, minPatchReactions, nowMs }
 * @returns {Array<{repo,owner,name,tag,title,reactions,publishedAt,ageDays,url}>}
 */
function selectReleases(items, opts = {}) {
  const {
    limit = 5,
    windowDays = 14,
    minPatchReactions = 25,
    nowMs = Date.now(),
    gravity = 1.3,
  } = opts;
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  // Freshness-decayed traction, same curve as Model Drops: what JUST shipped
  // and is getting picked up, not whichever release accreted the most
  // reactions across the window. Raw stars never enter the score — the
  // watchlist is already the trust gate, so a fresh release from a small repo
  // outranks a stale one from a giant.
  const releaseScore = (x) =>
    (x.reactions + 1) / Math.pow(Math.max(0, x.age) + 2, gravity);
  return items
    .filter(
      (r) =>
        r &&
        typeof r.repo === "string" &&
        r.repo.includes("/") &&
        typeof r.tag_name === "string" &&
        r.tag_name.length > 0
    )
    .map((r) => ({
      r,
      owner: r.repo.split("/")[0],
      name: r.repo.split("/")[1],
      age: ageDays(r.published_at || r.created_at, nowMs),
      reactions: (r.reactions && r.reactions.total_count) || 0,
    }))
    // Only shipped, stable releases are events. Drafts/prereleases are not.
    .filter((x) => !x.r.draft && !x.r.prerelease && !PRERELEASE_TAG_RE.test(x.r.tag_name))
    // A release is only news while it's fresh — inside the window, not just latest.
    .filter((x) => x.age <= windowDays)
    // Patch-bump / build-tag spam must earn its slot with real reactions.
    .filter((x) => !isPatchNoise(x.r.tag_name) || x.reactions >= minPatchReactions)
    // Freshest, most-picked-up first; newer breaks ties.
    .sort((a, b) => releaseScore(b) - releaseScore(a) || a.age - b.age)
    // One slot per repo — dedupe AFTER ranking so the best release survives.
    .filter((x) => {
      if (seen.has(x.r.repo)) return false;
      seen.add(x.r.repo);
      return true;
    })
    .slice(0, limit)
    .map((x) => ({
      repo: x.r.repo,
      owner: x.owner,
      name: x.name,
      tag: x.r.tag_name,
      title: x.r.name || x.r.tag_name,
      reactions: x.reactions,
      publishedAt: x.r.published_at || null,
      ageDays: Number.isFinite(x.age) ? Math.floor(x.age) : null,
      url:
        x.r.html_url ||
        `https://github.com/${x.r.repo}/releases/tag/${encodeURIComponent(x.r.tag_name)}`,
    }));
}

/**
 * Fetch recent notable releases from the watched repos. One /releases call
 * per repo (capped at MAX_WATCHED), batched to stay polite. Returns [] on any
 * failure — the releases band is a bonus block, never a reason to fail the
 * edition. Works without a token (degraded rate limits) but never throws.
 * @param {object} [options] - { repos, limit, windowDays, minPatchReactions, token, fetchImpl, nowMs, timeoutMs, concurrency }
 * @returns {Promise<Array>}
 */
async function fetchGitHubReleases(options = {}) {
  const {
    repos = WATCHED_REPOS,
    limit = 5,
    windowDays = 14,
    minPatchReactions = 25,
    token = process.env.GITHUB_TOKEN,
    fetchImpl = globalThis.fetch,
    nowMs = Date.now(),
    timeoutMs = 10_000,
    concurrency = 8,
  } = options;

  if (typeof fetchImpl !== "function") {
    console.warn("GitHub Releases: no fetch available, skipping");
    return [];
  }

  // Same header discipline as src/github.js — UA always, auth when present.
  const headers = {
    "User-Agent": "GitTimes/1.0",
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const AbortCtor = globalThis.AbortController;
  let failures = 0;
  const get = async (repo) => {
    const controller = typeof AbortCtor === "function" ? new AbortCtor() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const url = `https://api.github.com/repos/${repo}/releases?per_page=3`;
      const res = await fetchImpl(url, {
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!res || !res.ok) {
        failures++;
        return [];
      }
      const records = (await res.json()) || [];
      // The list endpoint doesn't echo the repo back — annotate each record
      // so selectReleases can rank across repos.
      return (Array.isArray(records) ? records : []).map((r) => ({ ...r, repo }));
    } catch {
      failures++;
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const watched = repos.slice(0, MAX_WATCHED);
  const all = [];
  for (let i = 0; i < watched.length; i += concurrency) {
    const batch = await Promise.all(watched.slice(i, i + concurrency).map(get));
    for (const records of batch) all.push(...records);
  }
  if (failures > 0) {
    console.warn(
      `GitHub Releases: ${failures}/${watched.length} repo fetches failed (non-fatal)`
    );
  }

  const releases = selectReleases(all, { limit, windowDays, minPatchReactions, nowMs });
  console.log(
    `GitHub Releases: ${releases.length} notable release(s) from ${watched.length} watched repos`
  );
  return releases;
}

module.exports = { fetchGitHubReleases, selectReleases, isPatchNoise, WATCHED_REPOS };
