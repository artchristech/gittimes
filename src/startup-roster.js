/**
 * The Startups roster — the curated spine of the Startups desk.
 *
 * WHY THIS FILE EXISTS AT ALL. registry.js states, correctly, that "small and
 * new is the one stage the pipeline can't verify", and derives the startup tier
 * from org age plus traction. Almost nothing clears that bar, so /startups/
 * printed its empty state indefinitely. The derived path is not wrong; it is
 * just far too narrow to be the ONLY path. So the desk now has two:
 *
 *   1. this curated spine — companies a fund has publicly backed, each resolved
 *      to a real GitHub org and a real product repo; and
 *   2. the existing derived tier in classifyTier(), untouched, so an unfunded
 *      team that ships into trending can still turn up.
 *
 * WHY A COMMITTED FILE AND NOT A FEED. Every VC portfolio page worth reading is
 * client-rendered: a16z's is a JavaScript carousel that lists exits, and
 * ycombinator.com/companies returns a page title and nothing else to a plain
 * fetch. There is no portfolio feed to poll. What IS fetchable is the YC open
 * dataset (yc-oss/api), which is where every row in data/startup-roster.json
 * comes from, and which scripts/refresh-startup-roster.js re-reads to keep the
 * file honest. Roster membership is therefore a fetched record like everything
 * else on these pages — not a list someone typed from memory.
 *
 * WHAT THE ROSTER DOES NOT CLAIM. Fund membership and batch, both printed on
 * the YC company page linked in every row. Nothing else: no valuation, no
 * funding amount, no headcount, no revenue. The dataset carries none of them
 * and neither does this module.
 *
 * OBSERVABILITY. A roster entry with no verified repo has no watched channel,
 * so it is `observed: false` and renders as "not covered" rather than as a
 * company that shipped nothing — the same contract the Big Labs ledger runs on.
 * That is why a name alone never earns a row here: a name is not a channel.
 */

const path = require("path");

const ROSTER_PATH = path.join(__dirname, "..", "data", "startup-roster.json");

/**
 * Load the roster. Missing or malformed file returns an empty roster rather
 * than throwing — the Startups desk coming up dark is a designed state, and a
 * data file is never allowed to take the edition down with it.
 * @param {string} [file]
 * @returns {{ provenance: object|null, companies: Array }}
 */
function loadStartupRoster(file = ROSTER_PATH) {
  try {
    const doc = require(file);
    const companies = Array.isArray(doc && doc.companies) ? doc.companies : [];
    return { provenance: (doc && doc.provenance) || null, companies };
  } catch {
    return { provenance: null, companies: [] };
  }
}

/**
 * Roster rows shaped as registry seed entities. `tier` is set by the caller in
 * registry.js so this module never imports the tier constants back out of it.
 *
 * Only rows carrying at least one verified repo become watchable; a row without
 * one still becomes an entity (so the desk can name its own coverage boundary)
 * but arrives with no signals and is therefore never called quiet.
 * @param {object} [roster] - loadStartupRoster() output
 * @returns {Array}
 */
function rosterEntities(roster = loadStartupRoster()) {
  return (roster.companies || [])
    .filter((c) => c && c.id && c.name && Array.isArray(c.github) && c.github.length > 0)
    .map((c) => ({
      id: String(c.id),
      name: String(c.name),
      country: null,
      github: c.github.slice(),
      hf: Array.isArray(c.hf) ? c.hf.slice() : [],
      domains: Array.isArray(c.domains) ? c.domains.slice() : [],
      repos: Array.isArray(c.repos) ? c.repos.slice() : [],
      // Printed on the company file and the desk card; both are matters of
      // public record on the YC page this row links to.
      backer: (roster.provenance && roster.provenance.fund) || null,
      batch: c.batch || null,
      oneLiner: c.oneLiner || null,
      sourceUrl: c.ycUrl || null,
    }));
}

/** Every repo the roster wants on the releases watchlist. */
function rosterRepos(roster = loadStartupRoster()) {
  const out = new Set();
  for (const c of roster.companies || []) for (const r of c.repos || []) out.add(r);
  return [...out];
}

module.exports = { ROSTER_PATH, loadStartupRoster, rosterEntities, rosterRepos };
