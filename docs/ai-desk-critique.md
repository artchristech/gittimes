# The Git Times "AI Desk" — Harsh Builder Critique

> I'm a frontier builder — I ship LLM products and edge infra daily, and I live inside ChatGPT/Claude side panels and Cursor's chat. I just opened the AI Desk on gittimes.com to ask a real question about an article, and the very first wall I hit is the window: a tiny card bolted to the bottom-right corner that I can't grow, dock, or take fullscreen. I went and read the source to confirm I wasn't imagining it. I was not.
>
> *Grounding:* `.chat-panel` (`styles/newspaper.css:1649`) is literally `position:fixed; bottom:88px; right:24px; width:440px; max-width:calc(100vw-48px); max-height:min(640px, calc(100vh-120px)); border-radius:12px`. The opener (`public/chat.js`) only does `panel.classList.toggle('open')` — there is no fullscreen, dock, or resize anywhere. Markup is `renderChatUi()` in `src/render.js:419`. The footer reads "Answers by the Git Times AI desk · verify before you ship."

This critique leads with the window (the headline failure), then interaction, then content/trust. Every finding is tagged **Severity · Location · Why · Fix**, and every fix is vanilla JS + CSS, CSP-safe (the page runs `script-src 'self' 'unsafe-inline'`), framework-free, no build step. Note: a prior prompt (`prompts/chat-panel-size-and-per-article-button.md`) already addressed "panel size," yet the **live panel is still the 440px bottom-right card** — so this is not a "make it a bit bigger" request; the unmet need is structural (left dock + full height + fullscreen). The concrete target is in the **Target window spec** section below.

---

## 1. Window / Layout

**W1 — The window is a fixed 440px bottom-right card you cannot dock, resize, or fullscreen.** *(LEAD)*
- **Severity:** Critical
- **Location:** `styles/newspaper.css:1649` `.chat-panel` (`width:440px; bottom:88px; right:24px`); `public/chat.js` (only `classList.toggle('open')`).
- **Why:** On a 27" monitor this is a postage stamp floating in the corner of a newspaper. The whole job of the assistant is reading the article and interrogating it *together*; a 440px corner card makes that impossible — I either read or I chat, never both. There is no affordance to change it.
- **Fix:** Re-model the panel from "floating card" to "docked rail": a `.docked` state (`left:0; top:0; height:100vh; width:max(25vw,420px); border-radius:0`) and a `.fullscreen` state (`width:100vw`). See the **Target window spec** for exact CSS + the CSP-safe toggle. Default to docked-left on viewports ≥ ~900px; keep the card only as a small-screen fallback.

**W2 — `max-height: min(640px, calc(100vh-120px))` crushes long answers into a tiny scrollback.**
- **Severity:** Major
- **Location:** `styles/newspaper.css:1649` `.chat-panel` (`max-height`); `#chat-messages`.
- **Why:** Answers stream in multi-paragraph. Capped at ~640px with the input row and header eating space, I read grounded answers through a ~400px porthole, scrolling constantly. The screenshot reply was already taller than the visible area.
- **Fix:** With a full-height docked panel, `#chat-messages` becomes `flex:1; min-height:0; overflow:auto` and the cap disappears — the message list uses the whole column between header and input.

**W3 — `position:fixed; right:24px; z-index:200` means the panel obscures the article instead of sitting beside it.**
- **Severity:** Major
- **Location:** `styles/newspaper.css:1649` `.chat-panel`; `.chat-fab` (`styles/newspaper.css:1621`).
- **Why:** The card floats *over* the right column of content. To read the text I'm asking about, I have to close the assistant. A left-docked rail that pushes/【overlays a margin of】 the page lets me keep both on screen.
- **Fix:** When `.docked`, add a body class (`chat-docked`) that applies `margin-left` (or a CSS grid shift) equal to the panel width on wide viewports, so content reflows beside the rail rather than hiding under it. Pure CSS, toggled by the same class.

**W4 — Card chrome (border-radius:12px + drop shadow) signals "support widget," not "workspace."**
- **Severity:** Minor
- **Location:** `styles/newspaper.css:1649` (`border-radius:12px; box-shadow`).
- **Why:** The visual language tells me this is a dismissible intercom bubble, so I treat it like one. A docked, square-edged, full-height rail reads as a tool I can work in.
- **Fix:** Drop `border-radius` and shadow in `.docked`; keep a single hairline `border-right` against the page.

**W5 — Only `@media (max-width:480px)` goes full-width; the tablet/small-laptop "middle" keeps the cramped card.**
- **Severity:** Minor
- **Location:** `styles/newspaper.css:1922` (`@media (max-width:480px)`).
- **Why:** Between 480px and large desktop — i.e. most laptops in a split window — you get the worst case: a 440px card that's both too big to ignore and too small to use.
- **Fix:** Add a breakpoint so the docked rail spans full-width below ~900px and `max(25vw,420px)` above it; retire the 480px-only special case into this ladder.

