# Activate the Git Times human product (Cloudflare Worker)

The Worker (`worker/index.js`) powers the reader product: magic-link accounts, $5/mo
Stripe premium, premium AI chat (OpenRouter), and newsletter. The code + CI are wired —
this is the credentialed activation. ~30–45 min, mostly account setup.

Already wired (no action): `deploy-worker.yml` auto-deploys on `worker/**` push via
`CF_API_TOKEN`; `daily-edition.yml` passes `CHAT_WORKER_URL` so editions render the chat;
`wrangler.toml` has the vars (incl. `CHAT_MODEL`) and KV bindings.

## 0. Accounts you need
- **Cloudflare** (free) — hosts the Worker + KV.
- **Stripe** — a $5/mo recurring price + a webhook.
- **Resend** — API key + a verified sending domain (for magic-link + billing emails).
- **OpenRouter** — reuse the existing key (already used for generation).

## 1. Cloudflare auth + KV namespaces
```bash
cd worker
npm i -g wrangler         # or use: npx wrangler ...
wrangler login            # browser OAuth (or export CLOUDFLARE_API_TOKEN=...)

# Create the 4 KV namespaces; paste each returned id into wrangler.toml,
# replacing the matching REPLACE_WITH_* placeholder.
wrangler kv namespace create SUBSCRIBERS
wrangler kv namespace create USERS
wrangler kv namespace create SESSIONS
wrangler kv namespace create MAGIC_LINKS
```
Edit `worker/wrangler.toml` so each `[[kv_namespaces]]` `id` is the real id (no
`REPLACE_WITH_*` left). Commit this change (CI needs the real ids).

## 2. Stripe — product, price, webhook
1. Stripe Dashboard → Products → create "Git Times Premium" → recurring **$5/month** →
   copy the **price id** (`price_...`) → this is `STRIPE_PRICE_ID`.
2. Developers → API keys → copy the **secret key** (`sk_live_...` or `sk_test_...`) →
   `STRIPE_SECRET_KEY`.
3. Developers → Webhooks → add endpoint `https://<your-worker-url>/stripe/webhook`
   (you'll have the URL after step 4; come back). Subscribe to events:
   `checkout.session.completed`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Copy the **signing secret** (`whsec_...`) →
   `STRIPE_WEBHOOK_SECRET`.

## 3. Resend
- Create an API key → `RESEND_API_KEY`. Verify a sending domain (e.g. `gittimes.com`) so
  magic-link/billing emails aren't spam-filtered. Confirm the From address in
  `worker/index.js` (`sendMagicLinkEmail`) matches the verified domain.

## 4. Secrets + first deploy
```bash
cd worker
# Random values for the two we mint ourselves:
wrangler secret put NEWSLETTER_SECRET     # paste: openssl rand -hex 32
wrangler secret put ADMIN_TOKEN           # paste: openssl rand -hex 32
wrangler secret put OPENROUTER_API_KEY    # the existing OpenRouter key
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_PRICE_ID
wrangler secret put RESEND_API_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET  # after step 2.3
wrangler deploy                            # prints the workers.dev URL
```
The printed URL (e.g. `https://gittimes-chat.<subdomain>.workers.dev`) is your
**worker URL**. Go finish the Stripe webhook (step 2.3) against it, then
`wrangler secret put STRIPE_WEBHOOK_SECRET` and `wrangler deploy` again.

(Secrets persist across deploys, so the CI `wrangler deploy` on future `worker/**`
pushes won't disturb them.)

## 5. Wire the site to the worker
Add two GitHub repo secrets (Settings → Secrets and variables → Actions):
- `CF_API_TOKEN` — a Cloudflare API token with **Workers Scripts: Edit** (lets CI
  auto-deploy the Worker on push).
- `CHAT_WORKER_URL` — the worker URL from step 4 (no trailing slash).

Then trigger the edition so the public site renders the chat + account links:
```bash
gh workflow run daily-edition.yml
```

## 6. Before charging (premium chat quality)
Switch the chat off the free model in `worker/wrangler.toml`:
`CHAT_MODEL = "<a paid OpenRouter model>"`, then `wrangler deploy`. The free Nemotron
rate-limits and makes a poor paid experience.

## 7. Verify (see deploy/worker-preflight.sh)
```bash
WORKER=https://<your-worker-url> bash deploy/worker-preflight.sh
```
Manual smoke: visit `/account/`, send a magic link (email arrives), sign in, click
"Upgrade to Premium" (Stripe test card `4242 4242 4242 4242`), then open an edition →
chat FAB → "Ask about this" on a story → premium chat streams a reply.

## Notes
- `ALLOWED_ORIGIN` is already `https://gittimes.com` (CORS). If you serve editions from
  another origin, update it in `wrangler.toml`.
- Custom domain (`chat.gittimes.com`) is optional and requires the zone on Cloudflare;
  the `workers.dev` URL works fine as `CHAT_WORKER_URL`.
