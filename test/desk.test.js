const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const desk = require("../src/desk");
const { closeDb, getDb } = require("../src/db");
const { chooseLeadPrompt, lensLeadPrompt } = require("../src/prompts");

let dataDir;

const SLATE = [
  { repo: "acme/rocket", description: "A rocket", reason: "+1200 stars", chosen: false },
  { repo: "acme/quiet", description: "A quiet compiler", reason: "+300 stars", chosen: true },
  { repo: "acme/listicle", description: "Awesome list", reason: "+4000 stars", chosen: false },
];

before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-desk-"));
});

after(() => {
  closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = desk.ensureSchema(getDb(dataDir));
  db.exec("DELETE FROM lead_slate; DELETE FROM editor_picks; DELETE FROM editor_rubric;");
  const log = path.join(dataDir, desk.PICKS_LOG);
  if (fs.existsSync(log)) fs.rmSync(log);
});

describe("slate recording", () => {
  it("round-trips a slate in rank order", () => {
    desk.recordSlate(dataDir, "2026-08-01", SLATE);
    const got = desk.getSlate(dataDir, "2026-08-01");
    assert.deepEqual(got.map((c) => c.repo), ["acme/rocket", "acme/quiet", "acme/listicle"]);
    assert.equal(got[1].chosen, true);
    assert.equal(got[0].chosen, false);
    assert.equal(desk.getChosenRepo(dataDir, "2026-08-01"), "acme/quiet");
  });

  it("replaces rather than doubles on republish", () => {
    desk.recordSlate(dataDir, "2026-08-01", SLATE);
    desk.recordSlate(dataDir, "2026-08-01", [{ repo: "acme/only", chosen: true }]);
    assert.deepEqual(desk.getSlate(dataDir, "2026-08-01").map((c) => c.repo), ["acme/only"]);
  });

  it("returns an empty slate for editions predating the desk", () => {
    assert.deepEqual(desk.getSlate(dataDir, "2020-01-01"), []);
  });
});

