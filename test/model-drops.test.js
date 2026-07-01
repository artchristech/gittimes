const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { selectModelDrops } = require("../src/model-drops");

const NOW = Date.parse("2026-07-01T00:00:00Z");
const iso = (d) => new Date(NOW - d * 86400000).toISOString();
const M = (id, likes, ageDays, extra = {}) => ({
  id,
  likes,
  downloads: extra.downloads ?? 0,
  createdAt: iso(ageDays),
  pipeline_tag: extra.tag ?? "text-generation",
});

describe("selectModelDrops", () => {
  it("keeps recent high-traction drops, ranked biggest-first", () => {
    const out = selectModelDrops([M("acme/small", 90, 3), M("acme/big", 900, 5)], { nowMs: NOW });
    assert.deepEqual(out.map((d) => d.id), ["acme/big", "acme/small"]);
  });

  it("drops a model created outside the window even if hot", () => {
    const out = selectModelDrops([M("acme/old", 5000, 30)], { nowMs: NOW, windowDays: 14 });
    assert.equal(out.length, 0);
  });

  it("drops a low-traction, non-trusted model", () => {
    const out = selectModelDrops([M("rando/finetune", 3, 1)], { nowMs: NOW, minLikes: 80 });
    assert.equal(out.length, 0);
  });

  it("includes a fresh trusted-lab drop even with almost no likes", () => {
    const out = selectModelDrops([M("Qwen/Qwen9-Next", 2, 1)], { nowMs: NOW, minLikes: 80 });
    assert.equal(out.length, 1);
    assert.equal(out[0].author, "Qwen");
  });

  it("excludes a community quantization re-host but keeps a trusted one", () => {
    const out = selectModelDrops(
      [M("bloke/Something-GGUF", 500, 2), M("Qwen/Qwen9-GGUF", 5, 2)],
      { nowMs: NOW }
    );
    assert.deepEqual(out.map((d) => d.id), ["Qwen/Qwen9-GGUF"]);
  });

  it("dedupes by id", () => {
    const out = selectModelDrops([M("acme/x", 100, 1), M("acme/x", 100, 1)], { nowMs: NOW });
    assert.equal(out.length, 1);
  });

  it("normalizes fields and builds a hf url", () => {
    const out = selectModelDrops(
      [M("acme/rag-model", 200, 4, { downloads: 1234, tag: "text-generation" })],
      { nowMs: NOW }
    );
    const d = out[0];
    assert.equal(d.url, "https://huggingface.co/acme/rag-model");
    assert.equal(d.author, "acme");
    assert.equal(d.name, "rag-model");
    assert.equal(d.task, "text-generation");
    assert.equal(d.downloads, 1234);
    assert.equal(d.ageDays, 4);
  });

  it("returns [] for junk input", () => {
    assert.deepEqual(selectModelDrops(null), []);
    assert.deepEqual(selectModelDrops([{}, { id: 123 }, { id: "no-slash" }], { nowMs: NOW }), []);
  });

  it("respects limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => M(`acme/m${i}`, 100 + i, 1));
    assert.equal(selectModelDrops(many, { nowMs: NOW, limit: 3 }).length, 3);
  });
});
