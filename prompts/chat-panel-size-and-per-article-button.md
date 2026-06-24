Problem
=======
Two user-facing defects in the Git Times "AI Desk" chat feature must be fixed in the static-site source. (A) The chat panel is too small to be usable on desktop and overflows the viewport on mobile. (B) The "Ask about this" button that opens the chat scoped to a story is present only on some article types, so readers cannot ask the AI about every story.

This task is code-complete-and-locally-verified only. Do NOT deploy.

Context
=======
Git Times is a static newspaper site (repo below) built from templates into a `gh-pages` output. The chat ("AI Desk") backend is a Cloudflare Worker, but the chat UI you are changing is entirely in the static site source:

- `src/render.js` — server-side HTML render functions (Node module; render functions are unit-tested).
- `public/chat.js` — browser script, plain ES5-style (`var`, no `const`/`let` arrow-only assumptions), ZERO dependencies, no build step. It runs in the browser as-is.
- `styles/newspaper.css` — single stylesheet, inlined at build time.

Article render functions and which are actually emitted into pages:
- `renderHybridArticle()` (around `src/render.js:182`) renders lead / secondary / deep-cut articles. It already emits the button at `src/render.js:230`:
  `<button class="hybrid-ask" type="button" aria-label="Ask the AI about this story">Ask about this</button>`
  Its root element is `.hybrid-article` and carries dataset attrs (`data-repo`, `data-stars`, `data-lang`, `data-url`) plus child `.hybrid-headline` / `.hybrid-subheadline` used to build the AI context.
- `renderQuickHit()` (around `src/render.js:235`) emits `<div class="quick-hit">` with fields `hit.url`, `hit.shortName || hit.name`, `hit.summary`, `hit.stars`. It currently has NO button and NO `data-*` attributes. This is the "quick hit" article type that is missing the button.
- The live render path is `renderSectionContent` → `assembleMultiSectionHtml`, which calls `renderHybridArticle` + `renderQuickHit`. Other exported functions (`renderLeadStory`, `renderFeaturedArticle`, `renderCompactArticle`) also exist but you must grep to confirm whether they are actually emitted into pages before touching them — do not add buttons to dead code.

Browser wiring (`public/chat.js`, around line 138): a delegated `click` handler does `e.target.closest('.hybrid-ask')`, then `btn.closest('.hybrid-article')`, then `setScope(article)` → `openPanel()`. Scope/context is read from the article element's dataset and its `.hybrid-headline` / `.hybrid-subheadline`. Because quick hits are `.quick-hit` (NOT `.hybrid-article`), simply adding a `.hybrid-ask` button to a quick hit will NOT work until the handler also resolves a quick-hit context element and `setScope` can read context from it.

CSS targets in `styles/newspaper.css`:
- `.chat-panel { width:360px; max-height:480px; position:fixed; bottom:88px; right:24px; display:none; flex-direction:column; overflow:hidden }` (~line 1626)
- `.chat-panel.open{display:flex}` (~line 1642)
- A mobile responsive override (~line 1898).
- Inner scroll region is `.chat-messages`; the text input lives inside the panel and must remain visible.

All user-controlled text is escaped via `escapeHtml()` in `src/render.js`; new output must use it too.

Known dead ends:
- Do NOT add a `.hybrid-ask` button to quick hits without also (1) giving the quick-hit element the context the handler/`setScope` needs and (2) extending the `public/chat.js` delegated handler to resolve a quick-hit scope element — a button alone is inert because `.quick-hit` is not `.hybrid-article`.
- Do NOT add buttons inside `renderLeadStory` / `renderFeaturedArticle` / `renderCompactArticle` on assumption; grep the live render path first and confirm they are emitted, or you will be editing dead code that ships nothing.
- Do NOT introduce `const`/`let`/imports/build tooling into `public/chat.js`; it ships raw to browsers and must stay plain.
- Do NOT widen the panel so far that it overflows a 375px-wide viewport — the mobile override exists precisely to prevent this and must be kept correct.

