"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { buildCorpus } = require("../src/build-corpus");
const { tokenize, scoreChunks, formatGrounding } = require("../src/retrieve");

const DB = path.join(__dirname, "..", "data", "gittimes.db");

// --- build-corpus ---

test("buildCorpus — emits repo + edition chunks with citable fields", () => {
  const c = buildCorpus(DB);
  assert.ok(c.count > 0);
  assert.ok(c.chunks.every((x) => typeof x.text === "string"));
  assert.ok(c.chunks.every((x) => /^\/editions\//.test(x.url)), "every chunk cites an edition URL");
  assert.ok(c.chunks.every((x) => typeof x.i === "number"), "chunks are indexed for [n] labels");
  assert.ok(c.chunks.some((x) => x.type === "repo"));
  assert.ok(c.chunks.some((x) => x.type === "edition"));
  // newest-first ordering
  for (let i = 1; i < c.chunks.length; i++) {
    if (c.chunks[i - 1].date && c.chunks[i].date) {
      assert.ok(c.chunks[i - 1].date >= c.chunks[i].date, "chunks sorted newest-first");
    }
  }
});

// --- tokenize ---

test("tokenize — lowercases, splits, drops stopwords + shorts", () => {
  const t = tokenize("What is the BEST RAG framework?");
  assert.deepEqual(t, ["rag", "framework"]);
});

// --- scoreChunks ---

const SYNTH = [
  { i: 0, type: "repo", repo: "acme/rag-eval", title: "RAG eval harness", text: "acme rag eval retrieval benchmark harness", date: "2026-06-20", url: "/editions/2026-06-20/" },
  { i: 1, type: "repo", repo: "foo/webgl-toy", title: "WebGL toy", text: "foo webgl shader graphics toy", date: "2026-06-21", url: "/editions/2026-06-21/" },
  { i: 2, type: "edition", repo: null, title: "Old RAG piece", text: "rag retrieval grounding old coverage", date: "2026-01-01", url: "/editions/2026-01-01/" },
];
const NOW = Date.parse("2026-06-27T00:00:00Z");

test("scoreChunks — ranks the on-topic chunk first", () => {
  const r = scoreChunks("rag retrieval benchmark", SYNTH, { now: NOW, k: 3 });
  assert.ok(r.length >= 1);
  assert.equal(r[0].chunk.repo, "acme/rag-eval");
  assert.ok(r[0].matched.includes("rag"));
});

test("scoreChunks — recency breaks ties toward the newer chunk", () => {
  const a = { i: 0, text: "kubernetes operator pattern", date: "2026-06-26" };
  const b = { i: 1, text: "kubernetes operator pattern", date: "2026-02-01" };
  const r = scoreChunks("kubernetes operator", [a, b], { now: NOW, k: 2 });
  assert.equal(r[0].chunk.date, "2026-06-26", "newer identical chunk wins");
  assert.ok(r[0].score > r[1].score);
});

test("scoreChunks — empty/stopword-only query returns nothing", () => {
  assert.deepEqual(scoreChunks("the is of", SYNTH, { now: NOW }), []);
  assert.deepEqual(scoreChunks("", SYNTH, { now: NOW }), []);
});

test("scoreChunks — a query matching nothing returns nothing", () => {
  assert.deepEqual(scoreChunks("nonexistentxyz", SYNTH, { now: NOW }), []);
});

test("scoreChunks — respects k", () => {
  const r = scoreChunks("rag retrieval grounding webgl", SYNTH, { now: NOW, k: 1 });
  assert.equal(r.length, 1);
});

// --- formatGrounding ---

test("formatGrounding — builds a [n] block + parallel sources array", () => {
  const r = scoreChunks("rag retrieval", SYNTH, { now: NOW, k: 2 });
  const { block, sources } = formatGrounding(r);
  assert.ok(block.includes("[1]"));
  assert.ok(block.toUpperCase().includes("GROUNDING"));
  assert.equal(sources.length, r.length);
  assert.equal(sources[0].n, 1);
  assert.ok(sources[0].url && sources[0].title);
});

test("formatGrounding — empty results yields empty block", () => {
  assert.deepEqual(formatGrounding([]), { block: "", sources: [] });
});

// --- end-to-end smoke against the real built corpus ---

test("real corpus — a topical query returns relevant, cited results", () => {
  const p = path.join(__dirname, "..", "data", "corpus.json");
  if (!fs.existsSync(p)) return; // corpus is a build artifact; skip if absent
  const corpus = JSON.parse(fs.readFileSync(p, "utf8"));
  const r = scoreChunks("security audit agent", corpus.chunks, { now: NOW, k: 5 });
  assert.ok(r.length > 0, "should retrieve something for a real topic");
  const { sources } = formatGrounding(r);
  assert.ok(sources.every((s) => /^\/editions\//.test(s.url)), "citations point at editions");
});
