const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { runEditorPanel, parseLeadVote, generateEditorialContent } = require("../src/xai");
const { renderHybridArticle } = require("../src/render");

const llmLimit = (fn) => fn();

/** Mock OpenAI-compatible client; responseFn(prompt) => raw text. */
function mockClient(responseFn) {
  return {
    chat: { completions: { create: async (params) => ({ choices: [{ message: { content: responseFn(params.messages[0].content), reasoning: "" } }] }) } },
  };
}

const candidates = [
  { repo: { full_name: "a/one", description: "first thing" }, delta: {}, reason: "+200 stars" },
  { repo: { full_name: "b/two", description: "second thing" }, delta: {}, reason: "+150 stars" },
  { repo: { full_name: "c/three", description: "third thing" }, delta: {}, reason: "+100 stars" },
];

function withEnv(key, val, fn) {
  const prev = process.env[key];
  if (val === null) delete process.env[key]; else process.env[key] = val;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
  });
}

describe("parseLeadVote (tolerant)", () => {
  it("parses an explicit number", () => {
    assert.deepEqual(parseLeadVote("LEAD: #2\nWHY: solid", candidates), { idx: 1, why: "solid" });
  });
  it("parses a repo name when no number is given", () => {
    const r = parseLeadVote("LEAD: c/three\nWHY: novel", candidates);
    assert.equal(r.idx, 2);
    assert.equal(r.why, "novel");
  });
  it("parses a bare short name", () => {
    assert.equal(parseLeadVote("LEAD: two", candidates).idx, 1);
  });
  it("returns idx -1 on unparseable prose", () => {
    assert.equal(parseLeadVote("I cannot decide today.", candidates).idx, -1);
  });
});

describe("runEditorPanel", () => {
  it("tallies lens votes and synthesizes a rationale (majority winner)", async () => {
    // impact + consequence vote #1; novelty votes #3; synthesis returns rationale.
    const client = mockClient((prompt) => {
      if (prompt.includes("Why this leads today")) return "It ships a capability builders were missing.";
      if (prompt.includes("by NOVELTY")) return "LEAD: #3\nWHY: newest";
      return "LEAD: #1\nWHY: helps many";
    });
    await withEnv("GT_DISABLE_PANEL", null, async () => {
      const d = await runEditorPanel(client, candidates, llmLimit, {});
      assert.equal(d.viaPanel, true);
      assert.equal(d.chosen.repo.full_name, "a/one"); // 2 votes vs 1
      assert.equal(d.why, "It ships a capability builders were missing.");
    });
  });

  it("returns null (fallback signal) when no lens produces a usable vote", async () => {
    const client = mockClient(() => "no idea");
    await withEnv("GT_DISABLE_PANEL", null, async () => {
      assert.equal(await runEditorPanel(client, candidates, llmLimit, {}), null);
    });
  });

  it("falls back to a lens note when the synthesis call throws", async () => {
    let n = 0;
    const client = {
      chat: { completions: { create: async (params) => {
        const p = params.messages[0].content;
        if (p.includes("Why this leads today")) throw new Error("rate limited");
        n++;
        return { choices: [{ message: { content: "LEAD: #1\nWHY: lens grounding" } }] };
      } } },
    };
    await withEnv("GT_DISABLE_PANEL", null, async () => {
      const d = await runEditorPanel(client, candidates, llmLimit, {});
      assert.equal(d.chosen.repo.full_name, "a/one");
      assert.equal(d.why, "lens grounding"); // synthesis failed → lens note used
      assert.ok(n >= 1);
    });
  });

  it("returns null when GT_DISABLE_PANEL=1", async () => {
    const client = mockClient(() => "LEAD: #1\nWHY: x");
    await withEnv("GT_DISABLE_PANEL", "1", async () => {
      assert.equal(await runEditorPanel(client, candidates, llmLimit, {}), null);
    });
  });

  it("returns null with fewer than 2 candidates", async () => {
    const client = mockClient(() => "LEAD: #1");
    await withEnv("GT_DISABLE_PANEL", null, async () => {
      assert.equal(await runEditorPanel(client, [candidates[0]], llmLimit, {}), null);
    });
  });

  it("honors EDITOR_MODEL for the panel decision", async () => {
    const seen = new Set();
    const client = { chat: { completions: { create: async (params) => { seen.add(params.model); return { choices: [{ message: { content: "LEAD: #1\nWHY: y" } }] }; } } } };
    await withEnv("GT_DISABLE_PANEL", null, () => withEnv("EDITOR_MODEL", "paid/model-x", async () => {
      await runEditorPanel(client, candidates, llmLimit, {});
      assert.ok(seen.has("paid/model-x"));
    }));
  });
});

