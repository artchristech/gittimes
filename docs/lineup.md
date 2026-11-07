# Your Lineup

The paper tells everyone else's building story. **Your Lineup** tells yours: the
Claude Agent SDK / Claude Code sessions you ran and the terminal bursts behind them,
printed on your Git Times account as a personal edition.

Sign in at `gittimes.com/account/` and the section sits under your plan details.
It is empty until you sync it from the machine you build on.

## Two sources

| Source | Where it lives | What becomes a story |
| --- | --- | --- |
| **Claude Agent SDK / Claude Code** | `~/.claude/projects/<project>/<session>.jsonl` — the transcripts the runtime writes for every session, SDK-driven or interactive | One **session** per transcript: the session's summary line (or your first real prompt), the project directory name, git branch, turn / tool-call / edited-file counts, duration, model, top tools. Subagent transcripts fold into their parent. |
| **Ghostty** | Ghostty keeps no scrollback on disk, so "Ghostty history" is the history file of the shell it runs: `~/.zsh_history`, `~/.bash_history`, or fish's `fish_history` (plus `$HISTFILE` / `$ZDOTDIR`) | One **terminal** entry per burst of commands, where a burst ends after 30 quiet minutes: count, duration, top verbs (`git commit`, `npm test`), three sample commands. |

Ghostty is detected from the environment it exports (`TERM_PROGRAM=ghostty`,
`GHOSTTY_RESOURCES_DIR`) or its config file. On a machine without it the entries
read "in the terminal" instead of "in Ghostty"; nothing else changes.

Only **timestamped** history can be placed on a timeline. zsh needs
`setopt EXTENDED_HISTORY`, bash needs `HISTTIMEFORMAT` set; fish stamps by default.
Undated commands are counted and skipped — the CLI says how many.

## Privacy: summaries, never sources

What leaves the machine is the summary above and nothing more: no transcript text,
no tool output, no raw history file. Three guards on top of that:

- **Redaction** runs on every string that can reach the wire (titles, sample commands,
  branch names): `sk-…` / `ghp_…` / `github_pat_…` / `xox…` / `AKIA…` keys, JWTs,
  `Bearer` headers, `KEY=value` pairs whose key smells like a credential, and
  `user:password@host` URLs all become `[redacted]`.
- **Project is a basename.** `/Users/you/work/secret-client/api` syncs as `api`.
- **`--dry-run`** prints the exact JSON that would be sent. Look before the first sync.

Delete Account wipes the lineup along with everything else; **Clear Lineup** on the
account page (or `gittimes lineup clear`) wipes just this.

## Using it

From a checkout of this repo (`npm install` once):

```bash
gittimes lineup                       # print your lineup locally — no network
gittimes lineup --since 14d --utc     # narrower window
gittimes lineup --json                # the raw events
gittimes lineup sync --dry-run        # what WOULD sync, exactly
```

To put it on your account, hand the CLI your session. On the account page, **Copy
CLI Sign-in** puts a ready `login` command on your clipboard:

```bash
gittimes lineup login --token <pasted>   # stored in ~/.config/gittimes/session, mode 0600
gittimes lineup sync                     # push summaries; re-run any time
```

Re-syncing is idempotent: events carry stable ids (`s:<session-uuid>`,
`t:<burst-start>`), so a session that grew since the last sync is updated in place,
never doubled. The lineup keeps the newest 500 events.

Configuration, in order of precedence:

| Setting | Flag | Env | Fallback |
| --- | --- | --- | --- |
| Session token | `--token` | `GITTIMES_SESSION` | `~/.config/gittimes/session` (from `login`) |
| Worker URL | `--worker` | `GITTIMES_WORKER_URL` | `CHAT_WORKER_URL` (the same `.env` value the site uses) |
| Claude dir | `--claude-dir` | — | `~/.claude` |
| History files | `--history FILE` (repeatable) | `HISTFILE`, `ZDOTDIR`, `XDG_DATA_HOME` | the standard zsh / bash / fish paths |
| Window | `--since 14d` (`h`/`d`/`w`/`m` or a date) | — | 30 days |

`--no-claude` / `--no-shell` drop a source.

## Endpoints (account worker)

All take the account session as `Authorization: Bearer <token>`.

| Route | Purpose |
| --- | --- |
| `GET /lineup?limit=N` | The lineup, newest first, with `count` and `updatedAt` |
| `POST /lineup` | `{ events: [...] }`, at most 200 per request; merged by id, invalid events reported as `rejected`, never fail the batch. 60 syncs / hour / account. |
| `POST /lineup/clear` | Wipe it |

Stored under `lineup:<email>` in the `USERS` KV namespace, alongside `saved:` and
`transcript:`, and excluded from the user-count scans the same way. Every field is
length-clamped server-side; the source list is closed (`claude`, `ghostty`, `shell`).

## Code

| File | Role |
| --- | --- |
| `src/lineup.js` | Pure module: transcript + history parsers, redaction, burst grouping, `collectLineup`, `formatLineup` |
| `src/lineup-cli.js` | The `gittimes lineup` verb: `show` / `sync` / `login` / `clear` |
| `worker/index.js` | `/lineup` routes, `sanitizeLineupEvent` |
| `templates/account.html` | The section, rendered client-side from `GET /lineup` (DOM APIs only, no `innerHTML`) |
| `test/lineup.test.js` | Parsers, redaction, grouping, scans against a temp home, the CLI |

Deploying: the worker needs `wrangler deploy`; the account page is a UI-only change,
so it goes out via the surgical gh-pages path in `CONTEXT.md`, never a full publish.
