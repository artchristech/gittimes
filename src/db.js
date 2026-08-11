const path = require("path");
const Database = require("better-sqlite3");

let _db = null;
let _dbPath = null;

/**
 * Get or create the SQLite database connection.
 * Database file lives at <dataDir>/gittimes.db (default: ./data).
 * Reopens if dataDir changes (important for tests using temp dirs).
 * @param {string} [dataDir] - Data directory (defaults to ./data)
 * @returns {import("better-sqlite3").Database}
 */
function getDb(dataDir) {
  const fs = require("fs");
  const dir = dataDir || "./data";
  const dbFile = path.join(dir, "gittimes.db");

  // Reuse existing connection if same path
  if (_db && _dbPath === dbFile) return _db;

  // Close previous connection if path changed
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
  }

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbFile);
  _dbPath = dbFile;
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  // Wait (don't throw) if another writer holds the lock — the API's x402 payment
  // insert can race the daily publish job's large transaction.
  _db.pragma("busy_timeout = 5000");
  _initSchema(_db);
  return _db;
}

/**
 * Close the database connection (for clean shutdown / tests).
 */
function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
  }
}

/**
 * Create tables if they don't exist.
 */
function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS editions (
      date       TEXT PRIMARY KEY,
      headline   TEXT NOT NULL DEFAULT '',
      subheadline TEXT NOT NULL DEFAULT '',
      tagline    TEXT NOT NULL DEFAULT '',
      url        TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS edition_repos (
      edition_date TEXT NOT NULL,
      repo_name    TEXT NOT NULL,
      PRIMARY KEY (edition_date, repo_name),
      FOREIGN KEY (edition_date) REFERENCES editions(date) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS used_quotes (
      edition_date TEXT NOT NULL,
      quote_text   TEXT NOT NULL,
      author       TEXT NOT NULL,
      PRIMARY KEY (edition_date),
      FOREIGN KEY (edition_date) REFERENCES editions(date) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repo_snapshots (
      date      TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      stars     INTEGER NOT NULL DEFAULT 0,
      forks     INTEGER NOT NULL DEFAULT 0,
      issues    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, repo_name)
    );

    CREATE TABLE IF NOT EXISTS x402_payments (
      tx_hash    TEXT PRIMARY KEY,
      resource   TEXT NOT NULL DEFAULT '',
      amount     TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL DEFAULT ''
    );

    -- Generation telemetry, captured once per edition. Purely observational:
    -- nothing in the generation/publish path reads this back.
    -- Just Shipped cooldown ledger: which repo's release ran in which edition.
    -- Read back at generation time to suppress recently-featured repos so the
    -- band rotates instead of re-showing the same high-cadence shippers daily.
    CREATE TABLE IF NOT EXISTS featured_releases (
      edition_date TEXT NOT NULL,
      repo         TEXT NOT NULL,
      tag          TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (edition_date, repo)
    );

    CREATE TABLE IF NOT EXISTS edition_meta (
      date              TEXT PRIMARY KEY,
      model             TEXT    NOT NULL DEFAULT '',
      llm_calls         INTEGER NOT NULL DEFAULT 0,
      prompt_tokens     INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens      INTEGER NOT NULL DEFAULT 0,
      elapsed_ms        INTEGER NOT NULL DEFAULT 0,
      generated_at      TEXT    NOT NULL DEFAULT ''
    );

    -- Company registry. The entity layer the Business desks (Big Labs, Startups,
    -- Unicorns) are three views over. Persisted rather than rebuilt per edition
    -- because the whole point is CONTINUITY: first_seen and the story count are
    -- what turn a company from a string that reappears into a recurring
    -- character with a file.
    CREATE TABLE IF NOT EXISTS entities (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      tier        TEXT NOT NULL DEFAULT '',
      country     TEXT NOT NULL DEFAULT '',
      curated     INTEGER NOT NULL DEFAULT 0,
      first_seen  TEXT NOT NULL DEFAULT '',
      last_seen   TEXT NOT NULL DEFAULT '',
      meta        TEXT NOT NULL DEFAULT '{}'
    );

    -- One row per dated thing a company did. The evidence column carries the source
    -- receipt (which API, which ref, fetched when) so a claim with no fetch
    -- behind it cannot be rendered.
    CREATE TABLE IF NOT EXISTS entity_events (
      entity_id    TEXT NOT NULL,
      event_key    TEXT NOT NULL,
      edition_date TEXT NOT NULL DEFAULT '',
      type         TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      url          TEXT NOT NULL DEFAULT '',
      occurred_at  TEXT NOT NULL DEFAULT '',
      metrics      TEXT NOT NULL DEFAULT '{}',
      evidence     TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (entity_id, event_key)
    );

    -- Daily price tape for the model catalog. Same dated-PK shape as
    -- repo_snapshots, deliberately without the prune: for prices the tail IS
    -- the value, and a price series can't be backfilled after the fact.
    --
    -- is_promotional/list_* exist because a promo expiry looks identical to a
    -- price hike from a single snapshot. Claude Sonnet 5's $2/$10 introductory
    -- pricing reverts to $3/$15 on 2026-09-01 with no model change; without
    -- these columns the paper would report that as Anthropic raising prices 50%.
    CREATE TABLE IF NOT EXISTS model_prices (
      date           TEXT NOT NULL,
      model_id       TEXT NOT NULL,
      provider       TEXT NOT NULL DEFAULT '',
      input          REAL,
      output         REAL,
      context_length INTEGER NOT NULL DEFAULT 0,
      is_promotional INTEGER NOT NULL DEFAULT 0,
      promo_ends_on  TEXT NOT NULL DEFAULT '',
      list_input     REAL,
      list_output    REAL,
      source_url     TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (date, model_id)
    );

    CREATE INDEX IF NOT EXISTS idx_model_prices_model ON model_prices(model_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_entity_events_entity ON entity_events(entity_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_entity_events_edition ON entity_events(edition_date);
    CREATE INDEX IF NOT EXISTS idx_edition_repos_repo ON edition_repos(repo_name);
    CREATE INDEX IF NOT EXISTS idx_repo_snapshots_repo ON repo_snapshots(repo_name);
    CREATE INDEX IF NOT EXISTS idx_used_quotes_text ON used_quotes(quote_text, author);
  `);

  // Idempotent migration: add headline column to edition_repos
  const cols = db.pragma("table_info(edition_repos)").map((c) => c.name);
  if (!cols.includes("headline")) {
    db.exec("ALTER TABLE edition_repos ADD COLUMN headline TEXT DEFAULT ''");
  }
  // Idempotent migration: placement. Where a repo actually ran, so a story's
  // provenance can say more than "it appeared". Written at publish time.
  if (!cols.includes("section")) {
    db.exec("ALTER TABLE edition_repos ADD COLUMN section TEXT DEFAULT ''");
  }
  if (!cols.includes("slot")) {
    db.exec("ALTER TABLE edition_repos ADD COLUMN slot TEXT DEFAULT ''");
  }
  if (!cols.includes("slot_rank")) {
    db.exec("ALTER TABLE edition_repos ADD COLUMN slot_rank INTEGER DEFAULT -1");
  }
}

// --- Edition / Manifest operations ---

/**
 * Read all editions as a manifest array (newest first).
 * Compatible with the existing manifest.json shape.
 * @param {string} [dataDir]
 * @returns {Array<{ date, headline, subheadline, tagline, url, repos: string[] }>}
 */
function readManifest(dataDir) {
  const db = getDb(dataDir);

  const editions = db.prepare(
    "SELECT date, headline, subheadline, tagline, url FROM editions ORDER BY date DESC"
  ).all();

  const repoStmt = db.prepare(
    "SELECT repo_name FROM edition_repos WHERE edition_date = ?"
  );

  return editions.map((e) => ({
    ...e,
    repos: repoStmt.all(e.date).map((r) => r.repo_name),
  }));
}

/**
 * Write a full manifest array to the database (replaces all editions).
 * Used for migration from JSON; normal flow uses upsertEdition.
 * @param {string} dataDir
 * @param {Array} manifest
 */
function writeManifest(dataDir, manifest) {
  const db = getDb(dataDir);

  const upsert = db.transaction(() => {
    db.prepare("DELETE FROM edition_repos").run();
    db.prepare("DELETE FROM used_quotes").run();
    db.prepare("DELETE FROM editions").run();

    const insertEdition = db.prepare(
      "INSERT INTO editions (date, headline, subheadline, tagline, url) VALUES (?, ?, ?, ?, ?)"
    );
    const insertRepo = db.prepare(
      "INSERT OR IGNORE INTO edition_repos (edition_date, repo_name) VALUES (?, ?)"
    );

    for (const entry of manifest) {
      insertEdition.run(
        entry.date,
        entry.headline || "",
        entry.subheadline || "",
        entry.tagline || "",
        entry.url || ""
      );
      if (entry.repos) {
        for (const repo of entry.repos) {
          insertRepo.run(entry.date, repo);
        }
      }
    }
  });
  upsert();
}

/**
 * Insert or replace a single edition entry.
 * @param {string} dataDir
 * @param {{ date, headline, subheadline, tagline, url, repos: string[] }} entry
 */
function upsertEdition(dataDir, entry) {
  const db = getDb(dataDir);

  const upsert = db.transaction(() => {
    db.prepare(
      `INSERT INTO editions (date, headline, subheadline, tagline, url)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         headline = excluded.headline,
         subheadline = excluded.subheadline,
         tagline = excluded.tagline,
         url = excluded.url`
    ).run(entry.date, entry.headline || "", entry.subheadline || "", entry.tagline || "", entry.url || "");

    db.prepare("DELETE FROM edition_repos WHERE edition_date = ?").run(entry.date);
    const insertRepo = db.prepare(
      "INSERT OR IGNORE INTO edition_repos (edition_date, repo_name) VALUES (?, ?)"
    );
    if (entry.repos) {
      for (const repo of entry.repos) {
        insertRepo.run(entry.date, repo);
      }
    }
  });
  upsert();
}

/**
 * Record generation telemetry for one edition. Idempotent (upsert by date).
 * Observational only — never read back by the generation/publish path.
 * @param {string} dataDir
 * @param {{ date, model, llmCalls, promptTokens, completionTokens, totalTokens, elapsedMs, generatedAt }} meta
 */
function recordEditionMeta(dataDir, meta) {
  const db = getDb(dataDir);
  db.prepare(
    `INSERT INTO edition_meta
       (date, model, llm_calls, prompt_tokens, completion_tokens, total_tokens, elapsed_ms, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       model = excluded.model,
       llm_calls = excluded.llm_calls,
       prompt_tokens = excluded.prompt_tokens,
       completion_tokens = excluded.completion_tokens,
       total_tokens = excluded.total_tokens,
       elapsed_ms = excluded.elapsed_ms,
       generated_at = excluded.generated_at`
  ).run(
    meta.date,
    meta.model || "",
    meta.llmCalls || 0,
    meta.promptTokens || 0,
    meta.completionTokens || 0,
    meta.totalTokens || 0,
    meta.elapsedMs || 0,
    meta.generatedAt || ""
  );
}

/**
 * Read telemetry for one edition (or null if not recorded).
 * @param {string} dataDir
 * @param {string} date
 */
function getEditionMeta(dataDir, date) {
  const db = getDb(dataDir);
  return db.prepare("SELECT * FROM edition_meta WHERE date = ?").get(date) || null;
}

// --- Recent repos (for dedup) ---

/**
 * Get repo names from the last N editions.
 * @param {string} dataDir
 * @param {number} [lookback=3]
 * @returns {Set<string>}
 */
function getRecentRepoNames(dataDir, lookback = 3) {
  const db = getDb(dataDir);
  const rows = db.prepare(`
    SELECT DISTINCT er.repo_name
    FROM edition_repos er
    INNER JOIN (
      SELECT date FROM editions ORDER BY date DESC LIMIT ?
    ) recent ON er.edition_date = recent.date
  `).all(lookback);
  return new Set(rows.map((r) => r.repo_name));
}

/**
 * Get recent repo coverage with headlines for the last N editions.
 * @param {string} dataDir
 * @param {number} [lookback=7]
 * @returns {Map<string, Array<{date: string, headline: string}>>}
 */
function getRecentRepoCoverage(dataDir, lookback = 7) {
  const db = getDb(dataDir);
  const rows = db.prepare(`
    SELECT er.repo_name, er.edition_date, er.headline
    FROM edition_repos er
    INNER JOIN (
      SELECT date FROM editions ORDER BY date DESC LIMIT ?
    ) recent ON er.edition_date = recent.date
    ORDER BY er.edition_date DESC
  `).all(lookback);

  const coverage = new Map();
  for (const row of rows) {
    if (!coverage.has(row.repo_name)) {
      coverage.set(row.repo_name, []);
    }
    coverage.get(row.repo_name).push({
      date: row.edition_date,
      headline: row.headline,
    });
  }
  return coverage;
}

// --- Quote tracking ---

/**
 * Record which quote was used for an edition.
 * @param {string} dataDir
 * @param {string} editionDate
 * @param {string} quoteText
 * @param {string} author
 */
function recordQuoteUsage(dataDir, editionDate, quoteText, author) {
  const db = getDb(dataDir);
  db.prepare(
    `INSERT INTO used_quotes (edition_date, quote_text, author)
     VALUES (?, ?, ?)
     ON CONFLICT(edition_date) DO UPDATE SET
       quote_text = excluded.quote_text,
       author = excluded.author`
  ).run(editionDate, quoteText, author);
}

/**
 * Get all previously used quote texts (for dedup).
 * @param {string} dataDir
 * @returns {Set<string>} Set of formatted tagline strings
 */
function getUsedTaglines(dataDir) {
  const db = getDb(dataDir);
  const rows = db.prepare("SELECT quote_text, author FROM used_quotes").all();
  return new Set(rows.map((r) => `\u201C${r.quote_text}\u201D \u2014 ${r.author}`));
}

// --- Just Shipped release cooldown ---

/**
 * Record which releases ran in the Just Shipped band for an edition.
 * @param {string} dataDir
 * @param {string} editionDate
 * @param {Array<{repo: string, tag?: string}>} releases
 */
function recordFeaturedReleases(dataDir, editionDate, releases) {
  if (!editionDate || !Array.isArray(releases) || releases.length === 0) return;
  const db = getDb(dataDir);
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO featured_releases (edition_date, repo, tag) VALUES (?, ?, ?)"
  );
  const insertAll = db.transaction((rows) => {
    for (const r of rows) {
      if (r && typeof r.repo === "string") stmt.run(editionDate, r.repo, r.tag || "");
    }
  });
  insertAll(releases);
}

/**
 * Repos whose releases were featured in the last N editions' Just Shipped
 * bands — the cooldown set passed to fetchGitHubReleases as suppressRepos.
 * @param {string} dataDir
 * @param {number} [lookback=4] - editions, not days
 * @returns {Set<string>}
 */
function getRecentFeaturedReleaseRepos(dataDir, lookback = 4) {
  const db = getDb(dataDir);
  const rows = db.prepare(`
    SELECT DISTINCT fr.repo
    FROM featured_releases fr
    INNER JOIN (
      SELECT DISTINCT edition_date FROM featured_releases
      ORDER BY edition_date DESC LIMIT ?
    ) recent ON fr.edition_date = recent.edition_date
  `).all(lookback);
  return new Set(rows.map((r) => r.repo));
}

// --- Repo snapshots (history) ---

/**
 * Load history snapshots from database.
 * @param {string} dataDir
 * @returns {{ snapshots: Array<{ date, repos: Array<{ full_name, stars, forks, issues }> }> }}
 */
function loadSnapshots(dataDir) {
  const db = getDb(dataDir);

  const dates = db.prepare(
    "SELECT DISTINCT date FROM repo_snapshots ORDER BY date DESC LIMIT 14"
  ).all();

  const repoStmt = db.prepare(
    "SELECT repo_name AS full_name, stars, forks, issues FROM repo_snapshots WHERE date = ?"
  );

  return {
    snapshots: dates.map((d) => ({
      date: d.date,
      repos: repoStmt.all(d.date),
    })),
  };
}

/**
 * Save a snapshot of repo stats for a given date.
 * Prunes snapshots older than 14 days.
 * @param {string} dataDir
 * @param {string} dateStr
 * @param {Array<{ full_name, stargazers_count, forks_count, open_issues_count }>} repos
 */
function saveSnapshot(dataDir, dateStr, repos) {
  const db = getDb(dataDir);

  const save = db.transaction(() => {
    // Remove existing snapshot for this date
    db.prepare("DELETE FROM repo_snapshots WHERE date = ?").run(dateStr);

    const insert = db.prepare(
      "INSERT INTO repo_snapshots (date, repo_name, stars, forks, issues) VALUES (?, ?, ?, ?, ?)"
    );
    for (const r of repos) {
      insert.run(
        dateStr,
        r.full_name,
        r.stargazers_count || 0,
        r.forks_count || 0,
        r.open_issues_count || 0
      );
    }

    // Prune old snapshots (keep 14 most recent dates)
    db.prepare(`
      DELETE FROM repo_snapshots WHERE date NOT IN (
        SELECT DISTINCT date FROM repo_snapshots ORDER BY date DESC LIMIT 14
      )
    `).run();
  });
  save();
}

/**
 * Record one day's model prices. Idempotent per date (a republish overwrites
 * that day), never pruned — unlike repo_snapshots, the history is the product.
 *
 * A missing price is stored as NULL, never 0: "we don't know" and "it's free"
 * are different claims and a price-delta query must not confuse them.
 *
 * @param {string} dataDir
 * @param {string} dateStr - YYYY-MM-DD
 * @param {Array<object>} models - buildCatalog() rows, optionally carrying
 *   is_promotional / promo_ends_on / list_input / list_output / source_url.
 * @returns {number} rows written
 */
function saveModelPrices(dataDir, dateStr, models) {
  const db = getDb(dataDir);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

  const save = db.transaction(() => {
    db.prepare("DELETE FROM model_prices WHERE date = ?").run(dateStr);

    const insert = db.prepare(`
      INSERT INTO model_prices
        (date, model_id, provider, input, output, context_length,
         is_promotional, promo_ends_on, list_input, list_output, source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of models) {
      if (!m || !m.id) continue;
      insert.run(
        dateStr,
        m.id,
        m.provider || String(m.id).split("/")[0] || "",
        num(m.input),
        num(m.output),
        m.context_length || 0,
        m.is_promotional ? 1 : 0,
        m.promo_ends_on || "",
        num(m.list_input),
        num(m.list_output),
        m.source_url || ""
      );
    }
  });
  save();
  return models.filter((m) => m && m.id).length;
}

/**
 * Load the price series for one model, oldest first.
 * @param {string} dataDir
 * @param {string} modelId
 * @param {number} [limit=90]
 * @returns {Array<object>}
 */
function loadModelPrices(dataDir, modelId, limit = 90) {
  const db = getDb(dataDir);
  return db
    .prepare(
      "SELECT * FROM model_prices WHERE model_id = ? ORDER BY date DESC LIMIT ?"
    )
    .all(modelId, limit)
    .reverse();
}

// --- Migration ---

/**
 * Migrate existing JSON files into the database.
 * Safe to run multiple times — uses upsert logic.
 * @param {string} outDir - Site output directory containing editions/manifest.json
 * @param {string} [dataDir] - Data directory for the DB (defaults to ./data)
 */
function migrateFromJson(outDir, dataDir) {
  const fs = require("fs");

  // Migrate manifest.json
  const manifestPath = path.join(outDir, "editions", "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (Array.isArray(manifest) && manifest.length > 0) {
        writeManifest(dataDir, manifest);

        // Extract quote usage from taglines
        const db = getDb(dataDir);
        const insertQuote = db.prepare(
          `INSERT OR IGNORE INTO used_quotes (edition_date, quote_text, author) VALUES (?, ?, ?)`
        );
        for (const entry of manifest) {
          if (entry.tagline) {
            const match = entry.tagline.match(/^\u201C(.+)\u201D \u2014 (.+)$/);
            if (match) {
              insertQuote.run(entry.date, match[1], match[2]);
            }
          }
        }

        console.log(`Migrated ${manifest.length} editions from manifest.json`);
      }
    } catch (e) {
      console.warn(`Warning: could not migrate manifest.json: ${e.message}`);
    }
  }

  // Migrate history.json
  const historyPath = path.join(outDir, "editions", "history.json");
  if (fs.existsSync(historyPath)) {
    try {
      const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
      if (history && Array.isArray(history.snapshots)) {
        for (const snapshot of history.snapshots) {
          const repos = snapshot.repos.map((r) => ({
            full_name: r.full_name,
            stargazers_count: r.stars,
            forks_count: r.forks,
            open_issues_count: r.issues,
          }));
          saveSnapshot(dataDir, snapshot.date, repos);
        }
        console.log(`Migrated ${history.snapshots.length} snapshots from history.json`);
      }
    } catch (e) {
      console.warn(`Warning: could not migrate history.json: ${e.message}`);
    }
  }
}

