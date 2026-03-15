// --- Utility functions ---

async function generateUnsubscribeToken(email, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(email));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function renderNewsletterHtml({ headline, subheadline, tagline, date, url, repos, unsubscribeUrl }) {
  const repoItems = (repos || [])
    .map((r) => `<li style="margin:0 0 4px;color:#333;">${r}</li>`)
    .join("");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f1eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;"><tr><td align="center" style="padding:24px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #d5d0c4;">
  <tr><td style="padding:24px 32px 16px;border-bottom:2px solid #2c2c2c;text-align:center;">
    <h2 style="margin:0;font-family:Georgia,serif;font-size:24px;color:#2c2c2c;letter-spacing:1px;">The Git Times</h2>
    <p style="margin:4px 0 0;font-size:13px;color:#888;">${date || ""}</p>
  </td></tr>
  <tr><td style="padding:32px 32px 16px;">
    <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#2c2c2c;line-height:1.3;">${headline || "Today's Edition"}</h1>
    ${subheadline ? `<p style="margin:0 0 16px;font-size:16px;color:#555;line-height:1.5;">${subheadline}</p>` : ""}
    ${tagline ? `<blockquote style="margin:0 0 20px;padding:12px 16px;border-left:3px solid #c5a55a;background:#faf8f4;font-style:italic;color:#666;font-size:14px;">${tagline}</blockquote>` : ""}
  </td></tr>
  ${repoItems ? `<tr><td style="padding:0 32px 20px;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#888;text-transform:uppercase;letter-spacing:1px;">Trending Today</p>
    <ul style="margin:0;padding:0 0 0 20px;font-size:14px;line-height:1.6;">${repoItems}</ul>
  </td></tr>` : ""}
  <tr><td style="padding:8px 32px 32px;text-align:center;">
    <a href="${url}" style="display:inline-block;padding:12px 32px;background:#2c2c2c;color:#fff;text-decoration:none;font-size:15px;font-weight:bold;letter-spacing:0.5px;">Read the Full Edition</a>
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
    <p style="margin:0;font-size:12px;color:#aaa;">You're receiving this because you subscribed to The Git Times.</p>
    <p style="margin:4px 0 0;font-size:12px;"><a href="${unsubscribeUrl}" style="color:#aaa;">Unsubscribe</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendMagicLinkEmail(email, url, env) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "The Git Times <noreply@gittimes.com>",
      to: [email],
      subject: "Sign in to The Git Times",
      html: `<p>Click the link below to sign in to your Git Times account:</p><p><a href="${url}">${url}</a></p><p>This link expires in 15 minutes.</p><p>If you didn't request this, you can safely ignore this email.</p>`,
    }),
  });
  return res.ok;
}

async function getSessionUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (!token) return null;
  const sessionData = await env.SESSIONS.get(token, "json");
  if (!sessionData) return null;
  if (Date.now() > new Date(sessionData.expiresAt).getTime()) {
    await env.SESSIONS.delete(token);
    return null;
  }
  const user = await env.USERS.get(sessionData.email, "json");
  return user || null;
}

async function checkRateLimit(kv, key, max, windowSec) {
  const now = Date.now();
  const existing = await kv.get(key, "json");
  const timestamps = (existing || []).filter(t => now - t < windowSec * 1000);
  if (timestamps.length >= max) return false;
  timestamps.push(now);
  await kv.put(key, JSON.stringify(timestamps), { expirationTtl: windowSec });
  return true;
}

