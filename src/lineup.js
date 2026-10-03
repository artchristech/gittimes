/**
 * Your Lineup — the reader's own build history, told the way the paper tells
 * everyone else's.
 *
 * Two local sources feed it:
 *   1. Claude Agent SDK / Claude Code session transcripts — the JSONL files the
 *      runtime writes under `~/.claude/projects/<project>/<session>.jsonl`. One
 *      session becomes one "story": what you asked for, where, on which branch,
 *      how much tool work it took.
 *   2. Ghostty terminal history. Ghostty itself keeps no scrollback on disk, so
 *      "Ghostty history" is the shell history written by the shell running
 *      inside it (zsh / bash / fish, all timestamped formats supported). Bursts
 *      of commands separated by quiet gaps become "terminal" entries.
 *
 * Everything leaves the machine as a SUMMARY: a title, counts, a branch, a few
 * redacted sample commands. Never a transcript, never the raw history. The
 * redaction pass runs on every string that can reach the wire.
 *
 * Pure functions throughout; the filesystem scans take explicit roots so the
 * tests never touch a real home directory.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const SOURCE = Object.freeze({ CLAUDE: "claude", GHOSTTY: "ghostty", SHELL: "shell" });
const KIND = Object.freeze({ SESSION: "session", TERMINAL: "terminal" });

const BURST_GAP_MINUTES = 30;
const SAMPLE_COMMANDS = 3;
const TITLE_MAX = 140;
const COMMAND_MAX = 120;
const DEFAULT_SINCE_DAYS = 30;
const DEFAULT_LIMIT = 200;

// ---------------------------------------------------------------------------
// Redaction — runs on every string that can reach the wire
// ---------------------------------------------------------------------------

// Token shapes with a recognisable prefix. Replaced wholesale.
const TOKEN_PATTERNS = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic / Stripe / OpenRouter style
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub classic tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._\-+/=]{8,}/gi,
];

// `KEY=value` / `key: value` where the key smells like a credential. The key
// and separator survive so the command still reads; only the value goes.
const KEYVAL_PATTERN = /\b([A-Za-z_-]*(?:token|secret|password|passwd|api[_-]?key|apikey|auth)[A-Za-z_-]*)(\s*[=:]\s*)(["']?)([^\s"']+)\3/gi;

// user:password@host inside a URL.
const URL_CRED_PATTERN = /\/\/([^\s/:@]+):([^\s/@]+)@/g;

/**
 * Scrub credentials out of free text. Idempotent, conservative: prefers a
 * false positive on `password=hunter2` over leaking a real key.
 * @param {string} text
 * @returns {string}
 */
function redactSecrets(text) {
  if (text == null) return "";
  let out = String(text);
  out = out.replace(URL_CRED_PATTERN, "//$1:[redacted]@");
  for (const re of TOKEN_PATTERNS) out = out.replace(re, "[redacted]");
  out = out.replace(KEYVAL_PATTERN, (_m, key, sep, quote) => `${key}${sep}${quote}[redacted]${quote}`);
  return out;
}

