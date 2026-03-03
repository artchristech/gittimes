# Grade Improvements Playbook
_Scope: Full Application | Last graded: 2026-03-03_

## Strategies & Hard Rules
Principles that should always/never apply in this codebase.

**[shr-001]** `open` · added 2026-02-21
Always HTML-escape all LLM-generated content before inserting into HTML templates — including body text, not just headlines.
→ Files: `src/render.js:21`

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

**[shr-009]** `open` · added 2026-03-02
Always sanitize repo metadata (description, readmeExcerpt, topics, releaseNotes) before interpolating into LLM prompt templates — structured output markers in GitHub data could hijack article parsing.
→ Files: `src/prompts.js:23-26,59-62,110-113,148,173-175` — `sanitizeRepoField()` applied to all interpolated fields.

**[shr-010]** `open` · added 2026-03-03
Always validate API response shapes before accessing nested properties — GitHub Search API may return valid JSON without expected `items` array (rate limit, error payload with 200 status).
→ Files: `src/github.js:302`

## Common Failure Patterns
Recurring mistake types observed across multiple files.

**[cfp-001]** `resolved` · added 2026-02-21 · updated 2026-02-26 · resolved 2026-03-03
Missing defensive checks on external API response shapes — GitHub API (`github.js:31-39,89-93`) now has try/catch with descriptive errors. xAI LLM (`xai.js:55`) now checks `response.choices?.length`. Remaining gap: `github.js:302` items array (tracked as shr-010).
→ Files: `src/github.js:31-39,89-93`, `src/xai.js:55`

**[cfp-002]** `open` · added 2026-02-21
Inconsistent HTML escaping — `escapeHtml()` is applied to most fields but the `bodyToHtml()` marked path relies on `sanitizeArticleHtml` regex stripping rather than proper allowlist-based sanitization.
→ Files: `src/render.js:27-34`, `src/render.js:37-38`

**[cfp-003]** `resolved` · added 2026-03-02 · resolved 2026-03-03
`sanitizeArticleHtml` in `render.js:32-33` — the regex `(?!https?:\/\/)[a-z][a-z0-9+.-]*:` already catches ALL non-http/https URI schemes including `data:`, `vbscript:`, `javascript:`, etc. The negative lookahead exempts only `http://` and `https://`.
→ Files: `src/render.js:32-33` — no code change needed; original assessment was incorrect.

**[cfp-004]** `resolved` · added 2026-02-26 · resolved 2026-02-27
Object shape mismatches between pipeline stages — article objects (`{headline, body, repo}`) are passed where repo objects (`{name, language}`) are expected, producing "undefined" in LLM prompts.
→ Files: `src/prompts.js:71-76` — `editionTaglinePrompt` is now dead code (replaced by `mastheadQuote`); shape mismatch can't occur at runtime.

**[cfp-005]** `open` · added 2026-03-03
`process.env.GITHUB_TOKEN` accessed directly inside LLM generation layer (`xai.js:317,329`) for breakout and sleeper enrichment, breaking the architecture's token-passing pattern used everywhere else.
→ Files: `src/xai.js:317,329`

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

**[tp-006]** `open` · added 2026-02-27 · updated 2026-03-02
CNAME file at `src/publish.js:190` has no comment explaining its purpose. It must be re-written on every deploy because `peaceiris/actions-gh-pages` with `keep_files: true` preserves it, but without the write it would be lost if the gh-pages branch is ever force-pushed.
→ Files: `src/publish.js:190`

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

**[tp-012]** `open` · added 2026-03-03
OSSInsight repos get fabricated timestamps (`created_at: new Date().toISOString()`, `pushed_at: new Date().toISOString()`) that propagate through `enrichRepo` into LLM prompts as real project creation/push dates, potentially generating incorrect age/timeline claims.
→ Files: `src/github.js:140-141`

**[tp-013]** `open` · added 2026-03-03
`rawCollector` dedup uses O(n) `.some()` linear scan per repo instead of a parallel Set, causing quadratic performance in raw candidate collection across sections.
→ Files: `src/github.js:327,487-489`

**[tp-014]** `open` · added 2026-03-03
Previous edition nav update regex `/<nav class="edition-nav">.*?<\/nav>/g` uses `.*?` which doesn't match newlines — would fail if nav HTML ever spans multiple lines.
→ Files: `src/publish.js:107`
