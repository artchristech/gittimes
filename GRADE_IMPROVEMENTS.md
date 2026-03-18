# Grade Improvements Playbook
_Scope: Full Application | Last graded: 2026-03-18_

## Strategies & Hard Rules
Principles that should always/never apply in this codebase.

**[shr-001]** `resolved` · added 2026-02-21 · resolved 2026-03-03
Always HTML-escape all LLM-generated content before inserting into HTML templates — including body text, not just headlines. `sanitizeArticleHtml` now uses an allowlist of safe tags instead of a blocklist.
→ Files: `src/render.js:27-40`

**[shr-002]** `resolved` · added 2026-02-21 · resolved 2026-03-03
Always wrap JSON.parse of external API responses in try/catch with descriptive error messages.
→ Files: `src/github.js:31-39,89-93` — both `_graphqlRequest` and `_request` now have try/catch around JSON.parse with descriptive error messages.

**[shr-003]** `resolved` · added 2026-02-21 · updated 2026-02-26 · resolved 2026-03-03
Always guard array access on API response fields (e.g., `choices[0]`) before dereferencing.
→ Files: `src/xai.js:55` — `response.choices?.length` check added before access.

**[shr-004]** `resolved` · added 2026-02-26 · resolved 2026-03-03
Always verify that prompt-building functions receive the correct object shape (repo vs article) — mismatched shapes produce "undefined" in prompts.
→ Files: `src/prompts.js` — all prompt functions now receive enriched repo objects with correct shape. Dead `editionTaglinePrompt` (which caused the mismatch) has been removed.

**[shr-005]** `resolved` · added 2026-02-26 · resolved 2026-02-27
Regex patterns for structured output markers must not accidentally match substrings of longer markers (e.g., `HEADLINE:` matching inside `SUBHEADLINE:`).
→ Files: `src/xai.js:27,93` — fixed with `\b` word boundary; see tp-003.

**[shr-006]** `resolved` · added 2026-02-27 · resolved 2026-03-03
Fallback defaults in inner functions must match production values — `publish()` has its own `siteUrl` fallback (`src/publish.js:42`) independent of the caller's default in `publish-edition.js:21`.
→ Files: `src/publish.js:47` — both fallback to `"https://gittimes.com"`, values are now consistent.

**[shr-007]** `resolved` · added 2026-02-27 · resolved 2026-03-02
Always escape single quotes in `escapeHtml()` — without `&#39;` escaping, LLM content could break out of single-quoted HTML attributes.
→ Files: `src/render.js:13-19` — single quote escaping added at line 19.

**[shr-008]** `resolved` · added 2026-02-27 · updated 2026-03-02 · resolved 2026-03-03
Scoring model weights must sum to 1.0 — `scoreRepo` weights now total 1.0 (0.40+0.30+0.18+0.12).
→ Files: `src/github.js:194-198` — weights corrected.

**[shr-009]** `resolved` · added 2026-03-02 · resolved 2026-03-03
Always sanitize repo metadata (description, readmeExcerpt, topics, releaseNotes) before interpolating into LLM prompt templates — structured output markers in GitHub data could hijack article parsing.
→ Files: `src/prompts.js:23-26,59-62,110-113,148,173-175` — `sanitizeRepoField()` applied to all interpolated fields.

**[shr-010]** `resolved` · added 2026-03-03 · resolved 2026-03-03
Always validate API response shapes before accessing nested properties — GitHub Search API may return valid JSON without expected `items` array (rate limit, error payload with 200 status).
→ Files: `src/github.js:302` — guarded with `(resultA.items || [])` and `(resultB.items || [])`.

**[shr-011]** `open` · added 2026-03-04 · updated 2026-03-18
Never pass user-supplied message arrays to external LLM APIs without length and size limits — unbounded payloads enable cost amplification.
→ Files: `worker/index.js:697-706`

**[shr-012]** `open` · added 2026-03-18
Never interpolate variables into `execSync` template literals — use `spawn` with argument arrays or `execFileSync` to prevent shell injection.
→ Files: `publish-edition.js:24`

## Common Failure Patterns
Recurring mistake types observed across multiple files.

