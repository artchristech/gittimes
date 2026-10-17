#!/usr/bin/env node
/**
 * gittimes lineup — your own build history, on your own Git Times account.
 *
 *   gittimes lineup [show] [--since 14d] [--limit N] [--json] [--no-claude] [--no-shell]
 *                          [--claude-dir DIR] [--history FILE ...]
 *   gittimes lineup sync   [same filters] [--dry-run] [--worker URL] [--token TOKEN]
 *   gittimes lineup login  --token TOKEN      store the account session for sync
 *   gittimes lineup clear  [--worker URL] [--token TOKEN]
 *
 * `show` never touches the network. `sync` pushes SUMMARIES — titles, counts,
 * branches, a few redacted commands — to the account worker; transcripts and
 * raw shell history never leave the machine. `--dry-run` prints exactly what
 * would be sent.
 *
 * Credentials, in order: --token, $GITTIMES_SESSION, ~/.config/gittimes/session
 * (written by `login`). The token is the same session the account page holds;
 * the page's "Copy CLI Sign-in" button hands it over as a ready `login` command.
 */

"use strict";

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");

const lineup = require("./lineup");

const SYNC_BATCH = 200; // worker's per-request cap
const VERBS = new Set(["show", "sync", "login", "clear"]);

function configDir(env = process.env, home = os.homedir()) {
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "gittimes");
}

function sessionFile(env, home) {
  return path.join(configDir(env, home), "session");
}

/** Minimal flag parser: --k v, --k=v, --no-k, repeated --history. */
function parseArgs(argv) {
  const opts = { verb: "show", history: [], _: [] };
  const args = [...argv];
  if (args.length && VERBS.has(args[0])) opts.verb = args.shift();
  while (args.length) {
    const a = args.shift();
    if (!a.startsWith("--")) {
      opts._.push(a);
      continue;
    }
    let key = a.slice(2);
    let val;
    const eq = key.indexOf("=");
    if (eq !== -1) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    if (key.startsWith("no-")) {
      opts[key.slice(3)] = false;
      continue;
    }
    if (["json", "dry-run", "utc", "help"].includes(key)) {
      opts[key] = true;
      continue;
    }
    if (val === undefined) val = args.shift();
    if (val === undefined) throw new Error(`--${key} needs a value`);
    if (key === "history") opts.history.push(val);
    else opts[key] = val;
  }
  return opts;
}

function usage() {
  return [
    "",
    "  gittimes lineup — your build history, as a personal edition",
    "",
    "  gittimes lineup [show] [--since 14d] [--limit N] [--json] [--utc]",
    "                         [--no-claude] [--no-shell] [--claude-dir DIR] [--history FILE]",
    "  gittimes lineup sync   [filters] [--dry-run] [--worker URL] [--token TOKEN]",
    "  gittimes lineup login  --token TOKEN",
    "  gittimes lineup clear  [--worker URL] [--token TOKEN]",
    "",
    "  Sources: Claude Agent SDK / Claude Code transcripts (~/.claude/projects) and the",
    "  shell history behind your Ghostty terminal (zsh, bash, fish). Only summaries sync.",
    "",
  ].join("\n");
}

function resolveToken(opts, env = process.env, home = os.homedir()) {
  if (opts.token) return String(opts.token).trim();
  if (env.GITTIMES_SESSION) return env.GITTIMES_SESSION.trim();
  try {
    return fs.readFileSync(sessionFile(env, home), "utf-8").trim();
  } catch {
    return "";
  }
}

function resolveWorker(opts, env = process.env) {
  const url = opts.worker || env.GITTIMES_WORKER_URL || env.CHAT_WORKER_URL || "";
  return String(url).replace(/\/+$/, "");
}

function collect(opts) {
  return lineup.collectLineup({
    claudeDir: opts["claude-dir"],
    claude: opts.claude !== false,
    shell: opts.shell !== false,
    historyFiles: opts.history.length ? opts.history : undefined,
    since: opts.since === undefined ? undefined : lineup.parseSince(opts.since),
    limit: opts.limit ? Number(opts.limit) : undefined,
  });
}

function describeSources(result) {
  const s = result.sources;
  const bits = [];
  if (s.claude.enabled) bits.push(`${s.claude.sessions} Claude session${s.claude.sessions === 1 ? "" : "s"}`);
  if (s.shell.enabled) {
    const term = s.shell.ghostty && s.shell.ghostty.installed ? "Ghostty" : "shell";
    bits.push(`${s.shell.commands} ${term} commands from ${s.shell.files.length} history file${s.shell.files.length === 1 ? "" : "s"}`);
    if (s.shell.undated) bits.push(`${s.shell.undated} undated commands skipped (enable timestamps: zsh EXTENDED_HISTORY / bash HISTTIMEFORMAT)`);
  }
  return bits.join("; ");
}

