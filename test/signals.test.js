const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  shortName,
  parseHNActivity,
  parseNpmDownloads,
  parsePypiDownloads,
  formatSignals,
  enrichCandidatesWithSignals,
} = require("../src/signals");
const { candidateSummaryLines } = require("../src/prompts");

// --- pure parsers ---
describe("signals parsers", () => {
  it("shortName lowercases the repo's last path segment", () => {
    assert.equal(shortName("facebook/React"), "react");
    assert.equal(shortName(null), null);
  });

  it("parseHNActivity sums only hits that reference the repo", () => {
    const json = {
      hits: [
        { url: "https://github.com/facebook/react", points: 100, num_comments: 40 },
        { title: "React is great", points: 10, num_comments: 5 },
        { url: "https://example.com/unrelated", points: 999, num_comments: 999 },
      ],
    };
    const r = parseHNActivity(json, "facebook/react");
    assert.equal(r.points, 110); // 100 (url) + 10 (title contains "react"); unrelated excluded
    assert.equal(r.comments, 45);
    assert.equal(r.count, 2);
  });

  it("parseHNActivity returns null when nothing matches or input is bad", () => {
    assert.equal(parseHNActivity({ hits: [] }, "a/b"), null);
    assert.equal(parseHNActivity(null, "a/b"), null);
    assert.equal(parseHNActivity({ hits: [{ url: "x", points: 5 }] }, "a/b"), null);
  });

  it("parseNpmDownloads / parsePypiDownloads pull weekly counts", () => {
    assert.equal(parseNpmDownloads({ downloads: 12345 }), 12345);
    assert.equal(parseNpmDownloads({}), null);
    assert.equal(parsePypiDownloads({ data: { last_week: 678 } }), 678);
    assert.equal(parsePypiDownloads({ data: {} }), null);
  });

  it("formatSignals renders a compact buzz line, '' when empty", () => {
    assert.equal(formatSignals(null), "");
    assert.equal(formatSignals({ hn: { points: 0, comments: 0, count: 0 } }), "");
    const s = formatSignals({ hn: { points: 1200, comments: 340, count: 2 }, downloads: { ecosystem: "npm", weekly: 2000000 } });
    assert.match(s, /^buzz:/);
    assert.match(s, /HN 1\.2k pts\/340 comments across 2 threads/);
    assert.match(s, /npm 2M downloads\/wk/);
  });
});

// --- enrichment orchestration (offline, stubbed fetch) ---
function makeFetch(routes) {
  return async (url) => {
    for (const [frag, data] of routes) {
      if (url.includes(frag)) return { ok: true, json: async () => data };
    }
    return { ok: false, json: async () => ({}) };
  };
}

describe("enrichCandidatesWithSignals", () => {
  it("attaches signals + a signalSummary from stubbed sources", async () => {
    const candidates = [{ repo: { full_name: "facebook/react", language: "JavaScript" }, reason: "+500 stars" }];
    const fetchImpl = makeFetch([
      ["hn.algolia.com", { hits: [{ url: "https://github.com/facebook/react", points: 300, num_comments: 80 }] }],
      ["api.npmjs.org", { downloads: 20000000 }],
    ]);
    await enrichCandidatesWithSignals(candidates, { fetchImpl, concurrency: 2 });
    assert.ok(candidates[0].signals.hn);
    assert.equal(candidates[0].signals.downloads.ecosystem, "npm");
    assert.match(candidates[0].signalSummary, /buzz:/);
    // surfaced in the editor's candidate list
    assert.match(candidateSummaryLines(candidates), /buzz:/);
  });

  it("is fail-soft when a source throws — candidate still present, no signal, no throw", async () => {
    const candidates = [{ repo: { full_name: "a/b", language: "Python" }, reason: "x" }];
    const fetchImpl = async () => { throw new Error("network down"); };
    await assert.doesNotReject(enrichCandidatesWithSignals(candidates, { fetchImpl }));
    assert.equal(candidates[0].signals, undefined);
    assert.equal(candidates[0].signalSummary, undefined);
  });

  it("is fail-soft on non-200 responses (no signal attached)", async () => {
    const candidates = [{ repo: { full_name: "a/b", language: "JavaScript" }, reason: "x" }];
    const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
    await enrichCandidatesWithSignals(candidates, { fetchImpl });
    assert.equal(candidates[0].signals, undefined);
  });

  it("GT_DISABLE_SOURCES=1 turns the layer off entirely", async () => {
    const prev = process.env.GT_DISABLE_SOURCES;
    process.env.GT_DISABLE_SOURCES = "1";
    let called = false;
    const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const candidates = [{ repo: { full_name: "a/b", language: "JavaScript" }, reason: "x" }];
    await enrichCandidatesWithSignals(candidates, { fetchImpl });
    assert.equal(called, false);
    assert.equal(candidates[0].signals, undefined);
    if (prev === undefined) delete process.env.GT_DISABLE_SOURCES; else process.env.GT_DISABLE_SOURCES = prev;
  });

  it("handles an empty candidate list", async () => {
    assert.deepEqual(await enrichCandidatesWithSignals([], { fetchImpl: makeFetch([]) }), []);
  });
});
