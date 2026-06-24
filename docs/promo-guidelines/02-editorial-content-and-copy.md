# 02 — Editorial Content & Copy

**Current rating: 5/10**

## Evidence (code-grounded)
- `extractEditionData()` in `src/promo.js` matched only the **legacy** markup (`lead-headline">`, `lead-subheadline">`, `lead-meta`). The **live** renderer (`src/render.js` `renderHybridArticle`, line 168) emits `hybrid-headline hybrid-headline-lead`, `hybrid-subheadline`, and `hybrid-meta`. Result: against a real 2026-06-22 edition the extractor returned `lead.headline === ""` and `sections.length === 0` — the promo had no editorial content at all.
- The live `<h3 class="hybrid-headline-lead">Headline <a class="hybrid-share">🔗</a></h3>` markup appends a permalink anchor; the old `[^<]+` capture would have stopped at the `<a` but also captured a **trailing space**, dirtying copy.
- No defensive defaults: a missing tagline or subheadline produced empty quote/sub elements rather than graceful fallbacks.
- No caption/transcript output, so the copy was invisible on muted social feeds.

## Measurable anchors
- **5/10 anchor:** `node -e "const{extractEditionData}=require('./src/promo');console.log(extractEditionData(require('fs').readFileSync('site/editions/2026-06-22/index.html','utf8')).lead.headline)"` prints an **empty string** (silent content loss on the live markup).
- **10/10 anchor:** the same command prints the real headline `Hermes Agent Expands Reach with iMessage Integration and Subagent Autonomy`, `sections.length === 6`, and a `.srt` + `.vtt` caption track is emitted alongside the promo (`ls site/promos/<date>.srt site/promos/<date>.vtt` both exist).

## Prioritized checklist (5 → 10)
1. [x] Harden `extractEditionData()` to support BOTH hybrid and legacy markup via a `findHeadline()` helper (regex-only, no DOM dep). — **shipped**.
2. [x] Strip the trailing share-link / whitespace from captured headlines (`cleanHeadline()`). — **shipped**.
3. [x] Add defensive copy defaults (tagline, lead sub) so optional gaps never blank the promo. — **shipped** in `generateEditionPromo`.
4. [x] Generate `.srt` and `.vtt` caption tracks from edition copy (`buildCaptionCues`, `cuesToSrt`, `cuesToVtt`). — **shipped**.
5. [ ] Optionally pull a second-deck/quick-hit headline for a richer sections scene.

## Done when
`extractEditionData(<live edition html>).lead.headline` is non-empty and equals the rendered lead, `sections.length === 6` for a full edition, and `site/promos/<date>.srt` + `.vtt` exist and contain the lead headline.
