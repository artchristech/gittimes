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

/**
 * Load a template and apply all standard placeholder replacements.
 * @param {string} name - Template name (e.g. "landing", "archive", "account", "markets", "404")
 * @param {string} basePath - Base path for links
 * @param {object} [options]
 * @param {string} [options.chatWorkerUrl] - Worker URL (overrides env)
 * @returns {string} Template string with STYLES, BASE_PATH, ANALYTICS, and CSP replaced
 */
function applyTemplate(name, basePath, options = {}) {
  const { template, css } = loadTemplate(name);
  const chatWorkerUrl = options.chatWorkerUrl || process.env.CHAT_WORKER_URL || "";
  const { analyticsScript, cspScriptSrc, cspConnectSrc } = buildAnalytics({ chatWorkerUrl });
  return template
    .replace("{{STYLES}}", css)
    .replace(/\{\{BASE_PATH\}\}/g, basePath)
    .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
    .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
    .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc);
}

module.exports = { loadTemplate, buildAnalytics, applyTemplate };