/**
 * Resolve the data directory for the SQLite database from an outDir.
 * Test temp dirs map directly; production outDir (e.g. ./site) maps to ../data.
 * @param {string} outDir
 * @returns {string}
 */
// --- Company registry (Business desks) ---

/** Stable identity for an event so re-running a day is idempotent. */
function _eventKey(ev) {
  return `${ev.type}:${ev.url || ev.title}`;
}

/**
 * Persist the registry for an edition. Entities upsert (first_seen is sticky —
 * it's the "tracked since" line on the company page); events are keyed so a
 * republish of the same day updates rather than duplicates.
 * @param {string} dataDir
 * @param {string} editionDate
 * @param {Array} entities - buildRegistry() output
 */
function recordRegistry(dataDir, editionDate, entities) {
  if (!Array.isArray(entities) || entities.length === 0) return;
  const db = getDb(dataDir);
  const date = editionDate || "";

  const upsertEntity = db.prepare(`
    INSERT INTO entities (id, name, tier, country, curated, first_seen, last_seen, meta)
    VALUES (@id, @name, @tier, @country, @curated, @date, @date, @meta)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      tier = excluded.tier,
      country = excluded.country,
      curated = excluded.curated,
      last_seen = excluded.last_seen,
      meta = excluded.meta
  `);
  const upsertEvent = db.prepare(`
    INSERT INTO entity_events
      (entity_id, event_key, edition_date, type, title, url, occurred_at, metrics, evidence)
    VALUES (@entity_id, @event_key, @edition_date, @type, @title, @url, @occurred_at, @metrics, @evidence)
    ON CONFLICT(entity_id, event_key) DO UPDATE SET
      edition_date = excluded.edition_date,
      title = excluded.title,
      metrics = excluded.metrics,
      evidence = excluded.evidence
  `);

  const writeAll = db.transaction((rows) => {
    for (const e of rows) {
      if (!e || !e.id) continue;
      upsertEntity.run({
        id: e.id,
        name: e.name || e.id,
        tier: e.tier || "",
        country: e.country || "",
        curated: e.curated ? 1 : 0,
        date,
        meta: JSON.stringify({ github: e.github || [], hf: e.hf || [], badges: e.badges || [] }),
      });
      for (const ev of e.events || []) {
        upsertEvent.run({
          entity_id: e.id,
          event_key: _eventKey(ev),
          edition_date: date,
          type: ev.type || "",
          title: ev.title || "",
          url: ev.url || "",
          occurred_at: ev.occurredAt || "",
          metrics: JSON.stringify(ev.metrics || {}),
          evidence: JSON.stringify(ev.evidence || {}),
        });
      }
    }
  });
  writeAll(entities);
}

