const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { renderBusinessStrip, renderFrontPagePanel, renderLensNav } = require("../src/render");
const { buildRegistry } = require("../src/registry");
const { buildBusinessDesks, buildBusinessStrip } = require("../src/desks");

const NOW = Date.parse("2026-07-29T00:00:00Z");
const iso = (d) => new Date(NOW - d * 86400000).toISOString();

const STRIP = [
  { deskId: "bigLabs", label: "Big Labs", slug: "big-labs", line: "Qwen shipped Qwen-Agent v1.2.0", signal: "up", url: "https://github.com/QwenLM/Qwen-Agent" },
  { deskId: "unicorns", label: "Unicorns", slug: "unicorns", line: "No unicorns movement inside the 30d window.", signal: "quiet", url: null },
];

describe("renderLensNav", () => {
  it("wires every lens to its standing page", () => {
    const html = renderLensNav();
    assert.match(html, /href="\/big-labs\/"/);
    assert.match(html, /href="\/startups\/"/);
    assert.match(html, /href="\/unicorns\/"/);
    assert.match(html, /href="\/sectors\/"/);
  });

  it("leaves no dead 'not wired up yet' lens behind", () => {
    const html = renderLensNav();
    assert.equal(html.includes("aria-disabled"), false);
    assert.equal(html.includes("Not wired up yet"), false);
  });

  it("makes every entry behave the same way", () => {
    // The row is one row, so it must do one thing. Sectors was a <button> that
    // switched this edition's topic panel while its three neighbours navigated
    // to standing pages — four elements that look identical and behave two
    // ways. Sectors is a standing page now, so the row is uniform.
    const html = renderLensNav();
    assert.equal(html.includes("<button"), false, "no lens switches a panel");
    assert.equal((html.match(/<a class="lens-tab/g) || []).length, 4);
  });

  it("labels match the desk pages they land on", () => {
    const html = renderLensNav();
    for (const label of ["Unicorns", "Startups", "Big Labs", "Sectors"]) assert.match(html, new RegExp(label));
    assert.equal(html.includes("Indie Builder"), false);
    assert.equal(html.includes(">VC<"), false);
  });

  it("respects basePath", () => {
    assert.match(renderLensNav({ basePath: "/gt" }), /href="\/gt\/big-labs\/"/);
  });
});

describe("renderBusinessStrip", () => {
  it("renders one row per desk", () => {
    const html = renderBusinessStrip(STRIP);
    assert.equal((html.match(/class="biz-row/g) || []).length, 2);
    assert.match(html, /Big Labs/);
    assert.match(html, /Unicorns/);
  });

  it("keeps a dark desk on the page instead of hiding it", () => {
    // The cadence rule made visible: silence renders as silence.
    const html = renderBusinessStrip(STRIP);
    assert.match(html, /biz-line-quiet/);
    assert.match(html, /No unicorns movement/);
  });

  it("links a live line and leaves a dark one unlinked", () => {
    const html = renderBusinessStrip(STRIP);
    assert.match(html, /<a class="biz-line" href="https:\/\/github\.com\/QwenLM/);
    assert.equal((html.match(/<a class="biz-line"/g) || []).length, 1);
  });

  it("returns nothing when the strip is absent — band disappears cleanly", () => {
    assert.equal(renderBusinessStrip([]), "");
    assert.equal(renderBusinessStrip(null), "");
    assert.equal(renderBusinessStrip(undefined), "");
  });

  it("escapes company-controlled text", () => {
    const html = renderBusinessStrip([
      { deskId: "bigLabs", label: "Big Labs", line: '<img src=x onerror="alert(1)">', signal: "up", url: "https://x.test" },
    ]);
    assert.equal(html.includes("<img"), false);
    assert.match(html, /&lt;img/);
  });

  it("rides the front page end-to-end from real registry output", () => {
    const { entities } = buildRegistry(
      {
        modelDrops: [{ id: "Qwen/Qwen3-Next", author: "Qwen", name: "Qwen3-Next", likes: 300, createdAt: iso(1), ageDays: 1, url: "https://huggingface.co/Qwen/Qwen3-Next" }],
      },
      { nowMs: NOW }
    );
    const strip = buildBusinessStrip(buildBusinessDesks(entities));
    const sections = {
      frontPage: {
        lead: {
          headline: "A lead story",
          subheadline: "sub",
          body: "First paragraph here.",
          repo: {
            full_name: "acme/thing",
            name: "acme/thing",
            description: "a thing",
            stargazers_count: 100,
            language: "Go",
            topics: [],
            url: "https://github.com/acme/thing",
          },
        },
        secondary: [],
        quickHits: [],
        isEmpty: false,
      },
    };
    const html = renderFrontPagePanel(sections, {}, [], { businessStrip: strip });
    assert.match(html, /business-strip/);
    assert.match(html, /Qwen3-Next/);
  });
});
