#!/usr/bin/env node
/**
 * Generate a promo video for a Git Times edition.
 * Usage: node generate-promo.js [YYYY-MM-DD]
 * Defaults to today's date if none provided.
 * Tries local files first, then fetches from gittimes.com.
 */
const { generateEditionPromo } = require("./src/promo");

const dateStr = process.argv[2] || null;
const outDir = process.env.PUBLISH_DIR || "./site";

generateEditionPromo(outDir, dateStr).then((result) => {
  if (result) {
    console.log(`\nPromo ready: ${result.promoPath}`);
    console.log(`Open in browser to preview.`);
  } else {
    console.error("Failed to generate promo.");
    process.exit(1);
  }
}).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
