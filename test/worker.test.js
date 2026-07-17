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
    FREE_DAILY_CHAT_LIMIT: "0", // AI Desk is Premium-only (production setting)
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

    it("round-trips design and drops junk design values", async () => {
      const token = await createSession(env, "s5@test.com", "free");
      // A known design preset persists and comes back on GET
      await worker.fetch(
        req("POST", "/auth/settings", {
          headers: { Authorization: "Bearer " + token },
          body: { settings: { design: "cyberpunk", theme: "dark" } },
        }),
        env,
      );
      let get = await worker.fetch(req("GET", "/auth/settings", { headers: { Authorization: "Bearer " + token } }), env);
      let data = await get.json();
      assert.equal(data.settings.design, "cyberpunk");

      // A junk design is ignored: stored settings carry no design key, so it
      // can never be replayed to another device via GET
      await worker.fetch(
        req("POST", "/auth/settings", {
          headers: { Authorization: "Bearer " + token },
          body: { settings: { design: "zebra", theme: "sepia" } },
        }),
        env,
      );
      get = await worker.fetch(req("GET", "/auth/settings", { headers: { Authorization: "Bearer " + token } }), env);
      data = await get.json();
      assert.equal(data.settings.theme, "sepia");
      assert.equal("design" in data.settings, false);

      // All four presets are accepted
      for (const design of ["newspaper", "cyberpunk", "business", "whitepaper"]) {
        const res = await worker.fetch(
          req("POST", "/auth/settings", {
            headers: { Authorization: "Bearer " + token },
            body: { settings: { design } },
          }),
          env,
        );
        assert.equal((await res.json()).settings.design, design);
      }
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

    it("denies free accounts — AI Desk is Premium-only, with NO model call", async () => {
      const token = await createSession(env, "free@test.com", "free");
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
      assert.match(data.error, /Premium/);
      // The critical guarantee: the model was never called for a free user.
      assert.equal(lastChatRequest, null, "no LLM request for a free account");
      assert.equal(await env.USERS.get("stats:wallHits"), "1");
    });

    it("re-enables a free daily taste when FREE_DAILY_CHAT_LIMIT > 0", async () => {
      env.FREE_DAILY_CHAT_LIMIT = "2";
      const token = await createSession(env, "taste@test.com", "free");
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

    it("returns 429 with upgrade flag at free daily limit (taste enabled)", async () => {
      env.FREE_DAILY_CHAT_LIMIT = "3";
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

// --- Repo tool-use + compare (the research-agent path). ---
describe("POST /chat — repo tool-use", () => {
  let env, origFetch, orCalls, ghCalls;

  function toolMock() {
    orCalls = 0;
    ghCalls = [];
    return (url) => {
      if (url.includes("/data/corpus.json"))
        return Promise.resolve(new Response(JSON.stringify({ chunks: [] }), { status: 200 }));
      if (url.includes("api.github.com")) {
        ghCalls.push(url);
        if (url.includes("/readme"))
          return Promise.resolve(new Response(JSON.stringify({ content: btoa("# React\nA JS library for UIs") }), { status: 200 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({ full_name: "facebook/react", stargazers_count: 225000, forks_count: 46000, open_issues_count: 700, language: "JavaScript" }),
            { status: 200 },
          ),
        );
      }
      if (url.includes("openrouter.ai")) {
        orCalls++;
        if (orCalls === 1) {
          // First hop: the model asks for a tool.
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_repo_meta", arguments: '{"repo":"facebook/react"}' } }] } }],
              }),
              { status: 200 },
            ),
          );
        }
        // Second hop: the model answers using the tool result.
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "facebook/react has 225,000 stars." } }] }), { status: 200 }),
        );
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
    origFetch = globalThis.fetch;
    globalThis.fetch = toolMock();
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("resolves a repo tool call and streams the answer (intent: 'compare')", async () => {
    const token = await createSession(env, "tool@p.co", "premium");
    const res = await worker.fetch(
      req("POST", "/chat", {
        headers: { Authorization: "Bearer " + token },
        body: { messages: [{ role: "user", content: "Question: compare the stars of facebook/react vs others" }] },
      }),
      env,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/event-stream");
    const body = await readBody(res);
    assert.match(body, /225,000 stars/);
    assert.ok(orCalls >= 2, "tool round then final answer");
    assert.ok(ghCalls.some((u) => u.includes("/repos/facebook/react")), "GitHub repo meta was fetched");
  });

  it("a non-intent question does NOT enter the tool loop", async () => {
    const token = await createSession(env, "plain@p.co", "premium");
    // No tool keyword -> streaming proxy path. The mock returns a non-stream JSON
    // for openrouter, which the proxy pipes as the (single) body; we only assert
    // that the tool loop wasn't used (no second model call, no GitHub hit).
    await worker.fetch(
      req("POST", "/chat", {
        headers: { Authorization: "Bearer " + token },
        body: { messages: [{ role: "user", content: "Question: what is this project about" }] },
      }),
      env,
    );
    assert.equal(ghCalls.length, 0, "no GitHub calls for a plain question");
    assert.equal(orCalls, 1, "single model call, not a tool loop");
  });

  it("rejects a malformed repo argument without calling GitHub (SSRF guard)", async () => {
    // A model that requests a path-traversal repo; the guard must refuse it.
    let calls = 0;
    const gh = [];
    globalThis.fetch = (url) => {
      if (url.includes("/data/corpus.json")) return Promise.resolve(new Response(JSON.stringify({ chunks: [] }), { status: 200 }));
      if (url.includes("api.github.com")) {
        gh.push(url);
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      if (url.includes("openrouter.ai")) {
        calls++;
        if (calls === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "c", type: "function", function: { name: "get_repo_meta", arguments: '{"repo":"../../etc/passwd"}' } }] } }] }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I couldn't look that up." } }] }), { status: 200 }));
      }
      return Promise.resolve(new Response("unmocked", { status: 500 }));
    };
    const token = await createSession(env, "ssrf@p.co", "premium");
    const res = await worker.fetch(
      req("POST", "/chat", {
        headers: { Authorization: "Bearer " + token },
        body: { messages: [{ role: "user", content: "Question: compare the readme of ../../etc/passwd" }] },
      }),
      env,
    );
    await readBody(res);
    assert.equal(gh.length, 0, "malformed repo must never reach a GitHub fetch");
    assert.ok(calls >= 2, "model still gets the rejection and answers");
  });
});

