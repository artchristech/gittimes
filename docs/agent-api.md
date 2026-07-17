# GitTimes Agent API

A structured, machine-readable feed of **what builders are shipping** — trending
repos by star velocity, weekly editions, per-repo trajectories. Free to browse,
priced per-call for the high-signal endpoints via **x402** (USDC on Base).

Base URL: `https://api.gittimes.com`

## Free endpoints

| Endpoint | Returns |
|---|---|
| `GET /` | API index + payment status |
| `GET /v1/payment/info` | x402 discovery doc (scheme, price, wallet, facilitator) |
| `GET /api/editions?limit=10` | Recent edition index (teasers) |
| `GET /api/editions/latest` | Latest edition (full) |
| `GET /api/sections` | Section taxonomy |
| `GET /api/stats` | Corpus stats |

## Paid endpoints — $0.01 USDC / call

| Endpoint | The signal |
|---|---|
| `GET /api/trending?limit=15` | Repos ranked by **star velocity** between the last two snapshots — the core agent signal |
| `GET /api/editions/:date` | Full edition + article bodies for a given date |
| `GET /api/repos/search?q=react` | Every edition appearance of matching repos |
| `GET /api/repos/:owner/:name/history` | Star/fork/issue snapshot trajectory |
| `GET /api/repos/:owner/:name/coverage?lookback=30` | How often a repo has been featured |

## How to pay (x402, "exact" scheme / EIP-3009)

1. Call a paid endpoint. Unpaid, it returns **HTTP 402** with a self-describing
   `accepts[]` body (scheme, network, `payTo`, `maxAmountRequired`, and the USDC
   EIP-712 domain in `extra`).
2. Sign an **EIP-3009 `transferWithAuthorization`** for the quoted amount to `payTo`
   (off-chain, gasless), and retry with an `X-PAYMENT` header — base64 JSON of
   `{ x402Version, scheme:"exact", network, payload:{ signature, authorization } }`.
3. We verify + settle through a facilitator (it pays gas) and return **200** with the data.

### Easiest path — `x402-fetch`

Off-the-shelf clients handle the whole handshake from a funded wallet:

```js
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: base, transport: http() });
const pay = wrapFetchWithPayment(fetch, wallet);

const res = await pay("https://api.gittimes.com/api/trending?limit=15");
console.log(await res.json()); // paid, settled, returned
```

### Inspect pricing without paying

```bash
curl -s https://api.gittimes.com/v1/payment/info | jq
curl -s https://api.gittimes.com/api/trending    | jq   # 402 + accepts[] requirements
```

Payments settle to the Git Times receiver wallet on Base. Each authorization is
single-use (replay-protected on-chain and server-side).
