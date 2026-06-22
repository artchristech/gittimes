/**
 * x402 payment middleware for the GitTimes agent API — zero external deps.
 *
 * Implements the x402 handshake for per-call USDC payments:
 *   1. An unpaid request to a paid resource gets HTTP 402 + a self-describing
 *      `accepts[]` payment-requirements body (the agent learns price/asset/payTo).
 *   2. The agent pays USDC on Base to `payTo`, then retries with an `X-PAYMENT`
 *      header (base64 JSON carrying the settlement txHash).
 *   3. We verify the on-chain USDC Transfer via Base JSON-RPC (`fetch`, no viem),
 *      replay-protect the txHash in SQLite, and serve 200.
 *
 * Modes (X402_MODE):
 *   - "off"     : no receiver configured → paywall disabled, endpoints are free.
 *   - "onchain" : verify a real USDC Transfer receipt on Base (default when a
 *                 receiver is set).
 *   - "sim"     : accept a deterministic test payment (txHash starts "0xsim"),
 *                 for end-to-end tests without spending. Never use in prod.
 *
 * Config (env): X402_RECEIVER (enables the paywall), X402_PRICE_USDC (default
 * 0.01), X402_NETWORK (base | base-sepolia), X402_RPC_URL, X402_USDC, X402_MODE.
 */

const db = require("./db");

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const NETWORKS = {
  base: {
    chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpc: "https://mainnet.base.org",
  },
  "base-sepolia": {
    chainId: 84532,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    rpc: "https://sepolia.base.org",
  },
};

function config() {
  const network = process.env.X402_NETWORK || "base";
  const net = NETWORKS[network] || NETWORKS.base;
  const receiver = process.env.X402_RECEIVER || null;
  const priceUsdc = parseFloat(process.env.X402_PRICE_USDC || "0.01");
  let mode = receiver ? process.env.X402_MODE || "onchain" : "off";
  // Fail closed: sim mode accepts fabricated payments, so it must be explicitly
  // opted into (tests/dev). A stray X402_MODE=sim in prod falls back to onchain.
  if (mode === "sim" && process.env.X402_ALLOW_SIM !== "true") mode = "onchain";
  return {
    enabled: !!receiver,
    mode,
    network,
    chainId: net.chainId,
    usdc: process.env.X402_USDC || net.usdc,
    rpcUrl: process.env.X402_RPC_URL || net.rpc,
    receiver,
    priceUsdc,
    priceAtomic: String(Math.round(priceUsdc * 1e6)), // USDC has 6 decimals
    maxTimeoutSeconds: 60,
  };
}

/** Discovery document — GET /v1/payment/info */
function paymentInfo() {
  const c = config();
  return {
    x402Version: 1,
    protocol: "x402-usdc",
    enabled: c.enabled,
    network: c.network,
    chain_id: c.chainId,
    usdc_contract: c.usdc,
    wallet_address: c.receiver,
    price_per_call_usdc: c.priceUsdc,
    price_atomic: c.priceAtomic,
    info: {
      header: "X-PAYMENT",
      scheme: "exact",
      verification: c.mode,
      note: c.enabled
        ? "Pay USDC to wallet_address on the given network, then retry with an X-PAYMENT header (base64 JSON: {payload:{txHash}})."
        : "Paywall disabled (no receiver configured); all endpoints are currently free.",
    },
  };
}

/** The 402 body for a given resource. */
function buildRequirements(c, resource) {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: c.network,
        maxAmountRequired: c.priceAtomic,
        resource,
        description: `GitTimes agent API — ${resource}`,
        mimeType: "application/json",
        payTo: c.receiver,
        maxTimeoutSeconds: c.maxTimeoutSeconds,
        asset: c.usdc,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
    error: "Payment required",
  };
}

// --- replay protection (SQLite) ---

function isConsumed(dataDir, txHash) {
  const conn = db.getDb(dataDir);
  return !!conn
    .prepare("SELECT 1 FROM x402_payments WHERE tx_hash = ?")
    .get(txHash.toLowerCase());
}

