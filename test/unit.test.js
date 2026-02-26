const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { escapeHtml, formatStars, bodyToHtml, buildNavHtml, initMarked, renderLeadStory, renderSecondaryArticle, renderFeaturedArticle, renderCompactArticle, renderSectionNav, renderSectionContent, renderSentimentBadge, renderXPulseContent } = require("../src/render");
const { daysAgo, scoreRepo, categorizeDiverse, categorizeDiverseForSection } = require("../src/github");
const { parseArticle, parseQuickHits, sanitizePrompt } = require("../src/xai");
const { parseXSentiment, parseXPulse } = require("../src/x-sentiment");
const { SECTIONS, SECTION_ORDER } = require("../src/sections");

// --------------- escapeHtml ---------------

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    assert.equal(escapeHtml("a & b"), "a &amp; b");
  });

  it("escapes angle brackets", () => {
    assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  });

  it("escapes double quotes", () => {
    assert.equal(escapeHtml('say "hi"'), "say &quot;hi&quot;");
  });

  it("handles nested combinations", () => {
    assert.equal(
      escapeHtml('<a href="x&y">'),
      "&lt;a href=&quot;x&amp;y&quot;&gt;"
    );
  });

  it("returns empty string unchanged", () => {
    assert.equal(escapeHtml(""), "");
  });
});

// --------------- formatStars ---------------

describe("formatStars", () => {
  it("returns number as-is below 1000", () => {
    assert.equal(formatStars(42), "42");
    assert.equal(formatStars(0), "0");
    assert.equal(formatStars(999), "999");
  });

  it("formats exactly 1000 as 1k", () => {
    assert.equal(formatStars(1000), "1k");
  });

  it("formats thousands with one decimal", () => {
    assert.equal(formatStars(1500), "1.5k");
    assert.equal(formatStars(12300), "12.3k");
  });

  it("drops trailing .0", () => {
    assert.equal(formatStars(2000), "2k");
    assert.equal(formatStars(10000), "10k");
  });
});

// --------------- bodyToHtml ---------------

describe("bodyToHtml", () => {
  it("wraps paragraphs in <p> tags", () => {
    const result = bodyToHtml("Hello world");
    assert.equal(result, "<p>Hello world</p>");
  });

  it("splits on double newlines", () => {
    const result = bodyToHtml("Para one\n\nPara two");
    assert.ok(result.includes("<p>Para one</p>"));
    assert.ok(result.includes("<p>Para two</p>"));
  });

  it("filters empty paragraphs", () => {
    const result = bodyToHtml("Para one\n\n\n\nPara two");
    const pCount = (result.match(/<p>/g) || []).length;
    assert.equal(pCount, 2);
  });

  it("escapes HTML in paragraphs", () => {
    const result = bodyToHtml("Use <script> tags & stuff");
    assert.ok(result.includes("&lt;script&gt;"));
    assert.ok(result.includes("&amp;"));
    assert.ok(!result.includes("<script>"));
  });
});

// --------------- bodyToHtml with marked ---------------

describe("bodyToHtml with marked", () => {
  it("renders markdown bold as <strong>", async () => {
    await initMarked();
    const result = bodyToHtml("**bold**");
    assert.ok(result.includes("<strong>bold</strong>"));
  });

  it("renders inline code as <code>", async () => {
    await initMarked();
    const result = bodyToHtml("`npm install`");
    assert.ok(result.includes("<code>npm install</code>"));
  });

  it("renders bullet lists as <ul>", async () => {
    await initMarked();
    const result = bodyToHtml("- item one\n- item two");
    assert.ok(result.includes("<ul>"));
    assert.ok(result.includes("<li>"));
  });

  it("strips <script> tags from output", async () => {
    await initMarked();
    const result = bodyToHtml("Hello <script>alert('xss')</script> world");
    assert.ok(!result.includes("<script>"));
  });
});

// --------------- buildNavHtml ---------------

