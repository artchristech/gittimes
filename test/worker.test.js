const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// --- Load worker (strip ESM syntax for CJS compat) ---
function loadWorker() {
  let src = fs.readFileSync(path.join(__dirname, "..", "worker", "index.js"), "utf8");
  src = src.replace("export default handler;", "");
  src = src.replace("try { module.exports = handler; } catch {}", "module.exports = handler;");
  const Module = require("module");
  const m = new Module("worker-test");
  m.paths = Module._nodeModulePaths(path.join(__dirname, ".."));
  m._compile(src, path.join(__dirname, "..", "worker", "index.js"));
  return m.exports;
}

const worker = loadWorker();

// --- Mock KV ---
function createMockKV() {
  const store = new Map();
  return {
    async get(key, type) {
      const entry = store.get(key);
      if (!entry) return null;
      if (type === "json") {
        try { return JSON.parse(entry.value); } catch { return null; }
      }
      return entry.value;
    },
    async put(key, value, opts) {
      store.set(key, { value: typeof value === "string" ? value : JSON.stringify(value), ...(opts || {}) });
    },
    async delete(key) {
      store.delete(key);
    },
    async list() {
      const keys = Array.from(store.keys()).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: null };
    },
    _store: store,
  };
}

// --- Create mock env ---
function createMockEnv() {
  return {
    USERS: createMockKV(),
    SESSIONS: createMockKV(),
    MAGIC_LINKS: createMockKV(),
    SUBSCRIBERS: createMockKV(),
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_WEBHOOK_SECRET: "whsec_test_123",
    STRIPE_PRICE_ID: "price_test_123",
    OPENROUTER_API_KEY: "or_test_123",
    RESEND_API_KEY: "re_test_123",
    NEWSLETTER_SECRET: "newsletter_test_secret",
    ALLOWED_ORIGIN: "https://gittimes.com",
    ADMIN_TOKEN: "admin_test_token",
    CHAT_MONTHLY_LIMIT: "100",
    FREE_DAILY_CHAT_LIMIT: "3",
    STRIPE_PRICE_AMOUNT: "500",
  };
}

