# Git Times — working context

_Refreshed 2026-07-02. Supersedes the 2026-06-27 chat-window context (that task shipped)._

**The Git Times** is an AI-generated newspaper for builders, live at **gittimes.com**. Each
"edition" is a curated pass over what shipped this week (GitHub events, model drops, AI wire)
rewritten as readable feature stories. Static HTML on **GitHub Pages (`gh-pages`)** fronted by
**Cloudflare**. On top sits the **AI Desk** — a per-edition chat backed by a single Cloudflare
Worker (`gittimes-chat`), with magic-link accounts and $5/mo Stripe premium. Live end-to-end:
magic-link login + real-money premium + OpenRouter chat + newsletter.

## Two active threads

### Thread A — Front-page "FLOW" (editorial quality). SHIPPED to Layer 2; Phase 2 is next.
Owner's complaint (2026-06-30): the front page led with **evergreen popular repos** as if news.
Root cause = the source was a **STOCK signal** (GitHub trending/popularity), not **FLOW** (what
shipped this week). Fix is layered:
- **Layer 1 — recency + lead-by-event. DONE + LIVE.** `src/recency.js` windows tightened
  30/60/120 → **7/21/45**; `pickLeadIndex` chooses the lead by freshest hook → freshest push,
  never raw star score. `src/github.js categorizeDiverseForSection` adds a 45d recency floor +
  fresh-first partition (finally wires in the dead `passesPushedRecency`). `src/editorial.js`
  no-hook fallback sorts by push, not popularity. `src/prompts.js editorialFramingDirective`
  **bans evergreen voice** ("remains a", "a vital guide", "the go-to", …), extended to trend
  pieces (`836c928`). Editions now lead with genuine EVENTS (scrcpy v4.0, PyTorch patch, k8s).
- **Layer 2 v1 — Hugging Face Model Drops (first FLOW source). DONE + LIVE (2026-07-01).**
  `src/model-drops.js` (keyless HF `/api/models`, two lanes: `likes7d` hot + `createdAt` fresh
  for TRUSTED_ORGS), `selectModelDrops` filters to a recency window + traction/trust, drops
  community quant re-hosts. `render.js renderModelDrops` = a band pinned at the TOP of the front
  page. Killswitch `GT_DISABLE_MODEL_DROPS=1`. 9 tests (`test/model-drops.test.js`).
- **Layer 2 band RANKING BUG — FIXED, verified, UNCOMMITTED (2026-07-03).** Owner flagged the
  live band as "a ridiculous model release section that doesn't update." Root cause in
  `src/model-drops.js selectModelDrops`: (a) it ranked by **raw likes over the 14d window**, so the
  most-liked model stayed pinned at #1 for days (the band read as frozen); (b) the trust filter
  only caught quant suffixes, so an **uncensored community finetune** (`empero-ai/Qwythos-9B-
  Claude-Mythos-5-1M`, 650 likes, 13d old, tags `uncensored`+`base_model:finetune:`) headlined
  "the newest releases builders are picking up right now." Fix: rank by a **freshness-decayed
  score** `((likes+1)/(age+2)^gravity) × trustedBoost` (velocity, not stock — re-sorts daily) and
  **drop roleplay + non-trusted derivatives** via HF tags (`uncensored`/`not-for-all-audiences`,
  `base_model:finetune|merge|adapter|quantized`, bare `merge`/`mergekit`; trusted labs exempt).
  13/13 tests green, lint clean. **Live-verified against real HF data** — band now leads
  DeepSeek-V4-Pro (6d) / Qwen-AgentWorld / google/tabfm, junk gone. Files: `src/model-drops.js`,
  `test/model-drops.test.js`. **DEPLOY (owner action):** commit+push main → `gh workflow run
  "Daily Edition" -f skip_newsletter=true` to republish today, or let the 07:00 UTC cron pick it up.
- **NEXT LEVER — LIVE band (the real "velocity" fix), NOT built.** The band is baked at daily
  publish, so a midday drop won't show until 07:00 UTC. HF `/api/models` **allows browser CORS**
  (verified: `access-control-allow-origin: https://gittimes.com`) and CSP already permits `'self'`
  scripts → a self-hosted client script can re-fetch + re-rank on every page load, with graceful
  fallback to the server-baked band. Deploy mechanics = same as `chat.js` (asset to gh-pages root +
  mirror on main so the daily publish copies it).
- **Layer 2 Phase 2 — NOT built (rest of Thread A):**
  1. **GitHub Releases firehose** over a curated high-signal repo watchlist.
  2. Promote **arXiv / HN wire items to LEAD-eligible**.
  3. Make a **model drop the actual front-page LEAD** (needs the article generator to write from
     a drop, not just a repo).
  4. Demote GitHub trending to an honest **"Trending on GitHub" rail**.

