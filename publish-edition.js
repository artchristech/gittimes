require("dotenv").config();

const { fetchAllSections } = require("./src/github");
const { generateAllContent } = require("./src/xai");
const { publish, getRecentRepoNames, validateContent } = require("./src/publish");

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
  const siteUrl = process.env.SITE_BASE_URL || "https://gittimes.com";
  const basePath = process.env.BASE_PATH || "";

  console.log("=== The Git Times Publisher ===\n");
  console.log(`Output: ${outDir}`);
  console.log(`Site URL: ${siteUrl}${basePath}\n`);

  // Step 1: Fetch and enrich repo data from GitHub (all sections, with history dedup)
  const recentRepoNames = getRecentRepoNames(outDir, 3);
  const sections = await fetchAllSections(githubToken, { recentRepoNames });

  // Step 2: Generate articles via xAI Grok (all sections)
  const content = await generateAllContent(sections, xaiKey);

  // Step 3: Validate content
  const dryRun = process.argv.includes("--dry-run");
  const validation = validateContent(content);
  const s = validation.summary;

  console.log("\n--- Content Summary ---");
  console.log(`  Sections:  ${s.sections}`);
  console.log(`  Articles:  ${s.articles}`);
  console.log(`  Fallbacks: ${s.fallbacks}`);
  console.log(`  Empty:     ${s.emptyCount}`);

  if (validation.errors.length > 0) {
    console.error("\nValidation FAILED:");
    for (const err of validation.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log("\n--dry-run: skipping publish.");
    return;
  }

  // Step 4: Publish edition
  await publish(content, outDir, { siteUrl, basePath });

  console.log("\nDone! Edition published.");
}

main().catch((err) => {
  console.error("Publishing failed:", err.message);
  process.exit(1);
});
