**Problem**

You are a fresh agent dropped into the Git Times repository. Audit the existing accounts, payments, security, services, and AI-integration surface of the product, build a gap matrix (what exists → what is missing → why that missing piece caps revenue), and convert that matrix into a single prioritized **build-out sheet** written to a new markdown file. This is a planning deliverable only — you are NOT implementing the build-out, NOT modifying the worker, and NOT writing a marketing plan. The sheet must be paste-ready for a fresh Claude Code "goal session" that will later drive the actual implementation.

**Context**

Git Times is an AI-generated newspaper for builders, live at gittimes.com. The owner (email mandalazenwave@gmail.com, already in config — not a secret) has **flat revenue**. Working with an assistant using `/falsify-first` reasoning, the owner falsified the obvious "we have a marketing problem" hypothesis and landed on a different falsifiable root-cause claim: **revenue is flat because the product side — accounts, payments, payment services, security, and AI integration — is underbuilt and "mid," NOT because of marketing.** The decision is made: stop all marketing thinking; drive a deep product / security / payments / accounts / services / AI build-out instead. Your sheet must explicitly embody three reasoning postures: `/pmarca` (Marc Andreessen builder/techno-optimist conviction — for each surface ask "what would the 10x version be"), `/plan-ceo-review` (10-star product thinking; challenge premises rather than accept the current shape), and `/falsify-first` (state the root-cause claim above as a named, falsifiable claim, and note what evidence in the code would confirm or refute it).

Stack reality (a stranger needs this): The newspaper itself is static HTML on GitHub Pages (`gh-pages` branch) fronted by Cloudflare. Everything dynamic — the AI Desk chat, accounts/auth, and payments — is a single **Cloudflare Worker** named `gittimes-chat` at `worker/index.js` (~1242 lines). There is **no SQL database**: all state is in **Cloudflare KV** (`USERS`, `SESSIONS`, `MAGIC_LINKS` namespaces). Accounts use **magic-link email via Resend** (routes `/auth/send-magic-link`, `/auth/verify`, `/auth/me`, `/auth/settings` GET/POST, `/auth/logout`, `/auth/delete-account`; sessions are Bearer tokens; magic tokens are single-use). Payments use **Stripe**: routes `/subscribe`, `/checkout` (Stripe Checkout Session, mode=subscription, $5/mo, `STRIPE_PRICE_AMOUNT=500`), a Stripe webhook handler (handles `customer.subscription.deleted`, `invoice.payment_failed`, with a 3-day grace period), `/billing/portal` (Stripe customer portal), `/pricing`, and `/admin/stats` (reports totalUsers, premiumUsers, estimatedMRR). Free tier = 3 AI chats/day (`FREE_DAILY_CHAT_LIMIT`); premium ≈ unlimited (1000/mo). AI: the `/chat` route is plan-gated and calls OpenRouter (`CHAT_MODEL=openai/gpt-4o-mini`) with a system prompt that injects live AI-model pricing context. Security already present: `verifyStripeSignature()`, `checkRateLimit()`, single-use magic tokens, Bearer session tokens; page CSP is `script-src 'self' 'unsafe-inline'`. Additional surfaces that may qualify as monetizable "services": `src/x402.js` (x402 paid-endpoint machinery), `mcp-server.js` (MCP server), `api-server.js`, `src/api-docs.js`, and newsletter send/unsubscribe inside the worker.

Known dead ends: marketing/distribution as the lever has already been falsified and is OUT OF SCOPE — do not propose it. none other yet.

**Inputs**

Repository root (cwd): `/Users/christopherharris/projects/gittimes`. Read these (all confirmed to exist) to ground every claim in real code — lead with evidence from `worker/index.js`:
- `/Users/christopherharris/projects/gittimes/worker/index.js` — accounts + payments + Stripe + chat backend (primary evidence source)
- `/Users/christopherharris/projects/gittimes/worker/wrangler.toml` — worker config: env var names, **secret NAMES**, KV bindings (read names only; never inline secret values)
- `/Users/christopherharris/projects/gittimes/src/account.js` — renders the account page
- `/Users/christopherharris/projects/gittimes/templates/account.html` — account page markup (login + Stripe flows)
- `/Users/christopherharris/projects/gittimes/src/db.js`
- `/Users/christopherharris/projects/gittimes/src/x402.js` — x402 paid-endpoint machinery
- `/Users/christopherharris/projects/gittimes/src/api-docs.js`
- `/Users/christopherharris/projects/gittimes/mcp-server.js`
- `/Users/christopherharris/projects/gittimes/api-server.js`
- `/Users/christopherharris/projects/gittimes/docs/first-conversion-sim.md`
- `/Users/christopherharris/projects/gittimes/CONTEXT.md`
- `/Users/christopherharris/projects/gittimes/BUILDLOG.md`
- `/Users/christopherharris/.claude/projects/-Users-christopherharris-projects/memory/project_gittimes.md` — project memory

