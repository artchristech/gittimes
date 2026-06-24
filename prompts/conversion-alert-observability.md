**Problem**

The Git Times Stripe webhook (a live, money-handling Cloudflare Worker) flips users free→premium but emits no signal to the owner when a conversion fires — the admin/stats page is locked, so the first organic $5/mo conversion would pass silently. Add an owner-alert email on each free→premium conversion. Because this code path processes REAL Stripe LIVE money, the alert must be a strictly additive, non-fatal, env-gated side effect: it must never change the webhook's signature verification, idempotency, premium-flip, or 200-response behavior, and must never leak secrets.

**Context**

You are a fresh agent with zero prior context. Git Times is an AI newspaper at gittimes.com; its payments backend is a single plain-JS, zero-dependency Cloudflare Worker (no TypeScript, no build step) at `worker/index.js`. The Stripe webhook handler in that file: (1) verifies the Stripe signature via a helper `verifyStripeSignature` (HMAC-SHA256 + 5-minute replay window + timing-safe compare — this is correct and MUST NOT be touched), (2) enforces an idempotency guard keyed on the Stripe event id so a replayed event is a no-op, and (3) in the `checkout.session.completed` branch (around lines 624–648) flips the user to premium, increments a `stats:premiumUsers` counter, and calls `await sendUpgradeEmail(email, env)` inside a try/catch. Existing email helpers near lines 131–188 POST to Resend (`https://api.resend.com/emails`) with `Authorization: Bearer ${env.RESEND_API_KEY}`, a `from` of `env.EMAIL_FROM || "The Git Times <noreply@gittimes.com>"`, and return `res.ok`. `RESEND_API_KEY` is a Worker secret — reference it, never print or inline it. The owner (`mandalazenwave@gmail.com`) is NOT a Stripe customer; the alert goes to them out-of-band. After this ships, the owner can fire one real $0 conversion later using the promo code `CPHnews` (100%-off-forever) to exercise the whole path — that is the owner's manual follow-up; do NOT attempt it yourself (you cannot fire a real conversion without a payment). Known dead ends: none yet — first implementation; the risk is regressing the live webhook.

**Inputs**

- Repo root: `/Users/christopherharris/projects/gittimes`
- Worker source: `/Users/christopherharris/projects/gittimes/worker/index.js` (existing email helpers ~lines 131–188; webhook `checkout.session.completed` branch ~lines 624–648) (unverified line numbers — locate by content, not by number)
- Worker config: `/Users/christopherharris/projects/gittimes/worker/wrangler.toml` (has a `[vars]` table)
- Tests: `/Users/christopherharris/projects/gittimes/test/worker.test.js` (existing webhook test "handles checkout.session.completed — upgrades user" that mocks global `fetch`, ~line 436) (unverified line number)
- Test runner: `npm test` (run from repo root; runs `node --test test/*.test.js`)
- Lint: `npm run lint` (run from repo root)
- Deploy: `cd /Users/christopherharris/projects/gittimes/worker && npx wrangler deploy` (Cloudflare OAuth as mandalazenwave@gmail.com) (unverified auth state)
- Live worker URL: `https://gittimes-chat.mandalazenwave.workers.dev`
- Liveness probe after deploy: `curl -s https://gittimes-chat.mandalazenwave.workers.dev/pricing` (expects HTTP 200, JSON containing `"ok":true` and `"display":"$5/month"`)
- Owner alert address: `mandalazenwave@gmail.com`

**Constraints**

- Zero dependencies; plain JS; no TypeScript; match the surrounding code style (mirror `sendUpgradeEmail`).
- DO NOT modify `verifyStripeSignature` in any way.
- DO NOT alter the existing idempotency guard, the premium-flip logic, the `stats:premiumUsers` increment, or the webhook's 200 response.
- Add a helper `sendConversionAlertEmail(session, env)` that emails `env.ALERT_EMAIL` via the same Resend pattern. If `env.ALERT_EMAIL` is falsy it MUST no-op and return `false` (feature OFF by default when the var is unset).
- The alert email body must include: the converter's email, the Stripe customer id, the Stripe subscription id, and a timestamp.
- Wire the call into the `checkout.session.completed` branch wrapped in ITS OWN try/catch so any throw, rejection, or timeout from the alert is swallowed and the webhook still flips premium and returns 200. The alert's failure must not affect the premium-flip outcome. Do NOT remove or repurpose the existing `sendUpgradeEmail` customer call — this is a SECOND, owner-facing email.
- Never log, print, or inline secrets; reference `env.RESEND_API_KEY` only.
- Add `ALERT_EMAIL = "mandalazenwave@gmail.com"` to the `[vars]` table in `wrangler.toml`.
- Do NOT `git push` (policy-blocked). Deploying via wrangler is permitted and is separate from git.

**Definition of done**

- `sendConversionAlertEmail(session, env)` exists in `worker/index.js`, mirrors the Resend pattern, returns `false` immediately when `env.ALERT_EMAIL` is falsy, and otherwise sends an email to `env.ALERT_EMAIL` containing the converter email, Stripe customer id, subscription id, and a timestamp.
- It is called from the `checkout.session.completed` branch inside its own try/catch.
- New test (a): with `ALERT_EMAIL` set, on `checkout.session.completed` the alert send is attempted — a `fetch` POST to `https://api.resend.com/emails` targeting the owner address occurs (inspect the mocked fetch's recorded calls).
- New test (b) — regression: with the alert email's `fetch` throwing OR returning `!ok`, the webhook STILL returns 200 AND STILL flips the user to premium.
- `npm test` passes (all tests, including the two new ones).
- `npm run lint` reports no errors.
- `grep -n sendConversionAlertEmail worker/index.js` shows both the definition and the call site.
- `grep -n ALERT_EMAIL worker/wrangler.toml` shows `ALERT_EMAIL = "mandalazenwave@gmail.com"` in `[vars]`.
- `npx wrangler deploy` prints a new Worker Version ID (capture and report it) — OR, if Cloudflare auth is unavailable, that step is reported as BLOCKED with the exact error, while code + tests + lint are all green (the alert defaults OFF in production until `ALERT_EMAIL` is set there anyway).
- Post-deploy, `curl -s https://gittimes-chat.mandalazenwave.workers.dev/pricing` returns HTTP 200 with JSON containing `"display":"$5/month"`, proving the freshly-deployed Worker is alive.

**Verification**

Run, in order, and report each result:
1. `cd /Users/christopherharris/projects/gittimes && npm test`  — full suite green, incl. the new alert-fires and webhook-survives-alert-failure tests (note their names in the output).
2. `cd /Users/christopherharris/projects/gittimes && npm run lint`  — clean.
3. `grep -n sendConversionAlertEmail /Users/christopherharris/projects/gittimes/worker/index.js`  — shows definition + call site.
4. `grep -n ALERT_EMAIL /Users/christopherharris/projects/gittimes/worker/wrangler.toml`  — shows the var.
5. `cd /Users/christopherharris/projects/gittimes/worker && npx wrangler deploy`  — capture the printed Version ID (or report BLOCKED with the exact error).
6. `curl -s -w "\nHTTP %{http_code}\n" https://gittimes-chat.mandalazenwave.workers.dev/pricing`  — expect HTTP 200 and JSON with `"display":"$5/month"`.

<!-- prompt-out v1 -->