// --- Helper: create session + user in KV ---
async function createSession(env, email, plan, extra) {
  const token = "sess_" + Math.random().toString(36).slice(2);
  const user = {
    email,
    plan: plan || "free",
    createdAt: new Date().toISOString(),
    subscribedToNewsletter: true,
    ...(extra || {}),
  };
  await env.USERS.put(email, JSON.stringify(user));
  await env.SESSIONS.put(
    token,
    JSON.stringify({
      email,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  );
  return token;
}

// --- Helper: build Request ---
function req(method, pathname, opts) {
  opts = opts || {};
  const url = "https://worker.test" + pathname;
  const headers = new Headers(opts.headers || {});
  if (opts.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const init = { method, headers };
  if (opts.body) init.body = JSON.stringify(opts.body);
  if (opts.rawBody) init.body = opts.rawBody;
  return new Request(url, init);
}

// --- Helper: generate valid Stripe webhook signature ---
async function stripeSign(payload, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${payload}`));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${ts},v1=${hex}`;
}

// --- Helper: generate unsubscribe token (mirrors worker logic) ---
async function unsubToken(email, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(email));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

// --- Test suite ---
let env;
let origFetch;
let mockFetchFn;

let lastChatRequest;

describe("Worker endpoints", () => {
  beforeEach(() => {
    env = createMockEnv();
    lastChatRequest = null;
    origFetch = globalThis.fetch;
    mockFetchFn = (url, opts) => {
      if (url.includes("resend.com"))
        return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
      if (url.includes("api.stripe.com/v1/customers/"))
        return new Response(JSON.stringify({ id: "cus_1", email: "test@test.com" }), { status: 200 });
      if (url.includes("api.stripe.com/v1/prices/"))
        return new Response(
          JSON.stringify({ unit_amount: 500, currency: "usd", recurring: { interval: "month" } }),
          { status: 200 },
        );
      if (url.includes("billing_portal/sessions"))
        return new Response(JSON.stringify({ url: "https://billing.stripe.com/test" }), { status: 200 });
      if (url.includes("checkout/sessions") && opts?.method === "POST")
        return new Response(JSON.stringify({ url: "https://checkout.stripe.com/test" }), { status: 200 });
      if (url.includes("api.stripe.com/v1/subscriptions/") && opts?.method === "DELETE")
        return new Response(JSON.stringify({ status: "canceled" }), { status: 200 });
      if (url.includes("openrouter.ai")) {
        lastChatRequest = { url, opts };
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
            c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            c.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }
      return new Response("unmocked: " + url, { status: 500 });
    };
    globalThis.fetch = (url, opts) => Promise.resolve(mockFetchFn(url, opts));
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  // --- OPTIONS ---
  describe("OPTIONS (CORS preflight)", () => {
    it("returns 204 with CORS headers", async () => {
      const res = await worker.fetch(req("OPTIONS", "/auth/me"), env);
      assert.equal(res.status, 204);
      assert.equal(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
    });
  });

  // --- POST /auth/send-magic-link ---
  describe("POST /auth/send-magic-link", () => {
    it("sends magic link for valid email", async () => {
      const res = await worker.fetch(
        req("POST", "/auth/send-magic-link", {
          body: { email: "user@test.com" },
          headers: { "CF-Connecting-IP": "1.2.3.4" },
        }),
        env,
      );
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(data.message.includes("email"));
    });

    it("rejects invalid email", async () => {
      const res = await worker.fetch(
        req("POST", "/auth/send-magic-link", {
          body: { email: "not-an-email" },
          headers: { "CF-Connecting-IP": "1.2.3.4" },
        }),
        env,
      );
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("valid email"));
    });

    it("rate limits by email (3 per 15 min)", async () => {
      for (let i = 0; i < 3; i++) {
        await worker.fetch(
          req("POST", "/auth/send-magic-link", {
            body: { email: "spam@test.com" },
            headers: { "CF-Connecting-IP": `10.0.0.${i}` },
          }),
          env,
        );
      }
      const res = await worker.fetch(
        req("POST", "/auth/send-magic-link", {
          body: { email: "spam@test.com" },
          headers: { "CF-Connecting-IP": "10.0.0.99" },
        }),
        env,
      );
      assert.equal(res.status, 429);
    });

    it("creates user and subscriber on first request", async () => {
      await worker.fetch(
        req("POST", "/auth/send-magic-link", {
          body: { email: "new@test.com" },
          headers: { "CF-Connecting-IP": "1.2.3.4" },
        }),
        env,
      );
      const user = await env.USERS.get("new@test.com", "json");
      assert.equal(user.email, "new@test.com");
      assert.equal(user.plan, "free");
      const sub = await env.SUBSCRIBERS.get("new@test.com");
      assert.ok(sub);
    });
  });

  // --- GET /auth/verify ---
  describe("GET /auth/verify", () => {
    it("creates session for valid token", async () => {
      const token = "magic_valid";
      await env.MAGIC_LINKS.put(
        token,
        JSON.stringify({
          email: "user@test.com",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        }),
      );
      await env.USERS.put(
        "user@test.com",
        JSON.stringify({ email: "user@test.com", plan: "free", createdAt: new Date().toISOString() }),
      );
      const res = await worker.fetch(req("GET", "/auth/verify?token=" + token), env);
      assert.equal(res.status, 302);
      assert.ok(res.headers.get("Location").includes("gittimes.com/account/"));
      assert.ok(res.headers.get("Location").includes("token="));
    });

    it("redirects with error for missing token", async () => {
      const res = await worker.fetch(req("GET", "/auth/verify"), env);
      assert.equal(res.status, 302);
      assert.ok(res.headers.get("Location").includes("error=invalid_token"));
    });

    it("redirects with error for expired token", async () => {
      await env.MAGIC_LINKS.put(
        "expired_tok",
        JSON.stringify({
          email: "user@test.com",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      );
      const res = await worker.fetch(req("GET", "/auth/verify?token=expired_tok"), env);
      assert.equal(res.status, 302);
      assert.ok(res.headers.get("Location").includes("error=expired_token"));
    });
  });

  // --- GET /auth/me ---
  describe("GET /auth/me", () => {
    it("returns user for valid session", async () => {
      const token = await createSession(env, "user@test.com", "premium");
      const res = await worker.fetch(req("GET", "/auth/me", { headers: { Authorization: "Bearer " + token } }), env);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.user.plan, "premium");
      assert.equal(data.user.email, "user@test.com");
    });

    it("returns 401 without auth", async () => {
      const res = await worker.fetch(req("GET", "/auth/me"), env);
      assert.equal(res.status, 401);
    });

    it("resolves expired grace period to free", async () => {
      const token = await createSession(env, "grace@test.com", "premium", {
        gracePeriodEndsAt: new Date(Date.now() - 1000).toISOString(),
      });
      const res = await worker.fetch(req("GET", "/auth/me", { headers: { Authorization: "Bearer " + token } }), env);
      const data = await res.json();
      assert.equal(data.user.plan, "free");
    });

    it("keeps premium during active grace period", async () => {
      const token = await createSession(env, "grace2@test.com", "premium", {
        gracePeriodEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      const res = await worker.fetch(req("GET", "/auth/me", { headers: { Authorization: "Bearer " + token } }), env);
      const data = await res.json();
      assert.equal(data.user.plan, "premium");
    });

    it("includes chatUsage in response", async () => {
      const token = await createSession(env, "usage@test.com", "premium", {
        chatUsage: { month: "2026-03", count: 42 },
      });
      const res = await worker.fetch(req("GET", "/auth/me", { headers: { Authorization: "Bearer " + token } }), env);
      const data = await res.json();
      assert.deepEqual(data.user.chatUsage, { month: "2026-03", count: 42 });
      // Account page reads chatLimit from here instead of a hardcoded "/ 100".
      assert.equal(data.user.chatLimit, parseInt(env.CHAT_MONTHLY_LIMIT));
    });
  });

  // --- /auth/settings (account-synced reader preferences) ---
  describe("/auth/settings", () => {
    it("GET returns null when nothing saved yet", async () => {
      const token = await createSession(env, "s1@test.com", "free");
      const res = await worker.fetch(req("GET", "/auth/settings", { headers: { Authorization: "Bearer " + token } }), env);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.settings, null);
    });

    it("POST persists whitelisted settings, GET returns them", async () => {
      const token = await createSession(env, "s2@test.com", "free");
      const post = await worker.fetch(
        req("POST", "/auth/settings", {
          headers: { Authorization: "Bearer " + token },
          body: { settings: { theme: "dark", font: "mono", size: "large", width: "wide" } },
        }),
        env,
      );
      assert.equal((await post.json()).ok, true);
      const get = await worker.fetch(req("GET", "/auth/settings", { headers: { Authorization: "Bearer " + token } }), env);
      const data = await get.json();
      assert.deepEqual(data.settings, { theme: "dark", font: "mono", size: "large", width: "wide" });
      // Persisted onto the user record
      const user = await env.USERS.get("s2@test.com", "json");
      assert.equal(user.readerSettings.width, "wide");
    });

    it("POST drops unknown keys and caps value length", async () => {
      const token = await createSession(env, "s3@test.com", "free");
      const res = await worker.fetch(
        req("POST", "/auth/settings", {
          headers: { Authorization: "Bearer " + token },
          body: { settings: { width: "narrow", evil: "x", bgH: "1234567890123456789" } },
        }),
        env,
      );
      const data = await res.json();
      assert.equal(data.settings.width, "narrow");
      assert.equal("evil" in data.settings, false);
      assert.equal(data.settings.bgH.length, 16);
    });

    it("accepts a bare settings object (no wrapper)", async () => {
      const token = await createSession(env, "s4@test.com", "free");
      const res = await worker.fetch(
        req("POST", "/auth/settings", { headers: { Authorization: "Bearer " + token }, body: { width: "wide" } }),
        env,
      );
      assert.deepEqual((await res.json()).settings, { width: "wide" });
    });

    it("returns 401 without auth (GET and POST)", async () => {
      assert.equal((await worker.fetch(req("GET", "/auth/settings"), env)).status, 401);
      assert.equal((await worker.fetch(req("POST", "/auth/settings", { body: { width: "wide" } }), env)).status, 401);
    });
  });

  // --- POST /auth/logout ---
  describe("POST /auth/logout", () => {
    it("deletes session and returns ok", async () => {
      const token = await createSession(env, "user@test.com", "free");
      const res = await worker.fetch(req("POST", "/auth/logout", { headers: { Authorization: "Bearer " + token } }), env);
      const data = await res.json();
      assert.equal(data.ok, true);
      const session = await env.SESSIONS.get(token, "json");
      assert.equal(session, null);
    });
  });

  // --- POST /auth/delete-account ---
  describe("POST /auth/delete-account", () => {
    it("deletes user, subscriber, session, and cancels Stripe sub", async () => {
      const token = await createSession(env, "del@test.com", "premium", { stripeSubscriptionId: "sub_123" });
      await env.SUBSCRIBERS.put("del@test.com", JSON.stringify({ email: "del@test.com" }));
      const res = await worker.fetch(
        req("POST", "/auth/delete-account", { headers: { Authorization: "Bearer " + token } }),
        env,
      );
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(await env.USERS.get("del@test.com"), null);
      assert.equal(await env.SUBSCRIBERS.get("del@test.com"), null);
    });

    it("returns 401 without auth", async () => {
      const res = await worker.fetch(req("POST", "/auth/delete-account"), env);
      assert.equal(res.status, 401);
    });
  });

  // --- POST /subscribe ---
  describe("POST /subscribe", () => {
    it("subscribes new email", async () => {
      const res = await worker.fetch(req("POST", "/subscribe", { body: { email: "new@test.com" } }), env);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(data.message.includes("subscribed"));
      const sub = await env.SUBSCRIBERS.get("new@test.com");
      assert.ok(sub);
    });

    it("detects duplicate subscriber", async () => {
      await env.SUBSCRIBERS.put("dup@test.com", JSON.stringify({ email: "dup@test.com" }));
      const res = await worker.fetch(req("POST", "/subscribe", { body: { email: "dup@test.com" } }), env);
      const data = await res.json();
      assert.ok(data.message.includes("already"));
    });

    it("rejects invalid email", async () => {
      const res = await worker.fetch(req("POST", "/subscribe", { body: { email: "bad" } }), env);
      assert.equal(res.status, 400);
    });
  });

  // --- GET /checkout ---
  describe("GET /checkout", () => {
    it("redirects to Stripe for valid session", async () => {
      const token = await createSession(env, "buyer@test.com", "free");
      const res = await worker.fetch(req("GET", "/checkout?session_token=" + token), env);
      assert.equal(res.status, 303);
      assert.ok(res.headers.get("Location").includes("checkout.stripe.com"));
    });

    it("redirects to login when missing session token", async () => {
      const res = await worker.fetch(req("GET", "/checkout"), env);
      assert.equal(res.status, 302);
      assert.ok(res.headers.get("Location").includes("login_required"));
    });

    it("redirects to login for invalid session token", async () => {
      const res = await worker.fetch(req("GET", "/checkout?session_token=bogus"), env);
      assert.equal(res.status, 302);
      assert.ok(res.headers.get("Location").includes("login_required"));
    });

    it("uses the annual price when interval=annual and the annual SKU is configured", async () => {
      env.STRIPE_PRICE_ID_ANNUAL = "price_annual_456";
      const token = await createSession(env, "annual@test.com", "free");
      let captured = "";
      mockFetchFn = (url, opts) => {
        if (url.includes("checkout/sessions") && opts?.method === "POST") {
          captured = opts.body.toString();
          return new Response(JSON.stringify({ url: "https://checkout.stripe.com/annual" }), { status: 200 });
        }
        return new Response("", { status: 200 });
      };
      globalThis.fetch = (u, o) => Promise.resolve(mockFetchFn(u, o));
      const res = await worker.fetch(req("GET", "/checkout?session_token=" + token + "&interval=annual"), env);
      assert.equal(res.status, 303);
      assert.ok(captured.includes("price_annual_456"), "annual price used in checkout line item");
      assert.ok(captured.includes("annual"), "interval metadata recorded");
    });

    it("falls back to the monthly price when the annual SKU is not configured", async () => {
      const token = await createSession(env, "fallback@test.com", "free");
      let captured = "";
      mockFetchFn = (url, opts) => {
        if (url.includes("checkout/sessions") && opts?.method === "POST") {
          captured = opts.body.toString();
          return new Response(JSON.stringify({ url: "https://checkout.stripe.com/m" }), { status: 200 });
        }
        return new Response("", { status: 200 });
      };
      globalThis.fetch = (u, o) => Promise.resolve(mockFetchFn(u, o));
      await worker.fetch(req("GET", "/checkout?session_token=" + token + "&interval=annual"), env);
      assert.ok(captured.includes("price_test_123"), "fell back to the monthly price");
    });
  });

  // --- POST /stripe/webhook ---
  describe("POST /stripe/webhook", () => {
    async function webhookReq(event) {
      const payload = JSON.stringify(event);
      const sig = await stripeSign(payload, env.STRIPE_WEBHOOK_SECRET);
      return req("POST", "/stripe/webhook", {
        rawBody: payload,
        headers: { "stripe-signature": sig },
      });
    }

    it("handles checkout.session.completed — upgrades user", async () => {
      await env.USERS.put(
        "buyer@test.com",
        JSON.stringify({ email: "buyer@test.com", plan: "free", createdAt: new Date().toISOString() }),
      );
      const event = {
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: { customer_email: "buyer@test.com", customer: "cus_1", subscription: "sub_1" } },
      };
      const res = await worker.fetch(await webhookReq(event), env);
      const data = await res.json();
      assert.equal(data.received, true);
      const user = await env.USERS.get("buyer@test.com", "json");
      assert.equal(user.plan, "premium");
      assert.equal(user.stripeCustomerId, "cus_1");
      assert.equal(user.stripeSubscriptionId, "sub_1");
    });

    it("conversion alert fires to owner when ALERT_EMAIL set", async () => {
      env.ALERT_EMAIL = "mandalazenwave@gmail.com";
      await env.USERS.put(
        "convert@test.com",
        JSON.stringify({ email: "convert@test.com", plan: "free", createdAt: new Date().toISOString() }),
      );
      const resendCalls = [];
      mockFetchFn = (url, opts) => {
        if (url.includes("resend.com")) {
          resendCalls.push({ url, body: JSON.parse(opts.body) });
          return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
        }
        return new Response("", { status: 200 });
      };
      globalThis.fetch = (u, o) => Promise.resolve(mockFetchFn(u, o));
      const event = {
        id: "evt_alert",
        type: "checkout.session.completed",
        data: { object: { customer_email: "convert@test.com", customer: "cus_a", subscription: "sub_a" } },
      };
      const res = await worker.fetch(await webhookReq(event), env);
      assert.equal(res.status, 200);
      const alert = resendCalls.find(
        (c) => c.url.includes("api.resend.com/emails") && c.body.to.includes("mandalazenwave@gmail.com"),
      );
      assert.ok(alert, "expected a Resend POST targeting the owner alert address");
      const html = alert.body.html;
      assert.ok(html.includes("convert@test.com"), "alert includes converter email");
      assert.ok(html.includes("cus_a"), "alert includes customer id");
      assert.ok(html.includes("sub_a"), "alert includes subscription id");
    });

    it("webhook survives alert failure (still 200 + premium)", async () => {
      env.ALERT_EMAIL = "mandalazenwave@gmail.com";
      await env.USERS.put(
        "robust@test.com",
        JSON.stringify({ email: "robust@test.com", plan: "free", createdAt: new Date().toISOString() }),
      );
      // All Resend calls fail: the upgrade email returns !ok and the owner alert throws.
      mockFetchFn = (url, opts) => {
        if (url.includes("resend.com")) {
          if (opts.body && opts.body.includes("mandalazenwave@gmail.com")) {
            throw new Error("alert send blew up");
          }
          return new Response("err", { status: 500 });
        }
        return new Response("", { status: 200 });
      };
      globalThis.fetch = (u, o) => {
        try {
          return Promise.resolve(mockFetchFn(u, o));
        } catch (e) {
          return Promise.reject(e);
        }
      };
      const event = {
        id: "evt_robust",
        type: "checkout.session.completed",
        data: { object: { customer_email: "robust@test.com", customer: "cus_r", subscription: "sub_r" } },
      };
      const res = await worker.fetch(await webhookReq(event), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.received, true);
      const user = await env.USERS.get("robust@test.com", "json");
      assert.equal(user.plan, "premium");
    });

    it("handles customer.subscription.deleted — downgrades with churn tracking", async () => {
      await env.USERS.put(
        "churn@test.com",
        JSON.stringify({ email: "churn@test.com", plan: "premium", createdAt: new Date().toISOString() }),
      );
      mockFetchFn = (url) => {
        if (url.includes("customers/cus_churn"))
          return new Response(JSON.stringify({ email: "churn@test.com" }), { status: 200 });
        return new Response("", { status: 404 });
      };
      globalThis.fetch = (u, o) => Promise.resolve(mockFetchFn(u, o));
      const event = {
        id: "evt_2",
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_churn" } },
      };
      const res = await worker.fetch(await webhookReq(event), env);
      assert.equal(res.status, 200);
      const user = await env.USERS.get("churn@test.com", "json");
      assert.equal(user.plan, "free");
      assert.ok(user.cancelledAt);
      assert.equal(user.churnReason, "customer.subscription.deleted");
    });

    it("subscription.deleted clears grace period", async () => {
      await env.USERS.put(
        "grace@test.com",
        JSON.stringify({
          email: "grace@test.com",
          plan: "premium",
          createdAt: new Date().toISOString(),
          gracePeriodEndsAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      );
      mockFetchFn = (url) => {
        if (url.includes("customers/cus_gc"))
          return new Response(JSON.stringify({ email: "grace@test.com" }), { status: 200 });
        return new Response("", { status: 404 });
      };
      globalThis.fetch = (u, o) => Promise.resolve(mockFetchFn(u, o));
      const event = {
        id: "evt_gc",
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_gc" } },
      };
      await worker.fetch(await webhookReq(event), env);
      const user = await env.USERS.get("grace@test.com", "json");
      assert.equal(user.gracePeriodEndsAt, undefined);
    });

    it("handles invoice.payment_failed — sets grace period", async () => {
      await env.USERS.put(
        "fail@test.com",
        JSON.stringify({ email: "fail@test.com", plan: "premium", createdAt: new Date().toISOString() }),
      );
      mockFetchFn = (url) => {
        if (url.includes("customers/cus_fail"))
          return new Response(JSON.stringify({ email: "fail@test.com" }), { status: 200 });
        if (url.includes("resend.com"))
          return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
        return new Response("", { status: 404 });
      };
      globalThis.fetch = (u, o) => Promise.resolve(mockFetchFn(u, o));
      const event = {
        id: "evt_3",
        type: "invoice.payment_failed",
        data: { object: { customer: "cus_fail" } },
      };
      const res = await worker.fetch(await webhookReq(event), env);
      assert.equal(res.status, 200);
      const user = await env.USERS.get("fail@test.com", "json");
      assert.equal(user.plan, "premium"); // not downgraded yet
      assert.ok(user.gracePeriodEndsAt);
      const graceEnd = new Date(user.gracePeriodEndsAt).getTime();
      assert.ok(graceEnd > Date.now() + 2 * 24 * 60 * 60 * 1000); // ~3 days out
    });

    it("handles invoice.payment_succeeded — clears grace within window, stays premium", async () => {
      await env.USERS.put(
        "recover@test.com",
        JSON.stringify({
          email: "recover@test.com",
          plan: "premium",
          createdAt: new Date().toISOString(),
          gracePeriodEndsAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      );
      mockFetchFn = (url) => {
        if (url.includes("customers/cus_rec"))
          return new Response(JSON.stringify({ email: "recover@test.com" }), { status: 200 });
        return new Response("", { status: 404 });
      };
      globalThis.fetch = (u, o) => Promise.resolve(mockFetchFn(u, o));
      const event = {
        id: "evt_rec",
        type: "invoice.payment_succeeded",
        data: { object: { customer: "cus_rec" } },
      };
      const res = await worker.fetch(await webhookReq(event), env);
      assert.equal(res.status, 200);
      const user = await env.USERS.get("recover@test.com", "json");
      assert.equal(user.plan, "premium");
      assert.equal(user.gracePeriodEndsAt, undefined); // grace flag cleared
    });

    it("invoice.paid after grace lapsed — restores premium and the stat", async () => {
      // Simulate a user already downgraded to free after grace expired (premiumUsers was decremented).
      await env.USERS.put(
        "lapsed@test.com",
        JSON.stringify({ email: "lapsed@test.com", plan: "free", createdAt: new Date().toISOString() }),
      );
      await env.USERS.put("stats:premiumUsers", "0");
      mockFetchFn = (url) => {
        if (url.includes("customers/cus_lap"))
          return new Response(JSON.stringify({ email: "lapsed@test.com" }), { status: 200 });
        return new Response("", { status: 404 });
      };
      globalThis.fetch = (u, o) => Promise.resolve(mockFetchFn(u, o));
      const event = {
        id: "evt_lap",
        type: "invoice.paid",
        data: { object: { customer: "cus_lap" } },
      };
      const res = await worker.fetch(await webhookReq(event), env);
      assert.equal(res.status, 200);
      const user = await env.USERS.get("lapsed@test.com", "json");
      assert.equal(user.plan, "premium"); // re-promoted
      assert.equal(user.gracePeriodEndsAt, undefined);
      assert.equal(await env.USERS.get("stats:premiumUsers"), "1"); // count restored
    });

    it("invoice.payment_succeeded on a clean premium renewal is a no-op (no stat inflation)", async () => {
      await env.USERS.put(
        "renew@test.com",
        JSON.stringify({ email: "renew@test.com", plan: "premium", createdAt: new Date().toISOString() }),
      );
      await env.USERS.put("stats:premiumUsers", "5");
      mockFetchFn = (url) => {
        if (url.includes("customers/cus_ren"))
          return new Response(JSON.stringify({ email: "renew@test.com" }), { status: 200 });
        return new Response("", { status: 404 });
      };
      globalThis.fetch = (u, o) => Promise.resolve(mockFetchFn(u, o));
      const event = {
        id: "evt_ren",
        type: "invoice.payment_succeeded",
        data: { object: { customer: "cus_ren" } },
      };
      await worker.fetch(await webhookReq(event), env);
      const user = await env.USERS.get("renew@test.com", "json");
      assert.equal(user.plan, "premium");
      assert.equal(await env.USERS.get("stats:premiumUsers"), "5"); // unchanged
    });

    it("sends a win-back email on paid churn", async () => {
      await env.USERS.put(
        "winback@test.com",
        JSON.stringify({ email: "winback@test.com", plan: "premium", createdAt: new Date().toISOString() }),
      );
      const resendCalls = [];
      mockFetchFn = (url, opts) => {
        if (url.includes("customers/cus_wb"))
          return new Response(JSON.stringify({ email: "winback@test.com" }), { status: 200 });
        if (url.includes("resend.com")) {
          resendCalls.push(JSON.parse(opts.body));
          return new Response(JSON.stringify({ id: "m" }), { status: 200 });
        }
        return new Response("", { status: 404 });
      };
      globalThis.fetch = (u, o) => Promise.resolve(mockFetchFn(u, o));
      const event = {
        id: "evt_wb",
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_wb" } },
      };
      await worker.fetch(await webhookReq(event), env);
      const winback = resendCalls.find(
        (c) => c.to.includes("winback@test.com") && /ended|reactivate|come back/i.test(c.subject + c.html),
      );
      assert.ok(winback, "expected a win-back email to the churned user");
    });

    it("deduplicates webhook events (idempotency)", async () => {
      const event = {
        id: "evt_dup",
        type: "checkout.session.completed",
        data: { object: { customer_email: "dup@test.com", customer: "cus_1", subscription: "sub_1" } },
      };
      await worker.fetch(await webhookReq(event), env);
      const res = await worker.fetch(await webhookReq(event), env);
      const data = await res.json();
      assert.equal(data.deduplicated, true);
    });

    it("rejects invalid signature", async () => {
      const payload = JSON.stringify({ id: "evt_bad", type: "checkout.session.completed", data: { object: {} } });
      const res = await worker.fetch(
        req("POST", "/stripe/webhook", {
          rawBody: payload,
          headers: { "stripe-signature": "t=1234,v1=invalid" },
        }),
        env,
      );
      assert.equal(res.status, 400);
    });
  });

  // --- POST /chat ---
  describe("POST /chat", () => {
    it("allows premium user and streams response", async () => {
      const token = await createSession(env, "pro@test.com", "premium");
      const res = await worker.fetch(
        req("POST", "/chat", {
          body: { messages: [{ role: "user", content: "hello" }] },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Content-Type"), "text/event-stream");
      // Migrated to OpenRouter: correct endpoint + key, no leftover xAI.
      assert.ok(lastChatRequest, "chat request was proxied");
      assert.ok(lastChatRequest.url.startsWith("https://openrouter.ai/api/v1"));
      assert.equal(lastChatRequest.opts.headers.Authorization, "Bearer or_test_123");
      const sent = JSON.parse(lastChatRequest.opts.body);
      // In-file default is the PAID model so a dropped CHAT_MODEL env var can't
      // silently degrade paid chat to a rate-limited free model.
      assert.equal(sent.model, "openai/gpt-4o-mini");
      assert.equal(sent.stream, true);
    });

    it("honors env.CHAT_MODEL override", async () => {
      env.CHAT_MODEL = "anthropic/claude-haiku";
      const token = await createSession(env, "ovr@test.com", "premium");
      await worker.fetch(
        req("POST", "/chat", {
          body: { messages: [{ role: "user", content: "hello" }] },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      assert.equal(JSON.parse(lastChatRequest.opts.body).model, "anthropic/claude-haiku");
    });

    it("allows free user a daily allowance (no session_id needed)", async () => {
      const token = await createSession(env, "free@test.com", "free");
      const res = await worker.fetch(
        req("POST", "/chat", {
          body: { messages: [{ role: "user", content: "hello" }] },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Content-Type"), "text/event-stream");
    });

    it("returns 429 with upgrade flag at free daily limit", async () => {
      const token = await createSession(env, "freecap@test.com", "free", {
        freeChatUsage: { day: new Date().toISOString().slice(0, 10), count: 3 },
      });
      const res = await worker.fetch(
        req("POST", "/chat", {
          body: { messages: [{ role: "user", content: "hello" }] },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      assert.equal(res.status, 429);
      const data = await res.json();
      assert.equal(data.upgrade, true);
      // Funnel telemetry: hitting the wall increments the wall-hit counter.
      assert.equal(await env.USERS.get("stats:wallHits"), "1");
    });

    it("increments anonAsks when an anonymous visitor asks with no account/session", async () => {
      const res = await worker.fetch(
        req("POST", "/chat", {
          body: { messages: [{ role: "user", content: "hello" }] },
        }),
        env,
      );
      assert.equal(res.status, 400);
      assert.equal(await env.USERS.get("stats:anonAsks"), "1");
    });

    it("returns 429 at monthly chat limit", async () => {
      const token = await createSession(env, "cap@test.com", "premium", {
        chatUsage: { month: new Date().toISOString().slice(0, 7), count: 100 },
      });
      const res = await worker.fetch(
        req("POST", "/chat", {
          body: { messages: [{ role: "user", content: "hello" }] },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      assert.equal(res.status, 429);
      const data = await res.json();
      assert.ok(data.error.includes("limit"));
    });

    it("increments usage counter", async () => {
      const token = await createSession(env, "count@test.com", "premium", {
        chatUsage: { month: new Date().toISOString().slice(0, 7), count: 5 },
      });
      await worker.fetch(
        req("POST", "/chat", {
          body: { messages: [{ role: "user", content: "hello" }] },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      const user = await env.USERS.get("count@test.com", "json");
      assert.equal(user.chatUsage.count, 6);
    });

    it("resets counter for new month", async () => {
      const token = await createSession(env, "reset@test.com", "premium", {
        chatUsage: { month: "2025-01", count: 99 },
      });
      await worker.fetch(
        req("POST", "/chat", {
          body: { messages: [{ role: "user", content: "hello" }] },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      const user = await env.USERS.get("reset@test.com", "json");
      assert.equal(user.chatUsage.count, 1);
      assert.equal(user.chatUsage.month, new Date().toISOString().slice(0, 7));
    });

    it("rejects missing messages", async () => {
      const res = await worker.fetch(
        req("POST", "/chat", { body: { session_id: "x" } }),
        env,
      );
      assert.equal(res.status, 400);
    });

    it("rejects too many messages (>50)", async () => {
      const token = await createSession(env, "flood@test.com", "premium");
      const messages = Array.from({ length: 51 }, (_, i) => ({ role: "user", content: `msg ${i}` }));
      const res = await worker.fetch(
        req("POST", "/chat", {
          body: { messages },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("Too many messages"));
    });

    it("rejects single message exceeding 8000 chars", async () => {
      const token = await createSession(env, "long@test.com", "premium");
      const res = await worker.fetch(
        req("POST", "/chat", {
          body: { messages: [{ role: "user", content: "x".repeat(8001) }] },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("Message too long"));
    });

    it("rejects total message content exceeding 50000 chars", async () => {
      const token = await createSession(env, "bulk@test.com", "premium");
      const messages = Array.from({ length: 10 }, () => ({ role: "user", content: "x".repeat(7999) }));
      const res = await worker.fetch(
        req("POST", "/chat", {
          body: { messages },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("Total message content too long"));
    });
  });

  // --- POST /billing/portal ---
  describe("POST /billing/portal", () => {
    it("returns portal URL for premium user with customer ID", async () => {
      const token = await createSession(env, "portal@test.com", "premium", { stripeCustomerId: "cus_portal" });
      const res = await worker.fetch(
        req("POST", "/billing/portal", { headers: { Authorization: "Bearer " + token } }),
        env,
      );
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(data.url.includes("stripe.com"));
    });

    it("returns 400 without Stripe customer ID", async () => {
      const token = await createSession(env, "nocus@test.com", "premium");
      const res = await worker.fetch(
        req("POST", "/billing/portal", { headers: { Authorization: "Bearer " + token } }),
        env,
      );
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("billing"));
    });

    it("returns 401 without auth", async () => {
      const res = await worker.fetch(req("POST", "/billing/portal"), env);
      assert.equal(res.status, 401);
    });
  });

  // --- GET /pricing ---
  describe("GET /pricing", () => {
    it("returns formatted price from Stripe", async () => {
      const res = await worker.fetch(req("GET", "/pricing"), env);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.amount, 500);
      assert.equal(data.currency, "usd");
      assert.equal(data.interval, "month");
      assert.equal(data.display, "$5/month");
    });
  });

  // --- GET /admin/stats ---
  describe("GET /admin/stats", () => {
    it("returns user stats for valid admin token", async () => {
      await env.USERS.put("a@test.com", JSON.stringify({ email: "a@test.com", plan: "premium" }));
      await env.USERS.put("b@test.com", JSON.stringify({ email: "b@test.com", plan: "free" }));
      await env.USERS.put("c@test.com", JSON.stringify({ email: "c@test.com", plan: "free" }));
      const res = await worker.fetch(
        req("GET", "/admin/stats", { headers: { Authorization: "Bearer admin_test_token" } }),
        env,
      );
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.totalUsers, 3);
      assert.equal(data.premiumUsers, 1);
      assert.equal(data.freeUsers, 2);
      assert.equal(data.estimatedMRR, 5);
    });

    it("excludes comped premium from estimatedMRR (truthful MRR)", async () => {
      await env.USERS.put("paid@test.com", JSON.stringify({ email: "paid@test.com", plan: "premium" }));
      await env.USERS.put("comp@test.com", JSON.stringify({ email: "comp@test.com", plan: "premium", comped: true }));
      const res = await worker.fetch(
        req("GET", "/admin/stats", { headers: { Authorization: "Bearer admin_test_token" } }),
        env,
      );
      const data = await res.json();
      assert.equal(data.premiumUsers, 2);
      assert.equal(data.compedUsers, 1);
      assert.equal(data.paidPremiumUsers, 1);
      assert.equal(data.estimatedMRR, 5); // only the 1 paying user, not 10
    });

    it("reports funnel counters (anonAsks, wallHits)", async () => {
      await env.USERS.put("stats:anonAsks", "7");
      await env.USERS.put("stats:wallHits", "3");
      const res = await worker.fetch(
        req("GET", "/admin/stats", { headers: { Authorization: "Bearer admin_test_token" } }),
        env,
      );
      const data = await res.json();
      assert.equal(data.funnel.anonAsks, 7);
      assert.equal(data.funnel.wallHits, 3);
    });

    it("returns 401 for invalid token", async () => {
      const res = await worker.fetch(
        req("GET", "/admin/stats", { headers: { Authorization: "Bearer wrong_token" } }),
        env,
      );
      assert.equal(res.status, 401);
    });

    it("returns 401 without auth", async () => {
      const res = await worker.fetch(req("GET", "/admin/stats"), env);
      assert.equal(res.status, 401);
    });
  });

  // --- Abuse gates (disposable email + per-IP rate limits) ---
  describe("abuse gates", () => {
    it("rejects a disposable email on /auth/send-magic-link", async () => {
      const res = await worker.fetch(
        req("POST", "/auth/send-magic-link", { body: { email: "x@mailinator.com" } }),
        env,
      );
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(/permanent email/i.test(data.error));
    });

    it("rejects a disposable email on /subscribe", async () => {
      const res = await worker.fetch(
        req("POST", "/subscribe", { body: { email: "y@guerrillamail.com" } }),
        env,
      );
      assert.equal(res.status, 400);
    });

    it("rate-limits /chat per IP (caps OpenRouter burn)", async () => {
      const stamps = Array.from({ length: 30 }, () => Date.now());
      await env.MAGIC_LINKS.put("ratelimit:chat:unknown", JSON.stringify(stamps));
      const res = await worker.fetch(
        req("POST", "/chat", { body: { messages: [{ role: "user", content: "hi" }] } }),
        env,
      );
      assert.equal(res.status, 429);
    });

    it("rate-limits /subscribe per IP", async () => {
      const stamps = Array.from({ length: 5 }, () => Date.now());
      await env.MAGIC_LINKS.put("ratelimit:subscribe:unknown", JSON.stringify(stamps));
      const res = await worker.fetch(
        req("POST", "/subscribe", { body: { email: "fresh@test.com" } }),
        env,
      );
      assert.equal(res.status, 429);
    });
  });

  // --- Transcript memory (server-side AI Desk continuity) ---
  describe("transcript memory", () => {
    it("persists an account user's conversation and serves it via /chat/history", async () => {
      const token = await createSession(env, "mem@test.com", "premium");
      const res = await worker.fetch(
        req("POST", "/chat", {
          body: {
            messages: [
              { role: "user", content: "what's trending" },
              { role: "assistant", content: "React is" },
            ],
          },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      assert.equal(res.status, 200);
      const hist = await worker.fetch(
        req("GET", "/chat/history", { headers: { Authorization: "Bearer " + token } }),
        env,
      );
      const data = await hist.json();
      assert.equal(data.ok, true);
      assert.equal(data.messages.length, 2);
      assert.equal(data.messages[0].content, "what's trending");
    });

    it("/chat/history returns 401 without auth", async () => {
      const res = await worker.fetch(req("GET", "/chat/history"), env);
      assert.equal(res.status, 401);
    });

    it("delete-account removes the persisted transcript", async () => {
      const token = await createSession(env, "del2@test.com", "premium");
      await env.USERS.put(
        "transcript:del2@test.com",
        JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
      );
      await worker.fetch(
        req("POST", "/auth/delete-account", { headers: { Authorization: "Bearer " + token } }),
        env,
      );
      assert.equal(await env.USERS.get("transcript:del2@test.com"), null);
    });

    it("admin stats ignores transcript: keys in the user-count scan", async () => {
      await env.USERS.put("u1@test.com", JSON.stringify({ email: "u1@test.com", plan: "free" }));
      await env.USERS.put("transcript:u1@test.com", JSON.stringify({ messages: [] }));
      const res = await worker.fetch(
        req("GET", "/admin/stats", { headers: { Authorization: "Bearer admin_test_token" } }),
        env,
      );
      const data = await res.json();
      assert.equal(data.totalUsers, 1);
    });
  });

  // --- scheduled() reconciliation sweep ---
  describe("scheduled() reconciliation", () => {
    it("downgrades a lapsed-grace premium user and decrements the stat", async () => {
      await env.USERS.put(
        "sweep@test.com",
        JSON.stringify({
          email: "sweep@test.com",
          plan: "premium",
          gracePeriodEndsAt: new Date(Date.now() - 1000).toISOString(),
        }),
      );
      await env.USERS.put("stats:premiumUsers", "1");
      const reconciled = await worker.scheduled({}, env);
      const user = await env.USERS.get("sweep@test.com", "json");
      assert.equal(user.plan, "free");
      assert.equal(user.gracePeriodEndsAt, undefined);
      assert.equal(await env.USERS.get("stats:premiumUsers"), "0");
      assert.equal(reconciled, 1);
    });

    it("leaves a premium user with active grace untouched", async () => {
      await env.USERS.put(
        "active@test.com",
        JSON.stringify({
          email: "active@test.com",
          plan: "premium",
          gracePeriodEndsAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      );
      await worker.scheduled({}, env);
      const user = await env.USERS.get("active@test.com", "json");
      assert.equal(user.plan, "premium");
    });
  });

  // --- POST /auth/update-newsletter ---
  describe("POST /auth/update-newsletter", () => {
    it("toggles newsletter preference off", async () => {
      const token = await createSession(env, "news@test.com", "free");
      const res = await worker.fetch(
        req("POST", "/auth/update-newsletter", {
          body: { subscribedToNewsletter: false },
          headers: { Authorization: "Bearer " + token },
        }),
        env,
      );
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.subscribedToNewsletter, false);
      const user = await env.USERS.get("news@test.com", "json");
      assert.equal(user.subscribedToNewsletter, false);
    });

    it("returns 401 without auth", async () => {
      const res = await worker.fetch(
        req("POST", "/auth/update-newsletter", { body: { subscribedToNewsletter: false } }),
        env,
      );
      assert.equal(res.status, 401);
    });
  });

  // --- GET /newsletter/unsubscribe ---
  describe("GET /newsletter/unsubscribe", () => {
    it("unsubscribes with valid token", async () => {
      await env.USERS.put(
        "unsub@test.com",
        JSON.stringify({ email: "unsub@test.com", plan: "free", subscribedToNewsletter: true, createdAt: new Date().toISOString() }),
      );
      const token = await unsubToken("unsub@test.com", env.NEWSLETTER_SECRET);
      const res = await worker.fetch(
        req("GET", `/newsletter/unsubscribe?email=${encodeURIComponent("unsub@test.com")}&token=${token}`),
        env,
      );
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes("Unsubscribed"));
      const user = await env.USERS.get("unsub@test.com", "json");
      assert.equal(user.subscribedToNewsletter, false);
    });

    it("rejects invalid token", async () => {
      const res = await worker.fetch(
        req("GET", `/newsletter/unsubscribe?email=x@test.com&token=badtoken`),
        env,
      );
      assert.equal(res.status, 403);
    });
  });

  // --- 404 ---
  describe("404 fallback", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await worker.fetch(req("GET", "/nonexistent"), env);
      assert.equal(res.status, 404);
    });
  });
});

// --- Full-corpus RAG grounding + thinking. Isolated and placed last so the
// worker's module-level corpus cache (populated here) can't leak into the
// earlier chat tests, which deliberately run without a corpus. ---
describe("POST /chat — RAG grounding + thinking", () => {
  let env, origFetch, lastChat;

  const CORPUS = {
    builtAt: "2026-06-27T00:00:00Z",
    count: 2,
    chunks: [
      { i: 0, type: "repo", repo: "acme/rag-eval", title: "RAG eval harness", text: "acme rag eval retrieval benchmark harness grounding", url: "/editions/2026-06-20/", stars: 1200, date: "2026-06-20" },
      { i: 1, type: "edition", repo: null, title: "WebGL toy roundup", text: "webgl shader graphics demo", url: "/editions/2026-06-21/", date: "2026-06-21" },
    ],
  };

  function mockFetch() {
    return (url, opts) => {
      if (url.includes("/data/corpus.json"))
        return Promise.resolve(new Response(JSON.stringify(CORPUS), { status: 200 }));
      if (url.includes("openrouter.ai")) {
        lastChat = { url, opts, body: JSON.parse(opts.body) };
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Answer [1]"}}]}\n\n'));
            c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            c.close();
          },
        });
        return Promise.resolve(new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return Promise.resolve(new Response("unmocked", { status: 500 }));
    };
  }

  async function readBody(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value);
    }
    return out;
  }

  beforeEach(() => {
    env = createMockEnv();
    lastChat = null;
    origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch();
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("injects a GROUNDING block + prepends a sources SSE event for a matching question", async () => {
    const token = await createSession(env, "p@p.co", "premium");
    const res = await worker.fetch(
      req("POST", "/chat", {
        headers: { Authorization: "Bearer " + token },
        body: { messages: [{ role: "user", content: "Story in focus:\n...\n\nQuestion: what rag eval retrieval harness has the paper covered?" }] },
      }),
      env,
    );
    assert.equal(res.status, 200);
    const sys = lastChat.body.messages[0];
    assert.equal(sys.role, "system");
    assert.match(sys.content, /GROUNDING/);
    assert.match(sys.content, /\[1\]/);
    assert.match(sys.content, /acme\/rag-eval/);

    const body = await readBody(res);
    const evt = body.split("\n\n").find((l) => l.includes('"sources"'));
    assert.ok(evt, "sources event present");
    const parsed = JSON.parse(evt.replace("data: ", ""));
    assert.equal(parsed.sources[0].n, 1);
    assert.equal(parsed.sources[0].url, "/editions/2026-06-20/");
  });

  it("adds the thinking instruction only when think:true", async () => {
    const token = await createSession(env, "p2@p.co", "premium");
    const res = await worker.fetch(
      req("POST", "/chat", {
        headers: { Authorization: "Bearer " + token },
        body: { think: true, messages: [{ role: "user", content: "Question: explain webgl shaders" }] },
      }),
      env,
    );
    await readBody(res);
    assert.match(lastChat.body.messages[0].content, /<thinking>/);
  });

  it("skips grounding + sources when nothing relevant matches", async () => {
    const token = await createSession(env, "p3@p.co", "premium");
    const res = await worker.fetch(
      req("POST", "/chat", {
        headers: { Authorization: "Bearer " + token },
        body: { messages: [{ role: "user", content: "Question: zzzznonexistenttopic qqqwxyz" }] },
      }),
      env,
    );
    const body = await readBody(res);
    assert.doesNotMatch(lastChat.body.messages[0].content, /GROUNDING/);
    assert.doesNotMatch(body, /"sources":/);
  });
});
