/**
 * The Price Board — what the labs charge, and who moved.
 *
 * WHY THIS DESK EXISTS. The Big Labs ledger measures release cadence, and
 * cadence is a signal about how chatty a repo's CI is, not about what a company
 * did: on live data it surfaced `trl v1.10.0` and `langchain-openai==1.5.0`.
 * Price is the opposite kind of number — dated, numeric, adversarial, and
 * decision-relevant. A price cut is strategy made public. DeepSeek cut to $0.19
 * before shipping V4; the cut was the tell, and no cadence table could see it.
 *
 * The data has been in the repo the whole time and no desk read it:
 * `sync-models.js` writes a daily price tape into `model_prices` — never
 * pruned, keyed on the upstream OpenRouter id, and carrying promo metadata.
 * This turns that tape into a board and attributes each row to a registry
 * company, so a price move lands on the lab's file alongside what it shipped.
 *
 * IDENTITY. Rows join on `model_id`, not on our curated roster key. The key is
 * an editorial label that can be re-cut at the desk; the id is assigned
 * upstream and is stable for a model's whole life. Note what this does NOT do:
 * successive models are never joined. `claude-sonnet-4.6` and
 * `claude-sonnet-5` are different products at different price points, and
 * differencing them would manufacture a "price move" out of a product launch.
 * A retired model's series simply ends, and a new model's begins.
 *
 * SOURCING DISCIPLINE. Same contract as the other desks: no number without a
 * record behind it. The rolling window is genuinely sparse — snapshots only
 * exist for days the paper published — so a model with no old-enough baseline
 * is reported as `noBaseline`, never as 0% / "flat". Rendering an unknown as
 * "unchanged" would be the price-desk version of calling OpenAI quiet.
 *
 * Pure and I/O-free.
 */

const { SEED_ENTITIES, buildAliasIndex, resolveEntityRef } = require("./registry");

// A baseline younger than this is same-week noise, not a trend — comparing
// today against yesterday would print churn as movement.
const MIN_BASELINE_DAYS = 3;
// Below this, a change is rounding in the upstream feed rather than a decision.
const MATERIAL_PCT = 1;

const DIR_CUT = "cut";
const DIR_HIKE = "hike";
const DIR_FLAT = "flat";
const DIR_UNKNOWN = "unknown";
// Not a price decision: an advertised introductory period ending.
const DIR_PROMO_END = "promo-end";

const dayMs = 86400000;

function ageDaysOf(dateStr, nowMs) {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(t)) return Infinity;
  return (nowMs - t) / dayMs;
}

/**
 * Pick the comparison snapshot: the OLDEST entry still inside the window, so
 * the board compares across as much of the window as the history actually
 * holds. Returns null when nothing is old enough to be a fair baseline.
 * @param {Array} history - [{ date, models: [{key,input,output}] }]
 */
function pickBaseline(history, windowDays, nowMs) {
  if (!Array.isArray(history)) return null;
  const eligible = history
    .filter((h) => h && typeof h.date === "string" && Array.isArray(h.models))
    .map((h) => ({ h, age: ageDaysOf(h.date, nowMs) }))
    .filter((x) => x.age >= MIN_BASELINE_DAYS && x.age <= windowDays);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => b.age - a.age);
  return eligible[0].h;
}

const pct = (now, then) => (then > 0 ? ((now - then) / then) * 100 : null);

/** Which way, and is it big enough to be a decision rather than rounding. */
function direction(changePct) {
  if (changePct == null || !Number.isFinite(changePct)) return DIR_UNKNOWN;
  if (Math.abs(changePct) < MATERIAL_PCT) return DIR_FLAT;
  return changePct < 0 ? DIR_CUT : DIR_HIKE;
}

/**
 * The owner segment of an OpenRouter id (`anthropic/claude-fable-5`), which is
 * the most reliable lab attribution available — a `provider` label is free text
 * upstream, an id prefix is not.
 */
function labRefFor(model) {
  if (model.openrouterId && String(model.openrouterId).includes("/")) {
    return String(model.openrouterId).split("/")[0];
  }
  return model.provider || model.key || "";
}

/**
 * Build the board.
 * @param {object} args
 * @param {Array} args.models - current tracked models: { key, label, provider, openrouterId, input, output }
 * @param {Array} args.history - ai-ticker rolling history
 * @param {object} [args.opts] - { windowDays, nowMs, entities }
 * @returns {{ rows: Array, baselineDate: string|null, windowDays: number, covered: number, uncovered: number }}
 */