/** Collapse whitespace, redact, truncate with an ellipsis. */
function squash(text, max) {
  const one = redactSecrets(text).replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return one.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function shortHash(text) {
  return crypto.createHash("sha1").update(String(text)).digest("hex").slice(0, 12);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Claude Agent SDK / Claude Code transcripts
// ---------------------------------------------------------------------------

// Prompts the runtime injects on the user's behalf (slash commands, hook
// output, system reminders). Not something the person typed — never a title.
const SYNTHETIC_PROMPT = /^\s*<(?:command-name|command-message|local-command-stdout|local-command-caveat|system-reminder|bash-input|bash-stdout|bash-stderr|task-notification|ide_opened_file)/i;

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function textOfContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

function isToolResult(content) {
  return Array.isArray(content) && content.some((p) => p && p.type === "tool_result");
}

function topN(counter, n) {
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n);
}

/**
 * Summarise one session transcript (JSONL, one record per line).
 *
 * Tolerant by design: unparseable lines are skipped, unknown record types are
 * ignored, and a transcript with no real turns (a bare `summary` line, an
 * aborted launch) yields null rather than an empty story.
 *
 * @param {string} text - the raw JSONL
 * @param {{sessionId?: string}} [opts]
 * @returns {object|null} a lineup event of kind "session"
 */
function parseClaudeTranscript(text, opts = {}) {
  const lines = String(text || "").split("\n");
  let sessionId = opts.sessionId || null;
  let cwd = null;
  let branch = null;
  let model = null;
  let summary = null;
  let first = null;
  let last = null;
  let firstPrompt = null;
  let turns = 0;
  let tools = 0;
  const toolNames = new Map();
  const files = new Set();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object") continue;

    if (rec.type === "summary") {
      if (typeof rec.summary === "string" && rec.summary.trim()) summary = rec.summary;
      continue;
    }
    if (!sessionId && typeof rec.sessionId === "string") sessionId = rec.sessionId;
    if (!cwd && typeof rec.cwd === "string") cwd = rec.cwd;
    if (!branch && typeof rec.gitBranch === "string") branch = rec.gitBranch;

    const ts = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (first === null || ts < first) first = ts;
      if (last === null || ts > last) last = ts;
    }

    const msg = rec.message;
    if (!msg || typeof msg !== "object") continue;

    if (rec.type === "user") {
      if (isToolResult(msg.content)) continue;
      const prompt = textOfContent(msg.content).trim();
      if (!prompt || SYNTHETIC_PROMPT.test(prompt)) continue;
      turns++;
      if (!firstPrompt) firstPrompt = prompt;
    } else if (rec.type === "assistant") {
      if (typeof msg.model === "string" && msg.model) model = msg.model;
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (!part || part.type !== "tool_use") continue;
        tools++;
        const name = typeof part.name === "string" && part.name ? part.name : "tool";
        toolNames.set(name, (toolNames.get(name) || 0) + 1);
        const input = part.input && typeof part.input === "object" ? part.input : {};
        const filePath = input.file_path || input.notebook_path || input.path;
        if (FILE_TOOLS.has(name) && typeof filePath === "string") files.add(filePath);
      }
    }
  }

  if (turns === 0 && tools === 0) return null;
  if (first === null) return null;

  const minutes = Math.max(1, Math.round((last - first) / 60000));
  return {
    id: `s:${sessionId || shortHash(text.slice(0, 4000))}`,
    kind: KIND.SESSION,
    source: SOURCE.CLAUDE,
    at: iso(first),
    end: iso(last),
    title: squash(summary || firstPrompt || "Untitled session", TITLE_MAX),
    // Basename only: the full path is where the machine keeps its secrets.
    project: cwd ? path.basename(cwd) : "",
    branch: branch ? squash(branch, 80) : "",
    stats: { turns, tools, files: files.size, minutes, model: model || "" },
    sample: topN(toolNames, 3).map(([name, n]) => `${name} ×${n}`),
  };
}

/**
 * Walk `<claudeDir>/projects/*\/*.jsonl` and summarise each session.
 * Subagent transcripts (nested one level deeper) are deliberately skipped —
 * their tool calls already belong to the parent session's story.
 *
 * @param {string} [claudeDir] - default `~/.claude`
 * @param {{since?: number}} [opts] - epoch ms; files not modified since are not even opened
 * @returns {object[]} session events, newest first
 */
