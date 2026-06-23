const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  renderModalityBadges,
  renderFeatureBadges,
  renderSunsetWatch,
  renderNewModelsSection,
  renderRadarSection,
  renderEvalsSection,
  renderValueScatter,
  buildFreshness,
  compositeQuality,
  monthlyCost,
  timeAgo,
} = require("../src/markets");
const { buildCatalog } = require("../src/sync-models");

describe("monthlyCost", () => {
  it("computes a mixed cachedPct case to an exact dollar value", () => {
    // 1M in/day, 0.5M out/day, input $5/M, output $15/M, cache $0.50/M, 40% cached.
    // daily = 1*0.4*0.5 + 1*0.6*5 + 0.5*15 = 0.2 + 3 + 7.5 = 10.7 ; *30 = 321
    const c = monthlyCost({ inM: 1, outM: 0.5, input: 5, output: 15, cache: 0.5, cachedPct: 40 });
    assert.equal(c, 321);
  });
  it("cachedPct 0 bills all input at the input price", () => {
    // daily = 2*10 + 1*30 = 50 ; *30 = 1500
    const c = monthlyCost({ inM: 2, outM: 1, input: 10, output: 30, cache: 1, cachedPct: 0 });
    assert.equal(c, 1500);
  });
  it("cachedPct 100 bills all input at the cache price", () => {
    // daily = 2*0.5 + 1*30 = 31 ; *30 = 930
    const c = monthlyCost({ inM: 2, outM: 1, input: 10, output: 30, cache: 0.5, cachedPct: 100 });
    assert.equal(c, 930);
  });
  it("falls back to input price when cache is null", () => {
    // null cache => cached fraction billed at input. 50% cached so identical to input-priced.
    const withNull = monthlyCost({ inM: 2, outM: 1, input: 10, output: 30, cache: null, cachedPct: 50 });
    const allInput = monthlyCost({ inM: 2, outM: 1, input: 10, output: 30, cache: 10, cachedPct: 50 });
    assert.equal(withNull, allInput);
    // daily = 2*10 + 1*30 = 50 ; *30 = 1500
    assert.equal(withNull, 1500);
  });
});

const EVAL_METRICS = [
  { key: "mmlu_pro", label: "MMLU-Pro", unit: "%", max: 100 },
  { key: "arena_elo", label: "Arena Elo", unit: "", max: 1500 },
];
const SAMPLE_EVALS = {
  asOf: "2026-06-15",
  note: "Editorially curated.",
  sources: [{ label: "LMArena", url: "https://lmarena.ai" }],
  metrics: EVAL_METRICS,
  models: {
    a: { mmlu_pro: 90, arena_elo: 1500 },
    b: { mmlu_pro: 60, arena_elo: 1200 },
  },
};
const SAMPLE_TICKER = {
  models: [
    { key: "a", label: "Model A", provider: "Acme", output: 10 },
    { key: "b", label: "Model B", provider: "Beta", output: 2 },
    { key: "c", label: "Model C", provider: "Gamma", output: 5 },
  ],
  evals: SAMPLE_EVALS,
  syncedAt: new Date().toISOString(),
};

describe("compositeQuality", () => {
  it("normalizes each metric against its own max and averages", () => {
    // mmlu 90/100=90, elo 1500/1500=100 -> mean 95
    assert.equal(compositeQuality({ mmlu_pro: 90, arena_elo: 1500 }, EVAL_METRICS), 95);
  });
  it("returns null when no eval data", () => {
    assert.equal(compositeQuality(null, EVAL_METRICS), null);
    assert.equal(compositeQuality({}, EVAL_METRICS), null);
  });
});

describe("renderEvalsSection", () => {
  it("renders curated evals labeled with as-of date and source", () => {
    const html = renderEvalsSection(SAMPLE_TICKER);
    assert.ok(html.includes("Model Evals"));
    assert.ok(html.includes("Curated · as of 2026-06-15"));
    assert.ok(html.includes("LMArena"));
    assert.ok(html.includes("Model A"));
    // highest composite ranks first
    assert.ok(html.indexOf("Model A") < html.indexOf("Model B"));
  });
  it("returns empty string with no eval data", () => {
    assert.equal(renderEvalsSection({ models: [], evals: null }), "");
  });
});

describe("renderValueScatter", () => {
  it("renders a scatter and marks a best-value model", () => {
    const html = renderValueScatter(SAMPLE_TICKER);
    assert.ok(html.includes("The Value Frontier"));
    assert.ok(html.includes("value-scatter"));
    // Model B: quality (60/100+1200/1500)/2=70, price 2 -> 35/$ beats A (95/10=9.5)
    assert.ok(html.includes("Best value: <strong>Model B</strong>") || html.includes("best value: <strong>Model B"));
  });
});

describe("buildFreshness", () => {
  it("shows live pricing and curated evals chips", () => {
    const html = buildFreshness(SAMPLE_TICKER);
    assert.ok(html.includes("Pricing live"));
    assert.ok(html.includes("Evals curated"));
    assert.ok(html.includes("2026-06-15"));
  });
  it("flags stale pricing when syncedAt is old", () => {
    const old = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
    const html = buildFreshness({ ...SAMPLE_TICKER, syncedAt: old });
    assert.ok(html.includes("Pricing stale"));
  });
  it("handles missing syncedAt", () => {
    const html = buildFreshness({ evals: null, syncedAt: null });
    assert.ok(html.includes("Pricing unavailable"));
  });
});

describe("renderRadarSection", () => {
  it("renders auto-detected untracked frontier models", () => {
    const html = renderRadarSection([
      { id: "openai/gpt-5.5-pro", name: "OpenAI: GPT-5.5 Pro", outputPrice: 180, created: Math.floor(Date.now() / 1000) },
    ]);
    assert.ok(html.includes("On Our Radar"));
    assert.ok(html.includes("GPT-5.5 Pro"));
    assert.ok(html.includes("openai"));
  });
  it("returns empty string when nothing untracked", () => {
    assert.equal(renderRadarSection([]), "");
    assert.equal(renderRadarSection(null), "");
  });
});

describe("buildCatalog (sync persists full catalog)", () => {
  it("includes every priced model, sorted by output desc", () => {
    const raw = [
      { id: "a/cheap", name: "Cheap", pricing: { prompt: "0.000001", completion: "0.000002" }, context_length: 8000 },
      { id: "b/pricey", name: "Pricey", pricing: { prompt: "0.00001", completion: "0.00005" } },
      { id: "c/free", name: "Free", pricing: { prompt: "0", completion: "0" } },
    ];
    const cat = buildCatalog(raw);
    assert.equal(cat.length, 2, "free (prompt=0) model is excluded");
    assert.equal(cat[0].name, "Pricey", "sorted by output price desc");
    assert.equal(cat[0].output, 50);
    assert.equal(cat[1].input, 1);
  });
});

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
