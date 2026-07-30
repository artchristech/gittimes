const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  leadArticlePrompt,
  secondaryArticlePrompt,
  breakoutArticlePrompt,
  sleeperArticlePrompt,
} = require("../src/prompts");

const REPO = {
  name: "tashfeenahmed/freellmapi",
  shortName: "freellmapi",
  description: "Aggregate free tiers of 29 LLM providers behind one endpoint",
  url: "https://github.com/tashfeenahmed/freellmapi",
  stars: 17300,
  language: "TypeScript",
  topics: ["llm", "openai"],
  readmeExcerpt: "FreeLLMAPI stacks the free tiers of 29 providers.",
  releaseNotes: "Polished the settings UI. No routing changes.",
  releaseName: "v1.4.2",
  createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
  pushedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  openIssues: 12,
  forks: 40,
};

// Every prompt that asks for a SUBHEADLINE must carry the anti-news ban. The
// deck that prompted this rule read "Latest update polishes UI for settings and
// agent setup without changing core routing" — a deck whose entire content was
// that nothing happened, directly under a headline saying something had.
const BUILDERS = {
  leadArticlePrompt: () => leadArticlePrompt(REPO),
  secondaryArticlePrompt: () => secondaryArticlePrompt(REPO),
  breakoutArticlePrompt: () => breakoutArticlePrompt(REPO, { starDelta: 340 }),
  // Deep Cuts takes a { repo } wrapper, not a bare repo.
  sleeperArticlePrompt: () => sleeperArticlePrompt({ repo: { ...REPO, full_name: REPO.name } }),
};

describe("deck guidance", () => {
  for (const [name, build] of Object.entries(BUILDERS)) {
    // No try/catch and no conditional skips: a fixture that stops matching a
    // prompt's signature must fail loudly, not quietly assert nothing.
    test(`${name} asks for a subheadline at all`, () => {
      assert.match(build(), /SUBHEADLINE/);
    });

    test(`${name} forbids a deck that subtracts news`, () => {
      const prompt = build();
      assert.match(prompt, /must ADD news, never subtract it/);
      assert.match(prompt, /polishes UI without changing core routing/);
    });

    test(`${name} keeps a trivial commit from displacing the story`, () => {
      assert.match(build(), /recent-but-trivial commit/);
    });

    test(`${name} does not ask for a merely "clarifying" subheadline`, () => {
      const prompt = build();
      // "Clarifying" invites an explanatory deck — restating or expanding the
      // headline — which is how the deck stopped carrying news in the first place.
      assert.ok(
        !/clarifying subheadline/i.test(prompt),
        "the placeholder should ask for the second-most-important fact"
      );
      assert.match(prompt, /second-most-important fact/);
    });
  }
});