Inputs
======
- Repo root: `/Users/christopherharris/projects/gittimes`
- `/Users/christopherharris/projects/gittimes/src/render.js`
- `/Users/christopherharris/projects/gittimes/public/chat.js`
- `/Users/christopherharris/projects/gittimes/styles/newspaper.css`
- `/Users/christopherharris/projects/gittimes/test/` (Node `--test` unit tests; grep for the file that requires `renderHybridArticle` / `renderQuickHit`)
- `/Users/christopherharris/projects/gittimes/package.json` (defines `npm test` and `npm run lint`)
- `/Users/christopherharris/projects/gittimes/site` — local build output, may exist (unverified)
- Headless browser harness binary: `/Users/christopherharris/.claude/skills/gstack/browse/dist/browse` (supports `goto`, `js`, `click`, `screenshot`)

Constraints
==========
- No new dependencies. No new build tooling.
- `public/chat.js` stays plain browser JS (no `const`/`let`/import/require, no transpile step). Match the existing `var` style.
- Do NOT touch the Cloudflare Worker.
- Do NOT regress CSP: `script-src` includes `'self'`; do not add inline scripts or external script origins.
- All newly rendered user text must pass through `escapeHtml()` and match the existing markup/escaping conventions.
- Match existing code style in each file.
- Do NOT deploy and do NOT run `gh-pages`. A human deploys. Deliver code-complete + locally verified only.
- Only add buttons to article types confirmed to be in the live render path.

Definition of done
==================
Every item below must be objectively true and backed by a command in Verification.

Per-article-type checklist — each article type that the live render path emits has a working "Ask about this" button that opens the chat scoped to that story:
- [ ] Lead article: rendered HTML contains a `class="hybrid-ask"` button within the lead `.hybrid-article`. (Already true via `renderHybridArticle`; must not regress.)
- [ ] Secondary article: same, within a secondary `.hybrid-article`. (Must not regress.)
- [ ] Deep-cut article: same, within a deep-cut `.hybrid-article`. (Must not regress.)
- [ ] Quick hit: `renderQuickHit()` output now contains a `class="hybrid-ask"` button AND the quick-hit element carries the context the chat handler needs (e.g. `data-url` and a resolvable name/summary), all values `escapeHtml()`-escaped.
- [ ] `public/chat.js` delegated click handler resolves a scope element for a clicked `.hybrid-ask` inside a quick hit (not only `.hybrid-article`) and calls `setScope(...)` → `openPanel()` for it; clicking a quick-hit button opens the panel scoped to that quick hit.

Panel-size assertions:
- [ ] Desktop: computed `.chat-panel` width is `>= 420px` (up from 360px) and the panel still fits a 1280px-wide viewport (does not run off the right edge given `right:24px`).
- [ ] `.chat-panel.open` still resolves to `display:flex` and `.chat-messages` remains the scrollable region.
- [ ] Mobile at a 375px viewport: the open panel does NOT cause horizontal overflow (panel right edge ≤ viewport width; no document horizontal scrollbar), and the chat text input remains visible within the panel (not clipped below `max-height`).

Provability:
- [ ] `npm test` passes with no fewer tests than the current baseline (baseline is 431 passing). If you add tests, the count only goes up.
- [ ] `npm run lint` passes clean (no new errors/warnings) for `src/render.js` and `public/chat.js`.
- [ ] A grep-confirmed note (in your final report) of exactly which render functions are in the live render path, proving no button was added to dead code.

Verification
===========
Run these exact commands from the repo root. All must pass.

1) Baseline + regression test suite:
```
cd /Users/christopherharris/projects/gittimes
npm test
```
Assert: exit code 0, and the passing-test count is >= 431.

2) Lint:
```
cd /Users/christopherharris/projects/gittimes
npm run lint
```
Assert: exit code 0, no errors.

