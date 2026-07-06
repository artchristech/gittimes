# Git Times — Product / Payments / Security / Accounts / Services / AI Build-Out Sheet

_Planning deliverable. Audit-first. Paste-ready for a fresh Claude Code goal session._
_Authored 2026-06-27 against the live code in `worker/index.js`, `worker/wrangler.toml`, `src/x402.js`, `api-server.js`, `mcp-server.js`, `src/db.js`, `templates/account.html`._

> **This is a plan, not an implementation.** A later goal session executes it. The owner's email (`mandalazenwave@gmail.com`) is already in `worker/wrangler.toml` as `ALERT_EMAIL` — it is config, not a secret. **No secret VALUES appear in this sheet; secrets are referenced by NAME only** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `NEWSLETTER_SECRET`, `ADMIN_TOKEN`, set via `wrangler secret put`).

---

## Execution status — goal session 2026-06-27

Code-complete + tested (551 tests green, lint clean) in `worker/index.js`, `worker/wrangler.toml`, `templates/account.html`, `test/worker.test.js`. **Not yet deployed** — see owner actions below.

| Item | Domain | Status |
|---|---|---|
| Grace-clearing churn fix (`invoice.payment_succeeded`/`paid`) | Security/Payments P0 | ✅ code+tests |
| Funnel counters (`wallHits`, `anonAsks`) + comp detection + truthful MRR | Product P0-A | ✅ code+tests |
| Account-page usage cap (`/auth/me` `chatLimit`, kill hardcoded `/100`) | Product P1 | ✅ code+tests |
| Rate-limit `/chat` (30/min) + `/subscribe` (5/15min) per IP | Security P1 | ✅ code+tests |
| Disposable-email gate (both account-creation paths) | Security P1 | ✅ code+tests |
| Reconciliation cron sweep + fix `resolveGracePeriod` stat drift | Accounts P1 | ✅ code+tests |
| Win-back email on paid churn | Payments P2 | ✅ code+tests |
| Annual SKU checkout lane (`?interval=annual`, monthly fallback) | Payments P1 | ✅ code+tests |
| Server-side transcript memory + `/chat/history` + GDPR delete | AI Integration P1 | ✅ code+tests |
| Pin chat model so dropped env can't downgrade to free | AI Integration P2 | ✅ code+tests |
| **Set `ADMIN_TOKEN`; `wrangler deploy`; surgical gh-pages for account.html; one-time `stats:totalUsers` reset to backfill comps** | — | ⛔ **owner action** (secrets/deploy) |
| AI Desk archive-as-tools (the moat) | AI Integration P0 | ⬜ large — needs hosted `api-server.js` + publish-time KV index + function-calling loop |
| x402 nonce-binding → turn on agent API | Security P2 / Services P1 | ⬜ needs EIP-3009/facilitator (fails closed today; do not half-build) |
| Host remote MCP; bundle API key on upgrade | Services P2 | ⬜ infra + cross-system |
| Passkey/WebAuthn fallback; GitHub connect; KV→D1 spike | Accounts P0–P2 | ⬜ large / infra |
| HttpOnly-cookie sessions; pre-wall value teaser | Security/Product P2 | ⬜ deferred (cross-origin cost / honesty-coupled to moat) |

---

## 0. Named falsifiable root-cause claim (`/falsify-first`)

**CLAIM `GT-FLAT`:** _Revenue is flat because the product surfaces — accounts, payments, payment services, security, and AI integration — are underbuilt and "mid," NOT because of marketing or top-of-funnel demand._

This is the operating hypothesis. The corollary marketing/demand hypothesis has already been falsified upstream and is **out of scope** (no growth, SEO, social, or distribution work is proposed below; the only mention of those words in this sheet is this sentence).

### What code-evidence would CONFIRM `GT-FLAT`

