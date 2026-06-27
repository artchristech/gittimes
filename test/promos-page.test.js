const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { collectPromoEntries, renderPromosPage } = require("../src/promos-page");

const sampleManifest = [
  { date: "2026-02-23", headline: "Big News Today", tagline: "Top stories", url: "/editions/2026-02-23/" },
  { date: "2026-02-22", headline: "Yesterday's News", tagline: "More stories", url: "/editions/2026-02-22/" },
];

describe("collectPromoEntries", () => {
  let outDir;

  before(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-promos-"));
    const promos = path.join(outDir, "promos");
    fs.mkdirSync(promos, { recursive: true });
    // 2026-02-23: full set (mp4 + poster + captions)
    fs.writeFileSync(path.join(promos, "2026-02-23.mp4"), "x");
    fs.writeFileSync(path.join(promos, "2026-02-23.jpg"), "x");
    fs.writeFileSync(path.join(promos, "2026-02-23.vtt"), "x");
    // 2026-02-22: video only, no poster/captions
    fs.writeFileSync(path.join(promos, "2026-02-22.mp4"), "x");
    // noise that must be ignored
    fs.writeFileSync(path.join(promos, "index.html"), "x");
    fs.writeFileSync(path.join(promos, "2026-02-23-landscape.mp4"), "x");
  });

  after(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("finds one entry per dated mp4, newest first", () => {
    const entries = collectPromoEntries(outDir, sampleManifest);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].date, "2026-02-23");
    assert.equal(entries[1].date, "2026-02-22");
  });

  it("flags presence of poster and captions", () => {
    const [newest, older] = collectPromoEntries(outDir, sampleManifest);
    assert.equal(newest.poster, "2026-02-23.jpg");
    assert.equal(newest.vtt, "2026-02-23.vtt");
    assert.equal(older.poster, null);
    assert.equal(older.vtt, null);
  });

  it("joins headline + url from the manifest", () => {
    const [newest] = collectPromoEntries(outDir, sampleManifest);
    assert.equal(newest.headline, "Big News Today");
    assert.equal(newest.url, "/editions/2026-02-23/");
  });

  it("falls back gracefully when an edition is missing from the manifest", () => {
    const entries = collectPromoEntries(outDir, []);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].headline, "Edition");
    assert.equal(entries[0].url, "/editions/2026-02-23/");
  });

  it("returns [] when there is no promos dir", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-empty-"));
    assert.deepEqual(collectPromoEntries(empty, sampleManifest), []);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

describe("renderPromosPage", () => {
  const entries = [
    { date: "2026-02-23", mp4: "2026-02-23.mp4", poster: "2026-02-23.jpg", vtt: "2026-02-23.vtt", headline: "Big News Today", tagline: "Top stories", url: "/editions/2026-02-23/" },
  ];

  it("returns a complete HTML page", () => {
    const html = renderPromosPage(entries, "");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("</html>"));
    assert.ok(html.includes("Edition Reel"));
  });

  it("embeds a video with source, poster, and captions track", () => {
    const html = renderPromosPage(entries, "");
    assert.ok(html.includes("<video"));
    assert.ok(html.includes('src="/promos/2026-02-23.mp4"'));
    assert.ok(html.includes('poster="/promos/2026-02-23.jpg"'));
    assert.ok(html.includes('src="/promos/2026-02-23.vtt"'));
    assert.ok(html.includes("Big News Today"));
  });

  it("omits poster and track when absent", () => {
    const html = renderPromosPage([{ ...entries[0], poster: null, vtt: null }], "");
    assert.ok(!html.includes("poster="));
    assert.ok(!html.includes("<track"));
  });

  it("escapes HTML in headlines", () => {
    const html = renderPromosPage([{ ...entries[0], headline: '<script>alert("xss")</script>' }], "");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>alert"));
  });

  it("applies basePath to media and edition links", () => {
    const html = renderPromosPage(entries, "/gittimes");
    assert.ok(html.includes('src="/gittimes/promos/2026-02-23.mp4"'));
    assert.ok(html.includes('href="/gittimes/editions/2026-02-23/"'));
  });

  it("shows an empty-state message with no entries", () => {
    const html = renderPromosPage([], "");
    assert.ok(html.includes("Edition Reel"));
    assert.ok(html.includes("No promo videos yet"));
  });
});