describe("buildNavHtml", () => {
  it("returns empty string when nav is null", () => {
    assert.equal(buildNavHtml(null), "");
  });

  it("returns empty string when nav is undefined", () => {
    assert.equal(buildNavHtml(undefined), "");
  });

  it("returns empty string when nav has no links", () => {
    assert.equal(buildNavHtml({}), "");
  });

  it("renders prev and next links", () => {
    const result = buildNavHtml({
      prev: { url: "/editions/2026-02-22/", label: "Previous Edition" },
      next: { url: "/editions/2026-02-24/", label: "Next Edition" },
    });
    assert.ok(result.includes("edition-nav"));
    assert.ok(result.includes("Previous Edition"));
    assert.ok(result.includes("Next Edition"));
    assert.ok(result.includes("/editions/2026-02-22/"));
    assert.ok(result.includes("&larr;"));
    assert.ok(result.includes("&rarr;"));
  });

  it("renders archive and RSS links", () => {
    const result = buildNavHtml({
      archive: "/archive/",
      rss: "/feed.xml",
    });
    assert.ok(result.includes("Archive"));
    assert.ok(result.includes("RSS"));
    assert.ok(result.includes("/archive/"));
    assert.ok(result.includes("/feed.xml"));
  });

  it("escapes HTML in URLs and labels", () => {
    const result = buildNavHtml({
      prev: { url: "/a&b/", label: 'Prev "edition"' },
    });
    assert.ok(result.includes("/a&amp;b/"));
    assert.ok(result.includes("Prev &quot;edition&quot;"));
  });
});

// --------------- daysAgo ---------------

describe("daysAgo", () => {
  it("returns an ISO date string (YYYY-MM-DD)", () => {
    const result = daysAgo(0);
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns today for 0 days ago", () => {
    const today = new Date().toISOString().split("T")[0];
    assert.equal(daysAgo(0), today);
  });

  it("returns a past date for positive input", () => {
    const result = new Date(daysAgo(7));
    const now = new Date();
    const diffMs = now - result;
    const diffDays = Math.round(diffMs / 86400000);
    assert.ok(diffDays >= 6 && diffDays <= 8);
  });
});

// --------------- scoreRepo ---------------

describe("scoreRepo", () => {
  const now = Date.now();
  const baseRepo = {
    full_name: "org/repo",
    stargazers_count: 100,
    forks_count: 20,
    open_issues_count: 10,
    created_at: new Date(now - 2 * 86400000).toISOString(), // 2 days ago
    pushed_at: new Date(now - 1 * 86400000).toISOString(), // 1 day ago
    language: "JavaScript",
    _latestRelease: null,
    _isOSSInsight: false,
  };

  it("returns a number", () => {
    const score = scoreRepo(baseRepo, { now });
    assert.equal(typeof score, "number");
  });

  it("recent release increases score", () => {
    const withoutRelease = scoreRepo(baseRepo, { now });
    const withRelease = scoreRepo({
      ...baseRepo,
      _latestRelease: { tag_name: "v1.0", published_at: new Date(now - 1 * 86400000).toISOString() },
    }, { now });
    assert.ok(withRelease > withoutRelease);
  });

  it("old release (30+ days) gives no bonus", () => {
    const withoutRelease = scoreRepo(baseRepo, { now });
    const withOldRelease = scoreRepo({
      ...baseRepo,
      _latestRelease: { tag_name: "v0.1", published_at: new Date(now - 35 * 86400000).toISOString() },
    }, { now });
    assert.equal(withOldRelease, withoutRelease);
  });

  it("release with no date gets partial credit", () => {
    const withoutRelease = scoreRepo(baseRepo, { now });
    const withNodateRelease = scoreRepo({
      ...baseRepo,
      _latestRelease: { tag_name: "v1.0" },
    }, { now });
    assert.ok(withNodateRelease > withoutRelease);
  });

  it("history penalty reduces score by at least 0.4", () => {
    const normal = scoreRepo(baseRepo, { now });
    const penalized = scoreRepo(baseRepo, { now, recentRepoNames: new Set(["org/repo"]) });
    assert.ok(normal - penalized >= 0.4);
  });

  it("OSSInsight repos get zero velocity and recency", () => {
    const normal = scoreRepo(baseRepo, { now });
    const ossRepo = scoreRepo({ ...baseRepo, _isOSSInsight: true }, { now });
    assert.ok(normal > ossRepo, "OSSInsight score should be lower due to zeroed velocity/recency");
    // OSSInsight score should only have release + engagement components
    const engagementOnly = scoreRepo({
      ...baseRepo,
      _isOSSInsight: true,
      stargazers_count: 100,
      forks_count: 20,
      open_issues_count: 10,
    }, { now });
    assert.equal(typeof engagementOnly, "number");
  });

  it("log dampening prevents extreme dominance", () => {
    const lowStars = scoreRepo({ ...baseRepo, stargazers_count: 10 }, { now });
    const highStars = scoreRepo({ ...baseRepo, stargazers_count: 100000 }, { now });
    // Difference should be bounded — high stars should not be orders of magnitude higher
    assert.ok(highStars - lowStars < 1.0);
  });

  it("engagement increases score", () => {
    const lowEngagement = scoreRepo({ ...baseRepo, forks_count: 0, open_issues_count: 0 }, { now });
    const highEngagement = scoreRepo({ ...baseRepo, forks_count: 50, open_issues_count: 50 }, { now });
    assert.ok(highEngagement > lowEngagement);
  });

  it("forks contribute more than issues to engagement", () => {
    const forkHeavy = scoreRepo({ ...baseRepo, forks_count: 50, open_issues_count: 0 }, { now });
    const issueHeavy = scoreRepo({ ...baseRepo, forks_count: 0, open_issues_count: 50 }, { now });
    assert.ok(forkHeavy > issueHeavy, "50 forks should score higher than 50 issues");
  });

  it("handles zero stars", () => {
    const score = scoreRepo({ ...baseRepo, stargazers_count: 0 }, { now });
    assert.equal(typeof score, "number");
    assert.ok(!Number.isNaN(score));
  });
});

