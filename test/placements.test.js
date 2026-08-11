const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const db = require("../src/db");

let dataDir;
const DATE = "2026-08-11";

before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-placements-"));
});

after(() => {
  db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb(dataDir).exec("DELETE FROM edition_repos; DELETE FROM editions;");
  db.upsertEdition(dataDir, {
    date: DATE,
    headline: "Lead Story",
    repos: ["acme/lead", "acme/second", "acme/quick"],
  });
});

describe("placement recording", () => {
  it("annotates section, slot and rank without inventing rows", () => {
    const n = db.recordPlacements(dataDir, DATE, [
      { repo: "acme/lead", section: "frontPage", slot: "lead", rank: 0, headline: "Lead Story" },
      { repo: "acme/quick", section: "aiAgents", slot: "quickHit", rank: 2, headline: "" },
      { repo: "acme/never-featured", section: "aiAgents", slot: "quickHit", rank: 9 },
    ]);

    // The third repo was never in the edition; UPDATE must not resurrect it.
    assert.equal(n, 2);

    const rows = db.getEditionPlacements(dataDir, DATE);
    assert.equal(rows.length, 3);

    const quick = rows.find((r) => r.repo === "acme/quick");
    assert.equal(quick.section, "aiAgents");
    assert.equal(quick.slot, "quickHit");
    assert.equal(quick.rank, 2);

    const lead = rows.find((r) => r.repo === "acme/lead");
    assert.equal(lead.slot, "lead");
    assert.equal(lead.headline, "Lead Story");

    // Untouched repo keeps the unrecorded sentinel.
    const second = rows.find((r) => r.repo === "acme/second");
    assert.equal(second.section, "");
    assert.equal(second.rank, -1);
  });

  it("never clears an existing headline with an empty one", () => {
    db.recordPlacements(dataDir, DATE, [
      { repo: "acme/quick", section: "aiAgents", slot: "quickHit", rank: 1, headline: "Real Headline" },
    ]);
    db.recordPlacements(dataDir, DATE, [
      { repo: "acme/quick", section: "aiAgents", slot: "secondary", rank: 0, headline: "" },
    ]);

    const quick = db.getEditionPlacements(dataDir, DATE).find((r) => r.repo === "acme/quick");
    assert.equal(quick.headline, "Real Headline");
    assert.equal(quick.slot, "secondary", "placement itself still updates");
  });

  it("is idempotent across a republish", () => {
    const p = [{ repo: "acme/lead", section: "frontPage", slot: "lead", rank: 0, headline: "Lead Story" }];
    db.recordPlacements(dataDir, DATE, p);
    db.recordPlacements(dataDir, DATE, p);
    assert.equal(db.getEditionPlacements(dataDir, DATE).length, 3);
  });

  it("tolerates empty and malformed input", () => {
    assert.equal(db.recordPlacements(dataDir, DATE, []), 0);
    assert.equal(db.recordPlacements(dataDir, DATE, [null, {}, { rank: 1 }]), 0);
    assert.equal(db.recordPlacements(dataDir, "", [{ repo: "acme/lead" }]), 0);
  });
});
