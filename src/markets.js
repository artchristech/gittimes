/**
 * AI Markets page renderer.
 * Generates a full-page analytics view of AI model pricing, speed, and image gen data.
 */
const { escapeHtml } = require("./render");
const { loadTemplate, buildAnalytics } = require("./template-utils");
const { formatPrice, formatTokPerSec, TRACKED_MODELS } = require("./ai-ticker");

/**
 * Render an SVG sparkline from an array of { date, value } points.
 * Returns an inline SVG string.
 */
function renderSparkline(points, { width = 120, height = 32, color = "var(--accent)" } = {}) {
  if (!points || points.length < 2) return "";
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 2;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = padY + ((max - p.value) / range) * (height - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><polyline points="${coords.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/**
 * Build price history for a specific model from the history array.
 */
function getModelHistory(history, modelKey) {
  return history
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((snap) => {
      const found = snap.models?.find((m) => m.key === modelKey);
      return found ? { date: snap.date, value: found.output } : null;
    })
    .filter(Boolean);
}

/**
 * Render the full AI Markets page.
 * @param {object} tickerData - from getTickerData()
 * @param {Array|null} fullMarket - from getFullMarketData()
 * @param {object} options - { basePath }
 * @returns {string} Complete HTML string
 */
function renderMarketsPage(tickerData, fullMarket, options = {}) {
  const basePath = options.basePath || "";

  const { template, css } = loadTemplate("markets");

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // --- Cost of Intelligence Index ---
  const indexValue = tickerData.indexValue;
  const indexHistory = (tickerData.indexHistory || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  let indexDelta = null;
  if (indexHistory.length >= 2) {
    const prev = indexHistory[indexHistory.length - 2].value;
    if (prev > 0) indexDelta = ((indexValue - prev) / prev) * 100;
  }

  let indexDeltaHtml = '<span class="markets-delta flat">&mdash;</span>';
  if (indexDelta !== null && indexDelta !== 0) {
    if (indexDelta < 0) {
      indexDeltaHtml = `<span class="markets-delta down">&#9660; ${Math.abs(indexDelta).toFixed(1)}%</span>`;
    } else {
      indexDeltaHtml = `<span class="markets-delta up">&#9650; ${indexDelta.toFixed(1)}%</span>`;
    }
  }

  const indexSparkline = renderSparkline(indexHistory, { width: 200, height: 48 });

  const indexHtml = `<div class="markets-index">
    <div class="markets-index-header">
      <h2 class="markets-section-title">Cost of Intelligence Index</h2>
      <p class="markets-index-desc">Average output price across ${tickerData.models.length} tracked frontier models</p>
    </div>
    <div class="markets-index-value">
      <span class="markets-index-price">${formatPrice(indexValue)}<span class="markets-index-unit">/M tokens</span></span>
      ${indexDeltaHtml}
    </div>
    <div class="markets-index-chart">${indexSparkline}</div>
  </div>`;

  // --- Frontier Model Pricing Table ---
  const modelRows = tickerData.models.map((m) => {
    const history = getModelHistory(tickerData.history || [], m.key);
    const sparkline = renderSparkline(history, { width: 100, height: 24 });

    const outDelta = m.outputDelta;
    let deltaHtml = '<span class="markets-delta flat">&mdash;</span>';
    if (outDelta !== null && outDelta !== 0) {
      if (outDelta < 0) {
        deltaHtml = `<span class="markets-delta down">&#9660;${Math.abs(outDelta).toFixed(1)}%</span>`;
      } else {
        deltaHtml = `<span class="markets-delta up">&#9650;${outDelta.toFixed(1)}%</span>`;
      }
    }

    const ctxLen = m.context_length ? (m.context_length >= 1000000 ? (m.context_length / 1000000).toFixed(1) + "M" : Math.round(m.context_length / 1000) + "k") : "—";

    return `<tr>
      <td class="model-name">${escapeHtml(m.label)}</td>
      <td class="model-provider">${escapeHtml(m.provider)}</td>
      <td class="model-price">${formatPrice(m.input)}</td>
      <td class="model-price">${formatPrice(m.output)}</td>
      <td class="model-delta">${deltaHtml}</td>
      <td class="model-ctx">${ctxLen}</td>
      <td class="model-spark">${sparkline}</td>
    </tr>`;
  }).join("\n");

  const pricingTableHtml = `<div class="markets-section">
    <h2 class="markets-section-title">Frontier Model Pricing</h2>
    <p class="markets-section-desc">Per 1M tokens &middot; Prices from OpenRouter &middot; Updated daily</p>
    <div class="markets-table-wrap">
      <table class="markets-table">
        <thead><tr>
          <th>Model</th><th>Provider</th><th>Input</th><th>Output</th><th>24h</th><th>Context</th><th>30d</th>
        </tr></thead>
        <tbody>${modelRows}</tbody>
      </table>
    </div>
  </div>`;

  // --- Speed Leaderboard ---
  const speedRows = tickerData.speed.map((s, i) => {
    const bar = Math.round((s.tokPerSec / 2500) * 100);
    return `<tr>
      <td class="speed-rank">${i + 1}</td>
      <td class="speed-provider">${escapeHtml(s.name)}</td>
      <td class="speed-model">${escapeHtml(s.model)}</td>
      <td class="speed-value">${formatTokPerSec(s.tokPerSec)} tok/s</td>
      <td class="speed-bar"><div class="bar-track"><div class="bar-fill" style="width:${Math.min(bar, 100)}%"></div></div></td>
    </tr>`;
  }).join("\n");

  const speedHtml = `<div class="markets-section">
    <h2 class="markets-section-title">Inference Speed Leaderboard</h2>
    <p class="markets-section-desc">Output tokens per second &middot; Curated benchmarks</p>
    <div class="markets-table-wrap">
      <table class="markets-table">
        <thead><tr><th>#</th><th>Provider</th><th>Model</th><th>Speed</th><th></th></tr></thead>
        <tbody>${speedRows}</tbody>
      </table>
    </div>
  </div>`;

  // --- Image Generation ---
  const imageRows = tickerData.images.map((img) => {
    return `<tr>
      <td class="img-name">${escapeHtml(img.name)}</td>
      <td class="img-price">${formatPrice(img.price)}/img</td>
      <td class="img-grade"><span class="grade-badge">${escapeHtml(img.grade)}</span></td>
    </tr>`;
  }).join("\n");

  const imageHtml = `<div class="markets-section">
    <h2 class="markets-section-title">Image Generation</h2>
    <p class="markets-section-desc">Cost per image &middot; Editorial quality grades</p>
    <div class="markets-table-wrap">
      <table class="markets-table">
        <thead><tr><th>Model</th><th>Price</th><th>Grade</th></tr></thead>
        <tbody>${imageRows}</tbody>
      </table>
    </div>
  </div>`;

  // --- All Models by Provider ---
  let catalogHtml = "";
  if (fullMarket && fullMarket.length > 0) {
    // Group by provider
    const providerMap = {};
    for (const m of fullMarket) {
      const provider = m.id.split("/")[0];
      if (!providerMap[provider]) providerMap[provider] = [];
      providerMap[provider].push(m);
    }

    // Sort each provider's models by output price descending
    for (const provider of Object.keys(providerMap)) {
      providerMap[provider].sort((a, b) => b.output - a.output);
    }

    // Sort providers by their most expensive model (descending)
    const trackedKeys = new Set(TRACKED_MODELS.map((t) => t.openrouterId));
    const sortedProviders = Object.keys(providerMap).sort(
      (a, b) => providerMap[b][0].output - providerMap[a][0].output
    );

    const formatCtx = (ctx) => ctx ? (ctx >= 1000000 ? (ctx / 1000000).toFixed(1) + "M" : Math.round(ctx / 1000) + "k") : "—";

    const providerGroups = sortedProviders.map((provider) => {
      const models = providerMap[provider];
      // Flagship: first tracked model match, or most expensive
      const flagship = models.find((m) => trackedKeys.has(m.id)) || models[0];
      const rest = models.filter((m) => m !== flagship);

      const flagshipRow = `<table class="markets-table">
        <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Context</th></tr></thead>
        <tbody><tr class="provider-flagship">
          <td class="catalog-name">${escapeHtml(flagship.name)}</td>
          <td class="model-price">${formatPrice(flagship.input)}</td>
          <td class="model-price">${formatPrice(flagship.output)}</td>
          <td class="model-ctx">${formatCtx(flagship.context_length)}</td>
        </tr></tbody>
      </table>`;

      let detailsHtml = "";
      if (rest.length > 0) {
        const restRows = rest.map((m) => `<tr>
          <td class="catalog-name">${escapeHtml(m.name)}</td>
          <td class="model-price">${formatPrice(m.input)}</td>
          <td class="model-price">${formatPrice(m.output)}</td>
          <td class="model-ctx">${formatCtx(m.context_length)}</td>
        </tr>`).join("\n");

        detailsHtml = `<details class="provider-more">
          <summary>${rest.length} more model${rest.length === 1 ? "" : "s"}</summary>
          <table class="markets-table markets-table-compact">
            <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Context</th></tr></thead>
            <tbody>${restRows}</tbody>
          </table>
        </details>`;
      }

      return `<div class="provider-group">
        <h3 class="provider-name">${escapeHtml(provider)}</h3>
        ${flagshipRow}
        ${detailsHtml}
      </div>`;
    }).join("\n");

    catalogHtml = `<div class="markets-section">
      <h2 class="markets-section-title">All Models by Provider</h2>
      <p class="markets-section-desc">${fullMarket.length} models across ${sortedProviders.length} providers on OpenRouter</p>
      ${providerGroups}
    </div>`;
  }

  // --- Assemble ---
  const contentHtml = [indexHtml, pricingTableHtml, speedHtml, imageHtml, catalogHtml].join("\n");

  const { analyticsScript, cspScriptSrc, cspConnectSrc } = buildAnalytics();

  return template
    .replace("{{STYLES}}", css)
    .replace(/\{\{BASE_PATH\}\}/g, basePath)
    .replace("{{MARKETS_DATE}}", escapeHtml(today))
    .replace("{{MARKETS_CONTENT}}", contentHtml)
    .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
    .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
    .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc);
}

module.exports = { renderMarketsPage };
