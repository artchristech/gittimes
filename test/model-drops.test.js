const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { selectModelDrops, fetchModelDrops, TRUSTED_ORGS } = require("../src/model-drops");

const NOW = Date.parse("2026-07-01T00:00:00Z");
const iso = (d) => new Date(NOW - d * 86400000).toISOString();
const M = (id, likes, ageDays, extra = {}) => ({
  id,
  likes,
  downloads: extra.downloads ?? 0,
  createdAt: iso(ageDays),
  pipeline_tag: extra.tag ?? "text-generation",
  tags: extra.tags ?? [],
});

describe("selectModelDrops", () => {
  it("keeps recent high-traction drops, ranked biggest-first", () => {
    const out = selectModelDrops([M("acme/small", 90, 3), M("acme/big", 900, 5)], { nowMs: NOW });
    assert.deepEqual(out.map((d) => d.id), ["acme/big", "acme/small"]);
  });

  it("ranks a fresh drop above an older but more-liked one (velocity, not stock)", () => {
    // The core "band never updates" bug: a 13d-old 650-like model must NOT outrank
    // a 2d-old 200-like one. Freshness-decayed score, not raw likes.
    const out = selectModelDrops([M("acme/old-hit", 650, 13), M("acme/fresh", 200, 2)], {
      nowMs: NOW,
    });
    assert.deepEqual(out.map((d) => d.id), ["acme/fresh", "acme/old-hit"]);
  });

  it("excludes a non-trusted uncensored/roleplay finetune even when popular", () => {
    // The exact live offender: empero-ai/Qwythos-…-Claude-Mythos (uncensored finetune).
    const out = selectModelDrops(
      [M("empero-ai/Qwythos-Claude-Mythos", 650, 3, {
        tags: ["text-generation", "uncensored", "base_model:finetune:Qwen/Qwen3.5-9B"],
      })],
      { nowMs: NOW }
    );
    assert.equal(out.length, 0);
  });

  it("excludes a non-trusted community merge", () => {
    const out = selectModelDrops(
      [M("rando/frankenmerge", 400, 2, { tags: ["merge", "mergekit", "text-generation"] })],
      { nowMs: NOW }
    );
    assert.equal(out.length, 0);
  });

  it("keeps a trusted-lab instruct model even though it is tagged a finetune", () => {
    const out = selectModelDrops(
      [M("Qwen/Qwen3.5-9B-Instruct", 40, 2, {
        tags: ["text-generation", "base_model:finetune:Qwen/Qwen3.5-9B"],
      })],
      { nowMs: NOW }
    );
    assert.deepEqual(out.map((d) => d.id), ["Qwen/Qwen3.5-9B-Instruct"]);
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

describe("fetchModelDrops trusted-org lane", () => {
  // Mock HF: route by URL. `byUrl` maps a substring → rows; unmatched URLs get [].
  const mockFetch = (byUrl) => async (url) => ({
    ok: true,
    json: async () => {
      for (const [needle, rows] of Object.entries(byUrl)) {
        if (url.includes(needle)) return rows;
      }
      return [];
    },
  });

  it("queries a dedicated author lane for every trusted org", async () => {
    const seen = [];
    await fetchModelDrops({
      nowMs: NOW,
      fetchImpl: async (url) => { seen.push(url); return { ok: true, json: async () => [] }; },
    });
    for (const org of TRUSTED_ORGS) {
      assert.ok(
        seen.some((u) => u.includes(`author=${encodeURIComponent(org)}`) && u.includes("sort=createdAt")),
        `missing author lane for ${org}`
      );
    }
  });

  it("surfaces a day-one trusted drop that missed both global lanes (the Kimi K3 case)", async () => {
    const drops = await fetchModelDrops({
      nowMs: NOW,
      fetchImpl: mockFetch({
        "sort=likes7d": [M("acme/hot-thing", 500, 3)],
        "author=moonshotai": [M("moonshotai/Kimi-K3", 12, 0.5)],
      }),
    });
    assert.ok(drops.some((d) => d.id === "moonshotai/Kimi-K3"));
  });

  it("dedupes a model present in both a global lane and its org lane", async () => {
    const drops = await fetchModelDrops({
      nowMs: NOW,
      fetchImpl: mockFetch({
        "sort=likes7d": [M("moonshotai/Kimi-K3", 400, 1)],
        "author=moonshotai": [M("moonshotai/Kimi-K3", 400, 1)],
      }),
    });
    assert.equal(drops.filter((d) => d.id === "moonshotai/Kimi-K3").length, 1);
  });

  it("survives a failing org lane without losing the other lanes", async () => {
    const drops = await fetchModelDrops({
      nowMs: NOW,
      fetchImpl: async (url) => {
        if (url.includes("author=")) throw new Error("HF 500");
        return { ok: true, json: async () => [M("acme/fresh-hit", 300, 2)] };
      },
    });
    assert.deepEqual(drops.map((d) => d.id), ["acme/fresh-hit"]);
  });

  it("returns [] when every lane fails", async () => {
    const drops = await fetchModelDrops({
      nowMs: NOW,
      fetchImpl: async () => { throw new Error("network down"); },
    });
    assert.deepEqual(drops, []);
  });
});
