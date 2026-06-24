const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { RECENCY_RULES, leadEligible, withinWireWindow } = require("../src/recency");

const NOW = Date.parse("2026-06-23T00:00:00Z");
const DAY = 86400000;
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const unix = (hoursAgo) => Math.floor((NOW - hoursAgo * 3600000) / 1000);

describe("RECENCY_RULES", () => {
  it("is graduated strictest -> loosest", () => {
    assert.ok(RECENCY_RULES.lead.windowDays <= RECENCY_RULES.secondary.windowDays);
    assert.ok(RECENCY_RULES.secondary.windowDays <= RECENCY_RULES.quickHit.windowDays);
  });
  it("keys the lead on a hook, the wire on hours", () => {
    assert.equal(RECENCY_RULES.lead.field, "hook");
    assert.equal(typeof RECENCY_RULES.aiWire.windowHours, "number");
  });
});

describe("leadEligible", () => {
  it("rejects a years-old repo whose only recency is a recent push", () => {
    assert.equal(
      leadEligible({ pushed_at: iso(1), created_at: iso(1000), _latestRelease: { published_at: iso(400) } }, NOW),
      false,
    );
  });
  it("accepts a brand-new repo (created within the lead window, no release)", () => {
    assert.equal(leadEligible({ pushed_at: iso(0), created_at: iso(10), _latestRelease: null }, NOW), true);
  });
  it("accepts an old repo with a fresh release (a genuine hook)", () => {
    assert.equal(leadEligible({ created_at: iso(1000), _latestRelease: { published_at: iso(3) } }, NOW), true);
  });
  it("boundary: age exactly at the window is included", () => {
    assert.equal(leadEligible({ created_at: iso(RECENCY_RULES.lead.windowDays), _latestRelease: null }, NOW), true);
  });
  it("missing timestamps are treated as stale", () => {
    assert.equal(leadEligible({}, NOW), false);
  });
});

describe("withinWireWindow", () => {
  it("keeps a fresh item, drops a stale one", () => {
    assert.equal(withinWireWindow(unix(6), NOW), true);
    assert.equal(withinWireWindow(unix(72), NOW), false);
  });
  it("boundary: exactly at the window is included", () => {
    assert.equal(withinWireWindow(unix(RECENCY_RULES.aiWire.windowHours), NOW), true);
  });
  it("missing timestamp is treated as stale", () => {
    assert.equal(withinWireWindow(null, NOW), false);
  });
});
