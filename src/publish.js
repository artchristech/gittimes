const fs = require("fs");
const path = require("path");

const { assembleHtml, assembleArticlePage, buildNavHtml, slugify } = require("./render");

const { renderArchivePage } = require("./archive");
const { renderLandingPage } = require("./landing");
const { renderAccountPage } = require("./account");
const { renderMarketsPage } = require("./markets");
const { generateRss, generateAtom } = require("./feed");
const { loadTemplate, buildAnalytics } = require("./template-utils");
const db = require("./db");

/**
 * Format a Date as YYYY-MM-DD.
 */
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const { resolveDataDir } = db;

/**
 * Read manifest from database, falling back to JSON if DB is empty/missing.
 */
function readManifest(outDir) {
  const dataDir = resolveDataDir(outDir);

  // Read from both sources
  let dbManifest = [];
  try {
    dbManifest = db.readManifest(dataDir);
  } catch { /* DB unavailable */ }

  let jsonManifest = [];
  const manifestPath = path.join(outDir, "editions", "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (Array.isArray(parsed)) jsonManifest = parsed;
    } catch (e) {
      console.warn(`Warning: corrupt manifest.json: ${e.message}`);
    }
  }

  // Merge: use whichever has more entries as the base, then add any
  // editions from the other source that are missing (by date).
  // This prevents gh-pages sync (JSON) from being discarded when the
  // local DB has fewer entries, and vice versa.
  const [base, other] = dbManifest.length >= jsonManifest.length
    ? [dbManifest, jsonManifest]
    : [jsonManifest, dbManifest];

  const baseDates = new Set(base.map((e) => e.date));
  const merged = [...base];
  for (const entry of other) {
    if (!baseDates.has(entry.date)) {
      merged.push(entry);
    }
  }
  merged.sort((a, b) => b.date.localeCompare(a.date));

  // Sync merged result back to DB if it grew
  if (merged.length > dbManifest.length) {
    try { db.writeManifest(dataDir, merged); } catch { /* non-fatal */ }
    console.log(`Manifest reconciled: DB had ${dbManifest.length}, JSON had ${jsonManifest.length}, merged to ${merged.length}`);
  }

  return merged;
}

/**
 * Write manifest to both database and JSON (for backwards compatibility).
 */
