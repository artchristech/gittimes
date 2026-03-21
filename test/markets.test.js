const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  renderModalityBadges,
  renderFeatureBadges,
  renderSunsetWatch,
  renderNewModelsSection,
  timeAgo,
} = require("../src/markets");

describe("renderModalityBadges", () => {
  it("renders badges for multimodal input", () => {
    const html = renderModalityBadges(["text", "image", "audio"]);
    assert.ok(html.includes("modality-badge"));
    assert.ok(html.includes("img"));
    assert.ok(html.includes("aud"));
    assert.ok(!html.includes(">text<"));
  });

  it("returns empty string for text-only", () => {
    assert.equal(renderModalityBadges(["text"]), "");
  });

  it("returns empty string for null", () => {
    assert.equal(renderModalityBadges(null), "");
  });

  it("returns empty string for undefined", () => {
    assert.equal(renderModalityBadges(undefined), "");
  });
});

describe("renderFeatureBadges", () => {
  it("renders for tools and reasoning", () => {
    const html = renderFeatureBadges(["tools", "reasoning", "temperature"]);
    assert.ok(html.includes("feature-badge"));
    assert.ok(html.includes("tools"));
    assert.ok(html.includes("reasoning"));
    assert.ok(!html.includes("temperature"));
  });

  it("renders structured_output as 'structured'", () => {
    const html = renderFeatureBadges(["structured_output"]);
    assert.ok(html.includes("structured"));
  });

  it("returns empty string for empty array", () => {
    assert.equal(renderFeatureBadges([]), "");
  });

  it("returns empty string for null", () => {
    assert.equal(renderFeatureBadges(null), "");
  });

  it("returns empty string when no high-signal features present", () => {
    assert.equal(renderFeatureBadges(["temperature", "top_p"]), "");
  });
});

describe("renderSunsetWatch", () => {
  it("renders when models are expiring", () => {
    const models = [
      { label: "GPT-4", expiration_date: Math.floor(Date.now() / 1000) + 86400 * 30 },
      { label: "Claude 3", expiration_date: null },
    ];
    const html = renderSunsetWatch(models);
    assert.ok(html.includes("Sunset Watch"));
    assert.ok(html.includes("GPT-4"));
    assert.ok(!html.includes("Claude 3"));
  });

  it("returns empty string when no models expiring", () => {
    const models = [
      { label: "GPT-4", expiration_date: null },
      { label: "Claude 3", expiration_date: null },
    ];
    assert.equal(renderSunsetWatch(models), "");
  });

  it("returns empty string for empty array", () => {
    assert.equal(renderSunsetWatch([]), "");
  });
});

describe("renderNewModelsSection", () => {
  it("renders for recent models", () => {
    const now = Math.floor(Date.now() / 1000);
    const tickerData = {
      models: [
        { label: "New Model", provider: "Acme", output: 10, created: now - 86400 * 5 },
        { label: "Old Model", provider: "Acme", output: 5, created: now - 86400 * 60 },
      ],
      speed: [], images: [],
    };
    const html = renderNewModelsSection(tickerData, null);
    assert.ok(html.includes("New on the Market"));
    assert.ok(html.includes("New Model"));
    assert.ok(!html.includes("Old Model"));
  });

  it("returns empty string when no recent models", () => {
    const now = Math.floor(Date.now() / 1000);
    const tickerData = {
      models: [
        { label: "Old Model", provider: "Acme", output: 5, created: now - 86400 * 60 },
      ],
      speed: [], images: [],
    };
    assert.equal(renderNewModelsSection(tickerData, null), "");
  });

  it("returns empty string when no created timestamps", () => {
    const tickerData = {
      models: [
        { label: "Model", provider: "Acme", output: 5, created: null },
      ],
      speed: [], images: [],
    };
    assert.equal(renderNewModelsSection(tickerData, null), "");
  });

  it("limits to 8 entries", () => {
    const now = Math.floor(Date.now() / 1000);
    const models = Array.from({ length: 12 }, (_, i) => ({
      label: `Model ${i}`, provider: "Acme", output: 10, created: now - 86400 * i,
    }));
    const tickerData = { models, speed: [], images: [] };
    const html = renderNewModelsSection(tickerData, null);
    const rowCount = (html.match(/<tr>/g) || []).length;
    // 8 data rows (thead row uses <tr> too but we count tbody rows)
    assert.ok(rowCount <= 9); // 1 thead + 8 tbody
  });
});

describe("timeAgo", () => {
  it("returns 'today' for current timestamp", () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(timeAgo(now), "today");
  });

  it("returns days ago", () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(timeAgo(now - 86400 * 3), "3d ago");
  });

  it("returns weeks ago", () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(timeAgo(now - 86400 * 14), "2w ago");
  });

  it("returns empty string for null", () => {
    assert.equal(timeAgo(null), "");
  });
});
