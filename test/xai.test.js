const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { generateSectionContent, parseArticle } = require("../src/xai");

// --------------- Mock helpers ---------------

/**
 * Create a mock OpenAI-compatible client.
 * @param {Function} responseFn - (prompt) => string — returns raw LLM text
 */
function mockClient(responseFn) {
  return {
    chat: {
      completions: {
        create: async (params) => {
          const prompt = params.messages[0].content;
          const text = responseFn(prompt);
          return {
            choices: [{ message: { content: text, reasoning: "" } }],
          };
        },
      },
    },
  };
}

/** Passthrough rate limiter — no actual concurrency limiting */
const llmLimit = (fn) => fn();

/** Build a well-formatted article response string */
function goodArticle(headline, body = "Article body text here.") {
  return [
    `HEADLINE: ${headline}`,
    "SUBHEADLINE: A subtitle",
    `BODY: ${body}`,
    "BUILDERS_TAKE: Worth checking out.",
  ].join("\n");
}

/** Build a bad response that won't parse */
function badResponse() {
  return "This is just unstructured rambling with no markers at all.";
}

/** Create a minimal enriched repo object */
function makeRepo(name, lang = "JavaScript") {
  return {
    name: `org/${name}`,
    shortName: name,
    description: `Description of ${name}`,
    url: `https://github.com/org/${name}`,
    stars: 1000,
    language: lang,
    topics: [],
    forks: 10,
    openIssues: 5,
    createdAt: new Date().toISOString(),
    pushedAt: new Date().toISOString(),
    readmeExcerpt: "# README",
    releaseNotes: "",
    releaseName: null,
  };
}

// --------------- generateArticleWithRetry ---------------
// We test this indirectly through generateSectionContent since
// generateArticleWithRetry is not exported. The plan notes testing
// it through the section content function.

describe("generateArticleWithRetry (via generateSectionContent)", () => {
  it("returns parsed article on good LLM output", async () => {
    const client = mockClient(() => goodArticle("Great Framework"));
    const sectionData = {
      lead: makeRepo("alpha"),
      secondary: [],
      quickHits: [],
    };
    const config = { id: "ai", label: "AI" };

    const result = await generateSectionContent(sectionData, config, client, llmLimit);

    assert.equal(result.lead.headline, "Great Framework");
    assert.equal(result.lead._isFallback, false);
    assert.ok(result.lead.repo, "Article should have repo attached");
    assert.equal(result.isEmpty, false);
  });

  it("retries once on parse failure then returns fallback", async () => {
    let callCount = 0;
    const client = mockClient(() => {
      callCount++;
      return badResponse();
    });
    const sectionData = {
      lead: makeRepo("broken"),
      secondary: [],
      quickHits: [],
    };
    const config = { id: "ai", label: "AI" };

    const result = await generateSectionContent(sectionData, config, client, llmLimit);

    // Should have called LLM twice for the lead (initial + retry)
    assert.equal(callCount, 2, "Should retry once on parse failure");
    assert.equal(result.lead._isFallback, true);
    assert.ok(result.lead.repo, "Fallback article should have repo attached");
  });

  it("returns good article on second attempt after first parse failure", async () => {
    let callCount = 0;
    const client = mockClient(() => {
      callCount++;
      if (callCount === 1) return badResponse();
      return goodArticle("Second Try Works");
    });
    const sectionData = {
      lead: makeRepo("retry-works"),
      secondary: [],
      quickHits: [],
    };
    const config = { id: "ai", label: "AI" };

    const result = await generateSectionContent(sectionData, config, client, llmLimit);

    assert.equal(result.lead.headline, "Second Try Works");
    assert.equal(result.lead._isFallback, false);
  });

  it("attaches repo property to returned article", async () => {
    const client = mockClient(() => goodArticle("Test"));
    const repo = makeRepo("with-repo");
    const sectionData = { lead: repo, secondary: [], quickHits: [] };
    const config = { id: "ai", label: "AI" };

    const result = await generateSectionContent(sectionData, config, client, llmLimit);

    assert.equal(result.lead.repo.name, "org/with-repo");
  });
});

