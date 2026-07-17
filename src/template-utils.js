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
 * @param {string} [options.clerkFrontendApi] - Clerk frontend-API host (account page
 *   only). Adds Clerk + Turnstile to script/connect-src and emits the extra
 *   frame-src/worker-src directives clerk-js needs.
 * @returns {{ analyticsScript: string, cspScriptSrc: string, cspConnectSrc: string, cspExtra: string }}
 */
function buildAnalytics(options = {}) {
  const plausibleDomain = process.env.PLAUSIBLE_DOMAIN || "";
  const analyticsScript = plausibleDomain
    ? `<script defer data-domain="${escapeHtml(plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`
    : "";
  let cspScriptSrc = plausibleDomain ? " https://plausible.io" : "";
  let cspConnectSrc = plausibleDomain ? " https://plausible.io" : "";
  let cspExtra = "";

  if (options.chatWorkerUrl) {
    try {
      const workerOrigin = new URL(options.chatWorkerUrl).origin;
      cspConnectSrc += " " + workerOrigin;
    } catch { /* invalid URL — skip */ }
  }

  if (options.clerkFrontendApi) {
    const clerkOrigin = `https://${options.clerkFrontendApi}`;
    cspScriptSrc += ` ${clerkOrigin} https://challenges.cloudflare.com`;
    cspConnectSrc += ` ${clerkOrigin}`;
    // No frame-src/worker-src directives exist in the base CSP, so both fall
    // back to default-src 'self' — Turnstile iframes and clerk-js's blob
    // session-refresh worker need these explicitly.
    cspExtra = "; frame-src https://challenges.cloudflare.com; worker-src 'self' blob:";
  }

  return { analyticsScript, cspScriptSrc, cspConnectSrc, cspExtra };
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
  const { analyticsScript, cspScriptSrc, cspConnectSrc, cspExtra } = buildAnalytics({
    chatWorkerUrl,
    clerkFrontendApi: options.clerkFrontendApi || "",
  });
  return template
    .replace("{{STYLES}}", css)
    .replace(/\{\{BASE_PATH\}\}/g, basePath)
    .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
    .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
    .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc)
    .replace("{{CSP_EXTRA}}", cspExtra);
}

module.exports = { loadTemplate, buildAnalytics, applyTemplate };
