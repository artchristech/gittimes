const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { identifyBreakout, clusterTrends, identifySleepers, makeEditorialPlan } = require("../src/editorial");

describe("identifyBreakout", () => {
  it("returns null with no deltas", () => {
    const repos = [{ full_name: "org/repo", stargazers_count: 500 }];
    const result = identifyBreakout(repos, null);
    assert.equal(result, null);
  });

  it("returns null with empty deltas map", () => {
    const repos = [{ full_name: "org/repo", stargazers_count: 500 }];
    const result = identifyBreakout(repos, new Map());
    assert.equal(result, null);
  });

  it("returns null when below 100-star threshold", () => {
    const repos = [{ full_name: "org/repo", stargazers_count: 150 }];
    const deltas = new Map([
      ["org/repo", { starDelta: 50, forkDelta: 5, daysSinceSnapshot: 1, previousStars: 100, starVelocity: 50 }],
    ]);
    const result = identifyBreakout(repos, deltas);
    assert.equal(result, null);
  });

  it("picks repo with highest breakout score", () => {
    const repos = [
      { full_name: "org/small-grower", stargazers_count: 600 },
      { full_name: "org/big-grower", stargazers_count: 1500 },
    ];
    const deltas = new Map([
      ["org/small-grower", { starDelta: 100, forkDelta: 10, daysSinceSnapshot: 1, previousStars: 500, starVelocity: 100 }],
      ["org/big-grower", { starDelta: 500, forkDelta: 50, daysSinceSnapshot: 1, previousStars: 1000, starVelocity: 500 }],
    ]);
    const result = identifyBreakout(repos, deltas);
    assert.ok(result);
    assert.equal(result.repo.full_name, "org/big-grower");
    assert.ok(result.reason.includes("500"));
  });

  it("favors relative gain in breakout score", () => {
    const repos = [
      { full_name: "org/established", stargazers_count: 10200 },
      { full_name: "org/newcomer", stargazers_count: 300 },
    ];
    const deltas = new Map([
      // Established: +200 stars from 10000 (2% growth) → score = 200 * (1 + 0.02) = 204
      ["org/established", { starDelta: 200, forkDelta: 10, daysSinceSnapshot: 1, previousStars: 10000, starVelocity: 200 }],
      // Newcomer: +200 stars from 100 (200% growth, capped at 10) → score = 200 * (1 + 2) = 600
      ["org/newcomer", { starDelta: 200, forkDelta: 5, daysSinceSnapshot: 1, previousStars: 100, starVelocity: 200 }],
    ]);
    const result = identifyBreakout(repos, deltas);
    assert.ok(result);
    assert.equal(result.repo.full_name, "org/newcomer");
  });
});

describe("clusterTrends", () => {
  it("returns empty when no 2+ clusters exist", () => {
    const repos = [
      { full_name: "org/lonely", description: "a unique snowflake", topics: [], language: "Brainfuck" },
    ];
    const result = clusterTrends(repos);
    assert.deepEqual(result, []);
  });

  it("groups repos by theme keywords", () => {
    const repos = [
      { full_name: "org/agent1", description: "an AI agent framework", topics: ["ai-agent"], language: "Python" },
      { full_name: "org/agent2", description: "autonomous agent toolkit", topics: ["agent"], language: "Python" },
      { full_name: "org/cli-tool", description: "a CLI tool", topics: ["cli"], language: "Go" },
    ];
    const result = clusterTrends(repos);
    assert.ok(result.length >= 1);
    const aiCluster = result.find((c) => c.theme === "ai-agents");
    assert.ok(aiCluster, "Should have an ai-agents cluster");
    assert.equal(aiCluster.repos.length, 2);
  });

  it("caps at 3 clusters", () => {
    // Create repos that match many different themes
    const repos = [
      { full_name: "a/1", description: "agent framework", topics: ["ai-agent"], language: "Python" },
      { full_name: "a/2", description: "another agent", topics: ["autonomous"], language: "Python" },
      { full_name: "a/3", description: "llm tool", topics: ["llm"], language: "Python" },
      { full_name: "a/4", description: "gpt wrapper", topics: ["gpt"], language: "Python" },
      { full_name: "a/5", description: "rust system", topics: [], language: "Rust" },
      { full_name: "a/6", description: "tokio runtime", topics: ["tokio"], language: "Rust" },
      { full_name: "a/7", description: "security scanner", topics: ["security"], language: "Go" },
      { full_name: "a/8", description: "pentest tool", topics: ["pentest"], language: "Go" },
      { full_name: "a/9", description: "web framework", topics: ["web"], language: "JS" },
      { full_name: "a/10", description: "react components", topics: ["react"], language: "JS" },
    ];
    const result = clusterTrends(repos);
    assert.ok(result.length <= 3, `Expected max 3 clusters, got ${result.length}`);
  });
});

