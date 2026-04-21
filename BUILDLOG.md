# Build Log

> Symbolic memory of the building process. Not what changed — how it felt to build it.
> Read Project Pulse first. Scan recent entries for context. Check Archive for deep history.

## Project Pulse
Status: Battle-tested MCP + REST API (both green), hardened the fragile surface (record-promo, x-sentiment, account page), cleaned dead weight. Caught a closed-loop incident: catalog-format voice drift re-emerged on 2026-03-23, shipped one bad edition (2026-03-27), was reverted 2026-04-02 — voice has held on every edition since.
Confidence: Solid on publishing pipeline, MCP/REST surface, and editorial voice recovery. The lesson from the catalog incident is that the voice rule is *load-bearing and reversible within days* — the guardrail works when tripped.
Frontier: Editorial voice monitoring is the next real frontier. The catalog experiment made it through one publish cycle before reversal; a cheaper feedback loop (voice-shape validator at publish time?) would catch drift before an edition ships rather than after. Separately, the local site/editions mirror is stale relative to gh-pages — publish-edition.js only syncs in non-CI, and local hasn't been run in weeks.
Debt mood: clean — 18 grade items still resolved, no new ones opened by today's hardening. `fetchXPulse`/`parseXPulse` dead code removed (feature was replaced by Memes per `03ac633`). Record-promo now cleans `.frames-*` dirs on failure via try/finally. `account.js` warns when `CHAT_WORKER_URL` is missing. Pre-existing `slugify` unused-import fixed in `publish.js`.

## Entries

### 2026-04-17 — battle-test and harden after MCP/REST landing
**Did:** Spock-style three-option strategic triage picked Options II + III (skip editorial audit). Battle-tested MCP server (9 tools, all green over stdio) and REST API (9 endpoints, all shapes + 404/405/CORS correct). Hardened: removed unused CDP session stub from `record-promo.js`, wrapped capture+ffmpeg in try/finally for frame/browser cleanup on failure; stripped dead `fetchXPulse`/`parseXPulse` from `x-sentiment.js`; added `CHAT_WORKER_URL` missing-warn to `account.js`; fixed pre-existing `slugify` unused-import lint error in `publish.js`. Removed stray `dist/` dir and `promo-2026-03-02.html` (both gitignored). 396/396 tests pass, lint clean.
**Surprised by:** The "16-line stub" framing of `account.js` was wrong — it's a thin wrapper around a substantial template (`templates/account.html`) that handles magic-link login, Stripe upgrades, and is linked from every page's masthead. Load-bearing, not vestigial. Also surprised: latest DB-recorded edition (2026-03-27) has headline `"firecrawl"` — catalog format — triggering the drift alarm, but verifying against gh-pages showed the revert had already landed and every edition since 2026-04-04 is proper journalism voice. Local DB was just stale.
**Shifted understanding:** The catalog-format incident (2026-03-23 introduce → 2026-03-27 ship one bad edition → 2026-04-02 revert) is the first recorded end-to-end *voice regression and recovery*. It validates two things: (1) the editorial voice rule is real-stakes, not just aesthetic preference — one bad edition slipped into production; (2) the recovery loop works (5 days introduce-to-revert). But the *detection* was human — a voice-shape validator at publish time would make the loop tighter.
**Next grip:** Either (a) write the voice-shape validator (reject article generation if headline matches repo-name or repo-description patterns), or (b) pivot to a fresh grade audit now that the system is battle-tested and the debt ledger remains at zero. Voice validator is more interesting and higher-leverage given the recent incident.

### 2026-03-03 — grade audit sweep to zero
**Did:** Systematically resolved every open item in GRADE_IMPROVEMENTS.md — flipped HTML sanitization from blocklist to allowlist, removed dead `renderSecondaryArticle`, fixed variable shadowing (`seen` -> `rawSeen`), added null guards on `repo.topics`, centralized hardcoded model string in x-sentiment.js, and threaded `githubToken` through editorial pipeline.
**Surprised by:** The `sanitizeArticleHtml` blocklist (strip `<script>`, `<iframe>`) was fundamentally wrong — any tag not explicitly blocked would pass through (`<style>`, `<object>`, `<embed>`, `<form>`, `<svg>`). Flipping to a `SAFE_TAGS` allowlist inverts the security posture: unknown tags are stripped by default. The blocklist was passing tests but one LLM hallucination of a `<style>` tag away from a visual attack.
**Shifted understanding:** GRADE_IMPROVEMENTS.md has evolved from a checklist into a living contract — each item carries its own lifecycle (open -> resolved with file refs). Getting to zero open items for the first time reveals the document's real value: it's a forcing function for systematic cleanup rather than ad-hoc fixes.
**Next grip:** Commit the uncommitted cleanup, then either run a fresh grade audit to surface new issues or shift attention to editorial content quality — the pipeline works but the LLM output voice hasn't been critically evaluated since the star-count-to-substance editorial shift on Mar 2.

## Archive