---

## 2. Interaction / Affordances

**I1 — There is no fullscreen / expand control at all.**
- **Severity:** Critical
- **Location:** `public/chat.js` (open/toggle only); markup `src/render.js:419` (`.chat-header` has no controls).
- **Why:** When an answer is long or I'm pasting a stack trace, I want to go fullscreen. The header (`The Git Times · AI Desk` + live dot) carries zero buttons — no expand, no controls.
- **Fix:** Add an expand button to `.chat-header` markup in `src/render.js`, wired in `public/chat.js` with `btn.addEventListener('click', ()=>panel.classList.toggle('fullscreen'))` (CSP-safe; no inline `onclick=`). `.fullscreen` → `width:100vw`.

**I2 — No resize, no drag, no dock-side toggle.**
- **Severity:** Major
- **Location:** `public/chat.js`; `.chat-panel`.
- **Why:** The panel is exactly one size forever. Every competing assistant (ChatGPT/Claude side panels, Cursor) lets me drag the divider to fit my screen and my task. Here I take 440px or nothing.
- **Fix:** A drag handle on the docked edge: `addEventListener('pointerdown'…)` setting `--chat-w` (a CSS custom property the panel width reads), persisted to `localStorage`. Vanilla, no library.

**I3 — Conversation is lost the moment I navigate to the article I'm asking about.**
- **Severity:** Major
- **Location:** `public/chat.js:19` (`var history_msgs = []` — in-memory only; `localStorage` holds only the session token, not the transcript).
- **Why:** I click "Ask about this," read the article, click another story — and the thread is gone because `history_msgs` lives in a page-scoped variable on a multi-page (server-rendered) site. The assistant has amnesia exactly when I'm doing the cross-article reading it's for.
- **Fix:** Persist `history_msgs` (+ `scoped`) to `sessionStorage` on each turn and rehydrate on load. A dozen lines; no backend change.

**I4 — No keyboard path: no shortcut to open, no Esc to close.**
- **Severity:** Major
- **Location:** `public/chat.js:72` (FAB click is the only opener; `openPanel` focuses input but no key handlers).
- **Why:** A builder lives on the keyboard. There's no `⌘/Ctrl-K`-style opener and no `Esc` to dismiss — every open/close is a mouse trip to the corner FAB.
- **Fix:** `document.addEventListener('keydown', …)` for a toggle chord and for `Escape` to close when `.open`. CSP-safe.

**I5 — No copy-answer, no stop-generating, no new-chat/clear.**
- **Severity:** Minor
- **Location:** `public/chat.js` (streaming loop; no per-message controls); markup has no message actions.
- **Why:** I can't copy a grounded answer in one click, can't abort a long stream I no longer want, and can't start a clean thread — table stakes for any chat tool.
- **Fix:** Add a copy button per `.chat-msg-ai`, an abort via `AbortController` on the fetch, and a "new chat" that clears `history_msgs`/`scoped` and the persisted transcript.

**I6 — Closing is all-or-nothing; there's no minimize that preserves context.**
- **Severity:** Minor
- **Location:** `public/chat.js:72` (toggle removes `.open`); FAB.
- **Why:** To get the article back I fully close the panel, which (per I3) also drops the thread. There's no "collapse to a slim rail" middle state.
- **Fix:** A minimize state (`.docked` → a 0-width rail with a reopen tab) that keeps the transcript mounted.

---

## 3. Content / Trust

**C1 — Answers are generic and hedge-y even though the article body IS being sent.**
- **Severity:** Major
- **Location:** Output behavior (live: the "find other Cloudflare projects" reply was a vague step list); grounding in `public/chat.js:94` `articleContext()` (sends title + subhead + summary + repo/stars/lang/sentiment/url + full body, capped at 4000 chars) and `sectionContext()` (6000 chars). The prompt/model that turns that into an answer lives in `worker/index.js`.
- **Why:** This is the important one. The front end *does* feed the model real context (up to 4000 chars of the article incl. repo facts), so vagueness isn't context starvation — it's the system prompt/model in `worker/index.js` not being instructed to be specific and cite what it was given. A builder reads one mushy answer and never trusts the desk again.
- **Fix:** In `worker/index.js`, tighten the system prompt to "answer from the provided article context; quote specifics; if the context doesn't contain the answer, say so" and consider a stronger model for this path. (Worker-side; verify what prompt/model it currently uses.)

