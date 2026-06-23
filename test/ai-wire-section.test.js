const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { assembleHtml, renderDeskRail, renderFrontPagePanel } = require("../src/render");

function makeArticle(headline) {
  return {
    headline,
    subheadline: "Sub",
    body: "Body text for the article. Second sentence. Third sentence here.",
    useCases: ["Deploy personal blogs", "Manage paid newsletters"],
    repo: { name: "org/repo", url: "https://github.com/org/repo", stars: 5000, language: "Rust" },
  };
}

function makeSection(leadHeadline, repoName) {
  return {
    lead: { ...makeArticle(leadHeadline), repo: { name: repoName, url: "https://github.com/" + repoName, stars: 4200, language: "Go" } },
    secondary: [],
    quickHits: [],
    isEmpty: false,
  };
}

const CONTENT = {
  sections: {
    frontPage: { lead: makeArticle("Front Page Lead"), secondary: [makeArticle("Sec")], quickHits: [], isEmpty: false },
    ai: makeSection("An open-weights agent framework", "nexa/agent-core"),
    robotics: makeSection("ROS 2 navigation rewrite", "ros-nav/rt-stack"),
    cyber: { isEmpty: true },
  },
  tagline: "Today's stories",
};

const HEADLINES = [
  { title: "Sakana AI unveils a self-improving model", url: "https://sakana.ai/news", source: "sakana.ai", points: 420, comments: 88, discussionUrl: "https://news.ycombinator.com/item?id=1" },
];

const OPTS = { date: new Date("2026-06-23"), dateStr: "2026-06-23", basePath: "", siteUrl: "https://gittimes.com" };

describe("AI Wire as a section (not a top banner)", () => {
  it("renders AI Wire as a section tab and panel, never as a pre-nav banner", async () => {
    const html = await assembleHtml(CONTENT, { ...OPTS, aiWire: { headlines: HEADLINES, research: [] } });

    assert.ok(!html.includes("{{AI_WIRE}}"), "raw {{AI_WIRE}} placeholder leaked");
    assert.ok(/section-tab[^>]*data-section="aiWire"/.test(html), "AI Wire tab missing");
    assert.ok(/section-panel[^>]*data-section="aiWire"/.test(html), "AI Wire panel missing");

    const navIdx = html.indexOf('class="section-nav"');
    const wireIdx = html.indexOf('class="ai-wire"');
    assert.ok(navIdx > -1 && wireIdx > -1, "nav or wire missing");
    assert.ok(wireIdx > navIdx, "AI Wire content appears before the section nav (still a banner)");
  });

  it("disables the AI Wire tab when there are no headlines or research", async () => {
    const html = await assembleHtml(CONTENT, { ...OPTS, aiWire: { headlines: [], research: [] } });
    assert.ok(/section-tab[^>]*data-section="aiWire"[^>]*disabled/.test(html), "empty AI Wire tab should be disabled");
  });
});

describe("Front page = the Split (lead + Across the Desk rail)", () => {
  it("renders a hero split with the lead and a section-lead rail", async () => {
    const html = await assembleHtml(CONTENT, { ...OPTS, aiWire: { headlines: HEADLINES, research: [] } });

    assert.ok(html.includes('class="front-hero"'), "front-hero split missing");
    assert.ok(html.includes('class="front-lead-col"'), "front lead column missing");
    assert.ok(html.includes('class="desk-rail"'), "desk rail missing");
    assert.ok(html.includes("Across the Desk"), "rail header missing");
  });

  it("rail shows each section's lead headline and jumps to that section", () => {
    const order = ["frontPage", "aiWire", "ai", "robotics", "cyber"];
    const configs = { ai: { label: "AI" }, robotics: { label: "Robotics" }, cyber: { label: "Cyber" } };
    const rail = renderDeskRail(CONTENT.sections, configs, order);

    assert.ok(rail.includes("An open-weights agent framework"), "AI section lead headline missing");
    assert.ok(rail.includes("ROS 2 navigation rewrite"), "Robotics section lead headline missing");
    assert.ok(/section-jump[^>]*data-section="ai"/.test(rail), "AI rail item should jump to the AI tab");
    // Empty sections are skipped.
    assert.ok(!/data-section="cyber"/.test(rail), "empty Cyber section should be skipped");
    // frontPage and aiWire are never in the rail.
    assert.ok(!/data-section="frontPage"/.test(rail) && !/data-section="aiWire"/.test(rail));
  });

  it("front-page lead is in the hero, not duplicated below", () => {
    const order = ["frontPage", "aiWire", "ai", "robotics"];
    const panel = renderFrontPagePanel(CONTENT.sections, { ai: { label: "AI" }, robotics: { label: "Robotics" } }, order);
    const heroIdx = panel.indexOf('class="front-hero"');
    assert.ok(heroIdx > -1, "hero missing");
    // The lead headline appears exactly once (in the hero).
    const occurrences = panel.split("Front Page Lead").length - 1;
    assert.equal(occurrences, 1, "front page lead should appear once, in the hero");
  });
});
