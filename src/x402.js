/**
 * x402 payment middleware for the GitTimes agent API — zero external deps.
 *
 * Implements the x402 "exact" scheme (EIP-3009 `transferWithAuthorization`)
 * settled through a hosted facilitator, so each payment is cryptographically
 * bound to a signed authorization naming our receiver and exact amount:
 *
 *   1. An unpaid request to a paid resource gets HTTP 402 + a self-describing
 *      `accepts[]` payment-requirements body (the agent learns
 *      scheme/network/asset/payTo/price + the EIP-712 domain in `extra`).
 *   2. The agent signs an EIP-3009 authorization (off-chain, gasless) and
 *      retries with an `X-PAYMENT` header — base64 JSON of
 *      `{ x402Version, scheme, network, payload:{ signature, authorization } }`.
 *   3. We POST that to the facilitator's `/verify` then `/settle`. The
 *      facilitator checks the EIP-712 signature and submits the authorization
 *      on-chain (it pays gas). We replay-protect the authorization nonce in
 *      SQLite as defense-in-depth and serve 200.
 *
 * Why this is safe to monetize (closes the F3 "claimable transfer" gate):
 * verification is no longer "find any USDC Transfer to the receiver" — a
 * payment is a signature over an authorization that pays *us*, settled exactly
 * once (EIP-3009's on-chain nonce prevents replay). An unrelated inbound
 * transfer cannot be claimed as a payment because there is nothing to settle.
 *
 * Modes (X402_MODE):
 *   - "off"          : no receiver configured → paywall disabled, all free.
 *   - "facilitator"  : verify + settle via the configured facilitator (default
 *                      when a receiver is set; legacy value "onchain" aliases here).
 *   - "sim"          : accept a deterministic test payment (txHash starts
 *                      "0xsim") with no network, for end-to-end tests. Must be
 *                      explicitly opted into (X402_ALLOW_SIM=true); never in prod.
 *
 * Config (env): X402_RECEIVER (enables the paywall), X402_PRICE_USDC (default
 * 0.01), X402_NETWORK (base | base-sepolia), X402_USDC, X402_MODE,
 * X402_FACILITATOR_URL (default https://x402.org/facilitator),
 * X402_FACILITATOR_KEY (optional bearer token), X402_VERSION (default 1).
 */

const db = require("./db");

