/**
 * The Editor's Desk — human editorial preference capture, and the feedback loop
 * back into the front-page lead decision.
 *
 * The paper is not edited by hand. Instead the human editor rules on front pages
 * after the fact ("X led, but Y should have led — because…"), and those rulings
 * are fed forward into tomorrow's lead prompt as standing editorial policy. No
 * published edition is ever rewritten; the signal only ever changes future picks.
 *
 * Two things are persisted:
 *   1. lead_slate  — the candidate slate the editor-in-chief actually chose from
 *                    on a given day. Without it a retrospective ruling has no
 *                    alternatives to rule between.
 *   2. editor_picks — one ruling per edition: override (Y should have led) or
 *                    confirm (the lead was right). Stored as a preference PAIR,
 *                    because "X over Y, on this slate" teaches; "I like Y" does not.
 *
 * Rulings are also mirrored to an append-only JSONL (`<dataDir>/editor-picks.jsonl`)
 * — the durable training log, git-friendly and independent of the sqlite file.
 *
 * Everything here is fail-soft by construction. The desk is an enrichment: a
 * missing table, an unwritable log, or an empty history must never be able to
 * take an edition down.
 */

const fs = require("fs");
const path = require("path");

const { getDb } = require("./db");

const PICKS_LOG = "editor-picks.jsonl";

/** Idempotent schema. Owned by this module, not db.js — the desk is optional. */
function ensureSchema(db) {
  db.exec(`
    -- The slate the editor-in-chief chose from, as it stood that morning.
    -- Persisted at publish time so a ruling weeks later still has alternatives.
    CREATE TABLE IF NOT EXISTS lead_slate (
      edition_date TEXT    NOT NULL,
      rank         INTEGER NOT NULL DEFAULT 0,
      repo_name    TEXT    NOT NULL,
      description  TEXT    NOT NULL DEFAULT '',
      reason       TEXT    NOT NULL DEFAULT '',
      chosen       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (edition_date, repo_name)
    );

    -- One human ruling per edition. Upserted — the editor can change their mind.
    CREATE TABLE IF NOT EXISTS editor_picks (
      edition_date   TEXT PRIMARY KEY,
      verdict        TEXT NOT NULL DEFAULT 'override',  -- 'override' | 'confirm'
      chosen_repo    TEXT NOT NULL DEFAULT '',          -- what the paper led with
      preferred_repo TEXT NOT NULL DEFAULT '',          -- what should have led
      why            TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL DEFAULT ''
    );

    -- Tier 2: the accumulated rulings distilled into a short house rule. One row.
    CREATE TABLE IF NOT EXISTS editor_rubric (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      text       TEXT    NOT NULL DEFAULT '',
      pair_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT    NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_lead_slate_repo ON lead_slate(repo_name);
  `);
  return db;
}

function _db(dataDir) {
  return ensureSchema(getDb(dataDir));
}

// ---------------------------------------------------------------------------
// Slate — what was on the desk
// ---------------------------------------------------------------------------

/**
 * Record the candidate slate for one edition. Idempotent per (date, repo);
 * a republish overwrites the day's slate rather than doubling it.
 * @param {string} dataDir
 * @param {string} editionDate
 * @param {Array<{repo: string, description?: string, reason?: string, chosen?: boolean}>} slate
 *   Ranked as passed — index 0 is the top momentum candidate.
 */
function recordSlate(dataDir, editionDate, slate) {
  if (!editionDate || !Array.isArray(slate) || slate.length === 0) return 0;
  const db = _db(dataDir);
  const del = db.prepare("DELETE FROM lead_slate WHERE edition_date = ?");
  const ins = db.prepare(
    `INSERT INTO lead_slate (edition_date, rank, repo_name, description, reason, chosen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(edition_date, repo_name) DO UPDATE SET
       rank = excluded.rank,
       description = excluded.description,
       reason = excluded.reason,
       chosen = excluded.chosen`
  );
  const tx = db.transaction((rows) => {
    del.run(editionDate);
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i];
      if (!c || !c.repo) continue;
      ins.run(editionDate, i, c.repo, c.description || "", c.reason || "", c.chosen ? 1 : 0);
    }
  });
  tx(slate);
  return slate.length;
}

