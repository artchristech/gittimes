/**
 * The Pushup Report — the sports desk. In a paper about git, "how many pushups
 * can you do" has exactly one honest reading: how many times did a repo push
 * this week. This measures commit output over the last seven days for the repos
 * featured in today's edition and ranks them like a gym leaderboard — reps
 * counted, form graded. Pure fun, zero editorial weight: the band renders
 * nothing when the data isn't there and can never fail the edition.
 */

// One API call per repo — the featured set IS the request budget.
const MAX_MEASURED = 12;

/**
 * Form grade for a weekly rep count. Sports-desk voice, but the buckets are
 * honest: 100/wk is genuinely elite output, 0 is genuinely a rest day.
 */
function formGrade(reps) {
  if (reps >= 100) return "beast mode";
  if (reps >= 50) return "strict form";
  if (reps >= 20) return "solid set";
  if (reps >= 5) return "warming up";
  if (reps >= 1) return "light stretch";
  return "rest day";
}

/**
 * Walk edition content and collect the full_names of every featured repo, in
 * section order, deduped. Fail-soft: any missing shape yields fewer names,
 * never a throw.
 * @param {object} content - edition content ({ sections: { id: { lead, secondary, deepCuts, quickHits } } })
 * @returns {string[]}
 */
function collectFeaturedRepos(content) {
  const names = [];
  const seen = new Set();
  const add = (repo) => {
    const full = repo && typeof repo.full_name === "string" ? repo.full_name : null;
    if (full && full.includes("/") && !seen.has(full)) {
      seen.add(full);
      names.push(full);
    }
  };
  const sections = (content && content.sections) || {};
  for (const section of Object.values(sections)) {
    if (!section || section.isEmpty) continue;
    for (const a of [section.lead, ...(section.secondary || []), ...(section.deepCuts || [])]) {
      if (a) add(a.repo);
    }
    for (const q of section.quickHits || []) add(q.repo || q);
  }
  return names;
}

/**
 * Rank measured repos into the leaderboard. Pure (no I/O) so it's testable.
 * @param {Array<{repo,reps,capped}>} rows
 * @param {object} [opts] - { limit }
 * @returns {Array<{repo,owner,name,reps,repsLabel,form,url}>}
 */
function selectPushups(rows, opts = {}) {
  const { limit = 5 } = opts;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r.repo === "string" && r.repo.includes("/") && Number.isFinite(r.reps))
    .filter((r) => r.reps > 0) // a leaderboard of rest days isn't a leaderboard
    .sort((a, b) => b.reps - a.reps)
    .slice(0, limit)
    .map((r) => ({
      repo: r.repo,
      owner: r.repo.split("/")[0],
      name: r.repo.split("/")[1],
      reps: r.reps,
      repsLabel: r.capped ? `${r.reps}+` : String(r.reps),
      form: formGrade(r.reps),
      url: `https://github.com/${r.repo}/commits`,
    }));
}

/**
 * Count each repo's commits over the last windowDays via the REST commits list
 * (per_page=100; a full page means "100+", which is all a leaderboard needs).
 * Returns [] on any failure — the sports desk never takes the edition down.
 * @param {object} [options] - { repos, limit, windowDays, token, fetchImpl, nowMs, timeoutMs, concurrency }
 * @returns {Promise<Array>}
 */
async function fetchPushups(options = {}) {
  const {
    repos = [],
    limit = 5,
    windowDays = 7,
    token = process.env.GITHUB_TOKEN,
    fetchImpl = globalThis.fetch,
    nowMs = Date.now(),
    timeoutMs = 10_000,
    concurrency = 6,
  } = options;

  if (typeof fetchImpl !== "function" || repos.length === 0) return [];

  // Same header discipline as src/github.js — UA always, auth when present.
  const headers = {
    "User-Agent": "GitTimes/1.0",
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const since = new Date(nowMs - windowDays * 86400000).toISOString();

  const AbortCtor = globalThis.AbortController;
  let failures = 0;
  const measure = async (repo) => {
    const controller = typeof AbortCtor === "function" ? new AbortCtor() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const url = `https://api.github.com/repos/${repo}/commits?since=${encodeURIComponent(since)}&per_page=100`;
      const res = await fetchImpl(url, {
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!res || !res.ok) {
        failures++;
        return null;
      }
      const commits = (await res.json()) || [];
      const n = Array.isArray(commits) ? commits.length : 0;
      return { repo, reps: n, capped: n >= 100 };
    } catch {
      failures++;
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const measured = repos.slice(0, MAX_MEASURED);
  const rows = [];
  for (let i = 0; i < measured.length; i += concurrency) {
    const batch = await Promise.all(measured.slice(i, i + concurrency).map(measure));
    for (const row of batch) if (row) rows.push(row);
  }
  if (failures > 0) {
    console.warn(`Pushup Report: ${failures}/${measured.length} repo measurements failed (non-fatal)`);
  }

  const board = selectPushups(rows, { limit });
  console.log(`Pushup Report: ${board.length} repo(s) on the board from ${measured.length} measured`);
  return board;
}

module.exports = { fetchPushups, selectPushups, collectFeaturedRepos, formGrade };
