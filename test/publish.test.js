const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { toDateStr, readManifest, publish, getRecentRepoNames, getRecentLeadRepos, validateContent } = require("../src/publish");

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
      useCases: ["Build web apps"], similarProjects: ["Vite - faster"],
      repo: { name: "org/repo", url: "https://github.com/org/repo", stars: 5000, language: "Rust" },
    },
    secondary: [
      {
        headline: "Also News",
        subheadline: "Another thing",
        body: "Details here.",
        useCases: ["CLI tooling"], similarProjects: ["Cobra - similar"],
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
    // Latest copy at /latest/
    assert.ok(fs.existsSync(path.join(tmpDir, "latest", "index.html")));
    // Landing page at root
    assert.ok(fs.existsSync(path.join(tmpDir, "index.html")));
    // Manifest
    assert.ok(fs.existsSync(path.join(tmpDir, "editions", "manifest.json")));
    // Archive
    assert.ok(fs.existsSync(path.join(tmpDir, "archive", "index.html")));
    // .nojekyll
    assert.ok(fs.existsSync(path.join(tmpDir, ".nojekyll")));
  });

  it("generates account page", async () => {
    const date = new Date(2026, 1, 23);
    await publish(mockContent, tmpDir, { siteUrl: "https://example.github.io", basePath: "", date });

    const accountPath = path.join(tmpDir, "account", "index.html");
    assert.ok(fs.existsSync(accountPath));
    const accountHtml = fs.readFileSync(accountPath, "utf-8");
    assert.ok(accountHtml.includes('id="magic-link-form"'));
  });

  it("root index.html is latest edition, subscribe page has landing content", async () => {
    const date = new Date(2026, 1, 23);
    await publish(mockContent, tmpDir, { siteUrl: "https://example.github.io", basePath: "", date });

    const rootHtml = fs.readFileSync(path.join(tmpDir, "index.html"), "utf-8");
    const latestHtml = fs.readFileSync(path.join(tmpDir, "latest", "index.html"), "utf-8");

    // Root should be the edition (same as latest)
    assert.ok(rootHtml.includes("edition-nav"));
    assert.ok(!rootHtml.includes('id="subscribe-form"'));
    // Latest should match root
    assert.equal(rootHtml, latestHtml);
    // Subscribe page should have landing content
    const subscribeHtml = fs.readFileSync(path.join(tmpDir, "subscribe", "index.html"), "utf-8");
    assert.ok(subscribeHtml.includes('id="subscribe-form"'));
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
    assert.ok(html.includes("Archive"));
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

// --------------- getRecentLeadRepos ---------------

describe("getRecentLeadRepos", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-leads-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns section leads from sectionLeads field", () => {
    const editionsDir = path.join(tmpDir, "editions");
    fs.mkdirSync(editionsDir, { recursive: true });
    const manifest = [
      {
        date: "2026-02-24",
        repos: ["fp/lead", "fp/sec"],
        sectionLeads: ["fp/lead", "ai/lead", "cyber/lead"],
      },
    ];
    fs.writeFileSync(path.join(editionsDir, "manifest.json"), JSON.stringify(manifest));
    const result = getRecentLeadRepos(tmpDir, 3);
    assert.ok(result.has("fp/lead"), "Should include front page lead");
    assert.ok(result.has("ai/lead"), "Should include AI section lead");
    assert.ok(result.has("cyber/lead"), "Should include cyber section lead");
    assert.ok(!result.has("fp/sec"), "Should not include non-lead repos");
  });

  it("returns first repo as lead when no sectionLeads", () => {
    const editionsDir = path.join(tmpDir, "editions");
    fs.mkdirSync(editionsDir, { recursive: true });
    const manifest = [
      { date: "2026-02-24", repos: ["fp/lead", "fp/sec"] },
    ];
    fs.writeFileSync(path.join(editionsDir, "manifest.json"), JSON.stringify(manifest));
    const result = getRecentLeadRepos(tmpDir, 3);
    assert.ok(result.has("fp/lead"));
    assert.ok(!result.has("fp/sec"));
  });
});

// --------------- validateContent ---------------

describe("validateContent", () => {
  function makeArticle(headline, isFallback = false) {
    return {
      headline,
      subheadline: "Sub",
      body: "Body",
      useCases: [],
      similarProjects: [],
      _isFallback: isFallback,
      repo: { name: "org/repo" },
    };
  }

  it("valid content passes", () => {
    const content = {
      sections: {
        frontPage: {
          lead: makeArticle("Lead"),
          secondary: [makeArticle("Sec1")],
          quickHits: [],
          isEmpty: false,
        },
        ai: {
          lead: makeArticle("AI Lead"),
          secondary: [],
          quickHits: [],
          isEmpty: false,
        },
      },
      tagline: "Test tagline",
    };
    const result = validateContent(content);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("null content fails", () => {
    const result = validateContent(null);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("null")));
  });

  it("no non-fallback lead fails", () => {
    const content = {
      sections: {
        frontPage: {
          lead: makeArticle("Fallback Lead", true),
          secondary: [makeArticle("Sec1")],
          quickHits: [],
          isEmpty: false,
        },
      },
    };
    const result = validateContent(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("non-fallback lead")));
  });

  it("missing front page secondary articles fails", () => {
    const content = {
      sections: {
        frontPage: {
          lead: makeArticle("Lead"),
          secondary: [],
          quickHits: [],
          isEmpty: false,
        },
      },
    };
    const result = validateContent(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("secondary")));
  });

  it("summary counts correctly", () => {
    const content = {
      sections: {
        frontPage: {
          lead: makeArticle("Lead"),
          secondary: [makeArticle("Sec1"), makeArticle("Sec2", true)],
          quickHits: [{ name: "qh1" }, { name: "qh2" }],
          isEmpty: false,
        },
        ai: {
          lead: null,
          secondary: [],
          quickHits: [],
          isEmpty: true,
        },
      },
    };
    const result = validateContent(content);
    assert.equal(result.summary.sections, 2);
    assert.equal(result.summary.articles, 5); // 1 lead + 2 secondary + 2 quickHits
    assert.equal(result.summary.fallbacks, 1);
    assert.equal(result.summary.emptyCount, 1);
  });
});
