#!/usr/bin/env node
/**
 * GitTimes REST API Server
 *
 * Lightweight HTTP API exposing GitTimes edition data, repo coverage,
 * and star history. Zero external dependencies beyond what's already
 * in the project (uses Node built-in http module).
 *
 * Usage:
 *   node api-server.js              # starts on port 3717
 *   PORT=8080 node api-server.js    # custom port
 *
 * Endpoints:
 *   GET /api/editions               ?limit=10
 *   GET /api/editions/latest
 *   GET /api/editions/:date
 *   GET /api/repos/search           ?q=react
 *   GET /api/repos/:owner/:name/history
 *   GET /api/repos/:owner/:name/coverage  ?lookback=30
 *   GET /api/sections
 *   GET /api/trending               ?limit=15
 *   GET /api/stats
 */

const http = require("http");
const path = require("path");
const fs = require("fs");

const db = require("./src/db");
const { SECTIONS, SECTION_ORDER } = require("./src/sections");

const DATA_DIR = path.resolve(__dirname, "data");
const SITE_DIR = path.resolve(__dirname, "site");
const PORT = parseInt(process.env.PORT || "3717", 10);
const HOST = process.env.HOST || "127.0.0.1";  // localhost-only by default

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res, data, status = 200) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function notFound(res, msg = "Not found") {
  json(res, { error: msg }, 404);
}

function parseQuery(url) {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const params = {};
  new URLSearchParams(url.slice(idx + 1)).forEach((v, k) => { params[k] = v; });
  return params;
}

function getPath(url) {
  const idx = url.indexOf("?");
  return idx === -1 ? url : url.slice(0, idx);
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractArticles(html) {
  const articles = [];
  const articleRegex = /<article class="article-card[^"]*"[\s\S]*?<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const block = match[0];
    const headlineMatch = block.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
    const bodyMatch = block.match(/<div class="article-body">([\s\S]*?)<\/div>/i);
    const repoMatch = block.match(/href="https:\/\/github\.com\/([^"]+)"/i);
    articles.push({
      headline: headlineMatch ? stripHtml(headlineMatch[1]) : "",
      body: bodyMatch ? stripHtml(bodyMatch[1]).slice(0, 500) : "",
      repo: repoMatch ? repoMatch[1].replace(/\/$/, "") : null,
    });
  }
  return articles;
}

function getManifest() {
  return db.readManifest(DATA_DIR);
}

