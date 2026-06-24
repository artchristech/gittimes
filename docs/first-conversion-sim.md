# First Organic Free → Premium Conversion — Simulation + Scorecard
_Git Times · Distribution phase · 2026-06-23_

## The simulation — "Dana, the first converter"

A faithful walk of the live funnel. Each step names the code path and marks
evidence: **[LIVE]** = probed against the deployed worker today, **[TEST]** =
covered by `test/worker.test.js`, **[E2E]** = end-to-end verified once on 06-23.

| # | Moment | Endpoint / path | What fires | Evidence |
|---|--------|-----------------|-----------|----------|
| 1 | Dana lands on an edition from a shared link | gh-pages static | Canonical/OG now resolve (fixed today) → link previews correctly in the share that brought her | [LIVE] |
| 2 | Reads a story, clicks **"Ask about this"** | `renderHybridArticle`/`renderQuickHit` + `public/chat.js` | Chat panel opens, scoped to that repo | [E2E] |
| 3 | Asks anonymously | `POST /chat` (no auth) | `400 {"error":"Missing session_id or account"}` → chat.js shows sign-in | [LIVE] |
| 4 | Signs up with email | `POST /auth/send-magic-link` → `GET /auth/verify` | Free user created (`plan:"free"`), 30-day session minted, `stats:totalUsers++` | [TEST] |
| 5 | Asks 3 questions | `POST /chat` (Bearer) | 3× `200` streamed gpt-4o-mini; `freeChatUsage.count` → 3 | [TEST][E2E] |
| 6 | Asks a 4th — **the wall** | `POST /chat` | `429 {"upgrade":true,"message":"…Upgrade to Premium…"}` → inline "Upgrade to Premium →" CTA | [TEST:605][E2E] |
| 7 | Clicks upgrade | `GET /checkout?session_token=…` | `303` to a real Stripe **LIVE** hosted checkout ($5/mo, promo field on) | [LIVE: anon path rejected → login_required] |
| 8 | Pays $5 | Stripe hosted page | `checkout.session.completed` → `POST /stripe/webhook` (sig-verified, idempotent) | [TEST:436] |
| 9 | Webhook flips her | webhook handler | `plan:"premium"`, `stripeSubscriptionId` saved, `stats:premiumUsers++`, upgrade email sent | [TEST:450] |
| 10 | Returns, asks freely | `POST /chat` (premium) | `200` up to monthly cap 1000 | [TEST:559] |

**Live gates proven today:** `/pricing` → `{display:"$5/month"}` 200 · anon `/chat` → 400 ·
anon `/checkout` → `302 …/account/?error=login_required` · `/admin/stats` → 401 (locked).

**The one step that cannot be self-simulated:** #8 requires a card on a hosted page.
The honest way to fire it once for real, $0, is the **`CPHnews` promo (100%-off-forever)** —
it drives a genuine `checkout.session.completed` (and thus the whole premium flip +
observability path) without spending money. That's the recommended live dry-run.

---

## 10 tenets — observation & business success

Status: ✅ fulfilled · ⚠️ partial · ❌ needs fulfillment

| # | Tenet | Status | Evidence / gap |
|---|-------|--------|----------------|
| 1 | **The funnel mechanically converts** (free → wall → checkout → premium) | ✅ | All 10 steps proven via [LIVE] gates + [TEST] + the 06-23 [E2E] run |
| 2 | **Real money can settle on LIVE rails** | ✅ | Stripe LIVE price `price_1TlSlF…` + webhook `we_1TlSlN…` enabled; `/pricing` 200. _Caveat: zero real charges have actually cleared yet_ |
| 3 | **A conversion is observable the moment it happens** (you can see premiumUsers 0→1) | ❌ | `/admin/stats` is locked and the deployed `ADMIN_TOKEN` isn't set/readable; no push/email alert on `checkout.session.completed`. **This is the #1 blocker to "watch the first conversion."** |
| 4 | **Attribution** — you know which edition/article/CTA produced the converter | ❌ | No UTM or funnel analytics tying share → signup → upgrade. Can't yet answer "which story converts" |
| 5 | **The trigger is actually hit** — free users reach the 3/day wall | ⚠️ | Limit exists & returns 429, but no telemetry proving anyone hits it; need a daily free-usage counter surfaced |
| 6 | **The upgrade moment is frictionless** — 429 → inline CTA → one-click checkout, mobile too | ✅ | chat.js inline CTA + `/checkout` redirect verified 06-23; panel responsive to 375px |
| 7 | **Unit economics hold** — $5 ≫ cost to serve | ✅ | gpt-4o-mini ≈ $0.001–0.003/turn → free user <$0.30/mo, premium pennies vs $5 |
| 8 | **Anti-churn machinery exists** — grace period, payment_failed, cancel | ✅ | Webhook handles `subscription.deleted` + `invoice.payment_failed` (3-day grace); unexercised in prod |
| 9 | **Demand exists at the top of the funnel** — traffic → signups | ❌ | **The binding constraint.** Distribution is the bottleneck; no evidence of organic signup volume. Share/OG loop only just made correct (today); newsletter growth nascent |
| 10 | **The first conversion is trustworthy** — not self-dealt, not forged, not accidentally free | ⚠️ | Security solid (Stripe sig verify + idempotency + CORS, /cso clean). _But `CPHnews` = 100%-off-forever: a comped signup looks like a "conversion" yet is $0 MRR — must separate real $5 conversions from comps in any success metric_ |

**Scoreline: 5 ✅ · 2 ⚠️ · 3 ❌.** The machine is built and correct; the gaps are
all about **seeing** (3, 4, 5) and **feeding** (9) the funnel — not fixing it.

### Highest-leverage next moves (in order)
1. **Make conversions observable (tenet 3).** Set the deployed `ADMIN_TOKEN` secret so `/admin/stats` reads live, and/or send yourself an email/push on `checkout.session.completed`. Without this you literally cannot watch the event you're waiting for.
2. **Fire one real $0 conversion via `CPHnews` (tenets 2,3,8).** Proves the entire premium-flip + email + counter path against prod once, for free — the true "first conversion" rehearsal.
3. **Add attribution (tenet 4)** — UTM on share links + a signup `source` field already exists on the subscriber; extend it to capture the entry article.
4. **Feed the top of funnel (tenet 9)** — the share/OG loop is now correct; the next constraint is volume (newsletter + promo video).
