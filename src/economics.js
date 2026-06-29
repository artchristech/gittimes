"use strict";

/**
 * AI Desk unit economics.
 *
 * Answers two questions the product needs to stay honest about:
 *   1. Is the paid plan profitable — at typical use AND at the usage cap?
 *   2. What does a reader's $5 actually buy, so we can show it to them?
 *
 * Everything is a pure function of (model price, usage assumptions). Prices are
 * $/1M tokens, matching data/ai-models.json (`input`, `output`, `cache_read_price`).
 * Run `node src/economics.js` for a live table off the synced catalog.
 */

const fs = require("fs");
const path = require("path");

// Token + usage assumptions. These are deliberately conservative (they
// over-estimate cost) so the margins we quote are floors, not hopes.
const DEFAULT_ASSUMPTIONS = {
  // A turn = system prompt + recent history + the article/section context the
  // client already sends (up to ~4000 chars ≈ 1000 tok) + the completion.
  inputTokensPerTurn: 2000, // system (~800) + context (~1000) + short history
  outputTokensPerTurn: 400,
  // RAG grounding adds the retrieved corpus chunks to the input (top-k snippets).
  ragInputTokens: 1500,
  // Tool-use: each round trips a full input pass + a tool-call/answer completion.
  // 0 = plain chat; raise to model the cost of the agentic repo/compare paths.
  toolCallRounds: 0,
  toolRoundOutputTokens: 150,

  // Plan shape (mirrors worker/wrangler.toml).
  freeTurnsPerDay: 3,
  daysPerMonth: 30,
  premiumTypicalTurnsPerMonth: 40, // what an engaged premium reader actually does
  premiumCapTurnsPerMonth: 1000, // CHAT_MONTHLY_LIMIT — the abuse ceiling
  priceMonthlyUsd: 5,

  // Stripe take on a $5 charge: 2.9% + $0.30.
  stripePct: 0.029,
  stripeFixedUsd: 0.3,

  // Fraction of input that is cache-hit (repeated system prompt + corpus).
  // 0 = price all input at full rate. The worker doesn't yet send cache hints,
  // so default 0 keeps the estimate honest.
  cachedInputFraction: 0,
};

function round(n, dp) {
  const f = Math.pow(10, dp == null ? 4 : dp);
  return Math.round(n * f) / f;
}

/**
 * Cost of a single chat turn for a given model.
 * model: { input, output, cache_read_price } in $/1M tokens.
 */
function costPerTurn(model, opts) {
  const a = Object.assign({}, DEFAULT_ASSUMPTIONS, opts);
  const inPrice = Number(model.input) || 0;
  const outPrice = Number(model.output) || 0;
  const cachePrice = model.cache_read_price != null ? Number(model.cache_read_price) : inPrice;

  const baseInput = a.inputTokensPerTurn + a.ragInputTokens;
  // Tool rounds re-send the growing input; approximate each extra round as one
  // more full input pass plus a small tool-call completion.
  const toolInput = a.toolCallRounds * baseInput;
  const totalInput = baseInput + toolInput;

  const cachedInput = totalInput * a.cachedInputFraction;
  const freshInput = totalInput - cachedInput;

  const totalOutput = a.outputTokensPerTurn + a.toolCallRounds * a.toolRoundOutputTokens;

  const inputUsd = (freshInput * inPrice + cachedInput * cachePrice) / 1e6;
  const outputUsd = (totalOutput * outPrice) / 1e6;
  return { inputUsd, outputUsd, totalUsd: inputUsd + outputUsd };
}

/** Stripe fee on the monthly charge. */
function stripeFee(a) {
  return a.priceMonthlyUsd * a.stripePct + a.stripeFixedUsd;
}

/** Largest monthly turn cap that still clears `targetMarginPct` of net revenue. */
function safeCapForMargin(model, opts, targetMarginPct) {
  const a = Object.assign({}, DEFAULT_ASSUMPTIONS, opts);
  const net = a.priceMonthlyUsd - stripeFee(a);
  const perTurn = costPerTurn(model, a).totalUsd;
  if (perTurn <= 0) return Infinity;
  const budget = net * (1 - targetMarginPct); // $ we can spend on LLM
  return Math.floor(budget / perTurn);
}