function writeManifest(outDir, manifest) {
  // Write to database
  const dataDir = resolveDataDir(outDir);
  db.writeManifest(dataDir, manifest);

  // Also write JSON for backwards compatibility / static deploy
  const dir = path.join(outDir, "editions");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

/**
 * Publish a new edition.
 * @param {object} content - { lead, secondary, quickHits, tagline }
 * @param {string} outDir - Output directory (e.g. "./site")
 * @param {object} [options] - { siteUrl?: string, basePath?: string, date?: Date, tickerHtml?: string, tickerData?: object, fullMarketData?: Array }
 */
async function publish(content, outDir, options = {}) {
  const siteUrl = options.siteUrl || "https://gittimes.com";
  const basePath = options.basePath || "";
  const date = options.date || new Date();
  const dateStr = toDateStr(date);

  // 1. Read existing manifest
  const manifest = readManifest(outDir);

  // Check if this date already exists — replace if so
  const existingIdx = manifest.findIndex((e) => e.date === dateStr);
  if (existingIdx !== -1) {
    manifest.splice(existingIdx, 1);
  }

  // 2. Build nav links
  const prevEntry = manifest.length > 0 ? manifest[0] : null;
  const nav = {
    archive: basePath + "/archive/",
  };
  if (prevEntry) {
    nav.prev = {
      url: prevEntry.url || `${basePath}/editions/${prevEntry.date}/`,
      label: "Previous Edition",
    };
  }

  // 3. Assemble HTML with nav
  const editionUrl = `${basePath}/editions/${dateStr}/`;
  const html = await assembleHtml(content, {
    date,
    nav,
    siteUrl,
    basePath,
    dateStr,
    tickerHtml: options.tickerHtml || "",
  });

  // 4. Write edition to outDir/editions/YYYY-MM-DD/index.html
  const editionDir = path.join(outDir, "editions", dateStr);
  if (!fs.existsSync(editionDir)) fs.mkdirSync(editionDir, { recursive: true });
  fs.writeFileSync(path.join(editionDir, "index.html"), html);

  // 5. Copy to outDir/latest/index.html (latest edition)
  const latestDir = path.join(outDir, "latest");
  if (!fs.existsSync(latestDir)) fs.mkdirSync(latestDir, { recursive: true });
  fs.writeFileSync(path.join(latestDir, "index.html"), html);

  // 5b. Generate individual article pages for shareability + SEO
  const articlePageOpts = { date, dateStr, basePath, siteUrl };
  let articleCount = 0;
  if (content.sections) {
    const { SECTION_ORDER } = require("./sections");
    for (const sectionId of SECTION_ORDER) {
      const section = content.sections[sectionId];
      if (!section || section.isEmpty) continue;
      const articles = [section.lead, ...(section.secondary || [])].filter(Boolean);
      for (const article of articles) {
        try {
          const { html: articleHtml, slug } = await assembleArticlePage(article, { ...articlePageOpts, sectionId });
          const articleDir = path.join(editionDir, slug);
          if (!fs.existsSync(articleDir)) fs.mkdirSync(articleDir, { recursive: true });
          fs.writeFileSync(path.join(articleDir, "index.html"), articleHtml);
          articleCount++;
        } catch (e) {
          console.warn(`Warning: failed to generate article page for "${article.headline}": ${e.message}`);
        }
      }
    }
  }
  if (articleCount > 0) {
    console.log(`Generated ${articleCount} individual article pages`);
  }

  // 6. Update previous edition's HTML to add "Next Edition" link
  if (prevEntry) {
    const prevEditionPath = path.join(outDir, "editions", prevEntry.date, "index.html");
    if (fs.existsSync(prevEditionPath)) {
      let prevHtml = fs.readFileSync(prevEditionPath, "utf-8");
      // Build updated nav for previous edition
      const prevPrevEntry = manifest.length > 1 ? manifest[1] : null;
      const prevNav = {
        archive: basePath + "/archive/",
            next: { url: editionUrl, label: "Next Edition" },
      };
      if (prevPrevEntry) {
        prevNav.prev = {
          url: prevPrevEntry.url || `${basePath}/editions/${prevPrevEntry.date}/`,
          label: "Previous Edition",
        };
      }
      const prevNavHtml = buildNavHtml(prevNav);
      // Replace existing nav blocks
      prevHtml = prevHtml.replace(/<nav class="edition-nav">[\s\S]*?<\/nav>/g, prevNavHtml);
      fs.writeFileSync(prevEditionPath, prevHtml);
    }
  }

  // 7. Collect repo names for history dedup
  const repos = [];
  if (content.sections) {
    // Multi-section content shape
    for (const id of Object.keys(content.sections)) {
      const section = content.sections[id];
      if (section.lead && section.lead.repo && section.lead.repo.name) {
        repos.push(section.lead.repo.name);
      }
      if (section.secondary) {
        for (const item of section.secondary) {
          if (item.repo && item.repo.name) repos.push(item.repo.name);
        }
      }
      if (section.quickHits) {
        for (const item of section.quickHits) {
          if (item.name) repos.push(item.name);
        }
      }
    }
  } else {
    // Legacy content shape
    if (content.lead && content.lead.repo && content.lead.repo.name) {
      repos.push(content.lead.repo.name);
    }
    if (content.secondary) {
      for (const item of content.secondary) {
        if (item.repo && item.repo.name) repos.push(item.repo.name);
      }
    }
    if (content.quickHits) {
      for (const item of content.quickHits) {
        if (item.name) repos.push(item.name);
      }
    }
  }

  // 8. Collect section lead repo names
  const sectionLeads = [];
  if (content.sections) {
    for (const section of Object.values(content.sections)) {
      if (section && section.lead && section.lead.repo && section.lead.repo.name)
        sectionLeads.push(section.lead.repo.name);
    }
  }

  // Prepend new entry to manifest
  const frontPageLead = content.sections
    ? (content.sections.frontPage && content.sections.frontPage.lead)
    : content.lead;
  const headline = frontPageLead ? frontPageLead.headline : "The Git Times Edition";
  const subheadline = frontPageLead ? frontPageLead.subheadline : "";
  const newEntry = {
    date: dateStr,
    headline,
    subheadline,
    tagline: content.tagline || "",
    url: editionUrl,
    repos,
    sectionLeads,
  };
  manifest.unshift(newEntry);
  writeManifest(outDir, manifest);

  // 8b. Record article headlines in edition_repos for coverage tracking
  try {
    const dataDir = resolveDataDir(outDir);
    const dbConn = db.getDb(dataDir);
    const updateHeadline = dbConn.prepare(
      "UPDATE edition_repos SET headline = ? WHERE edition_date = ? AND repo_name = ?"
    );
    if (content.sections) {
      for (const section of Object.values(content.sections)) {
        if (section && section.lead && section.lead.headline && section.lead.repo) {
          updateHeadline.run(section.lead.headline, dateStr, section.lead.repo.name);
        }
        if (section && section.secondary) {
          for (const article of section.secondary) {
            if (article.headline && article.repo) {
              updateHeadline.run(article.headline, dateStr, article.repo.name);
            }
          }
        }
      }
    }
  } catch { /* non-fatal */ }

  // 8c. Record quote usage in DB
  try {
    const taglineMatch = (content.tagline || "").match(/^\u201C(.+)\u201D \u2014 (.+)$/);
    if (taglineMatch) {
      db.recordQuoteUsage(resolveDataDir(outDir), dateStr, taglineMatch[1], taglineMatch[2]);
    }
  } catch { /* non-fatal */ }

  // 9. Generate RSS and Atom feeds
  fs.writeFileSync(path.join(outDir, "feed.xml"), generateRss(manifest, siteUrl));
  fs.writeFileSync(path.join(outDir, "feed.atom"), generateAtom(manifest, siteUrl));

  // 10. Generate archive page
  const archiveDir = path.join(outDir, "archive");
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  const archiveHtml = renderArchivePage(manifest, basePath);
  fs.writeFileSync(path.join(archiveDir, "index.html"), archiveHtml);

  // 10b. Generate AI Markets page
  if (options.tickerData) {
    const marketsDir = path.join(outDir, "markets");
    if (!fs.existsSync(marketsDir)) fs.mkdirSync(marketsDir, { recursive: true });
    const marketsHtml = renderMarketsPage(options.tickerData, options.fullMarketData || null, { basePath, siteUrl });
    fs.writeFileSync(path.join(marketsDir, "index.html"), marketsHtml);
  }

  // 11. Generate custom 404 page
  const fourOhFourTemplatePath = path.join(__dirname, "..", "templates", "404.html");
  if (fs.existsSync(fourOhFourTemplatePath)) {
    const { template: fourOhFourTemplate, css: fourOhFourCss } = loadTemplate("404");
    const latestUrl = basePath + "/latest/";
    const archiveUrl = basePath + "/archive/";
    const { analyticsScript, cspScriptSrc, cspConnectSrc } = buildAnalytics();
    const fourOhFourHtml = fourOhFourTemplate
      .replace("{{STYLES}}", fourOhFourCss)
      .replace(/\{\{BASE_PATH\}\}/g, basePath)
      .replace("{{LATEST_URL}}", latestUrl)
      .replace("{{ARCHIVE_URL}}", archiveUrl)
      .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
      .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
      .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc);
    fs.writeFileSync(path.join(outDir, "404.html"), fourOhFourHtml);
  }

  // 12. Root serves latest edition (front page of the paper)
  fs.writeFileSync(path.join(outDir, "index.html"), html);

  // 12b. Landing page at /subscribe/ for signups
  const subscribeDir = path.join(outDir, "subscribe");
  if (!fs.existsSync(subscribeDir)) fs.mkdirSync(subscribeDir, { recursive: true });
  const landingHtml = renderLandingPage(manifest, { basePath, siteUrl });
  fs.writeFileSync(path.join(subscribeDir, "index.html"), landingHtml);

  // 13. Generate account page
  const accountDir = path.join(outDir, "account");
  if (!fs.existsSync(accountDir)) fs.mkdirSync(accountDir, { recursive: true });
  fs.writeFileSync(path.join(accountDir, "index.html"), renderAccountPage({ basePath, siteUrl }));

  // 14. Copy chat.js to outDir for external script loading
  const chatJsSrc = path.join(__dirname, "..", "public", "chat.js");
  if (fs.existsSync(chatJsSrc)) {
    fs.copyFileSync(chatJsSrc, path.join(outDir, "chat.js"));
  }

  // 15. Write .nojekyll and CNAME (GitHub Pages custom domain — must persist across deploys)
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "");
  fs.writeFileSync(path.join(outDir, "CNAME"), "gittimes.com");

  console.log(`Edition ${dateStr} published to ${outDir}`);
  return { dateStr, editionDir, outDir };
}

