/**
 * Shared generation pipeline used by both generate.js and publish-edition.js.
 * Encapsulates: fetch → editorial → generate → dedup.
 */
const { fetchAllSections, enrichTrendRepos } = require("./github");
const { generateAllContent, generateEditorialContent, deduplicateContent } = require("./xai");
const { loadHistory, computeDeltas, computeWindowDeltas } = require("./history");
const { makeEditorialPlan } = require("./editorial");
const { fetchXSentimentForRepo } = require("./x-sentiment");
const { buildDeskBlock } = require("./desk");
const { resolveDataDir } = require("./db");

/**
 * Run the full content generation pipeline.
 * @param {string} githubToken
 * @param {string} xaiKey
 * @param {object} [options]
 * @param {string} [options.outDir] - Output dir for history lookups
 * @param {Set} [options.recentRepoNames]
 * @param {Set} [options.recentLeadRepos]
 * @param {Map} [options.recentRepoCoverage]
 * @param {string[]} [options.recentEditionDates]
 * @param {string} [options.deskContext] - Human editor rulings block; built from
 *   the desk automatically when omitted
 * @param {Map} [options.coverage] - Same as recentRepoCoverage, passed to xai
 * @param {function} [options.filterEditorialCandidates] - (rawCandidates) => filtered candidates
 * @param {function} [options.enrichRepo] - Injected to break circular dep
 * @param {function} [options.fetchStarTrajectory] - Injected to break circular dep
 * @returns {Promise<{ content: object, rawCandidates: Array }>}
 */
async function runPipeline(githubToken, xaiKey, options = {}) {
  const outDir = options.outDir || process.env.PUBLISH_DIR || "./site";
  const editorialEnabled = process.env.EDITORIAL !== "false";

  // Step 1: Fetch all sections
  const fetchOptions = {};
  if (options.recentRepoNames) fetchOptions.recentRepoNames = options.recentRepoNames;
  if (options.recentLeadRepos) fetchOptions.recentLeadRepos = options.recentLeadRepos;
  if (options.recentRepoCoverage) fetchOptions.recentRepoCoverage = options.recentRepoCoverage;
  if (options.recentEditionDates) fetchOptions.recentEditionDates = options.recentEditionDates;

  const sections = await fetchAllSections(githubToken, fetchOptions);
  const rawCandidates = sections._rawCandidates || [];

  // Step 2: Editorial pipeline (with graceful fallback)
  let content;
  const coverage = options.coverage || options.recentRepoCoverage || null;

  if (editorialEnabled && rawCandidates.length > 0) {
    const history = loadHistory(outDir);
    const deltas = computeDeltas(rawCandidates, history);

    const candidates = options.filterEditorialCandidates
      ? options.filterEditorialCandidates(rawCandidates)
      : rawCandidates;
    const editorialPlan = makeEditorialPlan(candidates, deltas);

    const hasEditorial = editorialPlan.breakout || editorialPlan.trends.length > 0 || editorialPlan.sleepers.length > 0;
    if (hasEditorial) {
      console.log("Editorial intelligence active:");
      if (editorialPlan.breakout) console.log(`  Breakout: ${editorialPlan.breakout.repo.full_name}`);
      if (editorialPlan.trends.length > 0) console.log(`  Trends: ${editorialPlan.trends.map((t) => t.theme).join(", ")}`);
      if (editorialPlan.sleepers.length > 0) console.log(`  Sleepers: ${editorialPlan.sleepers.map((s) => s.repo.full_name).join(", ")}`);
    }

    if (editorialPlan.trends.length > 0) {
      await enrichTrendRepos(editorialPlan.trends, githubToken).catch((err) =>
        console.warn(`Trend pill README enrichment failed: ${err.message}`)
      );
    }

    // The editor's desk: the human editor's retrospective rulings on past front
    // pages, injected as standing policy for today's lead decision. Fail-soft and
    // opt-out-able — with no rulings on file the lead prompts are unchanged.
    let deskContext = options.deskContext || null;
    if (!deskContext && process.env.GT_DISABLE_DESK !== "1") {
      try {
        deskContext = buildDeskBlock(resolveDataDir(outDir));
      } catch (err) {
        console.warn(`Editor's desk context skipped (non-fatal): ${err.message}`);
      }
    }
    if (deskContext) console.log("Editor's desk: human rulings in play for the lead decision");

    const editorialOpts = { githubToken, coverage, fetchXSentimentForRepo };
    if (options.enrichRepo) editorialOpts.enrichRepo = options.enrichRepo;
    if (options.fetchStarTrajectory) editorialOpts.fetchStarTrajectory = options.fetchStarTrajectory;
    if (options.threadContext) editorialOpts.threadContext = options.threadContext;
    if (deskContext) editorialOpts.deskContext = deskContext;

    content = await generateEditorialContent(sections, xaiKey, editorialPlan, editorialOpts);
  } else {
    content = await generateAllContent(sections, xaiKey, { coverage, fetchXSentimentForRepo });
  }

  // Step 3: Dedup
  deduplicateContent(content);

  // Step 4: Star velocity. A lifetime total says a repo is popular, which isn't
  // news; growth over the last week is. Attached after generation so it decorates
  // every article regardless of which branch above produced it.
  attachStarVelocity(content, rawCandidates, outDir);

  return { content, rawCandidates };
}

/**
 * Walk every article in the content tree and hang { delta, days } on its repo.
 * Non-fatal throughout: no history, no snapshots, or a repo we've never seen
 * before all just leave the repo undecorated, and the renderer falls back to
 * the star total.
 */
function attachStarVelocity(content, rawCandidates, outDir) {
  let velocity;
  try {
    velocity = computeWindowDeltas(rawCandidates, loadHistory(outDir));
  } catch (err) {
    console.warn(`Star velocity unavailable (non-fatal): ${err.message}`);
    return;
  }
  if (velocity.size === 0) return;

  let decorated = 0;
  for (const article of walkArticles(content)) {
    const repo = article.repo;
    if (!repo || !repo.name) continue;
    const v = velocity.get(repo.name);
    if (!v) continue;
    repo.starDelta = v.delta;
    repo.starDeltaDays = v.days;
    decorated++;
  }
  console.log(`Star velocity: ${decorated} articles carry a growth figure`);
}

/** Every article-shaped object in a content tree, whatever section it sits in. */
function* walkArticles(content) {
  for (const section of Object.values(content?.sections || {})) {
    if (!section || typeof section !== "object") continue;
    if (section.lead) yield section.lead;
    for (const key of ["secondary", "deepCuts", "articles"]) {
      if (Array.isArray(section[key])) yield* section[key];
    }
  }
}

module.exports = { runPipeline };
