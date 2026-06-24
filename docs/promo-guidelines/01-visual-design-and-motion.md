# 01 — Visual Design & Motion

**Current rating: 5/10**

## Evidence (code-grounded)
- `src/promo.js` `generatePromoHtml()` uses fixed `clamp()` font sizes on `.lead-headline-slot` (`clamp(40px, 7vw, 96px)`) and `.section-headline`. There was **no length-aware sizing**, so a long lead headline (the live 2026-06-22 lead is 72 chars: "Hermes Agent Expands Reach with iMessage Integration and Subagent Autonomy") renders at the same size as a short one and overflows / clips the lead scene.
- The morph timeline (lines ~545–573) does a font-size + position tween of the floating headline measured once via `getBoundingClientRect()`. The measured slot size does not account for headline length, so the morph target can land off-frame for long copy.
- Scene 3 (`#s3`) iterated `.section-headline` nodes unconditionally; with **zero** sections (a real possibility when markup drifts) the scene still played an empty hold — dead air, no legibility failure surfaced.
- Pacing is hard-coded inside the GSAP build (e.g. `.to({}, { duration: 6.0 })`); there is no single knob to retune scene holds.

## Measurable anchors
- **5/10 anchor:** headline font size is independent of headline length — a 90-char lead uses the same `clamp(40px,7vw,96px)` as a 20-char lead, so long headlines visibly clip the lead scene. Observable: `grep -c "len-xl" site/promos/<date>.html` returns `0`.
- **10/10 anchor:** headline size adapts to length so no headline clips at 1080×1920. Observable: the generated promo HTML contains a length class for long headlines — `grep -E "lead-headline-slot.*len-(md|lg|xl)" site/promos/<date>.html` matches when the lead headline exceeds 40 chars; the empty-sections scene is skipped (`grep -c "sectionHeadlineCount > 0" site/promos/<date>.html` returns `1`).

## Prioritized checklist (5 → 10)
1. [x] Add length-aware size classes (`len-md/lg/xl`) on `.lead-headline-slot`, selected by `data.lead.headline.length`, preserving font family/weight (aesthetic unchanged). — **shipped** in `src/promo.js`.
2. [x] Guard scene 3 so it is skipped entirely when there are zero section headlines (no dead air). — **shipped** (`sectionHeadlineCount > 0`).
3. [ ] Expose scene-hold durations as a small config object at the top of the GSAP block so pacing is tunable without editing tween math.
4. [ ] Recompute the morph target from the actual rendered slot rect *after* the length class is applied (already true since class is in the HTML before measurement; verify for `len-xl`).
5. [ ] Add a reduced-motion variant gated on `prefers-reduced-motion` for accessibility.

## Done when
`grep -E "lead-headline-slot.*len-(md|lg|xl)" site/promos/<date>.html` matches for a long-headline edition AND `grep -c "sectionHeadlineCount > 0" site/promos/<date>.html` == 1 AND the rendered MP4 shows the full lead headline with no clipping at 1080×1920.
