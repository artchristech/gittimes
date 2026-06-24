**Problem**

The Git Times can run a stale LEAD: an old-but-trending repo with no fresh hook reaches the front page because recency is only a soft 0.30 score weight (`scoreRepo` in `src/github.js`) and the lead is chosen by significance/momentum (`chooseEditorialLead` in `src/editorial.js`) with no hard "must be recent" gate. Slots aren't differentiated — the front-page LEAD, secondary stories, Quick Hits, the AI Wire, and the Markets "On Our Radar" radar all share the same loose freshness handling. A newspaper that posts old news isn't a newspaper. The fix: define and enforce a per-slot recency rules table with the strictest bar on the LEAD and graduated, looser bars below it — where the LEAD bar keys on a genuine recent hook (a release / major event), not on push activity alone.

**Context**

The Git Times is an AI newspaper for builders (gittimes.com), zero-framework Node.js, no build step, built by `publish-edition.js`. Edition shape: front-page LEAD → secondary stories → Quick Hits → AI Wire (Hacker News + arXiv) → AI Markets page with an "On Our Radar" untracked-models section. Tests run via `node --test test/*.test.js` (`npm test`); `npm run lint` must stay clean. Existing tests already use deterministic fixtures and injected `now`/`nowMs` (e.g. `scoreRepo(repo, { now })`, and `ai-headlines.js` accepts `nowMs`/`hoursBack`/`minPoints`), so recency is testable without real network or wall-clock time.

Recency handling today (all soft, none excluding):
- `src/github.js`: `fetchTrending()` queries use `created:>${sevenDaysAgo} stars:>50`, `stars:>1000 pushed:>${threeDaysAgo}`, and topic/lang `pushed:>${threeDaysAgo}`. `scoreRepo` weights velocity 0.40 / recency 0.30 (7-day linear decay on `pushed_at`) / release 0.18 (30-day decay) / engagement 0.12, minus a repeat-history penalty.
- `src/editorial.js`: `chooseEditorialLead` / `selectLeadCandidates` pick the LEAD by significance among momentum candidates; `isVersionChurn` demotes thin patch bumps to Quick Hits. No explicit "lead must be recent" requirement.
- `src/prompts.js`: `freshnessDirective` (repos ≥90d → "This project is <age>. It is NOT new.") is prose-only and never excludes; `signalsLine` renders "Last commit: Nd ago".
- `src/ai-headlines.js`: HN Algolia query uses `created_at_i>${sinceTs}, points>=${minPoints}` over `hoursBack`; arXiv returns most-recent.

A repo carries multiple candidate timestamps — `pushed_at` (last commit/push), the latest release/tag date (a genuine "hook"), and `created_at`. The LEAD bar must key on a real hook, not merely an active default branch, so a repo pushed yesterday but with no release / major event in months does not qualify as the lead on push-recency alone.

Known dead ends: (1) the prose freshness DIRECTIVE in `src/prompts.js` already exists and only changes the article's tone — it never excludes a story, so do not extend it to "fix" this. (2) The 0.30 recency weight in `scoreRepo` is a global ranking nudge, not a per-slot bar, so raising it does not differentiate slots and a high score must NOT be able to rescue a stale item past its slot bar. (3) The `fetchTrending` query windows pre-filter the candidate pool but apply identically to all slots and cannot express "lead is stricter than quick-hits." (4) A test that only asserts score ordering (stale ranked below fresh) is too weak — a stale item can rank lower and still ship; a passing test MUST assert the stale item is ABSENT from the selected slot/set, not merely lower-ranked. Per-slot enforcement is new code.

**Inputs**

- Repo root: `/Users/christopherharris/projects/gittimes`
- `/Users/christopherharris/projects/gittimes/src/github.js` — `fetchTrending`, `scoreRepo` (recency math, timestamp fields)
- `/Users/christopherharris/projects/gittimes/src/editorial.js` — slot assignment, `chooseEditorialLead`, `selectLeadCandidates`, `isVersionChurn`
- `/Users/christopherharris/projects/gittimes/src/prompts.js` — `freshnessDirective`, `signalsLine`
- `/Users/christopherharris/projects/gittimes/src/ai-headlines.js` — HN `hoursBack`/`sinceTs`, arXiv recency
- `/Users/christopherharris/projects/gittimes/publish-edition.js` — orchestration / where slots are assembled
- Tests: `/Users/christopherharris/projects/gittimes/test/editorial.test.js`, `/Users/christopherharris/projects/gittimes/test/github.test.js`, `/Users/christopherharris/projects/gittimes/test/ai-headlines.test.js`
- A repo candidate object exposes `pushed_at`, a latest release/tag date, and `created_at` (confirm exact field names by reading `src/github.js` — e.g. `repo._latestRelease.published_at`) `(unverified)`
- Commands: `npm test`, `npm run lint`

**Constraints**

