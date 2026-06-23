**Problem**

I'm a frontier builder / power-user reading The Git Times, and the "AI Desk" chat assistant is unusable at the size and place it lives. Today it opens as a cramped ~440px card pinned to the BOTTOM-RIGHT corner of the viewport — a glorified intercom bubble floating over the page. For a tool whose whole job is to answer substantive questions about an article (streaming, multi-paragraph, code-adjacent answers), a 440px-wide box that covers the lower-right third of the screen and tops out at ~640px tall is the wrong primitive entirely. I should be able to read the article and the assistant side by side; instead the panel obscures content, forces me to scroll a tiny scrollback, and can't be grown. There is no resize, no fullscreen, no docking — `public/chat.js` only toggles an `.open` class.

Your job: roleplay that builder, actually open the live AI Desk (or inspect the real source), and write a HARSH, specific, written critique — a markdown deliverable, NOT code changes — that LEADS with the window being far too small and badly placed, then covers the ergonomic/spatial fallout and broader UX. The critique must explicitly specify the desired window: at least 25% of viewport width, docked to the LEFT edge, full viewport height (top to bottom), with a one-click FULLSCREEN toggle.

**Context**

The Git Times is an AI newspaper for builders (live at gittimes.com). The AI Desk is a round floating action button (FAB) in the bottom-right that opens a small floating chat panel on edition/article pages. Clicking "ASK ABOUT THIS" / "Ask about this story" on an article sets the panel's context ("Asking about: <title>"). Answers stream in; the footer reads "Answers by the Git Times AI desk · verify before you ship".

Stack: zero-framework Node.js, NO site build step — pages are server-side string-templated static HTML/CSS, vanilla JS only, strict CSP (`script-src 'self' 'unsafe-inline'`; no CDN libs). Any proposed fix MUST be vanilla JS + CSS, CSP-safe, no framework, no new dependency.

The window itself is `.chat-panel` in `styles/newspaper.css` (~line 1649): `position: fixed; bottom: 88px; right: 24px; z-index: 200; width: 440px; max-width: calc(100vw - 48px); max-height: min(640px, calc(100vh - 120px)); border-radius: 12px;`. The FAB `.chat-fab` (~line 1621) is a 52px circle at `bottom:24px; right:24px`. A `@media (max-width:480px)` rule (~line 1922) makes it near-full-width only on phones. There is NO left-dock, NO full-height layout, NO fullscreen/expand/resize control. The panel markup (FAB + `.chat-panel` + `.chat-header` "The Git Times · AI Desk" + body + `.chat-input-row` + input) is emitted by `src/render.js` (~lines 421–443). The behavior (open/close, streaming, "Asking about" context + dismiss ×) is in `public/chat.js` (~321 lines); the published copy is `site/chat.js`. The chat API backend is `worker/index.js`.

Known dead ends: there is a prior prompt file `prompts/chat-panel-size-and-per-article-button.md` about chat-panel size — treat it as RELATED BACKGROUND, not a solved problem. The current live panel is still the small bottom-right card described above; do not assume any of its proposals shipped, and do not re-file a bare "make it bigger" — the unmet need is structural (left dock + full height + fullscreen), so the critique must give a concrete target spec.

**Inputs**

- Repo root: `/Users/christopherharris/projects/gittimes`
- Panel CSS (the window): `/Users/christopherharris/projects/gittimes/styles/newspaper.css` (`.chat-panel` ~1649, `.chat-fab` ~1621, media query ~1922)
- Panel markup: `/Users/christopherharris/projects/gittimes/src/render.js` (~lines 421–443)
- Panel behavior: `/Users/christopherharris/projects/gittimes/public/chat.js` (~321 lines)
- Published script copy: `/Users/christopherharris/projects/gittimes/site/chat.js` (unverified)
- Chat API backend: `/Users/christopherharris/projects/gittimes/worker/index.js`
- Prior related prompt: `/Users/christopherharris/projects/gittimes/prompts/chat-panel-size-and-per-article-button.md`
- Live page to open the AI Desk (click the bottom-right ◆ FAB, then "Ask about this" on an article): `https://gittimes.com/latest/`
- WRITE THE CRITIQUE TO: `/Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md` (the `docs/` dir may need creating)

**Constraints**

