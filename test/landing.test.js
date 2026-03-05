const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { renderLandingPage } = require("../src/landing");

const sampleManifest = [
  { date: "2026-02-28", headline: "Big News Today", tagline: "Top stories", url: "/editions/2026-02-28/" },
  { date: "2026-02-27", headline: "Yesterday's News", tagline: "More stories", url: "/editions/2026-02-27/" },
  { date: "2026-02-26", headline: "Third Edition", tagline: "Even more", url: "/editions/2026-02-26/" },
  { date: "2026-02-25", headline: "Fourth Edition", tagline: "Still going", url: "/editions/2026-02-25/" },
  { date: "2026-02-24", headline: "Fifth Edition", tagline: "Almost done", url: "/editions/2026-02-24/" },
  { date: "2026-02-23", headline: "Sixth Edition", tagline: "Extra", url: "/editions/2026-02-23/" },
];

describe("renderLandingPage", () => {
  it("returns a complete HTML page", () => {
    const html = renderLandingPage(sampleManifest, { basePath: "" });
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("</html>"));
  });

  it("includes hero CTAs with /latest/ link", () => {
    const html = renderLandingPage(sampleManifest, { basePath: "" });
    assert.ok(html.includes('href="/latest/"'));
    assert.ok(html.includes("Read Today"));
    assert.ok(html.includes('href="#subscribe"'));
  });

  it("lists recent edition cards from manifest", () => {
    const html = renderLandingPage(sampleManifest, { basePath: "" });
    assert.ok(html.includes("Big News Today"));
    assert.ok(html.includes("Yesterday&#39;s News"));
    assert.ok(html.includes("/editions/2026-02-28/"));
    assert.ok(html.includes("/editions/2026-02-27/"));
  });

  it("limits to 5 editions", () => {
    const html = renderLandingPage(sampleManifest, { basePath: "" });
    assert.ok(html.includes("Fifth Edition"));
    assert.ok(!html.includes("Sixth Edition"));
  });

  it("escapes HTML in headlines", () => {
    const manifest = [{ date: "2026-02-28", headline: '<script>alert("xss")</script>', tagline: "", url: "/editions/2026-02-28/" }];
    const html = renderLandingPage(manifest, { basePath: "" });
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>alert"));
  });

  it("respects basePath", () => {
    const html = renderLandingPage(sampleManifest, { basePath: "/gittimes" });
    assert.ok(html.includes('href="/gittimes/latest/"'));
    assert.ok(html.includes('href="/gittimes/archive/"'));
  });

  it("handles empty manifest", () => {
    const html = renderLandingPage([], { basePath: "" });
    assert.ok(html.includes("Recent Editions"));
    assert.ok(html.includes("<!DOCTYPE html>"));
  });

  it("includes subscribe form", () => {
    const html = renderLandingPage(sampleManifest, { basePath: "" });
    assert.ok(html.includes('id="subscribe-form"'));
    assert.ok(html.includes('type="email"'));
    assert.ok(html.includes("Subscribe"));
  });

  it("includes features section", () => {
    const html = renderLandingPage(sampleManifest, { basePath: "" });
    assert.ok(html.includes("Editorial Intelligence"));
    assert.ok(html.includes("Daily Coverage"));
    assert.ok(html.includes("7 Sections"));
  });

  it("masthead includes account link", () => {
    const html = renderLandingPage(sampleManifest, { basePath: "" });
    assert.ok(html.includes('href="/account/"'));
    assert.ok(html.includes("masthead-account"));
  });

  it("subscribe section mentions account creation", () => {
    const html = renderLandingPage(sampleManifest, { basePath: "" });
    assert.ok(html.includes("creates a free account"));
  });

  it("includes sign in link", () => {
    const html = renderLandingPage(sampleManifest, { basePath: "" });
    assert.ok(html.includes("Already have an account?"));
  });
});