async function postJson(url, token, body, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data || !data.ok) {
    const why = (data && data.error) || `HTTP ${res.status}`;
    throw new Error(why === "Not authenticated" ? "Not signed in — run `gittimes lineup login --token …` (Account page → Copy CLI Sign-in)" : why);
  }
  return data;
}

async function cmdShow(opts, out) {
  const result = collect(opts);
  if (opts.json) {
    out(JSON.stringify(result.events, null, 2));
    return result;
  }
  out(lineup.formatLineup(result.events, { utc: opts.utc }));
  out("");
  out(`  ${describeSources(result)}`);
  return result;
}

async function cmdSync(opts, out, fetchImpl, ctx) {
  const result = collect(opts);
  if (opts["dry-run"]) {
    out(JSON.stringify({ events: result.events }, null, 2));
    out(`\n  dry run — ${result.events.length} events would sync (${describeSources(result)})`);
    return result;
  }
  const worker = resolveWorker(opts, ctx.env);
  if (!worker) throw new Error("No worker URL — pass --worker or set GITTIMES_WORKER_URL / CHAT_WORKER_URL");
  const token = resolveToken(opts, ctx.env, ctx.home);
  if (!token) throw new Error("Not signed in — run `gittimes lineup login --token …` (Account page → Copy CLI Sign-in)");
  if (result.events.length === 0) {
    out(`  Nothing to sync (${describeSources(result)})`);
    return result;
  }
  let accepted = 0;
  let rejected = 0;
  let count = 0;
  for (let i = 0; i < result.events.length; i += SYNC_BATCH) {
    const data = await postJson(`${worker}/lineup`, token, { events: result.events.slice(i, i + SYNC_BATCH) }, fetchImpl);
    accepted += data.accepted || 0;
    rejected += data.rejected || 0;
    count = data.count || count;
  }
  out(`  Synced ${accepted} events (${result.sessions} sessions, ${result.terminal} terminal bursts)${rejected ? `, ${rejected} rejected` : ""} — ${count} on your lineup`);
  out(`  ${describeSources(result)}`);
  return { ...result, accepted, rejected, count };
}

function cmdLogin(opts, out, ctx) {
  const { env, home } = ctx;
  const token = (opts.token || env.GITTIMES_SESSION || "").trim();
  if (!token) throw new Error("login needs --token (Account page → Copy CLI Sign-in)");
  const file = sessionFile(env, home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, token + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows: no POSIX modes. The directory is still user-private.
  }
  out(`  Signed in. Session stored at ${file}`);
  return file;
}

async function cmdClear(opts, out, fetchImpl, ctx) {
  const worker = resolveWorker(opts, ctx.env);
  if (!worker) throw new Error("No worker URL — pass --worker or set GITTIMES_WORKER_URL / CHAT_WORKER_URL");
  const token = resolveToken(opts, ctx.env, ctx.home);
  if (!token) throw new Error("Not signed in — run `gittimes lineup login --token …`");
  await postJson(`${worker}/lineup/clear`, token, {}, fetchImpl);
  out("  Lineup cleared.");
}

/**
 * @param {string[]} argv
 * @param {(line: string) => void} [out]
 * @param {typeof fetch} [fetchImpl]
 * @param {{env?: object, home?: string}} [ctx] - injectable for tests; never touch the real home from a test
 */
async function main(argv, out = console.log, fetchImpl = fetch, ctx = {}) {
  const opts = parseArgs(argv);
  const context = { env: ctx.env || process.env, home: ctx.home || os.homedir() };
  if (opts.help) {
    out(usage());
    return;
  }
  switch (opts.verb) {
    case "show":
      return cmdShow(opts, out);
    case "sync":
      return cmdSync(opts, out, fetchImpl, context);
    case "login":
      return cmdLogin(opts, out, context);
    case "clear":
      return cmdClear(opts, out, fetchImpl, context);
    default:
      throw new Error(`unknown verb ${opts.verb}`);
  }
}

module.exports = { parseArgs, resolveToken, resolveWorker, sessionFile, collect, main, usage };

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`gittimes lineup: ${err.message}`);
    process.exit(1);
  });
}