**[cfp-001]** `resolved` · added 2026-02-21 · updated 2026-02-26 · resolved 2026-03-03
Missing defensive checks on external API response shapes — GitHub API (`github.js:31-39,89-93`) now has try/catch with descriptive errors. xAI LLM (`xai.js:55`) now checks `response.choices?.length`. Remaining gap: `github.js:302` items array (tracked as shr-010).
→ Files: `src/github.js:31-39,89-93`, `src/xai.js:55`

**[cfp-002]** `resolved` · added 2026-02-21 · resolved 2026-03-03
Inconsistent HTML escaping — `escapeHtml()` is applied to most fields but the `bodyToHtml()` marked path relies on `sanitizeArticleHtml` regex stripping rather than proper allowlist-based sanitization. Now uses allowlist of safe tags.
→ Files: `src/render.js:27-40`

**[cfp-003]** `resolved` · added 2026-03-02 · resolved 2026-03-03
`sanitizeArticleHtml` in `render.js:32-33` — the regex `(?!https?:\/\/)[a-z][a-z0-9+.-]*:` already catches ALL non-http/https URI schemes including `data:`, `vbscript:`, `javascript:`, etc. The negative lookahead exempts only `http://` and `https://`.
→ Files: `src/render.js:32-33` — no code change needed; original assessment was incorrect.

**[cfp-004]** `resolved` · added 2026-02-26 · resolved 2026-02-27
Object shape mismatches between pipeline stages — article objects (`{headline, body, repo}`) are passed where repo objects (`{name, language}`) are expected, producing "undefined" in LLM prompts.
→ Files: `src/prompts.js:71-76` — `editionTaglinePrompt` is now dead code (replaced by `mastheadQuote`); shape mismatch can't occur at runtime.

**[cfp-005]** `resolved` · added 2026-03-03 · resolved 2026-03-03
`process.env.GITHUB_TOKEN` accessed directly inside LLM generation layer (`xai.js:317,329`) for breakout and sleeper enrichment, breaking the architecture's token-passing pattern used everywhere else.
→ Files: `src/xai.js` — `generateEditorialContent` now accepts `options.githubToken` and threads it to all internal callsites. Callers (`generate.js`, `publish-edition.js`) pass `{ githubToken }` explicitly.

**[cfp-006]** `open` · added 2026-03-04
Duplicated pipeline orchestration logic — `generate.js:24-49` and `publish-edition.js:31-55` independently implement the same fetch→history→deltas→editorial→generate flow. Changes must be applied in both places.
→ Files: `generate.js:24-49`, `publish-edition.js:31-55`

**[cfp-007]** `open` · added 2026-03-04 · updated 2026-03-18
Hidden module coupling via inline `require()` inside function bodies — used to work around circular dependency loading but makes the dependency graph opaque and harder to test.
→ Files: `src/xai.js:263,332,357,402,431,546`, `src/github.js:605,690`

**[cfp-008]** `open` · added 2026-03-18
Duplicated template rendering boilerplate — analytics script, CSP headers, and plausible domain logic are independently constructed in every page renderer module.
→ Files: `src/archive.js:37-42`, `src/landing.js:41-46`, `src/account.js:22-33`, `src/markets.js:258-263`, `src/render.js:504-514`

## Troubleshooting Pitfalls
Specific edge cases or gotchas that are easy to miss.

**[tp-001]** `resolved` · added 2026-02-21 · resolved 2026-02-26
`sanitizePrompt()` strips all non-ASCII characters, silently destroying international content (Chinese repo names, emoji, accented characters) in LLM prompts.
→ Files: `src/xai.js:23-26` (was `src/cerebras.js:19-22`) — now preserves unicode, only strips control chars.

**[tp-002]** `resolved` · added 2026-02-21 · resolved 2026-03-03
The quick-hit dedup uses `repo.full_name + "_used"` suffix in the same Set — could theoretically collide with a real repo name ending in `_used`.
→ Files: `src/github.js` — the `_used` suffix pattern no longer exists. Dedup now uses separate `seen` Sets with raw `full_name` keys.