function consume(dataDir, txHash, resource, amount, nowIso) {
  const conn = db.getDb(dataDir);
  conn
    .prepare(
      "INSERT OR IGNORE INTO x402_payments (tx_hash, resource, amount, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(txHash.toLowerCase(), resource, String(amount), nowIso || new Date().toISOString());
}

// --- verification ---

async function rpc(c, method, params) {
  const resp = await fetch(c.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await resp.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

/** Verify a real USDC Transfer to the receiver in the given tx. */
async function verifyOnChain(txHash, c) {
  let receipt;
  try {
    receipt = await rpc(c, "eth_getTransactionReceipt", [txHash]);
  } catch (err) {
    return { ok: false, error: `RPC failure: ${err.message}` };
  }
  if (!receipt) return { ok: false, error: "transaction not found or not yet mined" };
  if (receipt.status !== "0x1") return { ok: false, error: "transaction failed on-chain" };

  const want = BigInt(c.priceAtomic);
  const recv = c.receiver.toLowerCase();
  for (const log of receipt.logs || []) {
    if ((log.address || "").toLowerCase() !== c.usdc.toLowerCase()) continue;
    if ((log.topics[0] || "").toLowerCase() !== TRANSFER_TOPIC) continue;
    // topics[2] = indexed `to`, left-padded to 32 bytes
    const to = "0x" + (log.topics[2] || "").slice(-40).toLowerCase();
    if (to !== recv) continue;
    const value = BigInt(log.data); // uint256 amount
    if (value < want) continue;
    // Freshness: reject stale transfers so an attacker can't claim an arbitrary
    // old inbound transfer to the receiver. Defense-in-depth only — the full fix
    // is binding payment to a server-minted nonce (see SECURITY note in checkPayment).
    const freshnessSec = parseInt(process.env.X402_FRESHNESS_SECONDS || "900", 10);
    try {
      const block = await rpc(c, "eth_getBlockByNumber", [receipt.blockNumber, false]);
      const tsMs = parseInt(block.timestamp, 16) * 1000;
      if (Date.now() - tsMs > freshnessSec * 1000) {
        return { ok: false, error: "payment transaction is stale; send a fresh payment" };
      }
    } catch {
      // RPC hiccup fetching the block — don't hard-fail a verified transfer.
    }
    return { ok: true, amount: value.toString() };
  }
  return {
    ok: false,
    error: "no USDC transfer to the receiver wallet for the required amount in this tx",
  };
}

/** Deterministic test verification (X402_MODE=sim). */
function verifySim(payment, c) {
  const p = payment.payload || payment;
  if (!p.txHash || !String(p.txHash).startsWith("0xsim")) {
    return { ok: false, error: "sim: txHash must start with 0xsim" };
  }
  if ((p.to || "").toLowerCase() !== c.receiver.toLowerCase()) {
    return { ok: false, error: "sim: transfer not addressed to receiver" };
  }
  if (BigInt(p.amount || "0") < BigInt(c.priceAtomic)) {
    return { ok: false, error: "sim: underpaid" };
  }
  return { ok: true, amount: String(p.amount) };
}

/**
 * Gate a paid resource.
 * @returns {Promise<{ok:true, txHash?, free?:true} | {ok:false, status:402|400, requirements?, error?}>}
 */
// SECURITY (before enabling the paywall in prod): payment is currently matched by
// "a USDC transfer of >= price to the receiver, used once, recently". It is NOT yet
// bound to a server-minted nonce, so a fresh inbound transfer to the receiver from an
// unrelated party could in principle be claimed once. Before monetizing, bind the
// payment to a per-request nonce (EIP-3009 / facilitator) — tracked as a hard gate.
async function checkPayment(req, resource, dataDir) {
  const c = config();
  if (!c.enabled) return { ok: true, free: true };

  const header = req.headers["x-payment"];
  if (!header) {
    return { ok: false, status: 402, requirements: buildRequirements(c, resource) };
  }

  let payment;
  try {
    payment = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return { ok: false, status: 400, error: "malformed X-PAYMENT header (expected base64 JSON)" };
  }

  const txHash = payment?.payload?.txHash || payment?.txHash;
  if (!txHash) {
    return { ok: false, status: 400, error: "X-PAYMENT missing payload.txHash" };
  }

  if (isConsumed(dataDir, txHash)) {
    return { ok: false, status: 402, error: "payment already used", requirements: buildRequirements(c, resource) };
  }

  const verified = c.mode === "sim" ? verifySim(payment, c) : await verifyOnChain(txHash, c);
  if (!verified.ok) {
    return { ok: false, status: 402, error: verified.error, requirements: buildRequirements(c, resource) };
  }

  consume(dataDir, txHash, resource, verified.amount);
  return { ok: true, txHash };
}

module.exports = {
  config,
  paymentInfo,
  buildRequirements,
  checkPayment,
  verifyOnChain,
  verifySim,
  isConsumed,
  consume,
  TRANSFER_TOPIC,
};
