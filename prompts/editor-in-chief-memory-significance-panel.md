**Problem**

You are extending the editor-in-chief of "The Git Times" (a daily AI/dev newspaper auto-built from GitHub trending data, published to gittimes.com) with three editorial-intelligence features. The build runs unattended as a daily GitHub Actions cron and has ALREADY died in production from OpenRouter free-tier 429s. Your job is to make the editor smarter WITHOUT ever making the daily build more fragile. You will ship three independently-revertable, test-gated increments. At every step, the daily cron must still succeed — degrading to today's exact behavior — even if every new external source and every new LLM call fails. Robustness is the deliverable; the features are secondary to never breaking the cron.

The three features, in mandatory build order (each its own increment, each independently revertable):

1. **EDITORIAL MEMORY / CONTINUITY** (lowest risk: deterministic data + prompt context, zero new external calls). Persist a running "thread ledger" across editions (extend `site/editions/history.json`) and feed prior-lead + thread context into the lead-decision prompt so the editor writes follow-ups, kills repeats, and builds arcs.
2. **CROSS-SOURCE SIGNIFICANCE** (medium risk: new keyless network calls, all fail-soft). Enrich lead candidates with real-world-attention signals — HN discussion volume (already fetched; match to repos), npm/PyPI download deltas (keyless public APIs), notable stars/funding/news — and surface them in the editor's candidate summary so it ranks on significance, not just star velocity.
3. **PANEL EDITOR + VISIBLE RATIONALE** (highest LLM cost: multiple LLM calls). Replace the single lead call with a best-of-N "lens panel" (impact / novelty / consequence-to-builders) → synthesized pick + one-paragraph rationale, rendered as a visible "Why this leads today" byline on the front page. MUST fail-soft to the existing single `chooseEditorialLead` on ANY panel error or rate-limit.

**Context**

Repo: `/Users/christopherharris/projects/gittimes`. Node.js, near-zero dependencies, fail-soft throughout. Tests run via `npm test` (`node --test`, 488 currently passing). Deploys to gh-pages via the daily cron `.github/workflows/daily-edition.yml` → `node publish-edition.js`.

The editor-in-chief, as it exists today:
- `src/pipeline.js` `runPipeline()`: fetch → `makeEditorialPlan` → `generateEditorialContent` → dedup → publish. Already threads prior-edition signals: `recentLeadRepos`, `recentRepoCoverage`, `recentEditionDates`.
- `src/editorial.js`: `makeEditorialPlan()`, `selectLeadCandidates()` (recency-gated via `src/recency.js` `leadEligible`) → 4–6 candidates shaped `{repo, delta, reason}`.
- `src/xai.js` `chooseEditorialLead(client, candidates, llmLimit)` → `{chosen, why, viaEditor}`: ONE `chat()` call using `chooseLeadPrompt(candidates)` (`src/prompts.js`), tolerant parse (accepts a number OR a repo name), fallback to `candidates[0]`. The `why` is captured into `editorialMeta.leadEditor` (around `src/xai.js:491`) but only console-logged (around `src/xai.js:496`), never rendered.
- LLM access: every editorial call goes through `chat(client, MODEL, prompt, maxTokens)` in `src/xai.js`. `MODEL = process.env.LLM_MODEL || "nvidia/nemotron-3-super-120b-a12b:free"`. Concurrency is bounded by an existing `llmLimit`; retries via `pRetry`. A failed lead-path LLM call currently aborts the whole build — your changes must remove that as a failure mode for any NEW call.
- `src/history.js` `loadHistory` / `computeDeltas`: star deltas + prior edition; snapshot persisted at `site/editions/history.json`; manifest at `site/editions/manifest.json`.
- `src/ai-headlines.js` `fetchAIHeadlines()` (Hacker News, keyless, fail-soft) + `fetchArxiv()`: fetched for the AI Wire but currently UNUSED by the editor — feature 2 consumes these.
- `src/render.js` `renderFrontPagePanel()` renders the lead via `renderHybridArticle(fp.lead, {isLead:true})` + `renderDeskRail()`. `templates/newspaper.html` is the page shell. Repos carry `full_name`, `_latestRelease`, `stargazers_count`, `language`, and a repo URL. `render.js` already escapes rendered model text (e.g. `escapeHtml`) — the rationale byline must use the same escaping.

Known dead ends: The free Nemotron model has historically answered the lead prompt with a repo NAME instead of a NUMBER — do NOT assume structured output; reuse the existing tolerant-parse pattern for every new LLM response you parse. Free-tier 429s have caused FATAL daily-build failures — this is exactly why fail-soft is non-negotiable for every new call. xAI has been dropped; the project is OpenRouter-only — do not reintroduce an xAI client or any other provider. `editorInChiefPrompt` in `src/prompts.js` is DEAD CODE; do not wire it without rewriting it for this purpose. There are no other known dead ends specific to these three features.

