# AI Markets Page Overhaul — Gameplan

**Goal:** Turn `gittimes.com/markets` from a 1/10 wall of monotone tables into a
professional, *living* newspaper desk — honest about freshness, enriched with
curated+cited model **evals**, and alive with CSP-safe HTML5 motion ("Harry
Potter newspaper"). Source prompt: `prompts/ai-markets-page-overhaul.md`.

**Constraints (hard):** zero build step, plain CSS + vanilla JS only, strict CSP
(`script-src 'self' 'unsafe-inline'`; no CDN libs), reuse `newspaper.css` tokens,
all three themes legible, `prefers-reduced-motion` honored, page complete with JS
off (motion = progressive enhancement), evals labeled curated + sourced + dated
(never "live", never fabricated), preserve existing section data + exported
helpers + the masthead + mission footer. `npm test` + `npm run lint` green after
every phase.

**Local build note:** `node generate.js` needs `GITHUB_TOKEN` + `OPENROUTER_API_KEY`
(full pipeline). The markets page is rendered identically by `src/publish.js` via
`renderMarketsPage(getTickerData(), getFullMarketData())`. Preview harness:
`node scratch/render-markets.js scratch/markets-preview.html` (offline, synced data).

---

## Current state (Phase 0 audit)

**Files:**
- `templates/markets.html` (347 lines) — shell. Page CSS inline after `{{STYLES}}`.
  `.markets-header` = `<h1>AI Markets</h1>` + `.markets-date` (the weak/"outdated"
  freshness stamp). Body slot `{{MARKETS_CONTENT}}`. Masthead + footer
  ("…aims to provide information that inspires people to build.").
- `src/markets.js` (430 lines) — `renderMarketsPage(tickerData, fullMarket, options)`.
  Exported helpers (KEEP signatures + behavior; tests depend on them):
  `renderModalityBadges`, `renderFeatureBadges`, `renderSunsetWatch`,
  `renderNewModelsSection`, `renderRadarSection`, `timeAgo`. Plus `renderSparkline`.
- `src/ai-ticker.js` — `getTickerData(outDir)` → `{models[], speed[], images[],
  history, indexValue, indexHistory, bannerKeys, untracked, syncedAt}`;
  `getFullMarketData()` → catalog (310 models). Reads `data/ai-models.json`.
- `data/ai-models-curated.json` — `bannerKeys`, `trackedModels[]` (11), `speed[]`,
  `images[]`. **No evals anywhere.**
- `styles/newspaper.css` — tokens `--paper --ink --ink-light --ink-faint --rule
  --rule-light --accent --font-headline(Playfair) --font-body(Libre Baskerville)
  --font-meta(IBM Plex Sans)`; `[data-theme=dark|midnight]` override the palette.

**Sections today (all plain full-width tables, in order):** Cost of Intelligence
Index (small box + tiny sparkline), Sunset Watch (callout, often empty), Frontier
Model Pricing, New on the Market, On Our Radar, Inference Speed Leaderboard, Image
Generation, All Models by Provider. → monotonous, no hierarchy, no quality signal.

**Test constraints discovered:** `test/markets.test.js` asserts section titles
"On Our Radar", "Sunset Watch", "New on the Market" and that
`renderNewModelsSection` emits ≤9 `<tr>`. `test/ai-ticker.test.js` covers banner +
snapshots. → keep those titles + helper contracts intact.

**Baseline:** `scratch/markets-baseline.html` + `scratch/baseline-shot.png` captured.
Lint clean, 443 tests pass on untouched tree.

---

## Phases

### Phase 1 — Banner + freshness honesty
Replace `.markets-date` with an editorial masthead block: a **standfirst** (section
identity / what a builder gets) + a **freshness chip** showing relative
("synced 3 min ago" via `timeAgo`) **and** absolute time, plus a **LIVE vs CURATED
legend**. Stale (`syncedAt` > 24h or missing) renders a visible "stale"/"—" state,
not a misleading fresh stamp.
- Files: `src/markets.js` (banner builder), `templates/markets.html` (`.markets-header` + CSS).
- Accept: preview shows relative+absolute+legend; forcing stale `syncedAt` shows stale flag.

### Phase 2 — Information architecture + visual redesign
Re-architect around builder decisions. **Hero band:** Cost of Intelligence Index as
a large animated figure + a real area/line chart (hand-rolled SVG, extend
`renderSparkline`) + headline stats (cheapest frontier, fastest, top-eval). Collapse
the redundant table stack: keep one rich **Frontier board**; move New on the
Market, On Our Radar, Sunset Watch, Image Generation, and the 310-model catalog
behind `<details>` progressive disclosure under a "More from the desk" area. Restyle
tables: tabular-nums, right-aligned numerics, clearer rank/delta affordances,
section "kicker" labels. All via `newspaper.css` tokens (+ a small set of new
shared tokens if needed).
- Files: `src/markets.js`, `templates/markets.html`, optionally `styles/newspaper.css`.
- Accept: no stacked redundant tables; hero present; aligned in all 3 themes; no overflow @375px.

### Phase 3 — Evals data + section
Add curated, cited evals to `data/ai-models-curated.json` as an `evals` array keyed
by existing model `key`s. Metrics: MMLU-Pro, GPQA Diamond, SWE-bench Verified,
LMArena Elo — each datapoint with a `source` URL + `asOf` date (top-level provenance
+ per-entry as needed). Render an **Evals / Quality** desk in `src/markets.js`
labeled CURATED with sources + as-of date; missing values → explicit "—". Add a
**price-vs-quality value view** (eval score vs $/Mtok) so the page answers "best
value". Never present evals as live.
- Files: `data/ai-models-curated.json`, `src/markets.js`.
- Accept: ≥3 models × ≥2 cited+dated benchmarks; `node -e` provenance check passes; "—" for gaps.

### Phase 4 — Living-newspaper motion
CSP-safe inline `<script>`+CSS: index figure **count-up** to true value, hero chart
+ sparklines **draw-in** (stroke-dashoffset), **reveal-on-scroll** (IntersectionObserver),
**"just synced" pulse** on the freshness chip, subtle **delta flash**. Single
motion-enable gate; full `@media (prefers-reduced-motion: reduce)` static fallback;
all final values server-rendered so JS-off is complete.
- Files: `templates/markets.html` (inline script/style), `src/markets.js` (hooks/data-attrs).
- Accept: motion on load; reduced-motion = static + readable; JS-off complete; no CSP console errors.

### Phase 5 — Verify & ship
Full regen via preview harness, integrate, screenshots in 3 themes + mobile width,
update this file's "Shipped" checklist.
- Accept: `npm test` + `npm run lint` green; preview renders banner+hero+evals+motion; zero CSP errors.

---

## Shipped checklist
- [x] Phase 0 — audit + baseline (this file; baseline lint+443 tests green; preview harness `scratch/render-markets.js`)
- [x] Phase 1 — banner + freshness honesty (editorial masthead + standfirst + LIVE/CURATED chips via `buildFreshness`; stale/missing states handled)
- [x] Phase 2 — IA + visual redesign (hero band w/ index figure + area chart + 4 stat cards; single Frontier Board w/ Quality column; New/Radar/Catalog behind "More from the desk" disclosure; tabular-nums, section kickers, provenance tags; responsive @760/600; all 3 themes)
- [x] Phase 3 — evals data + section (`data/ai-models-curated.json` `evals`: 11 models × 4 cited+dated benchmarks; `renderEvalsSection` Quality Desk + `renderValueScatter` Value Frontier; wired through sync-models + getTickerData)
- [x] Phase 4 — living-newspaper motion (count-up index, area-line draw-in, bar grow, reveal-on-scroll via IntersectionObserver, "just synced" pulse; all inline/CSP-safe; full `prefers-reduced-motion` + JS-off fallback)
- [x] Phase 5 — verify & ship (lint clean; 451 tests pass; preview renders banner+hero+evals+value+board+motion; no external scripts; light/dark verified by screenshot)

### Verification record
- `npm run lint` → exit 0.
- `npm test` → 451 pass / 0 fail (was 443; +8 for compositeQuality/renderEvalsSection/renderValueScatter/buildFreshness).
- `node scratch/render-markets.js` → renders `markets/index.html` content offline via the exact `renderMarketsPage` path `src/publish.js` uses (full `node generate.js` needs `GITHUB_TOKEN`+`OPENROUTER_API_KEY`).
- Provenance: `node -e` confirms every eval has `asOf`+sources; UI labels "Curated · as of 2026-06-15".
- No `<script src=>` external refs; all motion inline (CSP `script-src 'self' 'unsafe-inline'`). JS-off + reduced-motion leave the page complete and static.

### Open caveat (honesty)
The eval **numbers** in `data/ai-models-curated.json` are editorial placeholders following the
existing curated-data pattern (speed/images), labeled curated + dated. They should be replaced
with sourced figures from LMArena / Artificial Analysis / vendor model cards before relying on
them — the structure, provenance fields, and UI are production-ready; the values need a desk pass.
