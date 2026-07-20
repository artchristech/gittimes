# Build Log

> Symbolic memory of the building process. Not what changed — how it felt to build it.
> Read Project Pulse first. Scan recent entries for context. Check Archive for deep history.

## Project Pulse
Status: Battle-tested MCP + REST API (both green), hardened the fragile surface (record-promo, x-sentiment, account page), cleaned dead weight. Caught a closed-loop incident: catalog-format voice drift re-emerged on 2026-03-23, shipped one bad edition (2026-03-27), was reverted 2026-04-02 — voice has held on every edition since.
Confidence: Solid on publishing pipeline, MCP/REST surface, and editorial voice recovery. The lesson from the catalog incident is that the voice rule is *load-bearing and reversible within days* — the guardrail works when tripped.
Frontier: Editorial voice monitoring is the next real frontier. The catalog experiment made it through one publish cycle before reversal; a cheaper feedback loop (voice-shape validator at publish time?) would catch drift before an edition ships rather than after. Separately, the local site/editions mirror is stale relative to gh-pages — publish-edition.js only syncs in non-CI, and local hasn't been run in weeks.
Debt mood: clean — 18 grade items still resolved, no new ones opened by today's hardening. `fetchXPulse`/`parseXPulse` dead code removed (feature was replaced by Memes per `03ac633`). Record-promo now cleans `.frames-*` dirs on failure via try/finally. `account.js` warns when `CHAT_WORKER_URL` is missing. Pre-existing `slugify` unused-import fixed in `publish.js`.

## Entries

### 2026-07-19 — Model Drops: per-trusted-org lane (the Kimi K3 miss)
**Did:** Investigated why Kimi K3 never hit the Model Drops band. Diagnosis surprised: it
wasn't the suspected likes7d-page miss — K3 has NO public Hugging Face repo at all
(moonshotai's newest public model is K2.7-Code, June 11; K3 launched July 16 on OpenRouter
as an API-first release, weights unpublished). The band is HF-driven, so no query shape
could have caught it. But the investigation exposed a real fragility: the global
`sort=createdAt` lane only sees HF's newest ~100 repos site-wide, which turn over in
minutes — a trusted lab's drop from even a few hours before publish can miss BOTH global
lanes and never be considered. Fixed by adding a third lane: one
`author=<org>&sort=createdAt&limit=4` query per TRUSTED_ORGS entry, merged into the pool
before `selectModelDrops` (which already dedupes by id). Zero-key, each lane fails to `[]`
independently, band still never fails the edition. Live check confirmed the org lanes
surface sub-80-like trusted drops (internlm, nvidia) the global pages missed. Also: K3 IS
on OpenRouter, so added `kimi-k3` to trackedModels ($3.00/$15.00 per M, live prices) and
pointed the bannerKeys fallback at it — the Kimi banner slot auto-resolves to K3 already;
no eval scores fabricated (desk curates those, missing keys render as null). 5 new
fetch-lane tests with mocked HF routing. 711 tests green, lint clean.
**Felt:** The suspected root cause being wrong is the story. The fix was still right — it
just fixes the NEXT miss, not this one. When K3's weights do land on HF, day one is now
guaranteed consideration.