- Zero new dependencies; zero-framework Node.js, no build step. Match the existing module/style conventions (read a current `src/*.js` first — CommonJS `require`/`module.exports`).
- All recency logic must be pure and testable with an injected `now` (no bare `Date.now()` in the decision path) so tests are deterministic.
- Define the per-slot windows as named, exported constants in ONE place (a single source of truth, e.g. a `RECENCY_RULES` table), not scattered magic numbers. Each rule must name BOTH a concrete window AND the timestamp field it keys on. The rule and any related directive read from this one table.
- Bars must be graduated and ordered strictest-to-loosest: LEAD strictest (and must key on a genuine hook — release / major event — not push activity alone) → secondary looser → Quick Hits loosest of the repo slots → AI Wire on an hours window → "On Our Radar" radar on its own rule.
- Enforcement must EXCLUDE/DEMOTE, not merely re-rank or re-tone: a candidate failing the LEAD bar must not be selected as LEAD (it may fall through to a looser slot whose bar it does pass). A high score cannot keep a stale item in a slot it fails.
- Preserve existing legitimate behavior: do not break OSSInsight velocity/recency zeroing, `isVersionChurn` demotion, backfill, or the established-but-fresh `queryB` lane wholesale — gate within it (the point is to stop years-old-but-recently-pushed repos from headlining, not to delete the lane).
- Don't widen scope: no new slots, no UI/copy redesign, no network changes. The live API windows in `fetchTrending`/`ai-headlines.js` may be reconciled to the constants, but the per-slot rules table + enforcement is the deliverable.

**Definition of done**

- A single exported per-slot recency rules table (e.g. `RECENCY_RULES`) exists with one entry per slot — `lead`, `secondary`, `quickHit`, `aiWire`, `radar` — each entry naming a concrete window (days/hours) AND the timestamp field it keys on. The `lead` entry keys on a genuine-hook field (release/major event), not push-only.
- The table is documented in-repo (a comment block at the table and/or a short doc note) as a human-readable slot → window → field mapping.
- A pure, `now`-injectable enforcement function decides slot eligibility from a candidate's timestamps and the table, and is wired into the real selection path (`src/editorial.js` lead selection + the AI Wire path) so the LEAD is actually rejected when it fails its bar — verified through the pipeline, not just a unit helper nothing calls.
- The bars are graduated and ordered strictest→loosest (lead ≤ secondary ≤ quickHit windows; aiWire on an hours window; radar its own rule) — checkable by asserting the constants' ordering in a test.
- NEW tests prove, with an injected fixed `now` and deterministic fixtures (each fixture differs from its pair ONLY in the age field the rule keys on):
  - a STALE-no-hook repo fixture (recent `pushed_at` but no recent release/hook) is REJECTED as LEAD and is ABSENT from the lead slot (assert absence, not lower rank);
  - a FRESH-hook repo fixture (recent release/hook within the lead window) is ACCEPTED as LEAD;
  - an AI-Wire item older than the hours window is ABSENT from the kept headlines while one inside it is PRESENT;
  - a boundary test pins the exactly-at-threshold case to a documented include/exclude decision;
  - an ordering assertion that `RECENCY_RULES.lead.windowDays <= RECENCY_RULES.secondary.windowDays <= RECENCY_RULES.quickHit.windowDays`.
- `npm test` is green (all existing + new tests) and `npm run lint` is clean. No new dependencies, no regressions to existing passing tests.

**Verification**

Run from `/Users/christopherharris/projects/gittimes`:

1. `ls test/` to confirm the test filenames before editing.
2. `npm test` — all tests pass, including the new per-slot recency tests in `test/editorial.test.js` (lead accept/reject by absence) and `test/ai-headlines.test.js` (hours-window exclude/include).
3. `npm run lint` — exits clean, no new warnings.
4. Deterministic fixture check (no network) — the new tests inject a fixed `now` and assert:
   - the STALE-no-hook fixture's selected slot is NOT `lead` (and it is absent from the lead output) — it fell through to a looser slot or dropped;
   - the FRESH-hook fixture's selected slot IS `lead`;
   - an AI-Wire fixture older than the configured `hoursBack` is excluded, and one inside it is included;
   - `RECENCY_RULES.lead.windowDays <= RECENCY_RULES.secondary.windowDays <= RECENCY_RULES.quickHit.windowDays`.
5. Single-source-of-truth: `grep -rn "RECENCY_RULES" src/ publish-edition.js` shows the table defined once and imported where enforced (github/editorial/ai-headlines reference the shared constant, not re-declared literals).
6. The LEAD keys on a hook, not push-only: inspect the `lead` entry's timestamp field in `RECENCY_RULES` and the enforcement function — it must reference the release/hook field, and the STALE-no-hook test (recent `pushed_at`, no release) must fail the lead bar specifically because of that field.

<!-- prompt-out v1 -->
