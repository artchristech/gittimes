/**
 * AI Markets page renderer.
 * Generates a full-page analytics view of AI model pricing, speed, and image gen data.
 */
const { escapeHtml } = require("./render");
const { applyTemplate } = require("./template-utils");
const { formatPrice, formatTokPerSec, TRACKED_MODELS } = require("./ai-ticker");

// --- Enrichment helpers ---

function renderModalityBadges(inputModalities) {
  if (!inputModalities || !Array.isArray(inputModalities)) return "";
  const badgeMap = { image: "img", audio: "aud", video: "vid" };
  const badges = inputModalities
    .filter((mod) => mod !== "text" && badgeMap[mod])
    .map((mod) => `<span class="modality-badge">${badgeMap[mod]}</span>`);
  return badges.length > 0 ? badges.join("") : "";
}

function renderFeatureBadges(supportedParams) {
  if (!supportedParams || !Array.isArray(supportedParams)) return "";
  const show = ["tools", "reasoning", "structured_output"];
  const labels = { tools: "tools", reasoning: "reasoning", structured_output: "structured" };
  const found = show.filter((f) => supportedParams.includes(f));
  if (found.length === 0) return "";
  const badges = found.map((f) => `<span class="feature-badge">${labels[f]}</span>`);
  return `<span class="feature-badges">${badges.join("")}</span>`;
}

function timeAgo(unixTs) {
  if (!unixTs) return "";
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTs;
  if (diff < 0) return "soon";
  const days = Math.floor(diff / 86400);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function renderNewModelsSection(tickerData, fullMarket) {
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 86400;

  // Collect recent models from both tracked and catalog
  const recent = [];
  for (const m of tickerData.models) {
    if (m.created && m.created > thirtyDaysAgo) {
      recent.push({ name: m.label, provider: m.provider, output: m.output, created: m.created });
    }
  }
  if (fullMarket) {
    const trackedLabels = new Set(tickerData.models.map((m) => m.label));
    for (const m of fullMarket) {
      if (m.created && m.created > thirtyDaysAgo && !trackedLabels.has(m.name)) {
        const provider = m.id.split("/")[0];
        recent.push({ name: m.name, provider, output: m.output, created: m.created });
      }
    }
  }

  if (recent.length === 0) return "";

  recent.sort((a, b) => b.created - a.created);
  const entries = recent.slice(0, 8);

  const rows = entries.map((m) => `<tr>
    <td class="model-name">${escapeHtml(m.name)}</td>
    <td class="model-provider">${escapeHtml(m.provider)}</td>
    <td class="model-price">${formatPrice(m.output)}</td>
    <td class="model-added">${timeAgo(m.created)}</td>
  </tr>`).join("\n");

  return `<div class="markets-section">
    <h2 class="markets-section-title">New on the Market</h2>
    <p class="markets-section-desc">Models added in the last 30 days</p>
    <div class="markets-table-wrap">
      <table class="markets-table">
        <thead><tr><th>Model</th><th>Provider</th><th>Output</th><th>Added</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function renderRadarSection(untracked) {
  if (!untracked || untracked.length === 0) return "";
  const entries = untracked.slice(0, 8);
  const rows = entries.map((m) => {
    const provider = (m.id || "").split("/")[0] || "—";
    return `<tr>
      <td class="model-name">${escapeHtml(m.name)}</td>
      <td class="model-provider">${escapeHtml(provider)}</td>
      <td class="model-price">${formatPrice(m.outputPrice)}</td>
      <td class="model-added">${m.created ? timeAgo(m.created) : "—"}</td>
    </tr>`;
  }).join("\n");

  return `<div class="markets-section">
    <h2 class="markets-section-title">On Our Radar</h2>
    <p class="markets-section-desc">Frontier models in the catalog the desk isn't tracking yet &middot; auto-detected daily</p>
    <div class="markets-table-wrap">
      <table class="markets-table">
        <thead><tr><th>Model</th><th>Provider</th><th>Output</th><th>Listed</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function renderSunsetWatch(models) {
  const expiring = models.filter((m) => m.expiration_date);
  if (expiring.length === 0) return "";

  const items = expiring.map((m) => {
    const date = new Date(m.expiration_date * 1000);
    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `<li><strong>${escapeHtml(m.label || m.name)}</strong> — expires ${dateStr}</li>`;
  }).join("\n");

  return `<div class="markets-callout">
    <div class="markets-callout-title">Sunset Watch</div>
    <ul>${items}</ul>
  </div>`;
}

function renderModelNameCell(m, isCatalog, nameSort) {
  const label = isCatalog ? m.name : m.label;
  const tdClass = isCatalog ? "catalog-name" : "model-name";
  const desc = m.description ? ` title="${escapeHtml(m.description).replace(/"/g, "&quot;")}"` : "";
  const sortAttr = nameSort != null ? ` data-sort="${nameSort}"` : "";

  let nameHtml;
  if (m.hugging_face_id) {
    nameHtml = `<a class="model-hf-link" href="https://huggingface.co/${escapeHtml(m.hugging_face_id)}"${desc}>${escapeHtml(label)}</a>`;
  } else {
    nameHtml = desc ? `<span${desc}>${escapeHtml(label)}</span>` : escapeHtml(label);
  }

  const modBadges = renderModalityBadges(m.input_modalities);
  const featBadges = renderFeatureBadges(m.supported_parameters);
  const extra = (modBadges || featBadges) ? `${modBadges}${featBadges}` : "";

  return `<td class="${tdClass}"${sortAttr}>${nameHtml}${extra}</td>`;
}

function renderInputPriceCell(m) {
  const cacheHtml = m.cache_read_price != null
    ? `<span class="cache-price">cache: ${formatPrice(m.cache_read_price)}</span>`
    : "";
  // data-sort: raw unformatted input $/M for numeric JS sorting (-1 when unpriced)
  const sortVal = m.input != null ? m.input : -1;
  const priceVal = m.input != null ? m.input : "";
  return `<td class="model-price price-cell" data-sort="${sortVal}" data-priceval="${priceVal}"><span class="price-main">${formatPrice(m.input)}</span>${cacheHtml}</td>`;
}

function renderCtxCell(m) {
  const ctxLen = m.context_length
    ? (m.context_length >= 1000000 ? (m.context_length / 1000000).toFixed(1) + "M" : Math.round(m.context_length / 1000) + "k")
    : "—";
  const title = m.max_completion_tokens ? ` title="Max output: ${m.max_completion_tokens.toLocaleString()} tokens"` : "";
  const sortVal = m.context_length || 0;
  return `<td class="model-ctx" data-sort="${sortVal}"${title}>${ctxLen}</td>`;
}

// --- Sparkline ---

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

// --- Area chart (filled, draw-in) ---

function renderAreaChart(points, { width = 640, height = 160, pad = 6 } = {}) {
  if (!points || points.length < 2) return "";
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerH = height - pad * 2;

  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = pad + ((max - p.value) / range) * innerH;
    return [x, y];
  });

  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = xy[xy.length - 1];

  return `<svg class="area-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Cost of Intelligence Index trend">
    <defs><linearGradient id="coi-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient></defs>
    <path class="area-fill" d="${area}" fill="url(#coi-fill)"/>
    <path class="area-line" d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="area-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="var(--accent)"/>
  </svg>`;
}