/**
 * Per-entity coverage history, fed back into the next registry build so stats
 * carry `storyCount` / `firstSeen`. This is the continuity loop: the registry
 * writes what it saw, and reads back how long it has been seeing it.
 * @param {string} dataDir
 * @returns {Map<string,{storyCount:number, firstSeen:string}>}
 */
function getEntityHistory(dataDir) {
  const db = getDb(dataDir);
  const rows = db.prepare(`
    SELECT e.id, e.first_seen,
           (SELECT COUNT(*) FROM entity_events ev WHERE ev.entity_id = e.id) AS story_count
    FROM entities e
  `).all();
  return new Map(
    rows.map((r) => [r.id, { storyCount: r.story_count || 0, firstSeen: r.first_seen || null }])
  );
}

/**
 * An entity's timeline, newest first — the company page body.
 * @param {string} dataDir
 * @param {string} entityId
 * @param {number} [limit=20]
 */
function getEntityTimeline(dataDir, entityId, limit = 20) {
  const db = getDb(dataDir);
  const rows = db.prepare(`
    SELECT type, title, url, occurred_at, edition_date, metrics, evidence
    FROM entity_events
    WHERE entity_id = ?
    ORDER BY (occurred_at = '') ASC, occurred_at DESC
    LIMIT ?
  `).all(entityId, limit);
  return rows.map((r) => ({
    type: r.type,
    title: r.title,
    url: r.url,
    occurredAt: r.occurred_at || null,
    editionDate: r.edition_date || null,
    metrics: _safeJson(r.metrics),
    evidence: _safeJson(r.evidence),
  }));
}

