**Problem**

The Git Times repo at `/Users/christopherharris/projects/gittimes` has just-finished telemetry work sitting uncommitted on the feature branch `feature/promos-gallery`. Your job is to commit only the intended telemetry + notes changes (excluding scratch/experimental files), merge the feature branch into `main`, push `main` to the GitHub remote, and "deploy" the site — where "deploy" for a code change means landing the code on `main` so the existing GitHub Actions pipeline picks it up on its next scheduled run. You MUST NOT trigger a fresh publish or a subscriber newsletter blast as part of this.

**Context**

The Git Times is a static site auto-published by the GitHub Actions workflow `.github/workflows/daily-edition.yml`. That workflow checks out `main`, runs `npm test` (a red test ABORTS the deploy), runs `node publish-edition.js`, then deploys `./site` to the `gh-pages` branch. It fires on a daily cron (07:00 UTC / 3 AM ET) AND on manual `workflow_dispatch`. Because of this, getting correct code onto `main` IS the deploy — there is no separate site-code deploy step, and the new telemetry will run for real on the NEXT scheduled publish (writing the first `edition_meta` row). The telemetry change is purely observational: `publish-edition.js` records per-edition generation stats (model, llm_calls, prompt/completion/total tokens, elapsed_ms, generated_at) into a NEW `edition_meta` table created via `CREATE TABLE IF NOT EXISTS`, so prod's DB picks the table up automatically — no migration step, and nothing in the generation/publish path reads it back. The current branch already has commit `0e270d9 "feat(promos): add Promos gallery page surfacing edition videos"`; merging the branch into `main` intentionally brings BOTH the promos-gallery page and the telemetry work to production. The current branch has NO upstream set yet.

CRITICAL NEWSLETTER HAZARD: `publish-edition.js` emails ALL subscribers when `NEWSLETTER_SECRET` + `CHAT_WORKER_URL` are set (they ARE set in CI). Today's edition is already published. Therefore manually running `npm run publish` locally, or triggering the workflow with `workflow_dispatch`, would generate a DUPLICATE edition AND blast an unwanted newsletter. Do NOT force a publish or dispatch the workflow as part of "deploy". Forcing a publish is a separate, explicitly-confirmed decision only.

Known dead ends: none yet.

**Inputs**

Run everything from the repo root: `/Users/christopherharris/projects/gittimes`