// --- Evals (curated quality benchmarks) ---

const DEFAULT_EVAL_METRICS = [
  { key: "mmlu_pro", label: "MMLU-Pro", unit: "%", max: 100 },
  { key: "gpqa", label: "GPQA", unit: "%", max: 100 },
  { key: "swe_bench", label: "SWE-bench", unit: "%", max: 100 },
  { key: "arena_elo", label: "Arena Elo", unit: "", max: 1500 },
];

/**
 * Composite 0–100 "Quality Index": mean of each available metric normalized
 * against its own max. Returns null when a model has no eval data.
 */
function compositeQuality(scores, metrics) {
  if (!scores) return null;
  const ms = metrics || DEFAULT_EVAL_METRICS;
  const norm = ms
    .map((m) => (scores[m.key] != null ? (scores[m.key] / (m.max || 100)) * 100 : null))
    .filter((v) => v != null);
  if (norm.length === 0) return null;
  return norm.reduce((a, b) => a + b, 0) / norm.length;
}

/**
 * Pure monthly-cost estimate for one model. NO DOM, NO globals — the inline
 * calculator calls this same function so the tested math is the shipped math.
 *
 * @param {object} a
 * @param {number} a.inM      input tokens/day, in MILLIONS
 * @param {number} a.outM     output tokens/day, in MILLIONS
 * @param {number} a.input    input price per 1M tokens ($)
 * @param {number} a.output   output price per 1M tokens ($)
 * @param {number} [a.cache]  cached-input read price per 1M tokens ($); falls
 *                            back to `input` when null/undefined
 * @param {number} a.cachedPct  share of input tokens served from cache, 0–100
 * @returns {number} estimated $/month
 */
function monthlyCost({ inM, outM, input, output, cache, cachedPct }) {
  const DAYS_PER_MONTH = 30; // fixed daily→monthly factor
  const inputTokM = Number(inM) || 0;
  const outputTokM = Number(outM) || 0;
  const inPrice = Number(input) || 0;
  const outPrice = Number(output) || 0;
  // Cached input billed at cache price; fall back to input price when no cache rate.
  const cachePrice = (cache == null || isNaN(Number(cache))) ? inPrice : Number(cache);
  const pct = Math.max(0, Math.min(100, Number(cachedPct) || 0)) / 100;

  const cachedInputM = inputTokM * pct;
  const freshInputM = inputTokM * (1 - pct);

  const dailyCost = cachedInputM * cachePrice + freshInputM * inPrice + outputTokM * outPrice;
  return dailyCost * DAYS_PER_MONTH;
}

