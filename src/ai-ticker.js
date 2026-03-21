/**
 * AI market ticker: model pricing, inference speed, and image gen data.
 * Reads pre-synced data from data/ai-models.json (populated by sync-models.js),
 * with live OpenRouter fetch as fallback. Computes deltas against previous
 * snapshot for the banner display. Maintains 30-day rolling history.
 */
const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("./render");

// --- Data loading ---

const DATA_PATH = path.join(__dirname, "..", "data", "ai-models.json");
const CURATED_PATH = path.join(__dirname, "..", "data", "ai-models-curated.json");

/**
 * Load synced model data from data/ai-models.json.
 * Returns null if file is missing or corrupt.
 */
function loadSyncedData() {
  if (!fs.existsSync(DATA_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
    if (!data.models || !Array.isArray(data.models)) return null;
    // Warn if sync is stale (> 3 days old)
    if (data.syncedAt) {
      const age = (Date.now() - new Date(data.syncedAt).getTime()) / 86400000;
      if (age > 3) {
        console.warn(`[ai-ticker] data/ai-models.json is ${Math.floor(age)} days old. Run: node src/sync-models.js`);
      }
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Load curated editorial config (banner keys, speed, images, model definitions).
 */
function loadCuratedConfig() {
  if (!fs.existsSync(CURATED_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CURATED_PATH, "utf-8"));
  } catch {
    return null;
  }
}

// --- OpenRouter live fetch (fallback when no synced data) ---

/** Cached full OpenRouter response for markets page use */
let _cachedOpenRouterData = null;

async function fetchOpenRouterPrices(trackedModels) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) return null;

    _cachedOpenRouterData = data.data;

    const prices = {};
    for (const model of trackedModels) {
      // Exact match first, then variant match (e.g. model:thinking)
      const found =
        data.data.find((m) => m.id === model.openrouterId) ||
        data.data.find((m) => m.id.startsWith(model.openrouterId + ":"));
      if (found && found.pricing) {
        const input = parseFloat(found.pricing.prompt) * 1_000_000;
        const output = parseFloat(found.pricing.completion) * 1_000_000;
        if (!isNaN(input) && !isNaN(output)) {
          const rawCache = found.pricing?.input_cache_read;
          const cacheVal = rawCache ? parseFloat(rawCache) * 1_000_000 : null;
          prices[model.key] = {
            input,
            output,
            context_length: found.context_length || null,
            cache_read_price: (cacheVal != null && !isNaN(cacheVal)) ? cacheVal : null,
            max_completion_tokens: found.top_provider?.max_completion_tokens || null,
            modality: found.architecture?.modality || null,
            input_modalities: found.architecture?.input_modalities || null,
            supported_parameters: found.supported_parameters || null,
            description: found.description || null,
            created: found.created || null,
            expiration_date: found.expiration_date || null,
            hugging_face_id: found.hugging_face_id || null,
          };
        }
      }
    }
    return Object.keys(prices).length > 0 ? prices : null;
  } catch {
    return null;
  }
}

// --- Snapshot system (30-day rolling history) ---

const HISTORY_FILE = ".ai-ticker-history.json";
const MAX_HISTORY_DAYS = 30;

function loadHistory(outDir) {
  const historyPath = path.join(outDir, HISTORY_FILE);
  if (fs.existsSync(historyPath)) {
    try {
      return JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    } catch { return []; }
  }
  return [];
}

function saveHistory(outDir, history) {
  const historyPath = path.join(outDir, HISTORY_FILE);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

function loadSnapshot(outDir) {
  const snapshotPath = path.join(outDir, ".ai-ticker-snapshot.json");
  if (fs.existsSync(snapshotPath)) {
    try {
      return JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
    } catch { return null; }
  }
  return null;
}

function saveSnapshot(outDir, tickerData) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    date: today,
    models: tickerData.models.map((m) => ({ key: m.key, input: m.input, output: m.output })),
  };

  const history = loadHistory(outDir);
  const idx = history.findIndex((h) => h.date === today);
  if (idx !== -1) history[idx] = entry;
  else history.push(entry);
  history.sort((a, b) => b.date.localeCompare(a.date));
  while (history.length > MAX_HISTORY_DAYS) history.pop();
  saveHistory(outDir, history);

  const snapshotPath = path.join(outDir, ".ai-ticker-snapshot.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(entry, null, 2));
}

