const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { buildSectorDesk, sectorOf, SECTOR_ORDER } = require("../src/sectors");
const { buildRegistry, CURATED_ENTITIES } = require("../src/registry");
const { renderSectorsPage } = require("../src/business-pages");

const NOW = Date.parse("2026-07-29T00:00:00Z");
const iso = (d) => new Date(NOW - d * 86400000).toISOString();

const repo = (fullName, opts = {}) => ({
  full_name: fullName,
  html_url: `https://github.com/${fullName}`,
  created_at: iso(opts.orgAgeDays ?? 900),
  pushed_at: iso(opts.pushedDays ?? 1),
  stargazers_count: opts.stars ?? 900,
  starDelta: opts.starDelta ?? 400,
  language: opts.language || null,
  topics: opts.topics || [],
});
const drop = (id, ageDays) => ({
  id,
  author: id.split("/")[0],
  name: id.split("/")[1],
  likes: 400,
  downloads: 0,
  createdAt: iso(ageDays),
  ageDays,
  url: `https://huggingface.co/${id}`,
});

describe("sectorOf", () => {
  it("files a repo on the owner's own topics", () => {
    const ev = { type: "repo", metrics: { repo: "a/b", topics: ["ros", "drone"] } };
    assert.equal(sectorOf(ev), "robotics");
  });

  it("falls back to language, the way the Systems section is defined", () => {
    const ev = { type: "repo", metrics: { repo: "a/b", topics: [], language: "Rust" } };
    assert.equal(sectorOf(ev), "systems");
  });

  it("files a published model under AI, which is definitional", () => {
    assert.equal(sectorOf({ type: "model-drop", metrics: {} }), "ai");
  });

  it("returns null rather than guessing a sector", () => {
    // Defaulting an unfiled artifact into AI would make the sector counts a
    // report on that default rather than on what shipped.
    const ev = { type: "release", metrics: { repo: "a/b", topics: [], language: "COBOL" } };
    assert.equal(sectorOf(ev), null);
  });

  it("borrows a release's sector from its own repo's topics", () => {
    const topicsByRepo = new Map([["a/b", ["cybersecurity"]]]);
    const ev = { type: "release", metrics: { repo: "a/b" } };
    assert.equal(sectorOf(ev, { topicsByRepo }), "cyber");
  });
});

describe("buildSectorDesk", () => {
  const seeds = CURATED_ENTITIES.filter((e) => ["meta-ai", "nvidia"].includes(e.id));
  const build = (sources, opts = {}) => {
    const { entities } = buildRegistry(sources, { entities: seeds, nowMs: NOW });
    return buildSectorDesk(entities, { nowMs: NOW, ...opts });
  };

  it("answers who shipped into a sector, which no other page does", () => {
    const desk = build({
      repos: [repo("pytorch/pytorch", { topics: ["deep-learning"], pushedDays: 1 })],
      modelDrops: [drop("nvidia/Nemotron-Next", 2)],
    });
    const ai = desk.sectors.find((s) => s.id === "ai");
    assert.deepEqual(
      ai.companies.map((c) => c.name).sort(),
      ["Meta AI", "NVIDIA"]
    );
    assert.equal(desk.empty, false);
  });

  it("prints an empty sector rather than hiding it", () => {
    // The absence is the finding. A page that drops its empty sectors reports a
    // fuller world than it measured.
    const desk = build({ modelDrops: [drop("nvidia/Nemotron-Next", 2)] });
    const robotics = desk.sectors.find((s) => s.id === "robotics");
    assert.equal(robotics.empty, true);
    assert.equal(robotics.companies.length, 0);
    assert.equal(desk.sectors.length, SECTOR_ORDER.length);
  });

  it("counts what it could not file instead of forcing it into a sector", () => {
    const desk = build({
      repos: [repo("pytorch/pytorch", { topics: ["knitting"], language: null })],
    });
    assert.equal(desk.unclassified, 1);
    assert.equal(desk.classified, 0);
    assert.equal(desk.empty, true);
  });

  it("marks a trending sighting as a sighting, not a ship", () => {
    const desk = build({
      repos: [repo("pytorch/pytorch", { topics: ["deep-learning"], pushedDays: 1 })],
    });
    const row = desk.sectors.find((s) => s.id === "ai").companies[0];
    assert.equal(row.kind, "repo");
    assert.equal(row.shipped, false);
    assert.ok(row.evidence.source);
  });

  it("gives a company one row per sector, not one per artifact", () => {
    const desk = build({
      modelDrops: [drop("nvidia/A", 1), drop("nvidia/B", 3), drop("nvidia/C", 5)],
    });
    const ai = desk.sectors.find((s) => s.id === "ai");
    assert.equal(ai.companies.filter((c) => c.entityId === "nvidia").length, 1);
    assert.equal(ai.companies[0].headline, "A", "the freshest artifact wins the row");
  });

  it("ignores artifacts outside the window", () => {
    const desk = build({ modelDrops: [drop("nvidia/Old", 200)] }, { windowDays: 30 });
    assert.equal(desk.classified, 0);
  });
});

describe("the Sectors page", () => {
  it("renders sectors, receipts and the not-claimed line", () => {
    const seeds = CURATED_ENTITIES.filter((e) => e.id === "nvidia");
    const { entities } = buildRegistry(
      { modelDrops: [drop("nvidia/Nemotron-Next", 2)] },
      { entities: seeds, nowMs: NOW }
    );
    const html = renderSectorsPage(buildSectorDesk(entities, { nowMs: NOW }));
    assert.match(html, /NVIDIA/);
    assert.match(html, /Nemotron-Next/);
    assert.match(html, /huggingface:\/api\/models/);
    assert.match(html, /Robotics/, "an empty sector is still on the page");
    assert.match(html, /Not claimed/);
  });

  it("says how a sector was decided, so the reader can check the method", () => {
    const html = renderSectorsPage(
      buildSectorDesk(
        buildRegistry(
          { modelDrops: [drop("nvidia/N", 1)] },
          { entities: CURATED_ENTITIES.filter((e) => e.id === "nvidia"), nowMs: NOW }
        ).entities,
        { nowMs: NOW }
      )
    );
    assert.match(html, /How a sector is decided/);
    assert.match(html, /own GitHub topics/);
  });

  it("runs the page dark rather than inventing sectors", () => {
    const html = renderSectorsPage(buildSectorDesk([], { nowMs: NOW }));
    assert.match(html, /Nothing to report/);
  });
});