/**
 * Record where each repo actually ran in one edition. Idempotent — a republish
 * overwrites the day's placements rather than doubling them. Rows are UPDATEd,
 * never inserted: upsertEdition owns membership, this only annotates it.
 * @param {string} dataDir
 * @param {string} editionDate
 * @param {Array<{repo: string, section?: string, slot?: string, rank?: number, headline?: string}>} placements
 * @returns {number} rows actually annotated
 */
function recordPlacements(dataDir, editionDate, placements) {
  if (!editionDate || !Array.isArray(placements) || placements.length === 0) return 0;
  const db = getDb(dataDir);
  const upd = db.prepare(
    `UPDATE edition_repos
        SET headline  = CASE WHEN ? != '' THEN ? ELSE headline END,
            section   = ?,
            slot      = ?,
            slot_rank = ?
      WHERE edition_date = ? AND repo_name = ?`
  );
  let n = 0;
  const tx = db.transaction((rows) => {
    for (const p of rows) {
      if (!p || !p.repo) continue;
      const h = p.headline || "";
      const r = upd.run(
        h,
        h,
        p.section || "",
        p.slot || "",
        Number.isInteger(p.rank) ? p.rank : -1,
        editionDate,
        p.repo
      );
      n += r.changes;
    }
  });
  tx(placements);
  return n;
}