Secrets: Stripe / Resend / OpenRouter secrets are set via `wrangler secret put` (names appear in `worker/wrangler.toml`); a local `.env` holds `GITHUB_TOKEN` / `OPENROUTER_API_KEY`. Reference these by location/name only. NEVER read out, inline, or transcribe any secret value.

Write your output to: `/Users/christopherharris/projects/gittimes/docs/build-out-sheet.md`.

**Constraints**

- This task produces a **planning sheet only**. Do NOT implement the build-out. Do NOT edit `worker/index.js` or any other source/config file. The ONLY file you create or modify is `/Users/christopherharris/projects/gittimes/docs/build-out-sheet.md`.
- Do NOT propose a marketing, growth, SEO, social, or distribution plan. That hypothesis is falsified and out of scope.
- Method must be **audit-first**: start by reading the real code and produce a **gap matrix** before the prioritized list. Every gap and every build-out item must be grounded in a **named file** (and ideally a route/function) you actually read — no generic best-practice items floating free of the codebase.
- Respect the deployed reality: accounts are **KV, not SQL** — do not propose work that silently assumes a relational DB without calling out the migration cost. Deploys are surgical (the worker and the static site deploy separately; a full publish triggers the newsletter) — flag anything that has deploy blast-radius. Keep the existing Stripe / $5-per-month subscription model UNLESS the sheet makes an explicit, reasoned argument to change it (e.g., usage-based, x402 micro-payments, tiers) — if it argues for a change, it must say why and at what cost.
- Never inline secret values anywhere in the sheet.
- Tone/posture inside the sheet: `/pmarca` conviction + `/plan-ceo-review` premise-challenging + `/falsify-first` discipline (named falsifiable root-cause claim with confirming/refuting evidence).

**Definition of done**

- A markdown file exists at `/Users/christopherharris/projects/gittimes/docs/build-out-sheet.md`.
- It opens with the **named falsifiable root-cause claim** verbatim in spirit: "Revenue is flat because accounts/payments/services are underbuilt, not because of marketing," followed by what code-evidence would confirm or refute it.
- It contains a **Gap Matrix** section: a table with columns roughly `Surface | What exists (file/route) | What's missing | Why it caps revenue`.
- It contains a **funnel-leak trace** of the money path — anonymous visitor → free account (magic-link) → free-chat-limit hit → Stripe checkout → premium → renewal / dunning / grace / churn — naming where revenue leaks at each hop and the expected impact of plugging each leak (quantify from `docs/first-conversion-sim.md` or the worker limits where the code lets you; state assumptions when you estimate).
- It contains six clearly headed build-out domain sections, each with these exact headings: **Product**, **Security**, **Payments**, **Accounts**, **Services**, **AI Integration**.
- Every build-out item is tagged **P0**, **P1**, or **P2**, and each item names the specific file (and where possible route/function) it touches.
- At least one item reflects `/pmarca` "10x version" thinking and at least one reflects a `/plan-ceo-review` premise challenge (e.g., questioning the $5 flat-sub model), with reasoning.
- The sheet is self-contained and paste-ready: a fresh Claude Code goal session could act on it with no access to this conversation.

**Verification**

Run these from `/Users/christopherharris/projects/gittimes`:
- `test -e docs/build-out-sheet.md && echo OK` → prints `OK`.
- `grep -ciE '## *(Product|Security|Payments|Accounts|Services|AI Integration)' docs/build-out-sheet.md` → returns `6` or more (all six domain headings present).
- `grep -cE '\b(P0|P1|P2)\b' docs/build-out-sheet.md` → returns a number ≥ 6 (items are priority-tagged).
- `grep -ni 'gap matrix' docs/build-out-sheet.md` → at least one hit (the matrix section exists).
- `grep -niE 'funnel|leak|churn|dunning' docs/build-out-sheet.md` → at least one hit (the funnel-leak trace is present).
- `grep -niE 'flat because|root.cause|falsifi' docs/build-out-sheet.md` → at least one hit (named falsifiable claim present).
- `grep -niE 'worker/index\.js|x402|mcp-server|wrangler' docs/build-out-sheet.md` → multiple hits (items grounded in real named files).
- `grep -niE 'marketing|SEO|social media|distribution' docs/build-out-sheet.md` → expected to be empty OR appear only in an explicit "out of scope" line; if it appears as a proposed action, the sheet FAILS.
- Manually confirm no secret values appear: `grep -niE 'sk_live|sk_test|re_[0-9a-z]|sk-or-' docs/build-out-sheet.md` → must return nothing.

<!-- prompt-out v1 -->
