/**
 * Recency rules — the single source of truth for "what counts as recent" per
 * edition slot. The Git Times is a newspaper: stale content must not headline.
 * Recency was historically only a soft score weight (scoreRepo) + a prose
 * directive (prompts.js), neither of which EXCLUDES anything. These rules add
 * graduated, enforceable bars: strictest on the LEAD, looser below.
 *
 * Per-slot table — each entry names a window AND the timestamp field it keys on:
 *
 *   slot       window      keyed on
 *   --------   ---------   ---------------------------------------------------
 *   lead       30 days     a genuine HOOK — a recent release OR a brand-new repo
 *                          (created within window). NOT push activity alone, so a
 *                          years-old repo with a fresh commit but no release/event
 *                          cannot headline.
 *   secondary  60 days     last push (pushed_at)
 *   quickHit   120 days    last push (pushed_at)
 *   aiWire     48 hours    item publish time (HN created_at_i / arXiv published)
 *   radar      45 days     last push (pushed_at)
 *
 * Ordering invariant: lead.windowDays <= secondary.windowDays <= quickHit.windowDays.
 */

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

const RECENCY_RULES = {
  // Daily-newspaper windows, not magazine windows. A repo whose only "hook" is a
  // month-old release is not today's news. Tightened 2026-06-30 (30/60/120 → 7/21/45)
  // so the front page tracks the velocity of what shipped this week, not what's popular.
  lead: { windowDays: 7, field: "hook" }, // release date OR created_at (brand-new repo)
  secondary: { windowDays: 21, field: "pushed" },
  quickHit: { windowDays: 45, field: "pushed" },
  aiWire: { windowHours: 48, field: "published" },
  radar: { windowDays: 45, field: "pushed" },
};

/** Age in days from an ISO date string to `now` (ms). Missing/unparseable → Infinity (treated as stale). */
function ageDays(dateStr, now) {
  if (!dateStr) return Infinity;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return Infinity;
  return (now - t) / DAY_MS;
}

/** Age in hours from a unix-seconds timestamp (HN `created_at_i`) to `now` (ms). Missing → Infinity. */
function ageHoursFromUnix(unixSeconds, now) {
  if (unixSeconds == null || Number.isNaN(Number(unixSeconds))) return Infinity;
  return (now - Number(unixSeconds) * 1000) / HOUR_MS;
}

/** The genuine-hook date for a repo: its latest release date (preferred). */
function repoReleaseDate(repo) {
  const r = repo && repo._latestRelease;
  return r ? r.published_at || r.created_at || null : null;
}

function repoCreatedAt(repo) {
  return (repo && (repo.created_at || repo.createdAt)) || null;
}

function repoPushedAt(repo) {
  return (repo && (repo.pushed_at || repo.pushedAt)) || null;
}

/**
 * LEAD eligibility — the front-page lead must have a genuine recent hook:
 * a release within the lead window, OR a brand-new repo (created within it).
 * A years-old repo with only a recent push (no release/event) is NOT eligible.
 * Boundary: an age exactly AT the window is INCLUDED (<=).
 */
function leadEligible(repo, now = Date.now()) {
  const w = RECENCY_RULES.lead.windowDays;
  return leadHookAgeDays(repo, now) <= w;
}

/**
 * Age (days) of a repo's freshest LEAD hook — the more recent of its latest
 * release or its creation date. Infinity if it has neither (no hook at all).
 * Used to rank lead candidates by how recently something genuinely happened.
 */
function leadHookAgeDays(repo, now = Date.now()) {
  return Math.min(ageDays(repoReleaseDate(repo), now), ageDays(repoCreatedAt(repo), now));
}

/**
 * Pick the index of the best lead from a scored, score-ordered list — a
 * newspaper rule, not a popularity rule. Tiers (recentLeadRepos are skipped
 * unless every candidate is one):
 *   1. genuine recent hook (leadEligible) → freshest hook wins
 *   2. no hook anywhere → freshest genuine activity (most recent push) wins
 *   3. nothing distinguishes (no timestamps) → keep incoming score order (index 0)
 * Crucially never falls back to raw star score, so an old-but-popular repo with
 * no recent hook can no longer headline. Returns -1 for an empty list.
 */
function pickLeadIndex(repos, now = Date.now(), recentLeadRepos = new Set()) {
  if (!repos || repos.length === 0) return -1;
  const indexed = repos.map((r, i) => ({ r, i }));
  const candidates = indexed.filter(({ r }) => !recentLeadRepos.has(r && r.full_name));
  const pool = candidates.length ? candidates : indexed;

  const eligible = pool.filter(({ r }) => leadEligible(r, now));
  if (eligible.length) {
    eligible.sort((a, b) => leadHookAgeDays(a.r, now) - leadHookAgeDays(b.r, now));
    return eligible[0].i;
  }
  const pushed = pool.filter(({ r }) => Number.isFinite(ageDays(repoPushedAt(r), now)));
  if (pushed.length) {
    pushed.sort((a, b) => ageDays(repoPushedAt(a.r), now) - ageDays(repoPushedAt(b.r), now));
    return pushed[0].i;
  }
  return pool[0].i;
}

/** Generic per-slot pushed_at gate (secondary/quickHit/radar). Boundary AT window = included. */
function passesPushedRecency(repo, slot, now = Date.now()) {
  const rule = RECENCY_RULES[slot];
  if (!rule || rule.windowDays == null) return true;
  return ageDays(repoPushedAt(repo), now) <= rule.windowDays;
}

/** AI Wire gate: is an HN/arXiv item within the aiWire hours window? `createdAtUnix` = HN created_at_i. */
function withinWireWindow(createdAtUnix, now = Date.now()) {
  return ageHoursFromUnix(createdAtUnix, now) <= RECENCY_RULES.aiWire.windowHours;
}

module.exports = {
  RECENCY_RULES,
  DAY_MS,
  HOUR_MS,
  ageDays,
  ageHoursFromUnix,
  repoReleaseDate,
  repoCreatedAt,
  repoPushedAt,
  leadEligible,
  leadHookAgeDays,
  pickLeadIndex,
  passesPushedRecency,
  withinWireWindow,
};