function buildPriceBoard(args = {}) {
  const { models = [], history = [] } = args;
  const { windowDays = 30, nowMs = Date.now(), entities = SEED_ENTITIES } = args.opts || {};

  const index = buildAliasIndex(entities);
  const baseline = pickBaseline(history, windowDays, nowMs);
  // Indexed by BOTH identities. The id is primary and is what makes a series
  // survive a desk relabel; the key is kept as a fallback because the rolling
  // ticker JSON (the degraded source when the tape is empty) only records keys.
  // Ids are namespaced `owner/model`, so the two spaces cannot collide.
  const prev = new Map();
  for (const m of baseline ? baseline.models : []) {
    if (!m) continue;
    if (m.id) prev.set(m.id, m);
    if (m.key && !prev.has(m.key)) prev.set(m.key, m);
  }

  const rows = models
    .filter((m) => m && m.key && Number.isFinite(m.input) && Number.isFinite(m.output))
    .map((m) => {
      const identity = m.openrouterId || m.id || m.key;
      const was = prev.get(identity) || (m.key ? prev.get(m.key) : undefined);
      const inputPct = was && Number.isFinite(was.input) ? pct(m.input, was.input) : null;
      const outputPct = was && Number.isFinite(was.output) ? pct(m.output, was.output) : null;
      // Output price is the one that dominates a real bill, so it decides the
      // row's direction; input is shown but does not drive the ranking.
      const movePct = outputPct != null ? outputPct : inputPct;
      const noBaseline = was == null || movePct == null;

      // A promotional period ending looks EXACTLY like a price rise from two
      // snapshots: the number goes up and nothing else changes. It is not a
      // decision to charge more, it is the advertised end of a discount, and
      // reporting it as "raised prices 50%" would be a fabricated finding
      // about a real company. The tape records `is_promotional` and the list
      // price precisely so the board can tell them apart.
      const promoLapsed =
        !noBaseline &&
        movePct > 0 &&
        was.isPromotional === true &&
        m.isPromotional !== true;

      return {
        key: m.key,
        id: identity,
        label: m.label || m.key,
        entityId: resolveEntityRef(labRefFor(m), index),
        lab: m.provider || labRefFor(m),
        input: m.input,
        output: m.output,
        wasInput: was && Number.isFinite(was.input) ? was.input : null,
        wasOutput: was && Number.isFinite(was.output) ? was.output : null,
        inputPct,
        outputPct,
        movePct: noBaseline ? null : movePct,
        direction: noBaseline ? DIR_UNKNOWN : promoLapsed ? DIR_PROMO_END : direction(movePct),
        promoLapsed,
        promoEndsOn: (was && was.promoEndsOn) || m.promoEndsOn || null,
        // Explicit, not implied: an unknown is never rendered as "unchanged".
        noBaseline,
        evidence: {
          source: "openrouter:/api/v1/models via sync-models.js",
          ref: m.openrouterId || m.key,
          baselineDate: baseline ? baseline.date : null,
        },
      };
    })
    // Biggest movers first; cuts ahead of hikes at equal size because a cut is
    // the more consequential signal. Unbaselined rows sink to the bottom rather
    // than being dropped — the board should show its own coverage.
    .sort((a, b) => {
      if (a.noBaseline !== b.noBaseline) return a.noBaseline ? 1 : -1;
      const am = Math.abs(a.movePct || 0);
      const bm = Math.abs(b.movePct || 0);
      if (bm !== am) return bm - am;
      if (a.direction !== b.direction) return a.direction === DIR_CUT ? -1 : 1;
      return a.output - b.output;
    });

  return {
    rows,
    baselineDate: baseline ? baseline.date : null,
    baselineAgeDays: baseline ? Math.round(ageDaysOf(baseline.date, nowMs)) : null,
    windowDays,
    covered: rows.filter((r) => !r.noBaseline).length,
    uncovered: rows.filter((r) => r.noBaseline).length,
    movers: rows.filter((r) => r.direction === DIR_CUT || r.direction === DIR_HIKE),
    promoEndings: rows.filter((r) => r.direction === DIR_PROMO_END),
  };
}

/**
 * The one-line front-page/strip summary. Names the biggest move, or says the
 * board is quiet — never invents a mover.
 */
function priceHeadline(board) {
  const top = (board.movers || [])[0];
  if (!top) {
    return board.covered > 0
      ? `No material price moves across ${board.covered} tracked models`
      : "No price baseline in the window yet";
  }
  const verb = top.direction === DIR_CUT ? "cut" : "raised";
  return `${top.lab} ${verb} ${top.label} ${Math.abs(top.movePct).toFixed(0)}% to $${top.output}/Mtok out`;
}

module.exports = {
  buildPriceBoard,
  priceHeadline,
  pickBaseline,
  direction,
  MIN_BASELINE_DAYS,
  MATERIAL_PCT,
  DIR_CUT,
  DIR_HIKE,
  DIR_PROMO_END,
  DIR_FLAT,
  DIR_UNKNOWN,
};