/** Full plan economics for one model. */
function planEconomics(model, opts) {
  const a = Object.assign({}, DEFAULT_ASSUMPTIONS, opts);
  const perTurn = costPerTurn(model, a).totalUsd;

  const freeTurnsPerMonth = a.freeTurnsPerDay * a.daysPerMonth;
  const freeUserMonthlyCostUsd = perTurn * freeTurnsPerMonth;

  const premiumTypicalCostUsd = perTurn * a.premiumTypicalTurnsPerMonth;
  const premiumCapCostUsd = perTurn * a.premiumCapTurnsPerMonth;

  const fee = stripeFee(a);
  const netRevenueUsd = a.priceMonthlyUsd - fee;

  const marginTypicalUsd = netRevenueUsd - premiumTypicalCostUsd;
  const marginCapUsd = netRevenueUsd - premiumCapCostUsd;

  return {
    model: model.label || model.id || model.key || "model",
    inputPerM: Number(model.input) || 0,
    outputPerM: Number(model.output) || 0,
    costPerTurnUsd: round(perTurn, 6),
    questionsPer5Dollars: perTurn > 0 ? Math.floor(netRevenueUsd / perTurn) : Infinity,

    freeUserMonthlyCostUsd: round(freeUserMonthlyCostUsd, 4),
    premiumTypicalCostUsd: round(premiumTypicalCostUsd, 4),
    premiumCapCostUsd: round(premiumCapCostUsd, 4),

    stripeFeeUsd: round(fee, 4),
    netRevenueUsd: round(netRevenueUsd, 4),
    marginTypicalUsd: round(marginTypicalUsd, 4),
    marginCapUsd: round(marginCapUsd, 4),
    marginCapPct: netRevenueUsd > 0 ? round((marginCapUsd / netRevenueUsd) * 100, 1) : 0,
    profitableAtCap: marginCapUsd > 0,

    // Conversion needed for the free tier to pay for itself: 1 premium reader's
    // typical-use margin must cover N free readers' burn.
    freeUsersPerPaidUser:
      freeUserMonthlyCostUsd > 0 ? Math.floor(marginTypicalUsd / freeUserMonthlyCostUsd) : Infinity,

    // The cap that holds an 80% gross margin even for a power user.
    safeCapAt80Margin: safeCapForMargin(model, a, 0.8),
  };
}

/**
 * User-facing transparency: what each plan is for and what $5 buys. This is the
 * shape the account/pricing UI renders — no internal cost figures leak.
 */
function userFacingPlan(model, opts) {
  const a = Object.assign({}, DEFAULT_ASSUMPTIONS, opts);
  return {
    free: {
      price: "$0",
      questionsPerDay: a.freeTurnsPerDay,
      bestFor:
        "A daily taste — ask about today's lead story or a single repo. Best when you have one or two quick questions.",
    },
    premium: {
      price: `$${a.priceMonthlyUsd}/mo`,
      questionsPerMonth: a.premiumCapTurnsPerMonth,
      bestFor:
        "Deep research across editions, side-by-side repo/model comparisons, and reading a repo's README/releases inline. Best when the AI Desk is part of how you decide what to adopt.",
      // Honest framing of the cap: effectively unlimited for real use.
      capNote: `${a.premiumCapTurnsPerMonth.toLocaleString()} questions/mo — about ${Math.round(
        a.premiumCapTurnsPerMonth / a.daysPerMonth
      )}/day, more than any reader uses.`,
    },
  };
}

/** Build a CLI/report table across candidate models. */
function report(models, opts) {
  return models.map((m) => planEconomics(m, opts));
}

// --- CLI: live table off the synced catalog ---
function loadCatalogModels(ids) {
  const p = path.join(__dirname, "..", "data", "ai-models.json");
  const cat = JSON.parse(fs.readFileSync(p, "utf8")).catalog || [];
  const byId = (id) => cat.find((m) => (m.openrouterId || m.id || m.key) === id);
  return ids.map((id) => Object.assign({ label: id }, byId(id) || {})).filter((m) => m.input != null);
}

function fmtUsd(n) {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

if (require.main === module) {
  const candidates = [
    "openai/gpt-4o-mini", // currently deployed
    "anthropic/claude-haiku-4.5",
    "x-ai/grok-4.20",
    "google/gemini-3.5-flash",
    "openai/gpt-5.5", // frontier — shows where the cap breaks
  ];
  const ragOn = process.argv.includes("--no-rag")
    ? { ragInputTokens: 0 }
    : {};
  const rows = report(loadCatalogModels(candidates), ragOn);
  console.log(
    "\nAI Desk economics — $5/mo plan, " +
      (ragOn.ragInputTokens === 0 ? "plain chat" : "with RAG grounding") +
      `\nassuming ${DEFAULT_ASSUMPTIONS.inputTokensPerTurn}+${DEFAULT_ASSUMPTIONS.ragInputTokens} in / ${DEFAULT_ASSUMPTIONS.outputTokensPerTurn} out tokens per turn\n`
  );
  const header = [
    "model".padEnd(24),
    "$/turn".padStart(9),
    "Q/$5".padStart(7),
    "free/mo".padStart(8),
    "cap cost".padStart(9),
    "cap margin".padStart(11),
    "safe cap@80%".padStart(13),
  ].join("  ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of rows) {
    console.log(
      [
        String(r.model).slice(0, 24).padEnd(24),
        fmtUsd(r.costPerTurnUsd).padStart(9),
        String(r.questionsPer5Dollars).padStart(7),
        fmtUsd(r.freeUserMonthlyCostUsd).padStart(8),
        fmtUsd(r.premiumCapCostUsd).padStart(9),
        (fmtUsd(r.marginCapUsd) + (r.profitableAtCap ? "" : " ⚠")).padStart(11),
        String(r.safeCapAt80Margin).padStart(13),
      ].join("  ")
    );
  }
  console.log(
    "\nNet revenue after Stripe on $5 = " +
      fmtUsd(planEconomics(rows[0] && { input: 0, output: 0 }, {}).netRevenueUsd) +
      ". 'safe cap@80%' = max questions/mo that still clears an 80% margin.\n"
  );
}

module.exports = {
  DEFAULT_ASSUMPTIONS,
  costPerTurn,
  stripeFee,
  safeCapForMargin,
  planEconomics,
  userFacingPlan,
  report,
};