// --------------- categorizeDiverse ---------------

describe("categorizeDiverse", () => {
  function makeRepo(name, lang, score) {
    return { full_name: name, language: lang, _score: score };
  }

  it("returns lead, secondary, and quickHits", () => {
    const repos = [makeRepo("a/1", "JS", 1)];
    const result = categorizeDiverse(repos);
    assert.ok("lead" in result);
    assert.ok("secondary" in result);
    assert.ok("quickHits" in result);
  });

  it("enforces max 2 per language in promoted slots", () => {
    const repos = [
      makeRepo("a/1", "Rust", 10),
      makeRepo("a/2", "Rust", 9),
      makeRepo("a/3", "Rust", 8),
      makeRepo("a/4", "Go", 7),
      makeRepo("a/5", "Go", 6),
      makeRepo("a/6", "Python", 5),
      makeRepo("a/7", "Python", 4),
      makeRepo("a/8", "JS", 3),
    ];
    const { lead, secondary } = categorizeDiverse(repos);
    const promoted = [lead, ...secondary];
    const rustCount = promoted.filter((r) => r.language === "Rust").length;
    assert.ok(rustCount <= 2, `Expected max 2 Rust repos in promoted, got ${rustCount}`);
  });

  it("handles fewer than 7 repos", () => {
    const repos = [makeRepo("a/1", "JS", 2), makeRepo("a/2", "Go", 1)];
    const { lead, secondary, quickHits } = categorizeDiverse(repos);
    assert.equal(lead.full_name, "a/1");
    assert.equal(secondary.length, 1);
    assert.equal(quickHits.length, 0);
  });

  it("handles empty input", () => {
    const { lead, secondary, quickHits } = categorizeDiverse([]);
    assert.equal(lead, null);
    assert.deepEqual(secondary, []);
    assert.deepEqual(quickHits, []);
  });

  it("adaptive cap allows more per language when pool has few languages", () => {
    // Only 2 languages → cap = ceil(7/2) = 4
    const repos = [
      makeRepo("a/1", "Rust", 10),
      makeRepo("a/2", "Rust", 9),
      makeRepo("a/3", "Rust", 8),
      makeRepo("a/4", "Rust", 7),
      makeRepo("a/5", "Go", 6),
      makeRepo("a/6", "Go", 5),
      makeRepo("a/7", "Go", 4),
      makeRepo("a/8", "Go", 3),
    ];
    const { lead, secondary } = categorizeDiverse(repos);
    const promoted = [lead, ...secondary];
    const rustCount = promoted.filter((r) => r.language === "Rust").length;
    assert.ok(rustCount > 2, `Expected >2 Rust repos with 2-language pool, got ${rustCount}`);
    assert.equal(promoted.length, 7);
  });

  it("overflow goes to quickHits", () => {
    const repos = [
      makeRepo("a/1", "Rust", 10),
      makeRepo("a/2", "Rust", 9),
      makeRepo("a/3", "Rust", 8), // 3rd Rust — overflow
      makeRepo("a/4", "Go", 7),
      makeRepo("a/5", "Go", 6),
      makeRepo("a/6", "Python", 5),
      makeRepo("a/7", "Python", 4),
      makeRepo("a/8", "JS", 3),
    ];
    const { quickHits } = categorizeDiverse(repos);
    const overflowNames = quickHits.map((r) => r.full_name);
    assert.ok(overflowNames.includes("a/3"), "3rd Rust repo should be in quickHits");
  });
});

// --------------- parseArticle ---------------