/**
 * The slate for one edition, in rank order. Empty array when nothing was recorded
 * (editions published before the desk existed).
 */
function getSlate(dataDir, editionDate) {
  const db = _db(dataDir);
  return db
    .prepare("SELECT rank, repo_name, description, reason, chosen FROM lead_slate WHERE edition_date = ? ORDER BY rank")
    .all(editionDate)
    .map((r) => ({
      rank: r.rank,
      repo: r.repo_name,
      description: r.description,
      reason: r.reason,
      chosen: !!r.chosen,
    }));
}

/** The repo the paper actually led with that day, or null. */
function getChosenRepo(dataDir, editionDate) {
  const db = _db(dataDir);
  const row = db
    .prepare("SELECT repo_name FROM lead_slate WHERE edition_date = ? AND chosen = 1 LIMIT 1")
    .get(editionDate);
  return row ? row.repo_name : null;
}

// ---------------------------------------------------------------------------
// Rulings — what the human thinks should have led
// ---------------------------------------------------------------------------

/**
 * Record (or replace) the human ruling for one edition.
 *
 * The verdict is derived, not asked for: preferring the repo that already led is
 * a CONFIRM, anything else is an OVERRIDE. That keeps the positive class in the
 * log — a corpus made only of corrections teaches "avoid what the editor hates",
 * never "find what the editor loves".
 *
 * @param {string} dataDir
 * @param {{editionDate: string, preferredRepo: string, why?: string, at?: string}} ruling
 * @returns {{editionDate, verdict, chosenRepo, preferredRepo, why, createdAt}}
 * @throws if the edition has no recorded slate, or the preferred repo wasn't on it
 */
function recordPick(dataDir, ruling) {
  const editionDate = (ruling.editionDate || "").trim();
  const preferredRepo = (ruling.preferredRepo || "").trim();
  const why = (ruling.why || "").trim();
  if (!editionDate) throw new Error("editionDate is required");
  if (!preferredRepo) throw new Error("preferredRepo is required");

  const slate = getSlate(dataDir, editionDate);
  if (slate.length === 0) throw new Error(`No recorded candidate slate for ${editionDate}`);
  const match = slate.find((c) => c.repo.toLowerCase() === preferredRepo.toLowerCase());
  if (!match) throw new Error(`${preferredRepo} was not on the slate for ${editionDate}`);

  const chosenRepo = (slate.find((c) => c.chosen) || {}).repo || "";
  const verdict = match.repo === chosenRepo ? "confirm" : "override";
  const createdAt = ruling.at || new Date().toISOString();

  _db(dataDir)
    .prepare(
      `INSERT INTO editor_picks (edition_date, verdict, chosen_repo, preferred_repo, why, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(edition_date) DO UPDATE SET
         verdict = excluded.verdict,
         chosen_repo = excluded.chosen_repo,
         preferred_repo = excluded.preferred_repo,
         why = excluded.why,
         created_at = excluded.created_at`
    )
    .run(editionDate, verdict, chosenRepo, match.repo, why, createdAt);

  const record = { editionDate, verdict, chosenRepo, preferredRepo: match.repo, why, createdAt };
  appendPicksLog(dataDir, { ...record, slate: slate.map((c) => c.repo) });
  return record;
}

/**
 * Mirror a ruling to the append-only training log. Best-effort: the sqlite row is
 * the source of truth for the UI, this file is the durable corpus.
 */
function appendPicksLog(dataDir, record) {
  try {
    const dir = dataDir || "./data";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, PICKS_LOG), `${JSON.stringify(record)}\n`);
  } catch (e) {
    console.warn(`Editor picks log append skipped (non-fatal): ${e.message}`);
  }
}

/** The ruling for one edition, or null. */
function getPick(dataDir, editionDate) {
  const row = _db(dataDir).prepare("SELECT * FROM editor_picks WHERE edition_date = ?").get(editionDate);
  return row ? _rowToPick(row) : null;
}