Verified-to-exist paths (the intended telemetry + notes change set):
- `/Users/christopherharris/projects/gittimes/src/db.js` (new `edition_meta` table + `recordEditionMeta`/`getEditionMeta` + exports)
- `/Users/christopherharris/projects/gittimes/src/xai.js` (token-usage accumulator: `getMetrics`/`resetMetrics`, fail-silent capture in `_chat`)
- `/Users/christopherharris/projects/gittimes/publish-edition.js` (resets metrics, times the run, writes an `edition_meta` row after publish; fully wrapped in try/catch)
- `/Users/christopherharris/projects/gittimes/CONTEXT.md` (working notes — owner's call whether to include; default: INCLUDE it)
- `/Users/christopherharris/projects/gittimes/.github/workflows/daily-edition.yml` (the deploy pipeline — read-only reference; do not edit)
- `/Users/christopherharris/projects/gittimes/package.json` (scripts: `test`, `publish`, `lint`)

Untracked scratch/experimental files that MUST NOT be committed or staged:
- `PROMPT.md`, `prompts/`, `scratch/`, `test_resonance.py`, `frontpage-concepts.html`, `frontpage-split-prototype.html`

Remote (verified): `origin` = `https://github.com/artchristech/gittimes.git`

Exact command sequence (copy-pasteable). Inspect first, then act:

```bash
cd /Users/christopherharris/projects/gittimes

# 0. Orient — confirm branch, remote, and what's dirty
git status
git branch --show-current        # expect: feature/promos-gallery
git remote -v                     # expect origin -> https://github.com/artchristech/gittimes.git

# 1. Stage ONLY the intended files (never `git add -A` / `git add .`)
git add src/db.js src/xai.js publish-edition.js CONTEXT.md

# 2. Verify the staged set is EXACTLY those 4 files and no scratch files
git diff --cached --name-only

# 3. Commit the telemetry work
git commit -m "feat(telemetry): record per-edition generation stats to edition_meta"

# 4. Run the test gate on the feature branch before merging
npm test                          # expect: 499 pass, 0 fail

# 5. Merge feature branch into main (fast-forward or merge commit both fine)
git fetch origin
git switch main
git pull --ff-only origin main    # sync local main with remote first; if this FAILS due to divergence, STOP and report
git merge --no-ff feature/promos-gallery -m "merge: promos gallery + edition telemetry"

# 6. Re-run tests on the merged main
npm test                          # expect: 499 pass, 0 fail

# 7. Push main to origin — THIS is the deploy
git push origin main
```

**Constraints**

- Hard: Stage files explicitly by name. NEVER use `git add -A`, `git add .`, or `git add -u`. The untracked scratch files (`PROMPT.md`, `prompts/`, `scratch/`, `test_resonance.py`, `frontpage-concepts.html`, `frontpage-split-prototype.html`) MUST NOT enter any commit or land on `main`.
- Hard: Do NOT run `npm run publish`, do NOT run `node publish-edition.js`, and do NOT trigger the workflow via `workflow_dispatch` / `gh workflow run`. Deploy is push-to-`main` only; forcing a publish would create a duplicate edition and email all subscribers.
- Hard: Do NOT set, export, echo, or otherwise reference `NEWSLETTER_SECRET` or `CHAT_WORKER_URL`. They live only in CI.
- Hard: `npm test` must be green (499 pass, 0 fail) both before the merge and on `main` after the merge. If any test fails, STOP — do not push (a red test also aborts the CI deploy).
- Hard: NEVER force-push. No `--force`, no `--force-with-lease`, no history rewrite of `main` or the remote.
- Hard: Merge `feature/promos-gallery` into `main` (both promos-gallery and telemetry must reach production). Do not cherry-pick a subset, and do not rebase/squash in a way that drops the existing `0e270d9` commit.
- Do not edit `.github/workflows/daily-edition.yml` or any source file as part of this task — commit and merge only.
- Do not invent paths, scripts, or remotes beyond those listed. Do not delete or move the scratch/untracked files; leave them unstaged and untracked.
- If `git pull --ff-only origin main` fails because local `main` has diverged, STOP and report rather than force-merging or force-pushing. Treat every irreversible step (commit, merge, push) as a gate: verify state immediately before it, and abort + report if reality does not match this prompt.

**Definition of done**

- The telemetry commit exists and is reachable from `origin/main`: `git log origin/main --oneline` shows the new `feat(telemetry): ...` commit AND the existing promos commit `0e270d9`.
- The telemetry CODE actually landed on `main` (not just a commit message): `git show main:src/db.js` contains `edition_meta`, `git show main:src/xai.js` contains `getMetrics`, `git show main:publish-edition.js` contains `recordEditionMeta`.
- `git ls-files` on `main` does NOT list `PROMPT.md`, `test_resonance.py`, `frontpage-concepts.html`, `frontpage-split-prototype.html`, or anything under `prompts/` or `scratch/`.
- The working tree is clean of the four intended files: `git status` shows `src/db.js`, `src/xai.js`, `publish-edition.js`, `CONTEXT.md` committed (not modified). The scratch files remaining untracked is fine and expected.
- `npm test` on `main` reports 499 pass, 0 fail.
- Local `main` and `origin/main` point at the same commit: `git rev-parse main` == `git rev-parse origin/main`.
- No edition was published and no newsletter was sent as a side effect of this task (no `publish-edition.js` run, no `workflow_dispatch` fired).

**Verification**

Run from `/Users/christopherharris/projects/gittimes`:

```bash
# Both intended commits are on the pushed remote main
git log origin/main --oneline -n 5
git log origin/main --oneline | grep -i "feat(telemetry)"   # must print the telemetry commit
git log origin/main --oneline | grep "0e270d9"              # must print the promos commit

# The telemetry CODE content actually landed on main (not just a commit subject)
git show main:src/db.js          | grep -E 'edition_meta|recordEditionMeta|getEditionMeta'   # expect matches
git show main:src/xai.js         | grep -E 'getMetrics|resetMetrics'                          # expect matches
git show main:publish-edition.js | grep -E 'recordEditionMeta|edition_meta'                   # expect matches

# Local main == remote main (push succeeded, no divergence)
git rev-parse main
git rev-parse origin/main                                   # must equal the line above

# NONE of the scratch/experimental files are tracked on main
git ls-files | grep -E 'PROMPT\.md|test_resonance\.py|frontpage-(concepts|split-prototype)\.html|^prompts/|^scratch/'
#   ^ expect NO output (empty result = pass)

# The four intended files ARE tracked and clean (no longer modified)
git ls-files src/db.js src/xai.js publish-edition.js CONTEXT.md   # expect all four listed
git status --porcelain | grep -E 'src/db\.js|src/xai\.js|publish-edition\.js|CONTEXT\.md'
#   ^ expect NO output for these as modified/staged (empty = pass)

# Test gate green on main
npm test                                                    # expect: 499 pass, 0 fail

# Confirm the deploy workflow was not altered
git diff origin/main -- .github/workflows/daily-edition.yml  # expect NO output (workflow untouched)
```

Report the final commit hash of `origin/main`, the `npm test` tally, and confirm explicitly that no publish/newsletter was triggered.

<!-- prompt-out v1 -->