describe("parseArticle", () => {
  const structuredText = [
    "HEADLINE: Big New Framework",
    "SUBHEADLINE: A subtitle here",
    "BODY: First paragraph of the body.",
    "BUILDERS_TAKE: This is useful for devs.",
  ].join("\n");

  it("parses all structured markers", () => {
    const result = parseArticle(structuredText, null);
    assert.equal(result.headline, "Big New Framework");
    assert.equal(result.subheadline, "A subtitle here");
    assert.equal(result.body, "First paragraph of the body.");
    assert.equal(result.buildersTake, "This is useful for devs.");
  });

  it("uses fallback when markers are missing", () => {
    const repo = {
      name: "cool/project",
      shortName: "project",
      description: "A cool project",
    };
    const result = parseArticle("No markers here", repo);
    assert.equal(result.headline, "project: A cool project");
    assert.equal(result.subheadline, "A cool project");
    assert.equal(result.body, "A cool project");
  });

  it("handles missing fields gracefully without repo", () => {
    const result = parseArticle("", null);
    assert.equal(result.headline, "Untitled");
  });

  it("uses last occurrence of body marker", () => {
    const text = [
      "HEADLINE: The Headline",
      "BODY: Wrong body",
      "BODY: Correct body",
      "BUILDERS_TAKE: The take",
    ].join("\n");
    const result = parseArticle(text, null);
    assert.equal(result.headline, "The Headline");
    assert.equal(result.body, "Correct body");
    assert.equal(result.buildersTake, "The take");
  });

  it("sets _isFallback to true when markers are missing", () => {
    const repo = { name: "cool/project", shortName: "project", description: "A cool project" };
    const result = parseArticle("No markers here", repo);
    assert.equal(result._isFallback, true);
  });

  it("sets _isFallback to false when markers are present", () => {
    const text = [
      "HEADLINE: Good Headline",
      "BODY: Good body text",
      "BUILDERS_TAKE: Good take",
    ].join("\n");
    const result = parseArticle(text, null);
    assert.equal(result._isFallback, false);
  });

  it("parses headline correctly when no subheadline present", () => {
    const text = [
      "HEADLINE: Solo Headline",
      "BODY: Some body text",
      "BUILDERS_TAKE: A take",
    ].join("\n");
    const result = parseArticle(text, null);
    assert.equal(result.headline, "Solo Headline");
    assert.equal(result.body, "Some body text");
    assert.equal(result.buildersTake, "A take");
  });
});

// --------------- parseQuickHits ---------------

describe("parseQuickHits", () => {
  it("matches numbered lines to repos", () => {
    const text = "1. Fast build tool\n2. Cool linter";
    const repos = [
      { name: "a/build", description: "fallback A" },
      { name: "b/lint", description: "fallback B" },
    ];
    const result = parseQuickHits(text, repos);
    assert.equal(result[0].summary, "Fast build tool");
    assert.equal(result[1].summary, "Cool linter");
  });

  it("uses fallback description when line is missing", () => {
    const text = "1. Only first line";
    const repos = [
      { name: "a/x", description: "desc A" },
      { name: "b/y", description: "desc B" },
    ];
    const result = parseQuickHits(text, repos);
    assert.equal(result[0].summary, "Only first line");
    assert.equal(result[1].summary, "desc B");
  });

  it("preserves original repo properties", () => {
    const text = "1. Summary";
    const repos = [{ name: "org/repo", stars: 500, description: "d" }];
    const result = parseQuickHits(text, repos);
    assert.equal(result[0].name, "org/repo");
    assert.equal(result[0].stars, 500);
  });
});

// --------------- sanitizePrompt ---------------

describe("sanitizePrompt", () => {
  it("preserves normal ASCII text", () => {
    assert.equal(sanitizePrompt("Hello, world!"), "Hello, world!");
  });

  it("preserves Unicode characters (emoji, CJK, accented)", () => {
    assert.equal(sanitizePrompt("Hello 🌍"), "Hello 🌍");
    assert.equal(sanitizePrompt("日本語テスト"), "日本語テスト");
    assert.equal(sanitizePrompt("café résumé"), "café résumé");
  });

  it("strips control characters", () => {
    assert.equal(sanitizePrompt("hello\x00world"), "helloworld");
    assert.equal(sanitizePrompt("a\x07b\x08c"), "abc");
    assert.equal(sanitizePrompt("test\x7Fend"), "testend");
  });

  it("preserves tabs, newlines, and carriage returns", () => {
    assert.equal(sanitizePrompt("a\tb\nc\r\n"), "a\tb\nc\r\n");
  });
});

// --------------- renderLeadStory ---------------

describe("renderLeadStory", () => {
  const baseArticle = {
    headline: "Test Headline",
    subheadline: "Test Sub",
    body: "Body text",
    repo: { url: "https://github.com/test/repo", name: "test/repo", stars: 1000, language: "JS", releaseName: null },
  };

  it("omits Builder's Take div when buildersTake is empty", () => {
    const html = renderLeadStory({ ...baseArticle, buildersTake: "" });
    assert.ok(!html.includes("builders-take"), "Should not contain builders-take div");
  });

  it("includes Builder's Take div when buildersTake is populated", () => {
    const html = renderLeadStory({ ...baseArticle, buildersTake: "Great for devs" });
    assert.ok(html.includes("builders-take"), "Should contain builders-take div");
    assert.ok(html.includes("Great for devs"));
  });
});

