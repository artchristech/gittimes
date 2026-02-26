# Grade Improvements Playbook
_Scope: xAI/Grok Integration | Last graded: 2026-02-26_

## Strategies & Hard Rules
Principles that should always/never apply in this codebase.

**[shr-001]** `open` · added 2026-02-21
Always HTML-escape all LLM-generated content before inserting into HTML templates — including body text, not just headlines.
→ Files: `src/render.js:21`

**[shr-002]** `open` · added 2026-02-21
Always wrap JSON.parse of external API responses in try/catch with descriptive error messages.
→ Files: `src/github.js:27`

**[shr-003]** `open` · added 2026-02-21 · updated 2026-02-26
Always guard array access on API response fields (e.g., `choices[0]`) before dereferencing.
→ Files: `src/xai.js:53` (was `src/cerebras.js:47`, file replaced)

**[shr-004]** `open` · added 2026-02-26
Always verify that prompt-building functions receive the correct object shape (repo vs article) — mismatched shapes produce "undefined" in prompts.
→ Files: `src/xai.js:260-269`, `src/prompts.js:72`

**[shr-005]** `open` · added 2026-02-26
Regex patterns for structured output markers must not accidentally match substrings of longer markers (e.g., `HEADLINE:` matching inside `SUBHEADLINE:`).
→ Files: `src/xai.js:94`

## Common Failure Patterns
Recurring mistake types observed across multiple files.

**[cfp-001]** `open` · added 2026-02-21 · updated 2026-02-26
Missing defensive checks on external API response shapes — GitHub API (`github.js:27`) and xAI LLM (`xai.js:53`) assume well-formed responses without full validation.
→ Files: `src/github.js:27`, `src/xai.js:53` (was `src/cerebras.js:47`)

**[cfp-002]** `open` · added 2026-02-21
Inconsistent HTML escaping — `escapeHtml()` is applied to most fields but the `bodyToHtml()` marked path relies on `sanitizeArticleHtml` regex stripping rather than proper escaping.
→ Files: `src/render.js:17-23`, `src/render.js:37`, `src/render.js:55`

**[cfp-003]** `open` · added 2026-02-26
Object shape mismatches between pipeline stages — article objects (`{headline, body, repo}`) are passed where repo objects (`{name, language}`) are expected, producing "undefined" in LLM prompts.
→ Files: `src/xai.js:260-269`

## Troubleshooting Pitfalls
Specific edge cases or gotchas that are easy to miss.

**[tp-001]** `resolved` · added 2026-02-21 · resolved 2026-02-26
`sanitizePrompt()` strips all non-ASCII characters, silently destroying international content (Chinese repo names, emoji, accented characters) in LLM prompts.
→ Files: `src/xai.js:23-26` (was `src/cerebras.js:19-22`) — now preserves unicode, only strips control chars.

**[tp-002]** `open` · added 2026-02-21
The quick-hit dedup uses `repo.full_name + "_used"` suffix in the same Set — could theoretically collide with a real repo name ending in `_used`.
→ Files: `src/github.js:114`

**[tp-003]** `open` · added 2026-02-26
HEADLINE regex `/HEADLINE:\s*(.+)/` matches inside "SUBHEADLINE:" because the string contains "HEADLINE:". Combined with `lastMatch`, this causes every article with a SUBHEADLINE to get its headline replaced by the subheadline value.
→ Files: `src/xai.js:94`, `test/unit.test.js:383-385`

**[tp-004]** `open` · added 2026-02-26
Dead `generateContent` function at `xai.js:284-343` duplicates `generateSectionContent` logic but lacks X sentiment, X Pulse, and multi-section support. Exported but never called.
→ Files: `src/xai.js:284-345`
