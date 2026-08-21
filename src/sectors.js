/**
 * The Sectors desk — who shipped into each topic sector.
 *
 * WHY THIS EXISTS. "Sectors" sat in the lens row as a `<button>` alongside three
 * `<a>` links to standing desk pages. The lens row asks "who made it"; Sectors
 * answered "what kind of thing is it" and switched a panel inside the current
 * edition rather than navigating anywhere. A row where one entry behaves
 * differently from its neighbours while looking identical to them is a promise
 * the interface does not keep, and the fix is not to restyle the button — it is
 * to make Sectors the standing page it was already dressed as.
 *
 * WHAT THE PAGE ANSWERS. sections.js is the paper's topic axis and registry.js
 * is its actor axis. Neither one has ever been joined to the other, so a reader
 * could ask "who shipped this week" (Big Labs) or "what shipped in Robotics"
 * (the topic tabs) but never "which companies are working in Robotics". This
 * desk is that join, and it is the only page on the site that reads down the
 * topic axis across editions rather than within one.
 *
 * HOW AN ARTIFACT GETS A SECTOR — and where it doesn't:
 *   - A repo artifact is filed on the OWNER'S OWN TOPICS, matched against the
 *     same topic lists sections.js queries GitHub with. Failing that, on its
 *     language, the same way the Systems section is defined.
 *   - A release is filed under its repo's topics when the pipeline saw that
 *     repo this run; otherwise it is not filed at all.
 *   - A published model is AI. That is definitional, not a guess.
 *   - Everything else is counted as UNCLASSIFIED and said out loud. A desk that
 *     silently drops what it cannot file reports a smaller world than it saw;
 *     one that guesses reports a wrong one.
 *
 * Pure and I/O-free — feed it buildRegistry() output.
 */

const { SECTIONS, SECTION_ORDER } = require("./sections");

// The front page is not a sector — it is a placement. Sectors are topics.
const SECTOR_ORDER = SECTION_ORDER.filter((id) => id !== "frontPage");

const norm = (s) => String(s || "").trim().toLowerCase();

/** Topic → sector, built once from the same lists sections.js queries with. */
function buildTopicIndex(sections = SECTIONS) {
  const byTopic = new Map();
  const byLanguage = new Map();
  for (const id of SECTOR_ORDER) {
    const q = (sections[id] || {}).query || {};
    for (const t of q.topics || []) if (!byTopic.has(norm(t))) byTopic.set(norm(t), id);
    for (const l of q.languages || []) if (!byLanguage.has(norm(l))) byLanguage.set(norm(l), id);
  }
  return { byTopic, byLanguage };
}

/**
 * Which sector an event belongs to, or null when the pipeline cannot say.
 *
 * Returning null is the load-bearing case. The alternative — defaulting an
 * unfiled artifact into AI because most of them are — would make the sector
 * counts a reflection of that default rather than of what shipped.
 *
 * @param {object} event - a registry event
 * @param {object} [opts] - { index, topicsByRepo }
 * @returns {string|null}
 */
function sectorOf(event, opts = {}) {
  if (!event) return null;
  const { index = buildTopicIndex(), topicsByRepo = new Map() } = opts;

  // A published model is AI by definition — the artifact IS a model.
  if (event.type === "model-drop") return "ai";

  const repo = event.metrics && event.metrics.repo;
  const own = (event.metrics && event.metrics.topics) || [];
  const topics = own.length > 0 ? own : topicsByRepo.get(repo) || [];
  for (const t of topics) {
    const hit = index.byTopic.get(norm(t));
    if (hit) return hit;
  }
  const language = event.metrics && event.metrics.language;
  return index.byLanguage.get(norm(language)) || null;
}

/** repo full_name → topics, harvested from every repo artifact in the window. */
function topicIndexByRepo(entities = []) {
  const out = new Map();
  for (const e of entities) {
    for (const ev of e.events || []) {
      const repo = ev.metrics && ev.metrics.repo;
      const topics = (ev.metrics && ev.metrics.topics) || [];
      if (repo && topics.length > 0 && !out.has(repo)) out.set(repo, topics);
    }
  }
  return out;
}

/**
 * Build the Sectors desk.
 *
 * One row per company per sector, carrying the artifact that put them there and
 * its receipt — the same evidence contract every other Business surface runs on.
 * A company appears in as many sectors as it actually shipped into; nothing is
 * assigned a primary sector, because a company is not one topic.
 *
 * @param {Array} entities - buildRegistry().entities
 * @param {object} [opts] - { windowDays, maxPerSector, sections }
 */
function buildSectorDesk(entities = [], opts = {}) {
  const { windowDays = 30, maxPerSector = 12, sections = SECTIONS } = opts;
  const index = buildTopicIndex(sections);
  const topicsByRepo = topicIndexByRepo(entities);

  const bySector = new Map(SECTOR_ORDER.map((id) => [id, new Map()]));
  let classified = 0;
  let unclassified = 0;

  for (const entity of entities) {
    for (const ev of entity.events || []) {
      if (!Number.isFinite(ev.ageDays) || ev.ageDays > windowDays) continue;
      const sector = sectorOf(ev, { index, topicsByRepo });
      if (!sector || !bySector.has(sector)) {
        unclassified++;
        continue;
      }
      classified++;
      const rows = bySector.get(sector);
      const prior = rows.get(entity.id);
      // Freshest artifact per company wins the row; a company shipping five
      // times into one sector is one row, not five.
      if (prior && prior.ageDays <= ev.ageDays) continue;
      rows.set(entity.id, {
        entityId: entity.id,
        name: entity.name,
        tier: entity.tier,
        headline: ev.title,
        url: ev.url,
        kind: ev.type,
        // A repo artifact is a sighting, not a ship. The renderer says which.
        shipped: ev.type !== "repo",
        ageDays: ev.ageDays,
        evidence: ev.evidence || null,
      });
    }
  }

  const sectors = SECTOR_ORDER.map((id) => {
    const rows = [...(bySector.get(id) || new Map()).values()].sort(
      (a, b) => a.ageDays - b.ageDays
    );
    return {
      id,
      label: (sections[id] || {}).label || id,
      companies: rows.slice(0, maxPerSector),
      total: rows.length,
      // Stated per sector, not just in aggregate: a sector with nobody in it is
      // a finding about the window, and padding it would be the same failure
      // the desk specs already refuse.
      empty: rows.length === 0,
    };
  });

  return {
    id: "sectors",
    label: "Sectors",
    slug: "sectors",
    kicker: "Who is shipping into what",
    windowDays,
    sectors,
    classified,
    unclassified,
    companies: new Set(
      sectors.flatMap((s) => s.companies.map((c) => c.entityId))
    ).size,
    empty: classified === 0,
  };
}

module.exports = {
  SECTOR_ORDER,
  buildTopicIndex,
  topicIndexByRepo,
  sectorOf,
  buildSectorDesk,
};
