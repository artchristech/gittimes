const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { classifyGrowthPattern, formatTrajectoryForPrompt, fetchTrajectories } = require("../src/star-history");

// --------------- classifyGrowthPattern ---------------

describe("classifyGrowthPattern", () => {
  const now = Date.now();

  it("returns 'early-stage' for <100 stars", () => {
    const milestones = [{ date: new Date(now - 30 * 86400000).toISOString(), approxStars: 0 }];
    const createdAt = new Date(now - 30 * 86400000).toISOString();
    assert.equal(classifyGrowthPattern(milestones, createdAt, 50), "early-stage");
  });

  it("returns 'explosive' for <30 days old + >500 stars", () => {
    const createdAt = new Date(now - 10 * 86400000).toISOString();
    const milestones = [
      { date: createdAt, approxStars: 0 },
      { date: new Date(now - 9 * 86400000).toISOString(), approxStars: 1 },
      { date: new Date(now - 1 * 86400000).toISOString(), approxStars: 1000 },
    ];
    assert.equal(classifyGrowthPattern(milestones, createdAt, 1000), "explosive");
  });

  it("returns 'steady' for moderate velocity", () => {
    // 365 days old, 2000 stars → ~5.5 stars/day
    const createdAt = new Date(now - 365 * 86400000).toISOString();
    const milestones = [
      { date: createdAt, approxStars: 0 },
      { date: new Date(now - 364 * 86400000).toISOString(), approxStars: 1 },
      { date: new Date(now - 1 * 86400000).toISOString(), approxStars: 2000 },
    ];
    assert.equal(classifyGrowthPattern(milestones, createdAt, 2000), "steady");
  });

  it("returns 'stagnant' for velocity < 0.5", () => {
    // 500 days old, 200 stars, last star 40 days ago → ~0.4 stars/day
    const createdAt = new Date(now - 500 * 86400000).toISOString();
    const milestones = [
      { date: createdAt, approxStars: 0 },
      { date: new Date(now - 499 * 86400000).toISOString(), approxStars: 1 },
      { date: new Date(now - 40 * 86400000).toISOString(), approxStars: 200 },
    ];
    assert.equal(classifyGrowthPattern(milestones, createdAt, 200), "stagnant");
  });

  it("returns 'slow-burn' for velocity between 0.5 and 2", () => {
    // 365 days old, 400 stars → ~1.1 stars/day, last star recent
    const createdAt = new Date(now - 365 * 86400000).toISOString();
    const milestones = [
      { date: createdAt, approxStars: 0 },
      { date: new Date(now - 364 * 86400000).toISOString(), approxStars: 1 },
      { date: new Date(now - 1 * 86400000).toISOString(), approxStars: 400 },
    ];
    assert.equal(classifyGrowthPattern(milestones, createdAt, 400), "slow-burn");
  });

  it("returns 'recent-surge' for high velocity + old repo", () => {
    // 200 days old, 5000 stars → ~25 stars/day velocity > 20 && totalAgeDays > 90
    const createdAt = new Date(now - 200 * 86400000).toISOString();
    const milestones = [
      { date: createdAt, approxStars: 0 },
      { date: new Date(now - 199 * 86400000).toISOString(), approxStars: 1 },
      { date: new Date(now - 1 * 86400000).toISOString(), approxStars: 5000 },
    ];
    assert.equal(classifyGrowthPattern(milestones, createdAt, 5000), "recent-surge");
  });
});

// --------------- formatTrajectoryForPrompt ---------------

describe("formatTrajectoryForPrompt", () => {
  it("returns empty string for null input", () => {
    assert.equal(formatTrajectoryForPrompt(null), "");
  });

  it("contains STAR TRAJECTORY header", () => {
    const trajectory = {
      totalStars: 500,
      createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      milestones: [{ date: new Date(Date.now() - 90 * 86400000).toISOString(), approxStars: 0 }],
      growthPattern: "steady",
    };
    const result = formatTrajectoryForPrompt(trajectory);
    assert.ok(result.includes("STAR TRAJECTORY"));
  });

  it("contains creation date and current star count", () => {
    const trajectory = {
      totalStars: 1234,
      createdAt: "2024-01-15T00:00:00Z",
      milestones: [{ date: "2024-01-15T00:00:00Z", approxStars: 0 }],
      growthPattern: "steady",
    };
    const result = formatTrajectoryForPrompt(trajectory);
    assert.ok(result.includes("Repository created"));
    assert.ok(result.includes("1,234 stars"));
  });

  it("contains growth pattern label", () => {
    const trajectory = {
      totalStars: 5000,
      createdAt: "2023-06-01T00:00:00Z",
      milestones: [{ date: "2023-06-01T00:00:00Z", approxStars: 0 }],
      growthPattern: "explosive",
    };
    const result = formatTrajectoryForPrompt(trajectory);
    assert.ok(result.includes("Explosive viral growth"));
  });
});

// --------------- fetchTrajectories shared cache ---------------

describe("fetchTrajectories with shared cache", () => {
  it("preserves pre-populated cache entries and returns the same Map", async () => {
    const cachedTrajectory = {
      totalStars: 100,
      createdAt: "2024-01-01T00:00:00Z",
      milestones: [],
      growthPattern: "steady",
      summary: "test",
    };
    const sharedCache = new Map();
    sharedCache.set("org/cached-repo", cachedTrajectory);

    // Pass only the cached repo — it should be skipped entirely
    const repos = [{ name: "org/cached-repo" }];
    const result = await fetchTrajectories(repos, "fake-token", sharedCache);

    // The returned Map should be the same object as the shared cache
    assert.equal(result, sharedCache, "Should return the same Map instance");
    // The pre-populated entry should be preserved unchanged
    assert.deepEqual(result.get("org/cached-repo"), cachedTrajectory);
  });

  it("uses new Map when no shared cache provided", async () => {
    const repos = [];
    const result = await fetchTrajectories(repos, "fake-token");
    assert.ok(result instanceof Map);
    assert.equal(result.size, 0);
  });
});