### 2026-07-17 — Clerk sign-in via hybrid exchange (code complete; ops gate remains)
**Did:** Professional auth without touching what works. Clerk owns sign-in + profile UI on
`/account/` only; a new `POST /auth/clerk-exchange` verifies Clerk's session JWT — manual
JWKS fetch + WebCrypto RS256, zero deps, because the worker is zero-build and the test
loader `_compile`s it as CJS — then mints the SAME 64-hex KV session token the magic-link
flow mints. Chat, checkout, webhook, transcripts: all unchanged; existing users keep plan +
billing (KV keyed by email). Claims come from a required Clerk JWT template `gittimes`
(default session JWTs carry no email); `iss`/`azp`/`exp` validated, disposable-email guard +
IP rate-limit for parity, `email_verified:false` refused. Account page mounts Clerk SignIn/
UserProfile with CSP extended (clerk host + Turnstile in script/connect-src, NEW frame-src +
worker-src directives) ONLY when `CLERK_PUBLISHABLE_KEY`+`CLERK_FRONTEND_API` are baked in;
otherwise it renders today's magic-link page byte-for-byte-equivalent — and if clerk-js
fails to load at runtime (script onerror → immediate, 10s poll as backstop) the form comes
back. Magic link stays flag-gated ON (`MAGIC_LINK_ENABLED`) for one release. Delete-account
now also deletes the Clerk user (needs `CLERK_SECRET_KEY`, never blocks the KV wipe).
15 new worker tests sign real RS256 JWTs against a mocked JWKS; 3 account-render tests
cover both CSP modes. 706 tests green, lint clean; both page variants verified in-browser.
**Ops gate (owner, sequenced):** create Clerk app (dev first) with GitHub/Google/email-link/
password (enforce verify-at-signup); add JWT template `gittimes` (email/name/avatar claims);
prod custom domain CNAME `clerk.gittimes.com` (grey-cloud); set repo secrets
`CLERK_PUBLISHABLE_KEY`+`CLERK_FRONTEND_API` and worker vars `CLERK_ISSUER`+`CLERK_JWKS_URL`
(+`CLERK_SECRET_KEY` secret); deploy worker; manual edition publish. Until then everything
ships inert: exchange 404s, page renders legacy form.

### 2026-07-17 — talk-to-the-archive: search→chat bridge, story chips, reader-visible continuity
**Did:** Three product moves from a grounded critique. (1) Search now bridges into the AI Desk:
when a query returns <3 clippings (and chat is on), a dashed coupon-styled "Ask the AI Desk"
card appears; clicking folds search away and hands the query to chat via a new
`window.__gtChat.ask()` hook — sends immediately when unlocked, waits in the input box when
paywalled. (2) Focusing a story ("Ask about this") now seeds 3 per-story suggested-question
chips built client-side from the article's data attributes, killing the cold-start empty box.
(3) The prior-coverage continuity the LLM prompt already saw is now reader-visible: articles
whose repo appeared in the last 7 editions carry a "Previously in The Times" line (prior
headline + date, linking the prior edition) — `attachPriorCoverage` in xai.js threads the
coverage map onto article objects; renderHybridArticle emits `{{BASE_PATH}}`-relative links
(article-page assembly reordered so BASE_PATH resolves after content injection). Verified
all three in-browser on a scratch page; 691 tests green.
**Found along the way:** the chat Worker was already deployed and live on gittimes.com
(secrets set 2026-06-23) with streaming — the buildlog's "dormant until creds" note is stale.

### 2026-07-16 — The fold: archive search as a layer, not a route
**Did:** Shipped the search-bar transition. A slim dateline bar ("Ask the archive… /") sits
under the masthead's bottom double rule; on click or `/`, `public/search.js` wraps the whole
page once into a `.gt-fold` container, freezes it at its exact on-screen box
(`getBoundingClientRect` → `position:fixed`), and compresses it with a transform while the
search surface unfolds over it — transforms + opacity only, ~280ms crease easing, edition DOM
never unloads. Escape / the fold line unfolds back to the exact scroll position (verified to
the pixel: 1200 → search → 1200). Results render as clippings — kicker/headline/catch/date
cards with a 22ms stagger — ranked over the same `/data/corpus.json` the AI Desk grounds on
(lazy-fetched on first open, prefetched on bar hover). Score = per-term title×4 + repo×3 +
text×1, every term must land; empty query shows the latest editions. Wired the same way as
chat.js: template script tags (newspaper/article/archive), `publish.js` copies the asset,
`site/search.js` mirrored. Lint clean, full test suite green, headless-browser QA on the real
baked front page (desktop + 375px mobile, zero console errors).
**Felt:** The metaphor did the engineering: once "search is the paper folded shut" was taken
literally, every hard choice (no route, no unmount, freeze-the-box, symmetric state) fell out
of it. Reusing the AI Desk corpus meant the whole feature cost zero new data plumbing.
**Deploy (owner):** commit + push main, then republish (daily cron or
`gh workflow run "Daily Edition" -f skip_newsletter=true`) — already-published editions keep
the old HTML until regenerated; root + new editions pick up the bar.

