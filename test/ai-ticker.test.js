const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  renderTickerBanner,
  formatPrice,
  formatTokPerSec,
  saveSnapshot,
  loadSnapshot,
  loadHistory,
  TRACKED_MODELS,
  TICKER_BANNER_KEYS,
  SPEED_DATA,
  IMAGE_DATA,
} = require("../src/ai-ticker");

describe("formatPrice", () => {
  it("formats whole dollar amounts", () => {
    assert.equal(formatPrice(3), "$3");
    assert.equal(formatPrice(15), "$15");
  });

  it("formats fractional dollar amounts", () => {
    assert.equal(formatPrice(1.25), "$1.25");
    assert.equal(formatPrice(2.50), "$2.50");
  });

  it("formats cent amounts", () => {
    assert.equal(formatPrice(0.08), "$0.08");
    assert.equal(formatPrice(0.04), "$0.04");
  });

  it("formats sub-cent amounts", () => {
    assert.equal(formatPrice(0.003), "$0.003");
  });

  it("formats zero", () => {
    assert.equal(formatPrice(0), "$0");
  });
});

describe("formatTokPerSec", () => {
  it("formats thousands with k suffix", () => {
    assert.equal(formatTokPerSec(2200), "2.2k");
    assert.equal(formatTokPerSec(1000), "1k");
  });

  it("formats sub-thousand as-is", () => {
    assert.equal(formatTokPerSec(750), "750");
    assert.equal(formatTokPerSec(220), "220");
  });
});

describe("renderTickerBanner", () => {
  it("returns empty string for null data", () => {
    assert.equal(renderTickerBanner(null), "");
  });

  it("renders banner models with link to markets", () => {
    const data = {
      models: [
        { key: "claude-sonnet", label: "Claude Sonnet", provider: "Anthropic", input: 3, output: 15, inputDelta: null, outputDelta: null },
        { key: "gpt-4.1", label: "GPT-4.1", provider: "OpenAI", input: 2, output: 8, inputDelta: null, outputDelta: null },
        { key: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google", input: 1.25, output: 10, inputDelta: null, outputDelta: null },
        { key: "grok-3", label: "Grok 3", provider: "xAI", input: 3, output: 15, inputDelta: null, outputDelta: null },
        { key: "deepseek-v3", label: "DeepSeek V3", provider: "DeepSeek", input: 0.27, output: 1.10, inputDelta: null, outputDelta: null },
        { key: "llama-4-maverick", label: "Llama 4 Maverick", provider: "Meta", input: 0.20, output: 0.60, inputDelta: null, outputDelta: null },
      ],
      speed: [{ name: "Cerebras", tokPerSec: 2200, model: "Llama 70B" }],
      images: [{ name: "DALL-E 3", price: 0.08, grade: "A" }],
    };
    const html = renderTickerBanner(data);
    assert.ok(html.includes("ai-ticker"));
    assert.ok(html.includes("/markets/"));
    assert.ok(html.includes("Claude Sonnet"));
    assert.ok(html.includes("$15/M"));
    assert.ok(html.includes("Full Markets"));
  });

  it("shows down arrow for price decrease", () => {
    const data = {
      models: [{ key: "gpt-4.1", label: "GPT-4.1", provider: "OpenAI", input: 2, output: 6, inputDelta: -10, outputDelta: -25 }],
      speed: [],
      images: [],
    };
    const html = renderTickerBanner(data);
    assert.ok(html.includes("ticker-delta down"));
    assert.ok(html.includes("25%"));
  });

  it("shows up arrow for price increase", () => {
    const data = {
      models: [{ key: "gpt-4.1", label: "GPT-4.1", provider: "OpenAI", input: 5, output: 20, inputDelta: 10, outputDelta: 33 }],
      speed: [],
      images: [],
    };
    const html = renderTickerBanner(data);
    assert.ok(html.includes("ticker-delta up"));
    assert.ok(html.includes("33%"));
  });

  it("shows flat dash when no delta", () => {
    const data = {
      models: [{ key: "gpt-4.1", label: "GPT-4.1", provider: "OpenAI", input: 3, output: 15, inputDelta: null, outputDelta: null }],
      speed: [],
      images: [],
    };
    const html = renderTickerBanner(data);
    assert.ok(html.includes("ticker-delta flat"));
  });

  it("only includes banner-subset models", () => {
    const data = {
      models: [
        { key: "claude-opus", label: "Claude Opus", provider: "Anthropic", input: 15, output: 75, inputDelta: null, outputDelta: null },
        { key: "claude-sonnet", label: "Claude Sonnet", provider: "Anthropic", input: 3, output: 15, inputDelta: null, outputDelta: null },
      ],
      speed: [],
      images: [],
    };
    const html = renderTickerBanner(data);
    // Opus is not in TICKER_BANNER_KEYS so should not appear
    assert.ok(!html.includes("Claude Opus"));
    assert.ok(html.includes("Claude Sonnet"));
  });
});

describe("snapshot persistence", () => {
  it("saves and loads snapshot + history", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ticker-test-"));
    const tickerData = {
      models: [
        { key: "claude-sonnet", label: "Claude Sonnet", input: 3, output: 15 },
        { key: "gpt-4.1", label: "GPT-4.1", input: 2, output: 8 },
      ],
    };
    saveSnapshot(tmpDir, tickerData);

    // Legacy snapshot still works
    const loaded = loadSnapshot(tmpDir);
    assert.ok(loaded);
    assert.equal(loaded.models.length, 2);
    assert.equal(loaded.models[0].key, "claude-sonnet");
    assert.equal(loaded.models[0].input, 3);

    // History also saved
    const history = loadHistory(tmpDir);
    assert.ok(history.length >= 1);
    assert.equal(history[0].models.length, 2);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns null for missing snapshot", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ticker-test-"));
    const loaded = loadSnapshot(tmpDir);
    assert.equal(loaded, null);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns empty array for missing history", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ticker-test-"));
    const history = loadHistory(tmpDir);
    assert.deepEqual(history, []);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe("curated data integrity", () => {
  it("has expanded tracked models with providers", () => {
    assert.ok(TRACKED_MODELS.length >= 10);
    const keys = TRACKED_MODELS.map((m) => m.key);
    assert.ok(keys.includes("claude-sonnet"));
    assert.ok(keys.includes("gpt-4.1"));
    assert.ok(keys.includes("gemini-2.5-pro"));
    assert.ok(keys.includes("grok-3"));
    assert.ok(keys.includes("deepseek-v3"));
    // All models have provider field
    for (const m of TRACKED_MODELS) {
      assert.ok(m.provider, `${m.key} missing provider`);
    }
  });

  it("has banner keys that are subset of tracked models", () => {
    const trackedKeys = TRACKED_MODELS.map((m) => m.key);
    for (const key of TICKER_BANNER_KEYS) {
      assert.ok(trackedKeys.includes(key), `Banner key ${key} not in TRACKED_MODELS`);
    }
  });

  it("has speed data with tok/s values", () => {
    assert.ok(SPEED_DATA.length >= 3);
    for (const s of SPEED_DATA) {
      assert.ok(s.name);
      assert.ok(s.tokPerSec > 0);
    }
  });

  it("has image data with prices and grades", () => {
    assert.ok(IMAGE_DATA.length >= 3);
    for (const img of IMAGE_DATA) {
      assert.ok(img.name);
      assert.ok(img.price >= 0);
      assert.ok(img.grade);
    }
  });
});
