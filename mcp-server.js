#!/usr/bin/env node
/**
 * GitTimes MCP Server
 *
 * Exposes GitTimes edition data, repo coverage, and star history
 * via the Model Context Protocol (stdio transport).
 *
 * Usage:
 *   node mcp-server.js
 *
 * Configure in Claude Code settings or any MCP client:
 *   { "command": "node", "args": ["<path>/mcp-server.js"] }
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const path = require("path");

const db = require("./src/db");
const { SECTIONS, SECTION_ORDER } = require("./src/sections");

const DATA_DIR = path.resolve(__dirname, "data");
const SITE_DIR = path.resolve(__dirname, "site");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read manifest from DB (newest-first). */
function getManifest() {
  return db.readManifest(DATA_DIR);
}

/** Parse edition HTML to extract article content for a section. */
function parseEditionHtml(dateStr) {
  const fs = require("fs");
  const htmlPath = path.join(SITE_DIR, "editions", dateStr, "index.html");
  if (!fs.existsSync(htmlPath)) return null;
  return fs.readFileSync(htmlPath, "utf-8");
}

/** Extract text content from an HTML string (strip tags). */
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

/** Extract article blocks from edition HTML. */
function extractArticles(html) {
  const articles = [];
  // Match article cards: <article class="article-card ..."> ... </article>
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

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "gittimes",
  version: "1.0.0",
});

// --- Tool: list_editions ---------------------------------------------------

server.tool(
  "list_editions",
  "List recent GitTimes editions with headlines, dates, and repo counts",
  { limit: z.number().int().min(1).max(100).default(10).describe("Number of editions to return (default 10)") },
  async ({ limit }) => {
    const manifest = getManifest();
    const editions = manifest.slice(0, limit).map((e) => ({
      date: e.date,
      headline: e.headline,
      subheadline: e.subheadline,
      tagline: e.tagline,
      url: `https://gittimes.com${e.url || `/editions/${e.date}/`}`,
      repo_count: (e.repos || []).length,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(editions, null, 2) }],
    };
  }
);

// --- Tool: get_edition -----------------------------------------------------