### 2026-07-13 — x402 agent paywall: closed the F3 loophole (facilitator + EIP-3009)
**Did:** Turned the agent API from "unsafe to monetize" into "one credential away from live."
Rewrote `src/x402.js` from self-rolled Base RPC verification (`verifyOnChain`: *find any USDC
Transfer to the receiver, use once, recent*) to the x402 **"exact" scheme over EIP-3009**,
verified + settled through a hosted **facilitator** (`/verify` → `/settle`). This closes
Gate 1 (F3) *by construction*: a payment is now a signature over an authorization that pays
*us* and settles exactly once — there is no inbound transfer to blind-claim anymore. Kept the
free tier, kept `sim` mode for tests, kept SQLite replay protection (now keyed on the
authorization `from:nonce`, not a txHash we don't have until after settle). Facilitator is
pluggable via env (`X402_FACILITATOR_URL` + optional bearer) so the mainnet provider is ops
config, not code — stays zero-dep (`fetch` only). Discovery doc + API index now advertise the
scheme + facilitator. Added 10 facilitator tests that stand up an ephemeral loopback
facilitator and exercise the real verify→settle path (success, replay, wrong-receiver,
underpay, bad-sig 402, settle-fail 402 without consuming the nonce, transport 502). Wrote
`docs/agent-api.md` (agent-facing, with an `x402-fetch` snippet) and `deploy/api.env.example`
(the go-live env). **684 tests green, lint clean.**
**Settlement decided + wired (same day):** checked how `fillin`/Glyph settle mainnet — they
use NO facilitator (plain inbound-Transfer monitor + prepaid credits + EIP-191), a different
architecture, so they didn't hand us one. Chose **Coinbase CDP** (fee-free on Base, sponsors
gas, canonical, works with off-the-shelf `x402-fetch` agents). Added a pluggable per-request
**auth-header seam** (`authHeadersFor`: none / static Bearer / CDP-JWT) mirroring the official
`createAuthHeaders` hook, and `src/x402-cdp.js` — a thin adapter that lazy-`require`s
`@coinbase/cdp-sdk`'s `generateJwt({apiKeyId,apiKeySecret,requestMethod,requestHost,requestPath})`
per request (JWT bound to method+host+path, 120s expiry). CDP keys (`CDP_API_KEY_ID/SECRET`)
auto-target the CDP facilitator URL; the dep loads ONLY in CDP mode so non-CDP stays
dependency-light; a missing dep throws an actionable "npm install @coinbase/cdp-sdk". +4 auth
tests (static Bearer reaches the facilitator, no-key sends no auth, CDP detection auto-targets
the CDP URL, CDP-without-dep throws). **688 tests green, lint clean.**
**Gate:** now purely credentialed — on the VPS: `npm install @coinbase/cdp-sdk`, set
`X402_RECEIVER` (dedicated Base wallet) + `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` in
`deploy/api.env`, point `api.gittimes.com` DNS at the box, nginx+certbot per `deploy/DEPLOY.md`.
Gate 2 (rate-limited TLS nginx) + a live $0.01 settle smoke-test still owner-run (needs the key).

### 2026-06-22 — Worker deploy prep (one-shot human-product activation)
**Did:** Made the dormant reader product a credentials-only activation. Confirmed the CI is
already wired (`deploy-worker.yml` auto-deploys on `worker/**` via `CF_API_TOKEN`;
`daily-edition.yml` already passes `CHAT_WORKER_URL` so editions render the chat once that
secret exists). Added `CHAT_MODEL` to `wrangler.toml` (paid-model swap before charging is
now one line). Wrote `deploy/WORKER_DEPLOY.md` — exact runbook for Cloudflare (login + 4 KV
namespaces), Stripe ($5 price + webhook), Resend, the 7 `wrangler secret put`s, the two repo
secrets (`CF_API_TOKEN`, `CHAT_WORKER_URL`), and verification. Added `deploy/worker-preflight.sh`
— checks KV ids filled, 7 worker secrets present, repo secrets set, free-model warning, and
a live `/pricing` probe; prints READY / NOT READY. Run today it correctly reports NOT READY
with the precise remaining steps.
**Gate:** purely credentialed (user provides Cloudflare/Stripe/Resend). No code blocks it.

