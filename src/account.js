const { loadTemplate, buildAnalytics } = require("./template-utils");

/**
 * Render the account page.
 * @param {object} options - { basePath, siteUrl }
 * @returns {string} Complete HTML string
 */
function renderAccountPage(options = {}) {
  const basePath = options.basePath || "";

  const { template, css } = loadTemplate("account");

  const chatWorkerUrl = process.env.CHAT_WORKER_URL || "";

  const { analyticsScript, cspScriptSrc, cspConnectSrc } = buildAnalytics({ chatWorkerUrl });

  return template
    .replace("{{STYLES}}", css)
    .replace(/\{\{BASE_PATH\}\}/g, basePath)
    .replace(/\{\{WORKER_URL\}\}/g, chatWorkerUrl)
    .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
    .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
    .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc);
}

module.exports = { renderAccountPage };