// --------------- renderSecondaryArticle ---------------

describe("renderSecondaryArticle", () => {
  const baseArticle = {
    headline: "Secondary Headline",
    subheadline: "Secondary Sub",
    body: "Secondary body",
    repo: { url: "https://github.com/test/sec", name: "test/sec", stars: 500, language: "Python" },
  };

  it("omits Builder's Take div when buildersTake is empty", () => {
    const html = renderSecondaryArticle({ ...baseArticle, buildersTake: "" });
    assert.ok(!html.includes("builders-take"), "Should not contain builders-take div");
  });

  it("includes Builder's Take div when buildersTake is populated", () => {
    const html = renderSecondaryArticle({ ...baseArticle, buildersTake: "Useful library" });
    assert.ok(html.includes("builders-take"), "Should contain builders-take div");
    assert.ok(html.includes("Useful library"));
  });
});

// --------------- renderFeaturedArticle ---------------

describe("renderFeaturedArticle", () => {
  const baseArticle = {
    headline: "Featured Headline",
    subheadline: "Featured Sub",
    body: "Featured body text",
    repo: { url: "https://github.com/test/feat", name: "test/feat", stars: 2000, language: "TypeScript" },
  };

  it("renders headline and body text", () => {
    const html = renderFeaturedArticle({ ...baseArticle, buildersTake: "" });
    assert.ok(html.includes("Featured Headline"));
    assert.ok(html.includes("featured-headline"));
    assert.ok(html.includes("Featured body text"));
    assert.ok(html.includes("featured-body"));
  });

  it("includes Builder's Take when populated", () => {
    const html = renderFeaturedArticle({ ...baseArticle, buildersTake: "Worth trying" });
    assert.ok(html.includes("builders-take"), "Should contain builders-take div");
    assert.ok(html.includes("Worth trying"));
  });

  it("omits Builder's Take when empty", () => {
    const html = renderFeaturedArticle({ ...baseArticle, buildersTake: "" });
    assert.ok(!html.includes("builders-take"), "Should not contain builders-take div");
  });

  it("renders meta with repo info", () => {
    const html = renderFeaturedArticle({ ...baseArticle, buildersTake: "" });
    assert.ok(html.includes("test/feat"));
    assert.ok(html.includes("2k stars"));
    assert.ok(html.includes("TypeScript"));
  });
});

// --------------- renderCompactArticle ---------------

describe("renderCompactArticle", () => {
  const baseArticle = {
    headline: "Compact Headline",
    subheadline: "Compact Sub",
    body: "This body should not appear",
    repo: { url: "https://github.com/test/cmp", name: "test/cmp", stars: 800, language: "Go" },
  };

  it("renders headline and subheadline", () => {
    const html = renderCompactArticle(baseArticle);
    assert.ok(html.includes("Compact Headline"));
    assert.ok(html.includes("compact-headline"));
    assert.ok(html.includes("Compact Sub"));
    assert.ok(html.includes("compact-subheadline"));
  });

  it("does not include body text", () => {
    const html = renderCompactArticle(baseArticle);
    assert.ok(!html.includes("This body should not appear"), "Compact article should not render body");
    assert.ok(!html.includes("compact-body"), "Should not have a body div");
  });

  it("does not include Builder's Take", () => {
    const html = renderCompactArticle({ ...baseArticle, buildersTake: "Should not appear" });
    assert.ok(!html.includes("builders-take"), "Compact article should not render Builder's Take");
    assert.ok(!html.includes("Should not appear"));
  });

  it("renders meta with repo info", () => {
    const html = renderCompactArticle(baseArticle);
    assert.ok(html.includes("test/cmp"));
    assert.ok(html.includes("800 stars"));
    assert.ok(html.includes("Go"));
  });
});

// --------------- section config ---------------

