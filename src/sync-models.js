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

function parseCachePrice(model) {
  const raw = model.pricing?.input_cache_read;
  if (!raw) return null;
  const val = parseFloat(raw) * 1_000_000;
  return isNaN(val) ? null : val;
}

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
 * Build a trimmed full-catalog snapshot of every priced model on OpenRouter.
 * Persisted into data/ai-models.json so the markets page "All Models by
 * Provider" section stays fresh daily WITHOUT a live fetch at publish time.
 * (Previously the catalog only existed in an in-memory cache populated during
 * a live fallback fetch, so a healthy sync left the live page's catalog empty.)
 */
function buildCatalog(catalog) {
  return catalog
    .filter((m) => m.pricing && parseFloat(m.pricing.prompt) > 0 && m.id)
    .map((m) => {
      const rawCache = m.pricing?.input_cache_read;
      const cacheVal = rawCache ? parseFloat(rawCache) * 1_000_000 : null;
      const desc = m.description ? String(m.description).slice(0, 160) : null;
      return {
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length || null,
        input: parseFloat(m.pricing.prompt) * 1_000_000,
        output: parseFloat(m.pricing.completion) * 1_000_000,
        cache_read_price: cacheVal != null && !isNaN(cacheVal) ? cacheVal : null,
        max_completion_tokens: m.top_provider?.max_completion_tokens || null,
        modality: m.architecture?.modality || null,
        input_modalities: m.architecture?.input_modalities || null,
        supported_parameters: m.supported_parameters || null,
        created: m.created || null,
        description: desc,
        hugging_face_id: m.hugging_face_id || null,
      };
    })
    .sort((a, b) => b.output - a.output);
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
      created: m.created || null,
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
        cache_read_price: parseCachePrice(found),
        max_completion_tokens: found.top_provider?.max_completion_tokens || null,
        modality: found.architecture?.modality || null,
        input_modalities: found.architecture?.input_modalities || null,
        supported_parameters: found.supported_parameters || null,
        description: found.description || null,
        created: found.created || null,
        expiration_date: found.expiration_date || null,
        hugging_face_id: found.hugging_face_id || null,
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
        cache_read_price: prev?.cache_read_price ?? null,
        max_completion_tokens: prev?.max_completion_tokens ?? null,
        modality: prev?.modality ?? null,
        input_modalities: prev?.input_modalities ?? null,
        supported_parameters: prev?.supported_parameters ?? null,
        description: prev?.description ?? null,
        created: prev?.created ?? null,
        expiration_date: prev?.expiration_date ?? null,
        hugging_face_id: prev?.hugging_face_id ?? null,
        source: prev ? "previous-sync" : "missing",
      });
      missed++;
      console.warn(`[sync-models] WARNING: ${tracked.label} (${tracked.openrouterId}) not found in OpenRouter catalog`);
    }
  }

  // Detect untracked frontier models
  const trackedIds = curated.trackedModels.map((t) => t.openrouterId);
  const untracked = detectUntracked(catalog, trackedIds);

  // Persist the full priced catalog so the markets page renders it every day
  const fullCatalog = buildCatalog(catalog);

  // Build output
  const output = {
    syncedAt: new Date().toISOString(),
    source: "openrouter",
    stats: { total: models.length, matched, missed, catalog: fullCatalog.length },
    models,
    bannerKeys: curated.bannerKeys,
    speed: curated.speed,
    images: curated.images,
    evals: curated.evals,
    untracked: untracked.length > 0 ? untracked : undefined,
    catalog: fullCatalog,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[sync-models] Wrote ${OUTPUT_PATH}`);
  console.log(`[sync-models] ${matched} matched, ${missed} missed, ${fullCatalog.length} in full catalog`);

  if (untracked.length > 0) {
    console.log(`[sync-models] ${untracked.length} untracked frontier models detected:`);
    for (const u of untracked) {
      console.log(`  - ${u.name} (${u.id}) $${u.outputPrice.toFixed(2)}/M output`);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildCatalog, detectUntracked, findModel };
