const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { buildLeadThreadContext, extractLead } = require("../src/threads");
const { chooseLeadPrompt } = require("../src/prompts");

describe("buildLeadThreadContext", () => {
  const manifest = [
    { date: "2026-06-24", headline: "Deno 2.8.3 sharpens the runtime", repos: ["denoland/deno", "a/b"] },
    { date: "2026-06-23", headline: "OfficeCLI automates Office", repos: ["iofficeai/officecli"] },
    { date: "2026-06-22", headline: "Old news", repos: ["foo/bar"] },
    { date: "2026-06-21", headline: "Older still", repos: ["baz/qux"] },
  ];

  it("returns a continuity block and the set of recent lead repos", () => {
    const { block, recentLeadRepos } = buildLeadThreadContext(manifest, { lookback: 3 });
    assert.match(block, /RECENT FRONT PAGES/);
    assert.match(block, /CONTINUITY GUIDANCE/);
    assert.match(block, /denoland\/deno/);
    assert.match(block, /Deno 2\.8\.3 sharpens the runtime/);
    // honors lookback — the 4th entry is excluded
    assert.equal(recentLeadRepos.has("foo/bar"), true);
    assert.equal(recentLeadRepos.has("baz/qux"), false);
    // lead repo is repos[0], not other repos in the entry
    assert.equal(recentLeadRepos.has("a/b"), false);
  });

  it("is fail-soft on a missing/garbage manifest", () => {
    for (const bad of [null, undefined, [], "nope", {}]) {
      const r = buildLeadThreadContext(bad);
      assert.equal(r.block, "");
      assert.equal(r.recentLeadRepos.size, 0);
    }
  });

  it("skips entries with no repos and tolerates a missing headline", () => {
    const m = [
      { date: "2026-06-24", repos: [] },
      { date: "2026-06-23", repos: ["x/y"] }, // no headline
    ];
    const { block, recentLeadRepos } = buildLeadThreadContext(m, { lookback: 5 });
    assert.equal(recentLeadRepos.has("x/y"), true);
    assert.equal(recentLeadRepos.has(undefined), false);
    assert.match(block, /x\/y/);
    assert.match(block, /headline unavailable/);
  });
});

describe("extractLead", () => {
  it("pulls repo + headline from front-page content", () => {
    const content = { sections: { frontPage: { lead: { headline: "Big news", repo: { full_name: "o/r" } } } } };
    assert.deepEqual(extractLead(content), { repo: "o/r", headline: "Big news" });
  });

  it("falls back to repo.name and to content.lead", () => {
    assert.deepEqual(extractLead({ lead: { headline: "H", repo: { name: "r" } } }), { repo: "r", headline: "H" });
  });

  it("returns null when there is no usable lead", () => {
    for (const bad of [null, {}, { sections: { frontPage: {} } }, { lead: { headline: "x", repo: {} } }]) {
      assert.equal(extractLead(bad), null);
    }
  });
});

describe("chooseLeadPrompt continuity injection", () => {
  const candidates = [
    { repo: { full_name: "a/one", description: "first", language: "Go", topics: [] }, reason: "+120 stars" },
    { repo: { full_name: "b/two", description: "second", language: "Rust", topics: [] }, reason: "+90 stars" },
  ];

  it("omits the continuity block when no threadBlock is given (back-compat)", () => {
    const p = chooseLeadPrompt(candidates);
    assert.doesNotMatch(p, /RECENT FRONT PAGES/);
    assert.match(p, /CANDIDATES:/);
    assert.match(p, /LEAD:/);
  });

  it("includes the continuity block when a threadBlock is given", () => {
    const { block } = buildLeadThreadContext([
      { date: "2026-06-24", headline: "Yesterday's lead", repos: ["o/prev"] },
    ]);
    const p = chooseLeadPrompt(candidates, block);
    assert.match(p, /RECENT FRONT PAGES/);
    assert.match(p, /o\/prev/);
    // candidates still present and format intact
    assert.match(p, /a\/one/);
    assert.match(p, /LEAD:/);
  });
});