async function verifyStripeSignature(payload, sigHeader, secret) {
  const pairs = sigHeader.split(",").reduce((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const timestamp = pairs.t;
  const signature = pairs.v1;
  if (!timestamp || !signature) return false;

  // Reject timestamps older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (age > 300) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${payload}`),
  );
  const expected = Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  // Timing-safe comparison
  if (expected.length !== signature.length) return false;
  const a = encoder.encode(expected);
  const b = encoder.encode(signature);
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "https://gittimes.com";
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // --- Auth endpoints ---

    // POST /auth/send-magic-link
    if (url.pathname === "/auth/send-magic-link" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawEmail = (body.email || "").toString();
      const email = rawEmail.trim().toLowerCase();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ ok: false, error: "Please enter a valid email address." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Rate limit by IP (10 per 15 min)
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const ipAllowed = await checkRateLimit(env.MAGIC_LINKS, `ratelimit:ip:${ip}`, 10, 900);
      if (!ipAllowed) {
        return new Response(JSON.stringify({ ok: false, error: "Too many requests. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Rate limit by email (3 per 15 min)
      const emailAllowed = await checkRateLimit(env.MAGIC_LINKS, `ratelimit:email:${email}`, 3, 900);
      if (!emailAllowed) {
        return new Response(JSON.stringify({ ok: false, error: "Too many sign-in requests for this email. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Upsert user
      const existingUser = await env.USERS.get(email, "json");
      if (!existingUser) {
        await env.USERS.put(email, JSON.stringify({
          email,
          createdAt: new Date().toISOString(),
          plan: "free",
          subscribedToNewsletter: true,
        }));
      }

      // Upsert subscriber
      const existingSub = await env.SUBSCRIBERS.get(email);
      if (!existingSub) {
        await env.SUBSCRIBERS.put(email, JSON.stringify({
          email,
          subscribedAt: new Date().toISOString(),
          source: "magic-link",
        }));
      }

      // Generate magic link token
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await env.MAGIC_LINKS.put(token, JSON.stringify({
        email,
        createdAt: new Date().toISOString(),
        expiresAt,
      }), { expirationTtl: 900 });

      const magicUrl = `${allowed}/auth/verify?token=${token}`;
      // Use worker URL for verify endpoint
      const verifyUrl = `${url.origin}/auth/verify?token=${token}`;

      await sendMagicLinkEmail(email, verifyUrl, env);

      return new Response(JSON.stringify({ ok: true, message: "Check your email for a sign-in link." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /auth/verify
    if (url.pathname === "/auth/verify" && request.method === "GET") {
      const token = url.searchParams.get("token");
      if (!token) {
        return Response.redirect(`${allowed}/account/?error=invalid_token`, 302);
      }

      const magicData = await env.MAGIC_LINKS.get(token, "json");
      if (!magicData) {
        return Response.redirect(`${allowed}/account/?error=expired_token`, 302);
      }

      if (Date.now() > new Date(magicData.expiresAt).getTime()) {
        await env.MAGIC_LINKS.delete(token);
        return Response.redirect(`${allowed}/account/?error=expired_token`, 302);
      }

      // Delete used magic link (single-use)
      await env.MAGIC_LINKS.delete(token);

      // Create session
      const sessionToken = generateToken();
      const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await env.SESSIONS.put(sessionToken, JSON.stringify({
        email: magicData.email,
        createdAt: new Date().toISOString(),
        expiresAt: sessionExpiry,
      }), { expirationTtl: 30 * 24 * 60 * 60 });

      return Response.redirect(`${allowed}/account/?token=${sessionToken}`, 302);
    }

    // GET /auth/me
    if (url.pathname === "/auth/me" && request.method === "GET") {
      const user = await getSessionUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        user: {
          email: user.email,
          plan: user.plan,
          subscribedToNewsletter: user.subscribedToNewsletter,
          createdAt: user.createdAt,
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /auth/logout
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      if (auth.startsWith("Bearer ")) {
        const token = auth.slice(7);
        if (token) {
          await env.SESSIONS.delete(token);
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /auth/delete-account
    if (url.pathname === "/auth/delete-account" && request.method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      if (!auth.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const token = auth.slice(7);
      const user = await getSessionUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Cancel Stripe subscription if active
      if (user.stripeSubscriptionId) {
        try {
          await fetch(
            `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(user.stripeSubscriptionId)}`,
            {
              method: "DELETE",
              headers: { Authorization: `Basic ${btoa(env.STRIPE_SECRET_KEY + ":")}` },
            },
          );
        } catch {
          // Don't block deletion if Stripe call fails
        }
      }

      await Promise.all([
        env.USERS.delete(user.email),
        env.SUBSCRIBERS.delete(user.email),
        env.SESSIONS.delete(token),
      ]);

      return new Response(JSON.stringify({ ok: true, message: "Account deleted." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /subscribe — email capture
    if (url.pathname === "/subscribe" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawEmail = (body.email || "").toString();
      const email = rawEmail.trim().toLowerCase();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ ok: false, error: "Please enter a valid email address." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check for duplicate
      const existing = await env.SUBSCRIBERS.get(email);
      if (existing) {
        return new Response(JSON.stringify({ ok: true, message: "You're already subscribed!" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store subscriber
      await env.SUBSCRIBERS.put(email, JSON.stringify({
        email,
        subscribedAt: new Date().toISOString(),
        source: "landing",
      }));

      // Upsert user account (creates account silently on subscribe)
      const existingUser = await env.USERS.get(email, "json");
      if (!existingUser) {
        await env.USERS.put(email, JSON.stringify({
          email,
          createdAt: new Date().toISOString(),
          plan: "free",
          subscribedToNewsletter: true,
        }));
      }

      return new Response(JSON.stringify({ ok: true, message: "You're subscribed! Welcome aboard." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /checkout — create Stripe Checkout Session, redirect to Stripe
    if (url.pathname === "/checkout" && request.method === "GET") {
      // Require valid session — no anonymous checkouts
      const sessionToken = url.searchParams.get("session_token");
      if (!sessionToken) {
        return Response.redirect(`${allowed}/account/?error=login_required`, 302);
      }
      const sessionData = await env.SESSIONS.get(sessionToken, "json");
      if (!sessionData) {
        return Response.redirect(`${allowed}/account/?error=login_required`, 302);
      }

      const checkoutParams = {
        "line_items[0][price]": env.STRIPE_PRICE_ID,
        "line_items[0][quantity]": "1",
        mode: "subscription",
        success_url: `${allowed}/account/?upgraded=true`,
        customer_email: sessionData.email,
        "metadata[user_email]": sessionData.email,
      };

      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(env.STRIPE_SECRET_KEY + ":")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(checkoutParams),
      });
      const session = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: session.error?.message || "Checkout failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return Response.redirect(session.url, 303);
    }

    // POST /stripe/webhook — handle Stripe subscription events
    if (url.pathname === "/stripe/webhook" && request.method === "POST") {
      const sigHeader = request.headers.get("stripe-signature") || "";
      const rawBody = await request.text();

      const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      let event;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const email = (session.customer_email || (session.metadata && session.metadata.user_email) || "").toLowerCase();
        if (email) {
          let user = await env.USERS.get(email, "json");
          if (!user) {
            // Auto-create user if webhook fires before KV write (race condition safety net)
            user = {
              email,
              createdAt: new Date().toISOString(),
              plan: "premium",
              subscribedToNewsletter: true,
            };
          }
          user.plan = "premium";
          user.stripeCustomerId = session.customer || "";
          user.stripeSubscriptionId = session.subscription || "";
          await env.USERS.put(email, JSON.stringify(user));
        }
      }

      if (event.type === "customer.subscription.deleted" || event.type === "invoice.payment_failed") {
        const obj = event.data.object;
        const customerId = obj.customer;
        if (customerId) {
          // Look up customer email via Stripe API
          const customerRes = await fetch(
            `https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`,
            { headers: { Authorization: `Basic ${btoa(env.STRIPE_SECRET_KEY + ":")}` } },
          );
          if (customerRes.ok) {
            const customer = await customerRes.json();
            const email = (customer.email || "").toLowerCase();
            if (email) {
              const user = await env.USERS.get(email, "json");
              if (user) {
                user.plan = "free";
                await env.USERS.put(email, JSON.stringify(user));
              }
            }
          }
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /chat — validate session, proxy to xAI
    if (url.pathname === "/chat" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { session_id, messages } = body;
      if (!messages || !Array.isArray(messages)) {
        return new Response(JSON.stringify({ error: "Missing messages" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check account-based auth first (Bearer token)
      let authorized = false;
      const accountUser = await getSessionUser(request, env);
      if (accountUser && accountUser.plan === "premium") {
        authorized = true;
      }

      // Fall back to Stripe session validation
      if (!authorized) {
        if (!session_id) {
          return new Response(JSON.stringify({ error: "Missing session_id or account" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const stripeRes = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`,
          {
            headers: {
              Authorization: `Basic ${btoa(env.STRIPE_SECRET_KEY + ":")}`,
            },
          }
        );
        const session = await stripeRes.json();

        if (!stripeRes.ok || session.payment_status !== "paid") {
          return new Response(JSON.stringify({ error: "Payment not verified" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Check 24h expiry
        const ageMs = Date.now() - session.created * 1000;
        if (ageMs > 24 * 60 * 60 * 1000) {
          return new Response(JSON.stringify({ error: "Session expired" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

      }

      // Proxy to xAI with streaming
      const xaiRes = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.XAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-3-mini",
          stream: true,
          messages: [
            {
              role: "system",
              content:
                "You are The Git Times assistant. You help readers understand trending GitHub repositories and developer news. Be concise, technical, and helpful. When given article context, answer questions about those specific projects.",
            },
            ...messages,
          ],
        }),
      });

      if (!xaiRes.ok) {
        return new Response(JSON.stringify({ error: "AI service error" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(xaiRes.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    // --- Newsletter endpoints ---

    // POST /newsletter/send — send newsletter to all subscribers (called by CI)
    if (url.pathname === "/newsletter/send" && request.method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      if (auth !== `Bearer ${env.NEWSLETTER_SECRET}`) {
        return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { headline, subheadline, tagline, date, repos } = body;
      const editionUrl = body.url;

      // Collect all subscriber emails (paginated KV list)
      const emails = [];
      let cursor = null;
      do {
        const listOpts = { limit: 1000 };
        if (cursor) listOpts.cursor = cursor;
        const result = await env.SUBSCRIBERS.list(listOpts);
        for (const key of result.keys) {
          emails.push(key.name);
        }
        cursor = result.list_complete ? null : result.cursor;
      } while (cursor);

      // Filter out unsubscribed users
      const recipients = [];
      for (const email of emails) {
        const user = await env.USERS.get(email, "json");
        if (user && user.subscribedToNewsletter === false) continue;
        recipients.push(email);
      }

      if (recipients.length === 0) {
        return new Response(JSON.stringify({ ok: true, sent: 0 }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Send in batches of 100 via Resend batch API
      let totalSent = 0;
      for (let i = 0; i < recipients.length; i += 100) {
        const batch = recipients.slice(i, i + 100);
        const emailPayloads = [];
        for (const email of batch) {
          const token = await generateUnsubscribeToken(email, env.NEWSLETTER_SECRET);
          const unsubscribeUrl = `${url.origin}/newsletter/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
          emailPayloads.push({
            from: "The Git Times <noreply@gittimes.com>",
            to: [email],
            subject: headline || "Today's Git Times",
            html: renderNewsletterHtml({
              headline,
              subheadline: subheadline || "",
              tagline: tagline || "",
              date: date || "",
              url: editionUrl || "https://gittimes.com/latest/",
              repos: repos || [],
              unsubscribeUrl,
            }),
          });
        }

        const res = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(emailPayloads),
        });

        if (res.ok) {
          totalSent += batch.length;
        }
      }

      return new Response(JSON.stringify({ ok: true, sent: totalSent }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /newsletter/unsubscribe — one-click unsubscribe
    if (url.pathname === "/newsletter/unsubscribe" && request.method === "GET") {
      const email = (url.searchParams.get("email") || "").trim().toLowerCase();
      const token = url.searchParams.get("token") || "";

      if (!email || !token) {
        return new Response("<h1>Invalid unsubscribe link</h1>", {
          status: 400,
          headers: { "Content-Type": "text/html" },
        });
      }

      const expected = await generateUnsubscribeToken(email, env.NEWSLETTER_SECRET);
      if (token !== expected) {
        return new Response("<h1>Invalid unsubscribe link</h1>", {
          status: 403,
          headers: { "Content-Type": "text/html" },
        });
      }

      // Update user preference
      const user = await env.USERS.get(email, "json");
      if (user) {
        user.subscribedToNewsletter = false;
        await env.USERS.put(email, JSON.stringify(user));
      } else {
        await env.USERS.put(email, JSON.stringify({
          email,
          createdAt: new Date().toISOString(),
          plan: "free",
          subscribedToNewsletter: false,
        }));
      }

      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Unsubscribed</title></head>
<body style="margin:0;padding:60px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;background:#f4f1eb;">
<h1 style="font-family:Georgia,serif;color:#2c2c2c;">Unsubscribed</h1>
<p style="color:#555;">You've been unsubscribed from The Git Times newsletter.</p>
<p style="margin-top:24px;"><a href="https://gittimes.com" style="color:#2c2c2c;">Visit The Git Times</a></p>
</body></html>`, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }

    // POST /auth/update-newsletter — toggle newsletter preference
    if (url.pathname === "/auth/update-newsletter" && request.method === "POST") {
      const user = await getSessionUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      user.subscribedToNewsletter = !!body.subscribedToNewsletter;
      await env.USERS.put(user.email, JSON.stringify(user));

      return new Response(JSON.stringify({ ok: true, subscribedToNewsletter: user.subscribedToNewsletter }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};