### 2026-06-22 — interactive AI newspaper: per-article "Ask about this story"
**Did:** Built out the human product's interactive chat. Found+fixed a latent bug: `getContext()` in `public/chat.js` read `.lead-headline`/`.featured-headline` (the old non-hybrid renderer) so current editions sent the chat EMPTY context. Rewrote it for the live `.hybrid-*` markup. Added per-article focus: every article now renders an "Ask about this" button (`renderHybridArticle`) carrying rich data attributes (repo/stars/lang/url/sentiment) the reader can't see in the body; clicking it opens the chat scoped to that one story with a "Asking about: <title>" focus bar (clearable back to whole-section). The ask buttons are hidden by default and only revealed when `chat.js` loads (`body.chat-on`), so they don't appear as dead UI when the Worker isn't deployed. Chat message now labels context as "Story in focus" vs "Today's stories". 406 tests green.
**Still dormant:** the whole chat activates only once the Worker is deployed + `CHAT_WORKER_URL` is set (Cloudflare/Stripe/Resend creds — user to provide). This is the client/UX half, ready to light up.

### 2026-06-22 — security pass on the API/x402 deploy (CSO + falsify-first)
**Did:** Verified the new surface; dismissed non-issues (SQL is fully parameterized; API binds 127.0.0.1 only; firewall limits :80 to Cloudflare ranges; edition date is regex-validated → no path traversal). Fixed the real findings: `.gitignore` now covers `deploy/*.env` + `worker/.dev.vars` (F1); SQLite `busy_timeout=5000` so the API's x402 payment insert can't `SQLITE_BUSY` against the publish job's txn (F2); x402 sim mode now fails closed — requires `X402_ALLOW_SIM=true`, a stray `X402_MODE=sim` in prod reverts to onchain (F5); added a transfer-freshness check so an old/arbitrary inbound USDC transfer to the receiver can't be claimed (F3 partial). Documented the required nginx `limit_req` vhost before any public exposure (F4) and the hard gate before monetizing: bind payment to a server-minted nonce (full F3 fix). 406 tests green.
**Still open (user/ops):** rotate the leaked xAI key (F6); the paywall stays OFF until a gittimes-specific `X402_RECEIVER` is set AND nonce-binding lands.

