const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { renderAdminPage, renderDeskBridgePage } = require("../src/admin-page");

describe("renderAdminPage — account sign-in", () => {
  it("sends both credentials so either gate can admit you", () => {
    const html = renderAdminPage("", { accountEnabled: true, tokenEnabled: true });
    assert.match(html, /"X-Admin-Token": token\(\)/);
    assert.match(html, /"X-Gittimes-Session": session\(\)/);
  });

  it("adopts a session handed over in the fragment, then scrubs the URL", () => {
    const html = renderAdminPage("");
    assert.match(html, /location\.hash \|\| ""\)\.match\(/);
    assert.match(html, /localStorage\.setItem\(SKEY, m\[1\]\)/);
    // The fragment must not survive in the address bar or history.
    assert.match(html, /history\.replaceState\(null, "", location\.pathname \+ location\.search\)/);
  });

  it("offers the account sign-in route when accounts are configured", () => {
    const html = renderAdminPage("", { accountEnabled: true, tokenEnabled: true });
    assert.match(html, /Sign in with your Git Times account/);
    assert.match(html, /https:\/\/gittimes\.com\/desk\//);
  });

  it("hides the shared-token fallback when no token is set", () => {
    const withToken = renderAdminPage("", { accountEnabled: true, tokenEnabled: true });
    const without = renderAdminPage("", { accountEnabled: true, tokenEnabled: false });
    assert.match(withToken, /<details id="tok-fallback">/);
    assert.match(without, /<details id="tok-fallback" hidden>/);
  });

  it("keeps the page itself secret-free", () => {
    const html = renderAdminPage("", { accountEnabled: true, tokenEnabled: true });
    assert.doesNotMatch(html, /GT_ADMIN_EMAIL/);
    // The placeholder names the env var; no value may ever be baked in.
    assert.doesNotMatch(html, /mandalazenwave/i);
  });
});

describe("renderDeskBridgePage", () => {
  it("hands the session over in the fragment, never the query string", () => {
    const html = renderDeskBridgePage("https://api.gittimes.com");
    assert.match(html, /location\.replace\(API \+ "\/admin#s=" \+ encodeURIComponent\(s\)\)/);
    assert.doesNotMatch(html, /\/admin\?s=/);
  });

  it("shows only a sign-in link when there is no session", () => {
    const html = renderDeskBridgePage("https://api.gittimes.com", "");
    assert.match(html, /href="\/account\/"/);
    assert.match(html, /need to be signed in/);
  });

  it("normalises a trailing slash on the API base", () => {
    assert.match(renderDeskBridgePage("https://api.gittimes.com/"), /"https:\/\/api\.gittimes\.com"/);
  });

  it("stays out of search indexes", () => {
    assert.match(renderDeskBridgePage("https://api.gittimes.com"), /noindex, nofollow/);
  });
});
