"use strict";

const { applyTemplate } = require("./template-utils");
const { userFacingPlan, DEFAULT_ASSUMPTIONS } = require("./economics");

// What the AI Desk can do — the product, in four lines.
const FEATURES = [
  { title: "Grounded answers, cited", body: "Every answer retrieves relevant Git Times coverage and links it inline as [1], [2] — so you can check the source, not just trust the tone." },
  { title: "Reasoning you can read", body: "Flip on reasoning mode and watch the desk think before it answers — what it found, what it weighed, what it’s unsure about." },
  { title: "Repo intelligence", body: "Ask about any repo and the desk reads its README, files, and recent releases live from GitHub to answer with specifics." },
  { title: "Side-by-side compares", body: "“Compare React and Vue,” or two models on price and context — the desk pulls the facts for both and lays out the trade-offs." },
];

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderPlans(basePath, plan) {
  const acct = `${basePath}/account/`;
  const freeItems = [
    `${plan.free.questionsPerDay} AI questions per day`,
    "Cited, grounded answers",
    "Readable reasoning mode",
    "Repo lookups & comparisons",
  ];
  const premiumItems = [
    `${plan.premium.questionsPerMonth.toLocaleString()} questions/mo — effectively unlimited`,
    "Everything in Free",
    "Deep, multi-step research across editions",
    "Conversation that follows you across devices",
  ];
  const li = (items, mutedFrom) =>
    items.map((t, i) => `<li${mutedFrom != null && i >= mutedFrom ? ' class="muted"' : ""}>${esc(t)}</li>`).join("");

  return `<div class="pricing-cards">
  <div class="plan">
    <p class="plan-name">Free</p>
    <div class="plan-price">$0</div>
    <p class="plan-for">${esc(plan.free.bestFor)}</p>
    <ul class="plan-list">${li(freeItems)}</ul>
    <a class="plan-cta ghost" href="${acct}">Start free — sign in</a>
    <p class="plan-note">No card. Magic-link sign-in.</p>
  </div>
  <div class="plan featured">
    <span class="plan-badge">For builders</span>
    <p class="plan-name">Premium</p>
    <div class="plan-price">$${DEFAULT_ASSUMPTIONS.priceMonthlyUsd}<span class="per"> / month</span></div>
    <p class="plan-for">${esc(plan.premium.bestFor)}</p>
    <ul class="plan-list">${li(premiumItems)}</ul>
    <a class="plan-cta primary" href="${acct}">Go Premium</a>
    <p class="plan-note">Cancel anytime · ${esc(plan.premium.capNote)}</p>
  </div>
</div>`;
}

function renderFeatures() {
  return `<div class="feature-grid">${FEATURES.map(
    (f) => `<div class="feature"><h4>${esc(f.title)}</h4><p>${esc(f.body)}</p></div>`
  ).join("")}</div>`;
}

function renderWhy(basePath, plan) {
  return `<p>The desk runs on a fast, current model, and the price tracks what that model actually costs to run — that’s why we can show it to you plainly. Your $5 covers ${plan.premium.questionsPerMonth.toLocaleString()} questions a month, far more than anyone reads.</p>
<p>If we ever move the desk to a heavier frontier model, the economics change — and we’ll tell you what changes rather than quietly capping you. The live model market we price against is on the <a href="${basePath}/markets/">AI Markets</a> page.</p>`;
}

/**
 * Render the pricing page.
 * @param {{ basePath?: string, siteUrl?: string }} options
 * @returns {string} complete HTML
 */
function renderPricingPage(options = {}) {
  const basePath = options.basePath || "";
  const plan = userFacingPlan();
  return applyTemplate("pricing", basePath)
    .replace("{{PRICING_PLANS}}", renderPlans(basePath, plan))
    .replace("{{PRICING_FEATURES}}", renderFeatures())
    .replace("{{PRICING_WHY}}", renderWhy(basePath, plan));
}

module.exports = { renderPricingPage };
