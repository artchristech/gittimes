const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { loadHistory, computeDeltas, snapshotHistory } = require("../src/history");

describe("loadHistory", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty snapshots when no file exists", () => {
    const result = loadHistory(tmpDir);
    assert.deepEqual(result, { snapshots: [] });
  });

  it("reads valid history file", () => {
    const editionsDir = path.join(tmpDir, "editions");
    fs.mkdirSync(editionsDir, { recursive: true });
    const history = {
      snapshots: [
        {
          date: "2026-02-28",
          repos: [{ full_name: "org/repo", stars: 100, forks: 10, issues: 5 }],
        },
      ],
    };
    fs.writeFileSync(path.join(editionsDir, "history.json"), JSON.stringify(history));
    const result = loadHistory(tmpDir);
    assert.equal(result.snapshots.length, 1);
    assert.equal(result.snapshots[0].date, "2026-02-28");
    assert.equal(result.snapshots[0].repos[0].full_name, "org/repo");
  });

  it("handles corrupt JSON gracefully", () => {
    const editionsDir = path.join(tmpDir, "editions");
    fs.mkdirSync(editionsDir, { recursive: true });
    fs.writeFileSync(path.join(editionsDir, "history.json"), "not valid json{{{");
    const result = loadHistory(tmpDir);
    assert.deepEqual(result, { snapshots: [] });
  });
});

describe("computeDeltas", () => {
  it("returns null deltas when no history exists", () => {
    const repos = [
      { full_name: "org/repo", stargazers_count: 500, forks_count: 50 },
    ];
    const history = { snapshots: [] };
    const deltas = computeDeltas(repos, history);
    assert.equal(deltas.size, 1);
    const delta = deltas.get("org/repo");
    assert.equal(delta.starDelta, null);
    assert.equal(delta.forkDelta, null);
    assert.equal(delta.daysSinceSnapshot, null);
    assert.equal(delta.previousStars, null);
    assert.equal(delta.starVelocity, null);
  });

  it("computes correct star and fork deltas", () => {
    const repos = [
      { full_name: "org/repo", stargazers_count: 500, forks_count: 60 },
    ];
    const history = {
      snapshots: [
        {
          date: new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0],
          repos: [{ full_name: "org/repo", stars: 300, forks: 40, issues: 5 }],
        },
      ],
    };
    const deltas = computeDeltas(repos, history);
    const delta = deltas.get("org/repo");
    assert.equal(delta.starDelta, 200);
    assert.equal(delta.forkDelta, 20);
    assert.equal(delta.previousStars, 300);
  });

  it("calculates star velocity correctly", () => {
    const repos = [
      { full_name: "org/repo", stargazers_count: 400, forks_count: 30 },
    ];
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
    const history = {
      snapshots: [
        {
          date: twoDaysAgo,
          repos: [{ full_name: "org/repo", stars: 200, forks: 20, issues: 3 }],
        },
      ],
    };
    const deltas = computeDeltas(repos, history);
    const delta = deltas.get("org/repo");
    assert.equal(delta.starDelta, 200);
    assert.ok(delta.starVelocity !== null);
    assert.ok(delta.daysSinceSnapshot >= 1);
    // velocity = starDelta / days
    assert.equal(delta.starVelocity, delta.starDelta / delta.daysSinceSnapshot);
  });
});

describe("snapshotHistory", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates history file when none exists", () => {
    const repos = [
      { full_name: "org/repo", stargazers_count: 100, forks_count: 10, open_issues_count: 5 },
    ];
    const date = new Date(2026, 2, 1); // March 1, 2026 (local time)
    snapshotHistory(tmpDir, repos, date);
    const historyPath = path.join(tmpDir, "editions", "history.json");
    assert.ok(fs.existsSync(historyPath));
    const data = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    assert.equal(data.snapshots.length, 1);
    assert.equal(data.snapshots[0].date, "2026-03-01");
    assert.equal(data.snapshots[0].repos[0].stars, 100);
  });

  it("replaces snapshot for same date", () => {
    const repos1 = [{ full_name: "org/repo", stargazers_count: 100, forks_count: 10, open_issues_count: 5 }];
    const repos2 = [{ full_name: "org/repo", stargazers_count: 200, forks_count: 20, open_issues_count: 8 }];
    const date = new Date(2026, 2, 1); // March 1, 2026 (local time)
    snapshotHistory(tmpDir, repos1, date);
    snapshotHistory(tmpDir, repos2, date);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, "editions", "history.json"), "utf-8"));
    assert.equal(data.snapshots.length, 1);
    assert.equal(data.snapshots[0].repos[0].stars, 200);
  });

  it("prunes beyond 14 snapshots", () => {
    const repos = [{ full_name: "org/repo", stargazers_count: 100, forks_count: 10, open_issues_count: 5 }];
    // Create 15 snapshots on different dates
    for (let i = 0; i < 15; i++) {
      const d = new Date(2026, 1, i + 1); // Feb 1-15, 2026 (local time)
      snapshotHistory(tmpDir, repos, d);
    }
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, "editions", "history.json"), "utf-8"));
    assert.equal(data.snapshots.length, 14);
  });
});
