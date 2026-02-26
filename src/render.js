const fs = require("fs");
const path = require("path");

let markedParse = null;

async function initMarked() {
  if (markedParse) return;
  const { marked } = await import("marked");
  marked.setOptions({ gfm: true, breaks: false });
  markedParse = marked.parse.bind(marked);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatStars(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

function sanitizeArticleHtml(html) {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s>][\s\S]*?<\/iframe>/gi, "")
    .replace(/\bon\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");
}

function bodyToHtml(text) {
  if (markedParse) {
    return sanitizeArticleHtml(markedParse(text));
  }
  return text
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("\n      ");
}

function renderLeadStory(article) {
  const { headline, subheadline, body, buildersTake, repo, xSentiment } = article;
  return `
    <h2 class="lead-headline">${escapeHtml(headline)}</h2>
    <p class="lead-subheadline">${escapeHtml(subheadline)}</p>
    <div class="lead-meta">
      <span><a href="${escapeHtml(repo.url)}" target="_blank">${escapeHtml(repo.name)}</a></span>
      <span>${formatStars(repo.stars)} stars</span>
      <span>${escapeHtml(repo.language)}</span>
      ${repo.releaseName ? `<span>Latest: ${escapeHtml(repo.releaseName)}</span>` : ""}
    </div>
    <div class="lead-body">
      ${bodyToHtml(body)}
      ${buildersTake ? `<div class="builders-take">
        <span class="builders-take-label">Builder's Take</span>
        ${escapeHtml(buildersTake)}
      </div>` : ""}
      ${renderSentimentBadge(xSentiment)}
    </div>`;
}

function renderSecondaryArticle(article) {
  const { headline, subheadline, body, buildersTake, repo } = article;
  return `
      <article class="secondary-article">
        <h3 class="secondary-headline">${escapeHtml(headline)}</h3>
        <p class="secondary-subheadline">${escapeHtml(subheadline)}</p>
        <div class="secondary-meta">
          <a href="${escapeHtml(repo.url)}" target="_blank">${escapeHtml(repo.name)}</a> · ${formatStars(repo.stars)} stars · ${escapeHtml(repo.language)}
        </div>
        <div class="secondary-body">
          ${bodyToHtml(body)}
        </div>
        ${buildersTake ? `<div class="builders-take">
          <span class="builders-take-label">Builder's Take</span>
          ${escapeHtml(buildersTake)}
        </div>` : ""}
      </article>`;
}

function renderFeaturedArticle(article) {
  const { headline, subheadline, body, buildersTake, repo, xSentiment } = article;
  return `
      <article class="featured-article">
        <h3 class="featured-headline">${escapeHtml(headline)}</h3>
        <p class="featured-subheadline">${escapeHtml(subheadline)}</p>
        <div class="featured-meta">
          <a href="${escapeHtml(repo.url)}" target="_blank">${escapeHtml(repo.name)}</a> · ${formatStars(repo.stars)} stars · ${escapeHtml(repo.language)}
        </div>
        <div class="featured-body">
          ${bodyToHtml(body)}
        </div>
        ${buildersTake ? `<div class="builders-take">
          <span class="builders-take-label">Builder's Take</span>
          ${escapeHtml(buildersTake)}
        </div>` : ""}
        ${renderSentimentBadge(xSentiment)}
      </article>`;
}

function renderCompactArticle(article) {
  const { headline, subheadline, repo } = article;
  return `
      <article class="compact-article">
        <h3 class="compact-headline">${escapeHtml(headline)}</h3>
        <p class="compact-subheadline">${escapeHtml(subheadline)}</p>
        <div class="compact-meta">
          <a href="${escapeHtml(repo.url)}" target="_blank">${escapeHtml(repo.name)}</a> · ${formatStars(repo.stars)} stars · ${escapeHtml(repo.language)}
        </div>
      </article>`;
}

function renderQuickHit(hit) {
  return `
      <div class="quick-hit">
        <span class="quick-hit-name"><a href="${escapeHtml(hit.url)}" target="_blank">${escapeHtml(hit.shortName || hit.name)}</a></span>
        <span class="quick-hit-summary">${escapeHtml(hit.summary)}</span>
        <span class="quick-hit-stars">${formatStars(hit.stars)}</span>
      </div>`;
}

function renderSentimentBadge(xSentiment) {
  if (!xSentiment || xSentiment._failed || xSentiment.sentiment === "unknown") {
    return "";
  }
  const sentiment = escapeHtml(xSentiment.sentiment);
  const postCount = xSentiment.postCount || 0;
  const blurb = xSentiment.blurb ? escapeHtml(xSentiment.blurb) : "";
  let badgeHtml = `<div class="x-sentiment">`;
  badgeHtml += `<span class="x-sentiment-badge x-sentiment-${sentiment}">${sentiment}`;
  if (postCount > 0) {
    badgeHtml += ` <span class="x-sentiment-count">${postCount} posts</span>`;
  }
  badgeHtml += `</span>`;
  if (blurb) {
    badgeHtml += `<span class="x-sentiment-blurb">${blurb}</span>`;
  }
  badgeHtml += `</div>`;
  return badgeHtml;
}

function renderXPulseContent(sectionData, sectionConfig) {
  if (!sectionData || !sectionData.pulseItems || sectionData.pulseItems.length === 0) {
    return `<div class="section-empty">No X Pulse data available today. Check back tomorrow!</div>`;
  }

  let html = `<div class="x-pulse-section">`;
  html += `<p class="x-pulse-intro">What the tech community is talking about on X right now</p>`;

  for (const item of sectionData.pulseItems) {
    html += `<article class="x-pulse-item">`;
    html += `<h3 class="x-pulse-topic">${escapeHtml(item.topic)}</h3>`;
    if (item.blurb) {
      html += `<p class="x-pulse-blurb">${escapeHtml(item.blurb)}</p>`;
    }
    html += `<div class="x-pulse-meta">`;
    if (item.sentiment) {
      html += `<span class="x-sentiment-badge x-sentiment-${escapeHtml(item.sentiment)}">${escapeHtml(item.sentiment)}</span>`;
    }
    if (item.handles) {
      html += `<span class="x-pulse-handles">${escapeHtml(item.handles)}</span>`;
    }
    html += `</div>`;
    html += `</article>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Build navigation HTML for edition pages.
 * @param {object} nav - { prev?: { url, label }, next?: { url, label }, archive?: string, rss?: string }
 * @returns {string} HTML string (empty string if no nav provided)
 */
function buildNavHtml(nav) {
  if (!nav) return "";
  const links = [];
  if (nav.prev) {
    links.push(`<a href="${escapeHtml(nav.prev.url)}">&larr; ${escapeHtml(nav.prev.label)}</a>`);
  }
  if (nav.archive) {
    links.push(`<a href="${escapeHtml(nav.archive)}">Archive</a>`);
  }
  if (nav.rss) {
    links.push(`<a href="${escapeHtml(nav.rss)}">RSS</a>`);
  }
  if (nav.next) {
    links.push(`<a href="${escapeHtml(nav.next.url)}">${escapeHtml(nav.next.label)} &rarr;</a>`);
  }
  if (links.length === 0) return "";
  return `<nav class="edition-nav">${links.join(" · ")}</nav>`;
}

/**
 * Render the section navigation tab bar.
 * @param {string[]} sectionOrder - Array of section IDs
 * @param {object} sections - { frontPage: { isEmpty, ... }, ai: {...}, ... }
 * @param {object} sectionConfigs - SECTIONS config object
 * @returns {string} HTML string
 */
function renderSectionNav(sectionOrder, sections, sectionConfigs) {
  const tabs = sectionOrder.map((id, i) => {
    const config = sectionConfigs[id];
    const sectionData = sections[id];
    const isEmpty = !sectionData || sectionData.isEmpty;
    const activeClass = i === 0 ? " active" : "";
    const disabled = isEmpty ? " disabled" : "";
    return `<button class="section-tab${activeClass}" data-section="${escapeHtml(id)}"${disabled}>${escapeHtml(config.label)}</button>`;
  });
  return `<nav class="section-nav">${tabs.join("")}</nav>`;
}

/**
 * Render content for a single section panel.
 * @param {object} sectionData - { lead, secondary, quickHits, isEmpty }
 * @param {object} sectionConfig - Section config
 * @returns {string} HTML string
 */
function renderSectionContent(sectionData, sectionConfig) {
  if (sectionConfig.isXPulse) return renderXPulseContent(sectionData, sectionConfig);

  if (!sectionData || sectionData.isEmpty || !sectionData.lead) {
    return `<div class="section-empty">No stories found for ${escapeHtml(sectionConfig.label)} today. Check back tomorrow!</div>`;
  }

  const isFrontPage = sectionConfig.id === "frontPage";
  const featuredCount = isFrontPage ? 2 : 1;

  let html = "";

  // Lead story
  html += `<article class="lead-story">${renderLeadStory(sectionData.lead)}</article>`;

  // Secondary section
  if (sectionData.secondary.length > 0) {
    const featured = sectionData.secondary.slice(0, featuredCount);
    const compact = sectionData.secondary.slice(featuredCount);

    html += `<section class="secondary-section">`;
    html += `<h2 class="section-header">Also Trending</h2>`;
    if (featured.length > 0) {
      html += `<div class="featured-grid">${featured.map(renderFeaturedArticle).join("\n")}</div>`;
    }
    if (compact.length > 0) {
      html += `<div class="compact-grid">${compact.map(renderCompactArticle).join("\n")}</div>`;
    }
    html += `</section>`;
  }

  // Quick hits
  if (sectionData.quickHits.length > 0) {
    html += `<section class="quick-hits-section">`;
    html += `<h2 class="section-header">Quick Hits</h2>`;
    html += `<div class="quick-hits-list">${sectionData.quickHits.map(renderQuickHit).join("\n")}</div>`;
    html += `<button class="quick-hits-toggle">Show more</button>`;
    html += `</section>`;
  }

  return html;
}

/**
 * Assemble multi-section HTML from content with sections shape.
 * @param {object} content - { sections: { frontPage: {...}, ... }, tagline }
 * @param {object} options - Same as assembleHtml options
 * @returns {Promise<string>} Complete HTML string
 */
async function assembleMultiSectionHtml(content, options = {}) {
  await initMarked();
  const { SECTIONS, SECTION_ORDER } = require("./sections");
  const templatePath = path.join(__dirname, "..", "templates", "newspaper.html");
  const cssPath = path.join(__dirname, "..", "styles", "newspaper.css");

  const template = fs.readFileSync(templatePath, "utf-8");
  const css = fs.readFileSync(cssPath, "utf-8");

  const now = options.date || new Date();
  const editionDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const navHtml = buildNavHtml(options.nav);
  const rssUrl = options.rssUrl || "";
  const atomUrl = options.atomUrl || "";

  // Build section nav
  const sectionNavHtml = renderSectionNav(SECTION_ORDER, content.sections, SECTIONS);

  // Build section panels
  const panelsHtml = SECTION_ORDER.map((id, i) => {
    const sectionData = content.sections[id];
    const config = SECTIONS[id];
    const activeClass = i === 0 ? " active" : "";
    const panelContent = renderSectionContent(sectionData, config);
    return `<div class="section-panel${activeClass}" data-section="${escapeHtml(id)}">${panelContent}</div>`;
  }).join("\n");

  let html = template
    .replace("{{STYLES}}", css)
    .replace(/\{\{EDITION_DATE\}\}/g, editionDate)
    .replace("{{EDITION_TAGLINE}}", escapeHtml(content.tagline))
    .replace("{{SECTION_NAV}}", sectionNavHtml)
    .replace("{{SECTION_PANELS}}", panelsHtml)
    // Clear legacy placeholders that are unused in multi-section mode
    .replace("{{LEAD_STORY_SECTION}}", "")
    .replace("{{SECONDARY_SECTION}}", "")
    .replace("{{QUICK_HITS_SECTION}}", "")
    .replace(/\{\{NAVIGATION\}\}/g, navHtml)
    .replace("{{RSS_URL}}", escapeHtml(rssUrl))
    .replace("{{ATOM_URL}}", escapeHtml(atomUrl));

  return html;
}

/**
 * Assemble full HTML string from content + options.
 * Detects content shape: if content.sections exists, uses multi-section path.
 * @param {object} content - { lead, secondary, quickHits, tagline } OR { sections: {...}, tagline }
 * @param {object} [options] - { date?: Date, nav?: object, rssUrl?: string, atomUrl?: string }
 * @returns {Promise<string>} Complete HTML string
 */
async function assembleHtml(content, options = {}) {
  // Multi-section shape detection
  if (content.sections) {
    return assembleMultiSectionHtml(content, options);
  }

  // Legacy single-section path
  await initMarked();
  const templatePath = path.join(__dirname, "..", "templates", "newspaper.html");
  const cssPath = path.join(__dirname, "..", "styles", "newspaper.css");

  const template = fs.readFileSync(templatePath, "utf-8");
  const css = fs.readFileSync(cssPath, "utf-8");

  const now = options.date || new Date();
  const editionDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const navHtml = buildNavHtml(options.nav);
  const rssUrl = options.rssUrl || "";
  const atomUrl = options.atomUrl || "";

  // Build lead section — only render if lead exists
  let leadSectionHtml = "";
  if (content.lead) {
    leadSectionHtml = `<article class="lead-story">${renderLeadStory(content.lead)}</article>`;
  }

  // Build secondary section — only render if there are secondary articles
  let secondarySectionHtml = "";
  if (content.secondary && content.secondary.length > 0) {
    const featured = content.secondary.slice(0, 2);
    const compact = content.secondary.slice(2);
    secondarySectionHtml = `<section class="secondary-section">
    <h2 class="section-header">Also Trending</h2>
    <div class="featured-grid">${featured.map(renderFeaturedArticle).join("\n")}</div>
    ${compact.length > 0 ? `<div class="compact-grid">${compact.map(renderCompactArticle).join("\n")}</div>` : ""}
  </section>`;
  }

  // Build quick hits section — only render if there are quick hits
  let quickHitsSectionHtml = "";
  if (content.quickHits && content.quickHits.length > 0) {
    quickHitsSectionHtml = `<section class="quick-hits-section">
    <h2 class="section-header">Quick Hits</h2>
    <div class="quick-hits-list">${content.quickHits.map(renderQuickHit).join("\n")}</div>
    <button class="quick-hits-toggle" id="qh-toggle">Show more</button>
  </section>`;
  }

  let html = template
    .replace("{{STYLES}}", css)
    .replace(/\{\{EDITION_DATE\}\}/g, editionDate)
    .replace("{{EDITION_TAGLINE}}", escapeHtml(content.tagline))
    .replace("{{LEAD_STORY_SECTION}}", leadSectionHtml)
    .replace("{{SECONDARY_SECTION}}", secondarySectionHtml)
    .replace("{{QUICK_HITS_SECTION}}", quickHitsSectionHtml)
    .replace(/\{\{NAVIGATION\}\}/g, navHtml)
    .replace("{{RSS_URL}}", escapeHtml(rssUrl))
    .replace("{{ATOM_URL}}", escapeHtml(atomUrl))
    // Clear multi-section placeholders unused in legacy mode
    .replace("{{SECTION_NAV}}", "")
    .replace("{{SECTION_PANELS}}", "");

  return html;
}

/**
 * Original render function — thin wrapper over assembleHtml.
 * Writes to dist/index.html.
 */
async function render(content) {
  const distDir = path.join(__dirname, "..", "dist");
  const outPath = path.join(distDir, "index.html");

  const html = await assembleHtml(content);

  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(outPath, html);

  console.log(`\nOutput written to ${outPath}`);
  return outPath;
}

module.exports = { render, assembleHtml, assembleMultiSectionHtml, buildNavHtml, escapeHtml, formatStars, bodyToHtml, initMarked, renderLeadStory, renderSecondaryArticle, renderFeaturedArticle, renderCompactArticle, renderSectionNav, renderSectionContent, renderSentimentBadge, renderXPulseContent };
