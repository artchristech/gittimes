const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { generateSectionContent, generateEditorialContent, parseArticle, chat, _attachSentiment } = require("../src/xai");
const { fetchXSentimentForRepo } = require("../src/x-sentiment");

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

/** Build a well-formatted article response string (catalog format) */
function goodArticle(tagline, description = "Extended description of the project.") {
  return [
    `TAGLINE: ${tagline}`,
    `DESCRIPTION: ${description}`,
    "USE_CASES:",
    "1. Build web apps faster",
    "2. Replace legacy toolchains",
    "3. Prototype new ideas",
    "SIMILAR_PROJECTS:",
    "1. Vite - faster but less opinionated",
    "2. Turbopack - similar scope",
    "3. esbuild - lower-level bundler",
  ].join("\n");
}

/** Build a bad response that won't parse */
function badResponse() {
  return "This is just unstructured rambling with no markers at all.";
}

/** Build a well-formatted sentiment response */
function goodSentiment(sentiment = "buzzing") {
  return [
    `SENTIMENT: ${sentiment}`,
    "POST_COUNT: 42",
    "BLURB: Developers love this project",
    "TOP_POST: This is amazing!",
  ].join("\n");
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

    // headline = repo display name, subheadline = tagline from LLM
    assert.equal(result.lead.headline, "alpha");
    assert.equal(result.lead.subheadline, "Great Framework");
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

    assert.equal(result.lead.headline, "retry-works");
    assert.equal(result.lead.subheadline, "Second Try Works");
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
      // bad-sec prompt — always returns unparseable (check before lead to avoid "Do not lead with" false match)
      if (prompt.includes("bad-sec") || prompt.includes("Bad-sec")) {
        return badResponse();
      }
      // Lead repo prompt
      if (prompt.includes("org/lead-repo")) {
        return goodArticle("Lead Story");
      }
      // good-sec prompt
      if (prompt.includes("good-sec") || prompt.includes("Good-sec")) {
        return goodArticle("Good Secondary");
      }
      return goodArticle("Default");
    });

    const sectionData = {
      lead: makeRepo("lead-repo"),
      secondary: [makeRepo("good-sec"), makeRepo("bad-sec")],
      quickHits: [makeRepo("qh1")],
    };
    const config = { id: "ai", label: "AI" };

    const result = await generateSectionContent(sectionData, config, client, llmLimit);

    // good-sec should stay in secondary, bad-sec should be demoted
    assert.equal(result.secondary.length, 1, "Only 1 good secondary should remain");
    // headline = repo display name in catalog format
    assert.equal(result.secondary[0].headline, "good-sec");
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

    // headline = repo display name in catalog format
    assert.equal(result.lead.headline, "good-sec");
    assert.equal(result.lead._isFallback, false);
    // The original bad lead should be demoted to quickHits
    assert.ok(
      result.quickHits.some((qh) => qh.name === "org/bad-lead" || qh.shortName === "bad-lead"),
      "Failed lead should be demoted to quickHits"
    );
  });
});

// --------------- generateEditorialContent — sleeper deep cuts ---------------

describe("generateEditorialContent — sleeper deep cuts", () => {
  it("produces deepCuts on frontPage when editorial plan has sleepers", async () => {
    const client = mockClient((prompt) => {
      if (prompt.includes("Deep Cuts")) {
        return goodArticle("Hidden Gem Discovered");
      }
      // Default for base section generation
      return goodArticle("Default Article");
    });

    const sections = {
      frontPage: {
        lead: makeRepo("lead"),
        secondary: [],
        quickHits: [],
      },
    };

    const editorialPlan = {
      breakout: null,
      trends: [],
      sleepers: [
        {
          repo: {
            full_name: "org/hidden-gem",
            name: "org/hidden-gem",
            description: "A useful tool",
            stargazers_count: 80,
            language: "Go",
            topics: ["cli", "devtools"],
            url: "https://github.com/org/hidden-gem",
          },
          reason: "Under-the-radar with 80 stars",
        },
      ],
    };

    const result = await generateEditorialContent(sections, "fake-key", editorialPlan, { client });

    assert.ok(result.sections.frontPage.deepCuts, "frontPage should have deepCuts");
    assert.equal(result.sections.frontPage.deepCuts.length, 1);
    // headline = repo display name in catalog format
    assert.equal(result.sections.frontPage.deepCuts[0].headline, "hidden-gem");
    assert.equal(result.sections.frontPage.deepCuts[0]._isSleeper, true);
    assert.equal(result.editorialMeta.sleepers.length, 1);
    assert.equal(result.editorialMeta.sleepers[0].repo, "org/hidden-gem");
  });

  it("skips fallback sleeper articles from deepCuts", async () => {
    const client = mockClient((prompt) => {
      if (prompt.includes("Deep Cuts")) {
        return badResponse();
      }
      return goodArticle("Default Article");
    });

    const sections = {
      frontPage: {
        lead: makeRepo("lead"),
        secondary: [],
        quickHits: [],
      },
    };

    const editorialPlan = {
      breakout: null,
      trends: [],
      sleepers: [
        {
          repo: {
            full_name: "org/broken-sleeper",
            name: "org/broken-sleeper",
            description: "Broken",
            stargazers_count: 50,
            language: "Rust",
            topics: [],
            url: "https://github.com/org/broken-sleeper",
          },
          reason: "Growing",
        },
      ],
    };

    const result = await generateEditorialContent(sections, "fake-key", editorialPlan, { client });

    // Should not have deepCuts since article was a fallback
    assert.ok(!result.sections.frontPage.deepCuts, "Should not have deepCuts when article is fallback");
    assert.equal(result.editorialMeta.sleepers.length, 0);
  });
});

