const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { buildPriceBoard, priceHeadline, pickBaseline, DIR_CUT, DIR_HIKE, DIR_FLAT, DIR_UNKNOWN } = require("../src/price-board");
const { renderPriceBoardPage } = require("../src/business-pages");
const { buildBusinessStrip, buildBusinessDesks } = require("../src/desks");

const NOW = Date.parse("2026-08-16T00:00:00Z");
const day = (d) => new Date(NOW - d * 86400000).toISOString().slice(0, 10);

const model = (key, input, output, extra = {}) => ({
  key,
  label: extra.label || key,
  provider: extra.provider || "Acme",
  openrouterId: extra.openrouterId || `acme/${key}`,
  input,
  output,
});

const snap = (ageDays, models) => ({ date: day(ageDays), models });

describe("pickBaseline", () => {
  it("takes the oldest snapshot inside the window", () => {
    const history = [snap(2, []), snap(10, []), snap(28, []), snap(45, [])];
    assert.equal(pickBaseline(history, 30, NOW).date, day(28));
  });

  it("ignores same-week snapshots — that is churn, not a trend", () => {
    assert.equal(pickBaseline([snap(1, []), snap(2, [])], 30, NOW), null);
  });

  it("returns null when history is empty or absent", () => {
    assert.equal(pickBaseline([], 30, NOW), null);
    assert.equal(pickBaseline(null, 30, NOW), null);
  });
});

describe("buildPriceBoard", () => {
  const history = [
    snap(20, [
      { key: "deepseek-v4", input: 0.5, output: 2 },
      { key: "gpt-5.5", input: 2, output: 10 },
      { key: "steady", input: 1, output: 4 },
    ]),
  ];
  const models = [
    model("deepseek-v4", 0.19, 0.8, { provider: "DeepSeek", openrouterId: "deepseek/deepseek-v4" }),
    model("gpt-5.5", 2.5, 12, { provider: "OpenAI", openrouterId: "openai/gpt-5.5" }),
    model("steady", 1, 4.01, { provider: "Acme" }),
    model("brand-new", 3, 15, { provider: "Mistral", openrouterId: "mistralai/brand-new" }),
  ];

  it("computes the move against the baseline and names the direction", () => {
    const board = buildPriceBoard({ models, history, opts: { nowMs: NOW } });
    const ds = board.rows.find((r) => r.key === "deepseek-v4");
    assert.equal(ds.direction, DIR_CUT);
    assert.equal(Math.round(ds.movePct), -60);
    const oa = board.rows.find((r) => r.key === "gpt-5.5");
    assert.equal(oa.direction, DIR_HIKE);
    assert.equal(Math.round(oa.movePct), 20);
  });

  it("calls a sub-1% wobble flat rather than a move", () => {
    const board = buildPriceBoard({ models, history, opts: { nowMs: NOW } });
    assert.equal(board.rows.find((r) => r.key === "steady").direction, DIR_FLAT);
  });

  it("reports a model with no baseline as unknown, never as unchanged", () => {
    // The price-desk version of calling a lab quiet because nobody was watching.
    const board = buildPriceBoard({ models, history, opts: { nowMs: NOW } });
    const fresh = board.rows.find((r) => r.key === "brand-new");
    assert.equal(fresh.noBaseline, true);
    assert.equal(fresh.movePct, null);
    assert.equal(fresh.direction, DIR_UNKNOWN);
  });

  it("ranks biggest movers first and sinks unbaselined rows", () => {
    const board = buildPriceBoard({ models, history, opts: { nowMs: NOW } });
    assert.equal(board.rows[0].key, "deepseek-v4");
    assert.equal(board.rows[board.rows.length - 1].key, "brand-new");
  });

  it("attributes each model to a registry company so a move lands on its file", () => {
    const board = buildPriceBoard({ models, history, opts: { nowMs: NOW } });
    assert.equal(board.rows.find((r) => r.key === "deepseek-v4").entityId, "deepseek");
    assert.equal(board.rows.find((r) => r.key === "gpt-5.5").entityId, "openai");
    assert.equal(board.rows.find((r) => r.key === "steady").entityId, null);
  });

  it("carries the source and the baseline date as evidence", () => {
    const board = buildPriceBoard({ models, history, opts: { nowMs: NOW } });
    assert.match(board.rows[0].evidence.source, /openrouter/);
    assert.equal(board.rows[0].evidence.baselineDate, day(20));
    assert.equal(board.baselineDate, day(20));
    assert.equal(board.covered, 3);
    assert.equal(board.uncovered, 1);
  });

  it("degrades to current prices with no moves when history is empty", () => {
    const board = buildPriceBoard({ models, history: [], opts: { nowMs: NOW } });
    assert.equal(board.baselineDate, null);
    assert.equal(board.movers.length, 0);
    assert.equal(board.rows.every((r) => r.noBaseline), true);
  });
});

