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
 * Stamp curated promotional-pricing overrides onto catalog rows.
 *
 * OpenRouter reports the price being charged today; it does not say whether
 * that price is introductory. From a single snapshot a promo expiry and a
 * genuine price rise are indistinguishable, so the list price has to be on
 * record before the promo lapses. There is no feed for this — `promos` in
 * ai-models-curated.json is hand-maintained, same as the rest of that file.
 *
 * @param {object[]} catalogRows - buildCatalog() output
 * @param {object} [promos] - keyed by OpenRouter id: {ends, list_input, list_output, source}
 * @returns {object[]} new rows, promo fields applied
 */
function applyPromos(catalogRows, promos) {
  if (!promos || typeof promos !== "object") return catalogRows;
  return catalogRows.map((m) => {
    const p = promos[m.id];
    if (!p) return m;
    return {
      ...m,
      is_promotional: 1,
      promo_ends_on: p.ends || "",
      list_input: typeof p.list_input === "number" ? p.list_input : null,
      list_output: typeof p.list_output === "number" ? p.list_output : null,
      source_url: p.source || "",
    };
  });
}

// --- The Radar --------------------------------------------------------------
//
// WHAT THIS DESK IS FOR. The Radar is the paper's only intake for a model that
// arrives as an ENDPOINT rather than as an artifact: no weights on Hugging
// Face, no GitHub release, nothing for the trending funnel to catch. Every
// other surface needs either a public artifact (the model-drops band reads HF,
// the front page reads GitHub) or a hand-written roster entry (the ticker and
// the Price Board read the curated twelve). This one reads the raw catalog, so
// it is the only place a launch nobody put a repo behind can show up at all.
//
// WHY IT WAS REBUILT (2026-08-24). The first version asked two questions that
// were both really the same question — "is this a big lab charging a lot?":
//   1. an allowlist of seven provider prefixes, and
//   2. output price > $1/M, commented "frontier territory".
// Ox Alpha — 1M context, multimodal in, tool calling, listed 2026-08-20 in an
// anonymous `stealth/` namespace at $0 — failed both gates, and the paper sat
// silent through the month's biggest model story while the wires ran it.
//
// The lesson generalises past that one model. PROVENANCE and PRICE are exactly
// the two things a stealth launch withholds; gating on either guarantees the
// desk is blind to the launches most worth covering. CAPABILITY cannot be
// withheld — it is published in the listing, because it is what the endpoint is
// FOR. So capability is the gate, and price is a CLASSIFICATION instead of a
// filter: a frontier-spec model listed at zero is not a non-event to discard,
// it is the loudest pricing signal this market produces. That is the same read
// the Price Board takes on a cut — "a price cut is strategy made public" — and
// zero is the limit case of a cut.
//
// WHAT IT STILL WON'T DO. Qualifying for the Radar is not a claim that a model
// is good, or that the anonymous operator is who the forums think. It says the
// listing carries frontier specs and the desk is not tracking it. Naming the
// lab behind a stealth model is a reporting job, not a filter's job.

// TWO LANES, and the distinction is the whole design.
//
// The EVENT lane is what the old radar had no concept of: something HAPPENED to
// this listing — it arrived, or it is being given away. That is news on the day
// it is true, and it is the lane Ox Alpha needed. Its floor is deliberately low
// and absolute, because the event carries the newsworthiness and the floor only
// has to exclude toys.
//
// The STANDING lane is the old radar's job, kept: an untracked model that is an
// outlier on capability is a gap in the roster whether or not anything happened
// today. Its threshold is RELATIVE to the live catalog, because that is exactly
// what rotted last time — "$1/M output = frontier territory" was true when it
// was written and admitted 256 of 395 models by the time it failed. A percentile
// re-reads the market every morning and cannot go stale in the same way.
//
// This is the same STOCK-vs-FLOW correction the front page already made: rank by
// what shipped, backfill with what's merely big.
const EVENT_MIN_CONTEXT = 200_000;
const EVENT_MIN_OUTPUT_PRICE = 1.0;
const STANDING_PERCENTILE = 0.9;
// How long a listing counts as "new". A week is the reporting window for "this
// appeared and nobody has explained it yet".
const NEW_LISTING_DAYS = 7;
const RADAR_LIMIT = 10;

function perMillion(raw) {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n * 1_000_000 : null;
}

/** Does the listing accept anything other than text in? */
function acceptsNonTextInput(model) {
  const mods = model.architecture?.input_modalities;
  if (!Array.isArray(mods)) return false;
  return mods.some((mod) => String(mod).toLowerCase() !== "text");
}

/** Does the listing advertise function/tool calling? */
function supportsToolCalling(model) {
  const params = model.supported_parameters;
  if (!Array.isArray(params)) return false;
  return params.some((p) => /^(tools|tool_choice)$/i.test(String(p)));
}

