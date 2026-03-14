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

    CREATE INDEX IF NOT EXISTS idx_edition_repos_repo ON edition_repos(repo_name);
    CREATE INDEX IF NOT EXISTS idx_repo_snapshots_repo ON repo_snapshots(repo_name);
    CREATE INDEX IF NOT EXISTS idx_used_quotes_text ON used_quotes(quote_text, author);
  `);

  // Idempotent migration: add headline column to edition_repos
  const cols = db.pragma("table_info(edition_repos)").map((c) => c.name);
  if (!cols.includes("headline")) {
    db.exec("ALTER TABLE edition_repos ADD COLUMN headline TEXT DEFAULT ''");
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
  getRecentRepoNames,
  getRecentRepoCoverage,
  recordQuoteUsage,
  getUsedTaglines,
  loadSnapshots,
  saveSnapshot,
  migrateFromJson,
};