// --- Saved AI Desk answers (bookmarks) ---
describe("Saved answers", () => {
  let env;
  beforeEach(() => {
    env = createMockEnv();
  });

  it("requires authentication", async () => {
    const res = await worker.fetch(req("POST", "/chat/saved", { body: { text: "x" } }), env);
    assert.equal(res.status, 401);
  });

  it("saves, lists newest-first (with sources), and deletes by id", async () => {
    const token = await createSession(env, "saver@test.com", "premium");
    const h = { Authorization: "Bearer " + token };

    const r1 = await worker.fetch(
      req("POST", "/chat/saved", { headers: h, body: { text: "first answer", question: "q1", sources: [{ n: 1, url: "/e/", title: "t" }] } }),
      env,
    );
    assert.equal(r1.status, 200);
    const d1 = await r1.json();
    assert.ok(d1.ok && d1.item && d1.item.id, "returns the saved item with an id");

    await worker.fetch(req("POST", "/chat/saved", { headers: h, body: { text: "second answer", question: "q2" } }), env);

    const ld = await (await worker.fetch(req("GET", "/chat/saved", { headers: h }), env)).json();
    assert.equal(ld.saved.length, 2);
    assert.equal(ld.saved[0].question, "q2", "newest first");
    assert.equal(ld.saved[1].sources[0].url, "/e/", "sources persisted");

    const delId = ld.saved[1].id;
    const dd = await (await worker.fetch(req("POST", "/chat/saved/delete", { headers: h, body: { id: delId } }), env)).json();
    assert.equal(dd.count, 1);
    const ld2 = await (await worker.fetch(req("GET", "/chat/saved", { headers: h }), env)).json();
    assert.equal(ld2.saved.length, 1);
    assert.equal(ld2.saved[0].question, "q2");
  });

  it("rejects an empty answer", async () => {
    const token = await createSession(env, "empty@test.com", "premium");
    const res = await worker.fetch(req("POST", "/chat/saved", { headers: { Authorization: "Bearer " + token }, body: { text: "   " } }), env);
    assert.equal(res.status, 400);
  });

  it("caps saved answers at 50, keeping the newest", async () => {
    const token = await createSession(env, "cap@test.com", "premium");
    const h = { Authorization: "Bearer " + token };
    for (let i = 0; i < 53; i++) {
      await worker.fetch(req("POST", "/chat/saved", { headers: h, body: { text: "a" + i } }), env);
    }
    const ld = await (await worker.fetch(req("GET", "/chat/saved", { headers: h }), env)).json();
    assert.equal(ld.saved.length, 50);
    assert.equal(ld.saved[0].text, "a52", "newest kept");
  });

  it("saved: keys are excluded from the admin user count", async () => {
    const token = await createSession(env, "counted@test.com", "premium");
    await worker.fetch(req("POST", "/chat/saved", { headers: { Authorization: "Bearer " + token }, body: { text: "hi" } }), env);
    const res = await worker.fetch(req("GET", "/admin/stats", { headers: { Authorization: "Bearer " + env.ADMIN_TOKEN } }), env);
    assert.equal(res.status, 200);
    const data = await res.json();
    // One real account; the saved: key must not inflate the user count.
    assert.equal(data.totalUsers, 1, "saved: key not counted as a user");
  });
});