function scanClaudeSessions(claudeDir, opts = {}) {
  const root = path.join(claudeDir || path.join(os.homedir(), ".claude"), "projects");
  const since = typeof opts.since === "number" ? opts.since : null;
  const sessions = [];
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return sessions;
  }
  for (const dir of projectDirs) {
    const projectPath = path.join(root, dir.name);
    let entries;
    try {
      entries = fs.readdirSync(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(projectPath, entry.name);
      try {
        if (since !== null && fs.statSync(file).mtimeMs < since) continue;
        const event = parseClaudeTranscript(fs.readFileSync(file, "utf-8"), {
          sessionId: entry.name.replace(/\.jsonl$/, ""),
        });
        if (event) sessions.push(event);
      } catch {
        // One unreadable transcript must not sink the lineup.
      }
    }
  }
  return sessions.sort(byNewest);
}

// ---------------------------------------------------------------------------
// Ghostty + shell history
// ---------------------------------------------------------------------------

/**
 * Is this machine a Ghostty machine? Ghostty exports TERM_PROGRAM=ghostty and
 * GHOSTTY_RESOURCES_DIR into every shell it spawns; outside a Ghostty shell we
 * fall back to looking for its config file.
 * @param {{env?: object, home?: string, platform?: string}} [opts]
 * @returns {{inGhostty: boolean, installed: boolean, configPath: string|null}}
 */
function detectGhostty(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const platform = opts.platform || process.platform;
  const inGhostty = env.TERM_PROGRAM === "ghostty" || Boolean(env.GHOSTTY_RESOURCES_DIR) || Boolean(env.GHOSTTY_BIN_DIR);
  const candidates = [path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "ghostty", "config")];
  if (platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "com.mitchellh.ghostty", "config"));
  }
  const configPath = candidates.find((p) => fs.existsSync(p)) || null;
  return { inGhostty, installed: inGhostty || configPath !== null, configPath };
}

