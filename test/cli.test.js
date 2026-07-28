"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "gittimes.js");

function cli(args) {
  return execFileSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
}

test("every script in the command table exists on disk", () => {
  const source = fs.readFileSync(CLI, "utf8");
  const scripts = [...source.matchAll(/script: "([^"]+)"/g)].map((m) => m[1]);
  const pres = [...source.matchAll(/pre: "([^"]+)"/g)].map((m) => m[1]);

  assert.ok(scripts.length >= 9, "expected the full command table to be parsed");
  for (const s of [...scripts, ...pres]) {
    assert.ok(fs.existsSync(path.join(ROOT, s)), `${s} referenced by the CLI is missing`);
  }
});

test("help lists every command", () => {
  const out = cli([]);
  for (const name of ["generate", "publish", "mock", "sync-models", "migrate", "promo run", "serve api"]) {
    assert.match(out, new RegExp(name.replace(/\s+/g, "\\s+")));
  }
});

test("--version matches package.json", () => {
  const { version } = require(path.join(ROOT, "package.json"));
  assert.strictEqual(cli(["--version"]).trim(), version);
});

test("unknown command exits non-zero and suggests a near miss", () => {
  assert.throws(
    () => execFileSync(process.execPath, [CLI, "generat"], { cwd: ROOT, stdio: "pipe" }),
    (err) => {
      assert.strictEqual(err.status, 1);
      assert.match(err.stderr.toString(), /did you mean "generate"/);
      return true;
    }
  );
});

test("bare subcommand group prints its own help and exits zero", () => {
  const out = cli(["promo"]);
  assert.match(out, /gittimes promo <subcommand>/);
  assert.match(out, /gate/);
});
