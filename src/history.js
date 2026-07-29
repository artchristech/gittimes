const fs = require("fs");
const path = require("path");

const { toDateStr } = require("./publish");
const db = require("./db");

/**
 * Load history from database (falls back to JSON for migration).
 * @param {string} outDir - Output directory containing editions/
 * @returns {{ snapshots: Array }}
 */
function loadHistory(outDir) {
  try {
    const history = db.loadSnapshots(db.resolveDataDir(outDir));
    if (history.snapshots.length > 0) return history;
  } catch {
    // Fall through to JSON fallback
  }

  // JSON fallback for pre-migration state
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
 * Prunes to 14 snapshots. Writes to database and JSON.
 * @param {string} outDir - Output directory
 * @param {Array} repos - Raw GitHub repo objects
 * @param {Date} [date] - Override date (defaults to now)
 */
function snapshotHistory(outDir, repos, date) {
  const d = date || new Date();
  const dateStr = toDateStr(d);

  // Write to database
  db.saveSnapshot(db.resolveDataDir(outDir), dateStr, repos);

  // Also write JSON for backwards compatibility
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

  const existingIdx = history.snapshots.findIndex((s) => s.date === dateStr);
  if (existingIdx !== -1) {
    history.snapshots[existingIdx] = snapshot;
  } else {
    history.snapshots.unshift(snapshot);
  }

  if (history.snapshots.length > 14) {
    history.snapshots = history.snapshots.slice(0, 14);
  }

  const dir = path.join(outDir, "editions");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify(history, null, 2));
}

/**
 * Star growth over the widest honest window we have, up to `windowDays`.
 *
 * computeDeltas compares against the most recent snapshot — usually yesterday,
 * which is too short a base to say anything about a repo's trajectory. This
 * reaches further back and reports the window it actually measured, so a paper
 * three days into its history says "in 3d" rather than inventing a week.
 *
 * @param {Array} repos - Raw GitHub repo objects (full_name, stargazers_count)
 * @param {{ snapshots: Array }} history - History data from loadHistory
 * @param {number} [windowDays] - Widest window to reach for
 * @returns {Map<string, { delta: number, days: number }>} Repos with no usable
 *   baseline are absent from the map rather than present with nulls.
 */
function computeWindowDeltas(repos, history, windowDays = 7) {
  const out = new Map();
  const snapshots = (history && history.snapshots) || [];
  if (snapshots.length === 0) return out;

  // Snapshot dates are calendar days ("2026-07-21"), so measure calendar days
  // between UTC midnights. Subtracting from a mid-afternoon Date.now() would
  // round today's own snapshot up to "1 day old" and skew every label by one.
  const n = new Date();
  const todayUtc = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const ageOf = (s) => {
    const day = Date.parse(String(s.date).slice(0, 10) + "T00:00:00Z");
    return Number.isNaN(day) ? NaN : Math.round((todayUtc - day) / 86400000);
  };

  // Widest snapshot no older than the window. Snapshots arrive newest-first but
  // don't rely on it — a corrupt or hand-edited history shouldn't skew the label.
  let base = null;
  let baseAge = 0;
  for (const snap of snapshots) {
    const age = ageOf(snap);
    if (!Number.isFinite(age) || age < 1 || age > windowDays) continue;
    if (age > baseAge) { base = snap; baseAge = age; }
  }
  if (!base) return out;

  const prev = new Map(base.repos.map((r) => [r.full_name, r]));

  for (const repo of repos) {
    const name = repo.full_name || repo.name;
    if (!name || !prev.has(name)) continue;
    const then = prev.get(name).stars || 0;
    const nowStars = repo.stargazers_count != null ? repo.stargazers_count : repo.stars;
    if (nowStars == null) continue;
    const delta = nowStars - then;
    // A negative delta means unstarring or a corrected count — real, but not a
    // story, and "▲ -12" is nonsense. Drop it and fall back to the total.
    if (delta <= 0) continue;
    out.set(name, { delta, days: baseAge });
  }

  return out;
}

module.exports = { loadHistory, computeDeltas, computeWindowDeltas, snapshotHistory };