**[tp-003]** `resolved` · added 2026-02-26 · resolved 2026-02-27
HEADLINE regex `/HEADLINE:\s*(.+)/` matches inside "SUBHEADLINE:" because the string contains "HEADLINE:". Combined with `lastMatch`, this causes every article with a SUBHEADLINE to get its headline replaced by the subheadline value.
→ Files: `src/xai.js:27,93` — replaced `(?<!SUB)` lookbehind with `\b` word boundary. Regression tests added in `test/unit.test.js`.

**[tp-004]** `resolved` · added 2026-02-26 · resolved 2026-02-27
Dead `generateContent` function at `xai.js:284-343` duplicates `generateSectionContent` logic but lacks X sentiment, X Pulse, and multi-section support. Exported but never called.
→ Files: `src/xai.js:284-345` — function removed; file now ends at line 283 with `module.exports`.

**[tp-005]** `resolved` · added 2026-02-27 · resolved 2026-02-27
No custom 404 page — non-existent URLs return GitHub's default 404 page instead of branded "The Git Times" page. GitHub Pages auto-serves `404.html` from the site root if present.
→ Files: `src/publish.js:178-192` — 404.html now generated from `templates/404.html`.

**[tp-006]** `resolved` · added 2026-02-27 · updated 2026-03-02 · resolved 2026-03-03
CNAME file at `src/publish.js:190` has no comment explaining its purpose. Comment at line 188 now explains: "GitHub Pages custom domain — must persist across deploys".
→ Files: `src/publish.js:188`

**[tp-007]** `resolved` · added 2026-02-27 · resolved 2026-03-02
`readManifest` at `publish.js:21` has no try/catch around `JSON.parse` — a corrupt or truncated `manifest.json` (e.g., from interrupted write) crashes the entire publish pipeline with an unhandled exception.
→ Files: `src/publish.js:21-26` — try/catch now wraps JSON.parse with warning log and graceful fallback to empty array.

**[tp-008]** `resolved` · added 2026-02-27 · updated 2026-03-02 · resolved 2026-03-03
Dead `editionTaglinePrompt` function in `prompts.js` is exported but never called — replaced by `mastheadQuote()` in `quotes.js`.
→ Files: `src/prompts.js` — function has been removed. Current exports: `sanitizeRepoField, leadArticlePrompt, secondaryArticlePrompt, quickHitPrompt, breakoutArticlePrompt, trendArticlePrompt, sleeperArticlePrompt, editorInChiefPrompt`.

**[tp-009]** `resolved` · added 2026-03-02 · resolved 2026-03-03
Dead `withSectionVoice` function and `SECTION_VOICE` constant in `prompts.js` — no longer present in the file.
→ Files: `src/prompts.js` — function and constant removed.

**[tp-010]** `resolved` · added 2026-03-02 · resolved 2026-03-03
`fetchTrajectories` in `star-history.js` creates a new local Map cache per invocation, causing duplicate GraphQL requests.
→ Files: `src/github.js:579` — `trajectoryCache = new Map()` created once in `fetchAllSections` and passed via `options.trajectoryCache` to all section fetchers.

**[tp-011]** `resolved` · added 2026-03-02 · resolved 2026-03-03
`generateAllContent` and `generateEditorialContent` in `xai.js` contain duplicated section-iteration loops.
→ Files: `src/xai.js:230-267` — shared `_generateBaseSections` helper extracted; both functions now call it.

**[tp-012]** `resolved` · added 2026-03-03 · resolved 2026-03-03
OSSInsight repos get fabricated timestamps (`created_at: new Date().toISOString()`, `pushed_at: new Date().toISOString()`) that propagate through `enrichRepo` into LLM prompts as real project creation/push dates, potentially generating incorrect age/timeline claims.
→ Files: `src/github.js:140-141` — now set to `null`; `scoreRepo` guards with ternary fallback to `Infinity`; `prompts.js` uses `timestampLine()` helper that omits null timestamps.

