# Git Times — three edition improvements: AI Wire as a section, fresher front page that breathes, prettier Use-Cases boxes

You are working on **Git Times**, an AI-generated daily newspaper for builders, live at **gittimes.com**. It is a static site (built into `./site`, deployed to the `gh-pages` branch, fronted by Cloudflare) plus a Cloudflare Worker for chat/auth/Stripe. You are touching **only the static-site rendering layer** (the daily-edition HTML/CSS), not the Worker. Deliver three independent improvements described below. Partial completion is acceptable per-task, but each task you touch must be correct and verified.

## Problem

Three distinct problems with the daily edition pages:

1. **The "AI Wire" is hard-pinned at the top of the front page.** It should instead be its own tab/section in the section navigation — a peer of `AI`, `Robotics`, `GameDev`, etc. — not a banner block above everything.

2. **The edition feels stale and repo-only, and the page does not "breathe."** Two sub-problems: (a) *Editorial relevance* — recent real AI news (e.g. a Sakana AI announcement) never reaches the front page because the front page is driven purely by trending GitHub repos, so genuine "news" with no single repo is invisible. Investigate why the lead stories feel like old/non-news and what the fix is. (b) *Visual rhythm* — the edition pages need the airy, typographic, "Harry Potter newspaper" / tech-futuristic feel that the `/markets/` pages already have: generous whitespace, confident serif typography, vertical rhythm, breathing room between sections.

