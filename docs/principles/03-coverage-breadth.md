# Principle 3 — Cover the whole AI story, not just GitHub trending

**Rating: 4 / 10**

## The principle
A newspaper for builders should reflect what actually happened in AI today — model
launches, papers, lab announcements, industry shifts — not only what trended on
GitHub. The day's biggest story is frequently *not* a new repo.

## Current state
- ✅ The **AI Wire** broke the GitHub-only ceiling: top non-repo AI stories from
  Hacker News now appear on the front page (`src/ai-headlines.js`,
  `renderAIWire`). Live: 5 real headlines (open models, lab news, essays).
- ⚠️ It's a **single non-repo source** (HN) and a **sidebar list**, not a second
  reporting lane. Research (arXiv) and lab blogs are still invisible.
- ⚠️ The Wire is decorative — its stories never become lead candidates or get the
  full article treatment.

## Improvements needed (prioritized)
1. **Add a second non-repo source: arXiv recent AI** *(implementing now)* — pull
   recent `cs.AI`/`cs.LG`/`cs.CL` papers from the arXiv export API, render them as
   a "Research" tier inside the AI Wire. Fail-soft (network/parse errors → skip).
   File: `src/ai-headlines.js` (`fetchArxiv`, merged into the wire),
   `src/render.js` (Wire renders a Research sub-list).
2. **Promote a Wire story to a real article** *(staged)* — let the editor pick the
   single biggest non-repo headline and commission a short sourced write-up.
3. **More lanes** *(staged)* — lab blog RSS (OpenAI/Anthropic/DeepMind), HF
   trending models.

## Done in this pass
Improvement #1: arXiv research intake merged into the AI Wire.
