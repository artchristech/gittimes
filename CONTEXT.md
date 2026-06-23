# Git Times — working context

AI-generated newspaper for builders, live at **gittimes.com** (GitHub Pages / gh-pages).
Daily editions are generated on OpenRouter and published by CI. On top of that sits the
**human product** (live): an interactive AI chat on every edition, magic-link reader
accounts, and $5/mo Stripe premium — all served by a Cloudflare Worker. There's also an
**x402-paid agent API** on the VPS (paywall currently OFF). Everything works end-to-end
**except one task**: switching Stripe from TEST to LIVE keys (see "Current task").

## Repo orientation
```
worker/
  index.js          ★ Cloudflare Worker: magic-link auth, sessions(KV), Stripe checkout/
                      webhook, premium streaming /chat (OpenRouter), newsletter, admin.
                      Deployed at gittimes-chat.mandalazenwave.workers.dev
  wrangler.toml     ★ KV namespace ids (committed), [vars] incl CHAT_MODEL=openai/gpt-4o-mini
api-server.js       ★ zero-dep agent REST API; paid endpoints gated by src/x402.js
src/
  x402.js           ★ x402 paywall (402 + on-chain USDC verify + replay). Paywall OFF (no X402_RECEIVER)
  xai.js            LLM client (OpenRouter despite the name); article generation
  render.js         ★ edition HTML; renderHybridArticle has the "Ask about this" button
  db.js             SQLite (better-sqlite3); busy_timeout=5000; x402_payments table
  star-history.js   ⚠ require-cycle: graphqlRequest lazy-required inside fetchStarTrajectory
public/chat.js      ★ in-page chat client: per-article scope, .hybrid-* context
deploy/             runbooks + systemd units (WORKER_DEPLOY.md, DEPLOY.md, worker-preflight.sh)
.github/workflows/  daily-edition.yml (cron+CHAT_WORKER_URL), deploy-worker.yml (skips w/o CF_API_TOKEN)
```

## How it runs
- **Daily edition:** `daily-edition.yml` (07:00 UTC) runs `publish-edition.js` on OpenRouter,
  publishes `./site` → gh-pages → gittimes.com. `CHAT_WORKER_URL` secret makes editions render the chat.
- **Reader/login/premium:** the Worker. `/auth/send-magic-link` → Resend email → `/auth/verify`
  writes a session (SESSIONS KV) → `/checkout` (Stripe) → webhook flips user to premium →
  `/chat` (premium-gated, streams from OpenRouter `gpt-4o-mini`).
- **Deploys:** Worker deployed manually via authed `wrangler` (account `mandalazenwave@gmail.com`).

## Load-bearing facts
1. **Stripe is on TEST keys.** Dedicated **gittimes** Stripe account. Test price
   `price_1TlBsGI6eZn2boxAYsShv4zu` + a test webhook exist. Go-live = create LIVE-mode
   price + webhook (test ones stay for test mode) and set live secrets. The webhook sig
   verify in `worker/index.js:164 verifyStripeSignature` is correct — don't touch it.
2. **Email domain is verified.** `gittimes.com` verified in Resend (DKIM+SPF in Cloudflare).
   `EMAIL_FROM=noreply@gittimes.com` (worker secret). Reader login works for any email.
   Resend key is **send-only** (can't manage domains via API).
3. **KV CLI defaults to LOCAL.** `wrangler kv key ...` needs `--remote` to touch the
   deployed worker's KV. (Cost an hour of false "auth fails" — always use `--remote`.)
4. **Worker deploys via wrangler OAuth, not a token.** That OAuth can read the Cloudflare
   zone but **cannot write DNS** — DNS writes need the `cfut_…` API token. `deploy-worker.yml`
   CI skips gracefully unless `CF_API_TOKEN` repo secret is set.
5. **x402 agent API paywall is OFF** (no `X402_RECEIVER`) and bound to 127.0.0.1 on the VPS.
   Before monetizing it: nonce-binding + nginx rate-limit + DNS (`deploy/x402-hardening-prompt.md`).
6. **Cloudflare zone** `gittimes.com` = `6621de9204d4b729451b83523c509c78`.

## Account tiers / economics (2026-06-23)
- **Anonymous:** read the paper; AI chat shows a "Sign in — it's free" paywall.
- **Free account (magic link):** `FREE_DAILY_CHAT_LIMIT` AI questions/day (default 3) — the conversion funnel. At gpt-4o-mini rates (~$0.001–0.003/turn) ≈ <$0.30/mo per free user.
- **Premium ($5/mo):** effectively unlimited chat (`CHAT_MONTHLY_LIMIT` default 1000 = abuse ceiling, not a product limit). Worker `/chat` meters free=daily, premium=monthly.
- AI desk now has live model-price context: publish writes `site/data/models.json`; worker `buildSystemPrompt` fetches it (6h cache) so the assistant answers pricing/model-choice questions. Chat replies render Markdown client-side (`public/chat.js`), with starter chips + "AI Desk" branding.

## Current tunables
- `CHAT_MODEL=openai/gpt-4o-mini` (worker/wrangler.toml) · `CHAT_MONTHLY_LIMIT=1000` · `FREE_DAILY_CHAT_LIMIT=3` · `STRIPE_PRICE_AMOUNT=500` ($5)
- Markets: `sync-models.js` now persists the full priced `catalog` (310 models) into `data/ai-models.json`; runs in BOTH `sync-models.yml` (5 AM) and `daily-edition.yml` (pre-publish). Fixed the bug where `getFullMarketData()` returned null on a healthy sync, silently dropping "All Models by Provider" from the live page.
- Worker URL: `https://gittimes-chat.mandalazenwave.workers.dev`
- KV ids: SUBSCRIBERS `a775f46…900` · USERS `8c879cc…f70` · SESSIONS `c3bdb4f…2ae` · MAGIC_LINKS `04e8c06…3e`

## Current task — flip Stripe to LIVE (option B: user pastes `sk_live_…`, I do it, user rotates after)
1. Receive `sk_live_…`. With it, via Stripe API:
   - `POST https://api.stripe.com/v1/prices` `unit_amount=500 currency=usd recurring[interval]=month product_data[name]="Git Times Premium"` → live `price_…`
   - `POST https://api.stripe.com/v1/webhook_endpoints` `url=https://gittimes-chat.mandalazenwave.workers.dev/stripe/webhook` `enabled_events[]=checkout.session.completed` `…=customer.subscription.deleted` `…=invoice.payment_failed` → `secret` (live `whsec_…`)
2. `cd worker` → `wrangler secret put STRIPE_SECRET_KEY` (sk_live), `STRIPE_PRICE_ID` (live price), `STRIPE_WEBHOOK_SECRET` (live whsec) → `wrangler deploy`.
3. **Verify (must be true after):** `curl …/pricing` → `{"ok":true,"display":"$5/month"}` (200); the live webhook shows in Stripe; a test premium `/chat` still streams (use `--remote` KV for any test session).
4. Tell the user to **rotate** `sk_live` + the four transcript-exposed creds.

## Out of scope (resist)
- Do NOT monetize the x402 agent API yet (needs nonce-binding + rate-limit + DNS first).
- Do NOT rename `src/xai.js`. Do NOT touch `verifyStripeSignature`. Do NOT enable x402 `X402_RECEIVER`.
- No new features — the only goal is real-money Stripe go-live.

## Memory
`~/.claude/projects/-Users-christopherharris-projects/memory/project_gittimes.md`
