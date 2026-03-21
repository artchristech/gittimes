const { applyTemplate } = require("./template-utils");

/**
 * Render the account page.
 * @param {object} options - { basePath, siteUrl }
 * @returns {string} Complete HTML string
 */
function renderAccountPage(options = {}) {
  const basePath = options.basePath || "";
  const chatWorkerUrl = process.env.CHAT_WORKER_URL || "";

  return applyTemplate("account", basePath, { chatWorkerUrl })
    .replace(/\{\{WORKER_URL\}\}/g, chatWorkerUrl);
}

module.exports = { renderAccountPage };
