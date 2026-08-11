const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { closeDb, saveModelPrices, loadModelPrices } = require("../src/db");
const { applyPromos } = require("../src/sync-models");

let dataDir;

before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-prices-"));
});

after(() => {
  closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("applyPromos", () => {
  const rows = [
    { id: "anthropic/claude-sonnet-5", input: 2, output: 10, context_length: 200000 },
    { id: "openai/gpt-5.6-luna", input: 0.2, output: 1.2, context_length: 400000 },
  ];

  it("stamps list price and expiry onto a promoted model", () => {
    const out = applyPromos(rows, {
      "anthropic/claude-sonnet-5": {
        ends: "2026-08-31", list_input: 3, list_output: 15, source: "https://example.com/pricing",
      },
    });
    const sonnet = out.find((m) => m.id === "anthropic/claude-sonnet-5");
    assert.equal(sonnet.is_promotional, 1);
    assert.equal(sonnet.promo_ends_on, "2026-08-31");
    assert.equal(sonnet.list_input, 3);
    assert.equal(sonnet.list_output, 15);
    // The charged price is untouched — the promo is metadata, not a rewrite.
    assert.equal(sonnet.input, 2);
  });

  it("leaves unpromoted models alone", () => {
    const out = applyPromos(rows, { "anthropic/claude-sonnet-5": { ends: "2026-08-31" } });
    const luna = out.find((m) => m.id === "openai/gpt-5.6-luna");
    assert.equal(luna.is_promotional, undefined);
  });

  it("is a no-op with no promos configured", () => {
    assert.deepEqual(applyPromos(rows, undefined), rows);
    assert.deepEqual(applyPromos(rows, {}), rows);
  });
});

describe("model price tape", () => {
  it("writes and reads back a dated series oldest-first", () => {
    saveModelPrices(dataDir, "2026-08-01", [{ id: "a/m", provider: "a", input: 1, output: 2 }]);
    saveModelPrices(dataDir, "2026-08-02", [{ id: "a/m", provider: "a", input: 1, output: 3 }]);

    const series = loadModelPrices(dataDir, "a/m");
    assert.equal(series.length, 2);
    assert.equal(series[0].date, "2026-08-01");
    assert.equal(series[1].output, 3);
  });

  it("is idempotent per date — a republish overwrites, never duplicates", () => {
    saveModelPrices(dataDir, "2026-08-03", [{ id: "b/m", input: 5, output: 9 }]);
    saveModelPrices(dataDir, "2026-08-03", [{ id: "b/m", input: 5, output: 7 }]);

    const series = loadModelPrices(dataDir, "b/m");
    assert.equal(series.length, 1);
    assert.equal(series[0].output, 7);
  });

  it("derives provider from the model id when not supplied", () => {
    saveModelPrices(dataDir, "2026-08-04", [{ id: "anthropic/claude-sonnet-5", input: 2, output: 10 }]);
    assert.equal(loadModelPrices(dataDir, "anthropic/claude-sonnet-5")[0].provider, "anthropic");
  });

  it("stores a missing price as NULL, never 0", () => {
    saveModelPrices(dataDir, "2026-08-05", [{ id: "c/m", input: undefined, output: null }]);
    const row = loadModelPrices(dataDir, "c/m")[0];
    assert.equal(row.input, null);
    assert.equal(row.output, null);
  });

  it("keeps history — unlike repo_snapshots, the tape is never pruned", () => {
    for (let d = 1; d <= 20; d++) {
      const date = `2026-09-${String(d).padStart(2, "0")}`;
      saveModelPrices(dataDir, date, [{ id: "d/m", input: d, output: d * 2 }]);
    }
    assert.equal(loadModelPrices(dataDir, "d/m").length, 20);
  });

  it("carries the promo fields through to storage, so a reversion is not read as a hike", () => {
    saveModelPrices(dataDir, "2026-08-06", applyPromos(
      [{ id: "anthropic/claude-sonnet-5", input: 2, output: 10 }],
      { "anthropic/claude-sonnet-5": { ends: "2026-08-31", list_input: 3, list_output: 15 } }
    ));
    const row = loadModelPrices(dataDir, "anthropic/claude-sonnet-5").at(-1);
    assert.equal(row.is_promotional, 1);
    assert.equal(row.promo_ends_on, "2026-08-31");
    assert.equal(row.list_output, 15);
  });

  it("skips rows with no model id", () => {
    saveModelPrices(dataDir, "2026-08-07", [{ input: 1 }, { id: "e/m", input: 1, output: 2 }]);
    assert.equal(loadModelPrices(dataDir, "e/m").length, 1);
  });
});