function formatContextLabel(ctx) {
  if (ctx >= 1_000_000) {
    const m = ctx / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M context`.replace(".0M", "M");
  }
  return `${Math.round(ctx / 1000)}k context`;
}

/**
 * The first date THIS PAPER saw each catalogued id, carried forward across
 * syncs in data/ai-models.json.
 *
 * Why keep our own record when OpenRouter ships a `created` timestamp: the two
 * answer different questions. `created` is upstream's listing date and is the
 * right basis for "is this new"; `firstSeenOn` is what the paper can actually
 * attest to, and the house rule is no number without a record behind it. When
 * they disagree — a backdated listing, a sync outage — the honest sentence is
 * "listed the 20th, we first saw it the 24th", which needs both.
 *
 * BOOTSTRAP. On the first run after this shipped there is no prior map, so
 * every id would otherwise date to that day and read as 395 simultaneous
 * arrivals. `bootstrapped: true` says the map was seeded wholesale and no
 * first-seen date in it is evidence of anything yet.
 *
 * Entries for delisted ids are KEPT, not pruned: a model that drops out of one
 * fetch and returns must not come back with its history reset to "new today".
 * Growth is bounded by the size of the catalog over time (hundreds a year).
 *
 * Pure. @returns {{firstSeen: object, bootstrapped: boolean, added: string[]}}
 */
function buildFirstSeen(catalog, previous, today) {
  const prior = previous && typeof previous === "object" ? previous : null;
  const firstSeen = { ...(prior || {}) };
  const bootstrapped = !prior || Object.keys(prior).length === 0;
  const added = [];
  for (const m of catalog) {
    if (!m || !m.id) continue;
    if (firstSeen[m.id]) continue;
    firstSeen[m.id] = today;
    if (!bootstrapped) added.push(m.id);
  }
  return { firstSeen, bootstrapped, added };
}

/**
 * The value at `p` through a sorted numeric series. Nearest-rank, so it always
 * returns a value that is actually in the data rather than an interpolation
 * between two real listings.
 */
function percentile(values, p) {
  const sorted = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return Infinity;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * The STANDING lane's bar, read off today's catalog rather than hardcoded.
 * Exported so the desk can check what the market currently considers unusual.
 * @returns {{context: number, outputPrice: number}}
 */
function catalogThresholds(catalog) {
  const rows = Array.isArray(catalog) ? catalog.filter(Boolean) : [];
  return {
    context: percentile(rows.map((m) => m.context_length || 0), STANDING_PERCENTILE),
    outputPrice: percentile(rows.map((m) => (m.pricing ? perMillion(m.pricing.completion) : null)), STANDING_PERCENTILE),
  };
}

/**
 * Detect frontier-class models in the catalog the desk isn't tracking.
 *
 * @param {object[]} catalog - raw OpenRouter /models rows
 * @param {string[]} trackedIds - curated openrouterIds already on the roster
 * @param {object} [options]
 * @param {object} [options.firstSeen] - id → YYYY-MM-DD, from buildFirstSeen
 * @param {string[]|Set} [options.arrivals] - ids that appeared to us this run,
 *   from buildFirstSeen's `added`. Empty on a bootstrapped ledger, which is the
 *   point: seeding the ledger is not 395 simultaneous arrivals.
 * @param {number} [options.nowMs] - clock injection for tests
 * @returns {object[]} radar entries, most newsworthy first
 */
function detectUntracked(catalog, trackedIds, options = {}) {
  const { firstSeen = {}, arrivals = [], nowMs = Date.now() } = options;
  const tracked = new Set(trackedIds || []);
  const arrived = arrivals instanceof Set ? arrivals : new Set(arrivals);
  const rows = Array.isArray(catalog) ? catalog : [];
  const bar = catalogThresholds(rows);

  const covered = (id) => {
    if (tracked.has(id)) return true;
    // A tracked id is a prefix of this one (e.g. the `:thinking` variant of a
    // model already on the roster) — same product, already on the board.
    for (const tid of tracked) {
      if (id.startsWith(tid)) return true;
    }
    return false;
  };

  const entries = [];
  for (const m of rows) {
    if (!m || !m.id || !m.pricing) continue;
    if (covered(m.id)) continue;

    const outputPrice = perMillion(m.pricing.completion);
    const inputPrice = perMillion(m.pricing.prompt);
    const contextLength = m.context_length || 0;

    // --- What it can do. Provenance-blind by construction: nothing here reads
    // the namespace, because the namespace is the one thing a stealth launch
    // gets to choose freely.
    const capabilities = [];
    if (contextLength >= EVENT_MIN_CONTEXT) capabilities.push(formatContextLabel(contextLength));
    if (supportsToolCalling(m) && acceptsNonTextInput(m)) capabilities.push("multimodal + tool calling");
    if (outputPrice != null && outputPrice > EVENT_MIN_OUTPUT_PRICE) capabilities.push("premium priced");

    // --- What happened to it. Free is a CLASSIFICATION, never a rejection: a
    // frontier-spec listing at zero is the loudest pricing signal this market
    // produces, which is the same read the Price Board takes on a cut.
    const free = outputPrice === 0 && inputPrice === 0;
    const ageDays = m.created ? (nowMs - m.created * 1000) / 86400000 : Infinity;
    // Two independent claims to newness, because they fail in different ways:
    // upstream's listing date can be backdated or absent, and our own ledger
    // can't see anything that predates it. Either one is enough.
    const newlyListed = ageDays >= 0 && ageDays <= NEW_LISTING_DAYS;
    const isNew = newlyListed || arrived.has(m.id);

    // The relative bar sits on top of the absolute floor, never below it. Two
    // reasons: a percentile taken over a handful of rows (a truncated fetch, a
    // test fixture) would otherwise crown whatever it was handed, and an
    // "outlier" that can't clear the toy floor isn't one in any useful sense.
    const standing =
      contextLength >= Math.max(bar.context, EVENT_MIN_CONTEXT) ||
      (outputPrice != null && outputPrice > Math.max(bar.outputPrice, EVENT_MIN_OUTPUT_PRICE));

    // EVENT lane needs a capability floor AND something to have happened;
    // STANDING lane needs to be an outlier on today's catalog. Either admits.
    if (!((capabilities.length > 0 && (isNew || free)) || standing)) continue;

    // Every admitted row has at least one capability signal: the event lane
    // requires one outright, and the standing lane's floor is the same pair of
    // thresholds the capability list is built from.
    const signals = [...capabilities];
    if (free) signals.unshift("free");
    if (isNew) signals.push("new listing");

    entries.push({
      id: m.id,
      name: m.name || m.id,
      outputPrice,
      inputPrice,
      contextLength: contextLength || null,
      created: m.created || null,
      free,
      isNew,
      firstSeenOn: firstSeen[m.id] || null,
      signals,
    });
  }

  // Rank by newsworthiness, not by price. A free frontier listing outranks an
  // expensive one; an arrival outranks a standing gap; ties break on recency so
  // the radar re-sorts as the catalog moves rather than pinning a favourite at
  // the top for weeks — the same freshness-decay lesson the model-drops band
  // learned when its most-liked row sat frozen for days.
  return entries
    .sort((a, b) => {
      const rank = (e) => (e.free ? 2 : 0) + (e.isNew ? 1 : 0);
      return rank(b) - rank(a) || (b.created || 0) - (a.created || 0) || a.id.localeCompare(b.id);
    })
    .slice(0, RADAR_LIMIT);
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

  // The Radar. Two steps: carry forward the first-seen ledger (so a new arrival
  // has a date the paper can stand behind), then read the catalog through the
  // capability gate. Both are pure — the fetch already happened above.
  const today = new Date().toISOString().slice(0, 10);
  const { firstSeen, bootstrapped, added } = buildFirstSeen(catalog, existing && existing.catalogFirstSeen, today);
  const trackedIds = curated.trackedModels.map((t) => t.openrouterId);
  const untracked = detectUntracked(catalog, trackedIds, { firstSeen, arrivals: added });

  // Persist the full priced catalog so the markets page renders it every day
  const fullCatalog = applyPromos(buildCatalog(catalog), curated.promos);

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
    // The Radar's own record of when each listing first appeared to us. Written
    // every sync so `firstSeenOn` means something on the next one.
    catalogFirstSeen: firstSeen,
    catalog: fullCatalog,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[sync-models] Wrote ${OUTPUT_PATH}`);
  console.log(`[sync-models] ${matched} matched, ${missed} missed, ${fullCatalog.length} in full catalog`);

  // Append today's row to the price tape. ai-models.json is a full overwrite —
  // it only ever knows today — so without this the series can never be
  // reconstructed. Nothing renders it yet; it accrues from the day it ships.
  // Non-fatal: a broken tape must never take down the daily sync.
  try {
    const { saveModelPrices } = require("./db");
    const n = saveModelPrices(DATA_DIR, today, fullCatalog);
    const promoCount = fullCatalog.filter((m) => m.is_promotional).length;
    console.log(`[sync-models] Price tape: ${n} rows for ${today} (${promoCount} promotional)`);
  } catch (e) {
    console.warn(`[sync-models] Price tape write failed (non-fatal): ${e.message}`);
  }

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

  // --- Easy check: the Radar report ------------------------------------------
  // Printed loudly because this is the desk that failed silently before. A free
  // or brand-new frontier listing is flagged inline so it is visible in the CI
  // log of the daily sync, not just in a JSON field nobody opens.
  console.log(
    `\n[sync-models] Radar: ${untracked.length} untracked frontier model(s)` +
      ` — ${added.length} new to the catalog today` +
      (bootstrapped ? " (first-seen ledger seeded this run; no arrival dates are meaningful yet)" : "")
  );
  for (const u of untracked) {
    const price = u.free ? "FREE" : u.outputPrice == null ? "price unknown" : `$${u.outputPrice.toFixed(2)}/M out`;
    const flag = u.free ? " ← FREE FRONTIER LISTING" : u.isNew ? " ← NEW" : "";
    console.log(`  - ${u.name} (${u.id}) ${price} · ${u.signals.join(", ")}${flag}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildCatalog, applyPromos, buildFirstSeen, catalogThresholds, detectUntracked, findModel, buildTrackedModels, resolveBannerSlots, applyBannerSlots, buildBannerRoster };
