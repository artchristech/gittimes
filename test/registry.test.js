const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  SEED_ENTITIES,
  TIER_BIG_LAB,
  TIER_STARTUP,
  TIER_UNICORN,
  buildAliasIndex,
  resolveEntityRef,
  harvestEvents,
  classifyTier,
  deriveBadges,
  buildRegistry,
  watchedRepos,
  withSignals,
} = require("../src/registry");

const NOW = Date.parse("2026-07-29T00:00:00Z");
const iso = (d) => new Date(NOW - d * 86400000).toISOString();

const drop = (id, ageDays, extra = {}) => ({
  id,
  author: id.split("/")[0],
  name: id.split("/")[1],
  likes: extra.likes ?? 100,
  downloads: extra.downloads ?? 0,
  createdAt: iso(ageDays),
  ageDays,
  url: `https://huggingface.co/${id}`,
});

const release = (repo, ageDays, tag = "v1.0.0") => ({
  repo,
  owner: repo.split("/")[0],
  name: repo.split("/")[1],
  tag,
  title: tag,
  reactions: 40,
  publishedAt: iso(ageDays),
  ageDays,
  url: `https://github.com/${repo}/releases/tag/${tag}`,
});

const repo = (fullName, opts = {}) => ({
  full_name: fullName,
  html_url: `https://github.com/${fullName}`,
  created_at: iso(opts.orgAgeDays ?? 3000),
  pushed_at: iso(opts.pushedDays ?? 1),
  stargazers_count: opts.stars ?? 1000,
  starDelta: opts.starDelta ?? null,
  language: opts.language ?? "Rust",
});

describe("identity resolution", () => {
  const index = buildAliasIndex();

  it("collapses every alias an org publishes under to one entity", () => {
    // The point of the registry: Meta artifacts arrive as three different orgs.
    assert.equal(resolveEntityRef("meta-llama/Llama-4", index), "meta-ai");
    assert.equal(resolveEntityRef("facebookresearch/segment-anything", index), "meta-ai");
    assert.equal(resolveEntityRef("pytorch/pytorch", index), "meta-ai");
  });

  it("resolves a bare org and a repo full_name identically", () => {
    assert.equal(resolveEntityRef("deepseek-ai", index), "deepseek");
    assert.equal(resolveEntityRef("deepseek-ai/DeepSeek-V4", index), "deepseek");
  });

  it("is case-insensitive, because org logins are", () => {
    assert.equal(resolveEntityRef("QWEN/Qwen3", index), "qwen");
  });

  it("returns null for an unknown org rather than guessing", () => {
    assert.equal(resolveEntityRef("some-two-person-team/thing", index), null);
  });
});

describe("harvestEvents", () => {
  it("attributes drops, releases and repos to the right entity", () => {
    const { events } = harvestEvents(
      {
        modelDrops: [drop("deepseek-ai/DeepSeek-V4", 2)],
        releases: [release("QwenLM/Qwen-Agent", 1)],
        repos: [repo("mistralai/mistral-src")],
      },
      { nowMs: NOW }
    );
    const ids = events.map((e) => e.entityId).sort();
    assert.deepEqual(ids, ["deepseek", "mistral", "qwen"]);
  });

  it("attaches a source receipt to every event", () => {
    const { events } = harvestEvents({ modelDrops: [drop("Qwen/Qwen3-Next", 1)] }, { nowMs: NOW });
    assert.equal(events.length, 1);
    assert.match(events[0].evidence.source, /huggingface/);
    assert.equal(events[0].evidence.ref, "Qwen/Qwen3-Next");
    assert.ok(events[0].evidence.fetchedAt);
  });

  it("creates a provisional entity for an unknown org instead of dropping it", () => {
    // This is how the Startups desk gets populated at all — the registry grows
    // from the flow rather than only from the curated roster.
    const { entities } = harvestEvents({ repos: [repo("tiny-team/pgvectorlite")] }, { nowMs: NOW });
    assert.ok(entities.has("org:tiny-team"));
    assert.equal(entities.get("org:tiny-team").curated, false);
  });
});