- **The owner is flying blind, by construction.** `/admin/stats` (`worker/index.js:1188`) is gated on `Bearer ${env.ADMIN_TOKEN}`, and `ADMIN_TOKEN` is **not set in the deployed worker** (`worker/.dev.vars` holds only the placeholder `dev_admin`). The single number that proves or disproves "we have paying customers" — `premiumUsers` / `estimatedMRR` — is literally unreadable today. A product whose own builder cannot see its conversions is underbuilt. _(first-conversion-sim.md tenet 3 names this "the #1 blocker.")_
- **A confirmed retention bug silently churns payers.** `invoice.payment_failed` sets `gracePeriodEndsAt` (`worker/index.js:755`), and `resolveGracePeriod()` (`worker/index.js:215`) downgrades to `free` once it expires — but **there is no `invoice.payment_succeeded` / `invoice.paid` handler** to CLEAR the grace flag after Stripe Smart Retries recovers the card. Net: a customer whose retry succeeds keeps getting billed by Stripe yet is flipped to `free` in-app after 3 days. That is involuntary churn manufactured by the code.
- **The premium product is a commodity.** `/chat` (`worker/index.js:785`) is `gpt-4o-mini` (`wrangler.toml:18`) with a static pricing block + client-supplied article text. The proprietary archive — trending velocity, coverage history, star trajectories, all already queryable in `mcp-server.js` / `api-server.js` / `src/db.js` — is **not wired into the chat**. The $5 wall gates "ChatGPT with no memory and no tools," so willingness-to-pay is structurally weak.
- **Two built revenue lines sit at $0.** The x402 agent API (`api-server.js` + `src/x402.js`) has its paywall **OFF** (no `X402_RECEIVER`, nonce-binding gate unmet, no public DNS), and the MCP server (`mcp-server.js`) is stdio-only, unhosted, and unmonetized.

### What code-evidence would REFUTE `GT-FLAT` (and re-open the demand question)

- If, once `ADMIN_TOKEN` is set, `/admin/stats` shows **thousands of `totalUsers`** AND a large share of free users have `freeChatUsage.count >= FREE_DAILY_CHAT_LIMIT` (i.e. they hit the 3/day wall, `worker/index.js:862`) yet `premiumUsers` stays near zero → demand IS arriving and converting poorly → still a product problem (confirms `GT-FLAT`).
- But if `totalUsers` is **tiny** (say < 100) and almost no free user ever reaches the wall (`freeChatUsage.count` rarely equals the limit) → the binding constraint is top-of-funnel volume, which would **refute `GT-FLAT`** and resurrect the (out-of-scope) demand hypothesis.

> **Therefore the first build-out item (P0-A below) is simultaneously the fix AND the experiment that grades this entire sheet.** Set `ADMIN_TOKEN`, ship a funnel-counter, read the numbers. Do this before anything else.

---

## 1. Gap Matrix

