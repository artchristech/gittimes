# Git Times — working context (AI Desk chat-window redesign)

The Git Times is an AI-generated newspaper for builders, live at **gittimes.com** (static
HTML on GitHub Pages / `gh-pages`, fronted by Cloudflare). On top sits the **AI Desk** — an
interactive chat on every edition, served by a Cloudflare Worker, with magic-link accounts
and $5/mo Stripe premium. **The active task is the chat *window* itself:** today it is a
fixed 440px card bolted to the bottom-right corner that you can't dock, grow, or take
fullscreen. Replace it with a **left-docked, full-height side panel that has a fullscreen
toggle** (and stays a card only as a small-screen fallback). The full target spec lives in
`docs/ai-desk-critique.md` §"Target window spec" — this CONTEXT is the runnable companion.

## Repo orientation (chat-relevant files only)
```
src/render.js              ★ renderChatUi() :500 — the chat panel MARKUP (.chat-fab + .chat-panel).
                             .chat-header :506 has NO controls yet → add expand/dock + close here.
                             renderChatScript() :531 injects window.__WORKER_URL + <script src=chat.js>.
public/chat.js             ★ chat client (ES5 var style, NOT in eslint glob). openPanel() :64 only
                             does panel.classList.toggle('open'). No dock/fullscreen/resize anywhere.
styles/newspaper.css       ★ .chat-fab :1874, .chat-panel :1902 (the floating card), .chat-panel.open
                             :1919, .chat-header :1923+, mobile @media(max-width:480px) :2174.
docs/ai-desk-critique.md   ★ the build spec. §"Target window spec" :123-161 = exact CSS + CSP-safe JS.
templates/newspaper.html   page shell; {{STYLES}} injects styles/newspaper.css, {{CHAT_SCRIPT}} at body end.
worker/index.js            Worker (chat answers) — OUT OF SCOPE for the window task.
```

## How it runs (the chat open path)
`renderChatUi()` (`src/render.js:500`) emits `#chat-fab` + `#chat-panel` into every page; the
CSS for both is in `styles/newspaper.css`. `renderChatScript()` (`:531`) appends
`window.__WORKER_URL=...` then `<script src="/chat.js">` at the end of `<body>`. In
`public/chat.js`, the IIFE grabs `#chat-fab`/`#chat-panel`; `openPanel()` (`:64`) and the fab
click handler (`:72`) toggle `.chat-panel.open`, whose only effect is `display:flex`
(`styles/newspaper.css:1919`). There is no docked/fullscreen state and no header control — the
panel is purely the bottom-right card defined at `styles/newspaper.css:1902`.

## Load-bearing facts
- **The window is a fixed card, not a panel.** `.chat-panel` (`styles/newspaper.css:1902`) is
  `position:fixed; bottom:88px; right:24px; width:440px; max-height:min(640px,calc(100vh-120px));
  border-radius:12px; box-shadow`. `public/chat.js` only `classList.toggle('open')`. This is the
  #1 critique finding (W1) — structural, not "make it bigger" (a prior pass already enlarged it).
- **CSP forbids inline handlers.** Every template's `<meta http-equiv="Content-Security-Policy">`
  is `script-src 'self' 'unsafe-inline'` (the `'self'` was added in `411e0f3` — without it the
  external `/chat.js` was browser-blocked and the fab was dead site-wide). Wire all new controls
  with `addEventListener`; NEVER `onclick=` in markup.
- **chat.js is ES5 and unlinted.** `public/chat.js` is plain `var` style and is NOT in the
  eslint glob (`src/ worker/ test/` + root scripts). Match the existing style; hand-check.
- **Deploy UI changes SURGICALLY — never via full publish.** `publish-edition.js` /
  `daily-edition.yml` regenerate LLM editorial content AND re-send the newsletter, and editorial
  content is not re-renderable from data (`site/editions/history.json` = star snapshots only).
  Ship CSS/JS to `gh-pages` via a worktree transform: copy `public/chat.js`→root `chat.js`, and
  string-swap the inlined `.chat-panel` CSS in the published HTML. Cloudflare ignores `?query`
  cache-busters — verify with `curl -H "Cache-Control: no-cache"`.