function getEditionHtml(dateStr) {
  const htmlPath = path.join(SITE_DIR, "editions", dateStr, "index.html");
  if (!fs.existsSync(htmlPath)) return null;
  return fs.readFileSync(htmlPath, "utf-8");
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleEditions(query) {
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
  const manifest = getManifest();
  return manifest.slice(0, limit).map((e) => ({
    date: e.date,
    headline: e.headline,
    subheadline: e.subheadline,
    tagline: e.tagline,
    url: `https://gittimes.com${e.url || `/editions/${e.date}/`}`,
    repo_count: (e.repos || []).length,
  }));
}

function handleEditionByDate(dateStr) {
  const manifest = getManifest();
  const entry = manifest.find((e) => e.date === dateStr);
  if (!entry) return null;

  const dbConn = db.getDb(DATA_DIR);
  const repoRows = dbConn.prepare(
    "SELECT repo_name, headline FROM edition_repos WHERE edition_date = ? ORDER BY rowid"
  ).all(dateStr);

  const html = getEditionHtml(dateStr);
  const articles = html ? extractArticles(html) : [];

  return {
    date: entry.date,
    headline: entry.headline,
    subheadline: entry.subheadline,
    tagline: entry.tagline,
    url: `https://gittimes.com${entry.url || `/editions/${entry.date}/`}`,
    repos: repoRows.map((r) => ({ name: r.repo_name, headline: r.headline || null })),
    article_count: articles.length,
    articles: articles.slice(0, 20),
  };
}

function handleSearchRepos(query) {
  const q = (query.q || "").slice(0, 200);
  if (!q) return { error: "Missing ?q= parameter" };

  const dbConn = db.getDb(DATA_DIR);
  const rows = dbConn.prepare(`
    SELECT er.repo_name, er.edition_date, er.headline, e.headline AS edition_headline
    FROM edition_repos er
    JOIN editions e ON e.date = er.edition_date
    WHERE er.repo_name LIKE ?
    ORDER BY er.edition_date DESC
    LIMIT 50
  `).all(`%${q}%`);

  const byRepo = {};
  for (const row of rows) {
    if (!byRepo[row.repo_name]) byRepo[row.repo_name] = [];
    byRepo[row.repo_name].push({
      edition_date: row.edition_date,
      article_headline: row.headline || null,
      edition_headline: row.edition_headline,
    });
  }
  return byRepo;
}

function handleRepoHistory(repoName) {
  const dbConn = db.getDb(DATA_DIR);
  const rows = dbConn.prepare(
    "SELECT date, stars, forks, issues FROM repo_snapshots WHERE repo_name = ? ORDER BY date DESC"
  ).all(repoName);

  if (rows.length === 0) return null;

  const first = rows[rows.length - 1];
  const last = rows[0];
  const starDelta = last.stars - first.stars;
  const days = rows.length > 1
    ? Math.max(1, Math.round((new Date(last.date) - new Date(first.date)) / 86400000))
    : 0;

  return {
    repo: repoName,
    snapshots: rows,
    summary: {
      latest_stars: last.stars,
      star_delta: starDelta,
      days_tracked: days,
      avg_daily_stars: days > 0 ? Math.round(starDelta / days * 10) / 10 : null,
    },
  };
}

function handleRepoCoverage(repoName, query) {
  const lookback = Math.min(100, Math.max(1, parseInt(query.lookback || "30", 10)));
  const dbConn = db.getDb(DATA_DIR);
  const rows = dbConn.prepare(`
    SELECT er.edition_date, er.headline, e.headline AS edition_headline
    FROM edition_repos er
    JOIN editions e ON e.date = er.edition_date
    WHERE er.repo_name = ?
    ORDER BY er.edition_date DESC
    LIMIT ?
  `).all(repoName, lookback);

  if (rows.length === 0) return null;

  return {
    repo: repoName,
    times_featured: rows.length,
    appearances: rows.map((r) => ({
      date: r.edition_date,
      article_headline: r.headline || null,
      edition_headline: r.edition_headline,
    })),
  };
}

function handleSections() {
  return SECTION_ORDER.map((id) => ({
    id,
    label: SECTIONS[id].label,
    topics: SECTIONS[id].query?.topics || [],
    languages: SECTIONS[id].query?.languages || [],
    budget: SECTIONS[id].budget,
  }));
}

function handleTrending(query) {
  const limit = Math.min(50, Math.max(1, parseInt(query.limit || "15", 10)));
  const dbConn = db.getDb(DATA_DIR);

  const dates = dbConn.prepare(
    "SELECT DISTINCT date FROM repo_snapshots ORDER BY date DESC LIMIT 2"
  ).all();

  if (dates.length < 2) return { error: "Not enough snapshot data" };

  const [latest, previous] = dates;
  const daysBetween = Math.max(1, Math.round(
    (new Date(latest.date) - new Date(previous.date)) / 86400000
  ));

  const rows = dbConn.prepare(`
    SELECT
      cur.repo_name,
      cur.stars AS current_stars,
      prev.stars AS previous_stars,
      cur.stars - prev.stars AS star_delta,
      cur.forks AS current_forks,
      cur.issues AS current_issues
    FROM repo_snapshots cur
    JOIN repo_snapshots prev ON prev.repo_name = cur.repo_name AND prev.date = ?
    WHERE cur.date = ? AND cur.stars - prev.stars > 0
    ORDER BY (cur.stars - prev.stars) DESC
    LIMIT ?
  `).all(previous.date, latest.date, limit);

  return {
    period: { from: previous.date, to: latest.date, days: daysBetween },
    repos: rows.map((r) => ({
      name: r.repo_name,
      stars: r.current_stars,
      star_delta: r.star_delta,
      daily_velocity: Math.round(r.star_delta / daysBetween * 10) / 10,
      forks: r.current_forks,
      issues: r.current_issues,
    })),
  };
}

function handleStats() {
  const dbConn = db.getDb(DATA_DIR);
  return {
    total_editions: dbConn.prepare("SELECT COUNT(*) AS cnt FROM editions").get().cnt,
    unique_repos_featured: dbConn.prepare("SELECT COUNT(DISTINCT repo_name) AS cnt FROM edition_repos").get().cnt,
    ...dbConn.prepare("SELECT MIN(date) AS oldest_edition, MAX(date) AS newest_edition FROM editions").get(),
    repos_with_snapshots: dbConn.prepare("SELECT COUNT(DISTINCT repo_name) AS cnt FROM repo_snapshots").get().cnt,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (req.method !== "GET") {
    return json(res, { error: "Method not allowed" }, 405);
  }

  const p = getPath(req.url);
  const query = parseQuery(req.url);

  try {
    // GET /api/editions
    if (p === "/api/editions") {
      return json(res, handleEditions(query));
    }

    // GET /api/editions/latest
    if (p === "/api/editions/latest") {
      const manifest = getManifest();
      if (manifest.length === 0) return notFound(res, "No editions");
      const result = handleEditionByDate(manifest[0].date);
      return json(res, result);
    }

    // GET /api/editions/:date
    const editionMatch = p.match(/^\/api\/editions\/(\d{4}-\d{2}-\d{2})$/);
    if (editionMatch) {
      const result = handleEditionByDate(editionMatch[1]);
      return result ? json(res, result) : notFound(res, `No edition for ${editionMatch[1]}`);
    }

    // GET /api/repos/search?q=...
    if (p === "/api/repos/search") {
      const result = handleSearchRepos(query);
      return result.error ? json(res, result, 400) : json(res, result);
    }

    // GET /api/repos/:owner/:name/history
    const historyMatch = p.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/history$/);
    if (historyMatch) {
      const result = handleRepoHistory(`${historyMatch[1]}/${historyMatch[2]}`);
      return result ? json(res, result) : notFound(res, "No snapshot history for this repo");
    }

    // GET /api/repos/:owner/:name/coverage
    const coverageMatch = p.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/coverage$/);
    if (coverageMatch) {
      const result = handleRepoCoverage(`${coverageMatch[1]}/${coverageMatch[2]}`, query);
      return result ? json(res, result) : notFound(res, "Repo not featured in any edition");
    }

    // GET /api/sections
    if (p === "/api/sections") {
      return json(res, handleSections());
    }

    // GET /api/trending
    if (p === "/api/trending") {
      const result = handleTrending(query);
      return result.error ? json(res, result, 400) : json(res, result);
    }

    // GET /api/stats
    if (p === "/api/stats") {
      return json(res, handleStats());
    }

    // GET / — index of available endpoints
    if (p === "/" || p === "/api") {
      return json(res, {
        name: "GitTimes API",
        version: "1.0.0",
        endpoints: [
          "GET /api/editions?limit=10",
          "GET /api/editions/latest",
          "GET /api/editions/:date",
          "GET /api/repos/search?q=react",
          "GET /api/repos/:owner/:name/history",
          "GET /api/repos/:owner/:name/coverage?lookback=30",
          "GET /api/sections",
          "GET /api/trending?limit=15",
          "GET /api/stats",
        ],
      });
    }

    notFound(res);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`GitTimes API running at http://${HOST}:${PORT}`);
  console.log(`Try: http://${HOST}:${PORT}/api/stats`);
});