describe("watched repos + signals", () => {
  it("contributes the roster's own repos to the releases watchlist", () => {
    // The registry was downstream of feeds that never looked at its roster:
    // Vercel and Supabase push daily and nothing was watching them.
    const repos = watchedRepos();
    assert.ok(repos.includes("vercel/next.js"));
    assert.ok(repos.includes("supabase/supabase"));
    assert.equal(new Set(repos).size, repos.length, "watchlist must be deduped");
  });

  it("marks weights publishers and repo-shippers as observed", () => {
    assert.deepEqual(withSignals({ id: "deepseek" }).signals, ["weights"]);
    assert.deepEqual(withSignals({ id: "supabase" }).signals, ["repos"]);
    assert.deepEqual(withSignals({ id: "huggingface" }).signals, ["weights", "repos"]);
  });

  it("marks product-shipping companies as unobserved rather than silent", () => {
    for (const id of ["openai", "anthropic", "perplexity", "anysphere"]) {
      assert.deepEqual(withSignals({ id }).signals, [], `${id} has no watched channel`);
    }
  });

  it("carries observability into the rollup", () => {
    const { entities } = buildRegistry({ modelDrops: [] }, { nowMs: NOW });
    assert.equal(entities.find((e) => e.id === "openai").stats.observed, false);
    assert.equal(entities.find((e) => e.id === "deepseek").stats.observed, true);
  });

  it("treats a provisional org as observed — it arrived through a channel we watch", () => {
    const { entities } = buildRegistry(
      { repos: [repo("tiny-team/thing", { orgAgeDays: 300, starDelta: 900 })] },
      { nowMs: NOW }
    );
    assert.equal(entities.find((e) => e.id === "org:tiny-team").stats.observed, true);
  });
});

describe("classifyTier", () => {
  it("lets a curated tier win outright — data never overrides editorial", () => {
    const entity = { id: "mistral", tier: TIER_BIG_LAB };
    assert.equal(classifyTier(entity, { oldestRepoDays: 4000, starDelta7d: 0 }), TIER_BIG_LAB);
  });

  it("derives startup from org age plus traction", () => {
    const entity = { id: "org:tiny-team", tier: null };
    assert.equal(classifyTier(entity, { oldestRepoDays: 300, starDelta7d: 900 }), TIER_STARTUP);
  });

  it("returns null for a young org with no traction rather than promoting it", () => {
    const entity = { id: "org:quiet", tier: null };
    assert.equal(classifyTier(entity, { oldestRepoDays: 100, starDelta7d: 5, releases30d: 0 }), null);
  });

  it("returns null for an old unresolved org — age alone is not a stage", () => {
    const entity = { id: "org:ancient", tier: null };
    assert.equal(classifyTier(entity, { oldestRepoDays: 3000, starDelta7d: 5000 }), null);
  });

  it("never derives the unicorn tier from data", () => {
    // Unicorn is curated-only by construction: deriving it would mean asserting
    // a valuation the paper has no source for.
    const derived = classifyTier({ id: "org:whoever", tier: null }, { oldestRepoDays: 200, starDelta7d: 99999 });
    assert.notEqual(derived, TIER_UNICORN);
  });
});

describe("deriveBadges", () => {
  it("marks a lab that shipped this week as shipping", () => {
    const badges = deriveBadges({ tier: TIER_BIG_LAB }, { lastActivityDays: 2, openWeights: true });
    const ids = badges.map((b) => b.id);
    assert.ok(ids.includes("big-lab"));
    assert.ok(ids.includes("shipping"));
    assert.ok(ids.includes("open-weights"));
  });

  it("marks a month of silence as quiet", () => {
    const ids = deriveBadges({ tier: TIER_BIG_LAB }, { lastActivityDays: 41 }).map((b) => b.id);
    assert.ok(ids.includes("quiet"));
    assert.ok(!ids.includes("shipping"));
  });
});