- **The worker is not involved.** Answer quality / context lives in `worker/index.js` + the
  `articleContext()` payload in `public/chat.js`; the window task touches only render/CSS/chat.js.

## Target spec (from docs/ai-desk-critique.md:123-161 — exact)
```css
.chat-panel.docked {
  left:0; top:0; right:auto; bottom:auto;
  width:max(25vw, 420px); height:100vh; max-height:100vh;
  border-radius:0; border-right:1px solid var(--rule-light);
  box-shadow:2px 0 16px rgba(0,0,0,0.12);
}
.chat-panel.fullscreen { width:100vw; }
.chat-panel.docked #chat-messages { flex:1; min-height:0; overflow:auto; }
@media (min-width:900px) {
  body.chat-docked { margin-left:max(25vw,420px); transition:margin-left .15s; }
  body.chat-docked.chat-fullscreen { margin-left:0; }
}
@media (max-width:900px) { .chat-panel.docked { width:100vw; } }
```
```js
// public/chat.js — CSP-safe, no inline handlers
expandBtn.addEventListener('click', function () {
  panel.classList.toggle('fullscreen');
  document.body.classList.toggle('chat-fullscreen', panel.classList.contains('fullscreen'));
});
// openPanel()/closePanel() also toggle .docked on the panel + .chat-docked on <body>.
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
});
```

## Tunables / tolerances
- Dock width: `max(25vw, 420px)` (≥¼ viewport, 420px floor). Fullscreen: `width:100vw`.
- Dock breakpoint: `≥900px` reflows the page (`body.chat-docked margin-left`); `<900px` rail goes
  full-width (retires the old `max-width:480px` card-only rule into the ladder).
- Existing card values to preserve as the small-screen fallback: `bottom:88px; right:24px; width:440px`.

## Phase plan
| Phase | Deliverables | Days | P(ship) |
|---|---|---|---|
| **Window (this phase)** | Docked left rail · ≥25% width · full height · fullscreen toggle · page reflow · card fallback | 1 | 0.9 |
| Next (interaction) | Esc-to-close, keyboard-open, transcript persistence to sessionStorage (`history_msgs` is in-memory) | 1 | 0.8 |
| Later (trust) | Answer-quality (worker system prompt), per-cell sourcing | 2 | 0.6 |

## Current phase — concrete sub-tasks (each with a verification target)
1. **CSS — add `.docked` / `.fullscreen` states** to `styles/newspaper.css` near `.chat-panel`
   (`:1902`). *After: a `.chat-panel.docked` element sits `left:0; top:0; height:100vh; width≥25vw`.*
2. **Markup — add controls to `.chat-header`** (`src/render.js:506`): a fullscreen/expand button and
   a close button, each with `id` + `aria-label`, no inline handlers. *After: `renderChatUi()` output
   contains the two buttons inside `.chat-header`.*
3. **JS — wire controls + default-to-docked** in `public/chat.js`: `openPanel()` toggles `.docked`
   on the panel + `.chat-docked` on `<body>` (on viewports ≥900px), expand toggles `.fullscreen` +
   `body.chat-fullscreen`, close + Esc call `closePanel()`. *After: opening the panel docks it left
   and the article reflows beside it; expand → 100vw; Esc closes.*
4. **Page reflow** via `@media (min-width:900px) body.chat-docked { margin-left }`. *After: with the
   panel open on a wide viewport, the edition content is fully visible beside the rail, not under it.*
5. **Deploy surgically to gh-pages** (worktree transform, NOT full publish). *After:
   `curl -H "Cache-Control: no-cache" https://gittimes.com/chat.js` serves the new code and the live
   panel docks left + goes fullscreen.*

## Out of scope (resist this phase)
- Worker / answer-quality / system-prompt changes (separate phase).
- Transcript persistence, keyboard-open niceties (next phase).
- Any change that requires a full `publish-edition.js` run (regenerates content + mails the newsletter).
- Merging/deploying the unrelated `feat/editor-in-chief-v2` branch (PR #4) — independent track.

## Memory pointer
`~/.claude/projects/-Users-christopherharris-projects/memory/project_gittimes.md`
