"use strict";

/**
 * Build data/corpus.json — the retrieval corpus the AI Desk grounds on.
 *
 * Source of truth is data/gittimes.db. We emit two kinds of chunk:
 *   - "repo": one per distinct repo the paper has covered, carrying its best
 *     (most-recent non-empty) headline, star count, and how many editions it
 *     appeared in. Answers "has the paper covered X / what did it say".
 *   - "edition": one per edition front-page lead (headline + subhead + tagline).
 *     Answers thematic / trend questions.
 *
 * Each chunk carries a `url` (the edition page) so the worker can hand the model
 * inline citations. Article *body* text lives only in the published HTML; pulling
 * it in is a future enrichment — this v1 grounds on headlines + repo coverage.
 *
 * Output is intentionally compact (<~300KB) so the edge worker can fetch the
 * whole thing per cold isolate and keyword-rank it in memory.
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "data", "gittimes.db");
const OUT_PATH = path.join(__dirname, "..", "data", "corpus.json");
const MAX_TEXT = 240; // cap per-chunk searchable text

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

function buildCorpus(dbPath) {
  const db = new Database(dbPath || DB_PATH, { readonly: true });
  try {
    // Latest star count per repo.
    const starsByRepo = new Map();
    for (const r of db
      .prepare(
        "SELECT repo_name, stars FROM repo_snapshots s WHERE date = (SELECT MAX(date) FROM repo_snapshots WHERE repo_name = s.repo_name)"
      )
      .all()) {
      starsByRepo.set(r.repo_name, r.stars);
    }

    // Most-recent non-empty headline per repo.
    const headlineByRepo = new Map();
    for (const r of db
      .prepare(
        "SELECT repo_name, headline FROM edition_repos WHERE headline IS NOT NULL AND headline != '' ORDER BY edition_date DESC"
      )
      .all()) {
      if (!headlineByRepo.has(r.repo_name)) headlineByRepo.set(r.repo_name, r.headline);
    }

    // Per-repo coverage aggregate.
    const repoRows = db
      .prepare(
        "SELECT repo_name, MAX(edition_date) AS last_date, COUNT(DISTINCT edition_date) AS appearances FROM edition_repos GROUP BY repo_name"
      )
      .all();

    const chunks = [];
    for (const r of repoRows) {
      const headline = headlineByRepo.get(r.repo_name) || "";
      const stars = starsByRepo.get(r.repo_name);
      // searchable text = repo path (its words matter) + headline
      const text = clean(`${r.repo_name.replace(/[/_-]/g, " ")} ${r.repo_name} ${headline}`);
      chunks.push({
        type: "repo",
        date: r.last_date,
        repo: r.repo_name,
        title: headline || r.repo_name,
        text,
        url: `/editions/${r.last_date}/`,
        stars: stars != null ? stars : null,
        appearances: r.appearances,
      });
    }

    // Edition-lead chunks.
    for (const e of db.prepare("SELECT date, headline, subheadline, tagline, url FROM editions").all()) {
      const text = clean([e.headline, e.subheadline, e.tagline].filter(Boolean).join(". "));
      if (!text) continue;
      chunks.push({
        type: "edition",
        date: e.date,
        repo: null,
        title: e.headline || `The Git Times — ${e.date}`,
        text,
        url: e.url || `/editions/${e.date}/`,
        stars: null,
      });
    }

    // Stable ordering: newest first, then index for citation labels.
    chunks.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    chunks.forEach((c, i) => (c.i = i));

    return {
      builtAt: new Date().toISOString(),
      count: chunks.length,
      repoCount: repoRows.length,
      editionCount: chunks.filter((c) => c.type === "edition").length,
      chunks,
    };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const corpus = buildCorpus();
  fs.writeFileSync(OUT_PATH, JSON.stringify(corpus));
  const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
  console.log(
    `[build-corpus] wrote ${OUT_PATH} — ${corpus.count} chunks ` +
      `(${corpus.repoCount} repos + ${corpus.editionCount} editions), ${kb}KB`
  );
}

module.exports = { buildCorpus };
