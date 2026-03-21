const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { extractEditionData, generatePromoHtml, generateEditionPromo } = require("../src/promo");

// Minimal edition HTML that matches the structure of a real published edition
const MOCK_EDITION = `<!DOCTYPE html>
<html lang="en">
<head><title>The Git Times — Tuesday, March 10, 2026</title></head>
<body>
<header class="masthead">
  <p class="masthead-tagline">\u201CSomething profound\u201D \u2014 Famous Person</p>
</header>
<div class="section-panel active" data-section="frontPage">
  <article class="lead-story">
    <h2 class="lead-headline">Big Front Page Story</h2>
    <p class="lead-subheadline">This is the subheadline of the lead.</p>
    <div class="lead-meta">
      <span><a href="https://github.com/org/repo" target="_blank">org/repo</a></span>
      <span>Rust</span>
      <span>5k stars</span>
    </div>
  </article>
</div>
<div class="section-panel" data-section="ai">
  <h2 class="lead-headline">AI Section Lead Story</h2>
</div>
<div class="section-panel" data-section="robotics">
  <h2 class="lead-headline">Robotics Section Lead</h2>
</div>
<div class="section-panel" data-section="cyber">
  <h2 class="lead-headline">Cyber Section Lead</h2>
</div>
<div class="section-panel" data-section="systems">
  <h2 class="lead-headline">Systems Section Lead</h2>
</div>
<div class="section-panel" data-section="diy">
  <h2 class="lead-headline">DIY Section Lead</h2>
</div>
<div class="section-panel" data-section="gameDev">
  <h2 class="lead-headline">GameDev Section Lead</h2>
</div>
<footer class="footer"></footer>
</body>
</html>`;

describe("extractEditionData", () => {
  it("extracts date from title", () => {
    const data = extractEditionData(MOCK_EDITION);
    assert.equal(data.date, "Tuesday, March 10, 2026");
  });

  it("extracts tagline", () => {
    const data = extractEditionData(MOCK_EDITION);
    assert.ok(data.tagline.includes("Something profound"));
  });

  it("extracts lead headline and subheadline", () => {
    const data = extractEditionData(MOCK_EDITION);
    assert.equal(data.lead.headline, "Big Front Page Story");
    assert.equal(data.lead.sub, "This is the subheadline of the lead.");
  });

  it("extracts lead repo", () => {
    const data = extractEditionData(MOCK_EDITION);
    assert.equal(data.lead.repo, "org/repo");
  });

  it("extracts section headlines excluding frontPage", () => {
    const data = extractEditionData(MOCK_EDITION);
    assert.equal(data.sections.length, 6);
    const labels = data.sections.map((s) => s.label);
    assert.ok(labels.includes("AI"));
    assert.ok(labels.includes("Robotics"));
    assert.ok(labels.includes("Cyber"));
    assert.ok(labels.includes("Systems"));
    assert.ok(labels.includes("DIY"));
    assert.ok(!labels.includes("Front Page"));
    assert.ok(!labels.includes("Memes"));
  });
});

describe("generatePromoHtml", () => {
  it("generates valid HTML with all sections", () => {
    const data = extractEditionData(MOCK_EDITION);
    const html = generatePromoHtml(data);
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("Big Front Page Story"));
    assert.ok(html.includes("AI Section Lead Story"));
    assert.ok(html.includes("gsap.timeline"));
    assert.ok(html.includes("gittimes.com"));
  });

  it("includes quote text and attribution", () => {
    const data = extractEditionData(MOCK_EDITION);
    const html = generatePromoHtml(data);
    assert.ok(html.includes("Something profound"));
    assert.ok(html.includes("Famous Person"));
  });

  it("includes repo display", () => {
    const data = extractEditionData(MOCK_EDITION);
    const html = generatePromoHtml(data);
    assert.ok(html.includes("github.com/org/repo"));
  });
});

describe("generateEditionPromo", () => {
  it("generates promo file from edition on disk", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "promo-test-"));
    const editionDir = path.join(tmpDir, "editions", "2026-03-10");
    fs.mkdirSync(editionDir, { recursive: true });
    fs.writeFileSync(path.join(editionDir, "index.html"), MOCK_EDITION);

    const result = await generateEditionPromo(tmpDir, "2026-03-10");
    assert.ok(result);
    assert.equal(result.dateStr, "2026-03-10");
    assert.ok(fs.existsSync(result.promoPath));

    const promoHtml = fs.readFileSync(result.promoPath, "utf-8");
    assert.ok(promoHtml.includes("Big Front Page Story"));

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns null when no edition exists locally", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "promo-test-"));
    // Uses a far-future date that won't exist on gittimes.com either
    const result = await generateEditionPromo(tmpDir, "2099-01-01");
    assert.equal(result, null);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
