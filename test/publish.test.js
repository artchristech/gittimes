const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { toDateStr, readManifest, publish, getRecentRepoNames } = require("../src/publish");

// --------------- toDateStr ---------------

describe("toDateStr", () => {
  it("formats a date as YYYY-MM-DD", () => {
    const d = new Date(2026, 1, 23); // Feb 23 2026
    assert.equal(toDateStr(d), "2026-02-23");
  });

  it("zero-pads single-digit months and days", () => {
    const d = new Date(2026, 0, 5); // Jan 5 2026
    assert.equal(toDateStr(d), "2026-01-05");
  });
});

// --------------- readManifest ---------------

describe("readManifest", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no manifest exists", () => {
    const result = readManifest(tmpDir);
    assert.deepEqual(result, []);
  });

  it("reads existing manifest", () => {
    const editionsDir = path.join(tmpDir, "editions");
    fs.mkdirSync(editionsDir, { recursive: true });
    const manifest = [{ date: "2026-02-22", headline: "Test" }];
    fs.writeFileSync(path.join(editionsDir, "manifest.json"), JSON.stringify(manifest));
    const result = readManifest(tmpDir);
    assert.deepEqual(result, manifest);
  });
});

// --------------- publish integration ---------------

describe("publish", () => {
  let tmpDir;

  const mockContent = {
    lead: {
      headline: "Big News",
      subheadline: "Something happened",
      body: "The full story.",
      buildersTake: "Worth watching.",
      repo: { name: "org/repo", url: "https://github.com/org/repo", stars: 5000, language: "Rust" },
    },
    secondary: [
      {
        headline: "Also News",
        subheadline: "Another thing",
        body: "Details here.",
        buildersTake: "Interesting.",
        repo: { name: "org/other", url: "https://github.com/org/other", stars: 1200, language: "Go" },
      },
    ],
    quickHits: [
      { name: "tool/one", shortName: "one", url: "https://github.com/tool/one", summary: "A tool", stars: 800 },
    ],
    tagline: "Today's top stories",
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-pub-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates full site structure on first publish", async () => {
    const date = new Date(2026, 1, 23);
    await publish(mockContent, tmpDir, { siteUrl: "https://example.github.io", basePath: "", date });

    // Edition file
    assert.ok(fs.existsSync(path.join(tmpDir, "editions", "2026-02-23", "index.html")));
    // Latest copy
    assert.ok(fs.existsSync(path.join(tmpDir, "index.html")));
    // Manifest
    assert.ok(fs.existsSync(path.join(tmpDir, "editions", "manifest.json")));
    // Archive
    assert.ok(fs.existsSync(path.join(tmpDir, "archive", "index.html")));
    // Feeds
    assert.ok(fs.existsSync(path.join(tmpDir, "feed.xml")));
    assert.ok(fs.existsSync(path.join(tmpDir, "feed.atom")));
    // .nojekyll
    assert.ok(fs.existsSync(path.join(tmpDir, ".nojekyll")));
  });

  it("manifest contains the edition entry", async () => {
    const date = new Date(2026, 1, 23);
    await publish(mockContent, tmpDir, { date });
    const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, "editions", "manifest.json"), "utf-8"));
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].date, "2026-02-23");
    assert.equal(manifest[0].headline, "Big News");
  });

  it("edition HTML contains navigation", async () => {
    const date = new Date(2026, 1, 23);
    await publish(mockContent, tmpDir, { date, basePath: "" });
    const html = fs.readFileSync(path.join(tmpDir, "editions", "2026-02-23", "index.html"), "utf-8");
    assert.ok(html.includes("edition-nav"));
    assert.ok(html.includes("Archive"));
    assert.ok(html.includes("RSS"));
  });

  it("second publish adds next link to previous edition", async () => {
    const date1 = new Date(2026, 1, 22);
    const date2 = new Date(2026, 1, 23);
    await publish(mockContent, tmpDir, { date: date1, basePath: "" });
    await publish(mockContent, tmpDir, { date: date2, basePath: "" });

    const prevHtml = fs.readFileSync(path.join(tmpDir, "editions", "2026-02-22", "index.html"), "utf-8");
    assert.ok(prevHtml.includes("Next Edition"));
    assert.ok(prevHtml.includes("/editions/2026-02-23/"));
  });

  it("archive page lists all editions", async () => {
    const date1 = new Date(2026, 1, 22);
    const date2 = new Date(2026, 1, 23);
    await publish(mockContent, tmpDir, { date: date1, basePath: "" });
    await publish(mockContent, tmpDir, { date: date2, basePath: "" });

    const archiveHtml = fs.readFileSync(path.join(tmpDir, "archive", "index.html"), "utf-8");
    assert.ok(archiveHtml.includes("Big News"));
    assert.ok(archiveHtml.includes("/editions/2026-02-22/"));
    assert.ok(archiveHtml.includes("/editions/2026-02-23/"));
  });

  it("manifest entry includes repos array with correct names", async () => {
    const date = new Date(2026, 1, 23);
    await publish(mockContent, tmpDir, { date });
    const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, "editions", "manifest.json"), "utf-8"));
    assert.ok(Array.isArray(manifest[0].repos));
    assert.ok(manifest[0].repos.includes("org/repo")); // lead
    assert.ok(manifest[0].repos.includes("org/other")); // secondary
    assert.ok(manifest[0].repos.includes("tool/one")); // quickHit
  });
});

// --------------- getRecentRepoNames ---------------

describe("getRecentRepoNames", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-recent-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty set when no manifest exists", () => {
    const result = getRecentRepoNames(tmpDir);
    assert.ok(result instanceof Set);
    assert.equal(result.size, 0);
  });

  it("skips entries without repos field", () => {
    const editionsDir = path.join(tmpDir, "editions");
    fs.mkdirSync(editionsDir, { recursive: true });
    const manifest = [
      { date: "2026-02-22", headline: "Old", url: "/editions/2026-02-22/" },
    ];
    fs.writeFileSync(path.join(editionsDir, "manifest.json"), JSON.stringify(manifest));
    const result = getRecentRepoNames(tmpDir);
    assert.equal(result.size, 0);
  });

  it("collects from last N editions only", () => {
    const editionsDir = path.join(tmpDir, "editions");
    fs.mkdirSync(editionsDir, { recursive: true });
    const manifest = [
      { date: "2026-02-24", repos: ["a/one"] },
      { date: "2026-02-23", repos: ["b/two"] },
      { date: "2026-02-22", repos: ["c/three"] },
      { date: "2026-02-21", repos: ["d/four"] }, // outside lookback=3
    ];
    fs.writeFileSync(path.join(editionsDir, "manifest.json"), JSON.stringify(manifest));
    const result = getRecentRepoNames(tmpDir, 3);
    assert.ok(result.has("a/one"));
    assert.ok(result.has("b/two"));
    assert.ok(result.has("c/three"));
    assert.ok(!result.has("d/four"));
  });
});