function formatScore(v, unit) {
  if (v == null) return "—";
  if (unit === "%") return `${v}`;
  return `${v}`;
}

function renderEvalsSection(tickerData) {
  const evals = tickerData.evals;
  if (!evals || !evals.models) return "";
  const metrics = (evals.metrics && evals.metrics.length ? evals.metrics : DEFAULT_EVAL_METRICS);

  // Rank tracked models by composite quality (only those with data)
  const ranked = tickerData.models
    .map((m) => ({ m, scores: evals.models[m.key] || null, q: compositeQuality(evals.models[m.key], metrics) }))
    .filter((r) => r.q != null)
    .sort((a, b) => b.q - a.q);

  if (ranked.length === 0) return "";

  const headCols = metrics.map((mt) => {
    const hint = mt.hint ? ` title="${escapeHtml(mt.hint)}"` : "";
    return `<th${hint}>${escapeHtml(mt.label)}</th>`;
  }).join("");

  const asOf = evals.asOf ? escapeHtml(evals.asOf) : "undated";
  const curatedTitle = `curated · as of ${asOf}`;
  const rows = ranked.map((r, i) => {
    const cells = metrics.map((mt) => {
      const v = r.scores[mt.key];
      const pct = v != null ? Math.max(0, Math.min(100, (v / (mt.max || 100)) * 100)) : 0;
      const display = v != null ? `${formatScore(v, mt.unit)}${mt.unit === "%" ? "%" : ""}` : "—";
      const barClass = v != null ? "eval-bar" : "eval-bar empty";
      // Honesty (Step 2): downweight + "est." marker + provenance title so a
      // curated number never reads as a live measurement.
      const estMarker = v != null ? '<span class="eval-est">est.</span>' : "";
      return `<td class="eval-cell eval-curated" title="${escapeHtml(curatedTitle)}">
        <span class="eval-score">${display}</span>${estMarker}
        <span class="bar-track eval-bar-track"><span class="${barClass}" style="width:${pct.toFixed(0)}%"></span></span>
      </td>`;
    }).join("");
    const qBadge = `<span class="quality-index" title="Composite quality, 0–100, mean of normalized benchmarks">${r.q.toFixed(1)}</span>`;
    return `<tr data-reveal>
      <td class="eval-rank">${i + 1}</td>
      <td class="model-name">${escapeHtml(r.m.label)}<span class="eval-provider">${escapeHtml(r.m.provider)}</span></td>
      <td class="eval-quality">${qBadge}</td>
      ${cells}
    </tr>`;
  }).join("\n");

  const srcLinks = (evals.sources || []).map((s) =>
    `<a href="${escapeHtml(s.url)}" rel="nofollow noopener" target="_blank">${escapeHtml(s.label)}</a>`
  ).join(" · ");
  const note = evals.note ? `<p class="markets-section-desc evals-note">${escapeHtml(evals.note)}</p>` : "";

  return `<section class="markets-section" data-reveal>
    <div class="section-head">
      <p class="section-kicker">Quality Desk</p>
      <h2 class="markets-section-title">Model Evals</h2>
      <span class="provenance-tag curated">Curated · as of ${asOf}</span>
    </div>
    <p class="markets-section-desc">How good each frontier model actually is — independent of price. Sorted by composite Quality Index.</p>
    <div class="markets-table-wrap">
      <table class="markets-table evals-table">
        <thead><tr><th>#</th><th>Model</th><th title="Composite quality, 0–100">Quality</th>${headCols}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${note}
    <p class="quality-formula">Quality Index = unweighted mean of each available benchmark normalized to its own max (score ÷ max × 100), then averaged. Curated, dated estimates — not live measurements.</p>
    <p class="evals-sources">Sources: ${srcLinks || "editorial"}</p>
  </section>`;
}

/**
 * Value frontier: composite quality (y) vs output price (x), inline SVG scatter.
 * Answers "best quality per dollar". Honest: quality is curated, price is live.
 */
