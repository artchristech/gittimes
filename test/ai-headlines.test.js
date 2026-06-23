const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { selectTopHeadlines, fetchAIHeadlines, fetchArxiv, parseArxivAtom, _domain } = require("../src/ai-headlines");
const { renderAIWire, renderSourceLine } = require("../src/render");

const ARXIV_XML = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Scaling Laws for
    Mixture-of-Experts</title>
    <id>http://arxiv.org/abs/2606.00001v1</id>
  </entry>
  <entry>
    <title>A New RAG Benchmark</title>
    <id>http://arxiv.org/abs/2606.00002v1</id>
  </entry>
</feed>`;

const hits = [
  { title: "OpenAI releases GPT-5.5", url: "https://openai.com/blog/gpt55", points: 320, num_comments: 210, objectID: "1" },
  { title: "A new diffusion model for video", url: "https://example.com/vid", points: 95, num_comments: 40, objectID: "2" },
  { title: "Show HN: my todo app", url: "https://example.com/todo", points: 500, num_comments: 12, objectID: "3" }, // not AI
  { title: "Ask HN: how to learn AI?", points: 600, num_comments: 300, objectID: "4" }, // no url
  { title: "Tiny LLM runs on a Raspberry Pi", url: "https://example.com/llm", points: 30, num_comments: 5, objectID: "5" }, // below floor
  { title: "Anthropic ships Claude update", url: "https://openai.com/blog/gpt55", points: 80, num_comments: 9, objectID: "6" }, // dup url
];

describe("selectTopHeadlines", () => {
  it("keeps only AI, externally-linked, above-floor stories sorted by points", () => {
    const out = selectTopHeadlines(hits, { limit: 5, minPoints: 40 });
    assert.equal(out[0].title, "OpenAI releases GPT-5.5");
    assert.equal(out[1].title, "A new diffusion model for video");
    assert.equal(out.length, 2, "todo (not AI), Ask HN (no url), tiny LLM (below floor), dup url all dropped");
  });

  it("derives source domain and discussion url", () => {
    const [top] = selectTopHeadlines(hits, { minPoints: 40 });
    assert.equal(top.source, "openai.com");
    assert.equal(top.discussionUrl, "https://news.ycombinator.com/item?id=1");
  });

  it("respects the limit", () => {
    assert.equal(selectTopHeadlines(hits, { limit: 1, minPoints: 40 }).length, 1);
  });

  it("returns [] for non-array input", () => {
    assert.deepEqual(selectTopHeadlines(null), []);
  });
});

describe("_domain", () => {
  it("strips www and returns hostname", () => {
    assert.equal(_domain("https://www.example.com/path"), "example.com");
    assert.equal(_domain("not a url"), "");
  });
});

describe("fetchAIHeadlines", () => {
  it("returns [] on fetch failure (never throws)", async () => {
    const out = await fetchAIHeadlines({ fetchImpl: async () => { throw new Error("network"); } });
    assert.deepEqual(out, []);
  });

  it("returns [] on non-ok response", async () => {
    const out = await fetchAIHeadlines({ fetchImpl: async () => ({ ok: false, status: 503 }) });
    assert.deepEqual(out, []);
  });

  it("parses a successful response", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ hits }) });
    const out = await fetchAIHeadlines({ fetchImpl, minPoints: 40, limit: 5 });
    assert.equal(out[0].title, "OpenAI releases GPT-5.5");
  });
});

describe("renderAIWire", () => {
  it("returns empty string when no headlines", () => {
    assert.equal(renderAIWire([]), "");
    assert.equal(renderAIWire(null), "");
  });

  it("renders a wire block with links and sources", () => {
    const html = renderAIWire(selectTopHeadlines(hits, { minPoints: 40 }));
    assert.ok(html.includes("ai-wire"));
    assert.ok(html.includes("OpenAI releases GPT-5.5"));
    assert.ok(html.includes("openai.com"));
    assert.ok(html.includes("Beyond GitHub"));
    assert.ok(html.includes("The AI Wire"));
  });

  it("escapes headline html", () => {
    const html = renderAIWire([{ title: "<script>x</script>", url: "https://e.com", source: "e.com", points: 1, comments: 0, discussionUrl: null }]);
    assert.ok(!html.includes("<script>x"));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("renders a research tier when research is supplied", () => {
    const html = renderAIWire([], { research: parseArxivAtom(ARXIV_XML, 2) });
    assert.ok(html.includes("From the labs"));
    assert.ok(html.includes("Scaling Laws for Mixture-of-Experts"));
    assert.ok(html.includes("arxiv.org/abs/2606.00001"));
  });

  it("returns content when only research is present (no stories)", () => {
    assert.notEqual(renderAIWire([], { research: parseArxivAtom(ARXIV_XML, 1) }), "");
    assert.equal(renderAIWire([], { research: [] }), "");
  });
});

describe("parseArxivAtom", () => {
  it("parses entries and normalizes whitespace in titles", () => {
    const out = parseArxivAtom(ARXIV_XML, 5);
    assert.equal(out.length, 2);
    assert.equal(out[0].title, "Scaling Laws for Mixture-of-Experts");
    assert.equal(out[0].source, "arXiv");
    assert.equal(out[0].url, "http://arxiv.org/abs/2606.00001v1");
  });
  it("respects limit and tolerates junk", () => {
    assert.equal(parseArxivAtom(ARXIV_XML, 1).length, 1);
    assert.deepEqual(parseArxivAtom("", 3), []);
    assert.deepEqual(parseArxivAtom(null, 3), []);
  });
});

describe("fetchArxiv", () => {
  it("returns [] on failure (never throws)", async () => {
    assert.deepEqual(await fetchArxiv({ fetchImpl: async () => { throw new Error("net"); } }), []);
    assert.deepEqual(await fetchArxiv({ fetchImpl: async () => ({ ok: false, status: 500 }) }), []);
  });
  it("parses a successful response", async () => {
    const out = await fetchArxiv({ fetchImpl: async () => ({ ok: true, text: async () => ARXIV_XML }), limit: 2 });
    assert.equal(out.length, 2);
    assert.equal(out[1].title, "A New RAG Benchmark");
  });
});

describe("renderSourceLine", () => {
  const repo = { url: "https://github.com/a/b", name: "a/b", releaseName: "v1.2.0" };
  it("renders a source credit with the repo link", () => {
    const html = renderSourceLine({ repo });
    assert.ok(html.includes("Source:"));
    assert.ok(html.includes("a/b"));
    assert.ok(html.includes("README and release notes"));
  });
  it("says project README when there is no release", () => {
    const html = renderSourceLine({ repo: { ...repo, releaseName: null } });
    assert.ok(html.includes("project README"));
  });
  it("returns empty for trend articles or missing url", () => {
    assert.equal(renderSourceLine({ repo, _isTrend: true }), "");
    assert.equal(renderSourceLine({ repo: { url: "#", name: "x" } }), "");
    assert.equal(renderSourceLine({}), "");
  });
});