/** Sniff the history file format from its contents. */
function detectHistoryFormat(text) {
  const head = String(text || "").slice(0, 8000);
  if (/^: \d{9,}:\d+;/m.test(head)) return "zsh";
  if (/^- cmd: /m.test(head)) return "fish";
  if (/^#\d{9,10}\s*$/m.test(head)) return "bash";
  return "plain";
}

/**
 * Parse a shell history file into `{at, cmd}` rows. `at` is epoch ms, or null
 * when the shell recorded no timestamp (plain bash, zsh without EXTENDED_HISTORY).
 *
 * @param {string} text
 * @param {"zsh"|"bash"|"fish"|"plain"} [format] - sniffed when omitted
 * @returns {Array<{at: number|null, cmd: string}>}
 */
function parseShellHistory(text, format) {
  const fmt = format || detectHistoryFormat(text);
  const lines = String(text || "").split("\n");
  const rows = [];

  if (fmt === "zsh") {
    let cur = null;
    for (const line of lines) {
      const m = line.match(/^: (\d+):\d+;(.*)$/);
      if (m) {
        if (cur) rows.push(cur);
        cur = { at: Number(m[1]) * 1000, cmd: m[2] };
      } else if (cur && cur.cmd.endsWith("\\")) {
        cur.cmd += "\n" + line; // backslash-continued multi-line command
      } else if (line.trim()) {
        if (cur) rows.push(cur);
        cur = { at: null, cmd: line }; // written before EXTENDED_HISTORY was on
      }
    }
    if (cur) rows.push(cur);
  } else if (fmt === "bash") {
    let pending = null;
    for (const line of lines) {
      const m = line.match(/^#(\d{9,10})\s*$/);
      if (m) {
        pending = Number(m[1]) * 1000;
        continue;
      }
      if (!line.trim()) continue;
      rows.push({ at: pending, cmd: line });
      pending = null;
    }
  } else if (fmt === "fish") {
    let cur = null;
    for (const line of lines) {
      let m;
      if ((m = line.match(/^- cmd: (.*)$/))) {
        if (cur) rows.push(cur);
        cur = { at: null, cmd: m[1] };
      } else if (cur && (m = line.match(/^\s+when: (\d+)/))) {
        cur.at = Number(m[1]) * 1000;
      }
    }
    if (cur) rows.push(cur);
  } else {
    for (const line of lines) if (line.trim()) rows.push({ at: null, cmd: line });
  }

  return rows
    .map((r) => ({ at: r.at, cmd: r.cmd.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim() }))
    .filter((r) => r.cmd);
}

/**
 * The history files worth reading on this machine, in priority order.
 * @param {{env?: object, home?: string}} [opts]
 * @returns {Array<{path: string, shell: string}>} only files that exist
 */
function historyFiles(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const shell = path.basename(env.SHELL || "");
  const candidates = [];
  if (env.HISTFILE) candidates.push({ path: env.HISTFILE, shell: shell || "zsh" });
  candidates.push({ path: path.join(env.ZDOTDIR || home, ".zsh_history"), shell: "zsh" });
  candidates.push({ path: path.join(home, ".zsh_history"), shell: "zsh" });
  candidates.push({ path: path.join(home, ".bash_history"), shell: "bash" });
  candidates.push({
    path: path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "fish", "fish_history"),
    shell: "fish",
  });
  const seen = new Set();
  return candidates.filter((c) => {
    if (seen.has(c.path)) return false;
    seen.add(c.path);
    try {
      return fs.statSync(c.path).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Read every history file into one timestamped command list.
 * @param {{env?: object, home?: string, files?: string[], since?: number}} [opts]
 * @returns {{commands: Array<{at: number, cmd: string, shell: string}>, files: string[], undated: number, ghostty: object}}
 */
function scanShellHistory(opts = {}) {
  const ghostty = detectGhostty(opts);
  const files = Array.isArray(opts.files) && opts.files.length
    ? opts.files.map((p) => ({ path: p, shell: path.basename(p).includes("fish") ? "fish" : path.basename(p).includes("bash") ? "bash" : "zsh" }))
    : historyFiles(opts);
  const since = typeof opts.since === "number" ? opts.since : null;
  const commands = [];
  const read = [];
  let undated = 0;
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f.path, "utf-8");
    } catch {
      continue;
    }
    read.push(f.path);
    for (const row of parseShellHistory(text)) {
      if (row.at === null) {
        undated++;
        continue;
      }
      if (since !== null && row.at < since) continue;
      commands.push({ at: row.at, cmd: row.cmd, shell: f.shell });
    }
  }
  commands.sort((a, b) => a.at - b.at);
  return { commands, files: read, undated, ghostty };
}

const SUBCOMMAND_TOOLS = new Set(["git", "npm", "npx", "pnpm", "yarn", "bun", "cargo", "docker", "gh", "kubectl", "go", "make", "gittimes", "claude"]);

/** `sudo FOO=1 git commit -m x` → "git commit". */
function commandVerb(cmd) {
  const tokens = cmd.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && (tokens[i] === "sudo" || tokens[i] === "env" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))) i++;
  const head = tokens[i];
  if (!head) return "";
  const verb = path.basename(head);
  const sub = tokens[i + 1];
  if (SUBCOMMAND_TOOLS.has(verb) && sub && !sub.startsWith("-")) return `${verb} ${sub}`;
  return verb;
}

/**
 * Fold a timestamped command stream into "terminal" events — one per burst of
 * activity, where a burst ends after `gapMinutes` of silence.
 *
 * @param {Array<{at: number, cmd: string}>} commands - any order; undated rows are dropped
 * @param {{gapMinutes?: number, source?: string}} [opts]
 * @returns {object[]} terminal events, newest first
 */
