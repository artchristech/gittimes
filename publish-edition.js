require("dotenv").config();

const { execSync } = require("child_process");
const fs = require("fs");
const { runPipeline } = require("./src/pipeline");
const { publish, getRecentRepoNames, getRecentLeadRepos, getRecentRepoCoverage, validateContent, readManifest } = require("./src/publish");
const { snapshotHistory } = require("./src/history");
const { sendNewsletter } = require("./src/newsletter");
const { getTickerData, getFullMarketData, renderTickerBanner, saveSnapshot } = require("./src/ai-ticker");
const { generateEditionPromo } = require("./src/promo");
const { enrichRepo } = require("./src/github");
const { fetchStarTrajectory } = require("./src/star-history");
const { closeDb } = require("./src/db");

/**
 * Sync site/ from gh-pages branch so local runs have full edition history.
 * In CI, the workflow already checks out gh-pages into site/ before this runs.
 */
function syncSiteFromGhPages(outDir) {
  if (process.env.CI) return; // CI handles this via actions/checkout
  if (!/^[a-zA-Z0-9_.\-/]+$/.test(outDir)) {
    throw new Error(`Unsafe PUBLISH_DIR: ${outDir}`);
  }
  try {
    execSync("git fetch origin gh-pages", { stdio: "pipe" });
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    execSync(`git archive origin/gh-pages | tar -x -C "${outDir}"`, { stdio: "pipe" });
    console.log("Synced site/ from gh-pages branch");
  } catch {
    console.log("No gh-pages branch found, starting fresh");
  }
}

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
  syncSiteFromGhPages(outDir);

  const siteUrl = process.env.SITE_BASE_URL || "https://gittimes.com";
  const basePath = process.env.BASE_PATH || "";

  console.log("=== The Git Times Publisher ===\n");
  console.log(`Output: ${outDir}`);
  console.log(`Site URL: ${siteUrl}${basePath}\n`);

  // Step 1+2: Fetch, generate, dedup via shared pipeline
  const recentRepoNames = getRecentRepoNames(outDir, 7);
  const recentLeadRepos = getRecentLeadRepos(outDir, 3);
  const recentRepoCoverage = getRecentRepoCoverage(outDir, 7);
  const manifest = readManifest(outDir);
  const recentEditionDates = manifest.slice(0, 7).map((e) => e.date);

  const { content, rawCandidates } = await runPipeline(githubToken, xaiKey, {
    outDir,
    recentRepoNames,
    recentLeadRepos,
    recentRepoCoverage,
    recentEditionDates,
    coverage: recentRepoCoverage,
    enrichRepo,
    fetchStarTrajectory,
    filterEditorialCandidates: (candidates) =>
      candidates.filter((r) => !recentLeadRepos.has(r.full_name) && !recentRepoNames.has(r.full_name)),
  });

  // Step 2b: Fetch AI ticker data + full market catalog
  const tickerData = await getTickerData(outDir);
  const fullMarketData = getFullMarketData();
  const tickerHtml = renderTickerBanner(tickerData, { basePath });
  console.log(`AI ticker: ${tickerData.models.length} models, ${tickerData.speed.length} speed providers, ${tickerData.images.length} image models`);
  if (fullMarketData) console.log(`AI markets: ${fullMarketData.length} models in full catalog`);

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
  await publish(content, outDir, { siteUrl, basePath, tickerHtml, tickerData, fullMarketData });

  // Step 5: Snapshot history for editorial intelligence
  const editorialEnabled = process.env.EDITORIAL !== "false";
  if (editorialEnabled && rawCandidates.length > 0) {
    snapshotHistory(outDir, rawCandidates);
    console.log(`History snapshot saved (${rawCandidates.length} repos)`);
  }

  // Step 5b: Save AI ticker snapshot for tomorrow's deltas
  saveSnapshot(outDir, tickerData);
  console.log("AI ticker snapshot saved");

  // Step 6: Send newsletter
  const newsletterSecret = process.env.NEWSLETTER_SECRET;
  const chatWorkerUrl = process.env.CHAT_WORKER_URL;
  if (newsletterSecret && chatWorkerUrl) {
    const updatedManifest = readManifest(outDir);
    const latest = updatedManifest[0];
    if (latest) {
      const sent = await sendNewsletter({
        workerUrl: chatWorkerUrl,
        newsletterSecret,
        edition: {
          headline: latest.headline,
          subheadline: latest.subheadline || "",
          tagline: latest.tagline || "",
          date: latest.date,
          url: siteUrl + latest.url,
          repos: (latest.repos || []).slice(0, 8),
        },
      });
      console.log(`Newsletter sent to ${sent} subscribers`);
    }
  } else {
    console.log("Newsletter skipped (NEWSLETTER_SECRET or CHAT_WORKER_URL not set)");
  }

  // Step 7: Generate promo video (HTML + MP4)
  const promo = await generateEditionPromo(outDir);
  if (promo) {
    console.log(`Promo generated: ${promo.promoPath}`);
    // Record MP4 from the promo HTML
    try {
      const { execSync: exec } = require("child_process");
      console.log("Recording promo video...");
      exec(`node record-promo.js ${promo.dateStr} vertical`, {
        stdio: "inherit",
        env: { ...process.env, PUBLISH_DIR: outDir },
      });
    } catch (err) {
      console.warn(`Promo video recording failed (non-fatal): ${err.message}`);
    }
  }

  console.log("\nDone! Edition published.");
  closeDb();
}

main().catch((err) => {
  console.error("Publishing failed:", err.message);
  closeDb();
  process.exit(1);
});
