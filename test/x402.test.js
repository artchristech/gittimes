const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("node:http");

const x402 = require("../src/x402");
const db = require("../src/db");

const RECEIVER = "0x000000000000000000000000000000000000dEaD";
let TMP;

const mockReq = (headers) => ({ headers: headers || {} });
const payHeader = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");

describe("x402 middleware", () => {
  before(() => {
    TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gt-x402-"));
    process.env.X402_RECEIVER = RECEIVER;
    process.env.X402_MODE = "sim";
    process.env.X402_ALLOW_SIM = "true"; // sim must be explicitly opted in (fail-closed in prod)
    process.env.X402_PRICE_USDC = "0.01";
    process.env.X402_NETWORK = "base";
  });

  after(() => {
    db.closeDb();
    delete process.env.X402_RECEIVER;
    delete process.env.X402_MODE;
    delete process.env.X402_ALLOW_SIM;
    delete process.env.X402_PRICE_USDC;
    delete process.env.X402_NETWORK;
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });

  it("paymentInfo reflects config", () => {
    const info = x402.paymentInfo();
    assert.equal(info.enabled, true);
    assert.equal(info.wallet_address, RECEIVER);
    assert.equal(info.price_atomic, "10000"); // 0.01 USDC * 1e6
    assert.equal(info.chain_id, 8453);
    assert.equal(info.info.verification, "sim");
  });

  it("no X-PAYMENT yields 402 with self-describing accepts[]", async () => {
    const r = await x402.checkPayment(mockReq(), "/api/trending", TMP);
    assert.equal(r.ok, false);
    assert.equal(r.status, 402);
    const req0 = r.requirements.accepts[0];
    assert.equal(req0.payTo, RECEIVER);
    assert.equal(req0.maxAmountRequired, "10000");
    assert.equal(req0.scheme, "exact");
    assert.equal(req0.resource, "/api/trending");
  });

  it("valid sim payment passes the gate", async () => {
    const hdr = payHeader({ scheme: "exact", payload: { txHash: "0xsim_ok", to: RECEIVER, amount: "10000" } });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP);
    assert.equal(r.ok, true);
    assert.equal(r.txHash, "0xsim_ok");
  });

  it("replayed txHash is rejected", async () => {
    const hdr = payHeader({ payload: { txHash: "0xsim_replay", to: RECEIVER, amount: "10000" } });
    const first = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP);
    assert.equal(first.ok, true);
    const second = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP);
    assert.equal(second.ok, false);
    assert.match(second.error, /already used/);
  });

  it("underpayment is rejected", async () => {
    const hdr = payHeader({ payload: { txHash: "0xsim_under", to: RECEIVER, amount: "1" } });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP);
    assert.equal(r.ok, false);
    assert.match(r.error, /underpaid/);
  });

  it("transfer to the wrong receiver is rejected", async () => {
    const hdr = payHeader({ payload: { txHash: "0xsim_wrong", to: "0x0000000000000000000000000000000000000001", amount: "10000" } });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP);
    assert.equal(r.ok, false);
  });

  it("malformed X-PAYMENT yields 400", async () => {
    const r = await x402.checkPayment(mockReq({ "x-payment": "@@@not-valid@@@" }), "/api/trending", TMP);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  it("sim mode is refused unless X402_ALLOW_SIM=true (fails closed to facilitator)", () => {
    delete process.env.X402_ALLOW_SIM;
    assert.equal(x402.config().mode, "facilitator"); // sim ignored without opt-in
    process.env.X402_ALLOW_SIM = "true";
    assert.equal(x402.config().mode, "sim"); // restored
  });

  it("paywall is open (free) when no receiver is configured", async () => {
    delete process.env.X402_RECEIVER;
    const r = await x402.checkPayment(mockReq(), "/api/trending", TMP);
    assert.equal(r.ok, true);
    assert.equal(r.free, true);
    process.env.X402_RECEIVER = RECEIVER; // restore for any later tests
  });
});

