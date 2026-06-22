# Hardening prompt — make the GitTimes x402 paywall safe to monetize

You are working in `/Users/christopherharris/projects/gittimes` (deployed at
`chris@66.55.144.173:/home/chris/gittimes`, systemd `gittimes-api.service`, nginx box).
The agent API (`api-server.js` + `src/x402.js`) exposes paid endpoints behind an x402
USDC paywall. It is currently safe because the paywall is OFF (`X402_RECEIVER` unset) and
the API binds `127.0.0.1` only. Two hard gates must close BEFORE turning the paywall on
or exposing the API publicly. Solve both, with tests, without breaking the 406 passing
tests or the free-tier behavior.

## Gate 1 — bind payment to a server-minted nonce (the real fix for F3)
Today `src/x402.js` `verifyOnChain()` accepts "a USDC transfer ≥ price to the receiver,
used once, recent (freshness window)". It is NOT bound to a specific request, so a fresh
inbound transfer to the receiver from an unrelated party could be claimed once.
Requirements:
- On an unpaid request, mint a random nonce, store it (SQLite, with expiry + amount +
  resource) and return it in the 402 `accepts[0].extra.nonce` (the field already exists in
  the contract shape).
- Require the client to prove the payment is tied to that nonce. Pick ONE: (a) EIP-3009
  `transferWithAuthorization` where the nonce is the authorization nonce and you verify the
  signature + submit/settle; or (b) a hosted x402 facilitator (`verify`/`settle`) — check
  how `fillin`/`agent-passport` do it in `~/projects`; or (c) require the payment tx to
  include the nonce (calldata/memo) and verify it in the receipt.
- Keep replay protection (txHash single-use) AND nonce single-use. Keep sim mode for tests.
- Reference impl to study: `~/projects/agent-passport/x402/server.ts` (nonce in `extra`,
  on-chain receipt verify) and `~/projects/fillin` (`/v1/payment/challenge`, EIP-191).

## Gate 2 — safe public exposure (F4 + TLS)
- `api.gittimes.com` has no DNS yet (apex points at GitHub Pages). After the A-record →
  `66.55.144.173` exists, install the nginx vhost from `deploy/DEPLOY.md` (with
  `limit_req zone=gittimes_api`), run certbot, and confirm the API is only reachable via
  nginx (never bind the node process to `0.0.0.0`).
- Verify: rate limit returns 429 under burst; free endpoints stay free; paid endpoints
  return a well-formed 402 with the nonce; a real (or facilitator-simulated) payment yields
  200; replay/again yields 402.

## Constraints
- Zero-to-minimal new deps (the API is currently dependency-light Node `http`). If a lib is
  needed for EIP-3009/signature verify, justify it.
- Set a gittimes-specific `X402_RECEIVER` (do NOT reuse another project's receiver wallet).
- Update `test/x402.test.js` to cover nonce mint → bound payment → success → replay/expiry.
- Definition of done: paywall can be turned on (`X402_RECEIVER` set) with no claimable-
  transfer loophole, API publicly reachable only through rate-limited TLS nginx, all tests
  green, `BUILDLOG.md` updated.

## Also (ops, not code)
- Rotate the leaked xAI key `xai-x7jJ…` in the xAI console (still valid; F6).
