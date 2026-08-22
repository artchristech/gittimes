#!/usr/bin/env node
/**
 * Refresh data/startup-roster.json against the funder's own public dataset.
 *
 * WHAT THIS IS FOR. The Startups desk names private companies, which is the one
 * place on the Business pages where a wrong fact would be a fabrication about a
 * real business rather than a stale number. So roster membership is not typed
 * from memory: every row is re-read from the Y Combinator open dataset
 * (yc-oss/api, itself a mirror of ycombinator.com/companies) and its GitHub org
 * and product repo are re-checked against the GitHub API before the file is
 * rewritten.
 *
 * WHAT IT WILL NOT DO. It never invents a row. Resolving a company name to a
 * GitHub org is a judgement — `github.com/<slug>` frequently belongs to someone
 * else entirely — so new candidates are PRINTED for a human to resolve and
 * verify, never written. What the script maintains automatically is the part
 * that is unambiguous: batch, status, one-liner, website, and whether the repo
 * still exists.
 *
 * A company that goes Inactive, or whose repo 404s, is dropped with a note. A
 * dropped company is not a story; it is a row we can no longer source.
 *
 *   node scripts/refresh-startup-roster.js            # rewrite the roster
 *   node scripts/refresh-startup-roster.js --dry-run  # report only
 */

const fs = require("fs");
const path = require("path");

const ROSTER_PATH = path.join(__dirname, "..", "data", "startup-roster.json");
const DATASET = "https://yc-oss.github.io/api/companies/all.json";
// The selection rule the roster spine is built on, stated once so the file and
// the script cannot drift apart.
const MIN_BATCH_YEAR = 2023;
const OPEN_SOURCE_TAG = "Open Source";

const today = () => new Date().toISOString().slice(0, 10);
const batchYear = (b) => parseInt(String(b || "").match(/\d{4}/)?.[0] || "0", 10);

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": "GitTimes/1.0", ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** Does this repo still exist and is it still public? */
async function repoLives(fullName, token) {
  const headers = { "User-Agent": "GitTimes/1.0", Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}`, { headers });
    if (res.status === 404) return false;
    if (!res.ok) return null; // rate-limited or transient: not evidence of death
    const body = await res.json();
    return body && body.private !== true && body.archived !== true;
  } catch {
    return null;
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  const doc = JSON.parse(fs.readFileSync(ROSTER_PATH, "utf8"));
  const all = await getJson(DATASET);
  const bySlug = new Map(all.map((c) => [c.slug, c]));

  const kept = [];
  const dropped = [];
  for (const row of doc.companies) {
    const slug = String(row.id).replace(/^yc-/, "");
    const yc = bySlug.get(slug);
    if (!yc) {
      dropped.push([row.name, "no longer in the YC dataset"]);
      continue;
    }
    if (yc.status !== "Active") {
      dropped.push([row.name, `status is ${yc.status}`]);
      continue;
    }
    const alive = await Promise.all((row.repos || []).map((r) => repoLives(r, token)));
    const repos = (row.repos || []).filter((_, i) => alive[i] !== false);
    if (repos.length !== (row.repos || []).length) {
      console.warn(`  ! ${row.name}: dropped ${(row.repos || []).length - repos.length} dead repo(s)`);
    }
    kept.push({
      ...row,
      // Refreshed from the dataset — these are the fields that move.
      name: yc.name,
      batch: yc.batch,
      status: yc.status,
      oneLiner: yc.one_liner,
      ycUrl: yc.url,
      ycApi: yc.api,
      repos,
    });
  }

  // Candidates a human should look at — never written, only reported.
  const have = new Set(doc.companies.map((c) => String(c.id).replace(/^yc-/, "")));
  const candidates = all.filter(
    (c) =>
      !have.has(c.slug) &&
      c.status === "Active" &&
      batchYear(c.batch) >= MIN_BATCH_YEAR &&
      (c.tags || []).includes(OPEN_SOURCE_TAG)
  );

  doc.companies = kept;
  doc.provenance = {
    ...doc.provenance,
    dataset: DATASET,
    sourcedAt: today(),
  };

  for (const [name, why] of dropped) console.log(`dropped  ${name} — ${why}`);
  console.log(`${kept.length} companies kept, ${dropped.length} dropped.`);
  if (candidates.length > 0) {
    console.log(`\n${candidates.length} unrostered YC open-source companies from ${MIN_BATCH_YEAR}+:`);
    for (const c of candidates) console.log(`  ${c.slug.padEnd(28)} ${c.batch.padEnd(14)} ${c.website}`);
    console.log("\nResolve each to a GitHub org and product repo by hand, verify both, then add.");
  }

  if (dryRun) {
    console.log("\n--dry-run: roster not written.");
    return;
  }
  fs.writeFileSync(ROSTER_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`\nWrote ${ROSTER_PATH}`);
}

main().catch((e) => {
  console.error(`refresh-startup-roster failed: ${e.message}`);
  process.exitCode = 1;
});
