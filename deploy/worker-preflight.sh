#!/usr/bin/env bash
# Preflight for the Git Times Worker activation. Verifies config + (optionally) the
# deployed worker is healthy. Usage:
#   bash deploy/worker-preflight.sh                 # config checks only
#   WORKER=https://gittimes-chat.x.workers.dev bash deploy/worker-preflight.sh   # + live checks
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=1; }

echo "== wrangler.toml =="
if grep -q "REPLACE_WITH_" worker/wrangler.toml; then
  bad "KV namespace ids still contain REPLACE_WITH_* — run 'wrangler kv namespace create' and paste the ids"
else
  pass "KV namespace ids filled in"
fi
grep -q 'CHAT_MODEL' worker/wrangler.toml && pass "CHAT_MODEL set" || warn "CHAT_MODEL not set (uses code default)"
if grep -q 'CHAT_MODEL = ".*:free"' worker/wrangler.toml; then
  warn "CHAT_MODEL is a FREE model — switch to a paid model before charging for premium"
fi

echo "== worker secrets (needs wrangler auth) =="
NEED=(STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET OPENROUTER_API_KEY STRIPE_PRICE_ID RESEND_API_KEY NEWSLETTER_SECRET ADMIN_TOKEN)
if command -v wrangler >/dev/null 2>&1; then
  LIST=$(cd worker && wrangler secret list 2>/dev/null)
  if [ -n "$LIST" ]; then
    for s in "${NEED[@]}"; do
      echo "$LIST" | grep -q "\"$s\"\|$s" && pass "secret $s" || bad "secret $s MISSING (wrangler secret put $s)"
    done
  else
    warn "could not read secrets (not deployed yet / not logged in) — set all of: ${NEED[*]}"
  fi
else
  warn "wrangler not installed — skipping secret check"
fi

echo "== GitHub repo secrets =="
if command -v gh >/dev/null 2>&1; then
  GHS=$(gh secret list 2>/dev/null)
  echo "$GHS" | grep -q CF_API_TOKEN   && pass "CF_API_TOKEN (CI worker deploy)"      || bad  "CF_API_TOKEN missing (CI can't deploy the worker)"
  echo "$GHS" | grep -q CHAT_WORKER_URL && pass "CHAT_WORKER_URL (site renders chat)" || bad  "CHAT_WORKER_URL missing (site won't render chat)"
else
  warn "gh not installed — verify CF_API_TOKEN + CHAT_WORKER_URL repo secrets manually"
fi

echo "== live worker (set WORKER=... to enable) =="
if [ -n "${WORKER:-}" ]; then
  code=$(curl -s -o /tmp/wpf.json -w '%{http_code}' "$WORKER/pricing")
  if [ "$code" = "200" ]; then
    pass "GET $WORKER/pricing -> 200 ($(cat /tmp/wpf.json))"
  else
    bad "GET $WORKER/pricing -> $code (worker not reachable / not deployed)"
  fi
else
  warn "WORKER not set — skipping live checks"
fi

echo
[ "$fail" = 0 ] && echo "preflight: READY (resolve any warns above before charging)" || echo "preflight: NOT READY — fix FAILs"
exit "$fail"
