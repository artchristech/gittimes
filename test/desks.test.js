const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDesk,
  buildBusinessDesks,
  buildBusinessStrip,
  ledgerRow,
  DESK_ORDER,
} = require("../src/desks");
const {
  buildRegistry,
  CURATED_ENTITIES,
  TIER_BIG_LAB,
  TIER_STARTUP,
  TIER_UNICORN,
} = require("../src/registry");

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

describe("observability — silence vs. blind spot", () => {
  it("never calls a lab quiet when it ships outside the channels we watch", () => {
    // OpenAI and Anthropic ship products, not weights, and have no watched
    // repos. The old ledger printed "nothing shipped in this window" about
    // companies that shipped that week — reporting our blind spot as news.
    const { entities } = fixture();
    const desk = buildDesk("bigLabs", entities);
    for (const id of ["openai", "anthropic"]) {
      const row = desk.items.find((i) => i.entityId === id);
      if (!row) continue;
      assert.equal(row.quiet, false, `${id} must not be labelled quiet`);
      assert.equal(row.observed, false);
    }
  });

  it("still calls an open-weights lab quiet when it genuinely goes dark", () => {
    // The fix must not blunt the actual finding: Mistral publishes weights, so
    // a silent window IS measured and IS the story.
    const history = new Map([["mistral", { storyCount: 40, firstSeen: "2026-01-02" }]]);
    const { entities } = buildRegistry({ modelDrops: [drop("Qwen/Qwen3-Next", 1)] }, { nowMs: NOW, history });
    const row = buildDesk("bigLabs", entities).items.find((i) => i.quiet);
    assert.equal(row.entityId, "mistral");
    assert.equal(row.observed, true);
  });

  it("keeps unobserved companies out of the reserved quiet slots", () => {
    const { entities } = fixture();
    const desk = buildDesk("bigLabs", entities);
    for (const row of desk.items.filter((i) => i.quiet)) assert.equal(row.observed, true);
  });

  it("declares which signals it watched for each company", () => {
    const { entities } = fixture();
    const desk = buildDesk("bigLabs", entities);
    const ds = desk.items.find((i) => i.entityId === "deepseek");
    assert.ok(ds.signals.includes("weights"));
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

describe("a sighting is not a ship", () => {
  // The live ledger printed `Meta AI | pytorch/pytorch | 0 releases | 0 drops |
  // today` and `Microsoft | microsoft/PowerToys`. Both rows came from a repo
  // turning up in the day's trending set. Appearing in trending is evidence a
  // repo is moving; it is not evidence the lab shipped anything, and the "most
  // recent ship" column is not allowed to say otherwise.
  // A two-lab roster keeps the assertions about WHICH rows appear, rather than
  // about how the reserved quiet slots happened to be allotted today.
  const seeds = CURATED_ENTITIES.filter((e) => ["meta-ai", "nvidia", "openai"].includes(e.id));
  const registry = (sources) => buildRegistry(sources, { entities: seeds, nowMs: NOW });
  // Every lab on the roster gets a row, so these assertions are about what the
  // ship column SAYS, not about which two quiet slots today's ranking allotted.
  const DESKS_ALL = {
    bigLabs: {
      id: "bigLabs",
      label: "Big Labs",
      slug: "big-labs",
      tier: TIER_BIG_LAB,
      kicker: "Who shipped, who went quiet",
      cadence: "daily",
      minItems: 0,
      maxItems: 20,
      windowDays: 30,
      includeQuiet: true,
      shipsOnly: true,
      quietSlots: 20,
    },
  };
  const ledger = (entities) => buildDesk("bigLabs", entities, { desks: DESKS_ALL });
  const sightingOnly = () => registry({ repos: [repo("pytorch/pytorch", { pushedDays: 0 })] });

  it("leaves the ship column empty when a lab only appeared in trending", () => {
    const { entities } = sightingOnly();
    const desk = ledger(entities);
    const meta = desk.items.find((r) => r.entityId === "meta-ai");
    assert.equal(meta.shipped, null, "a trending sighting must not render as a ship");
    assert.equal(meta.releases30d, 0);
    assert.equal(meta.drops30d, 0);
  });

  it("never prints a bare repo name in the ship column", () => {
    const { entities } = sightingOnly();
    const desk = ledger(entities);
    for (const row of desk.items) {
      if (!row.shipped) continue;
      assert.equal(
        /^[\w.-]+\/[\w.-]+$/.test(row.shipped),
        false,
        `"${row.shipped}" is a repo reference, not a ship`
      );
    }
  });

  it("does not let a sighting reset the last-ship clock", () => {
    const { entities } = registry({
      repos: [repo("pytorch/pytorch", { pushedDays: 0 })],
      releases: [release("pytorch/pytorch", 40, "v2.9.0")],
    });
    const row = ledger(entities).items.find((r) => r.entityId === "meta-ai");
    assert.equal(row.lastShippedDays, 40, "last ship is the release, not today's sighting");
    assert.equal(row.quiet, true, "40 days without a ship is quiet, whatever trending shows");
  });

  it("still calls an unobserved lab not-covered rather than quiet", () => {
    // The contract this desk runs on: silence counts only where a watched
    // channel would have revealed shipping.
    const { entities } = registry({});
    const openai = entities.find((e) => e.id === "openai");
    assert.equal(openai.stats.observed, false);
    assert.equal(ledgerRow(openai).quiet, false, "a blind spot is never reported as silence");
    // And it is never ranked into a reserved quiet slot, however dark the desk.
    assert.equal(ledger(entities).items.some((r) => r.entityId === "openai"), false);
    assert.ok(ledger(entities).unobserved.includes("OpenAI"));
  });

  it("reports a weights publisher that shipped, rather than ranking it out", () => {
    // NVIDIA published weights all week and the ledger said it had shipped
    // nothing — because the registry was fed the six-row drops band instead of
    // the release log. With the log, the drop is the row.
    const { entities } = registry({ modelDrops: [drop("nvidia/Nemotron-Next", 2)] });
    const row = ledger(entities).items.find((r) => r.entityId === "nvidia");
    assert.equal(row.shipped, "Nemotron-Next");
    assert.equal(row.quiet, false);
    assert.equal(row.evidence.source, "huggingface:/api/models");
  });
});

describe("cards print news, not inventory", () => {
  // The live Unicorns cards led with "Org age 9.9y · Repos tracked 1". Neither
  // is a fact about the company: org age is a constant, and "repos tracked" is
  // a statement about how much of them this paper watches — a measurement
  // artifact set in the same typeface as a finding.
  const shipped = () =>
    buildRegistry(
      { releases: [release("qdrant/qdrant", 2, "v1.20.0")] },
      { nowMs: NOW }
    );

  it("never prints org age or repo count for a decade-old company", () => {
    const { entities } = shipped();
    const c = buildDesk("unicorns", entities).items.find((i) => i.entityId === "qdrant");
    const keys = c.facts.map((f) => f.k).join(" | ");
    assert.doesNotMatch(keys, /repos tracked/i, "repos tracked is our instrument, not their news");
    assert.doesNotMatch(keys, /^org age/i);
  });

  it("leads with when they last shipped and how often", () => {
    const { entities } = shipped();
    const c = buildDesk("unicorns", entities).items.find((i) => i.entityId === "qdrant");
    const facts = c.facts.map((f) => `${f.v} ${f.k}`);
    assert.ok(facts.some((f) => /since last ship/.test(f)), `no ship recency in ${facts}`);
    assert.ok(facts.some((f) => /release/.test(f)), `no cadence in ${facts}`);
    assert.equal(c.kind, "release");
    assert.equal(c.shipped, true);
  });

  it("keeps a young team's age, which is still news", () => {
    const { entities } = buildRegistry(
      { repos: [repo("tiny-team/pgvectorlite", { orgAgeDays: 240, starDelta: 3100 })] },
      { nowMs: NOW }
    );
    const c = buildDesk("startups", entities).items.find((i) => i.entityId === "org:tiny-team");
    assert.ok(c.facts.some((f) => /first repo/.test(f.k)), "a team eight months old is a young team");
  });

  it("marks a trending sighting as a sighting, not as a ship", () => {
    // The card still runs — for a small team, a repo pulling 3,000 stars in a
    // week is the only story the pipeline can see before a first release. It
    // must not be dressed as one.
    const { entities } = buildRegistry(
      { repos: [repo("tiny-team/pgvectorlite", { orgAgeDays: 240, starDelta: 3100 })] },
      { nowMs: NOW }
    );
    const c = buildDesk("startups", entities).items.find((i) => i.entityId === "org:tiny-team");
    assert.equal(c.kind, "repo");
    assert.equal(c.shipped, false, "a sighting must never claim a ship");
    assert.equal(c.evidence.source, "github:/search/repositories");
  });

  it("tracks the companies whose repos the paper already watched", () => {
    // The desk read thin at fourteen tracked because nothing in the registry
    // knew qdrant/qdrant had an owner.
    const { entities } = shipped();
    const tracked = buildDesk("unicorns", entities).tracked;
    assert.ok(tracked >= 20, `only ${tracked} scaled-private companies tracked`);
  });
});