describe("x402 facilitator mode (EIP-3009)", () => {
  const PAYER = "0x857b06519E91e3A54538791bDbb0E22373e36b66";
  let TMP2, server, facUrl;
  // Per-test overridable facilitator behavior; default = verify ok, settle ok.
  let respond;
  let defaultRespond;
  let lastAuth; // Authorization header the facilitator last received

  const facPay = (over = {}) =>
    payHeader({
      x402Version: 1,
      scheme: "exact",
      network: "base",
      payload: {
        signature: over.signature !== undefined ? over.signature : "0xsig",
        authorization: over.authorization !== undefined ? over.authorization : {
          from: PAYER,
          to: over.to || RECEIVER,
          value: over.value || "10000",
          validAfter: "0",
          validBefore: "99999999999",
          nonce: over.nonce || "0xnonce_default",
        },
      },
    });

  before(async () => {
    TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), "gt-x402fac-"));
    defaultRespond = (p, body) =>
      p.endsWith("/verify")
        ? { status: 200, body: { isValid: true, payer: body.paymentPayload.payload.authorization.from } }
        : { status: 200, body: { success: true, transaction: "0xsettled_tx", network: "eip155:8453" } };
    respond = defaultRespond;
    server = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        let buf = "";
        req.on("data", (d) => (buf += d));
        req.on("end", () => {
          lastAuth = req.headers["authorization"];
          const out = respond(req.url, buf ? JSON.parse(buf) : {});
          res.writeHead(out.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(out.body));
        });
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    facUrl = `http://127.0.0.1:${server.address().port}`;
    process.env.X402_RECEIVER = RECEIVER;
    process.env.X402_MODE = "facilitator";
    process.env.X402_PRICE_USDC = "0.01";
    process.env.X402_NETWORK = "base";
    process.env.X402_FACILITATOR_URL = facUrl;
    delete process.env.X402_ALLOW_SIM;
  });

  after(() => {
    db.closeDb();
    if (server) server.close();
    delete process.env.X402_RECEIVER;
    delete process.env.X402_MODE;
    delete process.env.X402_PRICE_USDC;
    delete process.env.X402_NETWORK;
    delete process.env.X402_FACILITATOR_URL;
    try { fs.rmSync(TMP2, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });

  it("config defaults to facilitator mode when a receiver is set", () => {
    const c = x402.config();
    assert.equal(c.mode, "facilitator");
    assert.equal(c.facilitatorUrl, facUrl);
    assert.equal(c.caip2, "eip155:8453");
  });

  it("402 body advertises the exact scheme + EIP-712 domain in extra", async () => {
    const r = await x402.checkPayment(mockReq(), "/api/trending", TMP2);
    assert.equal(r.status, 402);
    const req0 = r.requirements.accepts[0];
    assert.equal(req0.scheme, "exact");
    assert.equal(req0.payTo, RECEIVER);
    assert.equal(req0.extra.name, "USD Coin");
    assert.equal(req0.extra.version, "2");
  });

  it("valid signed authorization verifies, settles, and returns the settlement tx", async () => {
    const hdr = facPay({ nonce: "0xnonce_ok" });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(r.ok, true);
    assert.equal(r.txHash, "0xsettled_tx");
  });

  it("replayed authorization nonce is rejected", async () => {
    const hdr = facPay({ nonce: "0xnonce_replay" });
    const first = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(first.ok, true);
    const second = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(second.ok, false);
    assert.match(second.error, /already used/);
  });

  it("authorization to the wrong receiver is rejected before hitting the facilitator", async () => {
    const hdr = facPay({ nonce: "0xnonce_wrongto", to: "0x0000000000000000000000000000000000000001" });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(r.ok, false);
    assert.match(r.error, /not addressed to the receiver/);
  });

  it("underpaying authorization is rejected", async () => {
    const hdr = facPay({ nonce: "0xnonce_under", value: "1" });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(r.ok, false);
    assert.match(r.error, /underpay/);
  });

  it("missing signature/authorization yields 400", async () => {
    const hdr = payHeader({ x402Version: 1, scheme: "exact", network: "base", payload: {} });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  it("facilitator rejecting the signature (isValid:false) yields 402", async () => {
    respond = (p) =>
      p.endsWith("/verify")
        ? { status: 200, body: { isValid: false, invalidReason: "invalid_signature" } }
        : { status: 200, body: { success: true, transaction: "0xshould_not_settle" } };
    const hdr = facPay({ nonce: "0xnonce_badsig" });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(r.ok, false);
    assert.equal(r.status, 402);
    assert.match(r.error, /invalid/);
  });

  it("settlement failure (success:false) yields 402 and does not consume the nonce", async () => {
    respond = (p) =>
      p.endsWith("/verify")
        ? { status: 200, body: { isValid: true } }
        : { status: 200, body: { success: false, errorReason: "insufficient_funds" } };
    const hdr = facPay({ nonce: "0xnonce_settlefail" });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(r.ok, false);
    assert.equal(r.status, 402);
    // nonce must remain claimable after a settle failure
    assert.equal(x402.isConsumed(TMP2, `${PAYER.toLowerCase()}:0xnonce_settlefail`), false);
  });

  it("facilitator transport failure yields 502", async () => {
    const prev = process.env.X402_FACILITATOR_URL;
    process.env.X402_FACILITATOR_URL = "http://127.0.0.1:1"; // unroutable
    const hdr = facPay({ nonce: "0xnonce_down" });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(r.ok, false);
    assert.equal(r.status, 502);
    process.env.X402_FACILITATOR_URL = prev;
  });

  it("no facilitator key → requests carry no Authorization header", async () => {
    assert.equal(x402.config().facilitatorAuth, "none");
    lastAuth = "sentinel";
    const hdr = facPay({ nonce: "0xnonce_noauth" });
    await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(lastAuth, undefined);
  });

  it("X402_FACILITATOR_KEY → static Bearer reaches the facilitator", async () => {
    respond = defaultRespond; // reset after the earlier failure-path tests
    process.env.X402_FACILITATOR_KEY = "testkey123";
    assert.equal(x402.config().facilitatorAuth, "bearer");
    const hdr = facPay({ nonce: "0xnonce_bearer" });
    const r = await x402.checkPayment(mockReq({ "x-payment": hdr }), "/api/trending", TMP2);
    assert.equal(r.ok, true);
    assert.equal(lastAuth, "Bearer testkey123");
    delete process.env.X402_FACILITATOR_KEY;
  });

  it("CDP keys switch auth to cdp and auto-target the CDP facilitator URL", () => {
    const prevUrl = process.env.X402_FACILITATOR_URL;
    delete process.env.X402_FACILITATOR_URL; // let it default
    process.env.CDP_API_KEY_ID = "cdp-key-id";
    process.env.CDP_API_KEY_SECRET = "cdp-secret";
    const c = x402.config();
    assert.equal(c.facilitatorAuth, "cdp");
    assert.equal(c.facilitatorUrl, "https://api.cdp.coinbase.com/platform/v2/x402");
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
    if (prevUrl) process.env.X402_FACILITATOR_URL = prevUrl;
  });

  it("CDP auth without @coinbase/cdp-sdk installed throws an actionable error", async () => {
    process.env.CDP_API_KEY_ID = "cdp-key-id";
    process.env.CDP_API_KEY_SECRET = "cdp-secret";
    await assert.rejects(
      () => x402.authHeadersFor(x402.config(), "/verify"),
      /@coinbase\/cdp-sdk/
    );
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
  });
});
