const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { buildDesk, buildBusinessDesks, buildBusinessStrip, DESK_ORDER } = require("../src/desks");
const { buildRegistry, TIER_BIG_LAB, TIER_STARTUP, TIER_UNICORN } = require("../src/registry");

const NOW = Date.parse("2026-07-29T00:00:00Z");
const iso = (d) => new Date(NOW - d * 86400000).toISOString();

const drop = (id, ageDays, likes = 300) => ({
  id,
  author: id.split("/")[0],
  name: id.split("/")[1],
  likes,
  downloads: 0,
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
  reactions: 30,
  publishedAt: iso(ageDays),
  ageDays,
  url: `https://github.com/${repo}/releases/tag/${tag}`,
});
const repo = (fullName, opts = {}) => ({
  full_name: fullName,
  html_url: `https://github.com/${fullName}`,
  created_at: iso(opts.orgAgeDays ?? 3000),
  pushed_at: iso(opts.pushedDays ?? 1),
  stargazers_count: opts.stars ?? 500,
  starDelta: opts.starDelta ?? null,
});

/** A registry with all three tiers represented. */
function fixture() {
  return buildRegistry(
    {
      modelDrops: [drop("deepseek-ai/DeepSeek-V4", 2), drop("Qwen/Qwen3-Next", 1)],
      releases: [release("QwenLM/Qwen-Agent", 1), release("huggingface/transformers", 3, "v5.2.0")],
      repos: [
        repo("tiny-team/pgvectorlite", { orgAgeDays: 330, starDelta: 3100, pushedDays: 1 }),
        repo("solo-dev/buildkit", { orgAgeDays: 210, starDelta: 840, pushedDays: 2 }),
      ],
    },
    { nowMs: NOW }
  );
}

describe("buildDesk — Big Labs", () => {
  it("reserves slots for quiet roster labs, because silence is the beat", () => {
    const { entities } = fixture();
    const desk = buildDesk("bigLabs", entities);
    const quiet = desk.items.filter((i) => i.quiet);
    assert.ok(quiet.length > 0, "a lab with nothing shipped must still reach the ledger");
    assert.ok(quiet.length <= 2, "quiet rows must not crowd out the shippers");
    for (const row of quiet) assert.equal(row.shipped, null);
  });

  it("gives the quiet slot to the company the paper covers most", () => {
    // A lab we've written about thirty times going dark is news; one we've
    // mentioned once is a gap in our data, not a story.
    const history = new Map([["mistral", { storyCount: 40, firstSeen: "2026-01-02" }]]);
    const { entities } = buildRegistry(
      { modelDrops: [drop("Qwen/Qwen3-Next", 1)] },
      { nowMs: NOW, history }
    );
    const desk = buildDesk("bigLabs", entities);
    const firstQuiet = desk.items.find((i) => i.quiet);
    assert.equal(firstQuiet.entityId, "mistral");
  });

  it("ranks the freshest shipper first", () => {
    const { entities } = fixture();
    const desk = buildDesk("bigLabs", entities);
    assert.equal(desk.items[0].quiet, false);
    assert.ok(desk.items[0].lastShippedDays <= desk.items[1].lastShippedDays);
  });

  it("carries the evidence receipt on every row that makes a claim", () => {
    const { entities } = fixture();
    const desk = buildDesk("bigLabs", entities);
    for (const row of desk.items.filter((i) => i.shipped)) {
      assert.ok(row.evidence && row.evidence.source, `${row.name} claims a ship with no source`);
      assert.ok(row.evidence.fetchedAt);
    }
  });

  it("exposes no funding or valuation field", () => {
    const { entities } = fixture();
    const blob = JSON.stringify(buildDesk("bigLabs", entities)).toLowerCase();
    for (const w of ["valuation", "funding", "raised", "headcount", "revenue"]) {
      assert.equal(blob.includes(`"${w}"`), false, `ledger must not carry a ${w} field`);
    }
  });
});

describe("buildDesk — Startups", () => {
  it("selects derived small teams, capped at the desk budget", () => {
    const { entities } = fixture();
    const desk = buildDesk("startups", entities);
    assert.equal(desk.empty, false);
    assert.ok(desk.items.length <= 3);
    assert.ok(desk.items.every((c) => entities.find((e) => e.id === c.entityId).tier === TIER_STARTUP));
  });

  it("prints only facts the pipeline fetched, and names what it does not claim", () => {
    const { entities } = fixture();
    const card = buildDesk("startups", entities).items[0];
    assert.ok(card.facts.length > 0);
    assert.deepEqual(card.notClaimed, ["valuation", "funding", "headcount", "revenue"]);
    assert.ok(card.evidence.source);
  });
});

describe("empty states", () => {
  it("runs a desk dark rather than padding it — the cadence rule", () => {
    // Unicorn-tier movement is monthly at best. On a week with none, the desk
    // must say so; a fixed budget here is an invitation to fabricate.
    const { entities } = buildRegistry({ modelDrops: [drop("deepseek-ai/DeepSeek-V4", 2)] }, { nowMs: NOW });
    const desk = buildDesk("unicorns", entities);
    assert.equal(desk.empty, true);
    assert.deepEqual(desk.items, []);
    assert.match(desk.reason, /No unicorns movement/i);
  });

  it("treats stale activity as no activity", () => {
    const { entities } = buildRegistry(
      { releases: [release("huggingface/transformers", 200, "v4.0.0")] },
      { nowMs: NOW }
    );
    const desk = buildDesk("unicorns", entities);
    assert.equal(desk.empty, true);
  });

  it("never asks a desk to fill a hole it cannot fill honestly", () => {
    const { entities } = buildRegistry({}, { nowMs: NOW });
    for (const id of DESK_ORDER) {
      const desk = buildDesk(id, entities);
      assert.equal(desk.empty, true);
      assert.deepEqual(desk.items, []);
    }
  });
});

describe("buildBusinessDesks / strip", () => {
  it("builds all three desks in order", () => {
    const { entities } = fixture();
    const desks = buildBusinessDesks(entities);
    assert.deepEqual(Object.keys(desks), DESK_ORDER);
  });

  it("emits one strip line per desk, with the empty ones saying why", () => {
    const { entities } = fixture();
    const strip = buildBusinessStrip(buildBusinessDesks(entities));
    assert.equal(strip.length, 3);
    for (const s of strip) assert.ok(s.line, `${s.label} strip line is blank`);
    const unicorns = strip.find((s) => s.deskId === "unicorns");
    assert.equal(unicorns.signal === "quiet" || unicorns.signal === "flat" || unicorns.signal === "up", true);
  });

  it("writes silence as silence on the strip", () => {
    const { entities } = buildRegistry({ modelDrops: [drop("Qwen/Qwen3-Next", 1)] }, { nowMs: NOW });
    const strip = buildBusinessStrip(buildBusinessDesks(entities));
    const labs = strip.find((s) => s.deskId === "bigLabs");
    assert.ok(/shipped/.test(labs.line));
  });

  it("desks and registry agree on tier vocabulary", () => {
    assert.deepEqual([TIER_BIG_LAB, TIER_STARTUP, TIER_UNICORN].sort(), ["bigLab", "startup", "unicorn"]);
  });
});