// --- Clerk hybrid exchange ---
// Real RS256 keypairs generated in-test; the JWKS endpoint is served through a
// scoped fetch mock. The worker's JWKS cache is module-scoped with a 1h TTL, so
// all tests share ONE issuer/JWKS URL and one primary keypair; the rotation
// test uses a second key that only appears in the JWKS on refetch.
describe("POST /auth/clerk-exchange", () => {
  const ISSUER = "https://clerk.test";
  const JWKS_URL = "https://clerk.test/.well-known/jwks.json";
  let keyA, keyB, jwkA, jwkB;
  let env;
  let origFetch;
  let jwksKeys; // what the mocked JWKS endpoint currently serves
  let jwksFetches;

  function b64url(bytes) {
    return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function makeKey(kid) {
    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    return { pair, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } };
  }

  async function signJwt(privateKey, kid, claims) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: ISSUER,
      sub: "user_clerk_1",
      azp: "https://gittimes.com",
      iat: now,
      exp: now + 300,
      email: "clerk@test.com",
      ...claims,
    };
    const head = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })));
    const body = b64url(Buffer.from(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
  }

  beforeEach(async () => {
    env = createMockEnv();
    env.CLERK_ISSUER = ISSUER;
    env.CLERK_JWKS_URL = JWKS_URL;
    if (!keyA) {
      keyA = await makeKey("kid-a");
      keyB = await makeKey("kid-b");
      jwkA = keyA.jwk;
      jwkB = keyB.jwk;
    }
    jwksKeys = [jwkA];
    jwksFetches = 0;
    origFetch = globalThis.fetch;
    globalThis.fetch = (url) => {
      if (String(url) === JWKS_URL) {
        jwksFetches++;
        return Promise.resolve(new Response(JSON.stringify({ keys: jwksKeys }), { status: 200 }));
      }
      return Promise.resolve(new Response("unmocked: " + url, { status: 500 }));
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("404s when CLERK_JWKS_URL is unset (feature off)", async () => {
    delete env.CLERK_JWKS_URL;
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: "x" } }), env);
    assert.equal(res.status, 404);
  });

  it("exchanges a valid Clerk JWT for a native 64-hex session and upserts the user", async () => {
    const jwt = await signJwt(keyA.pair.privateKey, "kid-a", { name: "Clerk User", avatar: "https://img.clerk.com/x.png" });
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: jwt } }), env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.match(data.token, /^[0-9a-f]{64}$/);

    const sess = await env.SESSIONS.get(data.token, "json");
    assert.equal(sess.email, "clerk@test.com");

    const user = await env.USERS.get("clerk@test.com", "json");
    assert.equal(user.plan, "free");
    assert.equal(user.displayName, "Clerk User");
    assert.equal(user.avatarUrl, "https://img.clerk.com/x.png");
    assert.equal(user.clerkUserId, "user_clerk_1");
    assert.equal(user.subscribedToNewsletter, true);

    const sub = await env.SUBSCRIBERS.get("clerk@test.com", "json");
    assert.equal(sub.source, "clerk");

    // Minted token works against a session-gated endpoint.
    const me = await worker.fetch(req("GET", "/auth/me", { headers: { Authorization: "Bearer " + data.token } }), env);
    assert.equal(me.status, 200);
    const meData = await me.json();
    assert.equal(meData.user.displayName, "Clerk User");
    assert.equal(meData.user.avatarUrl, "https://img.clerk.com/x.png");
  });

  it("preserves an existing premium user's plan and Stripe fields", async () => {
    await env.USERS.put("clerk@test.com", JSON.stringify({
      email: "clerk@test.com",
      createdAt: "2026-01-01T00:00:00Z",
      plan: "premium",
      stripeCustomerId: "cus_9",
      stripeSubscriptionId: "sub_9",
      subscribedToNewsletter: false,
    }));
    const jwt = await signJwt(keyA.pair.privateKey, "kid-a", {});
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: jwt } }), env);
    assert.equal(res.status, 200);
    const user = await env.USERS.get("clerk@test.com", "json");
    assert.equal(user.plan, "premium");
    assert.equal(user.stripeCustomerId, "cus_9");
    assert.equal(user.stripeSubscriptionId, "sub_9");
    assert.equal(user.subscribedToNewsletter, false, "does not resubscribe an opted-out user");
    assert.equal(user.clerkUserId, "user_clerk_1");
  });

  it("rejects a JWT signed by the wrong key", async () => {
    // keyB's private key, but claiming keyA's kid → signature check fails.
    const jwt = await signJwt(keyB.pair.privateKey, "kid-a", {});
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: jwt } }), env);
    assert.equal(res.status, 401);
  });

  it("rejects an expired JWT", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(keyA.pair.privateKey, "kid-a", { exp: now - 3600, iat: now - 7200 });
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: jwt } }), env);
    assert.equal(res.status, 401);
  });

  it("rejects a wrong issuer", async () => {
    const jwt = await signJwt(keyA.pair.privateKey, "kid-a", { iss: "https://evil.example" });
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: jwt } }), env);
    assert.equal(res.status, 401);
  });

  it("rejects an unauthorized azp", async () => {
    const jwt = await signJwt(keyA.pair.privateKey, "kid-a", { azp: "https://evil.example" });
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: jwt } }), env);
    assert.equal(res.status, 401);
  });

  it("400s with a template hint when the email claim is missing", async () => {
    const jwt = await signJwt(keyA.pair.privateKey, "kid-a", { email: undefined });
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: jwt } }), env);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /JWT template/);
  });

  it("403s when the email is explicitly unverified", async () => {
    const jwt = await signJwt(keyA.pair.privateKey, "kid-a", { email_verified: false });
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: jwt } }), env);
    assert.equal(res.status, 403);
  });

  it("rejects disposable emails", async () => {
    const jwt = await signJwt(keyA.pair.privateKey, "kid-a", { email: "x@mailinator.com" });
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: jwt } }), env);
    assert.equal(res.status, 400);
  });

  it("refetches the JWKS once on an unknown kid (key rotation)", async () => {
    jwksKeys = [jwkA, jwkB]; // rotation already visible at the endpoint
    const jwt = await signJwt(keyB.pair.privateKey, "kid-b", { email: "rotated@test.com" });
    const res = await worker.fetch(req("POST", "/auth/clerk-exchange", { body: { token: jwt } }), env);
    assert.equal(res.status, 200);
    assert.ok(jwksFetches >= 1, "refetched the JWKS to find the new kid");
  });

  it("magic-link route disappears when MAGIC_LINK_ENABLED=false", async () => {
    env.MAGIC_LINK_ENABLED = "false";
    const res = await worker.fetch(req("POST", "/auth/send-magic-link", { body: { email: "a@b.com" } }), env);
    assert.equal(res.status, 404);
  });
});
