#!/usr/bin/env node
/**
 * Migrate existing JSON data (manifest.json + history.json) into SQLite.
 * Safe to run multiple times — uses upsert/replace logic.
 *
 * Usage: node migrate-db.js [outDir]
 */
require("dotenv").config();

const { migrateFromJson, closeDb } = require("./src/db");

const outDir = process.argv[2] || process.env.PUBLISH_DIR || "./site";
const dataDir = process.env.DATA_DIR || "./data";

console.log(`Migrating JSON data to SQLite in ${dataDir}/gittimes.db ...\n`);

try {
  migrateFromJson(outDir, dataDir);
  console.log("\nMigration complete.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  closeDb();
}
