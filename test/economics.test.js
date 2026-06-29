"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const {
  costPerTurn,
  stripeFee,
  safeCapForMargin,
  planEconomics,
  userFacingPlan,
  DEFAULT_ASSUMPTIONS,
} = require("../src/economics");

const CHEAP = { label: "gpt-4o-mini", input: 0.15, output: 0.6, cache_read_price: 0.075 };
const FRONTIER = { label: "gpt-5.5", input: 5, output: 30, cache_read_price: 0.5 };

test("costPerTurn — explicit arithmetic with RAG off and tools off", () => {
  const a = { ragInputTokens: 0, toolCallRounds: 0, cachedInputFraction: 0, inputTokensPerTurn: 2000, outputTokensPerTurn: 400 };
  const c = costPerTurn(CHEAP, a);
  // 2000 in * 0.15/M = 0.0003 ; 400 out * 0.6/M = 0.00024
  assert.ok(Math.abs(c.inputUsd - 0.0003) < 1e-9, `inputUsd=${c.inputUsd}`);
  assert.ok(Math.abs(c.outputUsd - 0.00024) < 1e-9, `outputUsd=${c.outputUsd}`);
  assert.ok(Math.abs(c.totalUsd - 0.00054) < 1e-9, `totalUsd=${c.totalUsd}`);
});

test("costPerTurn — RAG grounding raises input cost", () => {
  const off = costPerTurn(CHEAP, { ragInputTokens: 0 }).totalUsd;
  const on = costPerTurn(CHEAP, { ragInputTokens: 1500 }).totalUsd;
  assert.ok(on > off, "grounding should cost more");
  // extra = 1500 * 0.15/M = 0.000225
  assert.ok(Math.abs(on - off - 0.000225) < 1e-9, `delta=${on - off}`);
});

test("costPerTurn — tool rounds multiply input passes", () => {
  const zero = costPerTurn(CHEAP, { toolCallRounds: 0 }).totalUsd;
  const two = costPerTurn(CHEAP, { toolCallRounds: 2 }).totalUsd;
  assert.ok(two > zero * 2, "two tool rounds should more than double a turn");
});

test("stripeFee — 2.9% + $0.30 on a $5 charge", () => {
  const fee = stripeFee(DEFAULT_ASSUMPTIONS);
  assert.ok(Math.abs(fee - (5 * 0.029 + 0.3)) < 1e-9, `fee=${fee}`);
});

test("planEconomics — cheap model is profitable at the 1000 cap", () => {
  const p = planEconomics(CHEAP, {});
  assert.equal(p.profitableAtCap, true);
  assert.ok(p.marginCapUsd > 3, `expected healthy margin, got ${p.marginCapUsd}`);
  assert.ok(p.safeCapAt80Margin > 1000, `cheap model should sustain >1000 at 80%, got ${p.safeCapAt80Margin}`);
});

test("planEconomics — frontier model LOSES money at the 1000 cap", () => {
  const p = planEconomics(FRONTIER, {});
  assert.equal(p.profitableAtCap, false);
  assert.ok(p.marginCapUsd < 0, `expected loss, got ${p.marginCapUsd}`);
  // A frontier model's safe cap must be far below 1000.
  assert.ok(p.safeCapAt80Margin < 100, `frontier safe cap should be small, got ${p.safeCapAt80Margin}`);
});

test("safeCapForMargin — higher target margin yields a lower cap", () => {
  const at50 = safeCapForMargin(CHEAP, {}, 0.5);
  const at90 = safeCapForMargin(CHEAP, {}, 0.9);
  assert.ok(at50 > at90, `looser margin should allow more turns: ${at50} vs ${at90}`);
});

test("safeCapForMargin — a turn priced into the cap exactly clears the margin", () => {
  const target = 0.8;
  const cap = safeCapForMargin(CHEAP, {}, target);
  const net = DEFAULT_ASSUMPTIONS.priceMonthlyUsd - stripeFee(DEFAULT_ASSUMPTIONS);
  const perTurn = costPerTurn(CHEAP, {}).totalUsd;
  const marginAtCap = (net - cap * perTurn) / net;
  assert.ok(marginAtCap >= target - 1e-6, `margin at cap ${marginAtCap} should clear ${target}`);
  // One past the cap should dip below the target.
  const marginPast = (net - (cap + 1) * perTurn) / net;
  assert.ok(marginPast < target + 1e-9, "cap should be the boundary");
});

test("questionsPer5Dollars — cheap model buys far more than frontier", () => {
  const cheap = planEconomics(CHEAP, {});
  const frontier = planEconomics(FRONTIER, {});
  assert.ok(cheap.questionsPer5Dollars > frontier.questionsPer5Dollars * 10);
});

test("userFacingPlan — leaks no internal cost figures", () => {
  const ui = userFacingPlan(CHEAP, {});
  const json = JSON.stringify(ui);
  assert.ok(/questionsPerDay/.test(json));
  assert.ok(/bestFor/.test(json));
  assert.ok(!/cost/i.test(json) || !/Usd/.test(json), "user-facing object must not expose Usd cost fields");
  assert.equal(ui.free.questionsPerDay, DEFAULT_ASSUMPTIONS.freeTurnsPerDay);
});

test("zero-priced model never reports a loss (guards divide-by-zero)", () => {
  const free = planEconomics({ label: "free", input: 0, output: 0 }, {});
  assert.equal(free.profitableAtCap, true);
  assert.equal(free.questionsPer5Dollars, Infinity);
  assert.equal(safeCapForMargin({ input: 0, output: 0 }, {}, 0.8), Infinity);
});