function renderValueScatter(tickerData) {
  const evals = tickerData.evals;
  if (!evals || !evals.models) return "";
  const metrics = (evals.metrics && evals.metrics.length ? evals.metrics : DEFAULT_EVAL_METRICS);

  const pts = tickerData.models
    .map((m) => ({ m, q: compositeQuality(evals.models[m.key], metrics), price: m.output }))
    .filter((p) => p.q != null && p.price != null && p.price > 0);
  if (pts.length < 2) return "";

  const W = 640, H = 260, padL = 44, padR = 16, padT = 16, padB = 36;
  const prices = pts.map((p) => p.price);
  const quals = pts.map((p) => p.q);
  const pMin = Math.min(...prices), pMax = Math.max(...prices);
  const qMin = Math.min(...quals), qMax = Math.max(...quals);
  // log-ish price scale guard
  const pRange = (pMax - pMin) || 1;
  const qRange = (qMax - qMin) || 1;
  const sx = (p) => padL + ((p - pMin) / pRange) * (W - padL - padR);
  const sy = (q) => H - padB - ((q - qMin) / qRange) * (H - padT - padB);

  // best value = max quality/price
  let best = pts[0];
  for (const p of pts) if (p.q / p.price > best.q / best.price) best = p;

  const dots = pts.map((p) => {
    const x = sx(p.price), y = sy(p.q);
    const isBest = p === best;
    return `<g class="scatter-pt${isBest ? " best" : ""}" data-reveal>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isBest ? 6 : 4.5}" />
      <text x="${(x + 8).toFixed(1)}" y="${(y - 6).toFixed(1)}" class="scatter-label">${escapeHtml(p.m.label)}</text>
    </g>`;
  }).join("\n");

  return `<section class="markets-section" data-reveal>
    <div class="section-head">
      <p class="section-kicker">Value Desk</p>
      <h2 class="markets-section-title">The Value Frontier</h2>
      <span class="provenance-tag mixed">Quality curated · price live</span>
    </div>
    <p class="markets-section-desc">Quality Index vs. output price. Up and to the left is better. Best value: <strong>${escapeHtml(best.m.label)}</strong>.</p>
    <div class="scatter-wrap">
      <svg class="value-scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Quality versus price scatter plot">
        <line class="axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}"/>
        <line class="axis" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>
        <text class="axis-label" x="${padL}" y="${H - 8}">cheaper ← output $/M → pricier</text>
        <text class="axis-label" x="6" y="${padT + 6}" transform="rotate(-90 6 ${padT + 6})">higher quality →</text>
        ${dots}
      </svg>
    </div>
  </section>`;
}

// --- Freshness banner (honest: live price sync vs curated dates) ---

function buildFreshness(tickerData) {
  const syncedAt = tickerData.syncedAt ? new Date(tickerData.syncedAt) : null;
  let priceChip;
  if (syncedAt && !isNaN(syncedAt.getTime())) {
    const ageMs = Date.now() - syncedAt.getTime();
    const ageMin = Math.floor(ageMs / 60000);
    const stale = ageMs > 24 * 3600 * 1000;
    let rel;
    if (ageMin < 1) rel = "just now";
    else if (ageMin < 60) rel = `${ageMin} min ago`;
    else if (ageMin < 1440) rel = `${Math.floor(ageMin / 60)}h ago`;
    else rel = `${Math.floor(ageMin / 1440)}d ago`;
    const abs = syncedAt.toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
    priceChip = `<span class="fresh-chip ${stale ? "stale" : "live"}" data-pulse>
      <span class="fresh-dot"></span>
      <span class="fresh-text"><strong>${stale ? "Pricing stale" : "Pricing live"}</strong> · synced ${escapeHtml(rel)} · <span class="fresh-abs">${escapeHtml(abs)}</span></span>
    </span>`;
  } else {
    priceChip = `<span class="fresh-chip stale"><span class="fresh-dot"></span><span class="fresh-text"><strong>Pricing unavailable</strong> · last sync unknown</span></span>`;
  }

  const evalsAsOf = tickerData.evals && tickerData.evals.asOf ? escapeHtml(tickerData.evals.asOf) : null;
  const evalChip = evalsAsOf
    ? `<span class="fresh-chip curated"><span class="fresh-dot"></span><span class="fresh-text"><strong>Evals curated</strong> · as of ${evalsAsOf}</span></span>`
    : "";

  return `<div class="markets-freshness">${priceChip}${evalChip}</div>`;
}

// --- Hero band (Cost of Intelligence Index + headline stats) ---

