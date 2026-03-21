const { escapeHtml } = require("./render");
const { applyTemplate } = require("./template-utils");

/**
 * Render the landing page with recent editions and subscribe form.
 * @param {Array} manifest - Array of { date, headline, tagline, url }
 * @param {object} options - { basePath, siteUrl }
 * @returns {string} Complete HTML string
 */
function renderLandingPage(manifest, options = {}) {
  const basePath = options.basePath || "";

  const recent = manifest.slice(0, 5);
  const cards = recent.map((entry) => {
    const displayDate = new Date(entry.date + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const url = entry.url || `${basePath}/editions/${entry.date}/`;
    const headline = entry.headline || "Edition";
    return `    <a href="${escapeHtml(url)}" class="landing-edition-card">
      <span class="edition-card-date">${escapeHtml(displayDate)}</span>
      <span class="edition-card-headline">${escapeHtml(headline)}</span>
    </a>`;
  });

  const chatWorkerUrl = process.env.CHAT_WORKER_URL || "";
  const subscribeUrl = chatWorkerUrl ? chatWorkerUrl + "/subscribe" : "";

  return applyTemplate("landing", basePath, { chatWorkerUrl })
    .replace("{{EDITION_CARDS}}", cards.join("\n"))
    .replace(/\{\{SUBSCRIBE_URL\}\}/g, subscribeUrl);
}

module.exports = { renderLandingPage };