### Thread B — GT-FLAT product/payments build-out. Batch code-complete + AI Desk moat LIVE; the decisive gate is reading the funnel.
Named falsifiable claim (`docs/build-out-sheet.md`, authored 2026-06-27):
> **`GT-FLAT`: Revenue is flat because the product surfaces — accounts, payments, services,
> security, AI integration — are underbuilt, NOT because of marketing.** (Marketing was
> falsified upstream and is OUT OF SCOPE.)
- **The moat (AI Desk archive-as-tools) — BUILT + DEPLOYED LIVE 2026-06-30.** Full-corpus RAG
  (`src/build-corpus.js` → `data/corpus.json`, `src/retrieve.js` BM25+recency, worker inlines an
  identical copy — **KEEP IN SYNC**) with inline citations; optional streamed thinking; repo
  tool-use + model compare (intent-gated, logged-in only); economics (`src/economics.js`);
  `/pricing` page; **AI Desk is Premium-only** (`FREE_DAILY_CHAT_LIMIT=0` → free plans incur $0
  model cost); saved answers / bookmarks. Worker deployed (`wrangler deploy`), gh-pages surgical
  (`chat.js`, `/pricing`, `/data/corpus.json`).
- **The 2026-06-27 goal-session batch — code-complete + tested, deploy-gated on owner action.**
  Grace-clearing churn fix (`invoice.payment_succeeded/paid`), funnel counters (`wallHits`,
  `anonAsks`) + truthful MRR (exclude comps), account-page real cap (`chatLimit`, kill hardcoded
  `/100`), rate-limit `/chat` + `/subscribe`, disposable-email gate, reconciliation cron,
  win-back email, annual SKU lane, server-side transcript memory + GDPR delete, pinned chat model.
- **⛔ THE DECISIVE NEXT STEP (owner action, per the sheet's P0-A):** _the build-out item that is
  simultaneously the fix AND the experiment that grades the whole sheet._ **Set `ADMIN_TOKEN`**
  in the deployed worker (prod has only the `dev_admin` placeholder → `/admin/stats` returns 401,
  so `premiumUsers` / `estimatedMRR` are unreadable — the owner is flying blind by construction),
  `wrangler deploy`, surgical gh-pages for `account.html`, one-time `stats:totalUsers` reset to
  backfill comps, then **read the funnel numbers.** Those numbers confirm or refute `GT-FLAT`:
  many `totalUsers` + many free users hitting the wall + `premiumUsers ≈ 0` → confirms (product
  problem); tiny `totalUsers`, wall rarely hit → refutes (re-opens demand).
- **Still ⬜ (large / cross-system):** x402 nonce-binding to turn on the agent API paywall (fails
  closed today — do not half-build); host remote MCP + bundle API key on upgrade; passkey/
  WebAuthn fallback + GitHub connect + KV→D1 spike; pre-wall value teaser.

## Load-bearing facts (read before touching anything)
- **NO SQL for the money path.** All account/payment/session state is **Cloudflare KV**
  (`USERS`, `SESSIONS`, `MAGIC_LINKS`). `src/db.js` (better-sqlite3) is the *editorial/API* store,
  not the worker. Any "add a query" idea must call out the KV-scan or KV→D1 migration cost.
- **Two SEPARATE deploy surfaces; never conflate them.**
  - **Editorial / source / content changes** → `gh workflow run "Daily Edition" -f skip_newsletter=true`
    regenerates + redeploys TODAY's edition **without re-sending the newsletter** (gated on the
    explicit `SKIP_NEWSLETTER` env flag in `publish-edition.js` step 6). Scheduled cron (07:00
    UTC) is unaffected. This is the lever used for Layers 1 & 2.
  - **UI / CSS / JS-only changes** (`public/chat.js`, styles) → **surgical gh-pages worktree
    transform**, NOT a full publish: `git worktree add --detach <tmp> origin/gh-pages`, copy
    `public/chat.js`→root `chat.js` (it self-injects its `.chat-*` CSS via `<style id=chat-desk-styles>`),
    string-swap inlined CSS, `git push origin HEAD:gh-pages`. **Also commit the same file to `main`**
    (`src/publish.js` copies `public/chat.js`→site root, so the next daily publish reverts gh-pages
    if main lags). **Worker changes** → `wrangler deploy` (owner-authed).
- **NEVER deploy UI via `publish-edition.js` / `daily-edition.yml`.** A full publish REGENERATES
  LLM editorial content AND **re-sends the newsletter**; editorial content is not re-renderable
  from data (`site/editions/history.json` = star snapshots only).
