const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  entitySlug,
  assignSlugs,
  selectPageableEntities,
  renderDeskPage,
  renderCompanyIndexPage,
  renderEntityPage,
  writeBusinessPages,
} = require("../src/business-pages");
const { buildRegistry, TIER_BIG_LAB } = require("../src/registry");
const { buildBusinessDesks, buildDesk } = require("../src/desks");

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
const repo = (fullName, opts = {}) => ({
  full_name: fullName,
  html_url: `https://github.com/${fullName}`,
  created_at: iso(opts.orgAgeDays ?? 300),
  pushed_at: iso(opts.pushedDays ?? 1),
  stargazers_count: 500,
  starDelta: opts.starDelta ?? 900,
});

function fixture() {
  return buildRegistry(
    {
      modelDrops: [drop("deepseek-ai/DeepSeek-V4", 2), drop("Qwen/Qwen3-Next", 1)],
      repos: [repo("tiny-team/pgvectorlite")],
    },
    { nowMs: NOW }
  );
}

describe("entity slugs", () => {
  it("keeps curated ids as clean permanent addresses", () => {
    assert.equal(entitySlug("deepseek"), "deepseek");
    assert.equal(entitySlug("google-deepmind"), "google-deepmind");
  });

  it("strips the provisional prefix and sanitizes the login", () => {
    assert.equal(entitySlug("org:Tiny-Team"), "tiny-team");
    assert.equal(entitySlug("org:weird name/here"), "weird-name-here");
  });

  it("never yields an empty slug", () => {
    assert.equal(entitySlug("org:!!!"), "unknown");
    assert.equal(entitySlug(""), "unknown");
  });

  it("resolves collisions deterministically so a URL never changes owner", () => {
    const a = assignSlugs([{ id: "org:a.b" }, { id: "org:a-b" }]);
    const b = assignSlugs([{ id: "org:a-b" }, { id: "org:a.b" }]);
    assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
    assert.equal(new Set([...a.values()]).size, 2);
  });
});

describe("selectPageableEntities", () => {
  it("always gives a curated company a file, even a silent one", () => {
    const { entities } = fixture();
    const pageable = selectPageableEntities(entities);
    assert.ok(pageable.some((e) => e.id === "mistral"), "a silent roster lab still needs an address");
  });

  it("makes a provisional org earn its file by recurring", () => {
    const { entities } = fixture();
    const once = entities.find((e) => e.id === "org:tiny-team");
    assert.ok(once, "fixture should produce a one-appearance org");
    assert.equal(selectPageableEntities([once]).length, 0);

    const recurred = { ...once, stats: { ...once.stats, storyCount: 4 } };
    assert.equal(selectPageableEntities([recurred]).length, 1);
  });
});

describe("renderDeskPage", () => {
  it("renders the Big Labs ledger with a row per lab", () => {
    const { entities } = fixture();
    const html = renderDeskPage(buildDesk("bigLabs", entities));
    assert.match(html, /ledger-table/);
    assert.match(html, /DeepSeek/);
    assert.match(html, /Most recent ship/);
  });

  it("prints a source receipt beside every claim", () => {
    const { entities } = fixture();
    const html = renderDeskPage(buildDesk("bigLabs", entities));
    assert.match(html, /ent-evidence/);
    assert.match(html, /huggingface/);
  });

  it("renders silence as a row, not an omission", () => {
    const { entities } = fixture();
    const html = renderDeskPage(buildDesk("bigLabs", entities));
    assert.match(html, /nothing shipped in this window/);
    assert.match(html, /ledger-row-quiet/);
  });

  it("does not mark a quiet row 'no source' — that would report absence of activity as absence of sourcing", () => {
    const { entities } = fixture();
    const html = renderDeskPage(buildDesk("bigLabs", entities));
    assert.match(html, /nothing shipped in this window/, "fixture must contain a quiet row");
    assert.equal(html.includes("no source on file"), false);
  });

  it("gives a dark desk a designed empty state that says why", () => {
    const { entities } = buildRegistry({ modelDrops: [drop("Qwen/Qwen3-Next", 1)] }, { nowMs: NOW });
    const html = renderDeskPage(buildDesk("unicorns", entities));
    assert.match(html, /biz-empty/);
    assert.match(html, /Nothing to report/);
    assert.match(html, /allowed to come up empty/);
  });

  it("states what it does not claim on every desk page", () => {
    const { entities } = fixture();
    for (const desk of Object.values(buildBusinessDesks(entities))) {
      const html = renderDeskPage(desk);
      assert.match(html, /Not claimed/);
      assert.match(html, /valuation, funding, headcount, revenue/);
    }
  });

  it("links each company to its file", () => {
    const { entities } = fixture();
    const html = renderDeskPage(buildDesk("bigLabs", entities), { basePath: "/gt" });
    assert.match(html, /href="\/gt\/companies\/deepseek\/"/);
  });
});