// --------------- generateSectionContent ---------------

describe("generateSectionContent", () => {
  it("produces lead, secondary, quickHits, isEmpty for valid input", async () => {
    const client = mockClient(() => goodArticle("Test Headline"));
    const sectionData = {
      lead: makeRepo("lead"),
      secondary: [makeRepo("sec1"), makeRepo("sec2")],
      quickHits: [makeRepo("qh1"), makeRepo("qh2")],
    };
    const config = { id: "ai", label: "AI" };

    const result = await generateSectionContent(sectionData, config, client, llmLimit);

    assert.ok(result.lead);
    assert.ok(Array.isArray(result.secondary));
    assert.ok(Array.isArray(result.quickHits));
    assert.equal(result.isEmpty, false);
    assert.equal(result.secondary.length, 2);
  });

  it("returns isEmpty: true when no lead", async () => {
    const client = mockClient(() => goodArticle("Unused"));
    const sectionData = {
      lead: null,
      secondary: [],
      quickHits: [makeRepo("qh1")],
    };
    const config = { id: "ai", label: "AI" };

    const result = await generateSectionContent(sectionData, config, client, llmLimit);

    assert.equal(result.isEmpty, true);
    assert.equal(result.lead, null);
    assert.deepEqual(result.secondary, []);
    // quickHits should be passed through
    assert.ok(result.quickHits.length > 0);
  });

  it("demotes fallback secondary articles to quickHits", async () => {
    // generateSectionContent calls lead + all secondaries in parallel via Promise.all,
    // so we can't rely on call order. Instead, route by prompt content.
    const client = mockClient((prompt) => {
      // The quick-hit prompt contains multiple repos in a list
      if (prompt.includes("qh1") || prompt.includes("quick")) {
        return "1. Quick summary A";
      }
      // Lead repo prompt
      if (prompt.includes("lead") || prompt.includes("Lead")) {
        return goodArticle("Lead Story");
      }
      // good-sec prompt
      if (prompt.includes("good-sec") || prompt.includes("Good-sec")) {
        return goodArticle("Good Secondary");
      }
      // bad-sec prompt — always returns unparseable
      if (prompt.includes("bad-sec") || prompt.includes("Bad-sec")) {
        return badResponse();
      }
      return goodArticle("Default");
    });

    const sectionData = {
      lead: makeRepo("lead"),
      secondary: [makeRepo("good-sec"), makeRepo("bad-sec")],
      quickHits: [makeRepo("qh1")],
    };
    const config = { id: "ai", label: "AI" };

    const result = await generateSectionContent(sectionData, config, client, llmLimit);

    // good-sec should stay in secondary, bad-sec should be demoted
    assert.equal(result.secondary.length, 1, "Only 1 good secondary should remain");
    assert.equal(result.secondary[0].headline, "Good Secondary");
    assert.ok(
      result.quickHits.length > 1,
      "Demoted article should be in quickHits"
    );
  });

  it("promotes good secondary to lead when lead fails", async () => {
    const client = mockClient((prompt) => {
      // Route by repo name in prompt
      if (prompt.includes("bad-lead") || prompt.includes("Bad-lead")) {
        return badResponse();
      }
      if (prompt.includes("good-sec") || prompt.includes("Good-sec")) {
        return goodArticle("Promoted Secondary");
      }
      return "1. Summary";
    });

    const sectionData = {
      lead: makeRepo("bad-lead"),
      secondary: [makeRepo("good-sec")],
      quickHits: [],
    };
    const config = { id: "ai", label: "AI" };

    const result = await generateSectionContent(sectionData, config, client, llmLimit);

    assert.equal(result.lead.headline, "Promoted Secondary");
    assert.equal(result.lead._isFallback, false);
    // The original bad lead should be demoted to quickHits
    assert.ok(
      result.quickHits.some((qh) => qh.name === "org/bad-lead" || qh.shortName === "bad-lead"),
      "Failed lead should be demoted to quickHits"
    );
  });
});