### 2026-06-22 — agent API goes paid: x402 per-call paywall — API v1.1.0
**Did:** Turned the read-only REST surface (`api-server.js`) into the product wedge Starfleet identified: the structured edition/repo/trending history, queryable by agents, paid per call over x402. New zero-dep `src/x402.js` implements the handshake — unpaid request to a paid resource returns 402 + a self-describing `accepts[]` (price/asset/payTo/network), the agent pays USDC on Base and retries with an `X-PAYMENT` header, we verify the on-chain USDC Transfer receipt via Base JSON-RPC (`fetch`, no viem) and replay-protect the txHash in a new `x402_payments` SQLite table. `GET /v1/payment/info` is the discovery doc. Free (teaser) endpoints: editions list/latest, sections, stats, payment-info. Paid: edition-by-date, repo search, repo history, repo coverage, trending. Modes: off (no receiver → open) / onchain / sim (deterministic, for tests). 8 new tests + a live 402→pay→200→replay smoke test, all green (405 total).
**Left to ship:** set a real gittimes `X402_RECEIVER` wallet (do NOT reuse Glyph's), then deploy `api-server.js` on the VPS bound to 0.0.0.0 behind the systemd/pm2 the other services use. Until a receiver is set the paywall stays open by design.

### 2026-06-18 — complete the OpenRouter migration (worker chat) — v1.0.1
**Did:** The `462b979` xAI→OpenRouter switch missed the chat Worker. `worker/index.js` still hardcoded `grok-3-mini` and proxied `api.x.ai` with `XAI_API_KEY` — dead code since xAI billing lapsed (chat widget 502s). Migrated it to the `src/xai.js` provider pattern: env-driven OpenRouter (`nvidia/nemotron-3-super-120b-a12b:free` default, `LLM_BASE_URL`/`CHAT_MODEL` overrides, `OPENROUTER_API_KEY` with xAI fallback). Renamed `xaiRes`→`aiRes`, updated `wrangler.toml` secret list and `test/worker.test.js` (mock now intercepts `openrouter.ai`; added asserts for endpoint/key/model + env-override). Bumped to v1.0.1.
**Out of scope:** `worker/.dev.vars` holds a live plaintext `XAI_API_KEY` — rotate + confirm gitignored (separate change). Prod needs `wrangler secret put OPENROUTER_API_KEY`.

### 2026-04-17 — battle-test and harden after MCP/REST landing
**Did:** Spock-style three-option strategic triage picked Options II + III (skip editorial audit). Battle-tested MCP server (9 tools, all green over stdio) and REST API (9 endpoints, all shapes + 404/405/CORS correct). Hardened: removed unused CDP session stub from `record-promo.js`, wrapped capture+ffmpeg in try/finally for frame/browser cleanup on failure; stripped dead `fetchXPulse`/`parseXPulse` from `x-sentiment.js`; added `CHAT_WORKER_URL` missing-warn to `account.js`; fixed pre-existing `slugify` unused-import lint error in `publish.js`. Removed stray `dist/` dir and `promo-2026-03-02.html` (both gitignored). 396/396 tests pass, lint clean.
**Surprised by:** The "16-line stub" framing of `account.js` was wrong — it's a thin wrapper around a substantial template (`templates/account.html`) that handles magic-link login, Stripe upgrades, and is linked from every page's masthead. Load-bearing, not vestigial. Also surprised: latest DB-recorded edition (2026-03-27) has headline `"firecrawl"` — catalog format — triggering the drift alarm, but verifying against gh-pages showed the revert had already landed and every edition since 2026-04-04 is proper journalism voice. Local DB was just stale.
**Shifted understanding:** The catalog-format incident (2026-03-23 introduce → 2026-03-27 ship one bad edition → 2026-04-02 revert) is the first recorded end-to-end *voice regression and recovery*. It validates two things: (1) the editorial voice rule is real-stakes, not just aesthetic preference — one bad edition slipped into production; (2) the recovery loop works (5 days introduce-to-revert). But the *detection* was human — a voice-shape validator at publish time would make the loop tighter.
**Next grip:** Either (a) write the voice-shape validator (reject article generation if headline matches repo-name or repo-description patterns), or (b) pivot to a fresh grade audit now that the system is battle-tested and the debt ledger remains at zero. Voice validator is more interesting and higher-leverage given the recent incident.

### 2026-03-03 — grade audit sweep to zero
**Did:** Systematically resolved every open item in GRADE_IMPROVEMENTS.md — flipped HTML sanitization from blocklist to allowlist, removed dead `renderSecondaryArticle`, fixed variable shadowing (`seen` -> `rawSeen`), added null guards on `repo.topics`, centralized hardcoded model string in x-sentiment.js, and threaded `githubToken` through editorial pipeline.
**Surprised by:** The `sanitizeArticleHtml` blocklist (strip `<script>`, `<iframe>`) was fundamentally wrong — any tag not explicitly blocked would pass through (`<style>`, `<object>`, `<embed>`, `<form>`, `<svg>`). Flipping to a `SAFE_TAGS` allowlist inverts the security posture: unknown tags are stripped by default. The blocklist was passing tests but one LLM hallucination of a `<style>` tag away from a visual attack.
**Shifted understanding:** GRADE_IMPROVEMENTS.md has evolved from a checklist into a living contract — each item carries its own lifecycle (open -> resolved with file refs). Getting to zero open items for the first time reveals the document's real value: it's a forcing function for systematic cleanup rather than ad-hoc fixes.
**Next grip:** Commit the uncommitted cleanup, then either run a fresh grade audit to surface new issues or shift attention to editorial content quality — the pipeline works but the LLM output voice hasn't been critically evaluated since the star-count-to-substance editorial shift on Mar 2.

## Archive
