#!/usr/bin/env node
/**
 * End-to-end promo pipeline: select edition -> generate HTML -> record MP4 -> gate.
 *
 * Usage:
 *   node run-promo.js [YYYY-MM-DD] [vertical|square|landscape]
 *   npm run promo -- [YYYY-MM-DD] [format]
 *
 * Edition selection (when no explicit date resolves to a file), in order:
 *   1. site/editions/<date>/index.html   (date = arg or today)
 *   2. site/latest/index.html
 *   3. most recent dir under site/editions/*
 *
 * Exits non-zero on any failure (generation, recording, or quality gate).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { generateEditionPromo } = require("./src/promo");
const { checkRenderedPromo } = require("./src/promo-gate");

const FORMATS = { vertical: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] };

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Resolve which edition source to use, per the mandatory fallback order. */
function selectEdition(outDir, requestedDate) {
  const date = requestedDate || todayStr();
  const editionPath = path.join(outDir, "editions", date, "index.html");
  if (fs.existsSync(editionPath)) {
    return { dateStr: date, source: editionPath, reason: `editions/${date}/index.html exists` };
  }
  const latestPath = path.join(outDir, "latest", "index.html");
  if (fs.existsSync(latestPath)) {
    // Derive a date label from latest's own dir name if available; else use requested/today.
    return { dateStr: date, source: latestPath, reason: "site/latest/index.html (today's edition not found)" };
  }
  const editionsDir = path.join(outDir, "editions");
  if (fs.existsSync(editionsDir)) {
    const dirs = fs
      .readdirSync(editionsDir)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(editionsDir, d, "index.html")))
      .sort();
    if (dirs.length) {
      const newest = dirs[dirs.length - 1];
      return {
        dateStr: newest,
        source: path.join(editionsDir, newest, "index.html"),
        reason: `most recent edition dir (${newest})`,
      };
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || null;
  const format = args.find((a) => FORMATS[a]) || "vertical";
  const outDir = process.env.PUBLISH_DIR || "./site";
  const [w, h] = FORMATS[format];

  const sel = selectEdition(outDir, dateArg);
  if (!sel) {
    console.error("promo: no edition source found (no editions/<date>, no latest, no editions/*).");
    process.exit(1);
  }

  console.log(`[promo] Format: ${format} — expected ${w}x${h}`);
  console.log(`[promo] Edition source: ${sel.source}`);
  console.log(`[promo] Reason: ${sel.reason}`);
  console.log(`[promo] Render date label: ${sel.dateStr}`);

  // 1. Generate promo HTML (uses the same selection logic internally; fails loud).
  const gen = await generateEditionPromo(outDir, sel.dateStr);
  if (!gen) {
    console.error("promo: generation returned null.");
    process.exit(1);
  }

  // 2. Record MP4 (record-promo.js runs its own internal gate too).
  console.log(`[promo] Recording ${sel.dateStr} [${format}]...`);
  execFileSync("node", [path.join(__dirname, "record-promo.js"), sel.dateStr, format], {
    stdio: "inherit",
  });

  // 3. Final independent quality gate.
  const suffix = format === "vertical" ? "" : `-${format}`;
  const mp4Path = path.resolve(outDir, "promos", `${sel.dateStr}${suffix}.mp4`);
  const report = checkRenderedPromo(mp4Path, { format, requireAudio: true });
  console.log(
    `[promo] GATE OK ${report.width}x${report.height} ${report.duration.toFixed(1)}s ` +
      `${report.codec}+${report.audio} ${(report.bytes / 1024).toFixed(0)}KB`
  );
  console.log(`[promo] Done: ${mp4Path}`);
}

main().catch((err) => {
  console.error("promo: ERROR:", err.message);
  process.exit(1);
});
