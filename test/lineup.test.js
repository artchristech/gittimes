const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const lineup = require("../src/lineup");
const cli = require("../src/lineup-cli");

const T0 = Date.parse("2026-09-18T14:02:00.000Z");
const sec = (ms) => Math.floor(ms / 1000);

function jsonl(records) {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/** A realistic Claude Code / Agent SDK transcript. */
function transcript(overrides = {}) {
  const base = { sessionId: "3f1c2a9e-0000-4000-8000-000000000001", cwd: "/Users/chris/projects/gittimes", gitBranch: "main", version: "2.1.0" };
  return jsonl([
    { type: "summary", summary: "Add personal lineup to the account page", leafUuid: "u9" },
    { ...base, type: "user", uuid: "u1", timestamp: new Date(T0).toISOString(), message: { role: "user", content: "Put my Claude sessions and Ghostty history on my account. token=sk-or-v1-abcdefghijklmnopqrstuvwxyz" } },
    { ...base, type: "assistant", uuid: "a1", timestamp: new Date(T0 + 30e3).toISOString(), message: { role: "assistant", model: "claude-fable-5-1", content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/Users/chris/projects/gittimes/src/account.js" } }] } },
    { ...base, type: "user", uuid: "u2", timestamp: new Date(T0 + 31e3).toISOString(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "..." }] } },
    { ...base, type: "assistant", uuid: "a2", timestamp: new Date(T0 + 60e3).toISOString(), message: { role: "assistant", model: "claude-fable-5-1", content: [{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/Users/chris/projects/gittimes/src/account.js", old_string: "a", new_string: "b" } }, { type: "tool_use", id: "t3", name: "Write", input: { file_path: "/Users/chris/projects/gittimes/src/lineup.js", content: "x" } }, { type: "tool_use", id: "t4", name: "Edit", input: { file_path: "/Users/chris/projects/gittimes/src/lineup.js" } }] } },
    { ...base, type: "user", uuid: "u3", timestamp: new Date(T0 + 90e3).toISOString(), message: { role: "user", content: "<command-name>/clear</command-name>" } },
    { ...base, type: "user", uuid: "u4", timestamp: new Date(T0 + 120e3).toISOString(), message: { role: "user", content: [{ type: "text", text: "now add tests" }] } },
    { ...base, type: "assistant", uuid: "a3", timestamp: new Date(T0 + 48 * 60e3).toISOString(), message: { role: "assistant", model: "claude-fable-5-1", content: [{ type: "tool_use", id: "t5", name: "Bash", input: { command: "npm test" } }] } },
    "this line is not json",
    ...(overrides.extra || []),
  ].map((r) => (typeof r === "string" ? r : r))).replace('"this line is not json"', "this line is not json");
}

describe("redactSecrets", () => {
  it("scrubs known token shapes, key=value credentials, and URL passwords", () => {
    const input = [
      "export OPENROUTER_API_KEY=sk-or-v1-abcdef1234567890abcdef",
      'curl -H "Authorization: Bearer abcdefgh12345678" https://user:hunter2@example.com',
      "gh auth login --with-token ghp_abcdefghijklmnopqrstuvwxyz0123",
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE slack xoxb-1234567890-abcdef",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    ].join("\n");
    const out = lineup.redactSecrets(input);
    assert.doesNotMatch(out, /sk-or-v1|abcdefgh12345678|hunter2|ghp_|AKIAIOSFODNN7EXAMPLE|xoxb-1234|eyJhbGci/);
    assert.match(out, /OPENROUTER_API_KEY=\[redacted\]/);
    assert.match(out, /https:\/\/user:\[redacted\]@example\.com/);
    assert.match(out, /AWS_ACCESS_KEY_ID=\[redacted\]/);
  });

  it("leaves ordinary commands alone and is idempotent", () => {
    const cmd = 'git commit -m "fix the lead ranking" && npm test';
    assert.equal(lineup.redactSecrets(cmd), cmd);
    const once = lineup.redactSecrets("password=secret123");
    assert.equal(lineup.redactSecrets(once), once);
  });
});

describe("parseClaudeTranscript", () => {
  it("turns a session transcript into one story", () => {
    const ev = lineup.parseClaudeTranscript(transcript());
    assert.equal(ev.kind, "session");
    assert.equal(ev.source, "claude");
    assert.equal(ev.id, "s:3f1c2a9e-0000-4000-8000-000000000001");
    assert.equal(ev.title, "Add personal lineup to the account page", "summary line wins as the headline");
    assert.equal(ev.project, "gittimes", "basename only — never the full path");
    assert.equal(ev.branch, "main");
    assert.equal(ev.at, new Date(T0).toISOString());
    assert.equal(ev.end, new Date(T0 + 48 * 60e3).toISOString());
    assert.deepEqual(ev.stats, { turns: 2, tools: 5, files: 2, minutes: 48, model: "claude-fable-5-1" });
    assert.deepEqual(ev.sample, ["Edit ×2", "Bash ×1", "Read ×1"]);
  });

  it("falls back to the first real prompt, redacted, when there is no summary", () => {
    const text = transcript().split("\n").filter((l) => !l.includes('"summary"')).join("\n");
    const ev = lineup.parseClaudeTranscript(text);
    assert.match(ev.title, /^Put my Claude sessions and Ghostty history on my account\./);
    assert.match(ev.title, /token=\[redacted\]/);
    assert.doesNotMatch(ev.title, /sk-or-v1/);
  });

  it("does not count tool results or slash-command echoes as turns", () => {
    const ev = lineup.parseClaudeTranscript(transcript());
    assert.equal(ev.stats.turns, 2);
  });

  it("returns null for a transcript with nothing in it", () => {
    assert.equal(lineup.parseClaudeTranscript(""), null);
    assert.equal(lineup.parseClaudeTranscript(jsonl([{ type: "summary", summary: "x" }])), null);
    assert.equal(lineup.parseClaudeTranscript("garbage\n{not json"), null);
  });

  it("uses the file name as the session id when the records carry none", () => {
    const text = jsonl([{ type: "user", timestamp: new Date(T0).toISOString(), message: { role: "user", content: "hi" } }]);
    assert.equal(lineup.parseClaudeTranscript(text, { sessionId: "abc" }).id, "s:abc");
  });
});

describe("shell history parsers", () => {
  it("parses zsh extended history including continuation lines", () => {
    const text = [`: ${sec(T0)}:0;git status`, `: ${sec(T0) + 5}:2;npm test \\`, "  -- --grep lineup", `: ${sec(T0) + 9}:0;ls`].join("\n");
    assert.equal(lineup.detectHistoryFormat(text), "zsh");
    const rows = lineup.parseShellHistory(text);
    assert.deepEqual(rows, [
      { at: T0, cmd: "git status" },
      { at: T0 + 5000, cmd: "npm test -- --grep lineup" },
      { at: T0 + 9000, cmd: "ls" },
    ]);
  });

  it("parses bash history with HISTTIMEFORMAT stamps", () => {
    const text = [`#${sec(T0)}`, "git pull", `#${sec(T0) + 60}`, "make build", "undated command"].join("\n");
    assert.equal(lineup.detectHistoryFormat(text), "bash");
    const rows = lineup.parseShellHistory(text);
    assert.deepEqual(rows, [
      { at: T0, cmd: "git pull" },
      { at: T0 + 60000, cmd: "make build" },
      { at: null, cmd: "undated command" },
    ]);
  });

  it("parses fish history", () => {
    const text = ["- cmd: cargo build", `  when: ${sec(T0)}`, "  paths:", "    - src/main.rs", "- cmd: cargo test", `  when: ${sec(T0) + 30}`].join("\n");
    assert.equal(lineup.detectHistoryFormat(text), "fish");
    assert.deepEqual(lineup.parseShellHistory(text), [
      { at: T0, cmd: "cargo build" },
      { at: T0 + 30000, cmd: "cargo test" },
    ]);
  });

  it("treats plain history as undated", () => {
    const rows = lineup.parseShellHistory("ls\n\ncd ..\n");
    assert.deepEqual(rows, [{ at: null, cmd: "ls" }, { at: null, cmd: "cd .." }]);
  });
});

describe("detectGhostty", () => {
  it("recognises a Ghostty shell from its environment", () => {
    const r = lineup.detectGhostty({ env: { TERM_PROGRAM: "ghostty" }, home: "/nonexistent", platform: "linux" });
    assert.equal(r.inGhostty, true);
    assert.equal(r.installed, true);
  });

  it("falls back to the config file when run outside Ghostty", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-ghostty-"));
    try {
      fs.mkdirSync(path.join(home, ".config", "ghostty"), { recursive: true });
      fs.writeFileSync(path.join(home, ".config", "ghostty", "config"), "theme = catppuccin\n");
      const r = lineup.detectGhostty({ env: {}, home, platform: "linux" });
      assert.equal(r.inGhostty, false);
      assert.equal(r.installed, true);
      assert.equal(r.configPath, path.join(home, ".config", "ghostty", "config"));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports a machine without Ghostty honestly", () => {
    const r = lineup.detectGhostty({ env: { TERM_PROGRAM: "iTerm.app" }, home: "/nonexistent", platform: "linux" });
    assert.deepEqual(r, { inGhostty: false, installed: false, configPath: null });
  });
});

describe("groupCommands", () => {
  const cmds = [
    { at: T0, cmd: "git status" },
    { at: T0 + 60e3, cmd: "npm test" },
    { at: T0 + 120e3, cmd: "git commit -m 'fix' --author 'x'" },
    { at: T0 + 121e3, cmd: "git status" },
    { at: T0 + 3 * 3600e3, cmd: "export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123" },
    { at: null, cmd: "undated" },
  ];

  it("splits bursts on quiet gaps, newest first, with deterministic ids", () => {
    const events = lineup.groupCommands(cmds, { source: "ghostty" });
    assert.equal(events.length, 2);
    assert.equal(events[0].id, `t:${sec(T0 + 3 * 3600e3)}`);
    assert.equal(events[1].id, `t:${sec(T0)}`);
    assert.equal(events[1].kind, "terminal");
    assert.equal(events[1].source, "ghostty");
    assert.equal(events[1].title, "4 commands in Ghostty · git status, git commit, npm test");
    assert.deepEqual(events[1].stats, { commands: 4, minutes: 2 });
    assert.deepEqual(events[1].sample, ["git status", "npm test", "git commit -m 'fix' --author 'x'"], "distinct commands, in order");
  });

  it("redacts sample commands", () => {
    const [latest] = lineup.groupCommands(cmds, { source: "shell" });
    assert.equal(latest.title, "1 command in the terminal · export");
    assert.deepEqual(latest.sample, ["export GITHUB_TOKEN=[redacted]"]);
  });

  it("verbs collapse sudo/env prefixes and keep git/npm subcommands", () => {
    assert.equal(lineup.commandVerb("sudo FOO=1 git commit -m x"), "git commit");
    assert.equal(lineup.commandVerb("./node_modules/.bin/eslint ."), "eslint");
    assert.equal(lineup.commandVerb("npm -v"), "npm");
    assert.equal(lineup.commandVerb(""), "");
  });
});

describe("buildLineup + parseSince", () => {
  it("merges, filters by since, sorts newest first, and caps", () => {
    const sessions = [{ id: "s:a", kind: "session", at: new Date(T0).toISOString() }, { id: "s:old", kind: "session", at: new Date(T0 - 40 * 86400e3).toISOString() }];
    const terminal = [{ id: "t:1", kind: "terminal", at: new Date(T0 + 1000).toISOString() }, { id: "t:bad", kind: "terminal", at: "nope" }];
    const events = lineup.buildLineup({ sessions, terminal, since: T0 - 30 * 86400e3 });
    assert.deepEqual(events.map((e) => e.id), ["t:1", "s:a"]);
    assert.deepEqual(lineup.buildLineup({ sessions, terminal, since: null, limit: 1 }).map((e) => e.id), ["t:1"]);
  });

  it("understands relative and absolute since specs", () => {
    assert.equal(lineup.parseSince("14d", T0), T0 - 14 * 86400e3);
    assert.equal(lineup.parseSince("3w", T0), T0 - 21 * 86400e3);
    assert.equal(lineup.parseSince("6h", T0), T0 - 6 * 3600e3);
    assert.equal(lineup.parseSince("2026-09-01", T0), Date.parse("2026-09-01"));
    assert.equal(lineup.parseSince("", T0), null);
    assert.throws(() => lineup.parseSince("soon", T0), /Cannot parse --since/);
  });
});

describe("formatLineup", () => {
  it("prints the lineup like a paper, grouped by day", () => {
    const events = [
      lineup.parseClaudeTranscript(transcript()),
      ...lineup.groupCommands([{ at: T0 - 5 * 3600e3, cmd: "git status" }, { at: T0 - 5 * 3600e3 + 1000, cmd: "npm test" }], { source: "ghostty" }),
      { id: "s:y", kind: "session", source: "claude", at: new Date(T0 - 86400e3).toISOString(), title: "Yesterday", project: "", branch: "", stats: { turns: 1 }, sample: [] },
    ];
    const text = lineup.formatLineup(events, { utc: true });
    assert.match(text, /^YOUR LINEUP — 2 sessions, 1 terminal burst/);
    assert.match(text, /\n2026-09-18\n {2}14:02 {2}session {3}gittimes \(main\) — Add personal lineup to the account page\n +2 turns · 5 tool calls · 2 files · 48 min · claude-fable-5-1 · Edit ×2, Bash ×1, Read ×1/);
    assert.match(text, /09:02 {2}terminal {2}2 commands in Ghostty · git status, npm test\n +2 commands · 1 min\n +\$ git status\n +\$ npm test/);
    assert.match(text, /\n2026-09-17\n {2}14:02 {2}session {3}Yesterday/);
  });

  it("says so when there is nothing", () => {
    assert.match(lineup.formatLineup([]), /Nothing on the desk/);
  });
});

describe("filesystem scans", () => {
  let home;
  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-lineup-"));
    const proj = path.join(home, ".claude", "projects", "-Users-chris-projects-gittimes");
    fs.mkdirSync(path.join(proj, "3f1c2a9e-0000-4000-8000-000000000001", "subagents"), { recursive: true });
    fs.writeFileSync(path.join(proj, "3f1c2a9e-0000-4000-8000-000000000001.jsonl"), transcript());
    fs.writeFileSync(path.join(proj, "empty.jsonl"), jsonl([{ type: "summary", summary: "nothing" }]));
    // A subagent transcript nested under the session dir must be ignored.
    fs.writeFileSync(path.join(proj, "3f1c2a9e-0000-4000-8000-000000000001", "subagents", "agent-1.jsonl"), transcript());
    fs.writeFileSync(path.join(home, ".zsh_history"), [`: ${sec(T0 - 3600e3)}:0;git status`, `: ${sec(T0 - 3600e3) + 10}:0;npm test`, "plain undated line"].join("\n") + "\n");
    fs.mkdirSync(path.join(home, ".config", "ghostty"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "ghostty", "config"), "");
  });
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it("scans Claude sessions, skipping empties and subagents", () => {
    const sessions = lineup.scanClaudeSessions(path.join(home, ".claude"));
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, "s:3f1c2a9e-0000-4000-8000-000000000001");
  });

  it("returns nothing for a missing claude dir", () => {
    assert.deepEqual(lineup.scanClaudeSessions(path.join(home, "nope")), []);
  });

  it("finds history files and reads them with a since cutoff", () => {
    const files = lineup.historyFiles({ env: {}, home });
    assert.deepEqual(files.map((f) => f.shell), ["zsh"]);
    const scan = lineup.scanShellHistory({ env: {}, home, since: T0 - 2 * 3600e3 });
    assert.equal(scan.commands.length, 2);
    assert.equal(scan.undated, 1);
    assert.equal(scan.ghostty.installed, true);
    const none = lineup.scanShellHistory({ env: {}, home, since: T0 });
    assert.equal(none.commands.length, 0);
  });

  it("collectLineup pulls both sources together", () => {
    const result = lineup.collectLineup({ claudeDir: path.join(home, ".claude"), env: {}, home, since: null });
    assert.equal(result.sessions, 1);
    assert.equal(result.terminal, 1);
    assert.equal(result.events[0].kind, "session", "the later session leads");
    assert.equal(result.events[1].source, "ghostty");
    assert.equal(result.sources.shell.ghostty.installed, true);
    assert.deepEqual(lineup.collectLineup({ claudeDir: path.join(home, ".claude"), env: {}, home, since: null, shell: false }).events.map((e) => e.kind), ["session"]);
  });

  it("cli: show prints, sync --dry-run never calls fetch, sync posts in batches", async () => {
    const out = [];
    const log = (l) => out.push(l);
    await cli.main(["show", "--claude-dir", path.join(home, ".claude"), "--no-shell", "--since", "2020-01-01", "--utc"], log);
    assert.match(out.join("\n"), /YOUR LINEUP — 1 session, 0 terminal bursts/);

    const calls = [];
    const fetchMock = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, accepted: JSON.parse(init.body).events.length, rejected: 0, count: 1 }) };
    };
    out.length = 0;
    await cli.main(["sync", "--dry-run", "--claude-dir", path.join(home, ".claude"), "--no-shell", "--since", "2020-01-01"], log, fetchMock);
    assert.equal(calls.length, 0);
    assert.match(out.join("\n"), /dry run — 1 events would sync/);

    out.length = 0;
    await cli.main(["sync", "--claude-dir", path.join(home, ".claude"), "--no-shell", "--since", "2020-01-01", "--worker", "https://w.test/", "--token", "sess_x"], log, fetchMock);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://w.test/lineup");
    assert.equal(calls[0].init.headers.Authorization, "Bearer sess_x");
    assert.match(out.join("\n"), /Synced 1 events \(1 sessions, 0 terminal bursts\) — 1 on your lineup/);
  });

  it("cli: login stores the session privately and sync reads it back", async () => {
    const env = { XDG_CONFIG_HOME: path.join(home, "xdg") };
    const file = cli.sessionFile(env, home);
    const out = [];
    await cli.main(["login", "--token", "sess_stored"], (l) => out.push(l), undefined, { env, home });
    assert.equal(fs.readFileSync(file, "utf-8"), "sess_stored\n");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, "session file is owner-only");
    assert.match(out.join("\n"), /Signed in/);
    await assert.rejects(cli.main(["login"], () => {}, undefined, { env, home }), /login needs --token/);

    assert.equal(cli.resolveToken({ token: "flag" }, env, home), "flag");
    assert.equal(cli.resolveToken({}, { GITTIMES_SESSION: "env" }, home), "env");
    assert.equal(cli.resolveToken({}, env, home), "sess_stored");
    assert.equal(cli.resolveToken({}, {}, path.join(home, "empty")), "");

    // sync with no --token falls back to the stored session.
    const calls = [];
    const fetchMock = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true, accepted: 1, rejected: 0, count: 1 }) }; };
    await cli.main(["sync", "--claude-dir", path.join(home, ".claude"), "--no-shell", "--since", "2020-01-01", "--worker", "https://w.test"], () => {}, fetchMock, { env, home });
    assert.equal(calls[0].init.headers.Authorization, "Bearer sess_stored");
    // clear uses the same credentials.
    await cli.main(["clear", "--worker", "https://w.test"], () => {}, fetchMock, { env, home });
    assert.equal(calls[1].url, "https://w.test/lineup/clear");
    assert.equal(cli.resolveWorker({}, { CHAT_WORKER_URL: "https://w.test/" }), "https://w.test");
    assert.equal(cli.resolveWorker({ worker: "https://x.test" }, { CHAT_WORKER_URL: "https://w.test/" }), "https://x.test");
  });

  it("cli: parseArgs handles verbs, flags, negations, and repeats", () => {
    const o = cli.parseArgs(["sync", "--since=14d", "--no-claude", "--history", "a", "--history", "b", "--dry-run", "--limit", "5"]);
    assert.equal(o.verb, "sync");
    assert.equal(o.since, "14d");
    assert.equal(o.claude, false);
    assert.deepEqual(o.history, ["a", "b"]);
    assert.equal(o["dry-run"], true);
    assert.equal(o.limit, "5");
    assert.equal(cli.parseArgs([]).verb, "show");
    assert.throws(() => cli.parseArgs(["--since"]), /needs a value/);
  });

  it("cli: sync refuses to run without a worker or a token, and explains a 401", async () => {
    const dir = path.join(home, ".claude");
    const bare = { env: {}, home: path.join(home, "nobody") };
    await assert.rejects(cli.main(["sync", "--claude-dir", dir, "--no-shell", "--worker", "", "--token", "x"], () => {}, async () => {}, bare), /No worker URL/);
    await assert.rejects(cli.main(["sync", "--claude-dir", dir, "--no-shell", "--worker", "https://w.test"], () => {}, async () => {}, bare), /Not signed in/);
    const unauth = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: "Not authenticated" }) });
    await assert.rejects(cli.main(["sync", "--claude-dir", dir, "--no-shell", "--worker", "https://w.test", "--token", "stale"], () => {}, unauth, bare), /Not signed in — run `gittimes lineup login/);
    const boom = async () => ({ ok: false, status: 500, json: async () => { throw new Error("nope"); } });
    await assert.rejects(cli.main(["sync", "--claude-dir", dir, "--no-shell", "--worker", "https://w.test", "--token", "t"], () => {}, boom, bare), /HTTP 500/);
  });
});