describe("section config", () => {
  it("SECTION_ORDER matches SECTIONS keys", () => {
    for (const id of SECTION_ORDER) {
      assert.ok(SECTIONS[id], `SECTIONS should contain key "${id}"`);
      assert.equal(SECTIONS[id].id, id, `SECTIONS.${id}.id should equal "${id}"`);
    }
  });

  it("every SECTIONS key is in SECTION_ORDER", () => {
    for (const id of Object.keys(SECTIONS)) {
      assert.ok(SECTION_ORDER.includes(id), `SECTION_ORDER should contain "${id}"`);
    }
  });

  it("frontPage has null query", () => {
    assert.equal(SECTIONS.frontPage.query, null);
  });

  it("topic sections have query with topics or languages", () => {
    for (const id of SECTION_ORDER) {
      if (id === "frontPage" || id === "xPulse") continue;
      const config = SECTIONS[id];
      assert.ok(config.query, `${id} should have a query`);
      const hasTopic = config.query.topics && config.query.topics.length > 0;
      const hasLang = config.query.languages && config.query.languages.length > 0;
      assert.ok(hasTopic || hasLang, `${id} should have topics or languages`);
    }
  });

  it("all sections have budget", () => {
    for (const id of SECTION_ORDER) {
      const config = SECTIONS[id];
      assert.ok(config.budget, `${id} should have a budget`);
      assert.equal(typeof config.budget.secondary, "number");
      assert.equal(typeof config.budget.quickHits, "number");
    }
  });
});

// --------------- categorizeDiverseForSection ---------------

describe("categorizeDiverseForSection", () => {
  function makeRepo(name, lang, score) {
    return { full_name: name, language: lang, _score: score };
  }

  it("respects smaller budget", () => {
    const repos = [
      makeRepo("a/1", "Rust", 10),
      makeRepo("a/2", "Go", 9),
      makeRepo("a/3", "Python", 8),
      makeRepo("a/4", "JS", 7),
      makeRepo("a/5", "TS", 6),
      makeRepo("a/6", "C", 5),
    ];
    const { lead, secondary, quickHits } = categorizeDiverseForSection(repos, { secondary: 3, quickHits: 5 });
    assert.ok(lead);
    assert.ok(secondary.length <= 3, `Expected max 3 secondary, got ${secondary.length}`);
  });

  it("handles empty input", () => {
    const { lead, secondary, quickHits } = categorizeDiverseForSection([], { secondary: 3, quickHits: 5 });
    assert.equal(lead, null);
    assert.deepEqual(secondary, []);
    assert.deepEqual(quickHits, []);
  });

  it("limits quickHits to budget", () => {
    const repos = [];
    for (let i = 0; i < 20; i++) {
      repos.push(makeRepo(`a/${i}`, "JS", 20 - i));
    }
    const { quickHits } = categorizeDiverseForSection(repos, { secondary: 3, quickHits: 5 });
    assert.ok(quickHits.length <= 5, `Expected max 5 quick hits, got ${quickHits.length}`);
  });

  it("delegates correctly from categorizeDiverse", () => {
    const repos = [
      makeRepo("a/1", "Rust", 10),
      makeRepo("a/2", "Go", 9),
    ];
    const fromDiverse = categorizeDiverse(repos);
    const fromSection = categorizeDiverseForSection(repos, { secondary: 6, quickHits: 10 });
    assert.equal(fromDiverse.lead.full_name, fromSection.lead.full_name);
  });
});

// --------------- renderSectionNav ---------------

describe("renderSectionNav", () => {
  const sectionConfigs = {
    frontPage: { id: "frontPage", label: "Front Page" },
    ai: { id: "ai", label: "AI" },
    cyber: { id: "cyber", label: "Cyber" },
  };

  it("renders correct number of tabs", () => {
    const sections = {
      frontPage: { isEmpty: false },
      ai: { isEmpty: false },
      cyber: { isEmpty: true },
    };
    const html = renderSectionNav(["frontPage", "ai", "cyber"], sections, sectionConfigs);
    const tabCount = (html.match(/section-tab/g) || []).length;
    assert.equal(tabCount, 3);
  });

  it("first tab has active class", () => {
    const sections = {
      frontPage: { isEmpty: false },
      ai: { isEmpty: false },
    };
    const html = renderSectionNav(["frontPage", "ai"], sections, sectionConfigs);
    assert.ok(html.includes('class="section-tab active"'));
  });

  it("empty sections get disabled attribute", () => {
    const sections = {
      frontPage: { isEmpty: false },
      cyber: { isEmpty: true },
    };
    const html = renderSectionNav(["frontPage", "cyber"], sections, sectionConfigs);
    assert.ok(html.includes('disabled'));
  });

  it("renders section-nav wrapper", () => {
    const sections = { frontPage: { isEmpty: false } };
    const html = renderSectionNav(["frontPage"], sections, sectionConfigs);
    assert.ok(html.includes('class="section-nav"'));
  });
});

// --------------- renderSectionContent ---------------

