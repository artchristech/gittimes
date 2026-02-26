const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("./render");

/**
 * Render the archive page listing all editions.
 * @param {Array} manifest - Array of { date, headline, tagline, url }
 * @param {string} basePath - Base path for links (e.g. "" or "/dagitnews")
 * @returns {string} Complete HTML string
 */
function renderArchivePage(manifest, basePath) {
  const templatePath = path.join(__dirname, "..", "templates", "archive.html");
  const cssPath = path.join(__dirname, "..", "styles", "newspaper.css");

  const template = fs.readFileSync(templatePath, "utf-8");
  const css = fs.readFileSync(cssPath, "utf-8");

  const rows = manifest.map((entry) => {
    const displayDate = new Date(entry.date + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const url = entry.url || `${basePath}/editions/${entry.date}/`;
    const headline = entry.headline || "Edition";
    const tagline = entry.tagline || "";
    return `
    <div class="archive-entry">
      <span class="archive-date">${escapeHtml(displayDate)}</span>
      <a href="${escapeHtml(url)}" class="archive-headline">${escapeHtml(headline)}</a>
      ${tagline ? `<span class="archive-tagline">${escapeHtml(tagline)}</span>` : ""}
    </div>`;
  });

  const rssUrl = basePath + "/feed.xml";
  const atomUrl = basePath + "/feed.atom";

  return template
    .replace("{{STYLES}}", css)
    .replace(/\{\{BASE_PATH\}\}/g, basePath)
    .replace("{{EDITION_LIST}}", rows.join("\n"))
    .replace("{{RSS_URL}}", escapeHtml(rssUrl))
    .replace("{{ATOM_URL}}", escapeHtml(atomUrl));
}

module.exports = { renderArchivePage };
