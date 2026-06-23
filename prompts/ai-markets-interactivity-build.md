**Problem**

The Git Times "AI Markets" page (gittimes.com/markets) presents curated and synced model data as static HTML, but a frontier builder cannot answer the core question — "which model, at what real monthly cost, that supports tool-calls, under my budget" — without leaving the page. The data needed (per-model `input`/`output` prices, `cache_read_price`, `context_length`, `supported_parameters`) is ALREADY present and partly rendered; it just is not sortable, filterable, costable, or legibly honest. Build an interactivity + honesty upgrade as progressive enhancement, shipped in a strict gated sequence where each step lands the substrate the next reuses, and `npm test` stays green after every step.

**Context**

Project: **The Git Times**, an AI newspaper for builders, gittimes.com. Stack: zero-framework Node.js, NO site build step — pages are server-side string-templated static HTML/CSS with vanilla JS only. Strict CSP in the page head: `script-src 'self' 'unsafe-inline'` → inline `<script>` blocks ARE allowed, but inline event-handler attributes (`onclick=`, `oninput=`, etc.) are NOT. All event wiring MUST use `addEventListener`. No CDN libraries or frameworks. The page MUST remain complete and correct with JavaScript OFF — interactivity is progressive enhancement, exactly like the existing `data-reveal` motion IIFE (which is gated behind a JS-added `.motion` class + `prefers-reduced-motion`; copy that contract).

This is a phased, safe-sequence build. Treat the order below as the spine — do not skip ahead, and run `npm test` as a gate after EVERY step. Each step deliberately lands the substrate the next one consumes:

