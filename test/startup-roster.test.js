const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  loadStartupRoster,
  rosterEntities,
  rosterRepos,
} = require("../src/startup-roster");
const {
  SEED_ENTITIES,
  ROSTER_STARTUPS,
  TIER_STARTUP,
  buildRegistry,
  classifyTier,
  watchedRepos,
  withSignals,
} = require("../src/registry");
const { buildDesk } = require("../src/desks");
const { WATCHED_REPOS } = require("../src/github-releases");

const NOW = Date.UTC(2026, 7, 21);
const iso = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString();

describe("the startup roster file", () => {
  const roster = loadStartupRoster();

  it("carries its provenance, not just its names", () => {
    // A roster with no receipt is a list someone typed. The whole reason the
    // Business pages are allowed to name private companies is that membership
    // is itself a fetched record.
    assert.ok(roster.provenance, "roster must declare where it came from");
    assert.ok(roster.provenance.fund);
    assert.match(roster.provenance.dataset, /^https:\/\//);
    assert.match(roster.provenance.sourcedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(roster.companies.length > 0);
  });

  it("gives every company a source URL, a GitHub org and a product repo", () => {
    for (const c of roster.companies) {
      assert.match(c.ycUrl || "", /^https:\/\//, `${c.id} has no source URL`);
      assert.ok(c.github && c.github.length > 0, `${c.id} has no GitHub org`);
      for (const r of c.repos || []) {
        assert.match(r, /^[^/\s]+\/[^/\s]+$/, `${c.id} has a malformed repo ref`);
      }
    }
  });

  it("claims no valuation, funding, headcount or revenue anywhere", () => {
    const blob = JSON.stringify(roster.companies).toLowerCase();
    for (const word of ["valuation", "raised", "headcount", "revenue", "arr", "$"]) {
      assert.equal(blob.includes(word), false, `roster must not carry "${word}"`);
    }
  });

  it("resolves to entities with no duplicate ids or aliases", () => {
    const entities = rosterEntities(roster);
    const ids = entities.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate roster id");
    const seen = new Map();
    for (const e of SEED_ENTITIES) {
      for (const alias of new Set([...(e.github || []), ...(e.hf || [])].map((a) => a.toLowerCase()))) {
        assert.equal(seen.has(alias), false, `alias "${alias}" claimed twice`);
        seen.set(alias, e.id);
      }
    }
  });

  it("stays inside the releases API budget once merged with the watchlist", () => {
    // MAX_WATCHED is a hard per-run budget; silently overflowing it would
    // reproduce the exact bug the roster fixes — a rostered company that
    // nothing is watching.
    const merged = new Set([...WATCHED_REPOS, ...watchedRepos()]);
    assert.ok(merged.size <= 90, `watchlist is ${merged.size}, over the 90-call budget`);
    for (const r of rosterRepos(roster)) assert.ok(merged.has(r), `${r} never reaches the fetcher`);
  });
});

describe("the roster as the Startups spine", () => {
  it("seeds curated startup entities", () => {
    assert.ok(ROSTER_STARTUPS.length > 0);
    for (const e of ROSTER_STARTUPS) assert.equal(e.tier, TIER_STARTUP);
  });

  it("does not replace the derived tier — an unrostered team can still qualify", () => {
    // The roster is a floor, not a gate. A young org with real traction reaches
    // the desk on what it shipped, exactly as before.
    const derived = classifyTier({ id: "org:nobody" }, { oldestRepoDays: 200, starDelta7d: 900 });
    assert.equal(derived, TIER_STARTUP);
  });

  it("gives a rostered company a watched channel, so its silence is measurable", () => {
    const withRepo = ROSTER_STARTUPS.find((e) => (e.repos || []).length > 0);
    assert.deepEqual(withSignals(withRepo).signals, ["repos"]);
  });

  it("never calls a rostered company quiet when nothing watches it", () => {
    // The observability contract: a name is not a channel. A roster row with no
    // verified repo is NOT COVERED, and must never hold a quiet slot or be
    // ranked as inactive.
    const nameOnly = { id: "yc-nochannel", name: "No Channel", tier: TIER_STARTUP, github: ["nochannel"], hf: [], domains: [], repos: [] };
    const { entities } = buildRegistry(
      {},
      { entities: [nameOnly], nowMs: NOW }
    );
    const rec = entities.find((e) => e.id === "yc-nochannel");
    assert.equal(rec.stats.observed, false);
    assert.equal(rec.badges.some((b) => b.id === "quiet"), false, "unobserved is not quiet");
  });

  it("fills the Startups desk from roster releases instead of running dark", () => {
    // The failing surface this roster exists to fix: /startups/ printed its
    // empty state indefinitely because the derived tier cleared almost nobody.
    const seeds = ROSTER_STARTUPS.slice(0, 3);
    const releases = seeds.map((e, i) => ({
      repo: e.repos[0],
      name: e.repos[0].split("/")[1],
      tag: `v1.${i}.0`,
      publishedAt: iso(i + 1),
      ageDays: i + 1,
      url: `https://github.com/${e.repos[0]}/releases/tag/v1.${i}.0`,
    }));
    const { entities } = buildRegistry({ releases }, { entities: seeds, nowMs: NOW });
    const desk = buildDesk("startups", entities);
    assert.equal(desk.empty, false, "desk must render rows, not its empty state");
    assert.ok(desk.items.length >= 1);
    for (const item of desk.items) {
      assert.ok(item.headline, "a card without a shipped artifact is not a row");
      assert.ok(item.evidence && item.evidence.source, "every card prints its receipt");
    }
  });

  it("prints the backer and batch, which are matters of public record", () => {
    const seed = ROSTER_STARTUPS[0];
    const releases = [
      {
        repo: seed.repos[0],
        name: seed.repos[0].split("/")[1],
        tag: "v9.9.9",
        publishedAt: iso(1),
        ageDays: 1,
        url: "https://example.invalid/r",
      },
    ];
    const { entities } = buildRegistry({ releases }, { entities: [seed], nowMs: NOW });
    const desk = buildDesk("startups", entities);
    const facts = desk.items[0].facts.map((f) => `${f.v} ${f.k}`).join(" | ");
    assert.match(facts, /Y Combinator/);
    assert.equal(desk.items[0].notClaimed.includes("valuation"), true);
  });
});