**Inputs**

- `/Users/christopherharris/projects/gittimes/src/pipeline.js` — `runPipeline()`, orchestration + prior-edition signal threading.
- `/Users/christopherharris/projects/gittimes/src/editorial.js` — `makeEditorialPlan()`, `selectLeadCandidates()`.
- `/Users/christopherharris/projects/gittimes/src/xai.js` — `chat()`, `chooseEditorialLead()`, `MODEL`, `llmLimit`, `pRetry` (around lines 491/496 for `leadEditor` capture/log).
- `/Users/christopherharris/projects/gittimes/src/prompts.js` — `chooseLeadPrompt()`, `candidateSummaryLines()`, `priorCoverageBlock()`, and sibling prompt builders; dead `editorInChiefPrompt`.
- `/Users/christopherharris/projects/gittimes/src/recency.js` — `leadEligible` recency gate (must be preserved).
- `/Users/christopherharris/projects/gittimes/src/history.js` — `loadHistory`, `computeDeltas`; persistence to `site/editions/history.json`.
- `/Users/christopherharris/projects/gittimes/src/ai-headlines.js` — `fetchAIHeadlines()`, `fetchArxiv()` (keyless, fail-soft; feed for feature 2).
- `/Users/christopherharris/projects/gittimes/src/render.js` — `renderFrontPagePanel()`, `renderHybridArticle()`, `renderDeskRail()`, `escapeHtml`.
- `/Users/christopherharris/projects/gittimes/templates/newspaper.html` — page shell.
- `/Users/christopherharris/projects/gittimes/src/github.js` — `fetchAllSections()`, `scoreRepo()`, `categorizeDiverseForSection()`.
- `/Users/christopherharris/projects/gittimes/publish-edition.js` — daily cron entrypoint.
- `/Users/christopherharris/projects/gittimes/.github/workflows/daily-edition.yml` — cron workflow.
- `/Users/christopherharris/projects/gittimes/site/editions/history.json` — persisted snapshot (extend for feature 1's thread ledger).
- `/Users/christopherharris/projects/gittimes/site/editions/manifest.json` — edition manifest.
- `/Users/christopherharris/projects/gittimes/site/index.html` — rendered front page (grep target for feature 3's byline).
- `/Users/christopherharris/projects/gittimes/test/` — test directory for `node --test` files (unverified exact layout; confirm by reading an existing test).
- `/Users/christopherharris/projects/gittimes/package.json` — confirm the `test` script and dependency footprint.
- Optional paid model for the panel synthesis call ONLY, referenced by env-var name `EDITOR_MODEL` (falls back to `MODEL` when unset). Existing model override is `LLM_MODEL`. No keys inline; OpenRouter credentials come from the existing env-var the project already reads — do not introduce new secret-bearing env vars.

**Constraints**

Read these as gates to satisfy, not aspirations:

1. **Build order is mandatory.** Feature 1, then 2, then 3 — in that order, each landed and verified before the next begins. Each feature is a separate, independently-revertable increment (a clean `git revert` of that feature's commit(s) must restore the prior green state). Do not interleave.
2. **Green test suite at every step.** `npm test` must pass (≥488 tests; you add more, you remove none) after EACH increment, not just at the end. Preserve every existing recency gate and all existing tests unchanged in behavior.
3. **Fail-soft is absolute.** EVERY new LLM call and EVERY new network call must (a) be wrapped so any error/timeout/non-200/429 is caught and degrades to today's behavior, and (b) be concurrency-limited via the existing `llmLimit` (for LLM calls). A new external source that is dead, missing, rate-limited, or returns garbage must degrade SILENTLY — no throw escapes to the pipeline.
4. **The cron cannot break.** `publish-edition.js` must still produce a valid edition and exit 0 even if: feature 1's ledger file is absent/corrupt, EVERY feature-2 source fails, AND the feature-3 panel fully fails. In that worst case the output must equal today's behavior (single `chooseEditorialLead`, no significance enrichment, prior-lead context only if cleanly available).
5. **Keyless or fail-soft sources only.** Feature 2 uses keyless public APIs (HN already fetched; npm registry download-counts API; PyPI stats — keyless). Any source needing a key is OPTIONAL, referenced by env-var name, and absent-key = that source silently off. No secrets inline anywhere.
6. **Reuse the tolerant-parse pattern.** Every new LLM response parse must tolerate a number OR a name OR prose, with a deterministic fallback — never assume structured/JSON output from the free model.
7. **Near-zero new dependencies.** Prefer the standard library (`fetch`, `node --test`). Do not add an LLM SDK, an HTTP client, or a provider beyond OpenRouter. No xAI client.
8. **Panel fails soft to single call.** Feature 3's panel MUST fall back to the existing `chooseEditorialLead` on any panel error, partial-result, or rate-limit — the panel is strictly additive over a path that already works.
9. **Bounded LLM cost.** The panel adds the only meaningful new LLM spend; keep its calls behind `llmLimit` and behind the fail-soft path, and let `EDITOR_MODEL` (optional) point the synthesis call at a paid model without changing the default free-tier behavior.
10. **Escape rendered model text.** The "Why this leads today" rationale is model-generated text rendered into HTML — it MUST be escaped with the same mechanism `render.js` already uses for model fields (`escapeHtml`). No raw model output in the DOM.

**Definition of done**

Observable, per feature:

- **Feature 1 (Editorial Memory):** `site/editions/history.json` gains a thread-ledger structure carrying prior lead(s) + running thread context; the lead-decision prompt visibly includes that context (assertable in a unit test on the prompt builder — e.g. `chooseLeadPrompt` output contains a prior-lead/thread block). New unit tests cover: ledger read/append, corrupt/absent ledger → safe default, repeat-suppression logic, prompt-context injection. `npm test` green. A dry-run build with the ledger file deleted still produces a valid edition.
- **Feature 2 (Cross-Source Significance):** Each candidate can carry an optional significance summary (HN volume matched to repo, npm/PyPI download delta, etc.) that appears in the editor's candidate summary (`candidateSummaryLines`). New unit tests cover: source-match logic, each source's parse, and per-source fail-soft (mock a throwing/non-200 source → candidate still produced, no significance, no throw). `npm test` green. A dry-run build with EVERY feature-2 source forced to fail produces the same edition as feature-1-only behavior.
- **Feature 3 (Panel Editor + Visible Rationale):** The front page renders a visible "Why this leads today" rationale byline (greppable in `site/index.html`, escaped). The panel runs N lens calls + a synthesis call (synthesis honoring `EDITOR_MODEL` when set), all `llmLimit`-bound, all tolerant-parsed. New unit tests cover: synthesis parse (number/name/prose), panel-error → fallback to `chooseEditorialLead`, rationale-rendering + escaping. `npm test` green. A dry-run build with the panel forced to fail renders the front page identically to today PLUS no broken byline (rationale omitted or shows the single-call `why`, never an error).
- **Global:** All three increments are separate revertable commits; reverting any one restores the prior green state. `npm test` passes after each. The "everything-fails-still-builds" check (below) passes.

**Verification**

Run from `/Users/christopherharris/projects/gittimes`. Confirm the exact test-directory path and `test` script first by reading `package.json` and one existing test file; adjust commands if the project uses a different runner.

1. Baseline (before any change): `npm test` → record the passing count (expect 488).
2. After EACH feature increment, in order:
   - `npm test` → must be green and ≥ the prior count (you only add tests).
   - Confirm the increment is its own commit and `git revert <sha> --no-edit` (in a scratch clone or after stashing) restores a green `npm test`.
3. Normal dry-run build (no live publish/push) after all three: run the local edition build (e.g. `node publish-edition.js` in a dry-run/no-push mode — confirm the dry-run flag/env by reading `publish-edition.js` and the workflow; if none exists, run it against a scratch output dir so nothing is pushed). Confirm it exits 0 and writes a valid `site/index.html`.
4. Visible-byline check: `grep -i "Why this leads today" site/index.html` → must match after a successful build.
5. THE EVERYTHING-FAILS-STILL-BUILDS CHECK (the load-bearing test): force-fail every new path at once and confirm the cron still produces today's edition and exits 0. Do this by (a) deleting/renaming the thread-ledger so feature 1 hits its absent-file default, (b) forcing every feature-2 source to throw/return non-200 (via a test env flag you add, e.g. `GT_DISABLE_SOURCES=1`, or by pointing them at an unroutable host), and (c) forcing the panel to fail (e.g. `EDITOR_MODEL` set to an invalid model id or a panel-disable flag you add, e.g. `GT_DISABLE_PANEL=1`). Run the dry-run build under these conditions → it MUST exit 0, write a valid `site/index.html`, fall back to single-call `chooseEditorialLead`, and NOT render a broken byline. Document the exact env flags you added in your final report.
6. Also simulate a free-tier 429 on the new LLM paths (mock `chat()` to reject with a 429) in a unit test → assert the pipeline still completes and falls back, never throws.
7. `grep -rn "EDITOR_MODEL" src/` shows the override is read from env and applied only to the panel/synthesis path; `grep -rn "xai" src/` confirms no xAI client was reintroduced.

Report at the end: the env flags/dry-run mechanism you used, the per-increment test counts, the three commit SHAs (for the revert story), and the result of the everything-fails-still-builds check.

<!-- prompt-out v1 -->