server.tool(
  "get_edition",
  "Get full details for a specific GitTimes edition by date, including all featured repos and article excerpts",
  { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Edition date in YYYY-MM-DD format") },
  async ({ date }) => {
    const manifest = getManifest();
    const entry = manifest.find((e) => e.date === date);
    if (!entry) {
      return { content: [{ type: "text", text: `No edition found for ${date}` }] };
    }

    // Get article headlines from edition_repos
    const dbConn = db.getDb(DATA_DIR);
    const repoRows = dbConn.prepare(
      "SELECT repo_name, headline FROM edition_repos WHERE edition_date = ? ORDER BY rowid"
    ).all(date);

    // Try to extract articles from HTML
    const html = parseEditionHtml(date);
    const articles = html ? extractArticles(html) : [];

    const result = {
      date: entry.date,
      headline: entry.headline,
      subheadline: entry.subheadline,
      tagline: entry.tagline,
      url: `https://gittimes.com${entry.url || `/editions/${entry.date}/`}`,
      repos: repoRows.map((r) => ({
        name: r.repo_name,
        headline: r.headline || null,
      })),
      article_count: articles.length,
      articles: articles.slice(0, 20),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Tool: get_latest_edition ----------------------------------------------

server.tool(
  "get_latest_edition",
  "Get the most recent GitTimes edition with full details",
  {},
  async () => {
    const manifest = getManifest();
    if (manifest.length === 0) {
      return { content: [{ type: "text", text: "No editions found" }] };
    }

    const latest = manifest[0];
    const dbConn = db.getDb(DATA_DIR);
    const repoRows = dbConn.prepare(
      "SELECT repo_name, headline FROM edition_repos WHERE edition_date = ? ORDER BY rowid"
    ).all(latest.date);

    const html = parseEditionHtml(latest.date);
    const articles = html ? extractArticles(html) : [];

    const result = {
      date: latest.date,
      headline: latest.headline,
      subheadline: latest.subheadline,
      tagline: latest.tagline,
      url: `https://gittimes.com${latest.url || `/editions/${latest.date}/`}`,
      repos: repoRows.map((r) => ({
        name: r.repo_name,
        headline: r.headline || null,
      })),
      article_count: articles.length,
      articles: articles.slice(0, 20),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Tool: search_repos ----------------------------------------------------

server.tool(
  "search_repos",
  "Search for repos that have been featured in GitTimes editions. Returns which editions featured them and with what headlines.",
  { query: z.string().min(1).max(200).describe("Repo name or partial match (e.g. 'react', 'facebook/react')") },
  async ({ query }) => {
    const dbConn = db.getDb(DATA_DIR);
    const q = `%${query}%`;
    const rows = dbConn.prepare(`
      SELECT er.repo_name, er.edition_date, er.headline, e.headline AS edition_headline
      FROM edition_repos er
      JOIN editions e ON e.date = er.edition_date
      WHERE er.repo_name LIKE ?
      ORDER BY er.edition_date DESC
      LIMIT 50
    `).all(q);

    if (rows.length === 0) {
      return { content: [{ type: "text", text: `No repos matching "${query}" found in any edition` }] };
    }

    // Group by repo
    const byRepo = {};
    for (const row of rows) {
      if (!byRepo[row.repo_name]) byRepo[row.repo_name] = [];
      byRepo[row.repo_name].push({
        edition_date: row.edition_date,
        article_headline: row.headline || null,
        edition_headline: row.edition_headline,
      });
    }

    return {
      content: [{ type: "text", text: JSON.stringify(byRepo, null, 2) }],
    };
  }
);

// --- Tool: get_repo_history ------------------------------------------------

server.tool(
  "get_repo_history",
  "Get star/fork/issue snapshots for a repo over the last 14 days (used for trend detection)",
  { repo_name: z.string().min(1).describe("Full repo name, e.g. 'facebook/react'") },
  async ({ repo_name }) => {
    const dbConn = db.getDb(DATA_DIR);
    const rows = dbConn.prepare(`
      SELECT date, stars, forks, issues
      FROM repo_snapshots
      WHERE repo_name = ?
      ORDER BY date DESC
    `).all(repo_name);

    if (rows.length === 0) {
      return { content: [{ type: "text", text: `No snapshot history for "${repo_name}"` }] };
    }

    const first = rows[rows.length - 1];
    const last = rows[0];
    const starDelta = last.stars - first.stars;
    const days = rows.length > 1 ? Math.max(1, Math.round(
      (new Date(last.date) - new Date(first.date)) / 86400000
    )) : 0;

    const result = {
      repo: repo_name,
      snapshots: rows,
      summary: {
        latest_stars: last.stars,
        star_delta: starDelta,
        days_tracked: days,
        avg_daily_stars: days > 0 ? Math.round(starDelta / days * 10) / 10 : null,
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Tool: get_repo_coverage -----------------------------------------------

server.tool(
  "get_repo_coverage",
  "Check how many times a repo has been featured across editions",
  {
    repo_name: z.string().min(1).describe("Full repo name, e.g. 'facebook/react'"),
    lookback: z.number().int().min(1).max(100).default(30).describe("Number of recent editions to check (default 30)"),
  },
  async ({ repo_name, lookback }) => {
    const dbConn = db.getDb(DATA_DIR);
    const rows = dbConn.prepare(`
      SELECT er.edition_date, er.headline, e.headline AS edition_headline
      FROM edition_repos er
      JOIN editions e ON e.date = er.edition_date
      WHERE er.repo_name = ?
      ORDER BY er.edition_date DESC
      LIMIT ?
    `).all(repo_name, lookback);

    if (rows.length === 0) {
      return { content: [{ type: "text", text: `"${repo_name}" has not been featured in any edition` }] };
    }

    const result = {
      repo: repo_name,
      times_featured: rows.length,
      appearances: rows.map((r) => ({
        date: r.edition_date,
        article_headline: r.headline || null,
        edition_headline: r.edition_headline,
      })),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Tool: get_sections ----------------------------------------------------

server.tool(
  "get_sections",
  "List all GitTimes newspaper sections with their topics and languages",
  {},
  async () => {
    const result = SECTION_ORDER.map((id) => ({
      id,
      label: SECTIONS[id].label,
      topics: SECTIONS[id].query?.topics || [],
      languages: SECTIONS[id].query?.languages || [],
      budget: SECTIONS[id].budget,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Tool: get_trending_repos ----------------------------------------------

server.tool(
  "get_trending_repos",
  "Get repos with the highest star velocity from recent snapshots (what's hot right now)",
  { limit: z.number().int().min(1).max(50).default(15).describe("Number of repos to return (default 15)") },
  async ({ limit }) => {
    const dbConn = db.getDb(DATA_DIR);

    // Get the two most recent snapshot dates
    const dates = dbConn.prepare(
      "SELECT DISTINCT date FROM repo_snapshots ORDER BY date DESC LIMIT 2"
    ).all();

    if (dates.length < 2) {
      return { content: [{ type: "text", text: "Not enough snapshot data to compute trends (need at least 2 days)" }] };
    }

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

    const result = {
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

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Tool: get_edition_stats -----------------------------------------------

server.tool(
  "get_edition_stats",
  "Get aggregate stats about the GitTimes archive — total editions, total unique repos covered, date range",
  {},
  async () => {
    const dbConn = db.getDb(DATA_DIR);

    const editionCount = dbConn.prepare("SELECT COUNT(*) AS cnt FROM editions").get().cnt;
    const repoCount = dbConn.prepare("SELECT COUNT(DISTINCT repo_name) AS cnt FROM edition_repos").get().cnt;
    const dateRange = dbConn.prepare("SELECT MIN(date) AS oldest, MAX(date) AS newest FROM editions").get();
    const snapshotCount = dbConn.prepare("SELECT COUNT(DISTINCT repo_name) AS cnt FROM repo_snapshots").get().cnt;

    const result = {
      total_editions: editionCount,
      unique_repos_featured: repoCount,
      oldest_edition: dateRange.oldest,
      newest_edition: dateRange.newest,
      repos_with_snapshots: snapshotCount,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
