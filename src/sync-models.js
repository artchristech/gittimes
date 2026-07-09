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
const ROSTER_PATH = path.join(DATA_DIR, "banner-roster.json");
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
    // Rank by recency, not price: the radar should surface NEW frontier models,
    // not ancient-but-expensive legacy ones (o1-pro $600, gpt-4 $60).
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .slice(0, 10);
}

/**
 * Build the tracked-model price rows from the OpenRouter catalog, the curated
 * config, and the previous sync's output. Pure + network-independent: it never
 * fetches — pass in the catalog array (may be empty) and it computes from that.
 *
 * Price precedence for each tracked model:
 *   live OpenRouter price → previous-sync price → curated editorial seed → null
 *
 * The curated seed is an optional numeric `input`/`output` on a trackedModels
 * entry. It lets editorially-added models that are not yet on OpenRouter still
 * render with a price, but it NEVER overrides a real live or previous-sync price.
 *
 * @returns {{ models: object[], matched: number, missed: number }}
 */
function buildTrackedModels(catalog, curated, existing) {
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
      // Not in the live catalog. Carry forward the previous sync's price; if none,
      // fall back to the curated editorial seed. Precedence honored via ?? chain:
      // previous-sync price → curated seed → null (live already handled above).
      const prev = existing?.models?.find((m) => m.key === tracked.key);
      const seedInput = typeof tracked.input === "number" ? tracked.input : null;
      const seedOutput = typeof tracked.output === "number" ? tracked.output : null;
      const input = prev?.input ?? seedInput ?? null;
      const output = prev?.output ?? seedOutput ?? null;

      let source;
      if (prev && (prev.input != null || prev.output != null)) source = "previous-sync";
      else if (seedInput != null || seedOutput != null) source = "curated-seed";
      else source = "missing";

      models.push({
        key: tracked.key,
        openrouterId: tracked.openrouterId,
        label: tracked.label,
        provider: tracked.provider,
        input,
        output,
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
        source,
      });
      missed++;
      const note = source === "previous-sync" ? "using previous price"
        : source === "curated-seed" ? "using curated seed price"
        : "no price available";
      console.warn(`[sync-models] WARNING: ${tracked.label} (${tracked.openrouterId}) not found in OpenRouter catalog — ${note}`);
    }
  }

  return { models, matched, missed };
}

/** Provider display names for synthesized (auto-resolved) banner-slot models. */
const PROVIDER_NAMES = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "x-ai": "xAI",
  deepseek: "DeepSeek",
  qwen: "Alibaba",
  moonshotai: "Moonshot",
  "meta-llama": "Meta",
  mistralai: "Mistral",
};

/**
 * Derive a fresh display label from a catalog model: strip a leading
 * "Provider: " off its `name`, else fall back to the id's last path segment.
 * Must reflect the RESOLVED version (e.g. "Grok 4.3", not a frozen "Grok 4.20").
 */
function slotLabel(model) {
  const name = typeof model.name === "string" ? model.name.trim() : "";
  if (name) {
    const stripped = name.includes(":") ? name.slice(name.indexOf(":") + 1).trim() : name;
    if (stripped) return stripped;
  }
  const seg = String(model.id).split("/").pop();
  return seg || String(model.id);
}

/**
 * Resolve editorial "banner slots" against the live OpenRouter catalog so the
 * front-page roster auto-tracks the newest flagship per provider/family.
 *
 * Each slot = { label, match, exclude?, pin? }:
 *   - match:   id PREFIX a candidate id must start with (e.g. "x-ai/grok-").
 *   - exclude: substrings that DISQUALIFY a candidate id (dev stubs / side
 *              variants, e.g. "-build", "-mini", "-image").
 *   - pin:     exact id that forces the winner (editorial override).
 * Selection = among catalog models whose id starts with `match` and contains
 * none of `exclude`, pick the one with the greatest `created`; `pin` overrides.
 *
 * Pure + total: never fetches, never throws. Slots that resolve to nothing
 * (empty catalog, no match, unresolvable pin) are omitted from the result.
 * Missing `created` counts as 0; missing/NaN pricing yields a null price.
 *
 * @param {object[]} catalog - OpenRouter model objects ({id, name, created, pricing, context_length}).
 * @param {object[]} slots   - ordered banner slot specs.
 * @param {object[]} [trackedModels] - curated tracked models, for key reuse.
 * @returns {object[]} resolved models in slot order:
 *   { key, label, openrouterId, provider, input, output, context_length, created, source }
 */
