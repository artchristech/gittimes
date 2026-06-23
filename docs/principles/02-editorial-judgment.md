# Principle 2 — Editorial judgment over popularity metrics

**Rating: 4 / 10**

## The principle
The front-page lead and the day's emphasis should be decided by *significance to
builders*, not by which repo gained the most GitHub stars. Stars are why a story
surfaces; they are not why it leads.

## Current state
- ✅ A real editor-in-chief LLM is now wired (`chooseEditorialLead` in
  `src/xai.js`, `chooseLeadPrompt` in `src/prompts.js`). Star-momentum ranking is
  the *filter* (`rankBreakoutCandidates`), not the decision.
- ✅ Parser hardened to accept a repo name or a number from the model.
- ❌ **The editor barely engages.** The candidate bar is `starDelta >= 100` over a
  prior snapshot, which on most days yields a *single* qualifying repo. With one
  candidate, the editor has nothing to choose and rubber-stamps it — so selection
  is still effectively star velocity. Verified live: CI showed one breakout
  (`Kilo-Org/kilocode`) and no "Editor-in-chief lead:" engagement.

## Improvements needed (prioritized)
1. **Broaden the candidate pool** *(implementing now)* — guarantee the editor
   always sees ≥3 real candidates. When fewer than `minCandidates` clear the
   +100 bar, backfill from the highest-scored movers regardless of the hard
   floor, then (if still short) from the highest-star recent repos. The +100
   threshold stays the *headline* breakout signal but no longer starves the
   editor. File: `src/editorial.js` (`rankBreakoutCandidates`).
2. **Editor sets the day's angle, not just the lead** *(staged)* — let the editor
   also pick which section leads the homepage and write a one-line "why today".
3. **Significance memory** *(staged)* — feed the editor the last 3 leads so it
   avoids leading with the same kind of story every day.

## Done in this pass
Improvement #1: candidate-pool backfill so the editor reliably has a real choice.
