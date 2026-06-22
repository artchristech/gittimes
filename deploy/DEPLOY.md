# Deploying the GitTimes agent API (x402) on the VPS

The API (`api-server.js`) serves the read-only edition/repo/trending data, with the
high-value endpoints gated behind an x402 per-call USDC paywall. Free endpoints:
`/api/editions`, `/api/editions/latest`, `/api/sections`, `/api/stats`,
`/v1/payment/info`. Paid: `/api/editions/:date`, `/api/repos/search`,
`/api/repos/:o/:n/history`, `/api/repos/:o/:n/coverage`, `/api/trending`.

## Data freshness (important)

The API reads `data/gittimes.db` (`repo_snapshots`, `editions`, `edition_repos`).
GitHub Actions publishes the static site to gh-pages but does **not** commit that DB,
so the VPS must populate it itself. The `gittimes-publish.timer` runs `npm run publish`
daily to keep the local DB current. (The DB is gitignored; a fresh clone starts empty
until the first publish runs.)

## One-time setup

```bash
sudo git clone https://github.com/artchristech/gittimes.git /home/chris/gittimes
cd /home/chris/gittimes
npm ci --omit=dev          # better-sqlite3, openai, etc.

# 1) Publish env (generation): needs GitHub + OpenRouter
cat > deploy/publish.env <<'EOF'
GITHUB_TOKEN=ghp_...
OPENROUTER_API_KEY=sk-or-...
X_SENTIMENT=false
PUBLISH_DIR=/home/chris/gittimes/site
EOF

# 2) API env. Bind to localhost and reverse-proxy, OR 0.0.0.0 if firewalled.
#    Leave X402_RECEIVER unset to run OPEN (free); set it to turn on the paywall.
cat > deploy/api.env <<'EOF'
HOST=127.0.0.1
PORT=3717
# --- x402 (optional; omit X402_RECEIVER to keep the API free) ---
# X402_RECEIVER=0xYOUR_GITTIMES_WALLET
# X402_NETWORK=base
# X402_PRICE_USDC=0.01
# X402_RPC_URL=https://mainnet.base.org   # or a private RPC to avoid public rate limits
EOF
chmod 600 deploy/*.env

# 3) Populate the DB once before first serve
npm run publish

# 4) Install units
sudo cp deploy/gittimes-api.service       /etc/systemd/system/
sudo cp deploy/gittimes-publish.service   /etc/systemd/system/
sudo cp deploy/gittimes-publish.timer     /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gittimes-api.service
sudo systemctl enable --now gittimes-publish.timer
```

## Reverse proxy + rate limiting (REQUIRED before public exposure)

The app has no built-in rate limiting; the API binds `127.0.0.1` only. **Do not expose
it without an nginx rate limit in front.** Needs DNS: `api.gittimes.com` A-record →
`66.55.144.173` (the apex `gittimes.com` points at GitHub Pages, not this box), then
certbot for TLS. nginx vhost (mirrors the glyph site):

```nginx
# /etc/nginx/conf.d/gittimes-ratelimit.conf
limit_req_zone $binary_remote_addr zone=gittimes_api:10m rate=10r/s;

# /etc/nginx/sites-enabled/gittimes-api
server {
    server_name api.gittimes.com;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    client_max_body_size 8k;            # GET-only API; reject large bodies

    location / {
        limit_req zone=gittimes_api burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3717;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
    # TLS managed by certbot
}
```

## Verify

```bash
curl -s http://127.0.0.1:3717/                | jq '.payment'      # enabled?/price
curl -s http://127.0.0.1:3717/v1/payment/info | jq .
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3717/api/stats     # 200 (free)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3717/api/trending  # 200 if open, 402 if paywalled
```

When paywalled, `/api/trending` returns 402 with a self-describing `accepts[]`
(price/asset/payTo/network); an agent pays USDC on Base to `payTo`, then retries with
`X-PAYMENT: <base64 {"payload":{"txHash":"0x..."}}>`. Verification reads the on-chain
USDC Transfer receipt; each txHash is single-use (replay-protected in `x402_payments`).

## Turning the paywall on later

Set `X402_RECEIVER` (a gittimes-specific Base wallet — do not reuse another project's
receiver) in `deploy/api.env`, then `sudo systemctl restart gittimes-api`. No code change.
