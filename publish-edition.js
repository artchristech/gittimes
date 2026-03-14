require("dotenv").config();

const { fetchAllSections } = require("./src/github");
const { generateAllContent, generateEditorialContent } = require("./src/xai");
const { publish, getRecentRepoNames, getRecentLeadRepos, getRecentRepoCoverage, validateContent, readManifest } = require("./src/publish");
const { loadHistory, computeDeltas, snapshotHistory } = require("./src/history");
const { makeEditorialPlan } = require("./src/editorial");
const { sendNewsletter } = require("./src/newsletter");
const { getTickerData, getFullMarketData, renderTickerBanner, saveSnapshot } = require("./src/ai-ticker");
const { generateEditionPromo } = require("./src/promo");
const { closeDb } = require("./src/db");

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
  const recentRepoNames = getRecentRepoNames(outDir, 7);
  const recentLeadRepos = getRecentLeadRepos(outDir, 3);
  const recentRepoCoverage = getRecentRepoCoverage(outDir, 7);
  const manifest = readManifest(outDir);
  const recentEditionDates = manifest.slice(0, 7).map((e) => e.date);
  const sections = await fetchAllSections(githubToken, { recentRepoNames, recentLeadRepos, recentRepoCoverage, recentEditionDates });

  // Step 2: Editorial pipeline (with graceful fallback)
  const editorialEnabled = process.env.EDITORIAL !== "false";
  const rawCandidates = sections._rawCandidates || [];
  let content;

  if (editorialEnabled && rawCandidates.length > 0) {
    const history = loadHistory(outDir);
    const deltas = computeDeltas(rawCandidates, history);
    // Filter out recent lead repos from breakout candidates to prevent repeat front pages
    const editorialCandidates = rawCandidates.filter(
      (r) => !recentLeadRepos.has(r.full_name) && !recentRepoNames.has(r.full_name)
    );
    const editorialPlan = makeEditorialPlan(editorialCandidates, deltas);

    const hasEditorial = editorialPlan.breakout || editorialPlan.trends.length > 0 || editorialPlan.sleepers.length > 0;
    if (hasEditorial) {
      console.log("Editorial intelligence active:");
      if (editorialPlan.breakout) console.log(`  Breakout: ${editorialPlan.breakout.repo.full_name}`);
      if (editorialPlan.trends.length > 0) console.log(`  Trends: ${editorialPlan.trends.map((t) => t.theme).join(", ")}`);
      if (editorialPlan.sleepers.length > 0) console.log(`  Sleepers: ${editorialPlan.sleepers.map((s) => s.repo.full_name).join(", ")}`);
    }

    content = await generateEditorialContent(sections, xaiKey, editorialPlan, { githubToken, coverage: recentRepoCoverage });
  } else {
    content = await generateAllContent(sections, xaiKey, { coverage: recentRepoCoverage });
  }

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
    const manifest = readManifest(outDir);
    const latest = manifest[0];
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

  // Step 7: Generate promo video
  const promo = await generateEditionPromo(outDir);
  if (promo) {
    console.log(`Promo generated: ${promo.promoPath}`);
  }

  console.log("\nDone! Edition published.");
  closeDb();
}

main().catch((err) => {
  console.error("Publishing failed:", err.message);
  closeDb();
  process.exit(1);
});