/**
 * Collect repo names from the last N editions.
 * Uses readManifest (which handles DB → JSON fallback).
 * @param {string} outDir - Output directory
 * @param {number} [lookback=3] - Number of recent editions to look back
 * @returns {Set<string>} Set of repo full_name strings
 */
function getRecentRepoNames(outDir, lookback = 7) {
  const manifest = readManifest(outDir);
  const names = new Set();
  const entries = manifest.slice(0, lookback);
  for (const entry of entries) {
    if (!entry.repos) continue;
    for (const name of entry.repos) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Get lead repo names from recent editions (first repo in each entry's repos array).
 * @param {string} outDir - Output directory
 * @param {number} [lookback=3] - Number of recent editions to check
 * @returns {Set<string>} Set of lead repo full_name strings
 */
function getRecentLeadRepos(outDir, lookback = 3) {
  const manifest = readManifest(outDir);
  const leads = new Set();
  const entries = manifest.slice(0, lookback);
  for (const entry of entries) {
    if (!entry.repos || !entry.repos.length) continue;
    leads.add(entry.repos[0]);
    if (entry.sectionLeads) {
      for (const name of entry.sectionLeads) leads.add(name);
    }
  }
  return leads;
}

/**
 * Get recent repo coverage with headlines (thin wrapper around db function).
 * @param {string} outDir
 * @param {number} [lookback=7]
 * @returns {Map<string, Array<{date: string, headline: string}>>}
 */
function getRecentRepoCoverage(outDir, lookback = 7) {
  const dataDir = resolveDataDir(outDir);
  return db.getRecentRepoCoverage(dataDir, lookback);
}

/**
 * Validate generated content before publishing.
 * @param {object} content - { sections: { frontPage, ai, ... }, tagline }
 * @returns {{ valid: boolean, errors: string[], warnings: string[], summary: { sections: number, articles: number, fallbacks: number, emptyCount: number } }}
 */
function validateContent(content) {
  const errors = [];
  const warnings = [];
  let sections = 0;
  let articles = 0;
  let fallbacks = 0;
  let emptyCount = 0;

  if (!content || !content.sections) {
    return {
      valid: false,
      errors: ["Content is null or missing sections"],
      warnings,
      summary: { sections: 0, articles: 0, fallbacks: 0, emptyCount: 0 },
    };
  }

  let hasNonFallbackLead = false;

  for (const [_id, section] of Object.entries(content.sections)) {
    sections++;

    if (!section || section.isEmpty) {
      emptyCount++;
      continue;
    }

    if (section.lead) {
      articles++;
      if (section.lead._isFallback) {
        fallbacks++;
      } else {
        hasNonFallbackLead = true;
      }
    }

    if (section.secondary) {
      for (const s of section.secondary) {
        articles++;
        if (s._isFallback) fallbacks++;
      }
    }

    if (section.quickHits) {
      articles += section.quickHits.length;
    }
  }

  if (!hasNonFallbackLead) {
    errors.push("No non-fallback lead article in any section");
  }

  const fp = content.sections.frontPage;
  if (fp && !fp.isEmpty) {
    if (!fp.secondary || fp.secondary.length === 0) {
      errors.push("Front page has no secondary articles");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: { sections, articles, fallbacks, emptyCount },
  };
}

module.exports = { publish, toDateStr, readManifest, writeManifest, getRecentRepoNames, getRecentLeadRepos, getRecentRepoCoverage, validateContent };
