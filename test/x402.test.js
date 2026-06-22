const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

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
    process.env.X402_PRICE_USDC = "0.01";
    process.env.X402_NETWORK = "base";
  });

  after(() => {
    db.closeDb();
    delete process.env.X402_RECEIVER;
    delete process.env.X402_MODE;
    delete process.env.X402_PRICE_USDC;
    delete process.env.X402_NETWORK;
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
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

  it("paywall is open (free) when no receiver is configured", async () => {
    delete process.env.X402_RECEIVER;
    const r = await x402.checkPayment(mockReq(), "/api/trending", TMP);
    assert.equal(r.ok, true);
    assert.equal(r.free, true);
    process.env.X402_RECEIVER = RECEIVER; // restore for any later tests
  });
});