// --------------- chat() retry behavior ---------------

describe("chat", () => {
  it("retries on transient failure and returns success result", async () => {
    let callCount = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            callCount++;
            if (callCount === 1) {
              const err = new Error("Server error");
              err.status = 500;
              throw err;
            }
            return {
              choices: [{ message: { content: "HEADLINE: Success", reasoning: "" } }],
            };
          },
        },
      },
    };

    const result = await chat(client, "test-model", "test prompt", 100);
    assert.equal(callCount, 2, "Should have retried once");
    assert.ok(result.includes("Success"));
  });

  it("aborts on 4xx error without retrying", async () => {
    let callCount = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            callCount++;
            const err = new Error("Bad request");
            err.status = 400;
            throw err;
          },
        },
      },
    };

    await assert.rejects(
      () => chat(client, "test-model", "test prompt", 100),
      (_err) => {
        // p-retry wraps AbortError — check that it aborted early
        assert.equal(callCount, 1, "Should not retry on 4xx");
        return true;
      }
    );
  });
});

// --------------- _attachSentiment ---------------

describe("_attachSentiment", () => {
  it("attaches sentiment to lead + first 2 featured on frontPage, skips 3rd secondary and quickHits", async () => {
    const client = mockClient((prompt) => {
      if (prompt.includes("Search X.com")) return goodSentiment("buzzing");
      return goodArticle("Default");
    });

    const sections = {
      frontPage: {
        lead: { ...parseArticle(goodArticle("Lead"), makeRepo("lead")), repo: makeRepo("lead") },
        secondary: [
          { ...parseArticle(goodArticle("Sec1"), makeRepo("sec1")), repo: makeRepo("sec1") },
          { ...parseArticle(goodArticle("Sec2"), makeRepo("sec2")), repo: makeRepo("sec2") },
          { ...parseArticle(goodArticle("Sec3"), makeRepo("sec3")), repo: makeRepo("sec3") },
        ],
        quickHits: [{ ...makeRepo("qh1"), summary: "Quick hit" }],
        isEmpty: false,
      },
    };

    await _attachSentiment(sections, client, llmLimit, { fetchXSentimentForRepo });

    assert.ok(sections.frontPage.lead.xSentiment, "Lead should have xSentiment");
    assert.equal(sections.frontPage.lead.xSentiment.sentiment, "buzzing");
    assert.ok(sections.frontPage.secondary[0].xSentiment, "1st secondary should have xSentiment");
    assert.ok(sections.frontPage.secondary[1].xSentiment, "2nd secondary should have xSentiment");
    assert.ok(!sections.frontPage.secondary[2].xSentiment, "3rd secondary should NOT have xSentiment");
    assert.ok(!sections.frontPage.quickHits[0].xSentiment, "quickHits should NOT have xSentiment");
  });

  it("attaches sentiment to non-frontPage section lead + first 1 featured", async () => {
    const client = mockClient((prompt) => {
      if (prompt.includes("Search X.com")) return goodSentiment("positive");
      return goodArticle("Default");
    });

    const sections = {
      ai: {
        lead: { ...parseArticle(goodArticle("AI Lead"), makeRepo("ai-lead")), repo: makeRepo("ai-lead") },
        secondary: [
          { ...parseArticle(goodArticle("AISec1"), makeRepo("ai-sec1")), repo: makeRepo("ai-sec1") },
          { ...parseArticle(goodArticle("AISec2"), makeRepo("ai-sec2")), repo: makeRepo("ai-sec2") },
        ],
        quickHits: [],
        isEmpty: false,
      },
    };

    await _attachSentiment(sections, client, llmLimit, { fetchXSentimentForRepo });

    assert.ok(sections.ai.lead.xSentiment, "Lead should have xSentiment");
    assert.equal(sections.ai.lead.xSentiment.sentiment, "positive");
    assert.ok(sections.ai.secondary[0].xSentiment, "1st secondary should have xSentiment");
    assert.ok(!sections.ai.secondary[1].xSentiment, "2nd secondary should NOT have xSentiment (non-frontPage)");
  });

  it("attaches sentiment to deepCuts articles", async () => {
    const client = mockClient((prompt) => {
      if (prompt.includes("Search X.com")) return goodSentiment("quiet");
      return goodArticle("Default");
    });

    const sections = {
      frontPage: {
        lead: { ...parseArticle(goodArticle("Lead"), makeRepo("lead")), repo: makeRepo("lead") },
        secondary: [],
        quickHits: [],
        deepCuts: [
          { ...parseArticle(goodArticle("DeepCut1"), makeRepo("dc1")), repo: makeRepo("dc1"), _isSleeper: true },
        ],
        isEmpty: false,
      },
    };

    await _attachSentiment(sections, client, llmLimit, { fetchXSentimentForRepo });

    assert.ok(sections.frontPage.deepCuts[0].xSentiment, "Deep cut should have xSentiment");
    assert.equal(sections.frontPage.deepCuts[0].xSentiment.sentiment, "quiet");
  });

  it("handles empty/missing sections without error", async () => {
    const client = mockClient(() => goodSentiment("neutral"));

    const sections = {
      frontPage: { lead: null, secondary: [], quickHits: [], isEmpty: true },
      ai: undefined,
    };

    // Should not throw
    await _attachSentiment(sections, client, llmLimit, { fetchXSentimentForRepo });
  });

  it("skips _isTrend articles", async () => {
    let sentimentCalls = 0;
    const client = mockClient((prompt) => {
      if (prompt.includes("Search X.com")) {
        sentimentCalls++;
        return goodSentiment("buzzing");
      }
      return goodArticle("Default");
    });

    const trendArticle = {
      ...parseArticle(goodArticle("Trend Article"), null),
      repo: { name: "trend/ai-agents", shortName: "ai-agents", url: "#", stars: 0, language: "Trend", topics: [] },
      _isTrend: true,
    };
    const normalArticle = {
      ...parseArticle(goodArticle("Normal"), makeRepo("normal")),
      repo: makeRepo("normal"),
    };

    const sections = {
      frontPage: {
        lead: normalArticle,
        secondary: [trendArticle],
        quickHits: [],
        isEmpty: false,
      },
    };

    await _attachSentiment(sections, client, llmLimit, { fetchXSentimentForRepo });

    assert.ok(normalArticle.xSentiment, "Normal article should have xSentiment");
    assert.ok(!trendArticle.xSentiment, "Trend article should NOT have xSentiment");
    assert.equal(sentimentCalls, 1, "Should only fetch sentiment for non-trend articles");
  });
});

