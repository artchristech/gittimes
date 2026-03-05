const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("./render");

/**
 * Render the landing page with recent editions and subscribe form.
 * @param {Array} manifest - Array of { date, headline, tagline, url }
 * @param {object} options - { basePath, siteUrl }
 * @returns {string} Complete HTML string
 */
function renderLandingPage(manifest, options = {}) {
  const basePath = options.basePath || "";
  const siteUrl = options.siteUrl || "https://gittimes.com";

  const templatePath = path.join(__dirname, "..", "templates", "landing.html");
  const cssPath = path.join(__dirname, "..", "styles", "newspaper.css");

  const template = fs.readFileSync(templatePath, "utf-8");
  const css = fs.readFileSync(cssPath, "utf-8");

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

  const plausibleDomain = process.env.PLAUSIBLE_DOMAIN || "";
  const analyticsScript = plausibleDomain
    ? `<script defer data-domain="${escapeHtml(plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`
    : "";
  const cspScriptSrc = plausibleDomain ? " https://plausible.io" : "";
  const cspConnectSrc = plausibleDomain ? " https://plausible.io" : "";
  if (chatWorkerUrl) {
    const workerOrigin = new URL(chatWorkerUrl).origin;
    if (!cspConnectSrc.includes(workerOrigin)) {
      // append worker origin to connect-src
    }
  }

  return template
    .replace("{{STYLES}}", css)
    .replace(/\{\{BASE_PATH\}\}/g, basePath)
    .replace("{{EDITION_CARDS}}", cards.join("\n"))
    .replace(/\{\{SUBSCRIBE_URL\}\}/g, subscribeUrl)
    .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
    .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
    .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc);
}

module.exports = { renderLandingPage };
