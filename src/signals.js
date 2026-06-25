/**
 * Cross-source significance — corroboration the editor-in-chief is otherwise
 * blind to. The editor judges a repo from GitHub metadata alone; these signals
 * answer "is the world actually talking about this?" by pulling KEYLESS public
 * data and attaching a short summary to each lead candidate.
 *
 * Sources (all keyless, all fail-soft):
 *   - Hacker News discussion volume (Algolia search API) — points + comments on
 *     stories that link the repo. The strongest "people are discussing this" tell.
 *   - Package downloads, ecosystem-gated by repo language:
 *       JavaScript/TypeScript -> npm weekly downloads (api.npmjs.org)
 *       Python                -> PyPI weekly downloads (pypistats.org)
 *
 * EVERYTHING here is fail-soft: any throw, timeout, non-200, or unparseable body
 * yields no signal for that source — never an exception into the build. A repo
 * -> package-name guess is best-effort (the repo's short name); a miss is silent.
 * Set GT_DISABLE_SOURCES=1 to turn the whole layer off (used by the
 * everything-fails-still-builds check).
 */

const DEFAULT_TIMEOUT_MS = 4000;

/** Best-effort package name from a repo full_name ("owner/Repo-Name" -> "repo-name"). */
function shortName(repoFullName) {
  if (!repoFullName || typeof repoFullName !== "string") return null;
  const seg = repoFullName.split("/").pop();
  return seg ? seg.toLowerCase() : null;
}

/** Sum points + comments across HN story hits that actually reference the repo. */
function parseHNActivity(json, repoFullName) {
  if (!json || !Array.isArray(json.hits)) return null;
  const needle = (repoFullName || "").toLowerCase();
  let points = 0, comments = 0, count = 0;
  for (const hit of json.hits) {
    const url = (hit.url || "").toLowerCase();
    const title = (hit.title || "").toLowerCase();
    // Only count hits that plausibly reference this repo (url contains owner/repo,
    // or title contains the repo short name) to avoid generic-term false matches.
    const short = needle.split("/").pop();
    if (needle && !(url.includes(needle) || (short && title.includes(short)))) continue;
    points += hit.points || 0;
    comments += hit.num_comments || 0;
    count += 1;
  }
  if (count === 0) return null;
  return { points, comments, count };
}

/** npm point-downloads response -> weekly download count (or null). */
function parseNpmDownloads(json) {
  if (!json || typeof json.downloads !== "number") return null;
  return json.downloads;
}

/** pypistats recent response -> weekly download count (or null). */
function parsePypiDownloads(json) {
  const wk = json && json.data && json.data.last_week;
  return typeof wk === "number" ? wk : null;
}

/** Compact human-readable count (1234 -> "1.2k"). */
function _compact(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

/**
 * Format a signals object into a one-line summary fragment for the editor's
 * candidate list. Returns "" when there is nothing worth saying.
 */
function formatSignals(signals) {
  if (!signals) return "";
  const parts = [];
  if (signals.hn && signals.hn.count > 0) {
    parts.push(`HN ${_compact(signals.hn.points)} pts/${_compact(signals.hn.comments)} comments across ${signals.hn.count} thread${signals.hn.count > 1 ? "s" : ""}`);
  }
  if (signals.downloads && signals.downloads.weekly > 0) {
    parts.push(`${signals.downloads.ecosystem} ${_compact(signals.downloads.weekly)} downloads/wk`);
  }
  return parts.length ? `buzz: ${parts.join("; ")}` : "";
}

async function _getJson(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { "User-Agent": "the-git-times" } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null; // fail-soft: down, timeout, non-200, or unparseable
  } finally {
    clearTimeout(timer);
  }
}

/** HN discussion volume for a repo (keyless Algolia). Fail-soft -> null. */
async function fetchHNActivity(repoFullName, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const short = shortName(repoFullName);
  if (!short) return null;
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(short)}&tags=story&hitsPerPage=10`;
  const json = await _getJson(url, fetchImpl, timeoutMs);
  return parseHNActivity(json, repoFullName);
}

/** Weekly package downloads, ecosystem-gated by language. Fail-soft -> null. */
async function fetchPackageDownloads(repo, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const pkg = shortName(repo && (repo.full_name || repo.name));
  if (!pkg) return null;
  const lang = (repo.language || "").toLowerCase();
  if (lang === "javascript" || lang === "typescript") {
    const json = await _getJson(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg)}`, fetchImpl, timeoutMs);
    const weekly = parseNpmDownloads(json);
    return weekly != null ? { ecosystem: "npm", weekly, name: pkg } : null;
  }
  if (lang === "python") {
    const json = await _getJson(`https://pypistats.org/api/packages/${encodeURIComponent(pkg)}/recent`, fetchImpl, timeoutMs);
    const weekly = parsePypiDownloads(json);
    return weekly != null ? { ecosystem: "PyPI", weekly, name: pkg } : null;
  }
  return null;
}

/** Gather all signals for one candidate. Always resolves (never rejects). */
async function fetchSignalsForCandidate(candidate, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const repo = candidate && candidate.repo;
  if (!repo) return null;
  const full = repo.full_name || repo.name;
  const [hn, downloads] = await Promise.all([
    fetchHNActivity(full, fetchImpl, timeoutMs).catch(() => null),
    fetchPackageDownloads(repo, fetchImpl, timeoutMs).catch(() => null),
  ]);
  if (!hn && !downloads) return null;
  return { hn, downloads };
}

/**
 * Enrich lead candidates in place with cross-source signals + a formatted
 * `signalSummary` string consumed by candidateSummaryLines. Concurrency-limited,
 * fully fail-soft. Returns the same candidates array.
 *
 * @param {Array} candidates
 * @param {{ fetchImpl?: function, concurrency?: number, timeoutMs?: number }} [opts]
 */
async function enrichCandidatesWithSignals(candidates, opts = {}) {
  if (process.env.GT_DISABLE_SOURCES === "1") return candidates || [];
  if (!Array.isArray(candidates) || candidates.length === 0) return candidates || [];
  const fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!fetchImpl) return candidates; // no fetch available -> silently skip
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const concurrency = Math.max(1, opts.concurrency || 4);

  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const i = cursor++;
      const c = candidates[i];
      try {
        const signals = await fetchSignalsForCandidate(c, fetchImpl, timeoutMs);
        if (signals) {
          c.signals = signals;
          const summary = formatSignals(signals);
          if (summary) c.signalSummary = summary;
        }
      } catch {
        /* per-candidate fail-soft */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return candidates;
}

module.exports = {
  shortName,
  parseHNActivity,
  parseNpmDownloads,
  parsePypiDownloads,
  formatSignals,
  fetchHNActivity,
  fetchPackageDownloads,
  fetchSignalsForCandidate,
  enrichCandidatesWithSignals,
};