describe("renderSectionContent", () => {
  const makeArticle = (headline) => ({
    headline,
    subheadline: "Sub",
    body: "Body text",
    buildersTake: "",
    repo: { url: "https://github.com/test/repo", name: "test/repo", stars: 100, language: "JS", releaseName: null },
  });

  const makeQuickHit = (name) => ({
    name,
    shortName: name.split("/")[1],
    url: `https://github.com/${name}`,
    summary: "A quick hit",
    stars: 50,
  });

  it("renders empty section message when isEmpty", () => {
    const config = { id: "ai", label: "AI" };
    const html = renderSectionContent({ isEmpty: true, lead: null, secondary: [], quickHits: [] }, config);
    assert.ok(html.includes("section-empty"));
    assert.ok(html.includes("AI"));
  });

  it("renders empty section message when no data", () => {
    const config = { id: "cyber", label: "Cyber" };
    const html = renderSectionContent(null, config);
    assert.ok(html.includes("section-empty"));
  });

  it("renders lead story when present", () => {
    const config = { id: "ai", label: "AI" };
    const data = { lead: makeArticle("AI Lead"), secondary: [], quickHits: [], isEmpty: false };
    const html = renderSectionContent(data, config);
    assert.ok(html.includes("AI Lead"));
    assert.ok(html.includes("lead-story"));
  });

  it("renders full section with lead, secondary, quick hits", () => {
    const config = { id: "frontPage", label: "Front Page" };
    const data = {
      lead: makeArticle("FP Lead"),
      secondary: [makeArticle("Sec1"), makeArticle("Sec2"), makeArticle("Sec3")],
      quickHits: [makeQuickHit("a/qh1")],
      isEmpty: false,
    };
    const html = renderSectionContent(data, config);
    assert.ok(html.includes("FP Lead"));
    assert.ok(html.includes("featured-grid"));
    assert.ok(html.includes("quick-hits-section"));
    assert.ok(html.includes("quick-hits-toggle"));
  });

  it("Front Page uses 2 featured articles", () => {
    const config = { id: "frontPage", label: "Front Page" };
    const data = {
      lead: makeArticle("Lead"),
      secondary: [makeArticle("F1"), makeArticle("F2"), makeArticle("C1")],
      quickHits: [],
      isEmpty: false,
    };
    const html = renderSectionContent(data, config);
    const featuredCount = (html.match(/featured-article/g) || []).length;
    assert.equal(featuredCount, 2);
  });

  it("topic section uses 1 featured article", () => {
    const config = { id: "ai", label: "AI" };
    const data = {
      lead: makeArticle("Lead"),
      secondary: [makeArticle("F1"), makeArticle("C1"), makeArticle("C2")],
      quickHits: [],
      isEmpty: false,
    };
    const html = renderSectionContent(data, config);
    const featuredCount = (html.match(/featured-article/g) || []).length;
    assert.equal(featuredCount, 1);
  });

  it("delegates xPulse to renderXPulseContent", () => {
    const config = { id: "xPulse", label: "X Pulse", isXPulse: true };
    const data = { pulseItems: [{ topic: "AI Agents", blurb: "Hot topic", sentiment: "buzzing", handles: "@dev1" }], isEmpty: false };
    const html = renderSectionContent(data, config);
    assert.ok(html.includes("x-pulse-section"));
    assert.ok(html.includes("AI Agents"));
  });
});

// --------------- parseXSentiment ---------------

describe("parseXSentiment", () => {
  it("parses valid structured input", () => {
    const text = [
      "SENTIMENT: buzzing",
      "POST_COUNT: 42",
      "BLURB: Developers love this new framework",
      "TOP_POST: This is the best thing since sliced bread!",
    ].join("\n");
    const result = parseXSentiment(text, { name: "test/repo" });
    assert.equal(result.sentiment, "buzzing");
    assert.equal(result.postCount, 42);
    assert.equal(result.blurb, "Developers love this new framework");
    assert.equal(result.topPost, "This is the best thing since sliced bread!");
    assert.equal(result._failed, false);
  });

  it("defaults invalid sentiment to unknown", () => {
    const text = "SENTIMENT: invalid_value\nPOST_COUNT: 5\nBLURB: test\nTOP_POST: none";
    const result = parseXSentiment(text, { name: "test/repo" });
    assert.equal(result.sentiment, "unknown");
  });

  it("returns failed for empty input", () => {
    const result = parseXSentiment("", { name: "test/repo" });
    assert.equal(result.sentiment, "unknown");
    assert.equal(result._failed, true);
  });

  it("converts TOP_POST: none to null", () => {
    const text = "SENTIMENT: neutral\nPOST_COUNT: 0\nBLURB: No discussion\nTOP_POST: none";
    const result = parseXSentiment(text, { name: "test/repo" });
    assert.equal(result.topPost, null);
  });
});

// --------------- parseXPulse ---------------

