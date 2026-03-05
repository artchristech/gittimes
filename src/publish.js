const fs = require("fs");
const path = require("path");

const { assembleHtml, buildNavHtml, escapeHtml } = require("./render");

const { renderArchivePage } = require("./archive");
const { renderLandingPage } = require("./landing");
const { renderAccountPage } = require("./account");
const { generateRss, generateAtom } = require("./feed");

/**
 * Format a Date as YYYY-MM-DD.
 */
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Read manifest from disk or return empty array.
 */
function readManifest(outDir) {
  const manifestPath = path.join(outDir, "editions", "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch (e) {
      console.warn(`Warning: corrupt manifest.json, starting fresh: ${e.message}`);
      return [];
    }
  }
  return [];
}

/**
 * Write manifest to disk.
 */
function writeManifest(outDir, manifest) {
  const dir = path.join(outDir, "editions");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

/**
 * Publish a new edition.
 * @param {object} content - { lead, secondary, quickHits, tagline }
 * @param {string} outDir - Output directory (e.g. "./site")
 * @param {object} [options] - { siteUrl?: string, basePath?: string, date?: Date }
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
  });

  // 4. Write edition to outDir/editions/YYYY-MM-DD/index.html
  const editionDir = path.join(outDir, "editions", dateStr);
  if (!fs.existsSync(editionDir)) fs.mkdirSync(editionDir, { recursive: true });
  fs.writeFileSync(path.join(editionDir, "index.html"), html);

  // 5. Copy to outDir/latest/index.html (latest edition)
  const latestDir = path.join(outDir, "latest");
  if (!fs.existsSync(latestDir)) fs.mkdirSync(latestDir, { recursive: true });
  fs.writeFileSync(path.join(latestDir, "index.html"), html);

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

  // 8. Prepend new entry to manifest
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
  };
  manifest.unshift(newEntry);
  writeManifest(outDir, manifest);

  // 9. Generate RSS and Atom feeds
  fs.writeFileSync(path.join(outDir, "feed.xml"), generateRss(manifest, siteUrl));
  fs.writeFileSync(path.join(outDir, "feed.atom"), generateAtom(manifest, siteUrl));

  // 10. Generate archive page
  const archiveDir = path.join(outDir, "archive");
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  const archiveHtml = renderArchivePage(manifest, basePath);
  fs.writeFileSync(path.join(archiveDir, "index.html"), archiveHtml);

  // 11. Generate custom 404 page
  const fourOhFourTemplatePath = path.join(__dirname, "..", "templates", "404.html");
  if (fs.existsSync(fourOhFourTemplatePath)) {
    const fourOhFourTemplate = fs.readFileSync(fourOhFourTemplatePath, "utf-8");
    const cssPath = path.join(__dirname, "..", "styles", "newspaper.css");
    const css = fs.readFileSync(cssPath, "utf-8");
    const latestUrl = basePath + "/latest/";
    const archiveUrl = basePath + "/archive/";
    const plausibleDomain = process.env.PLAUSIBLE_DOMAIN || "";
    const analyticsScript = plausibleDomain
      ? `<script defer data-domain="${escapeHtml(plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`
      : "";
    const cspScriptSrc = plausibleDomain ? " https://plausible.io" : "";
    const cspConnectSrc = plausibleDomain ? " https://plausible.io" : "";
    const fourOhFourHtml = fourOhFourTemplate
      .replace("{{STYLES}}", css)
      .replace(/\{\{BASE_PATH\}\}/g, basePath)
      .replace("{{LATEST_URL}}", latestUrl)
      .replace("{{ARCHIVE_URL}}", archiveUrl)
      .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
      .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
      .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc);
    fs.writeFileSync(path.join(outDir, "404.html"), fourOhFourHtml);
  }

  // 12. Generate landing page at root
  const landingHtml = renderLandingPage(manifest, { basePath, siteUrl });
  fs.writeFileSync(path.join(outDir, "index.html"), landingHtml);

  // 13. Generate account page
  const accountDir = path.join(outDir, "account");
  if (!fs.existsSync(accountDir)) fs.mkdirSync(accountDir, { recursive: true });
  fs.writeFileSync(path.join(accountDir, "index.html"), renderAccountPage({ basePath, siteUrl }));

  // 14. Write .nojekyll and CNAME (GitHub Pages custom domain — must persist across deploys)
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "");
  fs.writeFileSync(path.join(outDir, "CNAME"), "gittimes.com");

  console.log(`Edition ${dateStr} published to ${outDir}`);
  return { dateStr, editionDir, outDir };
}

/**
 * Collect repo names from the last N manifest entries.
 * @param {string} outDir - Output directory containing editions/manifest.json
 * @param {number} [lookback=3] - Number of recent editions to look back
 * @returns {Set<string>} Set of repo full_name strings
 */
function getRecentRepoNames(outDir, lookback = 3) {
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

  for (const [id, section] of Object.entries(content.sections)) {
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

module.exports = { publish, toDateStr, readManifest, writeManifest, getRecentRepoNames, validateContent };