- **Newsletter gotchas (each has cost money once):** (1) worker `/newsletter/send` has **no
  per-date dedup** — any 2nd same-day publish double-sends. (2) GitHub Actions ternary pitfall:
  `${{ cond && '' || secrets.X }}` returns the SECRET when skipping (`''` is falsy) — use an
  explicit flag env, never withhold a secret that way. (3) `retry-edition.yml` FOOTGUN: a FAILED
  manual run re-dispatches the DEFAULT Daily Edition (newsletter ON) up to 3×/day — if a
  `skip_newsletter` run fails, `gh run cancel` the retry immediately.
- **CSP forbids inline handlers.** Every template's CSP is `script-src 'self' 'unsafe-inline'`
  (the `'self'` is load-bearing — without it external `/chat.js` is browser-blocked and the fab
  dies site-wide). Wire controls with `addEventListener`; never `onclick=`.
- **`public/chat.js` is ES5 `var` style and NOT in the eslint glob** (`src/ worker/ test/` +
  root scripts). Match the style; hand-check.
- **`src/retrieve.js` and the worker's inlined copy must stay byte-identical** (the worker keeps
  it import-free for its string-compile test harness).
- **Cloudflare ignores `?query` cache-busters** — verify live with `curl -H "Cache-Control: no-cache"`.

## Repo orientation (files that matter now)
```
FLOW (Thread A)
  src/recency.js            windows 7/21/45, pickLeadIndex, leadHookAgeDays
  src/github.js             categorizeDiverseForSection: recency floor + fresh-first partition
  src/model-drops.js        HF model-drops FLOW source (selectModelDrops / fetchModelDrops)
  src/editorial.js          selectLeadCandidates, rankBreakoutCandidates, isVersionChurn
  src/prompts.js            editorialFramingDirective (evergreen-voice ban), chooseLeadPrompt
  src/ai-headlines.js       AI Wire (HN + arXiv) — Phase-2 promote to lead-eligible here
  src/render.js             renderModelDrops, renderAIWire, renderHybridArticle, renderChatUi
PRODUCT / PAYMENTS (Thread B)
  worker/index.js           accounts + Stripe + /chat + /admin/stats (KV, ~1242 lines)
  worker/wrangler.toml      env/secret NAMES, KV bindings, CHAT_MODEL, FREE_DAILY_CHAT_LIMIT=0
  src/build-corpus.js       data/corpus.json (RAG); src/retrieve.js = BM25+recency (KEEP IN SYNC w/ worker)
  src/economics.js          per-turn cost, margins, safe caps  (run: node src/economics.js)
  src/pricing.js            /pricing page ; templates/account.html = account UI
  public/chat.js            AI Desk client (ES5, unlinted; RAG citations, thinking, bookmarks)
  api-server.js + src/x402.js   agent REST API + x402 paywall (OFF: no X402_RECEIVER, nonce gate unmet)
  mcp-server.js             8 tools over stdio (unhosted, unmonetized)
DOCS
  docs/build-out-sheet.md   ★ Thread B plan (gap matrix, funnel-leak trace, P0/P1/P2 by domain)
  docs/first-conversion-sim.md   funnel assumptions the sheet quantifies from
  BUILDLOG.md               "how it felt to build" — Project Pulse is STALE (last real entry 06-22)
```

## Deploy state
- **main** (`2619aed` Layer 2 HF Model Drops) — pushed, clean tree except untracked planning
  docs/prompts + `scratch/`. Live site current through Layer 2.
- Worker deployed with the AI Desk moat + premium-gate live. **`ADMIN_TOKEN` still unset in prod**
  → funnel numbers unread (this is the Thread-B gate above).
- Uncommitted/untracked: `docs/build-out-sheet.md`, `prompts/*.md` (planning specs),
  `frontpage-*.html` (prototypes), `scratch/`, `test_resonance.py`. Planning artifacts, not code.

## Highest-EV next moves
1. **Thread B, P0-A (decisive):** set `ADMIN_TOKEN`, deploy, read `/admin/stats`. This grades the
   entire build-out sheet and tells you whether to keep building product or re-open demand.
2. **Thread A, Layer 2 Phase 2:** GitHub Releases firehose → make a model drop / release the actual
   front-page LEAD (article generator writes from an event, not a repo) → demote trending to a rail.
3. Wire the 06-27 goal-session batch out of code-complete into deployed (grace-clearing churn fix
   is the highest-value: it stops involuntary churn of recovered payers).

## Memory pointer
`~/.claude/projects/-Users-christopherharris-projects/memory/project_gittimes.md` (detailed session log).