describe("lead rationale rendering", () => {
  const article = {
    headline: "Big Release", subheadline: "sub", body: "Body paragraph.", useCases: [],
    repo: { name: "a/one", url: "https://github.com/a/one", language: "Go", stars: 100 },
    leadRationale: "Ships a capability builders were missing.",
  };

  it("renders the 'Why this leads today' byline for the lead", () => {
    const html = renderHybridArticle(article, { isLead: true });
    assert.match(html, /Why this leads today/);
    assert.match(html, /Ships a capability builders were missing\./);
  });

  it("does not render the byline for non-lead articles", () => {
    assert.doesNotMatch(renderHybridArticle(article, { isLead: false }), /Why this leads today/);
  });

  it("escapes the rationale text", () => {
    const evil = { ...article, leadRationale: '<img src=x onerror=alert(1)> & "quotes"' };
    const html = renderHybridArticle(evil, { isLead: true });
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
  });
});

// --- integration: editor path inside generateEditorialContent ---
describe("generateEditorialContent editor path", () => {
  function repo(name) {
    return { full_name: `org/${name}`, name: `org/${name}`, description: `${name} desc`, stargazers_count: 100, language: "Go", topics: [], url: `https://github.com/org/${name}` };
  }
  function article(h) {
    return `HEADLINE: ${h}\nSUBHEADLINE: sub\nBODY: First paragraph here.\n\nSecond paragraph here.\nUSE_CASES:\n1. one\n2. two`;
  }
  function sections() {
    return { frontPage: { lead: repo("lead"), secondary: [repo("s1")], quickHits: [], isEmpty: false } };
  }
  function plan() {
    return {
      breakout: { repo: repo("cand1"), delta: {}, reason: "+200 stars" },
      breakoutCandidates: [
        { repo: repo("cand1"), delta: {}, reason: "+200 stars" },
        { repo: repo("cand2"), delta: {}, reason: "+100 stars" },
      ],
      trends: [], sleepers: [],
    };
  }

  it("uses the panel and flows its rationale to the lead byline", async () => {
    const client = mockClient((p) => {
      if (p.includes("Why this leads today")) return "Panel rationale text.";
      if (p.includes("front-page panel")) return "LEAD: #1\nWHY: lens note";
      return article("Cand One Leads");
    });
    await withEnv("GT_DISABLE_PANEL", null, () => withEnv("GT_DISABLE_SOURCES", "1", async () => {
      const result = await generateEditorialContent(sections(), "fake-key", plan(), { client });
      assert.equal(result.editorialMeta.leadEditor.viaPanel, true);
      assert.equal(result.editorialMeta.leadEditor.why, "Panel rationale text.");
      assert.equal(result.sections.frontPage.lead.leadRationale, "Panel rationale text.");
    }));
  });

  it("everything-fails-still-builds: panel + sources disabled → single-call editor, valid lead, no throw", async () => {
    const client = mockClient((p) => {
      if (/Respond EXACTLY/.test(p) && /LEAD:/.test(p)) return "LEAD: #1\nWHY: most significant";
      return article("Cand One Leads");
    });
    await withEnv("GT_DISABLE_PANEL", "1", () => withEnv("GT_DISABLE_SOURCES", "1", async () => {
      const result = await generateEditorialContent(sections(), "fake-key", plan(), { client });
      assert.equal(result.editorialMeta.leadEditor.viaPanel, false);
      assert.equal(result.editorialMeta.leadEditor.viaEditor, true);
      assert.ok(result.sections.frontPage.lead, "front page still has a lead");
      assert.equal(result.sections.frontPage.lead.leadRationale, "most significant");
    }));
  });
});
