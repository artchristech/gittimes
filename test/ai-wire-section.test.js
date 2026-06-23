const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { assembleHtml, renderWireTeaser } = require("../src/render");

function makeArticle(headline) {
  return {
    headline,
    subheadline: "Sub",
    body: "Body text for the article.",
    useCases: ["Deploy personal blogs", "Manage paid newsletters"],
    repo: { name: "org/repo", url: "https://github.com/org/repo", stars: 5000, language: "Rust" },
  };
}

const CONTENT = {
  sections: {
    frontPage: { lead: makeArticle("Front Page Lead"), secondary: [makeArticle("Sec")], quickHits: [], isEmpty: false },
    ai: { lead: makeArticle("AI Lead"), secondary: [], quickHits: [], isEmpty: false },
  },
  tagline: "Today's stories",
};

// A genuine news item with NO GitHub repo — the kind that was structurally
// invisible on the front page because the front page is repo-trending only.
const HEADLINES = [
  { title: "Sakana AI unveils a self-improving model", url: "https://sakana.ai/news", source: "sakana.ai", points: 420, comments: 88, discussionUrl: "https://news.ycombinator.com/item?id=1" },
  { title: "A second AI headline", url: "https://example.com/two", source: "example.com", points: 200, comments: 12, discussionUrl: null },
];

const OPTS = { date: new Date("2026-06-23"), dateStr: "2026-06-23", basePath: "", siteUrl: "https://gittimes.com" };

describe("AI Wire as a section (not a top banner)", () => {
  it("renders AI Wire as a section tab and panel, never as a pre-nav banner", async () => {
    const html = await assembleHtml(CONTENT, { ...OPTS, aiWire: { headlines: HEADLINES, research: [] } });

    // No raw placeholder leaks
    assert.ok(!html.includes("{{AI_WIRE}}"), "raw {{AI_WIRE}} placeholder leaked");

    // AI Wire is a tab in the section nav AND a panel (>=2 references to its id)
    assert.ok(html.includes('class="section-tab" data-section="aiWire"') || /section-tab[^>]*data-section="aiWire"/.test(html), "AI Wire tab missing");
    assert.ok(/section-panel[^>]*data-section="aiWire"/.test(html), "AI Wire panel missing");

    // The wire content (its header) sits AFTER the section nav — i.e. inside the
    // panels, not pinned above the front page.
    const navIdx = html.indexOf('class="section-nav"');
    const wireIdx = html.indexOf('class="ai-wire"');
    assert.ok(navIdx > -1 && wireIdx > -1, "nav or wire missing");
    assert.ok(wireIdx > navIdx, "AI Wire content appears before the section nav (still a banner)");
  });

  it("disables the AI Wire tab when there are no headlines or research", async () => {
    const html = await assembleHtml(CONTENT, { ...OPTS, aiWire: { headlines: [], research: [] } });
    assert.ok(/section-tab[^>]*data-section="aiWire"[^>]*disabled/.test(html), "empty AI Wire tab should be disabled");
    assert.ok(!html.includes('class="wire-teaser"'), "no front-page teaser when wire is empty");
  });
});

describe("front-page eligibility for non-repo news (Sakana)", () => {
  it("surfaces the top wire headline on the front page via the teaser", async () => {
    const html = await assembleHtml(CONTENT, { ...OPTS, aiWire: { headlines: HEADLINES, research: [] } });

    assert.ok(html.includes('class="wire-teaser"'), "front-page wire teaser missing");
    assert.ok(html.includes("Sakana AI unveils a self-improving model"), "fresh news headline not surfaced");

    // The teaser must live inside the FRONT PAGE panel, ahead of the AI Wire
    // panel — that is what makes the news front-page-eligible rather than buried.
    const teaserIdx = html.indexOf('class="wire-teaser"');
    const wirePanelIdx = html.search(/section-panel[^>]*data-section="aiWire"/);
    assert.ok(teaserIdx > -1 && wirePanelIdx > -1, "teaser or wire panel missing");
    assert.ok(teaserIdx < wirePanelIdx, "teaser should be on the front page, before the AI Wire panel");
  });

  it("renderWireTeaser is grounded: a real link, no invented body", () => {
    const html = renderWireTeaser(HEADLINES);
    assert.ok(html.includes("From the Wire"));
    assert.ok(html.includes('href="https://sakana.ai/news"'));
    assert.ok(html.includes("Sakana AI unveils a self-improving model"));
    assert.equal(renderWireTeaser([]), "");
    assert.equal(renderWireTeaser(null), "");
  });
});
