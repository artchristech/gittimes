const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { attachModelDropHeadlines } = require("../src/xai");
const { renderModelDrops } = require("../src/render");
const { modelDropHeadlinesPrompt } = require("../src/prompts");

const DROPS = [
  { id: "1", author: "nvidia", name: "Nemotron-3-Embed", task: "sentence-similarity", likes: 72, ageDays: 2, url: "https://hf.co/a" },
  { id: "2", author: "unsloth", name: "inkling-GGUF", task: "image-text-to-text", likes: 106, ageDays: 1, url: "https://hf.co/b" },
];

// A client whose only job is to hand back a canned completion. attachModelDropHeadlines
// talks to the OpenAI-compatible surface, so that is all we stub.
const clientReturning = (text) => ({
  chat: {
    completions: {
      create: async () => ({ choices: [{ message: { content: text } }] }),
    },
  },
});

const clientThrowing = () => ({
  chat: {
    completions: {
      create: async () => {
        throw Object.assign(new Error("provider down"), { status: 500 });
      },
    },
  },
});

describe("modelDropHeadlinesPrompt", () => {
  it("grounds the prompt in only the fields we actually have", () => {
    const p = modelDropHeadlinesPrompt(DROPS);
    assert.match(p, /Nemotron-3-Embed — released by nvidia, task: sentence similarity/);
    assert.match(p, /Invent no benchmarks/);
  });
});

describe("attachModelDropHeadlines", () => {
  it("attaches one headline per drop, in order", async () => {
    const out = await attachModelDropHeadlines(
      clientReturning("1. Nvidia targets retrieval with a compact embedder\n2. Vision-language model small enough to run local"),
      DROPS
    );
    assert.equal(out[0].headline, "Nvidia targets retrieval with a compact embedder");
    assert.equal(out[1].headline, "Vision-language model small enough to run local");
  });

  it("strips wrapping quotes and a trailing period", async () => {
    const out = await attachModelDropHeadlines(clientReturning('1. "A compact embedder lands."\n2. Second one here'), DROPS);
    assert.equal(out[0].headline, "A compact embedder lands");
  });

  it("drops an over-long headline rather than letting it break the card", async () => {
    const long = "one two three four five six seven eight nine ten eleven twelve";
    const out = await attachModelDropHeadlines(clientReturning(`1. ${long}\n2. Short and fine`), DROPS);
    assert.equal(out[0].headline, undefined);
    assert.equal(out[1].headline, "Short and fine");
  });

  it("leaves drops untouched when the provider fails", async () => {
    const out = await attachModelDropHeadlines(clientThrowing(), DROPS);
    assert.deepEqual(out, DROPS);
  });

  it("returns an empty list unchanged without calling the model", async () => {
    let called = false;
    const spy = { chat: { completions: { create: async () => { called = true; return {}; } } } };
    assert.deepEqual(await attachModelDropHeadlines(spy, []), []);
    assert.equal(called, false);
  });
});

describe("renderModelDrops with headlines", () => {
  it("promotes the headline and demotes the model name to a slug", () => {
    const html = renderModelDrops([{ ...DROPS[0], headline: "Nvidia targets retrieval" }]);
    assert.match(html, /<span class="drop-slug">Nemotron-3-Embed<\/span>/);
    assert.match(html, /<span class="drop-headline">Nvidia targets retrieval<\/span>/);
    assert.doesNotMatch(html, /drop-name/);
  });

  it("falls back to the model name as the hed when no headline survived", () => {
    const html = renderModelDrops([DROPS[0]]);
    assert.match(html, /<span class="drop-name">Nemotron-3-Embed<\/span>/);
    assert.doesNotMatch(html, /drop-headline/);
  });

  it("escapes a headline containing markup", () => {
    const html = renderModelDrops([{ ...DROPS[0], headline: "<script>x</script>" }]);
    assert.doesNotMatch(html, /<script>/);
  });
});
