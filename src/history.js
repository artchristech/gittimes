const fs = require("fs");
const path = require("path");

const { toDateStr } = require("./publish");

/**
 * Load history from disk or return empty structure.
 * @param {string} outDir - Output directory containing editions/
 * @returns {{ snapshots: Array }}
 */
function loadHistory(outDir) {
  const historyPath = path.join(outDir, "editions", "history.json");
  if (fs.existsSync(historyPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
      if (data && Array.isArray(data.snapshots)) {
        return data;
      }
      return { snapshots: [] };
    } catch (e) {
      console.warn(`Warning: corrupt history.json, starting fresh: ${e.message}`);
      return { snapshots: [] };
    }
  }
  return { snapshots: [] };
}

/**
 * Compare current repo star/fork counts against most recent snapshot.
 * @param {Array} repos - Raw GitHub repo objects (must have full_name, stargazers_count, forks_count)
 * @param {{ snapshots: Array }} history - History data from loadHistory
 * @returns {Map<string, { starDelta: number|null, forkDelta: number|null, daysSinceSnapshot: number|null, previousStars: number|null, starVelocity: number|null }>}
 */
function computeDeltas(repos, history) {
  const deltas = new Map();

  const latest = history.snapshots.length > 0 ? history.snapshots[0] : null;
  const previousRepos = latest ? new Map(latest.repos.map((r) => [r.full_name, r])) : null;
  const snapshotDate = latest ? new Date(latest.date) : null;

  for (const repo of repos) {
    if (!previousRepos || !previousRepos.has(repo.full_name)) {
      deltas.set(repo.full_name, {
        starDelta: null,
        forkDelta: null,
        daysSinceSnapshot: null,
        previousStars: null,
        starVelocity: null,
      });
      continue;
    }

    const prev = previousRepos.get(repo.full_name);
    const starDelta = (repo.stargazers_count || 0) - (prev.stars || 0);
    const forkDelta = (repo.forks_count || 0) - (prev.forks || 0);
    const daysSinceSnapshot = snapshotDate
      ? Math.max(1, Math.round((Date.now() - snapshotDate.getTime()) / 86400000))
      : null;
    const starVelocity = daysSinceSnapshot ? starDelta / daysSinceSnapshot : null;

    deltas.set(repo.full_name, {
      starDelta,
      forkDelta,
      daysSinceSnapshot,
      previousStars: prev.stars,
      starVelocity,
    });
  }

  return deltas;
}

/**
 * Save today's star/fork/issue counts for all candidate repos.
 * Prunes to 14 snapshots. Writes to editions/history.json.
 * @param {string} outDir - Output directory
 * @param {Array} repos - Raw GitHub repo objects
 * @param {Date} [date] - Override date (defaults to now)
 */
function snapshotHistory(outDir, repos, date) {
  const d = date || new Date();
  const dateStr = toDateStr(d);

  const history = loadHistory(outDir);

  const snapshot = {
    date: dateStr,
    repos: repos.map((r) => ({
      full_name: r.full_name,
      stars: r.stargazers_count || 0,
      forks: r.forks_count || 0,
      issues: r.open_issues_count || 0,
    })),
  };

  // Replace existing snapshot for this date, or prepend
  const existingIdx = history.snapshots.findIndex((s) => s.date === dateStr);
  if (existingIdx !== -1) {
    history.snapshots[existingIdx] = snapshot;
  } else {
    history.snapshots.unshift(snapshot);
  }

  // Prune to 14 snapshots
  if (history.snapshots.length > 14) {
    history.snapshots = history.snapshots.slice(0, 14);
  }

  const dir = path.join(outDir, "editions");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(history, null, 2));
}

module.exports = { loadHistory, computeDeltas, snapshotHistory };