// --------------- generateEditorialContent — sentiment integration ---------------

describe("generateEditorialContent — sentiment", () => {
  it("attaches xSentiment to breakout article after it replaces lead", async () => {
    const client = mockClient((prompt) => {
      if (prompt.includes("Search X.com")) return goodSentiment("buzzing");
      return goodArticle("Breakout Story");
    });

    const sections = {
      frontPage: {
        lead: makeRepo("original-lead"),
        secondary: [],
        quickHits: [],
      },
    };

    const editorialPlan = {
      breakout: {
        repo: {
          full_name: "org/breakout",
          name: "org/breakout",
          description: "A breakout project",
          stargazers_count: 5000,
          language: "TypeScript",
          topics: [],
          url: "https://github.com/org/breakout",
        },
        reason: "Massive star growth",
        delta: { stars: 2000 },
      },
      trends: [],
      sleepers: [],
    };

    const result = await generateEditorialContent(sections, "fake-key", editorialPlan, { client, fetchXSentimentForRepo });

    assert.ok(result.sections.frontPage.lead.xSentiment, "Breakout lead should have xSentiment");
    assert.equal(result.sections.frontPage.lead.xSentiment.sentiment, "buzzing");
  });

  it("skips sentiment when X_SENTIMENT=false", async () => {
    const origEnv = process.env.X_SENTIMENT;
    process.env.X_SENTIMENT = "false";

    try {
      let sentimentCalls = 0;
      const client = mockClient((prompt) => {
        if (prompt.includes("Search X.com")) {
          sentimentCalls++;
          return goodSentiment("buzzing");
        }
        return goodArticle("Default Article");
      });

      const sections = {
        frontPage: {
          lead: makeRepo("lead"),
          secondary: [],
          quickHits: [],
        },
      };

      const editorialPlan = { breakout: null, trends: [], sleepers: [] };
      const result = await generateEditorialContent(sections, "fake-key", editorialPlan, { client, fetchXSentimentForRepo });

      assert.equal(sentimentCalls, 0, "Should not fetch sentiment when X_SENTIMENT=false");
      assert.ok(!result.sections.frontPage.lead.xSentiment, "Lead should NOT have xSentiment");
    } finally {
      if (origEnv === undefined) {
        delete process.env.X_SENTIMENT;
      } else {
        process.env.X_SENTIMENT = origEnv;
      }
    }
  });
});
