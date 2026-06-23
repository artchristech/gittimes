# Principle 4 — Signal over noise

**Rating: 6 / 10**

## The principle
Every story should earn its place. No version-churn filler, no three near-identical
"agents" pieces, no incoherent trends stitched from string accidents.

## Current state
- ✅ Version churn (patch bump + thin notes) demotes to Quick Hits
  (`isVersionChurn`). Verified live: "Demoted 1 version-churn release".
- ✅ Trend clustering uses word-boundary matching (killed "storage"→rag,
  "video"→ide false themes).
- ✅ Trend diversity cap: a new trend must bring a majority of fresh repos, so an
  edition can't run "agents" three times.
- ⚠️ The theme taxonomy (`THEME_KEYWORDS`) is dated — it has `ai-agents`,
  `llm-tools`, etc., but misses the patterns that actually dominate today: MCP,
  RAG, local/on-device LLMs, inference engines, evals, fine-tuning. Real trends
  go uncategorized and fall through to generic sections.

## Improvements needed (prioritized)
1. **Modernize the theme taxonomy** *(implementing now)* — add themes for
   `mcp`, `rag`, `local-llm`, `inference`, `evals`, `fine-tuning` with precise
   keywords so genuine 2026 patterns cluster into coherent trends. File:
   `src/editorial.js` (`THEME_KEYWORDS`).
2. **Section-level diversity cap** *(staged)* — cap secondary stories per theme so
   one section isn't monothematic even when trends are fine.
3. **Quick-hit dedup** *(staged)* — collapse near-duplicate quick hits.

## Done in this pass
Improvement #1: richer, modern theme taxonomy for clustering.
