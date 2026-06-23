# Principle 1 — Honest reporting over press-release laundering

**Rating: 6 / 10**

## The principle
An article must be reporting, not a rewritten README. It should tell a builder
what's true — including what's weak, missing, or unproven — not just relay the
project's own marketing.

## Current state
- ✅ Every article prompt now requires a `**The catch:**` paragraph (one honest
  limitation / open question). Live editions show ~34 occurrences.
- ✅ Ungrounded `SIMILAR_PROJECTS` (pure LLM recall) dropped.
- ⚠️ Still fundamentally **single-source**: the only material fed to the writer
  is the repo's own `description` + `readmeExcerpt` + `releaseNotes`. There is no
  external signal, no skeptic, no real-world counter-evidence.
- ⚠️ "The catch" quality is at the mercy of the free model — it emits the phrase
  but the limitation is often shallow or invented-sounding because the model has
  no concrete negative data to ground it in.

## Improvements needed (prioritized)
1. **Ground the catch in real data** *(implementing now)* — feed `open_issues`
   count and the release recency into the prompt's PROJECT DATA so the model can
   anchor its limitation in something observable ("N open issues", "no release in
   8 months") instead of guessing. Files: `src/prompts.js` (PROJECT DATA block),
   data already available from `enrichRepo` (`openIssues`, `pushedAt`).
2. **Second source** *(staged)* — pull the repo's top open issue titles, or a HN
   discussion of the repo, and pass 1–2 as "what users are complaining about."
3. **Catch quality gate** *(staged)* — flag articles whose catch is a non-catch
   ("the only downside is it's too powerful") for review.

## Done in this pass
Improvement #1: open-issues + release-age signals added to PROJECT DATA.