function groupCommands(commands, opts = {}) {
  const gapMs = (opts.gapMinutes || BURST_GAP_MINUTES) * 60000;
  const source = opts.source || SOURCE.SHELL;
  const label = source === SOURCE.GHOSTTY ? "Ghostty" : "the terminal";
  const dated = (commands || []).filter((c) => c && typeof c.at === "number" && !Number.isNaN(c.at) && c.cmd).sort((a, b) => a.at - b.at);

  const bursts = [];
  let cur = null;
  for (const c of dated) {
    if (!cur || c.at - cur.last > gapMs) {
      cur = { start: c.at, last: c.at, rows: [] };
      bursts.push(cur);
    }
    cur.last = c.at;
    cur.rows.push(c);
  }

  return bursts
    .map((b) => {
      const verbs = new Map();
      const sample = [];
      const seen = new Set();
      for (const r of b.rows) {
        const v = commandVerb(r.cmd);
        if (v) verbs.set(v, (verbs.get(v) || 0) + 1);
        const clean = squash(r.cmd, COMMAND_MAX);
        if (sample.length < SAMPLE_COMMANDS && !seen.has(clean)) {
          seen.add(clean);
          sample.push(clean);
        }
      }
      const n = b.rows.length;
      const top = topN(verbs, 3).map(([v]) => v);
      return {
        id: `t:${Math.floor(b.start / 1000)}`,
        kind: KIND.TERMINAL,
        source,
        at: iso(b.start),
        end: iso(b.last),
        title: `${n} command${n === 1 ? "" : "s"} in ${label}${top.length ? ` · ${top.join(", ")}` : ""}`,
        project: "",
        branch: "",
        stats: { commands: n, minutes: Math.max(1, Math.round((b.last - b.start) / 60000)) },
        sample,
      };
    })
    .sort(byNewest);
}

// ---------------------------------------------------------------------------
// The lineup
// ---------------------------------------------------------------------------

function byNewest(a, b) {
  return Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * "14d", "3w", "2m", "6h", or an ISO date → epoch ms. Null for empty input.
 * @param {string} [spec]
 * @param {number} [now] - epoch ms, for tests
 */
function parseSince(spec, now = Date.now()) {
  if (spec == null || spec === "") return null;
  const s = String(spec).trim();
  const m = s.match(/^(\d+)\s*([hdwm])$/i);
  if (m) {
    const n = Number(m[1]);
    const unit = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3 }[m[2].toLowerCase()];
    return now - n * unit;
  }
  const parsed = Date.parse(s);
  if (Number.isNaN(parsed)) throw new Error(`Cannot parse --since "${spec}" (try 14d, 3w, 2m, or a date)`);
  return parsed;
}

/**
 * Merge sessions and terminal bursts into one newest-first lineup.
 * @param {{sessions?: object[], terminal?: object[], since?: number|null, limit?: number}} input
 * @returns {object[]}
 */
function buildLineup(input = {}) {
  const since = typeof input.since === "number" ? input.since : null;
  const limit = Math.max(1, input.limit || DEFAULT_LIMIT);
  const all = [...(input.sessions || []), ...(input.terminal || [])];
  return all
    .filter((e) => e && typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)))
    .filter((e) => since === null || Date.parse(e.at) >= since)
    .sort(byNewest)
    .slice(0, limit);
}

/**
 * Gather everything from this machine in one call. What the CLI runs.
 * @param {object} [opts]
 * @param {string} [opts.claudeDir]
 * @param {boolean} [opts.claude=true]
 * @param {boolean} [opts.shell=true]
 * @param {string[]} [opts.historyFiles]
 * @param {number|null} [opts.since] - epoch ms; default 30 days ago
 * @param {number} [opts.limit]
 * @param {object} [opts.env]
 * @param {string} [opts.home]
 * @returns {{events: object[], sessions: number, terminal: number, sources: object}}
 */