/** Recent rulings, newest edition first. */
function recentPicks(dataDir, limit = 20) {
  const n = Math.min(200, Math.max(1, limit));
  return _db(dataDir)
    .prepare("SELECT * FROM editor_picks ORDER BY edition_date DESC LIMIT ?")
    .all(n)
    .map(_rowToPick);
}

function _rowToPick(row) {
  return {
    editionDate: row.edition_date,
    verdict: row.verdict,
    chosenRepo: row.chosen_repo,
    preferredRepo: row.preferred_repo,
    why: row.why,
    createdAt: row.created_at,
  };
}

/** Delete a ruling (the editor withdraws it). The JSONL log is not rewritten. */
function deletePick(dataDir, editionDate) {
  const info = _db(dataDir).prepare("DELETE FROM editor_picks WHERE edition_date = ?").run(editionDate);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Rubric — the rulings, compressed
// ---------------------------------------------------------------------------

/** The distilled house rule, or null if never generated. */
function getRubric(dataDir) {
  const row = _db(dataDir).prepare("SELECT * FROM editor_rubric WHERE id = 1").get();
  return row && row.text ? { text: row.text, pairCount: row.pair_count, updatedAt: row.updated_at } : null;
}

/** Replace the distilled house rule. */
function setRubric(dataDir, text, pairCount = 0) {
  _db(dataDir)
    .prepare(
      `INSERT INTO editor_rubric (id, text, pair_count, updated_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET text = excluded.text, pair_count = excluded.pair_count, updated_at = excluded.updated_at`
    )
    .run((text || "").trim(), pairCount, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// The feedback loop — rulings as prompt context
// ---------------------------------------------------------------------------

/**
 * Build the block injected into the lead prompts. This is the whole point of the
 * desk: past rulings become standing policy for the next front page.
 *
 * Returns null when there is nothing to say, so the prompt is byte-identical to
 * what it was before the desk existed.
 *
 * @param {string} dataDir
 * @param {{limit?: number}} [opts] - how many recent rulings to show (default 8)
 * @returns {string|null}
 */
function buildDeskBlock(dataDir, opts = {}) {
  let picks;
  let rubric;
  try {
    picks = recentPicks(dataDir, opts.limit || 8);
    rubric = getRubric(dataDir);
  } catch (e) {
    console.warn(`Editor's desk context unavailable (non-fatal): ${e.message}`);
    return null;
  }
  if (picks.length === 0 && !rubric) return null;

  const lines = [
    "THE EDITOR'S DESK — the human editor-in-chief's standing rulings on past front pages.",
    "These are retrospective judgments on editions already printed. Treat them as house policy:",
    "where they conflict with your own instinct about what leads, they win.",
  ];

  if (rubric) {
    lines.push("", "HOUSE RULE:", rubric.text);
  }

  if (picks.length > 0) {
    lines.push("", "RECENT RULINGS:");
    for (const p of picks) {
      const why = p.why ? ` — "${p.why}"` : "";
      lines.push(
        p.verdict === "confirm"
          ? `- ${p.editionDate}: led with ${p.chosenRepo}. Correct call.${why}`
          : `- ${p.editionDate}: led with ${p.chosenRepo}, but ${p.preferredRepo} should have led.${why}`
      );
    }
  }

  return lines.join("\n");
}

/**
 * Preference pairs for downstream training/distillation: one row per override,
 * newest first. Confirms are included as same-repo pairs so the positive class
 * survives — callers that only want corrections can filter on verdict.
 */
function preferencePairs(dataDir, limit = 200) {
  return recentPicks(dataDir, limit).map((p) => ({
    date: p.editionDate,
    verdict: p.verdict,
    preferred: p.preferredRepo,
    rejected: p.chosenRepo,
    why: p.why,
    slate: getSlate(dataDir, p.editionDate).map((c) => c.repo),
  }));
}

module.exports = {
  ensureSchema,
  recordSlate,
  getSlate,
  getChosenRepo,
  recordPick,
  getPick,
  recentPicks,
  deletePick,
  getRubric,
  setRubric,
  buildDeskBlock,
  preferencePairs,
  PICKS_LOG,
};