describe("parseXPulse", () => {
  it("parses multiple items separated by ---", () => {
    const text = [
      "TOPIC: AI Agents",
      "BLURB: Everyone building agents now",
      "SENTIMENT: buzzing",
      "HANDLES: @openai, @anthropic",
      "---",
      "TOPIC: Rust Adoption",
      "BLURB: More companies moving to Rust",
      "SENTIMENT: positive",
      "HANDLES: @rustlang",
    ].join("\n");
    const items = parseXPulse(text);
    assert.equal(items.length, 2);
    assert.equal(items[0].topic, "AI Agents");
    assert.equal(items[0].sentiment, "buzzing");
    assert.equal(items[1].topic, "Rust Adoption");
    assert.equal(items[1].sentiment, "positive");
  });

  it("caps at 8 items", () => {
    const blocks = [];
    for (let i = 0; i < 12; i++) {
      blocks.push(`TOPIC: Topic ${i}\nBLURB: Blurb ${i}\nSENTIMENT: neutral\nHANDLES: @user`);
    }
    const text = blocks.join("\n---\n");
    const items = parseXPulse(text);
    assert.ok(items.length <= 8, `Expected max 8 items, got ${items.length}`);
  });

  it("returns empty array for empty input", () => {
    const items = parseXPulse("");
    assert.deepEqual(items, []);
  });
});

// --------------- renderSentimentBadge ---------------

describe("renderSentimentBadge", () => {
  it("returns empty string for null", () => {
    assert.equal(renderSentimentBadge(null), "");
  });

  it("returns empty string for failed sentiment", () => {
    assert.equal(renderSentimentBadge({ sentiment: "unknown", _failed: true }), "");
  });

  it("returns empty string for unknown sentiment", () => {
    assert.equal(renderSentimentBadge({ sentiment: "unknown", _failed: false }), "");
  });

  it("renders badge for valid sentiment", () => {
    const html = renderSentimentBadge({ sentiment: "buzzing", postCount: 42, blurb: "Hot topic", _failed: false });
    assert.ok(html.includes("x-sentiment"));
    assert.ok(html.includes("x-sentiment-badge"));
    assert.ok(html.includes("x-sentiment-buzzing"));
    assert.ok(html.includes("buzzing"));
    assert.ok(html.includes("42 posts"));
    assert.ok(html.includes("Hot topic"));
  });

  it("hides post count when zero", () => {
    const html = renderSentimentBadge({ sentiment: "quiet", postCount: 0, blurb: "Not much", _failed: false });
    assert.ok(html.includes("x-sentiment-quiet"));
    assert.ok(!html.includes("0 posts"));
  });
});

// --------------- renderXPulseContent ---------------

describe("renderXPulseContent", () => {
  it("shows empty state when no pulse items", () => {
    const config = { id: "xPulse", label: "X Pulse", isXPulse: true };
    const html = renderXPulseContent(null, config);
    assert.ok(html.includes("section-empty"));
  });

  it("shows empty state for empty pulseItems array", () => {
    const config = { id: "xPulse", label: "X Pulse", isXPulse: true };
    const html = renderXPulseContent({ pulseItems: [] }, config);
    assert.ok(html.includes("section-empty"));
  });

  it("renders pulse items", () => {
    const config = { id: "xPulse", label: "X Pulse", isXPulse: true };
    const data = {
      pulseItems: [
        { topic: "AI Agents", blurb: "Hot conversation", sentiment: "buzzing", handles: "@dev1, @dev2" },
        { topic: "Rust 2026", blurb: "New edition hype", sentiment: "positive", handles: "@rustlang" },
      ],
    };
    const html = renderXPulseContent(data, config);
    assert.ok(html.includes("x-pulse-section"));
    assert.ok(html.includes("x-pulse-intro"));
    assert.ok(html.includes("AI Agents"));
    assert.ok(html.includes("Rust 2026"));
    assert.ok(html.includes("x-pulse-item"));
    assert.ok(html.includes("@dev1, @dev2"));
  });
});

// --------------- xPulse section config ---------------

describe("xPulse section config", () => {
  it("xPulse exists in SECTIONS", () => {
    assert.ok(SECTIONS.xPulse, "SECTIONS should contain xPulse");
    assert.equal(SECTIONS.xPulse.id, "xPulse");
  });

  it("xPulse has null query and isXPulse flag", () => {
    assert.equal(SECTIONS.xPulse.query, null);
    assert.equal(SECTIONS.xPulse.isXPulse, true);
  });

  it("xPulse is in SECTION_ORDER", () => {
    assert.ok(SECTION_ORDER.includes("xPulse"), "SECTION_ORDER should include xPulse");
  });

  it("xPulse is last in SECTION_ORDER", () => {
    assert.equal(SECTION_ORDER[SECTION_ORDER.length - 1], "xPulse");
  });
});