describe("buildRegistry", () => {
  const sources = {
    modelDrops: [drop("deepseek-ai/DeepSeek-V4", 2, { likes: 900 })],
    releases: [release("QwenLM/Qwen-Agent", 1), release("QwenLM/Qwen-Agent", 5, "v0.9.0")],
    repos: [repo("tiny-team/pgvectorlite", { orgAgeDays: 330, starDelta: 3100, pushedDays: 1 })],
  };

  it("rolls activity up per entity", () => {
    const { entities } = buildRegistry(sources, { nowMs: NOW });
    const qwen = entities.find((e) => e.id === "qwen");
    assert.equal(qwen.stats.releases30d, 2);
    assert.equal(qwen.stats.lastActivityDays, 1);
    const ds = entities.find((e) => e.id === "deepseek");
    assert.equal(ds.stats.drops30d, 1);
    assert.equal(ds.stats.openWeights, true);
  });

  it("promotes an unknown small team to the startup tier", () => {
    const { entities } = buildRegistry(sources, { nowMs: NOW });
    const tiny = entities.find((e) => e.id === "org:tiny-team");
    assert.ok(tiny, "provisional entity should survive into the registry");
    assert.equal(tiny.tier, TIER_STARTUP);
    assert.equal(tiny.stats.starDelta7d, 3100);
  });

  it("keeps curated labs with no activity — an absence is reportable, but only if tracked", () => {
    const { entities } = buildRegistry(sources, { nowMs: NOW });
    const mistral = entities.find((e) => e.id === "mistral");
    assert.ok(mistral, "a quiet roster lab must stay in the registry");
    assert.equal(mistral.stats.eventCount, 0);
    assert.equal(mistral.stats.lastActivityDays, null);
  });

  it("drops an unresolved org that never earned a tier", () => {
    const { entities } = buildRegistry(
      { repos: [repo("nobody/whatever", { orgAgeDays: 5000, starDelta: 1 })] },
      { nowMs: NOW }
    );
    assert.equal(entities.some((e) => e.id === "org:nobody"), false);
  });

  it("carries coverage history into stats so companies become recurring characters", () => {
    const history = new Map([["deepseek", { storyCount: 31, firstSeen: "2026-01-14" }]]);
    const { entities } = buildRegistry(sources, { nowMs: NOW, history });
    const ds = entities.find((e) => e.id === "deepseek");
    assert.equal(ds.stats.storyCount, 31);
    assert.equal(ds.stats.firstSeen, "2026-01-14");
  });

  it("models no funding, valuation, headcount or revenue anywhere", () => {
    // Guardrail test: the one failure mode a business desk cannot survive is a
    // number with no fetch behind it. Keep the shape incapable of carrying one.
    const { entities } = buildRegistry(sources, { nowMs: NOW });
    const banned = ["valuation", "funding", "raised", "headcount", "revenue", "arr"];
    const blob = JSON.stringify(entities.map((e) => e.stats)).toLowerCase();
    for (const word of banned) assert.equal(blob.includes(word), false, `stats must not carry "${word}"`);
  });

  it("every seeded entity has a valid tier and a unique id", () => {
    const ids = SEED_ENTITIES.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate entity id in the roster");
    for (const e of SEED_ENTITIES) {
      // Startup is now a curated tier too — the roster spine (see
      // src/startup-roster.js) seeds it, alongside the derived path below.
      assert.ok(
        [TIER_BIG_LAB, TIER_UNICORN, TIER_STARTUP].includes(e.tier),
        `${e.id} has a bad curated tier`
      );
    }
  });

  it("no alias is claimed by two entities", () => {
    // A collision would silently file one company's artifacts under another.
    const seen = new Map();
    for (const e of SEED_ENTITIES) {
      // Dedupe within the entity first — an org publishing under the same name on
      // GitHub and HF is normal, two DIFFERENT entities claiming it is the bug.
      const own = new Set([...(e.github || []), ...(e.hf || [])].map((a) => a.toLowerCase()));
      for (const key of own) {
        assert.equal(seen.has(key), false, `alias "${key}" claimed by ${seen.get(key)} and ${e.id}`);
        seen.set(key, e.id);
      }
    }
  });
});