describe("priceHeadline", () => {
  it("names the biggest mover", () => {
    const board = buildPriceBoard({
      models: [model("deepseek-v4", 0.19, 0.8, { provider: "DeepSeek", openrouterId: "deepseek/v4" })],
      history: [snap(20, [{ key: "deepseek-v4", input: 0.5, output: 2 }])],
      opts: { nowMs: NOW },
    });
    assert.match(priceHeadline(board), /DeepSeek cut .* 60% to \$0\.8\/Mtok out/);
  });

  it("says so plainly when nothing moved, instead of inventing a mover", () => {
    const board = buildPriceBoard({
      models: [model("steady", 1, 4)],
      history: [snap(20, [{ key: "steady", input: 1, output: 4 }])],
      opts: { nowMs: NOW },
    });
    assert.match(priceHeadline(board), /No material price moves/);
  });

  it("distinguishes 'no baseline' from 'nothing moved'", () => {
    const board = buildPriceBoard({ models: [model("x", 1, 4)], history: [], opts: { nowMs: NOW } });
    assert.match(priceHeadline(board), /No price baseline/);
  });
});

describe("renderPriceBoardPage", () => {
  const board = buildPriceBoard({
    models: [
      model("deepseek-v4", 0.19, 0.8, { provider: "DeepSeek", openrouterId: "deepseek/v4", label: "DeepSeek V4" }),
      model("brand-new", 3, 15, { provider: "Mistral", openrouterId: "mistralai/new" }),
    ],
    history: [snap(20, [{ key: "deepseek-v4", input: 0.5, output: 2 }])],
    opts: { nowMs: NOW },
  });

  it("renders the board with the move and the baseline it used", () => {
    const html = renderPriceBoardPage(board);
    assert.match(html, /Price Board/);
    assert.match(html, /DeepSeek V4/);
    assert.match(html, /60\.0%/);
    assert.match(html, new RegExp(day(20)));
  });

  it("prints 'no baseline in window' rather than a fake zero", () => {
    const html = renderPriceBoardPage(board);
    assert.match(html, /no baseline in window/);
  });

  it("links a lab to its company file", () => {
    const html = renderPriceBoardPage(board, { basePath: "/gt" });
    assert.match(html, /href="\/gt\/companies\/deepseek\/"/);
  });

  it("states its own coverage", () => {
    assert.match(renderPriceBoardPage(board), /1 of 2 models have a baseline/);
  });

  it("has a designed dark state", () => {
    const html = renderPriceBoardPage({ rows: [], movers: [] });
    assert.match(html, /Board is dark/);
  });

  it("escapes label text", () => {
    const evil = buildPriceBoard({
      models: [model("x", 1, 2, { label: "<script>alert(1)</script>" })],
      history: [],
      opts: { nowMs: NOW },
    });
    assert.equal(renderPriceBoardPage(evil).includes("<script>alert(1)</script>"), false);
  });
});

describe("price board on the strip", () => {
  it("leads the strip when there is a mover", () => {
    const board = buildPriceBoard({
      models: [model("deepseek-v4", 0.19, 0.8, { provider: "DeepSeek", openrouterId: "deepseek/v4" })],
      history: [snap(20, [{ key: "deepseek-v4", input: 0.5, output: 2 }])],
      opts: { nowMs: NOW },
    });
    const strip = buildBusinessStrip(buildBusinessDesks([]), {
      priceBoard: board,
      priceHeadline: priceHeadline(board),
    });
    assert.equal(strip[0].deskId, "prices");
    assert.equal(strip[0].signal, "up");
    assert.match(strip[0].line, /DeepSeek cut/);
    assert.equal(strip.length, 4, "price row plus the three desks");
  });

  it("is omitted entirely when no board was built", () => {
    const strip = buildBusinessStrip(buildBusinessDesks([]));
    assert.equal(strip.some((s) => s.deskId === "prices"), false);
  });
});
