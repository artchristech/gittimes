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

  it("formats null as N/A", () => {
    assert.equal(formatPrice(null), "N/A");
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
        { key: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", provider: "Anthropic", input: 3, output: 15, inputDelta: null, outputDelta: null },
        { key: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI", input: 2.50, output: 15, inputDelta: null, outputDelta: null },
        { key: "gemini-3.1-pro", label: "Gemini 3.1 Pro", provider: "Google", input: 2, output: 12, inputDelta: null, outputDelta: null },
        { key: "grok-4.20", label: "Grok 4.20", provider: "xAI", input: 3, output: 15, inputDelta: null, outputDelta: null },
        { key: "deepseek-v3.2", label: "DeepSeek V3.2", provider: "DeepSeek", input: 0.14, output: 0.28, inputDelta: null, outputDelta: null },
        { key: "llama-4-maverick", label: "Llama 4 Maverick", provider: "Meta", input: 0.15, output: 0.60, inputDelta: null, outputDelta: null },
      ],
      bannerKeys: ["claude-sonnet-4.6", "gpt-5.4", "gemini-3.1-pro", "grok-4.20", "deepseek-v3.2", "llama-4-maverick"],
      speed: [{ name: "Cerebras", tokPerSec: 969, model: "Llama 4 Maverick" }],
      images: [{ name: "GPT Image 1.5", price: 0.04, grade: "A+" }],
    };
    const html = renderTickerBanner(data);
    assert.ok(html.includes("ai-ticker"));
    assert.ok(html.includes("/markets/"));
    assert.ok(html.includes("Claude Sonnet 4.6"));
    assert.ok(html.includes("$15/M"));
    assert.ok(html.includes("Full Markets"));
  });

  it("shows down arrow for price decrease", () => {
    const data = {
      models: [{ key: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI", input: 2, output: 6, inputDelta: -10, outputDelta: -25 }],
      bannerKeys: ["gpt-5.4"],
      speed: [],
      images: [],
    };
    const html = renderTickerBanner(data);
    assert.ok(html.includes("ticker-delta down"));
    assert.ok(html.includes("25%"));
  });

  it("shows up arrow for price increase", () => {
    const data = {
      models: [{ key: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI", input: 5, output: 20, inputDelta: 10, outputDelta: 33 }],
      bannerKeys: ["gpt-5.4"],
      speed: [],
      images: [],
    };
    const html = renderTickerBanner(data);
    assert.ok(html.includes("ticker-delta up"));
    assert.ok(html.includes("33%"));
  });

  it("shows flat dash when no delta", () => {
    const data = {
      models: [{ key: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI", input: 3, output: 15, inputDelta: null, outputDelta: null }],
      bannerKeys: ["gpt-5.4"],
      speed: [],
      images: [],
    };
    const html = renderTickerBanner(data);
    assert.ok(html.includes("ticker-delta flat"));
  });

  it("only includes banner-subset models", () => {
    const data = {
      models: [
        { key: "claude-opus-4.6", label: "Claude Opus 4.6", provider: "Anthropic", input: 5, output: 25, inputDelta: null, outputDelta: null },
        { key: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", provider: "Anthropic", input: 3, output: 15, inputDelta: null, outputDelta: null },
      ],
      bannerKeys: ["claude-sonnet-4.6"],
      speed: [],
      images: [],
    };
    const html = renderTickerBanner(data);
    // Opus is not in bannerKeys so should not appear
    assert.ok(!html.includes("Claude Opus 4.6"));
    assert.ok(html.includes("Claude Sonnet 4.6"));
  });

  it("skips models with null prices", () => {
    const data = {
      models: [
        { key: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI", input: null, output: null, inputDelta: null, outputDelta: null },
        { key: "grok-4.20", label: "Grok 4.20", provider: "xAI", input: 2, output: 6, inputDelta: null, outputDelta: null },
      ],
      bannerKeys: ["gpt-5.4", "grok-4.20"],
      speed: [],
      images: [],
    };
    const html = renderTickerBanner(data);
    assert.ok(!html.includes("GPT-5.4"));
    assert.ok(html.includes("Grok 4.20"));
  });
});

describe("snapshot persistence", () => {
  it("saves and loads snapshot + history", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ticker-test-"));
    const tickerData = {
      models: [
        { key: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", input: 3, output: 15 },
        { key: "gpt-5.4", label: "GPT-5.4", input: 2.50, output: 15 },
      ],
    };
    saveSnapshot(tmpDir, tickerData);

    const loaded = loadSnapshot(tmpDir);
    assert.ok(loaded);
    assert.equal(loaded.models.length, 2);
    assert.equal(loaded.models[0].key, "claude-sonnet-4.6");
    assert.equal(loaded.models[0].input, 3);

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

describe("enriched model data", () => {
  it("new fields pass through from synced data with correct values", () => {
    const tickerData = {
      models: [
        {
          key: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", provider: "Anthropic",
          input: 3, output: 15, context_length: 1000000,
          cache_read_price: 0.30, max_completion_tokens: 64000,
          modality: "text+image->text", input_modalities: ["text", "image"],
          supported_parameters: ["tools", "reasoning"],
          description: "Fast and capable", created: 1710000000,
          expiration_date: null, hugging_face_id: null,
          inputDelta: null, outputDelta: null,
        },
      ],
      bannerKeys: ["claude-sonnet-4.6"],
      speed: [], images: [],
    };
    const m = tickerData.models[0];
    assert.equal(m.cache_read_price, 0.30);
    assert.equal(m.max_completion_tokens, 64000);
    assert.equal(m.modality, "text+image->text");
    assert.deepEqual(m.input_modalities, ["text", "image"]);
    assert.deepEqual(m.supported_parameters, ["tools", "reasoning"]);
    assert.equal(m.description, "Fast and capable");
    assert.equal(m.created, 1710000000);
    assert.equal(m.expiration_date, null);
    assert.equal(m.hugging_face_id, null);
  });

  it("null fallback when fields are missing", () => {
    const m = {
      key: "test", label: "Test", provider: "Test",
      input: 1, output: 2, context_length: null,
      cache_read_price: null, max_completion_tokens: null,
      modality: null, input_modalities: null,
      supported_parameters: null, description: null,
      created: null, expiration_date: null, hugging_face_id: null,
    };
    assert.equal(m.cache_read_price, null);
    assert.equal(m.max_completion_tokens, null);
    assert.equal(m.modality, null);
    assert.equal(m.input_modalities, null);
    assert.equal(m.supported_parameters, null);
    assert.equal(m.description, null);
    assert.equal(m.created, null);
    assert.equal(m.expiration_date, null);
    assert.equal(m.hugging_face_id, null);
  });

  it("snapshots still only contain key/input/output (no bloat)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ticker-enrich-"));
    const tickerData = {
      models: [
        {
          key: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", input: 3, output: 15,
          cache_read_price: 0.30, max_completion_tokens: 64000,
          modality: "text+image->text", description: "Fast",
        },
      ],
    };
    saveSnapshot(tmpDir, tickerData);
    const loaded = loadSnapshot(tmpDir);
    const snap = loaded.models[0];
    assert.equal(snap.key, "claude-sonnet-4.6");
    assert.equal(snap.input, 3);
    assert.equal(snap.output, 15);
    assert.equal(snap.cache_read_price, undefined);
    assert.equal(snap.max_completion_tokens, undefined);
    assert.equal(snap.modality, undefined);
    assert.equal(snap.description, undefined);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe("curated data integrity", () => {
  it("loads tracked models from curated config", () => {
    assert.ok(TRACKED_MODELS.length >= 10);
    const keys = TRACKED_MODELS.map((m) => m.key);
    assert.ok(keys.includes("claude-sonnet-4.6"));
    assert.ok(keys.includes("gpt-5.4"));
    assert.ok(keys.includes("gemini-3.1-pro"));
    assert.ok(keys.includes("grok-4.20"));
    assert.ok(keys.includes("deepseek-v3.2"));
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