function resolveBannerSlots(catalog, slots, trackedModels = []) {
  if (!Array.isArray(catalog) || !Array.isArray(slots)) return [];

  const trackedByOrId = new Map();
  for (const t of Array.isArray(trackedModels) ? trackedModels : []) {
    if (t && t.openrouterId) trackedByOrId.set(t.openrouterId, t);
  }

  const resolved = [];
  for (const slot of slots) {
    if (!slot || typeof slot.match !== "string") continue;
    const exclude = Array.isArray(slot.exclude) ? slot.exclude : [];

    let winner = null;
    if (slot.pin) {
      // A pin is a hard editorial override: honor it exactly, or omit the slot.
      // No fallback to auto-latest — "pin forces an exact id".
      winner = catalog.find((m) => m && m.id === slot.pin) || null;
    } else {
      for (const m of catalog) {
        if (!m || typeof m.id !== "string") continue;
        if (!m.id.startsWith(slot.match)) continue;
        if (exclude.some((ex) => ex && m.id.includes(ex))) continue;
        if (winner == null || (m.created || 0) > (winner.created || 0)) winner = m;
      }
    }
    if (!winner) continue; // empty/no-match/unresolvable-pin slot: omit gracefully, never throw

    const prompt = winner.pricing ? parseFloat(winner.pricing.prompt) : NaN;
    const completion = winner.pricing ? parseFloat(winner.pricing.completion) : NaN;
    const input = isNaN(prompt) ? null : prompt * 1_000_000;
    const output = isNaN(completion) ? null : completion * 1_000_000;

    const tracked = trackedByOrId.get(winner.id);
    const key = tracked ? tracked.key : String(winner.id).replace(/[/.:]+/g, "-");
    const providerSlug = String(winner.id).split("/")[0];

    resolved.push({
      key,
      label: slotLabel(winner),
      openrouterId: winner.id,
      provider: PROVIDER_NAMES[providerSlug] || providerSlug,
      input,
      output,
      context_length: winner.context_length || null,
      created: winner.created || null,
      source: "banner-slot",
    });
  }
  return resolved;
}

/**
 * Apply editorial banner slots on top of the tracked-model rows. Pure + total.
 *
 * With no slots (absent/empty `curated.bannerSlots`) this is a no-op: it returns
 * the models untouched and `bannerKeys = curated.bannerKeys` — i.e. exactly the
 * pre-slots behavior (backward compatible).
 *
 * With slots, it resolves each against the catalog, APPENDS resolved rows into
 * `models` (dedup by key — existing enriched tracked rows win), and returns
 * `bannerKeys` = resolved keys in slot order. This closes the render coupling:
 * every banner key is present in `models[]`, so the ticker can render it.
 *
 * @returns {{ models: object[], bannerKeys: string[] }}
 */
function applyBannerSlots(models, catalog, curated) {
  const slots = Array.isArray(curated.bannerSlots) ? curated.bannerSlots : [];
  if (slots.length === 0) {
    return { models, bannerKeys: curated.bannerKeys };
  }

  const resolved = resolveBannerSlots(catalog, slots, curated.trackedModels);
  const present = new Set(models.map((m) => m.key));
  for (const r of resolved) {
    if (present.has(r.key)) continue; // keep the richer tracked row if key already present
    models.push({
      key: r.key,
      openrouterId: r.openrouterId,
      label: r.label,
      provider: r.provider,
      input: r.input,
      output: r.output,
      context_length: r.context_length,
      cache_read_price: null,
      max_completion_tokens: null,
      modality: null,
      input_modalities: null,
      supported_parameters: null,
      description: null,
      created: r.created,
      expiration_date: null,
      hugging_face_id: null,
      source: r.source,
    });
    present.add(r.key);
  }
  return { models, bannerKeys: resolved.map((r) => r.key) };
}

/**
 * Build the "Banner Roster" easy-check: a human-readable per-slot report + a
 * compact diffable record set, derived from the editorial banner slots and the
 * live catalog. Pure + total: never fetches, never throws.
 *
 * Resolution mirrors resolveBannerSlots (newest-by-`created` within match∖exclude,
 * `pin` hard-override) and additionally names the runner-up each winner beat, so
 * the desk can confirm at a glance what the roster picked and why.
 *
 * Warnings surface two failure modes the desk cares about:
 *   - no-match slot (empty catalog / bad match / unresolvable pin) → "⚠️ … no catalog match".
 *   - `expect` miss: the slot carries an optional `expect` substring the resolved id
 *     lacks → "⚠️ … expected X, got Y" (this is how "known launch not in catalog yet" surfaces).
 *
 * @param {object[]} slots   - editorial banner slot specs ({label, match, exclude?, pin?, expect?}).
 * @param {object[]} catalog - OpenRouter model objects.
 * @returns {{ lines: string[], records: {slot:string,id:string,created:number|null,price:number|null}[], warnings: string[] }}
 */