| Surface | What exists (file / route) | What's missing | Why it caps revenue |
|---|---|---|---|
| **Observability** | `/admin/stats` `worker/index.js:1188`; `incrementStat` counters `:68` | `ADMIN_TOKEN` unset in prod → 401; no funnel telemetry (wall-hit count, anon→signup, comps-vs-paid split); no conversion alert is on (`ALERT_EMAIL` set but only fires on `checkout.session.completed`) | You cannot optimize a funnel you cannot see; you cannot tell if `GT-FLAT` is true |
| **Dunning / renewal** | `invoice.payment_failed` + 3-day grace `worker/index.js:755`; `resolveGracePeriod` `:215` | No `invoice.payment_succeeded`/`invoice.paid` handler to clear grace; no renewal receipt; no win-back on `customer.subscription.deleted` | Recovered payers get downgraded → silent churn; no recovery loop on the leakiest hop |
| **Pricing model** | Single flat $5/mo `STRIPE_PRICE_AMOUNT=500`; `/checkout` `:625`; `/pricing` `:1165` | No annual, no team/seats, no higher "Pro" tier, no usage-based; `estimatedMRR` counts comps (CPHnews 100%-off) as revenue | ARPU hard-capped at $5; high-value users (agents, teams) have no way to pay more; MRR metric is inflated/untrustworthy |
| **AI Desk (premium core)** | `/chat` → OpenRouter `gpt-4o-mini` `worker/index.js:785`; `buildSystemPrompt` pricing block `:35` | No tool-use / retrieval over the archive (`mcp-server.js` tools + `src/db.js` not exposed to chat); no server-side transcript memory; in-file default model is a free, rate-limited model `:3` | The thing readers pay for is undifferentiated from free ChatGPT → low conversion + churn-back |
| **Agent API (service)** | `api-server.js` (8 routes), x402 gate `src/x402.js`, replay table `src/db.js:90` | Paywall OFF (no `X402_RECEIVER`); payment not bound to a server-minted nonce (documented hard gate `src/x402.js:203`); no public DNS / nginx rate-limit | A complete, agent-facing revenue line earns $0 |
| **MCP server (service)** | `mcp-server.js`, 8 tools over stdio | Not hosted as a remote MCP; no auth, no metering, no payment | A ready agent-facing surface monetizes nothing |
| **Accounts** | Magic-link `worker/index.js:310`/`:400`; Bearer sessions in `SESSIONS` KV; `/auth/me`,`/auth/settings`,`/auth/logout`,`/auth/delete-account` | Magic-link is the ONLY auth path (no passkey/password fallback); no multi-session mgmt; no profile / GitHub connect; KV-only → no cohort/retention queries without full scans | Resend outage = nobody can sign in or convert (single point of failure on the money path); no segmentation to target upsells |
| **Security** | `verifyStripeSignature` `:249`, `checkRateLimit` `:239`, single-use magic tokens, CORS lock `:294`, webhook idempotency `:689` | Rate-limit only on magic-link (none on `/chat`, `/subscribe`, `/checkout`); session token in `localStorage` under CSP `unsafe-inline`; no disposable-email/CAPTCHA gate; nonce-binding for x402 unmet | Abuse inflates user counts (poisoning the falsification metric) and burns OpenRouter spend; XSS could lift sessions |
| **Account page UX** | `templates/account.html` magic-link + Stripe flows | Premium usage row hardcodes `/ 100 this month` (`account.html:194`) while real cap is `CHAT_MONTHLY_LIMIT=1000`; no annual/tier choice; no receipts/invoices view | Wrong numbers erode trust at the exact moment of upgrade |

---

## 2. Funnel-leak trace (the money path)

Trace from anonymous visitor to renewal. Known limits are real (`wrangler.toml`); conversion **rates are assumptions** (no analytics exist — see P0-A) flagged `[assume]`. Plug-impact is the expected lift from closing that leak.

| Hop | Code path | Leak | Why it leaks | Plug → expected impact |
|---|---|---|---|---|
| 1. Anon reads edition | gh-pages static + `renderChatUi` | Most visitors never try the AI Desk | Chat is a corner FAB; value isn't shown before sign-in wall | Out of scope guard: this is UX, not the named root cause — keep as P2 |
| 2. Anon asks a question | `POST /chat` no auth → `400` `worker/index.js:881` | 100% of anon askers bounce to a sign-in ask | Hard wall with zero free anonymous taste | Allow 1 anonymous answer per IP (rate-limited) before the email wall → warms the lead. `[assume]` anon→signup ~2-5% |
| 3. Signs up (magic-link) | `/auth/send-magic-link` → `/auth/verify` `:310/:400` | Email never arrives / Resend down → dead end, no fallback | Magic-link is the sole auth path; Resend is a single point of failure | Add passkey OR fallback code; instrument send failures (already 502s `:386`). `[assume]` plugging email deliverability lifts signups several % |
| 4. Uses 3 free chats | `freeChatUsage` `:857` | If chats are weak/generic, user never values premium | Commodity model, no archive tools (see AI Integration) | Wire archive tools into chat → the taste is differentiated → higher intent at the wall |
| 5. **Hits the wall (4th chat)** | `429 {upgrade:true}` `:862` | No telemetry proves anyone reaches it | `FREE_DAILY_CHAT_LIMIT=3`; wall-hit count is uncounted | Count wall-hits (P0-A). This is the **central falsification datum** for `GT-FLAT` |
| 6. Clicks upgrade → checkout | `GET /checkout?session_token` `:625` → Stripe | Anon/expired session → `login_required` redirect | Requires a live session token | Already frictionless; keep. Add annual option here (Payments P1) |
| 7. Pays $5 | Stripe hosted page | Card friction / single price | Only one SKU; no annual to capture committed users | Offer $50/yr at checkout → upfront cash + lower churn |
| 8. Webhook flips to premium | `checkout.session.completed` `:699` | Comp (CPHnews 100%-off) counts as a conversion | `estimatedMRR` = count × $5 ignores comps `:1228` | Tag comped vs paid; report true paid-MRR → trustworthy metric |
| 9. **Renewal / dunning / grace** | `invoice.payment_failed` 3-day grace `:755`; `resolveGracePeriod` `:215` | **Recovered payment is never un-graced → payer downgraded while still billed** | No `invoice.payment_succeeded` handler | **P0 fix.** Stops manufactured involuntary churn — the single highest-confidence revenue leak in the codebase |
| 10. **Churn** | `customer.subscription.deleted` `:728` | No win-back, no cancel-reason capture | Handler just flips to `free` | Capture reason in portal; send a win-back. `[assume]` win-back recovers a few % of churned MRR |