3. **The "Use Cases" callout boxes are ugly.** They currently render as a flat grey box with a blue left-border and a plain bulleted list, followed by an italic "Source: …" line (see the project's `renderInsights` + `renderSourceLine`). Redesign them to match a premium tech-newspaper aesthetic.

## Context

- **Stack:** Zero-framework Node. Editions are assembled by string-templating an HTML file and inlining a single CSS file. No build step, no React. Article text comes from an LLM (OpenRouter) at publish time; structure/markup/CSS are all in this repo.
- **Render path:** `publish-edition.js` → `src/publish.js` (`publish()`) → `src/render.js` (`assembleMultiSectionHtml`) which reads `templates/newspaper.html` and inlines `styles/newspaper.css`. CSS is **inlined into every page at build time** — there is no external stylesheet, so a CSS change only goes live after a re-render (or a surgical HTML transform on the published branch).
- **Sections model:** `src/sections.js` exports `SECTIONS` (config per section: `id`, `label`, `budget`, `query`) and `SECTION_ORDER = ["frontPage","ai","robotics","cyber","systems","diy","gameDev"]`. Each section is a GitHub-repo query (topics + languages); `frontPage` has `query: null` (it's the cross-section best-of). `render.js` builds a tab bar with `renderSectionNav(SECTION_ORDER, content.sections, SECTIONS)` and one `.section-panel` per id via `renderSectionContent(sectionData, config)`. A section panel expects `{ lead, secondary, quickHits, deepCuts, isEmpty }` — all repo-shaped articles.
- **AI Wire today:** rendered by `renderAIWire(headlines, { research })` in `src/render.js` (~line 384), data fetched in `src/ai-headlines.js` (Hacker News top AI stories via the HN Algolia API + arXiv papers — NOT GitHub repos, so the shape is `{title, url, source, points, comments, discussionUrl}`, not the article shape a section panel renders). In `assembleMultiSectionHtml` it is injected via the template placeholder `{{AI_WIRE}}` (`templates/newspaper.html` line ~103, which sits **above** `{{SECTION_NAV}}` line ~105 and `{{SECTION_PANELS}}` line ~109). `publish-edition.js` builds `aiWireHtml` (step 2c, ~line 87–93) and passes it through `publish()` → `assembleMultiSectionHtml` options.
- **Why Sakana isn't on the front page:** the front page and every section are populated only from trending-GitHub-repo scoring (`src/github.js` velocity/recency scoring ~line 162+, `src/editorial.js` tiered selection). Pure "news" (a company announcement, a paper) has no repo and only ever lands in the AI Wire feed. Decide and implement the right fix — likely either (i) make the AI/front-page eligible to surface AI-Wire news items as articles, and/or (ii) tune the repo freshness window (`src/github.js` recency decay is linear over 7 days via `pushed_at`; `src/editorial.js` has surge/breakout tiers). State your diagnosis in your final report before coding.
- **Markets page as the design reference for "breathe":** `src/markets.js` renders `/markets/` and was recently overhauled (see `MARKETS_OVERHAUL_PLAN.md`); use its spacing/typography as the target feel for the editions. Shared design tokens live at the top of `styles/newspaper.css` (`--font-headline: 'Playfair Display'`, `--font-body: 'Libre Baskerville'`, `--font-meta: 'IBM Plex Sans'`, base `line-height: 1.65`).
- **Use-Cases box internals:** `renderInsights(useCases)` in `src/render.js` (~line 98) emits `.article-insights > .insights-col > .insights-label("Use Cases") + ul`. `renderSourceLine(article)` (~line 110) emits `<p class="article-source">Source: …</p>`. CSS for these: `styles/newspaper.css` at `.article-insights` (~276), `.insights-label` (~291), `.insights-col ul/li` (~301/306), `.article-source` (~659), plus per-context overrides (`.featured-article .article-insights` ~463, `.hybrid-lead/.hybrid-article .article-insights` ~739/743). "Similar Projects" was deliberately removed (ungrounded LLM recall) — do NOT reintroduce it; Use Cases stay because they're grounded in the repo README/release.

**Known dead ends:** none recorded for these three tasks specifically. General gotcha from prior work: the markets page once silently lost content because data only existed in a live-fetch cache (`getFullMarketData()` returned null) — unrelated here but a reminder that the catalog/data path is fragile; don't assume data shape, read it.

## Inputs

All paths are absolute and verified to exist:
- `/Users/christopherharris/projects/gittimes/src/render.js` — `renderAIWire`, `renderInsights`, `renderSourceLine`, `renderSectionNav`, `renderSectionContent`, `assembleMultiSectionHtml`
- `/Users/christopherharris/projects/gittimes/src/sections.js` — `SECTIONS`, `SECTION_ORDER`
- `/Users/christopherharris/projects/gittimes/src/ai-headlines.js` — AI Wire data source (HN + arXiv)
- `/Users/christopherharris/projects/gittimes/templates/newspaper.html` — `{{AI_WIRE}}` (~103), `{{SECTION_NAV}}` (~105), `{{SECTION_PANELS}}` (~109)
- `/Users/christopherharris/projects/gittimes/styles/newspaper.css` — all edition CSS (inlined at build); design tokens at top, `.ai-wire*` (~605+), `.article-insights*` (~276+), `.article-source` (~659+)
- `/Users/christopherharris/projects/gittimes/src/publish.js` — `publish()`, passes `aiWireHtml` through (~line 129)
- `/Users/christopherharris/projects/gittimes/publish-edition.js` — top-level pipeline; builds `aiWireHtml` (~87–93)
- `/Users/christopherharris/projects/gittimes/src/github.js` — repo velocity/recency scoring (freshness, ~162+)
- `/Users/christopherharris/projects/gittimes/src/editorial.js` — tiered article selection (surge/breakout/backfill)
- `/Users/christopherharris/projects/gittimes/src/markets.js` + `/Users/christopherharris/projects/gittimes/MARKETS_OVERHAUL_PLAN.md` — design reference for the "breathe" feel
- `/Users/christopherharris/projects/gittimes/CONTEXT.md` — full project orientation (deploy surfaces, gotchas)
- Test command: `npm test` (runs `node --test test/*.test.js`); relevant suites: `test/render-og.test.js`, `test/publish.test.js`, `test/editorial.test.js`, `test/ai-headlines.test.js`, `test/unit.test.js`, `test/validate.test.js`
- Lint: `npm run lint`

## Constraints

- **No new dependencies, no build step, no framework.** Keep it zero-framework Node + inlined CSS.
- **Do NOT touch the Worker** (`worker/`), Stripe, auth, or `verifyStripeSignature`.
- **Do NOT regenerate editions via the LLM to test** (`npm run publish` / `node publish-edition.js` calls OpenRouter and, in CI, re-sends the newsletter). Verify via unit tests and by rendering with stubbed/fixture data, not by hitting the live pipeline.
- **Do NOT reintroduce "Similar Projects"** in the insights box.
- Task 1: the AI Wire section must degrade gracefully when there are no headlines (today's AI Wire can legitimately be empty — it's a non-fatal bonus block). Follow the existing `isEmpty` convention so the tab disables/hides like other empty sections.
- Task 1: AI-Wire items are news links (`{title,url,source,points,comments}`), not repo articles — do not force them through `renderHybridArticle`/`renderSectionContent` unchanged; give the AI Wire section its own panel renderer or adapt the section-panel path to accept a wire-shaped section.
- Reuse the existing design tokens (`--font-headline`, `--font-body`, `--font-meta`, color vars) — do not hardcode new font families or a clashing palette. Match the markets page, don't invent a third look.
- All existing tests must stay green; update tests that legitimately change (e.g. AI Wire no longer in the top block) and add coverage for new behavior.
- Keep changes reviewable and scoped per task; note in your report which files each task touched.

## Definition of done

- **Task 1:** `{{AI_WIRE}}` no longer renders as a banner above the section nav. "AI Wire" appears as a tab in `renderSectionNav` output (a peer of the other sections), and selecting it shows the wire content in a `.section-panel`. When there are zero headlines the AI Wire tab follows the same empty/disabled treatment as other empty sections. A test asserts the AI Wire is reachable as a section and is NOT present in the pre-nav block.
- **Task 2a:** A written diagnosis (in your final report) of why fresh AI news (the Sakana example) never reaches the front page, plus an implemented, test-backed change that makes genuinely-recent/newsworthy items eligible for the front page or AI section (e.g. surfacing AI-Wire items as front-page-eligible, and/or a freshness-window tune in `src/github.js`/`src/editorial.js`). The change is covered by a unit test that proves a fresh news item / fresh repo now ranks where it previously didn't.
- **Task 2b:** Edition CSS in `styles/newspaper.css` updated so the edition pages have markedly more vertical rhythm and whitespace (section spacing, headline scale, body leading, max-width measure) consistent with the `/markets/` aesthetic. Render the edition HTML with fixture data (no LLM) and visually confirm the increased breathing room — produce a before/after screenshot or rendered HTML artifact.
- **Task 3:** `renderInsights` markup and/or its CSS redesigned so the Use-Cases box reads as a premium newspaper callout (not a flat grey box with a blue bar). The "Source:" line is visually integrated/cleaned up. Render with fixture data and confirm the new look. Existing insights tests still pass (or are updated).
- `npm test` is green and `npm run lint` is clean for every file you changed.

## Verification

1. `cd /Users/christopherharris/projects/gittimes`
2. `npm test` → all suites pass (note count before/after).
3. `npm run lint` → no errors on changed files.
4. **Render without the LLM** to inspect HTML/CSS visually: write a tiny throwaway Node script (or extend an existing test) that calls `assembleMultiSectionHtml(content, options)` from `src/render.js` with **fixture** `content.sections` and a fixture `aiWireHtml`/headlines (do NOT call `publish-edition.js`), writes the result to `scratch/preview.html`, and open it (or screenshot it) to confirm: (a) AI Wire is a tab, not a top banner; (b) the page breathes; (c) the Use-Cases boxes look good. Mirror the data shapes used in `test/publish.test.js` / `test/render-og.test.js` for the fixture.
5. Grep to confirm `{{AI_WIRE}}` is no longer placed above `{{SECTION_NAV}}` in `templates/newspaper.html` (either removed or repurposed): `grep -n "AI_WIRE\|SECTION_NAV" templates/newspaper.html`.
6. In your final report: state the Task-2a diagnosis explicitly, list files touched per task, and attach the rendered-preview artifact path.

<!-- prompt-out v1 -->