describe("renderEntityPage", () => {
  const timeline = [
    {
      type: "model-drop",
      title: "DeepSeek-V4",
      url: "https://huggingface.co/deepseek-ai/DeepSeek-V4",
      occurredAt: "2026-07-27T00:00:00Z",
      editionDate: "2026-07-27",
      metrics: { likes: 900 },
      evidence: { source: "huggingface:/api/models", ref: "deepseek-ai/DeepSeek-V4", fetchedAt: "2026-07-29T00:00:00Z" },
    },
  ];

  it("renders the file with stats, badges and a dated timeline", () => {
    const { entities } = fixture();
    const ds = entities.find((e) => e.id === "deepseek");
    ds.stats.firstSeen = "2026-01-14";
    ds.stats.storyCount = 31;
    const html = renderEntityPage(ds, timeline);
    assert.match(html, /DeepSeek/);
    assert.match(html, /Tracked since/);
    assert.match(html, /2026-01-14/);
    assert.match(html, /ent-timeline/);
    assert.match(html, /DeepSeek-V4/);
  });

  it("carries the receipt into the timeline", () => {
    const { entities } = fixture();
    const ds = entities.find((e) => e.id === "deepseek");
    const html = renderEntityPage(ds, timeline);
    assert.match(html, /deepseek-ai\/DeepSeek-V4/);
    assert.match(html, /fetched 2026-07-29/);
  });

  it("handles a company with no events without looking broken", () => {
    const { entities } = fixture();
    const mistral = entities.find((e) => e.id === "mistral");
    const html = renderEntityPage(mistral, []);
    assert.match(html, /No events recorded yet/);
    assert.match(html, /none on file/);
  });

  it("escapes company-controlled text", () => {
    const evil = {
      id: "org:evil",
      name: '<script>alert(1)</script>',
      tier: TIER_BIG_LAB,
      stats: {},
      badges: [],
      github: ['<img src=x>'],
      hf: [],
    };
    const html = renderEntityPage(evil, [
      { type: "release", title: '<script>bad()</script>', url: "https://x.test", metrics: {}, evidence: {} },
    ]);
    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.equal(html.includes("<script>bad()</script>"), false);
    assert.equal(html.includes("<img src=x>"), false);
  });

  it("flags an event with no source instead of rendering it like a sourced one", () => {
    const { entities } = fixture();
    const ds = entities.find((e) => e.id === "deepseek");
    const html = renderEntityPage(ds, [
      { type: "release", title: "Unsourced thing", url: "https://x.test", metrics: {}, evidence: {} },
    ]);
    assert.match(html, /no source on file/);
  });
});

describe("renderCompanyIndexPage", () => {
  it("groups companies by tier and links each desk", () => {
    const { entities } = fixture();
    const html = renderCompanyIndexPage(selectPageableEntities(entities), { basePath: "" });
    assert.match(html, /Big Lab/);
    assert.match(html, /href="\/big-labs\/"/);
    assert.match(html, /href="\/companies\/deepseek\/"/);
  });
});

describe("writeBusinessPages", () => {
  let outDir;
  before(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-bizpages-"));
  });
  after(() => fs.rmSync(outDir, { recursive: true, force: true }));

  it("writes three desk pages, an index, and a file per company", () => {
    const { entities } = fixture();
    const desks = buildBusinessDesks(entities);
    const result = writeBusinessPages(outDir, {
      desks,
      entities,
      getTimeline: () => [],
    });

    for (const slug of ["big-labs", "startups", "unicorns", "companies"]) {
      assert.ok(fs.existsSync(path.join(outDir, slug, "index.html")), `${slug} page missing`);
    }
    assert.ok(fs.existsSync(path.join(outDir, "companies", "deepseek", "index.html")));
    assert.equal(result.desks, 3);
    assert.ok(result.companies > 0);
  });

  it("survives a timeline lookup that throws", () => {
    const { entities } = fixture();
    const result = writeBusinessPages(outDir, {
      desks: buildBusinessDesks(entities),
      entities,
      getTimeline: () => {
        throw new Error("db exploded");
      },
    });
    assert.ok(result.companies > 0);
    assert.ok(fs.existsSync(path.join(outDir, "companies", "deepseek", "index.html")));
  });

  it("produces pages with no inline event handlers (CSP forbids them)", () => {
    const html = fs.readFileSync(path.join(outDir, "big-labs", "index.html"), "utf-8");
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, "inline handler would be blocked by CSP");
  });
});