// --- Core ticker data ---

/**
 * Get complete ticker data: prices from synced data (or live fallback), deltas, speed, images.
 */
async function getTickerData(outDir) {
  const synced = loadSyncedData();
  const curated = loadCuratedConfig();

  // Determine model definitions — synced data has everything, curated is the editorial source
  const trackedModels = curated?.trackedModels || synced?.models?.map((m) => ({
    key: m.key,
    openrouterId: m.openrouterId,
    label: m.label,
    provider: m.provider,
  })) || [];

  const bannerKeys = synced?.bannerKeys || curated?.bannerKeys || [];
  const speedData = synced?.speed || curated?.speed || [];
  const imageData = synced?.images || curated?.images || [];

  // Get prices: prefer synced data, fall back to live fetch
  let modelPrices = {};
  if (synced) {
    for (const m of synced.models) {
      if (m.input != null && m.output != null) {
        modelPrices[m.key] = {
          input: m.input,
          output: m.output,
          context_length: m.context_length,
          cache_read_price: m.cache_read_price ?? null,
          max_completion_tokens: m.max_completion_tokens ?? null,
          modality: m.modality ?? null,
          input_modalities: m.input_modalities ?? null,
          supported_parameters: m.supported_parameters ?? null,
          description: m.description ?? null,
          created: m.created ?? null,
          expiration_date: m.expiration_date ?? null,
          hugging_face_id: m.hugging_face_id ?? null,
        };
      }
    }
    console.log(`[ai-ticker] Using synced data from ${synced.syncedAt?.slice(0, 10) || "unknown"}`);
  }

  // If synced data is incomplete or missing, fetch live
  const syncedKeys = Object.keys(modelPrices);
  if (syncedKeys.length < trackedModels.length) {
    console.log("[ai-ticker] Synced data incomplete, fetching live prices...");
    const livePrices = await fetchOpenRouterPrices(trackedModels);
    if (livePrices) {
      for (const [key, val] of Object.entries(livePrices)) {
        if (!modelPrices[key]) modelPrices[key] = val;
      }
    }
  }

  const history = loadHistory(outDir);
  const prevSnapshot = history.length > 0 ? history[0] : loadSnapshot(outDir);

  const models = trackedModels.map((m) => {
    const current = modelPrices[m.key] || { input: null, output: null, context_length: null };
    const prev = prevSnapshot?.models?.find((p) => p.key === m.key);

    let inputDelta = null;
    let outputDelta = null;
    if (prev && current.input != null && current.output != null) {
      if (prev.input !== current.input) inputDelta = ((current.input - prev.input) / prev.input) * 100;
      if (prev.output !== current.output) outputDelta = ((current.output - prev.output) / prev.output) * 100;
    }

    return {
      key: m.key,
      label: m.label,
      provider: m.provider,
      input: current.input,
      output: current.output,
      context_length: current.context_length,
      cache_read_price: current.cache_read_price ?? null,
      max_completion_tokens: current.max_completion_tokens ?? null,
      modality: current.modality ?? null,
      input_modalities: current.input_modalities ?? null,
      supported_parameters: current.supported_parameters ?? null,
      description: current.description ?? null,
      created: current.created ?? null,
      expiration_date: current.expiration_date ?? null,
      hugging_face_id: current.hugging_face_id ?? null,
      inputDelta,
      outputDelta,
    };
  });

  // "Cost of Intelligence" index: avg output price across tracked models
  const validOutputs = models.filter((m) => m.output != null).map((m) => m.output);
  const indexValue = validOutputs.length > 0 ? validOutputs.reduce((a, b) => a + b, 0) / validOutputs.length : 0;

  const indexHistory = history.map((snap) => {
    const prices = trackedModels.map((tm) => {
      const found = snap.models?.find((m) => m.key === tm.key);
      return found ? found.output : null;
    }).filter((p) => p != null);
    return {
      date: snap.date,
      value: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
    };
  });

  return { models, speed: speedData, images: imageData, history, indexValue, indexHistory, bannerKeys };
}

