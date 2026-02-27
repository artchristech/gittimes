const { describe, it, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const https = require("https");
const { EventEmitter } = require("events");

const {
  fetchSectionRepos,
  fetchAndEnrichSection,
  fetchAndEnrich,
  fetchAllSections,
} = require("../src/github");

// --------------- HTTP mock helper ---------------

/**
 * Build a mock for https.get that routes by URL substring.
 * @param {Object} responseMap - { urlSubstring: { statusCode, body } }
 *   body can be an object (JSON-serialized) or a string.
 */
function mockHttpsGet(responseMap) {
  mock.method(https, "get", (optionsOrUrl, cb) => {
    const url =
      typeof optionsOrUrl === "string"
        ? optionsOrUrl
        : `https://${optionsOrUrl.hostname}${optionsOrUrl.path}`;

    let match = null;
    for (const [substr, resp] of Object.entries(responseMap)) {
      if (url.includes(substr)) {
        match = resp;
        break;
      }
    }

    if (!match) {
      match = { statusCode: 200, body: { items: [] } };
    }

    const res = new EventEmitter();
    res.statusCode = match.statusCode || 200;
    const data =
      typeof match.body === "string"
        ? match.body
        : JSON.stringify(match.body);

    // Callback with res, then emit data asynchronously
    if (cb) cb(res);
    process.nextTick(() => {
      res.emit("data", data);
      res.emit("end");
    });

    // Return a fake ClientRequest with .on("error") no-op
    const req = new EventEmitter();
    return req;
  });
}

// Base repo fixture
function makeGitHubRepo(name, stars = 100, lang = "JavaScript") {
  const now = new Date();
  return {
    full_name: name,
    name: name.split("/")[1],
    html_url: `https://github.com/${name}`,
    stargazers_count: stars,
    forks_count: 10,
    open_issues_count: 5,
    language: lang,
    description: `Description of ${name}`,
    topics: ["test"],
    created_at: new Date(now - 2 * 86400000).toISOString(),
    pushed_at: new Date(now - 1 * 86400000).toISOString(),
  };
}

afterEach(() => mock.restoreAll());

// --------------- fetchSectionRepos ---------------

describe("fetchSectionRepos", () => {
  afterEach(() => mock.restoreAll());

  it("constructs queries from section topics and languages", async () => {
    const captured = [];
    mock.method(https, "get", (options, cb) => {
      const url = `https://${options.hostname}${options.path}`;
      captured.push(url);
      const res = new EventEmitter();
      res.statusCode = 200;
      if (cb) cb(res);
      process.nextTick(() => {
        res.emit("data", JSON.stringify({ items: [] }));
        res.emit("end");
      });
      return new EventEmitter();
    });

    const config = {
      id: "test",
      query: { topics: ["ai", "ml"], languages: ["Python"] },
    };
    await fetchSectionRepos("fake-token", config);

    assert.ok(captured.some((u) => u.includes("topic%3Aai")), "Should query topic:ai");
    assert.ok(captured.some((u) => u.includes("topic%3Aml")), "Should query topic:ml");
    assert.ok(captured.some((u) => u.includes("language")), "Should query language");
  });

  it("deduplicates repos by full_name", async () => {
    const repo = makeGitHubRepo("org/dup", 200);
    mockHttpsGet({
      "search/repositories": { statusCode: 200, body: { items: [repo, repo, repo] } },
    });

    const config = {
      id: "test",
      query: { topics: ["ai"], languages: [] },
    };
    const repos = await fetchSectionRepos("fake-token", config);
    const names = repos.map((r) => r.full_name);
    const unique = [...new Set(names)];
    assert.equal(names.length, unique.length, "Should have no duplicates");
  });

  it("returns empty array when API returns no items", async () => {
    mockHttpsGet({
      "search/repositories": { statusCode: 200, body: { items: [] } },
    });

    const config = {
      id: "test",
      query: { topics: ["niche"], languages: [] },
    };
    const repos = await fetchSectionRepos("fake-token", config);
    assert.equal(repos.length, 0);
  });
});

// --------------- fetchAndEnrichSection ---------------

describe("fetchAndEnrichSection", () => {
  afterEach(() => mock.restoreAll());

  it("scores, categorizes, and enriches repos", async () => {
    const repos = [
      makeGitHubRepo("org/alpha", 5000, "Rust"),
      makeGitHubRepo("org/beta", 3000, "Go"),
      makeGitHubRepo("org/gamma", 1000, "Python"),
    ];

    mockHttpsGet({
      "search/repositories": { statusCode: 200, body: { items: repos } },
      "readme": { statusCode: 200, body: { content: Buffer.from("# README").toString("base64") } },
      "releases/latest": { statusCode: 404, body: { message: "Not Found" } },
    });

    const config = {
      id: "ai",
      label: "AI",
      budget: { secondary: 2, quickHits: 5 },
      query: { topics: ["ai"], languages: [] },
    };
    const result = await fetchAndEnrichSection("fake-token", config);

    assert.ok(result.lead, "Should have a lead");
    assert.ok(result.lead.readmeExcerpt !== undefined, "Lead should be enriched with readme");
    assert.ok(Array.isArray(result.secondary));
    assert.ok(Array.isArray(result.quickHits));
  });

  it("filters out repos in globalSeen", async () => {
    const repos = [
      makeGitHubRepo("org/seen", 5000),
      makeGitHubRepo("org/new", 3000),
    ];

    mockHttpsGet({
      "search/repositories": { statusCode: 200, body: { items: repos } },
      "readme": { statusCode: 200, body: { content: Buffer.from("# Test").toString("base64") } },
      "releases/latest": { statusCode: 404, body: { message: "Not Found" } },
    });

    const globalSeen = new Set(["org/seen"]);
    const config = {
      id: "ai",
      label: "AI",
      budget: { secondary: 2, quickHits: 5 },
      query: { topics: ["ai"], languages: [] },
    };
    const result = await fetchAndEnrichSection("fake-token", config, { globalSeen });

    assert.ok(result.lead);
    assert.equal(result.lead.name, "org/new", "Lead should not be the seen repo");
  });

  it("returns empty when all repos are filtered out", async () => {
    const repos = [makeGitHubRepo("org/seen", 5000)];

    mockHttpsGet({
      "search/repositories": { statusCode: 200, body: { items: repos } },
    });

    const globalSeen = new Set(["org/seen"]);
    const config = {
      id: "ai",
      label: "AI",
      budget: { secondary: 2, quickHits: 5 },
      query: { topics: ["ai"], languages: [] },
    };
    const result = await fetchAndEnrichSection("fake-token", config, { globalSeen });

    assert.equal(result.lead, null);
    assert.deepEqual(result.secondary, []);
  });
});

// --------------- fetchAndEnrich (front page) ---------------

describe("fetchAndEnrich", () => {
  afterEach(() => mock.restoreAll());

  it("returns lead, secondary, and quickHits with enriched data", async () => {
    const repos = [];
    for (let i = 0; i < 10; i++) {
      repos.push(makeGitHubRepo(`org/repo-${i}`, 5000 - i * 100, i % 2 === 0 ? "Rust" : "Go"));
    }

    mockHttpsGet({
      "search/repositories": { statusCode: 200, body: { items: repos } },
      "ossinsight": { statusCode: 200, body: { data: { rows: [] } } },
      "readme": { statusCode: 200, body: { content: Buffer.from("# Project\nSome readme content").toString("base64") } },
      "releases/latest": { statusCode: 200, body: { tag_name: "v1.0.0", name: "Release 1.0", body: "Release notes here", published_at: new Date().toISOString() } },
    });

    const result = await fetchAndEnrich("fake-token");

    assert.ok(result.lead, "Should have a lead");
    assert.ok(result.lead.readmeExcerpt, "Lead should have readmeExcerpt");
    assert.ok(Array.isArray(result.secondary));
    assert.ok(Array.isArray(result.quickHits));
  });

  it("populates release fields from enrichment", async () => {
    const repos = [];
    for (let i = 0; i < 8; i++) {
      repos.push(makeGitHubRepo(`org/r-${i}`, 3000 - i * 100, "Rust"));
    }

    mockHttpsGet({
      "search/repositories": { statusCode: 200, body: { items: repos } },
      "ossinsight": { statusCode: 200, body: { data: { rows: [] } } },
      "readme": { statusCode: 200, body: { content: Buffer.from("# Test").toString("base64") } },
      "releases/latest": {
        statusCode: 200,
        body: { tag_name: "v2.0", name: "v2.0", body: "New release", published_at: new Date().toISOString() },
      },
    });

    const result = await fetchAndEnrich("fake-token");

    assert.ok(result.lead.releaseName, "Lead should have releaseName");
    assert.ok(result.lead.releaseNotes, "Lead should have releaseNotes");
  });
});

// --------------- fetchAllSections ---------------

describe("fetchAllSections", () => {
  afterEach(() => mock.restoreAll());

  it("returns all section keys with front page populating globalSeen", async () => {
    // Create repos with distinct names per section query
    const fpRepos = [];
    for (let i = 0; i < 10; i++) {
      fpRepos.push(makeGitHubRepo(`fp/repo-${i}`, 5000 - i * 100, i % 2 === 0 ? "Rust" : "Go"));
    }
    const sectionRepos = [];
    for (let i = 0; i < 5; i++) {
      sectionRepos.push(makeGitHubRepo(`sec/repo-${i}`, 2000 - i * 100, "Python"));
    }

    mockHttpsGet({
      "search/repositories": { statusCode: 200, body: { items: [...fpRepos, ...sectionRepos] } },
      "ossinsight": { statusCode: 200, body: { data: { rows: [] } } },
      "readme": { statusCode: 200, body: { content: Buffer.from("# Test").toString("base64") } },
      "releases/latest": { statusCode: 200, body: { tag_name: "v1.0", body: "notes", published_at: new Date().toISOString() } },
    });

    const result = await fetchAllSections("fake-token");

    assert.ok(result.frontPage, "Should have frontPage");
    assert.ok(result.frontPage.lead, "Front page should have lead");
    // Should have at least some other section keys
    const keys = Object.keys(result);
    assert.ok(keys.length > 1, "Should have multiple sections");
  });
});
