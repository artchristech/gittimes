"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { renderPricingPage } = require("../src/pricing");
const { DEFAULT_ASSUMPTIONS } = require("../src/economics");

test("renderPricingPage — complete HTML, no unreplaced placeholders", () => {
  const html = renderPricingPage({ basePath: "" });
  assert.match(html, /<!DOCTYPE html>/i);
  assert.equal(html.match(/\{\{[A-Z_]+\}\}/g), null, "all template placeholders replaced");
});

test("renderPricingPage — shows both plans with real numbers from assumptions", () => {
  const html = renderPricingPage({ basePath: "" });
  assert.match(html, /class="plan-name">Free/);
  assert.match(html, /class="plan-name">Premium/);
  assert.ok(html.includes(`$${DEFAULT_ASSUMPTIONS.priceMonthlyUsd}`), "premium price present");
  assert.ok(html.includes(`${DEFAULT_ASSUMPTIONS.freeTurnsPerDay} AI questions per day`), "free daily limit present");
  assert.ok(html.includes(DEFAULT_ASSUMPTIONS.premiumCapTurnsPerMonth.toLocaleString()), "monthly cap shown");
});

test("renderPricingPage — lists the four AI Desk features and links account + markets", () => {
  const html = renderPricingPage({ basePath: "" });
  assert.equal((html.match(/class="feature"/g) || []).length, 4);
  assert.match(html, /Grounded answers, cited/);
  assert.match(html, /Side-by-side compares/);
  assert.match(html, /href="\/account\/"/);
  assert.match(html, /href="\/markets\/"/);
});

test("renderPricingPage — honors basePath", () => {
  const html = renderPricingPage({ basePath: "/preview" });
  assert.match(html, /href="\/preview\/account\/"/);
});
