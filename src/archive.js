const { escapeHtml } = require("./render");
const { applyTemplate } = require("./template-utils");

/**
 * Render the archive page listing all editions.
 * @param {Array} manifest - Array of { date, headline, tagline, url }
 * @param {string} basePath - Base path for links (e.g. "")
 * @returns {string} Complete HTML string
 */
function renderArchivePage(manifest, basePath) {
  const rows = manifest.map((entry) => {
    const displayDate = new Date(entry.date + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const url = entry.url || `${basePath}/editions/${entry.date}/`;
    const headline = entry.headline || "Edition";
    const subheadline = entry.subheadline || "";
    const tagline = entry.tagline || "";
    return `
    <div class="archive-entry">
      <span class="archive-date">${escapeHtml(displayDate)}</span>
      <a href="${escapeHtml(url)}" class="archive-headline">${escapeHtml(headline)}</a>
      ${subheadline ? `<span class="archive-subheadline">${escapeHtml(subheadline)}</span>` : ""}
      ${tagline ? `<span class="archive-tagline">${escapeHtml(tagline)}</span>` : ""}
    </div>`;
  });

  return applyTemplate("archive", basePath)
    .replace("{{EDITION_LIST}}", rows.join("\n"));
}

module.exports = { renderArchivePage };
