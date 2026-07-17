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

  // Clerk is enabled only when BOTH env vars are set; otherwise the page
  // falls back to the legacy magic-link form and the CSP is unchanged, so
  // builds stay green before the Clerk instance exists.
  const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || "";
  // Host only (e.g. "clerk.gittimes.com" or "foo.clerk.accounts.dev").
  const clerkFrontendApi = (process.env.CLERK_FRONTEND_API || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const clerkEnabled = Boolean(clerkPublishableKey && clerkFrontendApi);
  if (clerkPublishableKey && !clerkEnabled) {
    console.warn("Warning: CLERK_PUBLISHABLE_KEY set without CLERK_FRONTEND_API — Clerk sign-in disabled");
  }

  // onerror flags a failed clerk-js load so the page can fall back to the
  // magic-link form immediately instead of waiting out the poll timeout.
  const clerkScript = clerkEnabled
    ? `<script src="https://${clerkFrontendApi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js" data-clerk-publishable-key="${clerkPublishableKey}" onerror="window.__clerkLoadFailed=true" defer></script>`
    : "";

  return applyTemplate("account", basePath, {
    chatWorkerUrl,
    clerkFrontendApi: clerkEnabled ? clerkFrontendApi : "",
  })
    .replace(/\{\{WORKER_URL\}\}/g, chatWorkerUrl)
    .replace("{{CLERK_SCRIPT}}", clerkScript)
    .replace(/\{\{CLERK_PUBLISHABLE_KEY\}\}/g, clerkEnabled ? clerkPublishableKey : "");
}

module.exports = { renderAccountPage };