const NETWORKS = {
  base: {
    chainId: 8453,
    caip2: "eip155:8453",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  "base-sepolia": {
    chainId: 84532,
    caip2: "eip155:84532",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
};

const DEFAULT_FACILITATOR = "https://x402.org/facilitator";
const CDP_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";

function config() {
  const network = process.env.X402_NETWORK || "base";
  const net = NETWORKS[network] || NETWORKS.base;
  const receiver = process.env.X402_RECEIVER || null;
  const priceUsdc = parseFloat(process.env.X402_PRICE_USDC || "0.01");
  let mode = receiver ? process.env.X402_MODE || "facilitator" : "off";
  // Legacy alias: the old self-RPC "onchain" path is superseded by the facilitator.
  if (mode === "onchain") mode = "facilitator";
  // Fail closed: sim mode accepts fabricated payments, so it must be explicitly
  // opted into (tests/dev). A stray X402_MODE=sim in prod falls back to facilitator.
  if (mode === "sim" && process.env.X402_ALLOW_SIM !== "true") mode = "facilitator";

  // Facilitator auth: Coinbase CDP (signed JWT, gas-sponsored on Base) when its
  // keys are present, else a static bearer, else none (keyless/self-hosted).
  const cdpKeyId = process.env.CDP_API_KEY_ID || null;
  const cdpKeySecret = process.env.CDP_API_KEY_SECRET || null;
  const cdp = !!(cdpKeyId && cdpKeySecret);
  const facilitatorAuth = cdp ? "cdp" : process.env.X402_FACILITATOR_KEY ? "bearer" : "none";
  // If CDP keys are set and no explicit facilitator URL, target CDP automatically.
  const defaultFacilitator = cdp ? CDP_FACILITATOR : DEFAULT_FACILITATOR;

  return {
    enabled: !!receiver,
    mode,
    network,
    caip2: net.caip2,
    chainId: net.chainId,
    usdc: process.env.X402_USDC || net.usdc,
    receiver,
    priceUsdc,
    priceAtomic: String(Math.round(priceUsdc * 1e6)), // USDC has 6 decimals
    maxTimeoutSeconds: 60,
    facilitatorUrl: (process.env.X402_FACILITATOR_URL || defaultFacilitator).replace(/\/+$/, ""),
    facilitatorKey: process.env.X402_FACILITATOR_KEY || null,
    facilitatorAuth,
    cdpKeyId,
    cdpKeySecret,
    x402Version: parseInt(process.env.X402_VERSION || "1", 10),
  };
}

/**
 * Per-request auth headers for the facilitator, mirroring the official
 * `createAuthHeaders` hook: CDP needs a fresh signed JWT bound to the exact
 * request path; a static bearer covers keyless/self-hosted facilitators.
 */
async function authHeadersFor(c, endpoint) {
  if (c.facilitatorAuth === "cdp") {
    return require("./x402-cdp").cdpAuthHeader(c, endpoint);
  }
  if (c.facilitatorAuth === "bearer") {
    return { Authorization: `Bearer ${c.facilitatorKey}` };
  }
  return {};
}

/** Discovery document — GET /v1/payment/info */
function paymentInfo() {
  const c = config();
  return {
    x402Version: c.x402Version,
    protocol: "x402-exact-eip3009",
    enabled: c.enabled,
    network: c.network,
    chain_id: c.chainId,
    usdc_contract: c.usdc,
    wallet_address: c.receiver,
    price_per_call_usdc: c.priceUsdc,
    price_atomic: c.priceAtomic,
    facilitator: c.enabled ? c.facilitatorUrl : null,
    info: {
      header: "X-PAYMENT",
      scheme: "exact",
      verification: c.mode,
      note: c.enabled
        ? "Sign an EIP-3009 transferWithAuthorization for price_atomic USDC to wallet_address on the given network, then retry with an X-PAYMENT header (base64 JSON: {x402Version,scheme:'exact',network,payload:{signature,authorization}}). Settlement is gasless via the facilitator. Tip: use the x402-fetch client."
        : "Paywall disabled (no receiver configured); all endpoints are currently free.",
    },
  };
}

/** A single payment-requirement object (facilitator `paymentRequirements`). */
function requirementFor(c, resource) {
  return {
    scheme: "exact",
    network: c.network,
    maxAmountRequired: c.priceAtomic,
    resource,
    description: `GitTimes agent API — ${resource}`,
    mimeType: "application/json",
    payTo: c.receiver,
    maxTimeoutSeconds: c.maxTimeoutSeconds,
    asset: c.usdc,
    // EIP-712 domain fields the client needs to sign the USDC authorization.
    extra: { name: "USD Coin", version: "2" },
  };
}

/** The full 402 body for a given resource. */
function buildRequirements(c, resource) {
  return {
    x402Version: c.x402Version,
    accepts: [requirementFor(c, resource)],
    error: "Payment required",
  };
}

// --- replay protection (SQLite) ---
// The `tx_hash` column is the single-use payment id: the settlement tx hash in
// facilitator mode is not known until after /settle, so we key replay on the
// EIP-3009 authorization identity (`from:nonce`) — unique per signed payment.

function isConsumed(dataDir, payId) {
  const conn = db.getDb(dataDir);
  return !!conn
    .prepare("SELECT 1 FROM x402_payments WHERE tx_hash = ?")
    .get(String(payId).toLowerCase());
}

function consume(dataDir, payId, resource, amount, nowIso) {
  const conn = db.getDb(dataDir);
  conn
    .prepare(
      "INSERT OR IGNORE INTO x402_payments (tx_hash, resource, amount, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(String(payId).toLowerCase(), resource, String(amount), nowIso || new Date().toISOString());
}

// --- facilitator verification + settlement ---

async function facilitatorCall(c, endpoint, paymentPayload, requirement) {
  const headers = { "Content-Type": "application/json", ...(await authHeadersFor(c, endpoint)) };
  const resp = await fetch(`${c.facilitatorUrl}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      x402Version: c.x402Version,
      paymentPayload,
      paymentRequirements: requirement,
    }),
  });
  const text = await resp.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`facilitator ${endpoint} returned non-JSON (${resp.status}): ${text.slice(0, 160)}`);
  }
  if (!resp.ok) {
    const reason = body.invalidReason || body.errorReason || body.error || text.slice(0, 160);
    throw new Error(`facilitator ${endpoint} ${resp.status}: ${reason}`);
  }
  return body;
}

/**
 * Verify then settle an EIP-3009 payment via the facilitator.
 * @returns {Promise<{ok:true, txHash:string|null} | {ok:false, status:number, error:string}>}
 */
async function verifyFacilitator(paymentPayload, c, resource) {
  const auth = paymentPayload && paymentPayload.payload && paymentPayload.payload.authorization;
  const signature = paymentPayload && paymentPayload.payload && paymentPayload.payload.signature;
  if (!auth || !signature) {
    return { ok: false, status: 400, error: "X-PAYMENT missing payload.authorization or payload.signature" };
  }
  if ((auth.to || "").toLowerCase() !== c.receiver.toLowerCase()) {
    return { ok: false, status: 402, error: "authorization is not addressed to the receiver wallet" };
  }
  if (BigInt(auth.value || "0") < BigInt(c.priceAtomic)) {
    return { ok: false, status: 402, error: "authorization underpays the required amount" };
  }

  const requirement = requirementFor(c, resource);
  let verify;
  try {
    verify = await facilitatorCall(c, "/verify", paymentPayload, requirement);
  } catch (err) {
    return { ok: false, status: 502, error: `facilitator verify failed: ${err.message}` };
  }
  const isValid = verify.isValid !== undefined ? verify.isValid : verify.valid;
  if (!isValid) {
    return { ok: false, status: 402, error: `payment invalid: ${verify.invalidReason || "rejected by facilitator"}` };
  }

  let settle;
  try {
    settle = await facilitatorCall(c, "/settle", paymentPayload, requirement);
  } catch (err) {
    return { ok: false, status: 502, error: `facilitator settle failed: ${err.message}` };
  }
  const settled =
    settle.success !== undefined
      ? settle.success
      : settle.status === "success" || !!settle.transactionHash;
  if (!settled) {
    return { ok: false, status: 402, error: `settlement failed: ${settle.errorReason || "not settled"}` };
  }
  return { ok: true, txHash: settle.transaction || settle.transactionHash || null };
}

/** Deterministic test verification (X402_MODE=sim, no network). */
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

// --- gate ---

async function checkSim(payment, c, resource, dataDir) {
  const txHash = (payment && payment.payload && payment.payload.txHash) || (payment && payment.txHash);
  if (!txHash) {
    return { ok: false, status: 400, error: "X-PAYMENT missing payload.txHash" };
  }
  if (isConsumed(dataDir, txHash)) {
    return { ok: false, status: 402, error: "payment already used", requirements: buildRequirements(c, resource) };
  }
  const verified = verifySim(payment, c);
  if (!verified.ok) {
    return { ok: false, status: 402, error: verified.error, requirements: buildRequirements(c, resource) };
  }
  consume(dataDir, txHash, resource, verified.amount);
  return { ok: true, txHash };
}

async function checkFacilitator(payment, c, resource, dataDir) {
  const auth = payment && payment.payload && payment.payload.authorization;
  if (!auth) {
    return { ok: false, status: 400, error: "X-PAYMENT missing payload.authorization or payload.signature" };
  }
  const payId = `${(auth.from || "").toLowerCase()}:${(auth.nonce || "").toLowerCase()}`;
  if (isConsumed(dataDir, payId)) {
    return { ok: false, status: 402, error: "payment already used", requirements: buildRequirements(c, resource) };
  }
  const result = await verifyFacilitator(payment, c, resource);
  if (!result.ok) {
    // Re-send the 402 requirements so the agent can pay again on a soft failure.
    if (result.status === 402) result.requirements = buildRequirements(c, resource);
    return result;
  }
  consume(dataDir, payId, resource, auth.value);
  return { ok: true, txHash: result.txHash };
}

/**
 * Gate a paid resource.
 * @returns {Promise<{ok:true, txHash?, free?:true} | {ok:false, status, requirements?, error?}>}
 */
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

  if (c.mode === "sim") return checkSim(payment, c, resource, dataDir);
  return checkFacilitator(payment, c, resource, dataDir);
}

module.exports = {
  config,
  paymentInfo,
  requirementFor,
  buildRequirements,
  authHeadersFor,
  checkPayment,
  verifyFacilitator,
  verifySim,
  isConsumed,
  consume,
};
