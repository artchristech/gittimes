/**
 * Shared generation pipeline used by both generate.js and publish-edition.js.
 * Encapsulates: fetch → editorial → generate → dedup.
 */
const { fetchAllSections } = require("./github");
const { generateAllContent, generateEditorialContent, deduplicateContent } = require("./xai");
const { loadHistory, computeDeltas } = require("./history");
const { makeEditorialPlan } = require("./editorial");
const { fetchXSentimentForRepo } = require("./x-sentiment");

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

    const editorialOpts = { githubToken, coverage, fetchXSentimentForRepo };
    if (options.enrichRepo) editorialOpts.enrichRepo = options.enrichRepo;
    if (options.fetchStarTrajectory) editorialOpts.fetchStarTrajectory = options.fetchStarTrajectory;

    content = await generateEditorialContent(sections, xaiKey, editorialPlan, editorialOpts);
  } else {
    content = await generateAllContent(sections, xaiKey, { coverage, fetchXSentimentForRepo });
  }

  // Step 3: Dedup
  deduplicateContent(content);

  return { content, rawCandidates };
}

module.exports = { runPipeline };
