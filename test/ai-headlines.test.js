const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { selectTopHeadlines, fetchAIHeadlines, _domain } = require("../src/ai-headlines");
const { renderAIWire } = require("../src/render");

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
    assert.ok(html.includes("beyond GitHub"));
  });

  it("escapes headline html", () => {
    const html = renderAIWire([{ title: "<script>x</script>", url: "https://e.com", source: "e.com", points: 1, comments: 0, discussionUrl: null }]);
    assert.ok(!html.includes("<script>x"));
    assert.ok(html.includes("&lt;script&gt;"));
  });
});
