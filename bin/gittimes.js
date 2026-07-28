#!/usr/bin/env node
"use strict";

/**
 * gittimes — single entry point for every operational verb in the repo.
 *
 * Each command spawns the existing script as a child process, so the scripts
 * themselves stay unchanged (they all self-execute on require).
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

const COMMANDS = {
  generate: {
    script: "generate.js",
    summary: "Generate an edition into the working directory",
  },
  publish: {
    script: "publish-edition.js",
    summary: "Sync model pricing, then build and publish the edition",
    pre: "src/sync-models.js",
  },
  mock: {
    script: "scripts/mock-edition.js",
    summary: "Build a mock edition from fixtures (--watch to rebuild)",
  },
  "sync-models": {
    script: "src/sync-models.js",
    summary: "Refresh the AI model pricing catalog",
  },
  migrate: {
    script: "migrate-db.js",
    summary: "Migrate legacy JSON output into SQLite",
  },
  promo: {
    summary: "Promo video pipeline",
    subcommands: {
      run: { script: "run-promo.js", summary: "Render the edition promo" },
      record: { script: "record-promo.js", summary: "Screen-record promo formats" },
      gate: { script: "src/promo-gate.js", summary: "Validate a rendered promo" },
    },
  },
  serve: {
    summary: "Long-running servers",
    subcommands: {
      api: { script: "api-server.js", summary: "HTTP API server" },
      mcp: { script: "mcp-server.js", summary: "MCP server over stdio" },
    },
  },
};

/** Levenshtein distance, for "did you mean" on a mistyped command. */
function distance(a, b) {
  const rows = Array.from({ length: b.length + 1 }, (_, i) => [i, ...Array(a.length).fill(0)]);
  for (let j = 0; j <= a.length; j++) rows[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[b.length][a.length];
}

function closest(input, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = distance(input, c);
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  // Only suggest a genuinely near miss, not the alphabetically-first command.
  return bestScore <= Math.max(2, Math.floor(input.length / 3)) ? best : null;
}

function usage() {
  const lines = ["", "  gittimes — AI-generated newspaper for builders", "", "  Usage: gittimes <command> [options]", ""];
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    if (cmd.subcommands) {
      for (const [sub, subCmd] of Object.entries(cmd.subcommands)) {
        lines.push(`    ${(name + " " + sub).padEnd(16)}${subCmd.summary}`);
      }
    } else {
      lines.push(`    ${name.padEnd(16)}${cmd.summary}`);
    }
  }
  lines.push("", "  Options are passed through to the underlying script.", "");
  return lines.join("\n");
}

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

function run(script, args) {
  const abs = path.join(ROOT, script);
  if (!fs.existsSync(abs)) {
    return Promise.reject(new Error(`${script} is missing — the command table is out of date`));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [abs, ...args], {
      cwd: ROOT,
      stdio: "inherit",
    });

    // Ctrl-C must reach the child — `serve` and `publish` are long-running and
    // own resources (ports, the SQLite handle) they need to release themselves.
    const forward = (sig) => () => child.kill(sig);
    const handlers = FORWARDED_SIGNALS.map((sig) => {
      const fn = forward(sig);
      process.on(sig, fn);
      return [sig, fn];
    });
    const cleanup = () => handlers.forEach(([sig, fn]) => process.removeListener(sig, fn));

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
    child.on("exit", (code, signal) => {
      cleanup();
      if (signal) {
        // Exiting on a signal we forwarded is the user's Ctrl-C, not a failure.
        return reject(Object.assign(new Error(`${script} terminated (${signal})`), {
          code: 128 + (require("os").constants.signals[signal] || 0),
          signal,
        }));
      }
      if (code !== 0) return reject(Object.assign(new Error(`${script} exited ${code}`), { code }));
      resolve();
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const name = argv[0];

  if (!name || name === "--help" || name === "-h" || name === "help") {
    console.log(usage());
    return;
  }

  if (name === "--version" || name === "-v") {
    console.log(require(path.join(ROOT, "package.json")).version);
    return;
  }

  const cmd = COMMANDS[name];
  if (!cmd) {
    console.error(`gittimes: unknown command "${name}"`);
    const near = closest(name, Object.keys(COMMANDS));
    if (near) console.error(`  did you mean "${near}"?`);
    console.error(usage());
    process.exit(1);
  }

  let target = cmd;
  let rest = argv.slice(1);

  if (cmd.subcommands) {
    const sub = rest[0];
    target = cmd.subcommands[sub];
    if (!target) {
      const help = !sub || sub === "--help" || sub === "-h";
      const out = help ? console.log : console.error;
      if (!help) out(`gittimes ${name}: unknown subcommand "${sub}"`);
      out(`\n  Usage: gittimes ${name} <subcommand>\n`);
      for (const [s, c] of Object.entries(cmd.subcommands)) out(`    ${s.padEnd(10)}${c.summary}`);
      out("");
      process.exit(help ? 0 : 1);
    }
    rest = rest.slice(1);
  }

  // --no-sync only ever gates this command's own pre-step; it is never passed
  // through to the underlying script, which does not know the flag.
  if (target.pre) {
    const skip = rest.includes("--no-sync");
    rest = rest.filter((a) => a !== "--no-sync");
    if (!skip) await run(target.pre, []);
  }

  await run(target.script, rest);
}

main().catch((err) => {
  // A signal exit is the user's own Ctrl-C — leave without an error banner.
  if (!err.signal) console.error(`gittimes: ${err.message}`);
  process.exit(err.code || 1);
});
