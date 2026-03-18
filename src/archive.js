const { escapeHtml } = require("./render");
const { loadTemplate, buildAnalytics } = require("./template-utils");

/**
 * Render the archive page listing all editions.
 * @param {Array} manifest - Array of { date, headline, tagline, url }
 * @param {string} basePath - Base path for links (e.g. "")
 * @returns {string} Complete HTML string
 */
function renderArchivePage(manifest, basePath) {
  const { template, css } = loadTemplate("archive");

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

  const { analyticsScript, cspScriptSrc, cspConnectSrc } = buildAnalytics();

  return template
    .replace("{{STYLES}}", css)
    .replace(/\{\{BASE_PATH\}\}/g, basePath)
    .replace("{{EDITION_LIST}}", rows.join("\n"))
    .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
    .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
    .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc);
}

module.exports = { renderArchivePage };