function renderHero(tickerData) {
  const indexValue = tickerData.indexValue;
  const indexHistory = (tickerData.indexHistory || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  let indexDelta = null;
  if (indexHistory.length >= 2) {
    const prev = indexHistory[indexHistory.length - 2].value;
    if (prev > 0) indexDelta = ((indexValue - prev) / prev) * 100;
  }
  let deltaHtml = '<span class="markets-delta flat">&mdash;</span>';
  if (indexDelta !== null && indexDelta !== 0) {
    const dir = indexDelta < 0 ? "down" : "up";
    const arrow = indexDelta < 0 ? "▼" : "▲";
    deltaHtml = `<span class="markets-delta ${dir}">${arrow} ${Math.abs(indexDelta).toFixed(1)}% 30d</span>`;
  }

  const chartInner = renderAreaChart(indexHistory, { width: 640, height: 150 });
  const chart = chartInner || `<p class="hero-chart-empty">Trend chart builds as daily price snapshots accumulate.</p>`;

  // Headline stat cards
  const priced = tickerData.models.filter((m) => m.output != null);
  const cheapest = priced.length ? priced.reduce((a, b) => (b.output < a.output ? b : a)) : null;
  const fastest = (tickerData.speed && tickerData.speed.length) ? tickerData.speed[0] : null;

  let topQuality = null, bestValue = null;
  if (tickerData.evals && tickerData.evals.models) {
    const metrics = tickerData.evals.metrics || DEFAULT_EVAL_METRICS;
    const withQ = tickerData.models
      .map((m) => ({ m, q: compositeQuality(tickerData.evals.models[m.key], metrics) }))
      .filter((x) => x.q != null);
    if (withQ.length) {
      topQuality = withQ.reduce((a, b) => (b.q > a.q ? b : a));
      const withV = withQ.filter((x) => x.m.output != null && x.m.output > 0);
      if (withV.length) bestValue = withV.reduce((a, b) => (b.q / b.m.output > a.q / a.m.output ? b : a));
    }
  }

  const card = (kicker, value, sub) => `<div class="stat-card" data-reveal>
    <p class="stat-kicker">${escapeHtml(kicker)}</p>
    <p class="stat-value">${value}</p>
    <p class="stat-sub">${escapeHtml(sub)}</p>
  </div>`;

  const cards = [
    cheapest ? card("Cheapest frontier", formatPrice(cheapest.output), `${cheapest.label} · /M out`) : "",
    topQuality ? card("Highest quality", topQuality.q.toFixed(1), `${topQuality.m.label} · Quality Index`) : "",
    bestValue ? card("Best value", bestValue.m.label, "quality per dollar") : "",
    fastest ? card("Fastest", `${formatTokPerSec(fastest.tokPerSec)} tok/s`, `${fastest.name}`) : "",
  ].filter(Boolean).join("");

  return `<section class="markets-hero" data-reveal>
    <div class="hero-index">
      <p class="section-kicker">Cost of Intelligence Index</p>
      <p class="hero-figure"><span class="coi-value" data-countup="${indexValue.toFixed(2)}" data-prefix="$" data-decimals="2">${formatPrice(indexValue)}</span><span class="hero-unit">/M tokens</span></p>
      <p class="hero-delta">${deltaHtml} <span class="hero-note">avg. output price · ${tickerData.models.length} frontier models</span></p>
      <p class="coi-methodology">Methodology: the unweighted mean of the live output price ($/M tokens) across all ${tickerData.models.length} tracked frontier models. Live from OpenRouter — no weighting, no curation.</p>
      <div class="hero-chart">${chart}</div>
    </div>
    <div class="hero-stats">${cards}</div>
  </section>`;
}

// --- Filter bar (Step 4): provider select + ranges + capability checkboxes ---
// Inert with JS off (the bar itself is display:none until .enhanced). `scope`
// distinguishes the two tables so the inline JS can wire each independently.
function renderFilterBar(scope, providers, { withSearch = false } = {}) {
  const opts = ["<option value=\"\">All providers</option>"]
    .concat(providers.map((p) => `<option value="${escapeHtml(p).replace(/"/g, "&quot;")}">${escapeHtml(p)}</option>`))
    .join("");
  const searchField = withSearch
    ? `<div class="filter-field">
        <label for="${scope}-search">Search</label>
        <input type="text" id="${scope}-search" class="catalog-search" data-filter-scope="${scope}" placeholder="model name…">
      </div>`
    : "";
  return `<div class="markets-filterbar" data-filter-scope="${scope}">
    ${searchField}
    <div class="filter-field">
      <label for="${scope}-provider">Provider</label>
      <select id="${scope}-provider" class="filter-provider">${opts}</select>
    </div>
    <div class="filter-field">
      <label for="${scope}-maxout">Max output $/M · <span class="filter-range-val" id="${scope}-maxout-val">any</span></label>
      <input type="range" id="${scope}-maxout" class="filter-maxout max-output" min="0" max="100" step="1" value="100">
    </div>
    <div class="filter-field">
      <label for="${scope}-minctx">Min context · <span class="filter-range-val" id="${scope}-minctx-val">any</span></label>
      <input type="range" id="${scope}-minctx" class="filter-minctx min-context" min="0" max="2000000" step="8000" value="0">
    </div>
    <div class="filter-field filter-caps">
      <label class="cap-check"><input type="checkbox" class="filter-cap" data-cap="tools"> tools</label>
      <label class="cap-check"><input type="checkbox" class="filter-cap" data-cap="reasoning"> reasoning</label>
      <label class="cap-check"><input type="checkbox" class="filter-cap" data-cap="structured"> structured</label>
    </div>
    <button type="button" class="filter-reset" data-filter-scope="${scope}">Reset</button>
  </div>`;
}

// --- Main renderer ---

function renderMarketsPage(tickerData, fullMarket, options = {}) {
  const basePath = options.basePath || "";

  // Quality lookup for the frontier board (composite 0–100, or null)
  const evalMetrics = (tickerData.evals && tickerData.evals.metrics) || DEFAULT_EVAL_METRICS;
  const qualityOf = (key) => (tickerData.evals && tickerData.evals.models)
    ? compositeQuality(tickerData.evals.models[key], evalMetrics)
    : null;

  // --- Hero band (index + headline stats) ---
  const heroHtml = renderHero(tickerData);

  // --- Quality desk + value frontier ---
  const evalsHtml = renderEvalsSection(tickerData);
  const valueHtml = renderValueScatter(tickerData);

  // --- Sunset Watch ---
  const sunsetHtml = renderSunsetWatch(tickerData.models);

  // --- Frontier board: price + quality merged (the main board) ---
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

    const q = qualityOf(m.key);
    const qPct = q != null ? Math.max(0, Math.min(100, q)) : 0;
    const qCell = q != null
      ? `<span class="quality-index">${q.toFixed(0)}</span><span class="bar-track q-bar-track"><span class="q-bar" style="width:${qPct.toFixed(0)}%"></span></span>`
      : '<span class="model-ctx">—</span>';

    // --- Step 0: capability + price stamping (inert with JS off) ---
    const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
    const hasTools = params.includes("tools") ? "1" : "0";
    const hasStructured = params.includes("structured_output") ? "1" : "0";
    const hasReasoning = params.includes("reasoning") ? "1" : "0";
    const dataAttrs = [
      `data-tools="${hasTools}"`,
      `data-structured="${hasStructured}"`,
      `data-reasoning="${hasReasoning}"`,
      `data-output="${m.output != null ? m.output : ""}"`,
      `data-input="${m.input != null ? m.input : ""}"`,
      `data-cache="${m.cache_read_price != null ? m.cache_read_price : ""}"`,
      `data-provider="${escapeHtml(m.provider || "").replace(/"/g, "&quot;")}"`,
      `data-label="${escapeHtml(m.label || "").replace(/"/g, "&quot;")}"`,
    ].join(" ");

    // Sortable-cell data-sort values are raw, unformatted numbers.
    const nameSort = escapeHtml(m.label || "").toLowerCase().replace(/"/g, "&quot;");
    const provSort = escapeHtml(m.provider || "").toLowerCase().replace(/"/g, "&quot;");
    const qSort = q != null ? q : -1;
    const outSort = m.output != null ? m.output : -1;
    const deltaSort = (outDelta !== null && outDelta !== undefined) ? outDelta : 0;

    const cmpId = escapeHtml(m.key || m.label || "").replace(/"/g, "&quot;");
    return `<tr data-reveal ${dataAttrs}>
      <td class="compare-col"><input type="checkbox" class="compare-checkbox" data-cmp="${cmpId}" aria-label="Compare ${escapeHtml(m.label || "")}"></td>
      ${renderModelNameCell(m, false, nameSort)}
      <td class="model-provider" data-sort="${provSort}">${escapeHtml(m.provider)}</td>
      <td class="model-quality" data-sort="${qSort}">${qCell}</td>
      ${renderInputPriceCell(m)}
      <td class="model-price price-cell" data-sort="${outSort}" data-priceval="${m.output != null ? m.output : ""}">${formatPrice(m.output)}</td>
      <td class="model-delta" data-sort="${deltaSort}">${deltaHtml}</td>
      ${renderCtxCell(m)}
      <td class="model-spark">${sparkline}</td>
    </tr>`;
  }).join("\n");

  const frontierProviders = Array.from(new Set(tickerData.models.map((m) => m.provider).filter(Boolean))).sort();
  const frontierFilterBar = renderFilterBar("frontier", frontierProviders);
  const unitToggle = `<label class="unit-toggle-wrap">
    <input type="checkbox" id="unit-toggle" class="unit-toggle"> show prices per 1k tokens
  </label>`;

  const pricingTableHtml = `<section class="markets-section" data-reveal>
    <div class="section-head">
      <p class="section-kicker">Pricing Desk</p>
      <h2 class="markets-section-title">Frontier Board</h2>
      <span class="provenance-tag mixed">Price live · quality curated</span>
    </div>
    <p class="markets-section-desc">Per <span class="price-unit-label">1M</span> tokens &middot; prices from OpenRouter, updated daily &middot; Quality Index from the curated evals.</p>
    ${unitToggle}
    ${frontierFilterBar}
    <p class="filter-empty" data-filter-empty="frontier">No models match these filters.</p>
    <div class="markets-table-wrap">
      <table class="markets-table frontier-board">
        <thead><tr>
          <th class="compare-col" aria-label="Compare"></th><th class="sortable" aria-sort="none">Model</th><th class="sortable" aria-sort="none">Provider</th><th class="sortable" aria-sort="none" title="Composite quality, 0–100">Quality</th><th class="sortable" aria-sort="none">Input</th><th class="sortable" aria-sort="none">Output</th><th class="sortable" aria-sort="none">24h</th><th class="sortable" aria-sort="none">Context</th><th>30d</th>
        </tr></thead>
        <tbody>${modelRows}</tbody>
      </table>
    </div>
    <div class="compare-strip" id="compare-strip" aria-live="polite"></div>
  </section>`;

  // --- Cost calculator (Step 3): reads stamped row prices, computes via monthlyCost ---
  const calcHtml = `<section class="markets-section cost-calc" data-reveal>
    <div class="section-head">
      <p class="section-kicker">Cost Desk</p>
      <h2 class="markets-section-title">What will it cost?</h2>
      <span class="provenance-tag">Price live</span>
    </div>
    <p class="markets-section-desc">Estimate each tracked model's monthly bill at your volume. Cache-aware. Live prices only — curated quality is never used here.</p>
    <form class="cost-calc-form" id="cost-calc-form">
      <div class="filter-field">
        <label for="calc-inM">Input · M tokens/day</label>
        <input type="number" id="calc-inM" name="inM" min="0" step="0.1" value="1">
      </div>
      <div class="filter-field">
        <label for="calc-outM">Output · M tokens/day</label>
        <input type="number" id="calc-outM" name="outM" min="0" step="0.1" value="0.5">
      </div>
      <div class="filter-field">
        <label for="calc-cached">Cached input · <span class="filter-range-val" id="calc-cached-val">0%</span></label>
        <input type="range" id="calc-cached" name="cachedPct" min="0" max="100" step="5" value="0">
      </div>
    </form>
    <ol class="cost-results" id="cost-results" aria-live="polite"></ol>
  </section>`;

  // --- New on the Market ---
  const newModelsHtml = renderNewModelsSection(tickerData, fullMarket);

  // --- On Our Radar (auto-detected untracked frontier models) ---
  const radarHtml = renderRadarSection(tickerData.untracked);

  // --- Speed Leaderboard ---
  const speedRows = tickerData.speed.map((s, i) => {
    const bar = Math.round((s.tokPerSec / 2500) * 100);
    return `<tr data-reveal>
      <td class="speed-rank">${i + 1}</td>
      <td class="speed-provider">${escapeHtml(s.name)}</td>
      <td class="speed-model">${escapeHtml(s.model)}</td>
      <td class="speed-value">${formatTokPerSec(s.tokPerSec)} tok/s</td>
      <td class="speed-bar"><div class="bar-track"><div class="bar-fill" style="width:${Math.min(bar, 100)}%"></div></div></td>
    </tr>`;
  }).join("\n");

  const speedHtml = `<section class="markets-section" data-reveal>
    <div class="section-head">
      <p class="section-kicker">Speed Desk</p>
      <h2 class="markets-section-title">Inference Speed Leaderboard</h2>
      <span class="provenance-tag curated">Curated benchmarks</span>
    </div>
    <p class="markets-section-desc">Output tokens per second &middot; fastest hosted providers.</p>
    <div class="markets-table-wrap">
      <table class="markets-table">
        <thead><tr><th>#</th><th>Provider</th><th>Model</th><th>Speed</th><th></th></tr></thead>
        <tbody>${speedRows}</tbody>
      </table>
    </div>
  </section>`;

  // --- Image Generation ---
  const imageRows = tickerData.images.map((img) => {
    return `<tr data-reveal>
      <td class="img-name">${escapeHtml(img.name)}</td>
      <td class="img-price">${formatPrice(img.price)}/img</td>
      <td class="img-grade"><span class="grade-badge">${escapeHtml(img.grade)}</span></td>
    </tr>`;
  }).join("\n");

  const imageHtml = `<section class="markets-section" data-reveal>
    <div class="section-head">
      <p class="section-kicker">Image Desk</p>
      <h2 class="markets-section-title">Image Generation</h2>
      <span class="provenance-tag curated">Curated · editorial grades</span>
    </div>
    <p class="markets-section-desc">Cost per image &middot; editorial quality grades.</p>
    <div class="markets-table-wrap">
      <table class="markets-table">
        <thead><tr><th>Model</th><th>Price</th><th>Grade</th></tr></thead>
        <tbody>${imageRows}</tbody>
      </table>
    </div>
  </section>`;

  // --- All Models by Provider ---
  let catalogHtml = "";
  if (fullMarket && fullMarket.length > 0) {
    const providerMap = {};
    for (const m of fullMarket) {
      const provider = m.id.split("/")[0];
      if (!providerMap[provider]) providerMap[provider] = [];
      providerMap[provider].push(m);
    }

    for (const provider of Object.keys(providerMap)) {
      providerMap[provider].sort((a, b) => b.output - a.output);
    }

    const trackedKeys = new Set(TRACKED_MODELS.map((t) => t.openrouterId));
    const sortedProviders = Object.keys(providerMap).sort(
      (a, b) => providerMap[b][0].output - providerMap[a][0].output
    );

    // Catalog rows carry the same filter data-* as the Frontier Board so the
    // inline JS can apply provider/range/capability/search filters here too.
    const catalogRowAttrs = (m, provider) => {
      const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
      return [
        `data-tools="${params.includes("tools") ? "1" : "0"}"`,
        `data-structured="${params.includes("structured_output") ? "1" : "0"}"`,
        `data-reasoning="${params.includes("reasoning") ? "1" : "0"}"`,
        `data-output="${m.output != null ? m.output : ""}"`,
        `data-input="${m.input != null ? m.input : ""}"`,
        `data-cache="${m.cache_read_price != null ? m.cache_read_price : ""}"`,
        `data-provider="${escapeHtml(provider || "").replace(/"/g, "&quot;")}"`,
        `data-label="${escapeHtml(m.name || "").toLowerCase().replace(/"/g, "&quot;")}"`,
      ].join(" ");
    };

    const providerGroups = sortedProviders.map((provider) => {
      const models = providerMap[provider];
      const flagship = models.find((m) => trackedKeys.has(m.id)) || models[0];
      const rest = models.filter((m) => m !== flagship);

      const flagshipRow = `<table class="markets-table">
        <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Context</th></tr></thead>
        <tbody><tr class="provider-flagship catalog-row" ${catalogRowAttrs(flagship, provider)}>
          ${renderModelNameCell(flagship, true)}
          ${renderInputPriceCell(flagship)}
          <td class="model-price price-cell" data-priceval="${flagship.output != null ? flagship.output : ""}">${formatPrice(flagship.output)}</td>
          ${renderCtxCell(flagship)}
        </tr></tbody>
      </table>`;

      let detailsHtml = "";
      if (rest.length > 0) {
        const restRows = rest.map((m) => `<tr class="catalog-row" ${catalogRowAttrs(m, provider)}>
          ${renderModelNameCell(m, true)}
          ${renderInputPriceCell(m)}
          <td class="model-price price-cell" data-priceval="${m.output != null ? m.output : ""}">${formatPrice(m.output)}</td>
          ${renderCtxCell(m)}
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

    const catalogProviders = sortedProviders.slice().sort();
    const catalogFilterBar = renderFilterBar("catalog", catalogProviders, { withSearch: true });
    catalogHtml = `${catalogFilterBar}
      <p class="filter-empty" data-filter-empty="catalog">No models match these filters.</p>
      <div class="provider-groups">${providerGroups}</div>`;
  }

  // --- Progressive disclosure: "More from the desk" ---
  const moreItems = [
    newModelsHtml ? { title: "New on the Market", body: newModelsHtml } : null,
    radarHtml ? { title: "On Our Radar", body: radarHtml } : null,
    catalogHtml ? { title: `All Models by Provider — ${fullMarket.length} across ${Object.keys((fullMarket || []).reduce((a, m) => { a[m.id.split("/")[0]] = 1; return a; }, {})).length} providers`, body: catalogHtml } : null,
  ].filter(Boolean);

  // The disclosed sections already carry their own <h2> titles (kept for tests
  // and deep links); the <summary> gives a compact entry point.
  const moreHtml = moreItems.length
    ? `<section class="markets-section markets-more" data-reveal>
        <div class="section-head">
          <p class="section-kicker">The Archive</p>
          <h2 class="markets-section-title">More from the desk</h2>
        </div>
        ${moreItems.map((it) => `<details class="desk-details">
          <summary>${escapeHtml(it.title)}</summary>
          <div class="desk-details-body">${it.body}</div>
        </details>`).join("\n")}
      </section>`
    : "";

  // --- Assemble ---
  const contentHtml = [
    heroHtml,
    sunsetHtml,
    evalsHtml,
    valueHtml,
    pricingTableHtml,
    calcHtml,
    speedHtml,
    imageHtml,
    moreHtml,
  ].filter(Boolean).join("\n");

  const freshnessHtml = buildFreshness(tickerData);

  return applyTemplate("markets", basePath)
    .replace("{{MARKETS_FRESHNESS}}", freshnessHtml)
    .replace("{{MARKETS_CONTENT}}", contentHtml);
}

module.exports = {
  renderMarketsPage,
  renderModalityBadges,
  renderFeatureBadges,
  renderSunsetWatch,
  renderNewModelsSection,
  renderRadarSection,
  renderEvalsSection,
  renderValueScatter,
  buildFreshness,
  compositeQuality,
  monthlyCost,
  timeAgo,
};
