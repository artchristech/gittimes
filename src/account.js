const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("./render");

/**
 * Render the account page.
 * @param {object} options - { basePath, siteUrl }
 * @returns {string} Complete HTML string
 */
function renderAccountPage(options = {}) {
  const basePath = options.basePath || "";

  const templatePath = path.join(__dirname, "..", "templates", "account.html");
  const cssPath = path.join(__dirname, "..", "styles", "newspaper.css");

  const template = fs.readFileSync(templatePath, "utf-8");
  const css = fs.readFileSync(cssPath, "utf-8");

  const chatWorkerUrl = process.env.CHAT_WORKER_URL || "";

  const plausibleDomain = process.env.PLAUSIBLE_DOMAIN || "";
  const analyticsScript = plausibleDomain
    ? `<script defer data-domain="${escapeHtml(plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`
    : "";
  const cspScriptSrc = plausibleDomain ? " https://plausible.io" : "";
  let cspConnectSrc = plausibleDomain ? " https://plausible.io" : "";
  if (chatWorkerUrl) {
    try {
      const workerOrigin = new URL(chatWorkerUrl).origin;
      cspConnectSrc += " " + workerOrigin;
    } catch {}
  }

  return template
    .replace("{{STYLES}}", css)
    .replace(/\{\{BASE_PATH\}\}/g, basePath)
    .replace(/\{\{WORKER_URL\}\}/g, chatWorkerUrl)
    .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
    .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
    .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc);
}

module.exports = { renderAccountPage };
