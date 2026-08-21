const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { saveModelPrices, loadPriceTape, closeDb } = require("../src/db");
const { buildPriceBoard, priceHeadline, DIR_PROMO_END } = require("../src/price-board");

let dataDir;
before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-tape-"));
});
after(() => {
  closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const row = (id, input, output, extra = {}) => ({ id, provider: id.split("/")[0], input, output, ...extra });

describe("price tape", () => {
  it("reads back in the shape the board consumes, keyed on the upstream id", () => {
    saveModelPrices(dataDir, "2026-07-18", [row("deepseek/deepseek-v4-pro", 0.5, 2)]);
    const tape = loadPriceTape(dataDir);
    assert.equal(tape.length, 1);
    assert.equal(tape[0].models[0].id, "deepseek/deepseek-v4-pro");
    assert.equal(tape[0].models[0].output, 2);
  });

  it("keeps history the ticker's rolling window would have deleted", () => {
    saveModelPrices(dataDir, "2025-01-02", [row("deepseek/deepseek-v4-pro", 0.9, 4)]);
    const tape = loadPriceTape(dataDir);
    assert.ok(tape.some((d) => d.date === "2025-01-02"));
    assert.equal(tape[tape.length - 1].date, "2025-01-02", "sorted newest-first");
  });

  it("survives the roster relabelling a model, because the id does not move", () => {
    // Our curated `key` is an editorial label; the id is assigned upstream.
    // Joining on the label is what breaks a series when the desk re-cuts it.
    const board = buildPriceBoard({
      models: [
        { key: "renamed-at-the-desk", label: "DeepSeek V4 Pro", openrouterId: "deepseek/deepseek-v4-pro", input: 0.19, output: 0.8 },
      ],
      history: loadPriceTape(dataDir),
      opts: { nowMs: Date.parse("2026-08-16T00:00:00Z") },
    });
    assert.equal(board.rows[0].noBaseline, false, "series must survive a relabel");
    assert.equal(board.rows[0].direction, "cut");
  });

  it("never joins a successor model to the one it replaced", () => {
    // claude-sonnet-4.6 and claude-sonnet-5 are different products at different
    // price points. Differencing them would manufacture a price move out of a
    // product launch — the single most dangerous error this desk could make.
    saveModelPrices(dataDir, "2026-08-01", [row("anthropic/claude-sonnet-4.6", 3, 15)]);
    const board = buildPriceBoard({
      models: [{ key: "claude-sonnet-5", label: "Claude Sonnet 5", openrouterId: "anthropic/claude-sonnet-5", input: 2, output: 10 }],
      history: loadPriceTape(dataDir),
      opts: { nowMs: Date.parse("2026-08-16T00:00:00Z") },
    });
    const row5 = board.rows.find((r) => r.key === "claude-sonnet-5");
    assert.equal(row5.noBaseline, true, "a new model starts a new series");
    assert.equal(board.movers.length, 0, "a product launch is not a price move");
  });
});

describe("promotional pricing", () => {
  it("does not report a lapsing introductory price as a price rise", () => {
    // Sonnet 5 ships at $2/$10 introductory and reverts to $3/$15 with no model
    // change. From two snapshots that is indistinguishable from a 50% hike.
    const history = [
      {
        // Inside the 30d window relative to nowMs below, and after MIN_BASELINE_DAYS.
        date: "2026-08-20",
        models: [row("anthropic/claude-sonnet-5", 2, 10, { isPromotional: true, promoEndsOn: "2026-08-31", listInput: 3, listOutput: 15 })],
      },
    ];
    const board = buildPriceBoard({
      models: [{ key: "claude-sonnet-5", label: "Claude Sonnet 5", openrouterId: "anthropic/claude-sonnet-5", input: 3, output: 15 }],
      history,
      opts: { nowMs: Date.parse("2026-09-02T00:00:00Z") },
    });
    const r = board.rows[0];
    assert.equal(r.direction, DIR_PROMO_END);
    assert.equal(r.promoLapsed, true);
    assert.equal(board.movers.length, 0, "a promo ending is not a lab decision to charge more");
    assert.equal(board.promoEndings.length, 1);
    assert.doesNotMatch(priceHeadline(board), /raised/);
  });

  it("still reports a genuine rise on a model that was never promotional", () => {
    const history = [{ date: "2026-07-18", models: [row("deepseek/deepseek-v4-pro", 0.5, 0.87)] }];
    const board = buildPriceBoard({
      models: [{ key: "deepseek-v4-pro", label: "DeepSeek V4 Pro", openrouterId: "deepseek/deepseek-v4-pro", input: 0.5, output: 1.3 }],
      history,
      opts: { nowMs: Date.parse("2026-08-16T00:00:00Z") },
    });
    assert.equal(board.rows[0].direction, "hike");
    assert.match(priceHeadline(board), /raised/);
  });

  it("still reports a cut on a model coming off promotion cheaper", () => {
    const history = [
      { date: "2026-07-18", models: [row("x/y", 2, 10, { isPromotional: true })] },
    ];
    const board = buildPriceBoard({
      models: [{ key: "y", label: "Y", openrouterId: "x/y", input: 1, output: 5 }],
      history,
      opts: { nowMs: Date.parse("2026-08-16T00:00:00Z") },
    });
    assert.equal(board.rows[0].direction, "cut", "a promo guard must not swallow real cuts");
  });
});
