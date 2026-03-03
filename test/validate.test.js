const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { validateContent } = require("../src/publish");

// --------------- validateContent ---------------

describe("validateContent", () => {
  it("returns valid: false for null content", () => {
    const result = validateContent(null);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("returns valid: false for content with no sections", () => {
    const result = validateContent({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("null or missing sections")));
  });

  it("returns valid: false for content with no non-fallback leads", () => {
    const content = {
      sections: {
        frontPage: {
          lead: { _isFallback: true },
          secondary: [{ _isFallback: false }],
          quickHits: [],
          isEmpty: false,
        },
      },
    };
    const result = validateContent(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("No non-fallback lead")));
  });

  it("returns valid: true for well-formed multi-section content", () => {
    const content = {
      sections: {
        frontPage: {
          lead: { _isFallback: false },
          secondary: [{ _isFallback: false }, { _isFallback: false }],
          quickHits: [{ name: "a" }, { name: "b" }],
          isEmpty: false,
        },
        ai: {
          lead: { _isFallback: false },
          secondary: [{ _isFallback: false }],
          quickHits: [],
          isEmpty: false,
        },
      },
    };
    const result = validateContent(content);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("returns error for front page with no secondary articles", () => {
    const content = {
      sections: {
        frontPage: {
          lead: { _isFallback: false },
          secondary: [],
          quickHits: [],
          isEmpty: false,
        },
      },
    };
    const result = validateContent(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Front page has no secondary")));
  });

  it("counts articles, fallbacks, and empty sections correctly", () => {
    const content = {
      sections: {
        frontPage: {
          lead: { _isFallback: false },
          secondary: [{ _isFallback: true }, { _isFallback: false }],
          quickHits: [{ name: "qh1" }],
          isEmpty: false,
        },
        ai: {
          isEmpty: true,
          lead: null,
          secondary: [],
          quickHits: [],
        },
      },
    };
    const result = validateContent(content);
    assert.equal(result.valid, true);
    assert.equal(result.summary.sections, 2);
    // 1 lead + 2 secondary + 1 quickHit = 4
    assert.equal(result.summary.articles, 4);
    // 1 fallback secondary
    assert.equal(result.summary.fallbacks, 1);
    // 1 empty section (ai)
    assert.equal(result.summary.emptyCount, 1);
  });
});