function collectLineup(opts = {}) {
  const since = opts.since === undefined ? Date.now() - DEFAULT_SINCE_DAYS * 86400e3 : opts.since;
  const sinceNum = typeof since === "number" ? since : null;
  const sources = { claude: { enabled: opts.claude !== false, sessions: 0 }, shell: { enabled: opts.shell !== false, files: [], commands: 0, undated: 0, ghostty: null } };

  let sessions = [];
  if (sources.claude.enabled) {
    sessions = scanClaudeSessions(opts.claudeDir, { since: sinceNum });
    sources.claude.sessions = sessions.length;
  }

  let terminal = [];
  if (sources.shell.enabled) {
    const scan = scanShellHistory({ env: opts.env, home: opts.home, files: opts.historyFiles, since: sinceNum });
    sources.shell.files = scan.files;
    sources.shell.commands = scan.commands.length;
    sources.shell.undated = scan.undated;
    sources.shell.ghostty = scan.ghostty;
    terminal = groupCommands(scan.commands, { source: scan.ghostty.installed ? SOURCE.GHOSTTY : SOURCE.SHELL });
  }

  const events = buildLineup({ sessions, terminal, since: sinceNum, limit: opts.limit });
  return {
    events,
    sessions: events.filter((e) => e.kind === KIND.SESSION).length,
    terminal: events.filter((e) => e.kind === KIND.TERMINAL).length,
    sources,
  };
}

// ---------------------------------------------------------------------------
// Print it like a paper
// ---------------------------------------------------------------------------

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dayKey(ms, utc) {
  const d = new Date(ms);
  return utc
    ? d.toISOString().slice(0, 10)
    : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function clock(ms, utc) {
  const d = new Date(ms);
  return utc ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function statLine(e) {
  const s = e.stats || {};
  const parts = [];
  if (e.kind === KIND.SESSION) {
    if (s.turns) parts.push(plural(s.turns, "turn"));
    if (s.tools) parts.push(plural(s.tools, "tool call"));
    if (s.files) parts.push(plural(s.files, "file"));
  } else if (s.commands) {
    parts.push(plural(s.commands, "command"));
  }
  if (s.minutes) parts.push(`${s.minutes} min`);
  if (s.model) parts.push(s.model);
  return parts.join(" · ");
}

/**
 * Render a lineup as terminal text, grouped by day.
 * @param {object[]} events
 * @param {{utc?: boolean, header?: string}} [opts]
 */
function formatLineup(events, opts = {}) {
  const utc = Boolean(opts.utc);
  const lines = [];
  const sessions = events.filter((e) => e.kind === KIND.SESSION).length;
  const terminal = events.length - sessions;
  lines.push(opts.header || `YOUR LINEUP — ${plural(sessions, "session")}, ${plural(terminal, "terminal burst")}`);
  if (events.length === 0) {
    lines.push("", "  Nothing on the desk. No Claude sessions or timestamped shell history in range.");
    return lines.join("\n");
  }
  let day = null;
  for (const e of [...events].sort(byNewest)) {
    const ms = Date.parse(e.at);
    const key = dayKey(ms, utc);
    if (key !== day) {
      day = key;
      lines.push("", key);
    }
    const kind = e.kind === KIND.SESSION ? "session " : "terminal";
    const where = e.project ? `${e.project}${e.branch ? ` (${e.branch})` : ""} — ` : "";
    lines.push(`  ${clock(ms, utc)}  ${kind}  ${where}${e.title}`);
    const stats = statLine(e);
    const tail = [stats, e.kind === KIND.SESSION && e.sample && e.sample.length ? e.sample.join(", ") : ""].filter(Boolean).join(" · ");
    if (tail) lines.push(`                   ${tail}`);
    if (e.kind === KIND.TERMINAL && e.sample) for (const c of e.sample) lines.push(`                   $ ${c}`);
  }
  return lines.join("\n");
}

module.exports = {
  SOURCE,
  KIND,
  BURST_GAP_MINUTES,
  DEFAULT_SINCE_DAYS,
  DEFAULT_LIMIT,
  redactSecrets,
  parseClaudeTranscript,
  scanClaudeSessions,
  detectGhostty,
  detectHistoryFormat,
  parseShellHistory,
  historyFiles,
  scanShellHistory,
  commandVerb,
  groupCommands,
  parseSince,
  buildLineup,
  collectLineup,
  formatLineup,
};