- The deliverable is a WRITTEN CRITIQUE markdown file at the path above. Do NOT change `styles/newspaper.css`, `src/render.js`, `public/chat.js`, or any product code. Proposed fixes are described IN PROSE inside the critique, not applied.
- Ground every finding in what is REALLY there — open the live AI Desk (use the browse/gstack skill), OR read `styles/newspaper.css` + `public/chat.js` + `src/render.js` directly. No invented selectors, line numbers, or behaviors; cite the actual file/section, and quote at least one real value you observed (e.g. `width:440px`, `bottom:88px`).
- Lead the document with the WINDOW/LAYOUT critique — it is the headline complaint, not a footnote.
- The critique must open in FIRST PERSON as a power-user persona (e.g. "I'm a frontier builder and I just opened the AI Desk…").
- Organize ALL findings into exactly three buckets, in this order: **(1) Window/Layout**, **(2) Interaction/Affordances**, **(3) Content/Trust**.
- Every finding must carry, explicitly: a **severity** tag (`Critical` / `Major` / `Minor`), an **exact location** (file + selector/section or line range), a **why it matters** sentence, and a **concrete fix** that fits the stack (vanilla JS + CSP-safe CSS, no framework — class toggles via `addEventListener`, never inline `onclick=`).
- Include a dedicated **Target window spec** section with concrete, copy-pasteable direction: ≥25% of viewport width (state the value, e.g. `max(25vw, 420px)`), docked to the LEFT edge (`left:0`), full viewport height (`top:0; bottom:0` / `height:100vh`), border-radius dropped on the docked edge, plus a one-click FULLSCREEN toggle (a `.fullscreen` modifier going to `100vw`). Describe the CSS (an `.docked` / `.fullscreen` state class) AND the JS approach (a new button in `src/render.js` markup + a CSP-safe `addEventListener` handler in `public/chat.js` that toggles a class, composing with the existing `.open` toggle), plus what happens at the `max-width:480px` breakpoint.
- Minimum 12 findings TOTAL across the three buckets, with at least 3 in each bucket.
- Include a ranked **Top 5 to fix first** ordered list (exactly 5 items), each naming the finding and a one-line why-first justification (ranked by builder impact ÷ effort).
- End with a blunt **Overall verdict** paragraph in the persona's voice and a single **letter grade** (e.g. `Grade: C-`).
- Markdown only. No code patches to product files.

**Definition of done**

- File exists at `/Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md`.
- It opens with a first-person power-user persona sentence (contains "I'm" or "I just" or "As a" in the first ~3 lines).
- It contains the three bucket headings, in order: a Window/Layout heading FIRST, then Interaction/Affordances, then Content/Trust.
- It contains a clearly labeled **Target window spec** section that explicitly states all four window requirements: ≥25% viewport width, left-docked, full viewport height, and a fullscreen toggle — with concrete CSS values and a CSP-safe vanilla-JS toggle approach referencing `src/render.js` and `public/chat.js`.
- It contains ≥12 findings total, ≥3 per bucket, each tagged with a severity of `Critical`, `Major`, or `Minor`, each citing a real file location (e.g. `styles/newspaper.css` `.chat-panel`, `public/chat.js`, `src/render.js`).
- Findings reference REAL elements/selectors from the source (`.chat-panel`, `.chat-fab`, `.chat-header`, `.chat-input-row`, the `.open` toggle, the AI-desk footer copy) — not invented ones, and quote at least one real value (e.g. `440px` / `bottom:88px`).
- The Window/Layout critique is the lead/headline of the document.
- A **Top 5 to fix first** ordered list (exactly 5 items) is present.
- A closing **Overall verdict** paragraph plus a single **letter grade** is present.

**Verification**

Run these from the repo root and confirm:

1. File exists: `test -f /Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md && echo OK`
2. Persona present near top: `head -5 /Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md | grep -Ei "I'm|I just|As a"`
3. Three buckets present and ordered: `grep -nE "Window/Layout|Interaction/Affordances|Content/Trust" /Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md` — confirm Window/Layout's line number is the smallest (appears first).
4. Target window spec covers all four requirements: `grep -niE "25vw|25%|left:0|left edge|left-dock|100vh|full.?height|fullscreen" /Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md` — must hit width, left-dock, full-height, and fullscreen.
5. Severity tags present and counted: `grep -coE "Critical|Major|Minor" /Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md` — must be ≥12.
6. Real selectors cited: `grep -cE "chat-panel|chat-fab|chat-header|chat-input-row|\.open" /Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md` — must be ≥4.
7. Real value quoted: `grep -nE "440px|bottom:88px|right:24px|1649" /Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md` — ≥1 hit.
8. Grounding check: confirm the critique cites the real `.chat-panel` rule (440px width, bottom/right placement) by reading `styles/newspaper.css` around line 1649 first, then confirming the critique's described current-state matches.
9. CSP-safe fix check: `grep -niE "CSP|inline|addEventListener|unsafe-inline|no framework|vanilla" /Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md` — confirm the fix respects strict CSP (no inline onclick) and the framework-free stack.
10. Top-5 present: `grep -niE "Top 5 to fix first" /Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md` and confirm exactly 5 numbered items follow.
11. Verdict + grade present: `grep -iE "Overall verdict|Grade:\s*[A-F]" /Users/christopherharris/projects/gittimes/docs/ai-desk-critique.md`

<!-- prompt-out v1 -->