**C2 — No citations or source links in answers; "verify before you ship" is doing the trust work the product should do.**
- **Severity:** Major
- **Location:** `src/render.js:446` `.chat-byline` ("verify before you ship"); answer rendering in `public/chat.js`.
- **Why:** The disclaimer reads as a crutch that excuses low-confidence output. The context assembly already has `article.dataset.url` and repo names (`public/chat.js:103-107`) — none of that surfaces as a clickable citation in the answer.
- **Fix:** Have the worker return source refs (the repo URL / article it grounded on) and render them as links under each answer; demote the disclaimer once answers are cited.

**C3 — Scope is unstated: the starters imply it knows "today's stories" AND "the AI model market," but nothing tells me the boundary.**
- **Severity:** Minor
- **Location:** `src/render.js:432` starters ("Summarize today's top story", "What's the cheapest model with vision?"); `#chat-messages` intro.
- **Why:** "What's the cheapest model with vision?" implies it can answer from the AI Markets data; I don't know if it actually has that, or only today's article text. Unclear scope makes every answer ambiguous about whether it's grounded or guessed.
- **Fix:** One line in the intro stating what the desk can see (today's edition + the model market), and have the worker refuse/redirect out-of-scope asks explicitly.

**C4 — Anonymous visitors hit a paywall before they can try a single question.**
- **Severity:** Minor
- **Location:** `public/chat.js:29-53` (`showPaywall()` for anon; `.chat-paywall` markup `src/render.js:438`).
- **Why:** First impression for a logged-out builder is "Upgrade / Sign in," not a working answer. No free taste = no reason to come back.
- **Fix:** Allow 1–2 ungated questions per session before the paywall, so the value is felt before the ask.

---

## Top 5 to fix first

1. **W1 — Dock left, ≥25% width, full height.** The headline complaint and the highest impact-per-effort; it's a CSS state class + one toggle. Everything else gets more usable once the window is real.
2. **I1 — Fullscreen toggle.** One header button + `classList.toggle('fullscreen')`; trivially cheap, and it's the explicit ask. Ship it with W1.
3. **C1 — Make answers specific + grounded.** A docked full-height window is worthless if the answers are mush; tightening the worker prompt is the trust unlock.
4. **I3 — Persist the transcript across navigation.** Kills the amnesia that breaks the core "read article ↔ ask about it" loop on a multi-page site; ~a dozen lines of `sessionStorage`.
5. **I4 — Keyboard open + Esc to close.** Cheap, and it's the difference between a builder tool and a mouse-only widget.

---

## Target window spec (the ask, concretely)

Replace the floating-card model with a **left-docked, full-height rail** plus a **fullscreen** state. All CSP-safe (class toggles via `addEventListener`, no inline handlers), no framework, no build step.

```css
/* default stays the card on small screens; dock on wide */
.chat-panel.docked {
  left: 0; top: 0; right: auto; bottom: auto;
  width: max(25vw, 420px);   /* ≥ 1/4 of viewport, with a sane floor */
  height: 100vh; max-height: 100vh;
  border-radius: 0;
  border-right: 1px solid var(--rule-light);
  box-shadow: 2px 0 16px rgba(0,0,0,0.12);
}
.chat-panel.fullscreen { width: 100vw; }
.chat-panel.docked #chat-messages { flex: 1; min-height: 0; overflow: auto; }

/* reflow the page beside the rail on wide viewports */
@media (min-width: 900px) {
  body.chat-docked { margin-left: max(25vw, 420px); transition: margin-left .15s; }
  body.chat-docked.chat-fullscreen { margin-left: 0; }
}
/* below 900px: rail goes full-width; the 480px card rule is retired into this ladder */
@media (max-width: 900px) { .chat-panel.docked { width: 100vw; } }
```

```js
// public/chat.js — header controls, CSP-safe (no inline onclick=)
expandBtn.addEventListener('click', function () {
  panel.classList.toggle('fullscreen');
  document.body.classList.toggle('chat-fullscreen', panel.classList.contains('fullscreen'));
});
// open/close already toggles .open; also toggle .docked + body.chat-docked there.
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
});
```

Markup: add an expand button (and a dock toggle) inside `.chat-header` in `renderChatUi()` (`src/render.js:425`). Requirements met: **≥25% viewport width** (`max(25vw,420px)`), **docked left** (`left:0`), **full viewport height** (`height:100vh`), **fullscreen toggle** (`.fullscreen → 100vw`).

---

## Overall verdict

The AI Desk has the bones of something good — it actually sends the article body to the model, it has a clean masthead and decent starters — but it's wearing the costume of a customer-support intercom, and that costume is sabotaging it. The 440px bottom-right card I can't dock, grow, or fullscreen is the first thing I hit and the reason I'd bounce back to my other tabs; the amnesia-on-navigation and the mushy, uncited answers are what would keep me from coming back. None of the top fixes are hard on this stack — a docked full-height rail and a fullscreen toggle are a CSS state class and one button. Until then this reads as a demo, not a desk.

**Grade: C-**