function buildBannerRoster(slots, catalog) {
  const lines = [];
  const records = [];
  const warnings = [];
  const cat = Array.isArray(catalog) ? catalog : [];

  for (const slot of Array.isArray(slots) ? slots : []) {
    if (!slot || typeof slot.match !== "string") continue;
    const label = slot.label || slot.match;

    // Resolve winner (+ runner-up) exactly as resolveBannerSlots would.
    let winner;
    let runnerUp = null;
    if (slot.pin) {
      winner = cat.find((m) => m && m.id === slot.pin) || null;
    } else {
      const exclude = Array.isArray(slot.exclude) ? slot.exclude : [];
      const cands = cat
        .filter((m) => m && typeof m.id === "string" && m.id.startsWith(slot.match)
          && !exclude.some((ex) => ex && m.id.includes(ex)))
        .sort((a, b) => (b.created || 0) - (a.created || 0));
      winner = cands[0] || null;
      runnerUp = cands[1] || null;
    }

    if (!winner) {
      const w = `  ⚠️  ${label}: no catalog match for "${slot.match}"` +
        (slot.pin ? ` (pin "${slot.pin}" absent)` : "");
      lines.push(w);
      warnings.push(w.trim());
      continue;
    }

    const priceNum = winner.pricing ? parseFloat(winner.pricing.completion) * 1_000_000 : NaN;
    const price = isNaN(priceNum) ? null : priceNum;
    const created = winner.created || null;
    const date = created ? new Date(created * 1000).toISOString().slice(0, 10) : "unknown";
    const priceStr = price != null ? `$${price.toFixed(2)}/M` : "$—/M";
    const beat = runnerUp ? ` [beat: ${runnerUp.id}]` : "";
    lines.push(`  ${label} → ${winner.id} (${date}) ${priceStr}${beat}`);
    records.push({ slot: label, id: winner.id, created, price });

    // Optional editorial tripwire: warn when the catalog lags a known launch.
    if (slot.expect && !String(winner.id).includes(slot.expect)) {
      const w = `  ⚠️  ${label}: expected "${slot.expect}", got ${winner.id}`;
      lines.push(w);
      warnings.push(w.trim());
    }
  }
  return { lines, records, warnings };
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

  // Build the tracked-model price rows (the curated set). This is the SOLE source
  // of `output.models` — the markets table and the Cost-of-Intelligence index both
  // read `models`, so the auto-latest banner roster must NOT be mixed in here.
  const { models, matched, missed } = buildTrackedModels(catalog, curated, existing);

  // Resolve editorial banner slots into a SEPARATE auto-latest roster consumed by
  // the front-page banner ONLY (via output.bannerModels). Pure + total: empty/absent
  // bannerSlots yields []. Deliberately NOT appended to `models` (isolation).
  const bannerSlots = Array.isArray(curated.bannerSlots) ? curated.bannerSlots : [];
  const bannerModels = resolveBannerSlots(catalog, bannerSlots, curated.trackedModels);

  // Detect untracked frontier models
  const trackedIds = curated.trackedModels.map((t) => t.openrouterId);
  const untracked = detectUntracked(catalog, trackedIds);

  // Persist the full priced catalog so the markets page renders it every day
  const fullCatalog = buildCatalog(catalog);

  // Build output
  const output = {
    syncedAt: new Date().toISOString(),
    source: "openrouter",
    stats: { total: models.length, matched, missed, catalog: fullCatalog.length, bannerSlots: bannerModels.length },
    models,
    bannerModels,
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

  // --- Easy check: Banner Roster report + diffable data/banner-roster.json ------
  // Prints per-slot "label → id (date) $price [beat: runner-up]" so the desk can
  // confirm the auto-latest roster, and writes a compact record set so roster
  // changes show up in the daily sync commit diff.
  const roster = buildBannerRoster(bannerSlots, catalog);
  fs.writeFileSync(ROSTER_PATH, JSON.stringify(roster.records, null, 2));
  console.log(`\n[sync-models] Banner Roster (${roster.records.length} of ${bannerSlots.length} slots resolved) — wrote ${ROSTER_PATH}`);
  for (const line of roster.lines) console.log(line);
  if (roster.warnings.length > 0) {
    console.log(`[sync-models] ${roster.warnings.length} roster warning(s) above — the catalog may lag a known launch.`);
  }

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

module.exports = { buildCatalog, detectUntracked, findModel, buildTrackedModels, resolveBannerSlots, applyBannerSlots, buildBannerRoster };
