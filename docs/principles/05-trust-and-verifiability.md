# Principle 5 — Trust & verifiability

**Rating: 5 / 10**

## The principle
Readers should be able to trust every claim and trace it to a source. No
hallucinated comparisons, no invented version numbers, and a clear path from any
statement back to where it came from.

## Current state
- ✅ Ungrounded `SIMILAR_PROJECTS` (a hallucination surface) removed.
- ✅ AI Wire links every headline to its origin + the HN discussion.
- ✅ Repo meta (name, link, language, stars, release) shown on every article.
- ⚠️ Article bodies still paraphrase the README with no explicit attribution, so a
  reader can't tell what's the project's own claim vs the paper's assessment.
- ⚠️ No visible "this is based on X" line; the basis (README + release notes) is
  invisible to the reader.

## Improvements needed (prioritized)
1. **Source attribution line** *(implementing now)* — render a small "Source:"
   credit under each article linking the repo and naming the basis (README +
   release notes), so the provenance of every piece is explicit. Files:
   `src/render.js` (`renderSourceLine`, added to lead/featured/hybrid),
   `styles/newspaper.css`.
2. **Attribute claims in-body** *(staged)* — prompt the model to phrase
   project claims as "the project says…" and reserve plain assertions for the
   paper's own verifiable observations.
3. **Version sanity check** *(staged)* — validate any version number in a headline
   against `releaseName`; flag mismatches.

## Done in this pass
Improvement #1: per-article Source attribution line.