/**
 * Every recorded placement for one edition, in page order.
 * @returns {Array<{repo, headline, section, slot, rank}>}
 */
function getEditionPlacements(dataDir, editionDate) {
  const db = getDb(dataDir);
  return db
    .prepare(
      `SELECT repo_name, headline, section, slot, slot_rank
         FROM edition_repos WHERE edition_date = ? ORDER BY section, slot, slot_rank`
    )
    .all(editionDate)
    .map((r) => ({
      repo: r.repo_name,
      headline: r.headline || "",
      section: r.section || "",
      slot: r.slot || "",
      rank: r.slot_rank,
    }));
}

function _safeJson(s) {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

function resolveDataDir(outDir) {
  const resolved = path.resolve(outDir);
  if (resolved.includes(require("os").tmpdir())) return resolved;
  return path.resolve(outDir, "..", "data");
}

module.exports = {
  getDb,
  closeDb,
  resolveDataDir,
  readManifest,
  writeManifest,
  upsertEdition,
  recordEditionMeta,
  getEditionMeta,
  getRecentRepoNames,
  getRecentRepoCoverage,
  recordFeaturedReleases,
  getRecentFeaturedReleaseRepos,
  recordQuoteUsage,
  getUsedTaglines,
  loadSnapshots,
  saveSnapshot,
  saveModelPrices,
  loadModelPrices,
  migrateFromJson,
  recordPlacements,
  getEditionPlacements,
  recordRegistry,
  getEntityHistory,
  getEntityTimeline,
};