/**
 * Get the full OpenRouter catalog for the markets page.
 * Must be called after getTickerData() if live fetch was triggered.
 */
function getFullMarketData() {
  if (!_cachedOpenRouterData) return null;

  return _cachedOpenRouterData
    .filter((m) => m.pricing && parseFloat(m.pricing.prompt) > 0)
    .map((m) => {
      const rawCache = m.pricing?.input_cache_read;
      const cacheVal = rawCache ? parseFloat(rawCache) * 1_000_000 : null;
      return {
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length || null,
        input: parseFloat(m.pricing.prompt) * 1_000_000,
        output: parseFloat(m.pricing.completion) * 1_000_000,
        cache_read_price: (cacheVal != null && !isNaN(cacheVal)) ? cacheVal : null,
        max_completion_tokens: m.top_provider?.max_completion_tokens || null,
        modality: m.architecture?.modality || null,
        input_modalities: m.architecture?.input_modalities || null,
        supported_parameters: m.supported_parameters || null,
        created: m.created || null,
        description: m.description || null,
        hugging_face_id: m.hugging_face_id || null,
      };
    })
    .sort((a, b) => b.output - a.output);
}

// --- Formatting ---

function formatPrice(n) {
  if (n == null) return "N/A";
  if (n === 0) return "$0";
  if (n >= 1) return "$" + (n % 1 === 0 ? n.toString() : n.toFixed(2));
  if (n >= 0.01) return "$" + n.toFixed(2);
  return "$" + n.toFixed(3);
}

function formatTokPerSec(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

// escapeHtml imported from ./render (single source of truth)

// --- Banner rendering ---

/**
 * Render the slim ticker banner HTML — single row, links to /markets/.
 */
function renderTickerBanner(tickerData, options = {}) {
  if (!tickerData) return "";

  const basePath = options.basePath || "";
  const bannerKeys = tickerData.bannerKeys || [];
  const bannerModels = tickerData.models.filter((m) => bannerKeys.includes(m.key));

  const modelItems = bannerModels
    .filter((m) => m.output != null) // skip models with no price data
    .map((m) => {
      const delta = m.outputDelta;
      let deltaHtml = '<span class="ticker-delta flat">&mdash;</span>';
      if (delta !== null && delta !== 0) {
        if (delta < 0) {
          deltaHtml = `<span class="ticker-delta down">&#9660;${Math.abs(delta).toFixed(0)}%</span>`;
        } else {
          deltaHtml = `<span class="ticker-delta up">&#9650;${delta.toFixed(0)}%</span>`;
        }
      }
      return `<span class="ticker-item"><span class="ticker-name">${escapeHtml(m.label)}</span> <span class="ticker-price">${formatPrice(m.output)}/M</span> ${deltaHtml}</span>`;
    }).join("");

  return `<a href="${basePath}/markets/" class="ai-ticker">
  <div class="ticker-row"><span class="ticker-label">AI Models</span><div class="ticker-items">${modelItems}</div><span class="ticker-more">Full Markets &#8594;</span></div>
</a>`;
}

// --- Exports ---

// Expose curated data for tests (loaded once)
const _curated = loadCuratedConfig() || {};
const TRACKED_MODELS = _curated.trackedModels || [];
const TICKER_BANNER_KEYS = _curated.bannerKeys || [];
const SPEED_DATA = _curated.speed || [];
const IMAGE_DATA = _curated.images || [];

module.exports = {
  getTickerData,
  getFullMarketData,
  saveSnapshot,
  loadSnapshot,
  loadHistory,
  renderTickerBanner,
  fetchOpenRouterPrices,
  formatPrice,
  formatTokPerSec,
  escapeHtml,
  TRACKED_MODELS,
  TICKER_BANNER_KEYS,
  SPEED_DATA,
  IMAGE_DATA,
};