describe("identifySleepers", () => {
  it("finds low-star repos that are growing", () => {
    const repos = [
      { full_name: "org/sleeper", stargazers_count: 100, topics: ["tool"] },
    ];
    const deltas = new Map([
      ["org/sleeper", { starDelta: 30, forkDelta: 2, daysSinceSnapshot: 1, previousStars: 70, starVelocity: 30 }],
    ]);
    const result = identifySleepers(repos, deltas);
    assert.equal(result.length, 1);
    assert.equal(result[0].repo.full_name, "org/sleeper");
    assert.ok(result[0].reason.includes("100"));
  });

  it("finds repos with 3+ topics even without delta", () => {
    const repos = [
      { full_name: "org/topical", stargazers_count: 80, topics: ["cli", "devtools", "productivity", "terminal"] },
    ];
    const deltas = new Map([
      ["org/topical", { starDelta: null, forkDelta: null, daysSinceSnapshot: null, previousStars: null, starVelocity: null }],
    ]);
    const result = identifySleepers(repos, deltas);
    assert.equal(result.length, 1);
    assert.ok(result[0].reason.includes("4 topics"));
  });

  it("returns empty when none qualify", () => {
    const repos = [
      { full_name: "org/big", stargazers_count: 5000, topics: [] },
      { full_name: "org/tiny", stargazers_count: 10, topics: [] },
    ];
    const result = identifySleepers(repos, new Map());
    assert.equal(result.length, 0);
  });

  it("returns max 2 sleepers", () => {
    const repos = [
      { full_name: "a/1", stargazers_count: 50, topics: ["a", "b", "c"] },
      { full_name: "a/2", stargazers_count: 60, topics: ["d", "e", "f"] },
      { full_name: "a/3", stargazers_count: 70, topics: ["g", "h", "i"] },
    ];
    const result = identifySleepers(repos, new Map());
    assert.ok(result.length <= 2);
  });
});

describe("makeEditorialPlan", () => {
  it("returns complete plan structure", () => {
    const repos = [
      { full_name: "org/repo1", stargazers_count: 500, description: "test", topics: [], language: "JS" },
    ];
    const deltas = new Map([
      ["org/repo1", { starDelta: null, forkDelta: null, daysSinceSnapshot: null, previousStars: null, starVelocity: null }],
    ]);
    const plan = makeEditorialPlan(repos, deltas);
    assert.ok("breakout" in plan);
    assert.ok("trends" in plan);
    assert.ok("sleepers" in plan);
    assert.ok("remaining" in plan);
    assert.ok(Array.isArray(plan.trends));
    assert.ok(Array.isArray(plan.sleepers));
    assert.ok(Array.isArray(plan.remaining));
  });

  it("excludes assigned repos from remaining", () => {
    const repos = [
      { full_name: "org/breakout", stargazers_count: 2000, description: "test", topics: [], language: "JS" },
      { full_name: "org/normal", stargazers_count: 500, description: "test", topics: [], language: "Go" },
    ];
    const deltas = new Map([
      ["org/breakout", { starDelta: 500, forkDelta: 50, daysSinceSnapshot: 1, previousStars: 1500, starVelocity: 500 }],
      ["org/normal", { starDelta: null, forkDelta: null, daysSinceSnapshot: null, previousStars: null, starVelocity: null }],
    ]);
    const plan = makeEditorialPlan(repos, deltas);
    assert.ok(plan.breakout);
    assert.equal(plan.breakout.repo.full_name, "org/breakout");
    // breakout repo should not be in remaining
    const remainingNames = plan.remaining.map((r) => r.full_name);
    assert.ok(!remainingNames.includes("org/breakout"));
    assert.ok(remainingNames.includes("org/normal"));
  });
});
