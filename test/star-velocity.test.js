const { test, describe } = require("node:test");
const assert = require("node:assert");

const { computeWindowDeltas } = require("../src/history");
const { renderStarFigure, renderAgeBadge } = require("../src/render");

/** A snapshot dated `days` ago, holding the given repo star counts. */
function snapshotAgo(days, repos) {
  const d = new Date(Date.now() - days * 86400000);
  return {
    date: d.toISOString().slice(0, 10),
    repos: Object.entries(repos).map(([full_name, stars]) => ({ full_name, stars })),
  };
}

describe("computeWindowDeltas", () => {
  test("returns an empty map when there is no history", () => {
    assert.equal(computeWindowDeltas([{ full_name: "a/b", stargazers_count: 10 }], null).size, 0);
    assert.equal(computeWindowDeltas([{ full_name: "a/b", stargazers_count: 10 }], { snapshots: [] }).size, 0);
  });

  test("measures growth against the widest snapshot inside the window", () => {
    const history = {
      snapshots: [
        snapshotAgo(1, { "a/b": 900 }),
        snapshotAgo(6, { "a/b": 600 }),
        snapshotAgo(12, { "a/b": 100 }),
      ],
    };
    const out = computeWindowDeltas([{ full_name: "a/b", stargazers_count: 1000 }], history);
    // 6d is the widest snapshot within the 7d window; the 12d one is out of range.
    assert.deepEqual(out.get("a/b"), { delta: 400, days: 6 });
  });

  test("reports the window it actually measured, not an assumed week", () => {
    const history = { snapshots: [snapshotAgo(3, { "a/b": 700 })] };
    const out = computeWindowDeltas([{ full_name: "a/b", stargazers_count: 1000 }], history);
    assert.deepEqual(out.get("a/b"), { delta: 300, days: 3 });
  });

  test("ignores snapshots older than the window entirely", () => {
    const history = { snapshots: [snapshotAgo(30, { "a/b": 100 })] };
    assert.equal(computeWindowDeltas([{ full_name: "a/b", stargazers_count: 1000 }], history).size, 0);
  });

  test("omits repos with no baseline, flat counts, or negative movement", () => {
    const history = { snapshots: [snapshotAgo(5, { "seen/flat": 500, "seen/down": 500 })] };
    const out = computeWindowDeltas(
      [
        { full_name: "seen/flat", stargazers_count: 500 },
        { full_name: "seen/down", stargazers_count: 480 },
        { full_name: "never/seen", stargazers_count: 900 },
      ],
      history
    );
    assert.equal(out.size, 0);
  });

  test("accepts repos shaped as either raw GitHub or enriched objects", () => {
    const history = { snapshots: [snapshotAgo(5, { "a/b": 500 })] };
    const raw = computeWindowDeltas([{ full_name: "a/b", stargazers_count: 640 }], history);
    const enriched = computeWindowDeltas([{ name: "a/b", stars: 640 }], history);
    assert.deepEqual(raw.get("a/b"), { delta: 140, days: 5 });
    assert.deepEqual(enriched.get("a/b"), { delta: 140, days: 5 });
  });

  test("honors a custom window", () => {
    const history = { snapshots: [snapshotAgo(20, { "a/b": 100 })] };
    const out = computeWindowDeltas([{ full_name: "a/b", stargazers_count: 300 }], history, 30);
    assert.deepEqual(out.get("a/b"), { delta: 200, days: 20 });
  });
});

describe("renderStarFigure", () => {
  test("shows growth instead of the total when a delta is present", () => {
    const html = renderStarFigure({ stars: 17300, starDelta: 340, starDeltaDays: 7 });
    assert.match(html, /340 this week/);
    assert.ok(!html.includes("17.3k"), "the lifetime total must not also appear");
  });

  test("names the real window when it is shorter than a week", () => {
    const html = renderStarFigure({ stars: 17300, starDelta: 80, starDeltaDays: 3 });
    assert.match(html, /80 in 3d/);
  });

  test("falls back to the lifetime total when there is no delta", () => {
    assert.equal(renderStarFigure({ stars: 17300 }), "17.3k stars");
    assert.equal(renderStarFigure({ stars: 42 }), "42 stars");
  });

  test("falls back when the delta is zero, negative, or malformed", () => {
    assert.equal(renderStarFigure({ stars: 500, starDelta: 0, starDeltaDays: 7 }), "500 stars");
    assert.equal(renderStarFigure({ stars: 500, starDelta: -12, starDeltaDays: 7 }), "500 stars");
    assert.equal(renderStarFigure({ stars: 500, starDelta: 40 }), "500 stars");
    assert.equal(renderStarFigure({ stars: 500, starDelta: 40, starDeltaDays: 0 }), "500 stars");
  });

  test("renders nothing when there is neither a delta nor a total", () => {
    assert.equal(renderStarFigure({}), "");
    assert.equal(renderStarFigure(null), "");
  });

  test("abbreviates large deltas the same way totals are abbreviated", () => {
    assert.match(renderStarFigure({ stars: 90000, starDelta: 2400, starDeltaDays: 7 }), /2\.4k this week/);
  });
});

describe("renderAgeBadge tiers", () => {
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

  test("only repos under a week old get the fresh tier", () => {
    assert.match(renderAgeBadge({ createdAt: daysAgo(3) }), /repo-age-fresh/);
  });

  test("a three-month-old repo is not badged as fresh", () => {
    const html = renderAgeBadge({ createdAt: daysAgo(90) });
    assert.match(html, /repo-age-young/);
    assert.ok(!html.includes("repo-age-fresh"));
    assert.match(html, /3mo old/);
  });
});
