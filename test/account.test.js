const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { renderAccountPage } = require("../src/account");

describe("renderAccountPage", () => {
  it("returns a complete HTML page", () => {
    const html = renderAccountPage({ basePath: "" });
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("</html>"));
  });

  it("includes login form with email input", () => {
    const html = renderAccountPage({ basePath: "" });
    assert.ok(html.includes('id="magic-link-form"'));
    assert.ok(html.includes('type="email"'));
    assert.ok(html.includes("Send Magic Link"));
  });

  it("has dashboard section (hidden)", () => {
    const html = renderAccountPage({ basePath: "" });
    assert.ok(html.includes('id="account-dashboard"'));
    assert.ok(html.includes('style="display:none"'));
    assert.ok(html.includes('id="account-email"'));
    assert.ok(html.includes('id="account-plan"'));
  });

  it("has error section (hidden)", () => {
    const html = renderAccountPage({ basePath: "" });
    assert.ok(html.includes('id="account-error"'));
  });

  it("respects basePath", () => {
    const html = renderAccountPage({ basePath: "/gittimes" });
    assert.ok(html.includes('href="/gittimes/latest/"'));
    assert.ok(html.includes('href="/gittimes/archive/"'));
  });

  it("has body.account class", () => {
    const html = renderAccountPage({ basePath: "" });
    assert.ok(html.includes('class="account"'));
  });

  it("includes sign out button", () => {
    const html = renderAccountPage({ basePath: "" });
    assert.ok(html.includes('id="account-logout"'));
    assert.ok(html.includes("Sign Out"));
  });

  it("includes upgrade button (hidden by default)", () => {
    const html = renderAccountPage({ basePath: "" });
    assert.ok(html.includes('id="account-upgrade"'));
    assert.ok(html.includes("Upgrade to Premium"));
  });
});

describe("renderAccountPage — Clerk", () => {
  const KEYS = ["CLERK_PUBLISHABLE_KEY", "CLERK_FRONTEND_API"];
  let saved;
  function setEnv(vals) {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      if (vals[k] === undefined) delete process.env[k];
      else process.env[k] = vals[k];
    }
  }
  function restoreEnv() {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }

  it("without Clerk env: no clerk script, CSP unchanged, magic-link form is the flow", () => {
    setEnv({});
    try {
      const html = renderAccountPage({ basePath: "" });
      assert.ok(!html.includes("clerk.browser.js"));
      assert.ok(!html.includes("frame-src"));
      assert.ok(!html.includes("challenges.cloudflare.com"));
      assert.ok(html.includes("var CLERK_PK = '';"), "empty publishable key baked in");
      assert.ok(html.includes('id="magic-link-form"'));
      assert.ok(!html.includes("{{CLERK_SCRIPT}}"), "placeholder resolved");
      assert.ok(!html.includes("{{CSP_EXTRA}}"), "placeholder resolved");
    } finally { restoreEnv(); }
  });

  it("with Clerk env: pinned clerk-js script, publishable key, extended CSP", () => {
    setEnv({ CLERK_PUBLISHABLE_KEY: "pk_test_abc123", CLERK_FRONTEND_API: "https://foo.clerk.accounts.dev" });
    try {
      const html = renderAccountPage({ basePath: "" });
      assert.ok(html.includes('src="https://foo.clerk.accounts.dev/npm/@clerk/clerk-js@5/dist/clerk.browser.js"'), "protocol stripped from host, pinned major");
      assert.ok(html.includes('data-clerk-publishable-key="pk_test_abc123"'));
      assert.ok(html.includes("var CLERK_PK = 'pk_test_abc123';"));
      // CSP: clerk + turnstile in script-src, clerk in connect-src, new directives
      assert.match(html, /script-src [^"]*https:\/\/foo\.clerk\.accounts\.dev https:\/\/challenges\.cloudflare\.com/);
      assert.match(html, /connect-src [^"]*https:\/\/foo\.clerk\.accounts\.dev/);
      assert.ok(html.includes("frame-src https://challenges.cloudflare.com"));
      assert.ok(html.includes("worker-src 'self' blob:"));
      // Clerk mount points present
      assert.ok(html.includes('id="clerk-signin"'));
      assert.ok(html.includes('id="clerk-profile"'));
    } finally { restoreEnv(); }
  });

  it("publishable key without frontend API disables Clerk", () => {
    setEnv({ CLERK_PUBLISHABLE_KEY: "pk_test_abc123" });
    try {
      const html = renderAccountPage({ basePath: "" });
      assert.ok(!html.includes("clerk.browser.js"));
      assert.ok(html.includes("var CLERK_PK = '';"));
    } finally { restoreEnv(); }
  });
});