describe("rulings", () => {
  beforeEach(() => desk.recordSlate(dataDir, "2026-08-01", SLATE));

  it("derives an override when the editor prefers another story", () => {
    const r = desk.recordPick(dataDir, {
      editionDate: "2026-08-01",
      preferredRepo: "acme/rocket",
      why: "the compiler was housekeeping; the rocket changed what's possible",
    });
    assert.equal(r.verdict, "override");
    assert.equal(r.chosenRepo, "acme/quiet");
    assert.equal(r.preferredRepo, "acme/rocket");
  });

  it("derives a confirm when the editor agrees with the printed lead", () => {
    const r = desk.recordPick(dataDir, { editionDate: "2026-08-01", preferredRepo: "acme/quiet" });
    assert.equal(r.verdict, "confirm");
  });

  it("upserts — one ruling per edition, latest wins", () => {
    desk.recordPick(dataDir, { editionDate: "2026-08-01", preferredRepo: "acme/rocket" });
    desk.recordPick(dataDir, { editionDate: "2026-08-01", preferredRepo: "acme/listicle", why: "changed my mind" });
    const picks = desk.recentPicks(dataDir);
    assert.equal(picks.length, 1);
    assert.equal(picks[0].preferredRepo, "acme/listicle");
    assert.equal(picks[0].why, "changed my mind");
  });

  it("rejects a repo that was never on the slate", () => {
    assert.throws(
      () => desk.recordPick(dataDir, { editionDate: "2026-08-01", preferredRepo: "acme/ghost" }),
      /not on the slate/
    );
  });

  it("rejects an edition with no recorded slate", () => {
    assert.throws(
      () => desk.recordPick(dataDir, { editionDate: "2019-01-01", preferredRepo: "acme/rocket" }),
      /No recorded candidate slate/
    );
  });

  it("mirrors every ruling to the append-only log", () => {
    desk.recordPick(dataDir, { editionDate: "2026-08-01", preferredRepo: "acme/rocket", why: "one" });
    desk.recordPick(dataDir, { editionDate: "2026-08-01", preferredRepo: "acme/listicle", why: "two" });
    const lines = fs
      .readFileSync(path.join(dataDir, desk.PICKS_LOG), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    // Append-only: the corrected ruling is a new line, not an edit of the old one.
    assert.equal(lines.length, 2);
    assert.equal(lines[0].why, "one");
    assert.equal(lines[1].preferredRepo, "acme/listicle");
    assert.deepEqual(lines[1].slate, ["acme/rocket", "acme/quiet", "acme/listicle"]);
  });

  it("withdraws a ruling", () => {
    desk.recordPick(dataDir, { editionDate: "2026-08-01", preferredRepo: "acme/rocket" });
    assert.equal(desk.deletePick(dataDir, "2026-08-01"), true);
    assert.equal(desk.getPick(dataDir, "2026-08-01"), null);
    assert.equal(desk.deletePick(dataDir, "2026-08-01"), false);
  });
});

describe("buildDeskBlock", () => {
  it("returns null when the desk is empty, so the prompt is unchanged", () => {
    assert.equal(desk.buildDeskBlock(dataDir), null);
  });

  it("states overrides and confirms distinctly", () => {
    desk.recordSlate(dataDir, "2026-08-01", SLATE);
    desk.recordPick(dataDir, { editionDate: "2026-08-01", preferredRepo: "acme/rocket", why: "significance beat volume" });
    desk.recordSlate(dataDir, "2026-08-02", SLATE);
    desk.recordPick(dataDir, { editionDate: "2026-08-02", preferredRepo: "acme/quiet" });

    const block = desk.buildDeskBlock(dataDir);
    assert.match(block, /THE EDITOR'S DESK/);
    assert.match(block, /2026-08-01: led with acme\/quiet, but acme\/rocket should have led/);
    assert.match(block, /significance beat volume/);
    assert.match(block, /2026-08-02: led with acme\/quiet\. Correct call\./);
  });

  it("leads with the distilled house rule when one exists", () => {
    desk.setRubric(dataDir, "Prefer capability over popularity.", 12);
    const block = desk.buildDeskBlock(dataDir);
    assert.match(block, /HOUSE RULE:\nPrefer capability over popularity\./);
    assert.equal(desk.getRubric(dataDir).pairCount, 12);
  });

  it("honours the ruling limit", () => {
    for (let i = 1; i <= 5; i++) {
      const date = `2026-08-0${i}`;
      desk.recordSlate(dataDir, date, SLATE);
      desk.recordPick(dataDir, { editionDate: date, preferredRepo: "acme/rocket" });
    }
    const block = desk.buildDeskBlock(dataDir, { limit: 2 });
    assert.equal((block.match(/^- 2026-/gm) || []).length, 2);
    // Newest first.
    assert.match(block, /- 2026-08-05/);
    assert.doesNotMatch(block, /- 2026-08-01/);
  });
});

describe("preferencePairs", () => {
  it("exports pairs with the slate they were ruled on", () => {
    desk.recordSlate(dataDir, "2026-08-01", SLATE);
    desk.recordPick(dataDir, { editionDate: "2026-08-01", preferredRepo: "acme/rocket", why: "w" });
    const [pair] = desk.preferencePairs(dataDir);
    assert.deepEqual(pair, {
      date: "2026-08-01",
      verdict: "override",
      preferred: "acme/rocket",
      rejected: "acme/quiet",
      why: "w",
      slate: ["acme/rocket", "acme/quiet", "acme/listicle"],
    });
  });
});

describe("lead prompts carry the desk block", () => {
  const candidates = [{ repo: { full_name: "acme/rocket", description: "A rocket" }, reason: "+1200" }];

  it("injects the block when present", () => {
    const block = "THE EDITOR'S DESK — test";
    assert.match(chooseLeadPrompt(candidates, null, block), /THE EDITOR'S DESK — test/);
    assert.match(lensLeadPrompt(candidates, "judge by impact.", null, block), /THE EDITOR'S DESK — test/);
  });

  it("is byte-identical to the pre-desk prompt when absent", () => {
    assert.equal(chooseLeadPrompt(candidates, null, null), chooseLeadPrompt(candidates, null));
    assert.equal(
      lensLeadPrompt(candidates, "judge by impact.", null, null),
      lensLeadPrompt(candidates, "judge by impact.")
    );
  });
});
