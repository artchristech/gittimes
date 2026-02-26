require("dotenv").config();

const { fetchAllSections } = require("./src/github");
const { generateAllContent } = require("./src/xai");
const { publish, getRecentRepoNames } = require("./src/publish");

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

  const outDir = process.env.PUBLISH_DIR || "./site";
  const siteUrl = process.env.SITE_BASE_URL || "https://christopherharris.github.io";
  const basePath = process.env.BASE_PATH || "/dagitnews";

  console.log("=== DAGitNews Publisher ===\n");
  console.log(`Output: ${outDir}`);
  console.log(`Site URL: ${siteUrl}${basePath}\n`);

  // Step 1: Fetch and enrich repo data from GitHub (all sections, with history dedup)
  const recentRepoNames = getRecentRepoNames(outDir, 3);
  const sections = await fetchAllSections(githubToken, { recentRepoNames });

  // Step 2: Generate articles via xAI Grok (all sections)
  const content = await generateAllContent(sections, xaiKey);

  // Step 3: Publish edition
  await publish(content, outDir, { siteUrl, basePath });

  console.log("\nDone! Edition published.");
}

main().catch((err) => {
  console.error("Publishing failed:", err.message);
  process.exit(1);
});
