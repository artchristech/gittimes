require("dotenv").config();

const { fetchAllSections } = require("./src/github");
const { generateAllContent, generateEditorialContent } = require("./src/xai");
const { render } = require("./src/render");
const { loadHistory, computeDeltas } = require("./src/history");
const { makeEditorialPlan } = require("./src/editorial");

async function main() {
  const githubToken = process.env.GITHUB_TOKEN;
  const xaiKey = process.env.XAI_API_KEY;

  if (!githubToken) {
    console.error("Missing GITHUB_TOKEN in .env");
    process.exit(1);
  }
  if (!xaiKey) {
    console.error("Missing XAI_API_KEY in .env");
    process.exit(1);
  }

  console.log("=== The Git Times Generator ===\n");

  // Step 1: Fetch and enrich repo data from GitHub (all sections)
  const sections = await fetchAllSections(githubToken);

  // Step 2: Editorial pipeline (with graceful fallback)
  const editorialEnabled = process.env.EDITORIAL !== "false";
  const rawCandidates = sections._rawCandidates || [];
  let content;

  if (editorialEnabled && rawCandidates.length > 0) {
    const outDir = process.env.PUBLISH_DIR || "./site";
    const history = loadHistory(outDir);
    const deltas = computeDeltas(rawCandidates, history);
    const editorialPlan = makeEditorialPlan(rawCandidates, deltas);

    const hasEditorial = editorialPlan.breakout || editorialPlan.trends.length > 0 || editorialPlan.sleepers.length > 0;
    if (hasEditorial) {
      console.log("Editorial intelligence active:");
      if (editorialPlan.breakout) console.log(`  Breakout: ${editorialPlan.breakout.repo.full_name}`);
      if (editorialPlan.trends.length > 0) console.log(`  Trends: ${editorialPlan.trends.map((t) => t.theme).join(", ")}`);
      if (editorialPlan.sleepers.length > 0) console.log(`  Sleepers: ${editorialPlan.sleepers.map((s) => s.repo.full_name).join(", ")}`);
    }

    content = await generateEditorialContent(sections, xaiKey, editorialPlan);
  } else {
    content = await generateAllContent(sections, xaiKey);
  }

  // Step 3: Render to static HTML
  const outputPath = await render(content);

  console.log("\nDone! Open the file in your browser to view the newspaper.");
}

main().catch((err) => {
  console.error("Generation failed:", err.message);
  process.exit(1);
});
