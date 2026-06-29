"use strict";

/**
 * Keyword retrieval over the AI Desk corpus (data/corpus.json).
 *
 * BM25 ranking with a gentle recency boost so a fresh edition outranks a stale
 * one when relevance ties. No embeddings: the corpus is small enough (~700
 * chunks) to score in memory on the edge, and keyword match keeps citations
 * honestly tied to literal coverage (a vector index is the future upgrade).
 *
 * CANONICAL COPY. The Cloudflare worker (worker/index.js) inlines an identical
 * `tokenize` + `scoreChunks` because it must stay import-free (its test harness
 * compiles it as a standalone string). Keep the two in sync.
 */

const STOPWORDS = new Set(
  ("a an and are as at be by for from has have how i in is it its of on or that the to was what when where which who " +
    "with you your about into over than then this these those tell me show find get does do can could would should " +
    "whats what's vs versus best good any all more most use using used")
    .split(" ")
);

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

const K1 = 1.2;
const B = 0.75;
const DAY_MS = 86400000;

/**
 * Score chunks against a query. Pure + deterministic given `now`.
 * @param {string} query
 * @param {Array} chunks  corpus chunks ({ text, date, ... })
 * @param {object} opts   { k=6, now=Date.now(), recencyWeight=0.3, halfLifeDays=45, minScore=0 }
 * @returns {Array} top-k [{ chunk, score, bm25, matched:[term] }]
 */
function scoreChunks(query, chunks, opts) {
  const o = opts || {};
  const k = o.k || 6;
  const now = o.now || Date.now();
  const recencyWeight = o.recencyWeight != null ? o.recencyWeight : 0.3;
  const halfLifeDays = o.halfLifeDays || 45;
  const minScore = o.minScore || 0;

  const qTerms = Array.from(new Set(tokenize(query)));
  if (!qTerms.length || !chunks.length) return [];

  // Document frequencies + lengths (single pass).
  const docTokens = new Array(chunks.length);
  const df = new Map();
  let totalLen = 0;
  for (let d = 0; d < chunks.length; d++) {
    const toks = tokenize(chunks[d].text);
    docTokens[d] = toks;
    totalLen += toks.length;
    const seen = new Set();
    for (const t of toks) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const N = chunks.length;
  const avgdl = totalLen / N || 1;

  const idf = new Map();
  for (const t of qTerms) {
    const n = df.get(t) || 0;
    // BM25 idf, floored at 0 so a term in nearly every doc can't go negative.
    idf.set(t, Math.max(0, Math.log(1 + (N - n + 0.5) / (n + 0.5))));
  }

  const results = [];
  for (let d = 0; d < N; d++) {
    const toks = docTokens[d];
    if (!toks.length) continue;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);

    let bm25 = 0;
    const matched = [];
    for (const t of qTerms) {
      const f = tf.get(t);
      if (!f) continue;
      matched.push(t);
      const denom = f + K1 * (1 - B + (B * toks.length) / avgdl);
      bm25 += idf.get(t) * ((f * (K1 + 1)) / denom);
    }
    if (bm25 <= 0) continue;

    // Recency multiplier in [1, 1+recencyWeight]: 1+w at age 0, decaying by half
    // every halfLifeDays.
    const c = chunks[d];
    let recency = 1;
    if (c.date) {
      const ageDays = Math.max(0, (now - Date.parse(c.date + "T00:00:00Z")) / DAY_MS);
      recency = 1 + recencyWeight * Math.pow(0.5, ageDays / halfLifeDays);
    }
    const score = bm25 * recency;
    if (score > minScore) results.push({ chunk: c, score, bm25, matched });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}

/**
 * Format retrieval results into a grounding block + a sources array for the UI.
 * The block is injected into the system prompt; sources are streamed to the
 * client so it can render inline [n] citations as links.
 */
function formatGrounding(results) {
  if (!results || !results.length) return { block: "", sources: [] };
  const lines = [];
  const sources = [];
  results.forEach((r, idx) => {
    const n = idx + 1;
    const c = r.chunk;
    const tag = c.repo ? c.repo : "edition";
    const stars = c.stars != null ? `, ${c.stars.toLocaleString()}★` : "";
    lines.push(`[${n}] ${c.title} (${tag}, ${c.date}${stars})\n    ${c.text}`);
    sources.push({ n, title: c.title, url: c.url, repo: c.repo || null, date: c.date });
  });
  const block =
    "\n\nGROUNDING — relevant Git Times coverage retrieved for this question. " +
    "Cite the sources you use inline as [n], and if these don't answer the question, say so plainly rather than guessing:\n" +
    lines.join("\n");
  return { block, sources };
}

module.exports = { tokenize, scoreChunks, formatGrounding, STOPWORDS };
