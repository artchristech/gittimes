// Design presets — the reader toolbar's four full design identities
// (Newspaper default / Cyberpunk / Business / Whitepaper). These tests pin
// the static contract across the template, stylesheet, and worker: the pills
// exist and come first, the setting syncs, each design owns typography +
// palette (not a color swap), and `newspaper` stays the untouched default.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const template = fs.readFileSync(path.join(__dirname, "..", "templates", "newspaper.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "styles", "newspaper.css"), "utf8");
const workerSrc = fs.readFileSync(path.join(__dirname, "..", "worker", "index.js"), "utf8");

const DESIGNS = ["newspaper", "cyberpunk", "business", "whitepaper"];
const NEW_DESIGNS = DESIGNS.filter((d) => d !== "newspaper");

describe("design presets — toolbar markup", () => {
  it("has a Design group with exactly the four preset pills", () => {
    const group = template.match(/<div class="panel-options panel-options-grid" data-setting="design">([\s\S]*?)<\/div>/);
    assert.ok(group, "design pill group missing");
    const values = [...group[1].matchAll(/data-value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(values, DESIGNS);
  });

  it("places the Design row above the color Preset row", () => {
    const designIdx = template.indexOf('data-setting="design"');
    const themeIdx = template.indexOf('data-setting="theme"');
    assert.ok(designIdx > -1 && themeIdx > -1, "design or theme group missing");
    assert.ok(designIdx < themeIdx, "Design row must come before the color Preset row");
  });

  it("marks the three color groups so designs can hide them", () => {
    const count = (template.match(/panel-group panel-group-color/g) || []).length;
    assert.equal(count, 3, "theme + background + text groups should carry panel-group-color");
  });

  it("defaults to newspaper and syncs design to the account", () => {
    assert.match(template, /design:\s*'newspaper'/, "defaults must include design: 'newspaper'");
    const syncKeys = template.match(/var SYNC_KEYS = \[([^\]]*)\]/);
    assert.ok(syncKeys, "SYNC_KEYS missing");
    assert.ok(syncKeys[1].includes("'design'"), "SYNC_KEYS must include 'design'");
  });

  it("sanitizes unknown design values back to the default", () => {
    assert.match(template, /DESIGNS\.indexOf\(state\.design\) === -1/, "client-side design sanitizer missing");
  });
});

describe("design presets — stylesheet", () => {
  it("newspaper is the absence of overrides (default stays pixel-identical)", () => {
    assert.ok(!css.includes('[data-design="newspaper"]'), "newspaper must not have design overrides");
  });

  it("each new design owns a palette and typography, not just colors", () => {
    for (const design of NEW_DESIGNS) {
      const palette = css.match(new RegExp(`\\[data-design="${design}"\\] \\{([^}]*)\\}`));
      assert.ok(palette, `${design}: palette block missing`);
      assert.match(palette[1], /--paper:/, `${design}: must set --paper`);
      assert.match(palette[1], /--accent:/, `${design}: must set --accent`);
      const fonts = css.match(new RegExp(`\\[data-design="${design}"\\]\\[data-font="serif"\\] \\{([^}]*)\\}`));
      assert.ok(fonts, `${design}: typography block missing`);
      assert.match(fonts[1], /--font-headline:/, `${design}: must set --font-headline`);
      assert.match(fonts[1], /--font-body:/, `${design}: must set --font-body`);
    }
  });

  it("the three designs use pairwise-distinct backgrounds and body fonts", () => {
    const papers = new Set();
    const bodies = new Set();
    for (const design of NEW_DESIGNS) {
      papers.add(css.match(new RegExp(`\\[data-design="${design}"\\] \\{[^}]*--paper:\\s*([^;]+);`))[1].trim());
      bodies.add(css.match(new RegExp(`\\[data-design="${design}"\\]\\[data-font="serif"\\] \\{[^}]*--font-body:\\s*([^;]+);`))[1].trim());
    }
    // Plus the :root newspaper defaults
    papers.add(css.match(/:root \{[^}]*--paper:\s*([^;]+);/)[1].trim());
    bodies.add(css.match(/:root \{[^}]*--font-body:\s*([^;]+);/)[1].trim());
    assert.equal(papers.size, 4, "all four designs need distinct --paper values");
    assert.equal(bodies.size, 4, "all four designs need distinct --font-body stacks");
  });

  it("designs hide the color preset and slider groups", () => {
    for (const design of NEW_DESIGNS) {
      assert.ok(css.includes(`[data-design="${design}"] .panel-group-color`), `${design}: must hide .panel-group-color`);
    }
  });

  it("whitepaper scratches entry/scroll animations", () => {
    const reveal = css.match(/\[data-design="whitepaper"\] \[data-reveal\] \{([^}]*)\}/);
    assert.ok(reveal, "whitepaper [data-reveal] override missing");
    assert.match(reveal[1], /opacity:\s*1\s*!important/);
    assert.match(reveal[1], /transition:\s*none\s*!important/);
    assert.ok(css.includes('[data-design="whitepaper"] .scroll-progress'), "whitepaper must hide the scroll progress bar");
  });
});

describe("design presets — worker whitelist", () => {
  it("allows the design key and pins the known preset values", () => {
    const allowed = workerSrc.match(/const ALLOWED = \[([^\]]*)\]/);
    assert.ok(allowed, "ALLOWED whitelist missing");
    assert.ok(allowed[1].includes('"design"'), "worker ALLOWED must include design");
    const designs = workerSrc.match(/const DESIGNS = \[([^\]]*)\]/);
    assert.ok(designs, "worker DESIGNS value whitelist missing");
    const values = [...designs[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(values, DESIGNS, "worker DESIGNS must match the template pills");
  });
});
