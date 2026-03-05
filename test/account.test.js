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
