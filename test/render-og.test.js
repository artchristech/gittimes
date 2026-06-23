const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { assembleArticlePage } = require("../src/render");

const ARTICLE = {
  headline: "Test Headline For Slug",
  subheadline: "A representative subheadline.",
  body: "Body text.",
  repo: { url: "https://github.com/x/y", name: "x/y", language: "Python", stars: 1234 },
};
const OPTS = { date: new Date("2026-06-23"), dateStr: "2026-06-23", basePath: "", siteUrl: "https://gittimes.com", sectionId: "frontPage" };

// Regression: {{OG_URL}} appears twice in article.html (og:url + canonical).
// A non-global .replace() left the canonical link leaking the raw placeholder
// on every published article share page. Lock both occurrences to the real URL.
describe("assembleArticlePage — OG/canonical share metadata", () => {
  it("resolves every {{OG_URL}} placeholder (no leak in canonical)", async () => {
    const { html } = await assembleArticlePage(ARTICLE, OPTS);
    assert.ok(!/\{\{OG_URL\}\}/.test(html), "raw {{OG_URL}} placeholder leaked into article page");
  });

  it("og:url and canonical both point at the article's real permalink", async () => {
    const { html, slug } = await assembleArticlePage(ARTICLE, OPTS);
    const expected = `https://gittimes.com/editions/2026-06-23/${slug}/`;
    const og = html.match(/og:url" content="([^"]*)"/);
    const canonical = html.match(/canonical" href="([^"]*)"/);
    assert.equal(og && og[1], expected);
    assert.equal(canonical && canonical[1], expected);
  });
});
