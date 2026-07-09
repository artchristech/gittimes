const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { buildTrackedModels } = require("../src/sync-models");

// These tests exercise the editorial curated-seed fallback WITHOUT any network:
// buildTrackedModels is pure — it takes a catalog array, the curated config, and
// the previous sync's output, and computes the model rows from those alone.
describe("buildTrackedModels — curated seed fallback", () => {
  const curated = {
    trackedModels: [
      { key: "qwen3-max", openrouterId: "qwen/qwen3-max", label: "Qwen3 Max", provider: "Alibaba", input: 0.30, output: 1.20 },
      { key: "kimi-k2", openrouterId: "moonshotai/kimi-k2", label: "Kimi K2", provider: "Moonshot", input: 0.55, output: 2.50 },
    ],
  };

  it("seeds price from curated config when a model is absent from the catalog and has no previous value", () => {
    // Empty catalog (as if OpenRouter lacks these fictional-2026 models) + no prior sync.
    const { models, matched, missed } = buildTrackedModels([], curated, null);
    const q = models.find((m) => m.key === "qwen3-max");
    const k = models.find((m) => m.key === "kimi-k2");

    assert.equal(q.output, 1.20, "Qwen seed output must render (non-null)");
    assert.equal(q.input, 0.30);
    assert.equal(q.source, "curated-seed");
    assert.equal(k.output, 2.50, "Kimi seed output must render (non-null)");
    assert.equal(k.input, 0.55);
    assert.equal(k.source, "curated-seed");
    assert.equal(matched, 0);
    assert.equal(missed, 2);
  });

  it("does NOT let the curated seed override a live OpenRouter price", () => {
    const catalog = [
      { id: "qwen/qwen3-max", pricing: { prompt: "0.000002", completion: "0.000009" }, context_length: 262144 },
    ];
    const { models } = buildTrackedModels(catalog, curated, null);
    const q = models.find((m) => m.key === "qwen3-max");
    assert.equal(q.output, 9, "live 0.000009*1e6 must win over seed 1.20");
    assert.equal(q.input, 2, "live 0.000002*1e6 must win over seed 0.30");
    assert.equal(q.source, "openrouter");
  });

  it("does NOT let the curated seed override a previous-sync price", () => {
    const existing = { models: [{ key: "kimi-k2", input: 0.6, output: 3.0 }] };
    const { models } = buildTrackedModels([], curated, existing);
    const k = models.find((m) => m.key === "kimi-k2");
    assert.equal(k.output, 3.0, "previous-sync 3.0 must win over seed 2.50");
    assert.equal(k.input, 0.6);
    assert.equal(k.source, "previous-sync");
  });

  it("yields a null price (not a crash) when there is no catalog match, no previous, and no seed", () => {
    const noSeed = { trackedModels: [{ key: "ghost", openrouterId: "ghost/none", label: "Ghost", provider: "None" }] };
    const { models, missed } = buildTrackedModels([], noSeed, null);
    assert.equal(models[0].output, null);
    assert.equal(models[0].input, null);
    assert.equal(models[0].source, "missing");
    assert.equal(missed, 1);
  });
});
