const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { renderArchivePage } = require("../src/archive");

const sampleManifest = [
  { date: "2026-02-23", headline: "Big News Today", tagline: "Top stories", url: "/editions/2026-02-23/" },
  { date: "2026-02-22", headline: "Yesterday's News", tagline: "More stories", url: "/editions/2026-02-22/" },
];

describe("renderArchivePage", () => {
  it("returns a complete HTML page", () => {
    const html = renderArchivePage(sampleManifest, "");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("</html>"));
  });

  it("lists all editions", () => {
    const html = renderArchivePage(sampleManifest, "");
    assert.ok(html.includes("Big News Today"));
    assert.ok(html.includes("Yesterday's News"));
    assert.ok(html.includes("/editions/2026-02-23/"));
    assert.ok(html.includes("/editions/2026-02-22/"));
  });

  it("includes taglines", () => {
    const html = renderArchivePage(sampleManifest, "");
    assert.ok(html.includes("Top stories"));
    assert.ok(html.includes("More stories"));
  });

  it("escapes HTML in headlines", () => {
    const manifest = [{ date: "2026-02-23", headline: '<script>alert("xss")</script>', tagline: "", url: "/editions/2026-02-23/" }];
    const html = renderArchivePage(manifest, "");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>alert"));
  });

  it("uses basePath in links", () => {
    const html = renderArchivePage(sampleManifest, "/gittimes");
    assert.ok(html.includes('href="/gittimes/"'));
    assert.ok(html.includes("/gittimes/feed.xml"));
  });

  it("handles empty manifest", () => {
    const html = renderArchivePage([], "");
    assert.ok(html.includes("All Editions"));
  });
});
