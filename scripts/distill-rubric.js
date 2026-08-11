#!/usr/bin/env node
/**
 * Distill the editor's rulings into a short house rule.
 *
 * Every ruling on the desk is injected into the lead prompt verbatim, which does
 * not scale — two hundred one-line corrections is not something a model attends
 * to. This compresses the corpus into a handful of lines the editor-in-chief can
 * actually hold in view, stored once and served alongside the most recent rulings.
 *
 *   node scripts/distill-rubric.js            # distill and store
 *   node scripts/distill-rubric.js --dry-run  # print, store nothing
 *   node scripts/distill-rubric.js --show     # print the stored rule and exit
 */
require("dotenv").config();

const { resolveDataDir, closeDb } = require("../src/db");
const { preferencePairs, getRubric, setRubric } = require("../src/desk");
const { createClient, chat, MODEL } = require("../src/xai");

const MIN_PAIRS = 5;

function rubricPrompt(pairs) {
  const lines = pairs
    .map((p) =>
      p.verdict === "confirm"
        ? `- ${p.date}: the paper led with ${p.preferred} and the editor agreed.${p.why ? ` Editor: "${p.why}"` : ""}`
        : `- ${p.date}: the paper led with ${p.rejected}; the editor says ${p.preferred} should have led.${p.why ? ` Editor: "${p.why}"` : ""}`
    )
    .join("\n");

  return `You are studying the editorial taste of the human Editor-in-Chief of The Git Times, a daily newspaper for builders. Below are their retrospective rulings on which story should have led each front page.

Infer the underlying editorial standard. Look for what the preferred stories have in common and what the rejected ones have in common — the kind of story, not the specific repos. Ignore anything that is true of only one ruling.

RULINGS:
${lines}

Write the house rule as 3-6 short imperative lines, each one criterion, addressed to an editor choosing tomorrow's lead. Name the trade-offs the editor actually makes ("prefer X over Y when..."). No preamble, no numbering, no repo names. Output only the lines.`;
}

async function main() {
  const outDir = process.env.PUBLISH_DIR || "./site";
  const dataDir = resolveDataDir(outDir);

  if (process.argv.includes("--show")) {
    const existing = getRubric(dataDir);
    console.log(existing ? `${existing.text}\n\n(from ${existing.pairCount} rulings, ${existing.updatedAt})` : "No rubric stored.");
    return;
  }

  const pairs = preferencePairs(dataDir, 200);
  if (pairs.length < MIN_PAIRS) {
    console.log(`Only ${pairs.length} ruling(s) on file; need ${MIN_PAIRS} before a house rule means anything.`);
    return;
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("Missing OPENROUTER_API_KEY in .env");
    process.exit(1);
  }

  console.log(`Distilling ${pairs.length} rulings (model=${MODEL})...`);
  const raw = await chat(createClient(key), MODEL, rubricPrompt(pairs), 400);
  const text = (raw || "").trim();
  if (!text) {
    console.error("Model returned nothing; rubric left unchanged.");
    process.exit(1);
  }

  console.log(`\n--- House rule ---\n${text}\n`);
  if (process.argv.includes("--dry-run")) {
    console.log("--dry-run: not stored.");
    return;
  }
  setRubric(dataDir, text, pairs.length);
  console.log(`Stored. It now leads the editor's desk block on every future front page.`);
}

main()
  .catch((err) => {
    console.error(`Rubric distillation failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