**Order of impact:** Hop 9 (confirmed bug, retains existing payers) and Hop 5 instrumentation (Hop 8 truthful MRR) come first — you must *retain* and *see* before you *optimize*. Then Hop 4 (differentiate the product) and Hop 7 (raise ARPU).

---

## 3. Build-out — six domains

Each item is `[P0|P1|P2]`, names its file/route, and is grounded in the audit above.
Deploy blast-radius is flagged where it matters. **Reminder: a full `publish-edition.js` run regenerates LLM editorial content AND re-sends the newsletter — never use it for worker/UI changes.** Worker changes deploy via `wrangler deploy` (independent of gh-pages). Account-page changes (`templates/account.html`) must ship to gh-pages SURGICALLY (worktree transform), not via full publish.

### Product

- **[P0] `GT-FLAT` instrument: funnel-counter + truthful MRR.** _(this is item P0-A, the falsification experiment.)_ Set the `ADMIN_TOKEN` secret in prod; extend `/admin/stats` (`worker/index.js:1188`) to also report wall-hit count, anon-ask count, and paid-vs-comped premium split. Add `incrementStat` calls (`:68`) at the wall (`:862`) and on comp detection in the webhook (`:699`). Deploy: `wrangler deploy` only. **Until this lands, every other priority is a guess.**
- **[P1] Fix the account-page usage display.** `templates/account.html:194` hardcodes `/ 100 this month`; real cap is `CHAT_MONTHLY_LIMIT=1000` (`wrangler.toml:11`). Pull the cap from `/auth/me` or `/pricing`. Surgical gh-pages deploy. Blast-radius: account page only.
- **[P2] Show value before the wall.** Render a one-line "what the AI Desk can do" teaser in `renderChatUi` so anon visitors see the differentiated value pre-signup. Source change in `src/render.js`; surgical gh-pages deploy.

### Security

- **[P0] Close the grace-clearing hole (also a Payments bug).** Add an `invoice.payment_succeeded` / `invoice.paid` branch to the webhook (`worker/index.js:728`-`782` block) that deletes `gracePeriodEndsAt`. Without it, `resolveGracePeriod` (`:215`) downgrades paying customers. This is the highest-confidence fix on the sheet. `wrangler deploy`.
- **[P1] Rate-limit the expensive + abusable routes.** `checkRateLimit` (`:239`) is only on `/auth/send-magic-link`. Add per-IP limits to `/chat` (`:785`, caps OpenRouter burn and multi-account farming) and `/subscribe` (`:569`). Reuse the existing helper + `MAGIC_LINKS` KV.
- **[P1] Disposable-email / abuse gate on account creation.** No filter today (`:324` is a format regex only) → comp abuse and fake users poison the very metric P0-A reads. Add a disposable-domain denylist + optional turnstile before `USERS.put`.
- **[P2] Harden session storage.** Sessions live in `localStorage` (`templates/account.html:113`) under CSP `script-src 'unsafe-inline'` — XSS-exfiltratable. Consider tightening CSP and/or moving the session to an `HttpOnly` cookie (note: cross-origin worker↔gh-pages makes cookies non-trivial — call out the SameSite/domain cost before committing).
- **[P2] Land x402 nonce-binding before any paywall flip.** `src/x402.js:203` documents that payment is matched by "a recent USDC transfer to the receiver," not bound to a server-minted nonce. This is a hard gate the Services items depend on — do not enable `X402_RECEIVER` until it's fixed.

