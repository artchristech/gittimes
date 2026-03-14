/**
 * AI market ticker: model pricing, inference speed, and image gen data.
 * Fetches live prices from OpenRouter, merges with curated speed/image data,
 * and computes deltas against previous snapshot for the banner display.
 * Maintains 30-day rolling history for the markets page charts.
 */
const fs = require("fs");
const path = require("path");

// Tracked frontier models — OpenRouter IDs + fallback prices ($/1M tokens)
const TRACKED_MODELS = [
  { key: "claude-opus", openrouterId: "anthropic/claude-opus-4", label: "Claude Opus", provider: "Anthropic", fallbackInput: 15.00, fallbackOutput: 75.00 },
  { key: "claude-sonnet", openrouterId: "anthropic/claude-sonnet-4", label: "Claude Sonnet", provider: "Anthropic", fallbackInput: 3.00, fallbackOutput: 15.00 },
  { key: "gpt-4.1", openrouterId: "openai/gpt-4.1", label: "GPT-4.1", provider: "OpenAI", fallbackInput: 2.00, fallbackOutput: 8.00 },
  { key: "gpt-4.1-mini", openrouterId: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "OpenAI", fallbackInput: 0.40, fallbackOutput: 1.60 },
  { key: "gemini-2.5-pro", openrouterId: "google/gemini-2.5-pro-preview", label: "Gemini 2.5 Pro", provider: "Google", fallbackInput: 1.25, fallbackOutput: 10.00 },
  { key: "gemini-2.5-flash", openrouterId: "google/gemini-2.5-flash-preview", label: "Gemini 2.5 Flash", provider: "Google", fallbackInput: 0.15, fallbackOutput: 0.60 },
  { key: "grok-3", openrouterId: "x-ai/grok-3", label: "Grok 3", provider: "xAI", fallbackInput: 3.00, fallbackOutput: 15.00 },
  { key: "grok-3-mini", openrouterId: "x-ai/grok-3-mini", label: "Grok 3 Mini", provider: "xAI", fallbackInput: 0.30, fallbackOutput: 0.50 },
  { key: "deepseek-v3", openrouterId: "deepseek/deepseek-chat", label: "DeepSeek V3", provider: "DeepSeek", fallbackInput: 0.27, fallbackOutput: 1.10 },
  { key: "deepseek-r1", openrouterId: "deepseek/deepseek-r1", label: "DeepSeek R1", provider: "DeepSeek", fallbackInput: 0.55, fallbackOutput: 2.19 },
  { key: "llama-4-maverick", openrouterId: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", provider: "Meta", fallbackInput: 0.20, fallbackOutput: 0.60 },
  { key: "mistral-large", openrouterId: "mistralai/mistral-large", label: "Mistral Large", provider: "Mistral", fallbackInput: 2.00, fallbackOutput: 6.00 },
];

// Subset for the slim ticker banner (headline models only)
const TICKER_BANNER_KEYS = ["claude-sonnet", "gpt-4.1", "gemini-2.5-pro", "grok-3", "deepseek-v3", "llama-4-maverick"];

// Curated speed data — update when providers announce changes
const SPEED_DATA = [
  { name: "Cerebras", tokPerSec: 2200, model: "Llama 3.3 70B" },
  { name: "Groq", tokPerSec: 750, model: "Llama 3.3 70B" },
  { name: "SambaNova", tokPerSec: 400, model: "Llama 3.1 405B" },
  { name: "Fireworks", tokPerSec: 220, model: "Llama 3.1 70B" },
];

// Curated image gen data — editorial quality grades
const IMAGE_DATA = [
  { name: "DALL-E 3 HD", price: 0.080, grade: "A" },
  { name: "Flux 1.1 Pro", price: 0.040, grade: "A" },
  { name: "Imagen 3", price: 0.040, grade: "A" },
  { name: "SD 3.5", price: 0.065, grade: "B+" },
  { name: "Flux Schnell", price: 0.003, grade: "B" },
];

/** Cached full OpenRouter response for markets page use */
let _cachedOpenRouterData = null;

/**
 * Fetch current model prices from OpenRouter's public API.
 * Returns a map of { key: { input, output, context_length } } or null on failure.
 * Also caches the full response for getFullMarketData().
 */
async function fetchOpenRouterPrices() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) return null;

    _cachedOpenRouterData = data.data;

    const prices = {};
    for (const model of TRACKED_MODELS) {
      const found = data.data.find((m) =>
        m.id === model.openrouterId || m.id.startsWith(model.openrouterId)
      );
      if (found && found.pricing) {
        const input = parseFloat(found.pricing.prompt) * 1_000_000;
        const output = parseFloat(found.pricing.completion) * 1_000_000;
        if (!isNaN(input) && !isNaN(output)) {
          prices[model.key] = {
            input,
            output,
            context_length: found.context_length || null,
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

/**
 * Legacy single-snapshot loader (for backwards compat during migration).
 */
function loadSnapshot(outDir) {
  const snapshotPath = path.join(outDir, ".ai-ticker-snapshot.json");
  if (fs.existsSync(snapshotPath)) {
    try {
      return JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
    } catch { return null; }
  }
  return null;
}

/**
 * Save today's snapshot to rolling history and legacy file.
 */
function saveSnapshot(outDir, tickerData) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    date: today,
    models: tickerData.models.map((m) => ({ key: m.key, input: m.input, output: m.output })),
  };

  // Save to rolling history
  const history = loadHistory(outDir);
  // Replace today's entry if it exists
  const idx = history.findIndex((h) => h.date === today);
  if (idx !== -1) history[idx] = entry;
  else history.push(entry);
  // Trim to MAX_HISTORY_DAYS
  history.sort((a, b) => b.date.localeCompare(a.date));
  while (history.length > MAX_HISTORY_DAYS) history.pop();
  saveHistory(outDir, history);

  // Also save legacy single-snapshot for backwards compat
  const snapshotPath = path.join(outDir, ".ai-ticker-snapshot.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(entry, null, 2));
}

/**
 * Get complete ticker data: live prices (with fallback), deltas, speed, images.
 */
async function getTickerData(outDir) {
  const openRouterPrices = await fetchOpenRouterPrices();
  const history = loadHistory(outDir);
  const prevSnapshot = history.length > 0 ? history[0] : loadSnapshot(outDir);

  const models = TRACKED_MODELS.map((m) => {
    const current = openRouterPrices?.[m.key] || { input: m.fallbackInput, output: m.fallbackOutput, context_length: null };
    const prev = prevSnapshot?.models?.find((p) => p.key === m.key);

    let inputDelta = null;
    let outputDelta = null;
    if (prev) {
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
      inputDelta,
      outputDelta,
    };
  });

  // Compute the "Cost of Intelligence" index: avg output price across frontier models
  const outputPrices = models.map((m) => m.output);
  const indexValue = outputPrices.reduce((a, b) => a + b, 0) / outputPrices.length;

  // Compute index history from snapshots
  const indexHistory = history.map((snap) => {
    const prices = TRACKED_MODELS.map((tm) => {
      const found = snap.models?.find((m) => m.key === tm.key);
      return found ? found.output : tm.fallbackOutput;
    });
    return {
      date: snap.date,
      value: prices.reduce((a, b) => a + b, 0) / prices.length,
    };
  });

  return { models, speed: SPEED_DATA, images: IMAGE_DATA, history, indexValue, indexHistory };
}

/**
 * Get the full OpenRouter catalog for the markets page.
 * Must be called after getTickerData() which populates the cache.
 */
function getFullMarketData() {
  if (!_cachedOpenRouterData) return null;

  return _cachedOpenRouterData
    .filter((m) => m.pricing && parseFloat(m.pricing.prompt) > 0)
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      context_length: m.context_length || null,
      input: parseFloat(m.pricing.prompt) * 1_000_000,
      output: parseFloat(m.pricing.completion) * 1_000_000,
    }))
    .sort((a, b) => b.output - a.output);
}

function formatPrice(n) {
  if (n === 0) return "$0";
  if (n >= 1) return "$" + (n % 1 === 0 ? n.toString() : n.toFixed(2));
  if (n >= 0.01) return "$" + n.toFixed(2);
  return "$" + n.toFixed(3);
}

function formatTokPerSec(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render the slim ticker banner HTML — single row, links to /markets/.
 */
function renderTickerBanner(tickerData, options = {}) {
  if (!tickerData) return "";

  const basePath = options.basePath || "";
  const bannerModels = tickerData.models.filter((m) => TICKER_BANNER_KEYS.includes(m.key));

  const modelItems = bannerModels.map((m) => {
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
  escapeHtml: escapeHtml,
  TRACKED_MODELS,
  TICKER_BANNER_KEYS,
  SPEED_DATA,
  IMAGE_DATA,
};
