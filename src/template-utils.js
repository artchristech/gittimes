const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("./render");

/**
 * Load a template and its paired CSS.
 * @param {string} name - Template name (e.g. "landing", "archive", "account", "markets", "404")
 * @returns {{ template: string, css: string }}
 */
function loadTemplate(name) {
  const templatePath = path.join(__dirname, "..", "templates", `${name}.html`);
  const cssPath = path.join(__dirname, "..", "styles", "newspaper.css");
  const template = fs.readFileSync(templatePath, "utf-8");
  const css = fs.readFileSync(cssPath, "utf-8");
  return { template, css };
}

/**
 * Build Plausible analytics script + CSP directives.
 * @param {object} [options]
 * @param {string} [options.chatWorkerUrl] - Worker URL (adds origin to connect-src)
 * @returns {{ analyticsScript: string, cspScriptSrc: string, cspConnectSrc: string }}
 */
function buildAnalytics(options = {}) {
  const plausibleDomain = process.env.PLAUSIBLE_DOMAIN || "";
  const analyticsScript = plausibleDomain
    ? `<script defer data-domain="${escapeHtml(plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`
    : "";
  const cspScriptSrc = plausibleDomain ? " https://plausible.io" : "";
  let cspConnectSrc = plausibleDomain ? " https://plausible.io" : "";

  if (options.chatWorkerUrl) {
    try {
      const workerOrigin = new URL(options.chatWorkerUrl).origin;
      cspConnectSrc += " " + workerOrigin;
    } catch { /* invalid URL — skip */ }
  }

  return { analyticsScript, cspScriptSrc, cspConnectSrc };
}

module.exports = { loadTemplate, buildAnalytics };