**[tp-013]** `resolved` · added 2026-03-03 · resolved 2026-03-03
`rawCollector` dedup uses O(n) `.some()` linear scan per repo instead of a parallel Set, causing quadratic performance in raw candidate collection across sections.
→ Files: `src/github.js` — `rawCollectorSeen` Set created alongside `rawCollector`; `.some()` replaced with `Set.has()` in both `fetchTrending` and `fetchSectionRepos`.

**[tp-014]** `resolved` · added 2026-03-03 · resolved 2026-03-03
Previous edition nav update regex `/<nav class="edition-nav">.*?<\/nav>/g` uses `.*?` which doesn't match newlines — would fail if nav HTML ever spans multiple lines.
→ Files: `src/publish.js:107` — changed to `[\s\S]*?` for multiline matching.

**[tp-015]** `resolved` · added 2026-03-03 · resolved 2026-03-03
Dead `renderSecondaryArticle` function at `render.js:68` is exported and tested but never called in production code — `renderSectionContent` builds secondary articles inline. Function, export, and tests removed.
→ Files: `src/render.js`, `test/unit.test.js`

**[tp-016]** `resolved` · added 2026-03-03 · resolved 2026-03-03
Hardcoded model string in `x-sentiment.js` while the rest of the codebase uses `MODEL` constant from `xai.js` — creates version drift when upgrading models. Now imports and uses `MODEL` from `xai.js`.
→ Files: `src/x-sentiment.js:1,67,133`, `src/xai.js:445`

**[tp-017]** `resolved` · added 2026-03-03 · resolved 2026-03-03
Variable shadowing: `const seen` declared at `github.js:300` (fetchTrending scope) and redeclared at `github.js:326` (rawCollector block within same function) — can cause confusion during maintenance. Renamed inner variable to `rawSeen` in both `fetchTrending` and `fetchSectionRepos`.
→ Files: `src/github.js:326,489`

**[tp-018]** `resolved` · added 2026-03-03 · resolved 2026-03-03
Inconsistent `topics` guarding in prompts.js — lines 33, 69 use `repo.topics.join()` without null guard, while line 120 uses `(repo.topics || []).join()`. Will throw if a repo has `topics: undefined`. Now all callsites use `(repo.topics || []).join()`.
→ Files: `src/prompts.js:33,69`

**[tp-019]** `open` · added 2026-03-04
`render.js:260-428` embeds 170 lines of client-side JavaScript (chat UI, SSE streaming, localStorage) as template literals inside server-side rendering code — can't be linted, minified, or tested independently.
→ Files: `src/render.js:260-428`

**[tp-020]** `open` · added 2026-03-04 · updated 2026-03-18
Worker uses hardcoded `"grok-3-mini"` model (`worker/index.js:697`) while the rest of the codebase uses `MODEL` constant from `xai.js` — creates model version drift risk (same class of issue as resolved tp-016).
→ Files: `worker/index.js:697`

**[tp-021]** `open` · added 2026-03-04
No ESLint configuration — no static analysis runs on the codebase, meaning style inconsistencies and detectable bugs have no automated gate.
→ Files: project root (missing `eslint.config.js`)

**[tp-022]** `open` · added 2026-03-18
Shell injection risk: `publish-edition.js:24` interpolates `outDir` into `execSync` template literal without escaping — any shell metacharacters in `PUBLISH_DIR` env var cause injection or breakage.
→ Files: `publish-edition.js:24`

**[tp-023]** `open` · added 2026-03-18
`ai-ticker.js:261-263` defines a local `escapeHtml` missing `"` (`&quot;`) and `'` (`&#39;`) escaping, diverging from the canonical `render.js:17-23` implementation which is already exported.
→ Files: `src/ai-ticker.js:261-263`

**[tp-024]** `open` · added 2026-03-18
`landing.js:47-52` contains dead code: conditional detects `chatWorkerUrl` but the body is only a comment — CSP `connect-src` never includes the worker URL on the landing page. Compare with `account.js:28-32` which correctly appends it.
→ Files: `src/landing.js:47-52`

**[tp-025]** `open` · added 2026-03-18
Admin stats endpoint at `worker/index.js:969-986` iterates all KV keys with individual `get()` calls — O(n) reads that will degrade as user base grows.
→ Files: `worker/index.js:969-986`
