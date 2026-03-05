# Build Log

> Symbolic memory of the building process. Not what changed — how it felt to build it.
> Read Project Pulse first. Scan recent entries for context. Check Archive for deep history.

## Project Pulse
Status: Closing out grade audit sweep — all tracked issues now resolved, uncommitted cleanup in 7 files
Confidence: Solid on HTML sanitization (allowlist model is correct), solid on pipeline architecture. The editorial intelligence pipeline (added Mar 1) is still the newest and least battle-tested layer.
Frontier: Grade audit is effectively complete. Next decision: fresh re-grade to find new issues, or pivot to feature work (editorial pipeline tuning, content quality).
Debt mood: clean — 18 tracked issues in GRADE_IMPROVEMENTS.md, all marked resolved. First time the debt ledger is at zero open items.

## Entries

### 2026-03-03 — grade audit sweep to zero
**Did:** Systematically resolved every open item in GRADE_IMPROVEMENTS.md — flipped HTML sanitization from blocklist to allowlist, removed dead `renderSecondaryArticle`, fixed variable shadowing (`seen` -> `rawSeen`), added null guards on `repo.topics`, centralized hardcoded model string in x-sentiment.js, and threaded `githubToken` through editorial pipeline.
**Surprised by:** The `sanitizeArticleHtml` blocklist (strip `<script>`, `<iframe>`) was fundamentally wrong — any tag not explicitly blocked would pass through (`<style>`, `<object>`, `<embed>`, `<form>`, `<svg>`). Flipping to a `SAFE_TAGS` allowlist inverts the security posture: unknown tags are stripped by default. The blocklist was passing tests but one LLM hallucination of a `<style>` tag away from a visual attack.
**Shifted understanding:** GRADE_IMPROVEMENTS.md has evolved from a checklist into a living contract — each item carries its own lifecycle (open -> resolved with file refs). Getting to zero open items for the first time reveals the document's real value: it's a forcing function for systematic cleanup rather than ad-hoc fixes.
**Next grip:** Commit the uncommitted cleanup, then either run a fresh grade audit to surface new issues or shift attention to editorial content quality — the pipeline works but the LLM output voice hasn't been critically evaluated since the star-count-to-substance editorial shift on Mar 2.

## Archive