### Payments

- **[P0] (same fix as Security P0)** `invoice.payment_succeeded` handler clears grace + optionally emails a receipt via the existing Resend pattern (`sendPaymentFailedEmail` `:156` is the template to mirror).
- **[P1] Truthful MRR: separate comped from paid.** `estimatedMRR = premiumUsers × $5` (`:1228`) counts CPHnews 100%-off comps as revenue. Stamp `user.comped = true` when the checkout/subscription has a 100%-off discount, exclude from `premiumUsers` MRR math, report both counts. `wrangler deploy`.
- **[P1] `/plan-ceo-review` premise challenge — break the flat-$5 ceiling.** _See §4. Add an annual SKU (`$50/yr`) and a higher "Desk Pro" tier_; both are new `STRIPE_PRICE_ID`s + `/checkout` already parameterizes the price line (`:637`). Cost: a second/third price object, pricing-page UX (`templates/account.html`), and webhook logic that maps price→plan. Keep $5/mo as the floor.
- **[P2] Win-back + cancel-reason capture.** On `customer.subscription.deleted` (`:728`) send a win-back email (mirror `sendUpgradeEmail` `:173`); configure the Stripe billing portal (`/billing/portal` `:1126`) to collect a cancellation reason.

### Accounts

- **[P0/P1] Remove the single-point-of-failure on the money path.** Magic-link (`:310`) is the ONLY way in; a Resend outage (`RESEND_API_KEY`) means **no one can sign in or convert**. Add a fallback: passkey/WebAuthn, or a one-time numeric code shown on a secondary channel. Tag P0 if P0-A reveals signups exist but conversion stalls at sign-in; P1 otherwise.
- **[P1] Premium-user reconciliation sweeper.** `resolveGracePeriod` (`:215`) only runs lazily on `/auth/me` and `/chat`; a user who never returns is never reconciled. Add a Cloudflare Cron trigger (new `wrangler.toml` `[triggers]` block) that scans grace/expiry and reconciles. Note: KV has no secondary index, so this is a full `USERS.list` scan — acceptable at current scale, but see the D1 note below.
- **[P2] Account enrichment for personalization + AI Desk.** No display name / GitHub connect today (`USERS` record = email, plan, `readerSettings`, newsletter pref). Adding "connect GitHub" enriches both targeting and the chat (the AI Desk could reason about the reader's own stack). Touches `worker/index.js` auth routes + `templates/account.html`.
- **[P2] KV→D1 migration evaluation (do NOT silently assume SQL).** Cohort/retention/"list premium users" queries are impossible on KV without O(n) scans (`/admin/stats` already does a fallback full scan `:1200`). Cloudflare D1 (SQLite) is the natural path and would unlock real analytics, but it is a **real migration**: re-key `USERS`/`SESSIONS`/`SUBSCRIBERS`, a dual-write window, and rewriting every `env.USERS.get/put`. Scope it as a spike before committing; the worker's own `src/db.js` (better-sqlite3) is the local-side analogue but does NOT run in the Worker runtime.

### Services

- **[P1] Turn on the x402 agent API (after Security P2 nonce-binding).** `api-server.js` + `src/x402.js` are complete and tested; the paywall is OFF only because `X402_RECEIVER` is unset. Steps: land nonce-binding (`src/x402.js:203`), set a **gittimes-specific** receiver wallet (memory says do NOT reuse Glyph's), add the nginx `limit_req` vhost noted in BUILDLOG, and bind public DNS `api.gittimes.com`. This is a built revenue line currently at $0.
- **[P2] Host the MCP server as a remote, metered MCP.** `mcp-server.js` is stdio-only and free. Wrap it as a hosted/remote MCP with auth + per-call metering (it already exposes 8 high-value tools over the same `src/db.js` data the API paywalls). Pairs naturally with the "Desk Pro" tier (API + MCP access bundled).
- **[P2] Bundle API/MCP access into the premium account.** Today the human product (worker/KV/Stripe) and the agent product (api-server/SQLite/x402) are entirely separate auth worlds. A "Desk Pro" subscriber should get an API key. Bridge: issue an API key on premium upgrade in the webhook (`:699`) and have `api-server.js` accept it as an alternative to x402. Flag: cross-system, two databases — design before building.

### AI Integration

- **[P0] `/pmarca` 10x version — make the AI Desk an agent over Git Times' own data.** Right now `/chat` (`worker/index.js:785`) sends `gpt-4o-mini` a static pricing block (`buildSystemPrompt` `:35`) + client article text — a generic wrapper. **The 10x version:** expose the archive as tools/retrieval to the chat — trending velocity, "has repo X been featured," star trajectories, edition history — the exact data already in `mcp-server.js` and `src/db.js`. Since the Worker can't run better-sqlite3, route these as tool-calls to the (to-be-hosted) `api-server.js` endpoints, or mirror a compact index into KV. This converts the premium product from "ChatGPT with a wall" into "the only assistant that knows what builders shipped this week" — the moat that justifies $5 and a Pro tier. Touches `buildSystemPrompt` + `/chat` (function-calling loop) in `worker/index.js`, plus the Services API.
- **[P1] Server-side transcript memory.** Conversations are in-memory client-side only (`history_msgs`, lost on navigation — per project memory I3). Persist per-user transcripts to KV keyed by session so the AI Desk has continuity. Touches `worker/index.js` `/chat` + a new `/chat/history` route + `public/chat.js`.
- **[P2] Pin the chat model defensively.** `worker/index.js:3` defaults `CHAT_MODEL` to a free, rate-limited model (`nvidia/nemotron-...:free`); only `wrangler.toml:18` makes it the paid `gpt-4o-mini`. If that var is ever dropped, paid chat silently degrades to a rate-limited free model. Make the in-file default the paid model (or fail loud). One-line change.

---

## 4. `/plan-ceo-review` premise challenge — is flat $5/mo the right shape?

**Premise being challenged:** "one $5/mo subscription is the business." Held as-is, ARPU is capped at $5 forever and the highest-value users (autonomous agents, teams, power users) have **no way to give you more money** — they either pay $5 or nothing. That is a self-imposed revenue ceiling, not a market fact.

**Reasoned change (keep $5/mo as the floor, add three lanes):**
1. **Annual $50/yr** — upfront cash, ~17% discount, materially lower churn. Cost: one Stripe price; `/checkout` (`worker/index.js:637`) already takes the price as a param.
2. **"Desk Pro" higher tier** — the data-tool AI Desk (AI Integration P0) + API/MCP access (Services) bundled. This is where the moat is priced. Cost: a price object + price→plan mapping in the webhook (`:699`).
3. **x402 per-call for agents** — the agent audience does not want a monthly sub; it wants to pay per query. The machinery exists (`src/x402.js`), it is OFF. Cost: the nonce-binding gate (Security P2).

**Why this is not scope-creep:** every lane reuses primitives already in the repo (Stripe checkout param, the x402 module, the MCP tools). The premise challenge is not "build more product" — it is "stop leaving the high-value willingness-to-pay unpriced." **Cost of being wrong:** a multi-price webhook is more state to get right; mitigate by shipping annual first (lowest-risk, same plan flag) and gating Pro behind the AI-Integration P0 actually landing.

---

## 5. Sequencing (what a goal session should do first)

1. **P0-A observability** (Product) — set `ADMIN_TOKEN`, ship the funnel-counter, **read the numbers**. This grades `GT-FLAT`. _(If it refutes `GT-FLAT`, stop and escalate — the rest of this sheet is predicated on the product being the constraint.)_
2. **P0 grace-clearing fix** (Security/Payments) — stop manufactured churn. Highest-confidence, smallest diff.
3. **AI Integration P0** — wire the archive into the chat (the moat). This is the lever that makes everything downstream (Pro tier, retention) worth pricing.
4. Then: truthful MRR, rate-limits, annual SKU, then Services activation.

## Out of scope (do not propose)

- Marketing, growth, SEO, social, or distribution work — the demand hypothesis is falsified; this sheet is product/security/payments/accounts/services/AI only.
- The AI Desk chat-_window_ redesign (dock/fullscreen) tracked separately in `docs/ai-desk-critique.md` / `CONTEXT.md` — that is a UX track, orthogonal to revenue mechanics.
- Merging `feat/editor-in-chief-v2` (PR #4) — independent editorial track.