- **Step 0 — Foundation: `data-*` stamping pass** (renderer only). On each Frontier Board `<tr>`, stamp capability booleans `data-tools`, `data-structured`, `data-reasoning` (each `"1"`/`"0"`) derived from `supported_parameters`, plus numeric `data-output`, `data-input`, `data-cache` for the calculator. On each sortable cell stamp numeric `data-sort` (input $, output $, quality, context, 24h delta, cache price). These attributes are inert with JS off. This step unlocks every later step.
- **Step 1 — I1 click-to-sort tables.** Inline `<script>`, one delegated `click` listener on each `table.markets-table thead`, `addEventListener` only (NO inline `onclick=`); toggle asc/desc; set `aria-sort` on the active `<th>`. Reads the `data-sort` from Step 0.
- **Step 2 — Honesty pass (D1 + D7 + D2).** Per-eval-cell "est." marker + `title="curated · as of <asOf>"`; a CSS `.eval-curated` downweight class so curated numbers never read as live; print the composite-quality formula inline near the evals section; disclose the Cost-of-Intelligence-Index methodology (unweighted mean of N models' output price) next to the hero figure.
- **Step 3 — I5 cache-aware cost calculator.** A small form (input M-tokens/day, output M-tokens/day, cached-input % slider) computes each tracked model's $/month from the Step-0 stamped prices and shows a ranked result. Factor the math into a PURE exported function in `src/markets.js` (`monthlyCost({inM, outM, input, output, cache, cachedPct})`) and unit-test it.
- **Step 4 — I2 + M3 filter bar + I7 + I3.** Provider `<select>`, max-output-$ range, min-context range, capability checkboxes reading the Step-0 `data-*` booleans; toggles row visibility via `tr.hidden`. Apply to BOTH the Frontier Board and the 310-model catalog. Add I7 $/M↔$/1k unit toggle and I3 catalog free-text search.
- **Step 5 — I4 compare panel.** Row checkboxes → a sticky strip diffing 2–3 selected models' price/quality/context/caps side by side; state in `sessionStorage`.

Known dead ends: a prior critique (`docs/markets-critique.md`) wrongly listed cache-pricing and tool-use as "missing data" — they are ALREADY in the data and already partly rendered (`renderInputPriceCell` emits `cache: $X`; `renderFeatureBadges` emits tools/reasoning/structured badges from `supported_parameters`). Do NOT go hunting for a new feed or data source. The work is to make existing fields sortable/filterable/legible, not to acquire data. Do NOT introduce a framework, a build step, a CDN dependency, or any inline `onclick=` handler.

**Inputs**

- Repo root: `/Users/christopherharris/projects/gittimes`
- Renderer: `/Users/christopherharris/projects/gittimes/src/markets.js` — key exports `renderMarketsPage(tickerData, fullMarket, options)`, `renderEvalsSection`, `renderValueScatter`, `buildFreshness`, `compositeQuality(scores, metrics)`; cell helpers `renderInputPriceCell` (already emits `cache: $X`), `renderFeatureBadges` (already emits tools/reasoning/structured badges from `supported_parameters`), `renderCtxCell`, `renderModelNameCell`, `renderSparkline`. The row builder consumes a tracked-model object `m` with fields `m.label, m.provider, m.input, m.output, m.cache_read_price, m.context_length, m.supported_parameters, m.outputDelta, m.input_modalities, m.hugging_face_id, m.key`. Frontier Board table has class `markets-table frontier-board`; columns Model/Provider/Quality/Input/Output/24h/Context/30d sparkline. `formatPrice`, `formatTokPerSec`, `escapeHtml` are imported from `./ai-ticker`.
- Template + inline CSS (in a `<style>` block after `{{STYLES}}`) + the only two `<script>` blocks (a theme-bootstrap IIFE and a decorative-motion IIFE respecting `prefers-reduced-motion`): `/Users/christopherharris/projects/gittimes/templates/markets.html`. New interactive JS goes in a NEW inline `<script>` here, reading the stamped `data-*` attributes.
- Curated data incl. `evals` block (`asOf`, `note`, `sources`, `metrics`, `models`): `/Users/christopherharris/projects/gittimes/data/ai-models-curated.json`
- Synced data (per tracked model: `input`, `output`, `cache_read_price`, `context_length`, `supported_parameters`, `input_modalities`, `hugging_face_id`) + 310-model `catalog`: `/Users/christopherharris/projects/gittimes/data/ai-models.json`
- Daily publish path (calls `renderMarketsPage(tickerData, fullMarket, options)` — do NOT change that signature): `/Users/christopherharris/projects/gittimes/src/publish.js`
- Existing tests (451 pass today; DO NOT break): `/Users/christopherharris/projects/gittimes/test/markets.test.js`
- Offline preview harness: `node scratch/render-markets.js scratch/markets-preview.html` (run from repo root) — renders the markets page exactly as `src/publish.js` does
- Tests: `npm test` ; Lint: `npm run lint`
- Build decision/context doc: `/Users/christopherharris/projects/gittimes/MARKETS_OVERHAUL_PLAN.md`
- Motivating critique (treat as a wishlist with the known data error above, not a spec): `/Users/christopherharris/projects/gittimes/docs/markets-critique.md`

**Constraints**

- Phased safe sequence is mandatory: implement Step 0 → 1 → 2 → 3 → 4 → 5 in order. Run `npm test` after EACH step and do not proceed while red. Each step must leave the page shippable on its own.
- Progressive enhancement only: the page MUST render complete and correct with JavaScript OFF. All `data-*` attributes are inert without JS. Rows must NEVER start `hidden` server-side. Gate interactive affordances (sort arrows, filter bar, compare checkboxes, calculator) behind a JS-added class so they don't dangle as functional when JS is off.
- CSP discipline: inline `<script>` blocks are allowed; inline event-handler attributes are FORBIDDEN. Every handler uses `addEventListener`. `grep -nE 'on(click|input|change|submit|keyup|keydown)=' templates/markets.html` must return nothing.
- No new framework, no build step, no CDN dependency, no new runtime npm dependency. Vanilla JS, server-side string templating only.
- Do NOT acquire or wire any new data feed. Use the existing `input`, `output`, `cache_read_price`, `context_length`, `supported_parameters` fields. Do NOT fabricate eval numbers — `data/ai-models-curated.json` numeric values stay unchanged (re-labeling/markup only).
- `data-sort` values are numeric and UNFORMATTED (raw numbers, not `$25.00`) — e.g. a $25/M Output cell carries `data-sort="25"` — so JS sorts numerically without re-parsing display strings.
- The cost math MUST live in a single PURE exported function in `src/markets.js`: `monthlyCost({inM, outM, input, output, cache, cachedPct})` where `inM`/`outM` = millions of tokens/day in/out, `input`/`output`/`cache` = per-million-token prices, `cachedPct` = 0–100. Cached input tokens billed at `cache` (fall back to `input` when `cache` is null/undefined), the remainder of input at `input`, output at `output`, multiplied daily→monthly by a fixed factor of 30 (document the 30 in a comment). No DOM, no globals. The inline calculator calls the same math so the tested math is the shipped math.
- Curated eval numbers must be visually downweighted, dated (`evals.asOf`), and carry provenance; never styled as authoritative live data and never fed into the monthly-cost ranking (cost uses only live `data/ai-models.json` prices).
- Do NOT break the 451 existing tests; new tests are additive. Do NOT change the `renderMarketsPage(tickerData, fullMarket, options)` signature. Keep edits scoped to `src/markets.js`, `templates/markets.html`, and `test/markets.test.js`.
- Accessibility: sortable headers set `aria-sort`; form controls have associated labels.

**Definition of done** (observable/checkable)

- `node scratch/render-markets.js scratch/markets-preview.html` exits 0.
- The rendered `scratch/markets-preview.html` contains, all checkable by grep:
  - **Step 0:** Frontier Board `<tr>` rows carry `data-tools`, `data-structured`, `data-reasoning`, `data-output`, `data-input`, `data-cache`; sortable cells carry numeric `data-sort`.
  - **Step 1:** an inline `<script>` that calls `addEventListener` for click-to-sort, and at least one `aria-sort` attribute on a sortable `<th>`.
  - **Step 2:** an `est.` per-cell marker, `title="curated · as of` substrings on eval cells, a `.eval-curated` class in both CSS and markup, the composite-quality formula text inline, and the Cost-of-Intelligence-Index methodology text ("unweighted mean" of output price) next to the hero figure.
  - **Step 3:** a cost-calculator `<form>` with input/output M-tokens/day fields and a cached-input % slider; a ranked result container.
  - **Step 4:** filter controls (provider `<select>`, max-output range, min-context range, capability checkboxes) on both Frontier Board and catalog; a $/M↔$/1k unit toggle; a catalog free-text search input.
  - **Step 5:** per-row compare checkboxes and a sticky compare-strip container.
- A NEW pure exported `monthlyCost(...)` exists in `src/markets.js`, has NO DOM/global access, applies the cache discount to the cached fraction of input (with the null-cache fallback), and is covered by new unit tests including: a mixed `cachedPct` case with an asserted exact dollar value, a `cachedPct: 0` (full-input) case, a `cachedPct: 100` case, and a null-`cache` fallback case.
- `npm test` is green with total ≥ 451 + the new tests (and was green after each intermediate step).
- `npm run lint` is clean.
- `grep -nE 'on(click|input|change|submit|keyup|keydown)=' templates/markets.html` returns nothing (all wiring via `addEventListener`).
- `git diff data/ai-models-curated.json` shows no numeric value changes (re-labeling/markup only, or no change).
- The `renderMarketsPage(tickerData, fullMarket, options)` signature is unchanged and `src/publish.js`'s call is unmodified.
- With JS disabled, the page still presents every model's prices, quality, context, and capabilities, with no orphaned/misleading interactive affordances.

**Verification** (exact commands/steps)

Run from repo root `/Users/christopherharris/projects/gittimes`:

1. Baseline: `npm test` (confirm 451 green), `npm run lint` (clean), `ls scratch/render-markets.js` (confirm preview harness exists). Re-run `npm test` after each step; final run ≥ 451 + new tests, all green.
2. `npm run lint` — clean.
3. `node scratch/render-markets.js scratch/markets-preview.html; echo "exit=$?"` — expect `exit=0`.
4. Step 0 stamps: `grep -oE 'data-(tools|structured|reasoning|output|input|cache)="[^"]*"' scratch/markets-preview.html | head` non-empty; `grep -c 'data-sort=' scratch/markets-preview.html` ≥ 5.
5. Step 1 sort: `grep -c 'aria-sort' scratch/markets-preview.html` non-zero; `grep -c 'addEventListener' scratch/markets-preview.html` non-zero.
6. Step 2 honesty: `grep -c 'eval-curated' scratch/markets-preview.html` non-zero (CSS + markup); `grep -F 'curated · as of' scratch/markets-preview.html` hits; `grep -i 'unweighted mean' scratch/markets-preview.html` hits; the composite-quality formula string is present.
7. Step 3 calculator: `grep -E 'name="inM"|name="outM"|type="range"' scratch/markets-preview.html` hits; `grep -n 'monthlyCost' src/markets.js test/markets.test.js` shows the function defined, exported, and tested.
8. Step 4 filters: `grep -E '<select|max-output|min-context|catalog-search|unit-toggle' scratch/markets-preview.html` hits filter controls + unit toggle + catalog search.
9. Step 5 compare: `grep -E 'compare-checkbox|compare-strip|sessionStorage' scratch/markets-preview.html` hits.
10. CSP guard: `grep -nE 'on(click|input|change|submit|keyup|keydown)=' templates/markets.html` returns nothing.
11. No fabricated evals: `git diff data/ai-models-curated.json` shows no numeric edits.
12. Signature frozen: `grep -n 'renderMarketsPage' src/publish.js` shows the `(tickerData, fullMarket, options)` call unchanged.
13. JS-off check: open `scratch/markets-preview.html` with JavaScript disabled; confirm every model's price/quality/context/capabilities render and no interactive control dangles as if functional.

<!-- prompt-out v1 -->
