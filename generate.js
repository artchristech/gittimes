require("dotenv").config();

const { fetchAllSections } = require("./src/github");
const { generateAllContent } = require("./src/xai");
const { render } = require("./src/render");

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

  console.log("=== DAGitNews Generator ===\n");

  // Step 1: Fetch and enrich repo data from GitHub (all sections)
  const sections = await fetchAllSections(githubToken);

  // Step 2: Generate articles via xAI Grok (all sections)
  const content = await generateAllContent(sections, xaiKey);

  // Step 3: Render to static HTML
  const outputPath = await render(content);

  console.log("\nDone! Open the file in your browser to view the newspaper.");
}

main().catch((err) => {
  console.error("Generation failed:", err.message);
  process.exit(1);
});
