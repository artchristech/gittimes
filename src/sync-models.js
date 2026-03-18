#!/usr/bin/env node
/**
 * Daily model sync: fetches current prices from OpenRouter,
 * merges with curated editorial config, and writes data/ai-models.json.
 *
 * Run: node src/sync-models.js
 * Intended to run daily via cron or CI, before publish-edition.js.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CURATED_PATH = path.join(DATA_DIR, "ai-models-curated.json");
const OUTPUT_PATH = path.join(DATA_DIR, "ai-models.json");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

/**
 * Fetch the full OpenRouter model catalog.
 */
async function fetchOpenRouter() {
  const res = await fetch(OPENROUTER_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
  const data = await res.json();
  if (!data.data || !Array.isArray(data.data)) throw new Error("Unexpected OpenRouter response shape");
  return data.data;
}

/**
 * Match a tracked model against the OpenRouter catalog.
 * Exact match first, then prefix match (but only if no exact match exists).
 */
function findModel(catalog, openrouterId) {
  const exact = catalog.find((m) => m.id === openrouterId);
  if (exact) return exact;
  return catalog.find((m) => m.id.startsWith(openrouterId + ":"));
}

/**
 * Detect notable models in the catalog that aren't being tracked.
 * Filters for high-output-price models from major providers.
 */
function detectUntracked(catalog, trackedIds) {
  const majorProviders = ["anthropic", "openai", "google", "x-ai", "deepseek", "meta-llama", "mistralai"];
  const tracked = new Set(trackedIds);

  return catalog
    .filter((m) => {
      if (!m.pricing || !m.id) return false;
      const provider = m.id.split("/")[0];
      if (!majorProviders.includes(provider)) return false;
      if (tracked.has(m.id)) return false;
      // Check if any tracked ID is a prefix of this model (already covered)
      for (const tid of tracked) {
        if (m.id.startsWith(tid)) return false;
      }
      const outputPrice = parseFloat(m.pricing.completion) * 1_000_000;
      return outputPrice > 1.0; // $1/M output threshold — frontier territory
    })
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      outputPrice: parseFloat(m.pricing.completion) * 1_000_000,
    }))
    .sort((a, b) => b.outputPrice - a.outputPrice)
    .slice(0, 10);
}

async function main() {
  // Load curated config
  if (!fs.existsSync(CURATED_PATH)) {
    console.error(`Missing curated config: ${CURATED_PATH}`);
    process.exit(1);
  }
  const curated = JSON.parse(fs.readFileSync(CURATED_PATH, "utf-8"));

  // Load existing output for fallback comparison
  let existing = null;
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
    } catch { /* ignore corrupt file */ }
  }

  let catalog;
  try {
    catalog = await fetchOpenRouter();
    console.log(`[sync-models] Fetched ${catalog.length} models from OpenRouter`);
  } catch (err) {
    console.error(`[sync-models] OpenRouter fetch failed: ${err.message}`);
    if (existing) {
      console.log("[sync-models] Keeping existing data/ai-models.json (stale but usable)");
      process.exit(0);
    }
    console.error("[sync-models] No existing data to fall back on, exiting with error");
    process.exit(1);
  }

  // Build model data
  const models = [];
  let matched = 0;
  let missed = 0;

  for (const tracked of curated.trackedModels) {
    const found = findModel(catalog, tracked.openrouterId);
    if (found && found.pricing) {
      const input = parseFloat(found.pricing.prompt) * 1_000_000;
      const output = parseFloat(found.pricing.completion) * 1_000_000;
      models.push({
        key: tracked.key,
        openrouterId: tracked.openrouterId,
        label: tracked.label,
        provider: tracked.provider,
        input: isNaN(input) ? null : input,
        output: isNaN(output) ? null : output,
        context_length: found.context_length || null,
        source: "openrouter",
      });
      matched++;
    } else {
      // Use previous sync's data if available, otherwise null prices
      const prev = existing?.models?.find((m) => m.key === tracked.key);
      models.push({
        key: tracked.key,
        openrouterId: tracked.openrouterId,
        label: tracked.label,
        provider: tracked.provider,
        input: prev?.input ?? null,
        output: prev?.output ?? null,
        context_length: prev?.context_length ?? null,
        source: prev ? "previous-sync" : "missing",
      });
      missed++;
      console.warn(`[sync-models] WARNING: ${tracked.label} (${tracked.openrouterId}) not found in OpenRouter catalog`);
    }
  }

  // Detect untracked frontier models
  const trackedIds = curated.trackedModels.map((t) => t.openrouterId);
  const untracked = detectUntracked(catalog, trackedIds);

  // Build output
  const output = {
    syncedAt: new Date().toISOString(),
    source: "openrouter",
    stats: { total: models.length, matched, missed },
    models,
    bannerKeys: curated.bannerKeys,
    speed: curated.speed,
    images: curated.images,
    untracked: untracked.length > 0 ? untracked : undefined,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[sync-models] Wrote ${OUTPUT_PATH}`);
  console.log(`[sync-models] ${matched} matched, ${missed} missed`);

  if (untracked.length > 0) {
    console.log(`[sync-models] ${untracked.length} untracked frontier models detected:`);
    for (const u of untracked) {
      console.log(`  - ${u.name} (${u.id}) $${u.outputPrice.toFixed(2)}/M output`);
    }
  }
}

main();
