const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { generateFeed } = require("../src/feed");

const sampleManifest = [
  { date: "2026-02-23", headline: "Big News Today", subheadline: "Something great", tagline: "Top stories", url: "/editions/2026-02-23/" },
  { date: "2026-02-22", headline: "Yesterday's News", subheadline: "Also good", tagline: "More stories", url: "/editions/2026-02-22/" },
];

describe("generateFeed", () => {
  it("returns rss and atom strings", () => {
    const result = generateFeed(sampleManifest, "https://gittimes.com");
    assert.equal(typeof result.rss, "string");
    assert.equal(typeof result.atom, "string");
  });

  it("RSS contains correct XML structure", () => {
    const { rss } = generateFeed(sampleManifest, "https://gittimes.com");
    assert.ok(rss.includes("<rss"));
    assert.ok(rss.includes("<channel>"));
    assert.ok(rss.includes("The Git Times"));
    assert.ok(rss.includes("Big News Today"));
    assert.ok(rss.includes("Yesterday's News"));
  });

  it("Atom contains correct XML structure", () => {
    const { atom } = generateFeed(sampleManifest, "https://gittimes.com");
    assert.ok(atom.includes("<feed"));
    assert.ok(atom.includes("The Git Times"));
    assert.ok(atom.includes("Big News Today"));
  });

  it("includes correct URLs", () => {
    const { rss } = generateFeed(sampleManifest, "https://gittimes.com");
    assert.ok(rss.includes("https://gittimes.com/feed.xml"));
  });

  it("respects limit parameter", () => {
    const bigManifest = Array.from({ length: 50 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      headline: `Edition ${i + 1}`,
      url: `/editions/2026-01-${String(i + 1).padStart(2, "0")}/`,
    }));
    const { rss } = generateFeed(bigManifest, "https://example.github.io", { limit: 5 });
    const itemCount = (rss.match(/<item>/g) || []).length;
    assert.equal(itemCount, 5);
  });

  it("handles empty manifest", () => {
    const result = generateFeed([], "https://example.github.io");
    assert.ok(result.rss.includes("<rss"));
    assert.ok(result.atom.includes("<feed"));
  });
});