3) Quick-hit button is now rendered (Node assertion against the real render fn). Adjust the require path/exports to match `src/render.js`'s actual exports (grep first), then run:
```
cd /Users/christopherharris/projects/gittimes
node -e '
const r = require("./src/render.js");
const html = r.renderQuickHit({ url: "https://example.com/<x>", name: "Acme & Co", shortName: "acme/<repo>", summary: "A <b>test</b> & sample", stars: 123 });
if (!/class="hybrid-ask"/.test(html)) { console.error("FAIL: no hybrid-ask button in quick hit"); process.exit(1); }
if (/<x>|<b>test<\/b>/.test(html)) { console.error("FAIL: unescaped user text leaked into quick-hit HTML"); process.exit(1); }
if (!/data-url=/.test(html)) { console.error("FAIL: quick hit missing context attr (data-url)"); process.exit(1); }
console.log("PASS: quick-hit button rendered and escaped");
'
```
Assert: prints `PASS:` and exits 0.

4) Hybrid article button NOT regressed (lead/secondary/deep cut). Using the live render path or `renderHybridArticle` directly (grep to find the correct call signature), assert the output still contains `class="hybrid-ask"`:
```
cd /Users/christopherharris/projects/gittimes
node -e '
const r = require("./src/render.js");
const fn = r.renderHybridArticle;
const out = fn({ repo: { name: "octo/cat", url: "https://example.com", language: "JS", stars: 9 }, headline: "H", subheadline: "S", body: "x", useCases: [] });
if (!/class="hybrid-ask"/.test(out)) { console.error("FAIL: hybrid-ask button regressed"); process.exit(1); }
if (!/class="hybrid-article"/.test(out)) { console.error("FAIL: hybrid-article root missing"); process.exit(1); }
console.log("PASS: hybrid button intact");
'
```
Assert: prints `PASS:` and exits 0. (If the function signature differs, fix the call to match the real one found via grep — do not weaken the assertion.)

5) CSS panel-size assertions (grep the live values in `styles/newspaper.css`):
```
cd /Users/christopherharris/projects/gittimes
grep -nE '\.chat-panel\s*\{' styles/newspaper.css
grep -nE '\.chat-panel\.open' styles/newspaper.css
grep -nE 'chat-panel' styles/newspaper.css
```
Assert by reading the matched rules: the base `.chat-panel` width is `>= 420px`; `.chat-panel.open` still sets `display:flex`; and the mobile override (~line 1898, inside a `@media` max-width query) constrains width so the panel cannot exceed a 375px viewport (e.g. uses `width` derived from viewport units / `calc(100vw - …)` / `left`+`right` with the input kept visible). State the exact final values in your report.

6) Headless browser proof (run if the harness works; if `/Users/christopherharris/.claude/skills/gstack/browse/dist/browse` is non-functional, say so explicitly and substitute a DOM-level assertion). First confirm the harness:
```
/Users/christopherharris/.claude/skills/gstack/browse/dist/browse goto "file:///Users/christopherharris/projects/gittimes/site/index.html"
```
If a built page exists, then:
- Desktop (default viewport): `js` to read `getComputedStyle(document.querySelector('.chat-panel')).width` and assert `>= 420`.
- Click a quick-hit `.hybrid-ask` button (`click '.quick-hit .hybrid-ask'`), then `js` to assert `document.querySelector('.chat-panel').classList.contains('open') === true` (panel opened scoped to the quick hit).
- Mobile: emulate/resize to 375px wide, open the panel, then `js` to assert `document.documentElement.scrollWidth <= window.innerWidth` (no horizontal overflow) and that the chat input element's bounding rect is within the panel's rect (input visible).
- `screenshot` desktop-open and mobile-open states for the report.

If no built page exists under `/Users/christopherharris/projects/gittimes/site`, build it via the project's documented build step found in `package.json` (do NOT deploy), or construct a minimal local HTML harness that includes `styles/newspaper.css`, `public/chat.js`, and sample rendered article HTML, and run the same DOM assertions against it. Report exactly which path you used.

Report at the end: the grep-confirmed list of render functions in the live path, the final `.chat-panel` desktop width and the mobile override values, the `npm test` count (must be ≥ 431), and the pass/fail of each checklist item with the command output backing it.

<!-- prompt-out v1 -->
