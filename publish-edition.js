require("dotenv").config();

const { execSync, execFileSync } = require("child_process");
const fs = require("fs");
const { runPipeline } = require("./src/pipeline");
const { publish, getRecentRepoNames, getRecentLeadRepos, getRecentRepoCoverage, validateContent, readManifest } = require("./src/publish");
const { snapshotHistory } = require("./src/history");
const { buildLeadThreadContext } = require("./src/threads");
const { sendNewsletter } = require("./src/newsletter");
const { getTickerData, getFullMarketData, renderTickerBanner, saveSnapshot } = require("./src/ai-ticker");
const { fetchAIHeadlines, fetchArxiv } = require("./src/ai-headlines");
const { fetchModelDrops } = require("./src/model-drops");
const { fetchGitHubReleases } = require("./src/github-releases");
const { renderAIWire } = require("./src/render");
const { generateEditionPromo } = require("./src/promo");
const { writePromosPage } = require("./src/promos-page");
const { enrichRepo } = require("./src/github");
const { fetchStarTrajectory } = require("./src/star-history");
const { closeDb, recordEditionMeta, resolveDataDir } = require("./src/db");
const { resetMetrics, getMetrics } = require("./src/xai");

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
    const archive = execSync("git archive origin/gh-pages", { stdio: ["pipe", "pipe", "pipe"] });
    execFileSync("tar", ["-x", "-C", outDir], { input: archive, stdio: ["pipe", "pipe", "pipe"] });
    console.log("Synced site/ from gh-pages branch");
  } catch {
    console.log("No gh-pages branch found, starting fresh");
  }
}

async function main() {
  const githubToken = process.env.GITHUB_TOKEN;
  const llmKey = process.env.OPENROUTER_API_KEY;

  if (!githubToken) {
    console.error("Missing GITHUB_TOKEN in .env");
    process.exit(1);
  }
  if (!llmKey) {
    console.error("Missing OPENROUTER_API_KEY in .env");
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

  // Editorial memory: feed the last few front pages to the editor-in-chief so it
  // can pick genuine follow-ups and sustain narrative arcs. Fail-soft — an empty
  // or missing manifest yields no context and the lead prompt is unchanged.
  const { block: threadContext } = buildLeadThreadContext(manifest, { lookback: 3 });

  // Telemetry: reset the per-run token accumulator and start the wall clock.
  resetMetrics();
  const _genStartMs = Date.now();

  const { content, rawCandidates } = await runPipeline(githubToken, llmKey, {
    outDir,
    recentRepoNames,
    recentLeadRepos,
    recentRepoCoverage,
    recentEditionDates,
    threadContext,
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

  // Step 2c: Non-repo AI intake (the AI Wire) — the day's top AI stories from the
  // wider web, so the paper isn't blind to headlines that aren't trending repos.
  // The flow bands fetch alongside — Model Drops (the day's freshest model
  // releases from Hugging Face) and GitHub Releases (notable releases from
  // watched AI/dev-infra repos, trending or not). GT_DISABLE_MODEL_DROPS=1 /
  // GT_DISABLE_GH_RELEASES=1 kill them individually.
  const modelDropsOff = process.env.GT_DISABLE_MODEL_DROPS === "1";
  const ghReleasesOff = process.env.GT_DISABLE_GH_RELEASES === "1";
  const [aiHeadlines, arxivPapers, modelDrops, ghReleases] = await Promise.all([
    fetchAIHeadlines({ limit: 5 }),
    fetchArxiv({ limit: 3 }),
    modelDropsOff ? Promise.resolve([]) : fetchModelDrops({ limit: 6 }),
    ghReleasesOff ? Promise.resolve([]) : fetchGitHubReleases({ limit: 5, token: githubToken }),
  ]);
  const aiWireHtml = renderAIWire(aiHeadlines, { research: arxivPapers });

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
  await publish(content, outDir, {
    siteUrl,
    basePath,
    tickerHtml,
    tickerData,
    fullMarketData,
    aiWireHtml,
    aiWire: { headlines: aiHeadlines, research: arxivPapers },
    modelDrops,
    ghReleases,
  });

  // Step 4b: Record generation telemetry. Observational only and fully wrapped —
  // a failure here can never affect the edition, which is already on disk.
  try {
    const publishedDate = (readManifest(outDir)[0] || {}).date;
    if (publishedDate) {
      const m = getMetrics();
      const elapsedMs = Date.now() - _genStartMs;
      recordEditionMeta(resolveDataDir(outDir), {
        date: publishedDate,
        model: m.model,
        llmCalls: m.llmCalls,
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        totalTokens: m.totalTokens,
        elapsedMs,
        generatedAt: new Date().toISOString(),
      });
      console.log(
        `Telemetry: ${m.llmCalls} LLM calls, ${m.totalTokens} tokens, ${(elapsedMs / 1000).toFixed(1)}s (model=${m.model})`
      );
    }
  } catch (e) {
    console.warn(`Telemetry record skipped (non-fatal): ${e.message}`);
  }

  // Step 5: Snapshot history for editorial intelligence
  const editorialEnabled = process.env.EDITORIAL !== "false";
  if (editorialEnabled && rawCandidates.length > 0) {
    snapshotHistory(outDir, rawCandidates);
    console.log(`History snapshot saved (${rawCandidates.length} repos)`);
  }

  // Step 5b: Save AI ticker snapshot for tomorrow's deltas
  saveSnapshot(outDir, tickerData);
  console.log("AI ticker snapshot saved");

  // Step 6: Send newsletter (non-fatal — edition is already on disk)
  try {
    const newsletterSecret = process.env.NEWSLETTER_SECRET;
    const chatWorkerUrl = process.env.CHAT_WORKER_URL;
    // Explicit opt-out for a same-day republish (the worker /newsletter/send has
    // no per-date dedup, so a second publish would double-send). Gated on a plain
    // env flag, NOT a withheld secret — GitHub Actions `cond && '' || secret`
    // returns the secret when the middle operand is the falsy empty string.
    if (process.env.SKIP_NEWSLETTER === "true") {
      console.log("Newsletter skipped (SKIP_NEWSLETTER=true)");
    } else if (newsletterSecret && chatWorkerUrl) {
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
  } catch (err) {
    console.warn(`Newsletter send failed (non-fatal): ${err.message}`);
  }

  // Step 7: Generate promo video (HTML + MP4)
  const promo = await generateEditionPromo(outDir);
  if (promo) {
    console.log(`Promo generated: ${promo.promoPath}`);
    // Record MP4 from the promo HTML
    try {
      console.log("Recording promo video...");
      execFileSync("node", ["record-promo.js", promo.dateStr, "vertical"], {
        stdio: "inherit",
        env: { ...process.env, PUBLISH_DIR: outDir },
      });
    } catch (err) {
      console.warn(`Promo video recording failed (non-fatal): ${err.message}`);
    }
  }

  // Step 8: Rebuild the Promos gallery page (site/promos/index.html) so today's
  // freshly-rendered video is surfaced. Runs AFTER Step 7 by design; non-fatal.
  try {
    const { count } = writePromosPage(outDir, basePath);
    console.log(`Promos gallery rebuilt: ${count} video${count === 1 ? "" : "s"}`);
  } catch (err) {
    console.warn(`Promos gallery rebuild failed (non-fatal): ${err.message}`);
  }

  console.log("\nDone! Edition published.");
  closeDb();
}

main().catch((err) => {
  console.error("Publishing failed:", err.message);
  closeDb();
  process.exit(1);
});
