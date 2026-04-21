const { applyTemplate } = require("./template-utils");

/**
 * Render the account page.
 * @param {object} options - { basePath, siteUrl }
 * @returns {string} Complete HTML string
 */
function renderAccountPage(options = {}) {
  const basePath = options.basePath || "";
  const chatWorkerUrl = process.env.CHAT_WORKER_URL || "";

  if (!chatWorkerUrl) {
    console.warn("Warning: CHAT_WORKER_URL not set — /account/ login and Stripe flows will not work");
  }

  return applyTemplate("account", basePath, { chatWorkerUrl })
    .replace(/\{\{WORKER_URL\}\}/g, chatWorkerUrl);
}

module.exports = { renderAccountPage };
