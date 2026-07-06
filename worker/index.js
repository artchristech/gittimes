// Chat provider — OpenRouter (OpenAI-compatible), matching src/xai.js.
// In-file default is the PAID model: if env.CHAT_MODEL is ever dropped from the
// worker config, paid chat must NOT silently degrade to a rate-limited free
// model. Override via env.CHAT_MODEL / env.LLM_BASE_URL.
const CHAT_MODEL = "openai/gpt-4o-mini";
const CHAT_BASE_URL = "https://openrouter.ai/api/v1";

// --- AI assistant system prompt + live market context ---

// Cached compact model-pricing summary published by the daily edition
// (site /data/models.json). Lets the assistant answer live pricing questions.
let _marketCache = { at: 0, data: null };
const MARKET_TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function getMarketContext(env, now) {
  const ts = now || _nowMs();
  if (_marketCache.data && ts - _marketCache.at < MARKET_TTL_MS) return _marketCache.data;
  try {
    const origin = env.SITE_BASE_URL || "https://gittimes.com";
    const res = await fetch(`${origin}/data/models.json`, {
      signal: AbortSignal.timeout(4000),
      cf: { cacheTtl: 21600, cacheEverything: true },
    });
    if (!res.ok) return _marketCache.data;
    const summary = await res.json();
    _marketCache = { at: ts, data: summary };
    return summary;
  } catch {
    return _marketCache.data;
  }
}

function _nowMs() {
  return Date.now();
}

function buildSystemPrompt(market) {
  const today = new Date().toISOString().slice(0, 10);
  let priceBlock = "";
  if (market && Array.isArray(market.models) && market.models.length) {
    const rows = market.models
      .slice(0, 12)
      .map((m) => {
        const ctx = m.context_length
          ? m.context_length >= 1e6
            ? `${(m.context_length / 1e6).toFixed(1)}M ctx`
            : `${Math.round(m.context_length / 1000)}k ctx`
          : "";
        const vision = (m.input_modalities || []).includes("image") ? " vision" : "";
        return `- ${m.label} (${m.provider}): $${m.input}/M in, $${m.output}/M out${ctx ? ", " + ctx : ""}${vision}`;
      })
      .join("\n");
    priceBlock = `\n\nLIVE AI MODEL PRICING (per 1M tokens, from OpenRouter, synced ${market.syncedAt ? market.syncedAt.slice(0, 10) : "recently"}). Use this when a builder asks what model to use or what something costs:\n${rows}\nFull table: https://gittimes.com/markets/`;
  }
  return `You are the Git Times AI desk — the resident assistant of The Git Times, a daily newspaper for software builders. Today is ${today}.

Your readers are engineers, founders, and indie hackers. Your job is to turn today's developer news and the open-source landscape into signal they can act on.

How you answer:
- Be concrete and technical. Lead with the answer, then the reasoning. No hype, no filler, no hedging.
- When discussing a project from the paper, ground your answer in the article context you were given.
- Help builders DECIDE: which tool to reach for, how it compares to alternatives, what it would take to adopt, and the trade-offs.
- Format with Markdown: **bold** for key terms, \`backticks\` for code, tools, and commands, and bullet lists for comparisons or steps. Use short code blocks when a snippet helps.
- Keep it tight — a few sharp paragraphs, not an essay. End with a useful next step or a sharper follow-up question when it fits.
- If you don't know or the context doesn't say, say so plainly rather than inventing details.${priceBlock}`;
}

// Appended to the system prompt when the client asks for visible reasoning.
const THINKING_INSTRUCTION =
  "\n\nReasoning mode: begin with a single <thinking>...</thinking> block — a few concise sentences of your reasoning, what the grounding supports, and any caveats. Then give the final answer AFTER the closing </thinking> tag. Keep the thinking short.";

// --- AI Desk corpus retrieval (full-corpus RAG with citations) ---
//
// INLINED, KEPT IN SYNC with src/retrieve.js — the worker must stay import-free
// because its test harness compiles it from a standalone string. The canonical
// (unit-tested) copy lives in src/retrieve.js; change both together.

const RAG_STOPWORDS = new Set(
  ("a an and are as at be by for from has have how i in is it its of on or that the to was what when where which who " +
    "with you your about into over than then this these those tell me show find get does do can could would should " +
    "whats what's vs versus best good any all more most use using used")
    .split(" ")
);

function ragTokenize(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !RAG_STOPWORDS.has(t));
}

function scoreChunks(query, chunks, opts) {
  const o = opts || {};
  const k = o.k || 6;
  const now = o.now || _nowMs();
  const recencyWeight = o.recencyWeight != null ? o.recencyWeight : 0.3;
  const halfLifeDays = o.halfLifeDays || 45;
  const minScore = o.minScore || 0;
  const K1 = 1.2;
  const B = 0.75;
  const DAY_MS = 86400000;

  const qTerms = Array.from(new Set(ragTokenize(query)));
  if (!qTerms.length || !chunks.length) return [];

  const docTokens = new Array(chunks.length);
  const df = new Map();
  let totalLen = 0;
  for (let d = 0; d < chunks.length; d++) {
    const toks = ragTokenize(chunks[d].text);
    docTokens[d] = toks;
    totalLen += toks.length;
    const seen = new Set();
    for (const t of toks) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const N = chunks.length;
  const avgdl = totalLen / N || 1;
  const idf = new Map();
  for (const t of qTerms) {
    const n = df.get(t) || 0;
    idf.set(t, Math.max(0, Math.log(1 + (N - n + 0.5) / (n + 0.5))));
  }

  const results = [];
  for (let d = 0; d < N; d++) {
    const toks = docTokens[d];
    if (!toks.length) continue;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    let bm25 = 0;
    const matched = [];
    for (const t of qTerms) {
      const f = tf.get(t);
      if (!f) continue;
      matched.push(t);
      const denom = f + K1 * (1 - B + (B * toks.length) / avgdl);
      bm25 += idf.get(t) * ((f * (K1 + 1)) / denom);
    }
    if (bm25 <= 0) continue;
    const c = chunks[d];
    let recency = 1;
    if (c.date) {
      const ageDays = Math.max(0, (now - Date.parse(c.date + "T00:00:00Z")) / DAY_MS);
      recency = 1 + recencyWeight * Math.pow(0.5, ageDays / halfLifeDays);
    }
    const score = bm25 * recency;
    if (score > minScore) results.push({ chunk: c, score, bm25, matched });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}

function formatGrounding(results) {
  if (!results || !results.length) return { block: "", sources: [] };
  const lines = [];
  const sources = [];
  results.forEach((r, idx) => {
    const n = idx + 1;
    const c = r.chunk;
    const tag = c.repo ? c.repo : "edition";
    const stars = c.stars != null ? `, ${c.stars.toLocaleString()}★` : "";
    lines.push(`[${n}] ${c.title} (${tag}, ${c.date}${stars})\n    ${c.text}`);
    sources.push({ n, title: c.title, url: c.url, repo: c.repo || null, date: c.date });
  });
  const block =
    "\n\nGROUNDING — relevant Git Times coverage retrieved for this question. " +
    "Cite the sources you use inline as [n], and if these don't answer the question, say so plainly rather than guessing:\n" +
    lines.join("\n");
  return { block, sources };
}

// Corpus cache (per-isolate), refreshed from the published static asset.
let _corpusCache = { at: 0, data: null };
const CORPUS_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const RAG_MIN_SCORE = 2.5; // require a reasonably strong match before grounding

async function getCorpus(env, now) {
  const ts = now || _nowMs();
  if (_corpusCache.data && ts - _corpusCache.at < CORPUS_TTL_MS) return _corpusCache.data;
  try {
    const origin = env.SITE_BASE_URL || "https://gittimes.com";
    const res = await fetch(`${origin}/data/corpus.json`, {
      signal: AbortSignal.timeout(4000),
      cf: { cacheTtl: 21600, cacheEverything: true },
    });
    if (!res.ok) return _corpusCache.data;
    const data = await res.json();
    _corpusCache = { at: ts, data };
    return data;
  } catch {
    return _corpusCache.data;
  }
}

// The client stuffs context as "<label>:\n<context>\n\nQuestion: <text>". Pull
// just the question for retrieval so we match on intent, not the dumped context.
function extractQuery(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && typeof m.content === "string") {
      const idx = m.content.lastIndexOf("\nQuestion: ");
      return (idx >= 0 ? m.content.slice(idx + "\nQuestion: ".length) : m.content).slice(0, 400);
    }
  }
  return "";
}

async function buildGrounding(env, messages, now) {
  try {
    const q = extractQuery(messages);
    if (!q) return { block: "", sources: [] };
    const corpus = await getCorpus(env, now);
    if (!corpus || !Array.isArray(corpus.chunks)) return { block: "", sources: [] };
    const results = scoreChunks(q, corpus.chunks, { k: 6, now: now || _nowMs(), minScore: RAG_MIN_SCORE });
    return formatGrounding(results);
  } catch {
    return { block: "", sources: [] };
  }
}

// --- Repo tool-use + compare (the research-agent path) ---
//
// When a question reads like a lookup/comparison, we let the model call tools
// (GitHub API + the market data) in a bounded loop, then stream the grounded
// answer. Intent-gated so ordinary chat stays a single cheap streaming call.

const MAX_TOOL_ROUNDS = 4;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TOOL_INTENT_RE =
  /\b(compare|compared|comparison|versus|vs\.?|diff|difference between|readme|read me|changelog|release notes?|releases?|which is better|stack(?:s)? up against)\b/i;

function detectToolIntent(q) {
  return TOOL_INTENT_RE.test(q || "");
}

const TOOL_DEFS = [
  { type: "function", function: { name: "get_repo_meta", description: "Get a GitHub repo's stars, forks, open issues, primary language, license, topics, description, homepage and last-push date.", parameters: { type: "object", properties: { repo: { type: "string", description: "owner/name, e.g. facebook/react" } }, required: ["repo"] } } },
  { type: "function", function: { name: "get_repo_readme", description: "Get the README text of a GitHub repo (default branch).", parameters: { type: "object", properties: { repo: { type: "string", description: "owner/name" } }, required: ["repo"] } } },
  { type: "function", function: { name: "get_repo_file", description: "Read a specific file from a GitHub repo's default branch.", parameters: { type: "object", properties: { repo: { type: "string", description: "owner/name" }, path: { type: "string", description: "file path within the repo, e.g. package.json" } }, required: ["repo", "path"] } } },
  { type: "function", function: { name: "get_repo_releases", description: "List a GitHub repo's recent releases — tag, name, date, and notes.", parameters: { type: "object", properties: { repo: { type: "string", description: "owner/name" } }, required: ["repo"] } } },
  { type: "function", function: { name: "compare_models", description: "Look up pricing, context window and modalities for AI models from the Git Times market data, to compare them.", parameters: { type: "object", properties: { models: { type: "array", items: { type: "string" }, description: "model names or ids to compare, e.g. ['gpt-4o-mini','claude haiku']" } }, required: ["models"] } } },
];

function _b64decode(s) {
  const clean = String(s || "").replace(/\s+/g, "");
  try {
    return decodeURIComponent(escape(atob(clean)));
  } catch {
    try {
      return atob(clean);
    } catch {
      return "";
    }
  }
}

async function ghFetch(apiPath, env) {
  const headers = { "User-Agent": "git-times-ai-desk", Accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return fetch(`https://api.github.com${apiPath}`, { headers, signal: AbortSignal.timeout(6000) });
}

async function executeTool(name, args, env) {
  try {
    if (name === "compare_models") {
      const market = await getMarketContext(env);
      const list = (market && market.models) || [];
      const want = Array.isArray(args.models) ? args.models.slice(0, 4) : [];
      if (!want.length) return "No models specified.";
      return want
        .map((w) => {
          const q = String(w).toLowerCase();
          const m = list.find(
            (x) => (x.label || "").toLowerCase().includes(q) || (x.provider || "").toLowerCase().includes(q)
          );
          if (!m) return `${w}: not found in Git Times market data`;
          const ctx = m.context_length ? `${Math.round(m.context_length / 1000)}k ctx` : "ctx ?";
          const vision = (m.input_modalities || []).includes("image") ? ", vision" : "";
          return `${m.label} (${m.provider}): $${m.input}/M in, $${m.output}/M out, ${ctx}${vision}`;
        })
        .join("\n");
    }

    const repo = args.repo;
    if (!repo || !REPO_RE.test(repo)) return `Invalid repo "${repo}". Use the form owner/name.`;

    if (name === "get_repo_meta") {
      const r = await ghFetch(`/repos/${repo}`, env);
      if (!r.ok) return `GitHub: repo ${repo} not found (HTTP ${r.status}).`;
      const d = await r.json();
      return JSON.stringify({
        full_name: d.full_name,
        stars: d.stargazers_count,
        forks: d.forks_count,
        open_issues: d.open_issues_count,
        language: d.language,
        license: d.license && d.license.spdx_id,
        topics: d.topics,
        description: d.description,
        homepage: d.homepage,
        pushed_at: d.pushed_at,
      });
    }
    if (name === "get_repo_readme") {
      const r = await ghFetch(`/repos/${repo}/readme`, env);
      if (!r.ok) return `GitHub: no README for ${repo} (HTTP ${r.status}).`;
      const d = await r.json();
      return _b64decode(d.content).slice(0, 6000) || "(README was empty)";
    }
    if (name === "get_repo_file") {
      const path = String(args.path || "").replace(/^\/+/, "");
      if (!path || path.includes("..")) return "Invalid file path.";
      const enc = path.split("/").map(encodeURIComponent).join("/");
      const r = await ghFetch(`/repos/${repo}/contents/${enc}`, env);
      if (!r.ok) return `GitHub: ${path} not found in ${repo} (HTTP ${r.status}).`;
      const d = await r.json();
      if (Array.isArray(d)) return `${path} is a directory containing: ${d.map((x) => x.name).join(", ").slice(0, 1500)}`;
      return _b64decode(d.content).slice(0, 6000) || "(file was empty)";
    }
    if (name === "get_repo_releases") {
      const r = await ghFetch(`/repos/${repo}/releases?per_page=5`, env);
      if (!r.ok) return `GitHub: no releases for ${repo} (HTTP ${r.status}).`;
      const d = await r.json();
      if (!Array.isArray(d) || !d.length) return `${repo} has no published releases.`;
      return d
        .map((x) => `${x.tag_name}${x.name ? ` — ${x.name}` : ""} (${(x.published_at || "").slice(0, 10)})\n${(x.body || "").slice(0, 500)}`)
        .join("\n\n");
    }
    return `Unknown tool ${name}.`;
  } catch (e) {
    return `Tool ${name} failed: ${(e && e.message) || "error"}.`;
  }
}

// Bounded tool-resolution loop. Returns the model's final answer text (already
// grounded in any tool results). The last round forces tool_choice:"none" so we
// always terminate with an answer rather than another tool request.
async function resolveTools(systemContent, convo, env, baseUrl) {
  const messages = convo.slice();
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const last = round === MAX_TOOL_ROUNDS - 1;
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://gittimes.com",
        "X-Title": "The Git Times",
      },
      body: JSON.stringify({
        model: env.CHAT_MODEL || CHAT_MODEL,
        temperature: 0.4,
        messages: [{ role: "system", content: systemContent }, ...messages],
        tools: TOOL_DEFS,
        tool_choice: last ? "none" : "auto",
      }),
    });
    if (!res.ok) return { text: "" };
    let data;
    try {
      data = await res.json();
    } catch {
      return { text: "" };
    }
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) return { text: "" };
    if (!last && msg.tool_calls && msg.tool_calls.length) {
      messages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        let a = {};
        try {
          a = JSON.parse((tc.function && tc.function.arguments) || "{}");
        } catch {
          /* malformed tool args — pass empty */
        }
        const out = await executeTool(tc.function && tc.function.name, a, env);
        messages.push({ role: "tool", tool_call_id: tc.id, content: String(out).slice(0, 6000) });
      }
      continue;
    }
    return { text: msg.content || "" };
  }
  return { text: "" };
}

// --- Stats counter helpers ---

async function incrementStat(kv, key, delta) {
  const current = parseInt(await kv.get(key) || "0", 10);
  await kv.put(key, String(current + delta));
}

// Server-side transcript memory. Stored in USERS under a `transcript:` prefix
// (excluded from the user-count scans) keyed by email, so a reader's AI Desk
// conversation follows them across browsers/devices. Best-effort: never throws
// into the chat hot path. Capped to the last 40 turns and ~60KB.
async function persistTranscript(env, email, messages) {
  try {
    const convo = (messages || [])
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-40);
    if (convo.length === 0) return;
    let trimmed = convo;
    let payload = JSON.stringify({ updatedAt: new Date().toISOString(), messages: trimmed });
    while (payload.length > 60000 && trimmed.length > 2) {
      trimmed = trimmed.slice(2);
      payload = JSON.stringify({ updatedAt: new Date().toISOString(), messages: trimmed });
    }
    await env.USERS.put(`transcript:${email}`, payload, { expirationTtl: 60 * 60 * 24 * 30 });
  } catch { /* memory is best-effort */ }
}

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
  if (!env.RESEND_API_KEY) {
    console.error("magic-link: RESEND_API_KEY not set");
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "The Git Times <noreply@gittimes.com>",
      to: [email],
      subject: "Sign in to The Git Times",
      html: `<p>Click the link below to sign in to your Git Times account:</p><p><a href="${url}">${url}</a></p><p>This link expires in 15 minutes.</p><p>If you didn't request this, you can safely ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`magic-link Resend send failed (${res.status}) to ${email}: ${body}`);
  }
  return res.ok;
}

async function sendPaymentFailedEmail(email, env) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "The Git Times <noreply@gittimes.com>",
      to: [email],
      subject: "Action Required: Payment Failed — The Git Times",
      html: `<p>Your most recent payment for The Git Times Premium failed.</p><p>Please update your payment method within 3 days to keep your Premium access.</p><p><a href="https://gittimes.com/account/">Manage your account</a></p><p>If you don't update your payment, your account will revert to the Free plan.</p>`,
    }),
  });
  return res.ok;
}

async function sendUpgradeEmail(email, env) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "The Git Times <noreply@gittimes.com>",
      to: [email],
      subject: "Welcome to Premium — The Git Times",
      html: `<p>You're now a Premium member of The Git Times!</p><p>You have unlimited access to AI-powered chat about trending repos and developer news.</p><p><a href="https://gittimes.com/account/">Visit your account</a></p><p>Thank you for supporting The Git Times.</p>`,
    }),
  });
  return res.ok;
}

// Win-back email on cancellation — the leakiest hop in the funnel. Additive and
// non-fatal; mirrors sendUpgradeEmail's Resend shape.
async function sendWinbackEmail(email, env) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "The Git Times <noreply@gittimes.com>",
      to: [email],
      subject: "Your Premium has ended — come back any time",
      html: `<p>Your Premium subscription to The Git Times has ended, and your account is back on the Free plan.</p><p>You can still read every edition and ask a few AI questions a day. If you'd like unlimited AI access to trending repos and developer news again, you can re-subscribe any time.</p><p><a href="https://gittimes.com/account/">Reactivate Premium</a></p><p>We'd genuinely value knowing what made you cancel — just reply to this email.</p>`,
    }),
  });
  return res.ok;
}

// Owner-facing alert on each free->premium conversion. Strictly additive and
// env-gated: no-ops (returns false) when env.ALERT_EMAIL is unset so the feature
// is OFF by default. Mirrors the Resend pattern of the customer emails above.
async function sendConversionAlertEmail(session, env) {
  if (!env.ALERT_EMAIL) return false;
  const email = (session.customer_email || (session.metadata && session.metadata.user_email) || "").toLowerCase();
  const customerId = session.customer || "";
  const subscriptionId = session.subscription || "";
  const at = new Date().toISOString();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "The Git Times <noreply@gittimes.com>",
      to: [env.ALERT_EMAIL],
      subject: "New Premium conversion — The Git Times",
      html: `<p>A reader just converted free &rarr; premium.</p><ul><li>Email: ${email || "(unknown)"}</li><li>Stripe customer: ${customerId || "(none)"}</li><li>Stripe subscription: ${subscriptionId || "(none)"}</li><li>At: ${at}</li></ul>`,
    }),
  });
  return res.ok;
}

async function resolveGracePeriod(user, env) {
  if (user.gracePeriodEndsAt && new Date(user.gracePeriodEndsAt).getTime() < Date.now()) {
    const wasPremium = user.plan === "premium";
    const wasComped = !!user.comped;
    user.plan = "free";
    user.comped = false;
    delete user.gracePeriodEndsAt;
    await env.USERS.put(user.email, JSON.stringify(user));
    // Keep the stat counters honest on the lapse transition. Previously this
    // downgraded silently, so premiumUsers over-counted (and estimatedMRR with
    // it) after every dunning lapse. Guarded by wasPremium so the explicit
    // subscription.deleted path can't double-decrement an already-free user.
    if (wasPremium) {
      await incrementStat(env.USERS, "stats:premiumUsers", -1);
      if (wasComped) await incrementStat(env.USERS, "stats:compedUsers", -1);
    }
  }
  return user;
}

// Disposable / throwaway email domains. Fake accounts created from these poison
// the very funnel metric P0-A reads (anon→signup, totalUsers) and enable comp
// abuse, so they are refused at account creation. Conservative, extensible list.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "10minutemail.com",
  "tempmail.com", "temp-mail.org", "throwawaymail.com", "yopmail.com", "trashmail.com",
  "getnada.com", "sharklasers.com", "maildrop.cc", "fakeinbox.com", "mailnesia.com",
  "dispostable.com", "mintemail.com", "mohmal.com", "tempinbox.com", "spam4.me",
  "discard.email", "emailondeck.com", "mailcatch.com", "mvrht.net",
]);

function isDisposableEmail(email) {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(email.slice(at + 1));
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

const handler = {
  async fetch(request, env) {
    const _origin = request.headers.get("Origin") || "";
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

      if (isDisposableEmail(email)) {
        return new Response(JSON.stringify({ ok: false, error: "Please use a permanent email address." }), {
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
        await incrementStat(env.USERS, "stats:totalUsers", 1);
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

      const _magicUrl = `${allowed}/auth/verify?token=${token}`;
      // Use worker URL for verify endpoint
      const verifyUrl = `${url.origin}/auth/verify?token=${token}`;

      const sent = await sendMagicLinkEmail(email, verifyUrl, env);
      if (!sent) {
        return new Response(JSON.stringify({ ok: false, error: "Could not send the sign-in email. Please try again shortly." }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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
      await resolveGracePeriod(user, env);
      return new Response(JSON.stringify({
        ok: true,
        user: {
          email: user.email,
          plan: user.plan,
          subscribedToNewsletter: user.subscribedToNewsletter,
          createdAt: user.createdAt,
          chatUsage: user.chatUsage || null,
          chatLimit: parseInt(env.CHAT_MONTHLY_LIMIT || "1000"),
          freeChatUsage: user.freeChatUsage || null,
          freeDailyLimit: parseInt(env.FREE_DAILY_CHAT_LIMIT || "0"),
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /chat/history — the logged-in user's persisted AI Desk transcript, so
    // the conversation follows them across browsers/devices.
    if (url.pathname === "/chat/history" && request.method === "GET") {
      const user = await getSessionUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const saved = await env.USERS.get(`transcript:${user.email}`, "json");
      return new Response(JSON.stringify({
        ok: true,
        messages: (saved && saved.messages) || [],
        updatedAt: (saved && saved.updatedAt) || null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Saved AI Desk answers (bookmarks). Stored under `saved:<email>` in
    // USERS KV (excluded from user-count scans), newest-first, capped to 50. ---

    // GET /chat/saved — list the user's saved answers.
    if (url.pathname === "/chat/saved" && request.method === "GET") {
      const user = await getSessionUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const list = (await env.USERS.get(`saved:${user.email}`, "json")) || [];
      return new Response(JSON.stringify({ ok: true, saved: list }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /chat/saved — save an answer { text, question?, sources? }.
    if (url.pathname === "/chat/saved" && request.method === "POST") {
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
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        return new Response(JSON.stringify({ ok: false, error: "Missing text" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const list = (await env.USERS.get(`saved:${user.email}`, "json")) || [];
      const item = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        question: typeof body.question === "string" ? body.question.slice(0, 300) : "",
        text: text.slice(0, 8000),
        sources: Array.isArray(body.sources) ? body.sources.slice(0, 12) : [],
      };
      const capped = [item, ...list].slice(0, 50);
      await env.USERS.put(`saved:${user.email}`, JSON.stringify(capped));
      return new Response(JSON.stringify({ ok: true, item, count: capped.length }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /chat/saved/delete — remove a saved answer by { id }.
    if (url.pathname === "/chat/saved/delete" && request.method === "POST") {
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
        body = {};
      }
      const id = body.id;
      const list = (await env.USERS.get(`saved:${user.email}`, "json")) || [];
      const next = list.filter((x) => x.id !== id);
      await env.USERS.put(`saved:${user.email}`, JSON.stringify(next));
      return new Response(JSON.stringify({ ok: true, count: next.length }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /auth/settings — the logged-in user's saved reader settings (Theme/
    // Font/Size/Width + custom colors), so preferences follow them across
    // browsers and devices instead of living in per-browser localStorage.
    if (url.pathname === "/auth/settings" && request.method === "GET") {
      const user = await getSessionUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, settings: user.readerSettings || null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /auth/settings — persist reader settings to the account. Whitelisted
    // keys only, each coerced to a short string, so the record can't be bloated
    // or polluted with arbitrary client data.
    if (url.pathname === "/auth/settings" && request.method === "POST") {
      const user = await getSessionUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let body;
      try { body = await request.json(); } catch { body = null; }
      const incoming = body && typeof body === "object" ? (body.settings || body) : null;
      if (!incoming || typeof incoming !== "object") {
        return new Response(JSON.stringify({ ok: false, error: "Invalid settings" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ALLOWED = ["design", "theme", "font", "size", "width", "bgH", "bgS", "bgL", "txH", "txS", "txL"];
      // `design` selects a whole page identity, so only known presets are
      // stored — a junk value can never be replayed to other devices via GET.
      const DESIGNS = ["newspaper", "cyberpunk", "business", "whitepaper"];
      const clean = {};
      for (const key of ALLOWED) {
        if (incoming[key] != null) clean[key] = String(incoming[key]).slice(0, 16);
      }
      if (clean.design != null && !DESIGNS.includes(clean.design)) delete clean.design;
      user.readerSettings = clean;
      await env.USERS.put(user.email, JSON.stringify(user));
      return new Response(JSON.stringify({ ok: true, settings: clean }), {
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
        env.USERS.delete(`transcript:${user.email}`),
        env.USERS.delete(`saved:${user.email}`),
        env.SUBSCRIBERS.delete(user.email),
        env.SESSIONS.delete(token),
      ]);
      await incrementStat(env.USERS, "stats:totalUsers", -1);
      if (user.plan === "premium") {
        await incrementStat(env.USERS, "stats:premiumUsers", -1);
        if (user.comped) await incrementStat(env.USERS, "stats:compedUsers", -1);
      }

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

      if (isDisposableEmail(email)) {
        return new Response(JSON.stringify({ ok: false, error: "Please use a permanent email address." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Rate limit by IP (5 per 15 min) — caps fake-account farming that would
      // inflate totalUsers and poison the GT-FLAT funnel metric.
      const subscribeIp = request.headers.get("CF-Connecting-IP") || "unknown";
      const subscribeAllowed = await checkRateLimit(env.MAGIC_LINKS, `ratelimit:subscribe:${subscribeIp}`, 5, 900);
      if (!subscribeAllowed) {
        return new Response(JSON.stringify({ ok: false, error: "Too many requests. Please try again later." }), {
          status: 429,
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
        await incrementStat(env.USERS, "stats:totalUsers", 1);
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

      // Annual is the lower-churn / upfront-cash lane (same "premium" plan flag,
      // so the webhook is unchanged). Falls back to the monthly price if the
      // annual price object hasn't been created in Stripe yet — never breaks.
      const interval = (url.searchParams.get("interval") || "monthly").toLowerCase();
      const useAnnual = interval === "annual" && !!env.STRIPE_PRICE_ID_ANNUAL;
      const priceId = useAnnual ? env.STRIPE_PRICE_ID_ANNUAL : env.STRIPE_PRICE_ID;

      const checkoutParams = {
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        mode: "subscription",
        success_url: `${allowed}/account/?upgraded=true`,
        customer_email: sessionData.email,
        "metadata[user_email]": sessionData.email,
        "metadata[interval]": useAnnual ? "annual" : "monthly",
        allow_promotion_codes: "true",
        payment_method_collection: "if_required",
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

      // Idempotency guard — deduplicate webhook events (7-day TTL)
      const idempotencyKey = `webhook:${event.id}`;
      const alreadyProcessed = await env.MAGIC_LINKS.get(idempotencyKey);
      if (alreadyProcessed) {
        return new Response(JSON.stringify({ received: true, deduplicated: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      await env.MAGIC_LINKS.put(idempotencyKey, "1", { expirationTtl: 604800 });

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const email = (session.customer_email || (session.metadata && session.metadata.user_email) || "").toLowerCase();
        if (email) {
          let user = await env.USERS.get(email, "json");
          const wasNew = !user;
          const wasFree = user && user.plan !== "premium";
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
          // Truthful-MRR tagging: a fully-discounted checkout (e.g. a 100%-off
          // comp like CPHnews) has amount_total 0. Stamp it so estimatedMRR can
          // exclude comps instead of counting them as $5 of revenue.
          const isComped = session.amount_total === 0;
          user.comped = isComped;
          await env.USERS.put(email, JSON.stringify(user));
          if (wasNew) await incrementStat(env.USERS, "stats:totalUsers", 1);
          if (wasNew || wasFree) {
            await incrementStat(env.USERS, "stats:premiumUsers", 1);
            if (isComped) await incrementStat(env.USERS, "stats:compedUsers", 1);
          }
          try { await sendUpgradeEmail(email, env); } catch { /* non-fatal */ }
          // Owner alert — additive, non-fatal, env-gated. Must never affect the
          // premium-flip or 200 response above, so it has its own try/catch.
          try { await sendConversionAlertEmail(session, env); } catch { /* non-fatal */ }
        }
      }

      if (event.type === "customer.subscription.deleted") {
        const obj = event.data.object;
        const customerId = obj.customer;
        if (customerId) {
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
                const wasPremium = user.plan === "premium";
                const wasComped = !!user.comped;
                user.plan = "free";
                user.comped = false;
                user.cancelledAt = new Date().toISOString();
                user.churnReason = "customer.subscription.deleted";
                delete user.gracePeriodEndsAt;
                await env.USERS.put(email, JSON.stringify(user));
                if (wasPremium) {
                  await incrementStat(env.USERS, "stats:premiumUsers", -1);
                  if (wasComped) await incrementStat(env.USERS, "stats:compedUsers", -1);
                  // Win-back only for genuine paid churn, never comp expiry.
                  if (!wasComped) {
                    try { await sendWinbackEmail(email, env); } catch { /* non-fatal */ }
                  }
                }
              }
            }
          }
        }
      }

      if (event.type === "invoice.payment_failed") {
        const obj = event.data.object;
        const customerId = obj.customer;
        if (customerId) {
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
                user.gracePeriodEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
                await env.USERS.put(email, JSON.stringify(user));
                try { await sendPaymentFailedEmail(email, env); } catch { /* non-fatal */ }
              }
            }
          }
        }
      }

      // A recovered payment (Stripe Smart Retries succeeds, or a normal renewal)
      // must CLEAR any dunning grace flag — otherwise resolveGracePeriod() later
      // downgrades a customer who is still being billed. If the grace window had
      // already expired and the user was flipped to "free", a successful payment
      // restores premium and the stat. No-op (and no KV write) on a clean renewal
      // of an already-premium account, so this is safe to fire on every invoice.
      if (event.type === "invoice.payment_succeeded" || event.type === "invoice.paid") {
        const obj = event.data.object;
        const customerId = obj.customer;
        if (customerId) {
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
                const hadGrace = !!user.gracePeriodEndsAt;
                const wasNotPremium = user.plan !== "premium";
                if (hadGrace || wasNotPremium) {
                  delete user.gracePeriodEndsAt;
                  user.plan = "premium";
                  user.comped = false; // a real paid invoice recovered the account
                  await env.USERS.put(email, JSON.stringify(user));
                  // Restore the count only if the grace window had already lapsed
                  // and the user was downgraded (premiumUsers was decremented then).
                  if (wasNotPremium) await incrementStat(env.USERS, "stats:premiumUsers", 1);
                }
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
      // Per-IP burst cap BEFORE any LLM work — bounds OpenRouter spend and blocks
      // multi-account farming of the free daily allowance. Generous enough not to
      // affect a real conversation (30 requests / minute).
      const chatIp = request.headers.get("CF-Connecting-IP") || "unknown";
      const chatAllowed = await checkRateLimit(env.MAGIC_LINKS, `ratelimit:chat:${chatIp}`, 30, 60);
      if (!chatAllowed) {
        return new Response(JSON.stringify({ error: "Too many requests. Please slow down." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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

      // Message size limits
      const MAX_MESSAGES = 50;
      const MAX_MESSAGE_CHARS = 8000;
      const MAX_TOTAL_CHARS = 50000;
      if (messages.length > MAX_MESSAGES) {
        return new Response(JSON.stringify({ error: `Too many messages (max ${MAX_MESSAGES})` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let totalChars = 0;
      for (const msg of messages) {
        const len = typeof msg.content === "string" ? msg.content.length : 0;
        if (len > MAX_MESSAGE_CHARS) {
          return new Response(JSON.stringify({ error: `Message too long (max ${MAX_MESSAGE_CHARS} chars)` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        totalChars += len;
      }
      if (totalChars > MAX_TOTAL_CHARS) {
        return new Response(JSON.stringify({ error: `Total message content too long (max ${MAX_TOTAL_CHARS} chars)` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check account-based auth first (Bearer token).
      // Tiering: registered FREE accounts get a small daily allowance (a taste of
      // the AI desk that drives conversion); PREMIUM gets a high monthly cap.
      let authorized = false;
      const accountUser = await getSessionUser(request, env);
      if (accountUser) {
        await resolveGracePeriod(accountUser, env);
        if (accountUser.plan === "premium") {
          // Usage tracking — monthly chat counter
          const currentMonth = new Date().toISOString().slice(0, 7);
          if (!accountUser.chatUsage || accountUser.chatUsage.month !== currentMonth) {
            accountUser.chatUsage = { month: currentMonth, count: 0 };
          }
          const chatLimit = parseInt(env.CHAT_MONTHLY_LIMIT || "1000");
          if (accountUser.chatUsage.count >= chatLimit) {
            return new Response(JSON.stringify({ error: "Monthly chat limit reached" }), {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          accountUser.chatUsage.count++;
          await env.USERS.put(accountUser.email, JSON.stringify(accountUser));
          authorized = true;
        } else {
          // Free registered account. The AI Desk is a PREMIUM-ONLY feature: when
          // FREE_DAILY_CHAT_LIMIT <= 0 (the default, and current product setting)
          // free plans get NO model usage at all — we refuse before any LLM call.
          // A positive limit re-enables a daily "taste" of the desk.
          const today = new Date().toISOString().slice(0, 10);
          const freeLimit = parseInt(env.FREE_DAILY_CHAT_LIMIT || "0");
          if (!accountUser.freeChatUsage || accountUser.freeChatUsage.day !== today) {
            accountUser.freeChatUsage = { day: today, count: 0 };
          }
          if (freeLimit <= 0 || accountUser.freeChatUsage.count >= freeLimit) {
            // Funnel telemetry: a free user hit the upgrade wall.
            await incrementStat(env.USERS, "stats:wallHits", 1);
            return new Response(JSON.stringify({
              error: freeLimit <= 0 ? "AI Desk is a Premium feature" : "Free daily limit reached",
              upgrade: true,
              message:
                freeLimit <= 0
                  ? "The AI Desk is part of Premium. Upgrade for cited answers, reasoning, and repo tools."
                  : `You've used your ${freeLimit} free AI questions for today. Upgrade to Premium for unlimited access.`,
            }), {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          accountUser.freeChatUsage.count++;
          await env.USERS.put(accountUser.email, JSON.stringify(accountUser));
          authorized = true;
        }
      }

      // Server-side transcript memory — persist this account's conversation so the
      // AI Desk has continuity (client history is in-memory only). Best-effort.
      if (accountUser && authorized) {
        await persistTranscript(env, accountUser.email, messages);
      }

      // Fall back to Stripe session validation
      if (!authorized) {
        if (!session_id) {
          // Funnel telemetry: an anonymous visitor tried to ask (hop 2) with no
          // account and no paid session — a bounced lead.
          await incrementStat(env.USERS, "stats:anonAsks", 1);
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

      // Proxy to the LLM provider (OpenRouter) with streaming.
      const baseUrl = env.LLM_BASE_URL || CHAT_BASE_URL;
      const market = await getMarketContext(env);

      // Full-corpus RAG: retrieve relevant past coverage and ground the answer,
      // with [n] citations. Fail-soft — no grounding => an ordinary answer.
      const grounding = await buildGrounding(env, messages);
      const wantThinking = body.think === true;

      let systemContent = buildSystemPrompt(market);
      if (grounding.block) systemContent += grounding.block;
      if (wantThinking) systemContent += THINKING_INSTRUCTION;

      // Research-agent path: when the question reads like a lookup/comparison and
      // the user is a logged-in account, resolve tool calls (GitHub + market
      // data) in a bounded loop, then stream the grounded answer. Ordinary chat
      // skips this and streams in a single call (keeps the common path cheap).
      if (accountUser && detectToolIntent(extractQuery(messages))) {
        const resolved = await resolveTools(systemContent, messages, env, baseUrl);
        const answer =
          resolved.text || "I couldn't complete that lookup just now — try rephrasing your question.";
        const enc = new TextEncoder();
        const toolStream = new ReadableStream({
          start(controller) {
            if (grounding.sources && grounding.sources.length) {
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ sources: grounding.sources })}\n\n`));
            }
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`));
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(toolStream, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }

      const aiRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://gittimes.com",
          "X-Title": "The Git Times",
        },
        body: JSON.stringify({
          model: env.CHAT_MODEL || CHAT_MODEL,
          stream: true,
          temperature: 0.6,
          messages: [
            { role: "system", content: systemContent },
            ...messages,
          ],
        }),
      });

      if (!aiRes.ok) {
        return new Response(JSON.stringify({ error: "AI service error" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Prepend a custom SSE event carrying the citation sources, then pipe the
      // model stream through unchanged. The client ignores events without a
      // `choices` delta, so this is backward-compatible.
      const sourcesEvent =
        grounding.sources && grounding.sources.length
          ? `data: ${JSON.stringify({ sources: grounding.sources })}\n\n`
          : "";
      const upstream = aiRes.body;
      const streamOut = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          if (sourcesEvent) controller.enqueue(enc.encode(sourcesEvent));
          const reader = upstream.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } catch {
            /* upstream aborted mid-stream — close what we have */
          } finally {
            controller.close();
          }
        },
      });

      return new Response(streamOut, {
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
            from: env.EMAIL_FROM || "The Git Times <noreply@gittimes.com>",
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

    // POST /billing/portal — redirect premium users to Stripe customer portal
    if (url.pathname === "/billing/portal" && request.method === "POST") {
      const user = await getSessionUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!user.stripeCustomerId) {
        return new Response(JSON.stringify({ ok: false, error: "No billing account found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(env.STRIPE_SECRET_KEY + ":")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          customer: user.stripeCustomerId,
          return_url: `${allowed}/account/`,
        }),
      });
      const portal = await portalRes.json();
      if (!portalRes.ok) {
        return new Response(JSON.stringify({ ok: false, error: portal.error?.message || "Portal error" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, url: portal.url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /pricing — public pricing info
    if (url.pathname === "/pricing" && request.method === "GET") {
      const priceRes = await fetch(
        `https://api.stripe.com/v1/prices/${encodeURIComponent(env.STRIPE_PRICE_ID)}`,
        { headers: { Authorization: `Basic ${btoa(env.STRIPE_SECRET_KEY + ":")}` } },
      );
      const price = await priceRes.json();
      if (!priceRes.ok) {
        return new Response(JSON.stringify({ ok: false, error: "Failed to fetch pricing" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const amount = price.unit_amount;
      const currency = price.currency;
      const interval = price.recurring?.interval || "month";
      const display = `$${(amount / 100).toFixed(0)}/${interval}`;
      return new Response(JSON.stringify({ ok: true, amount, currency, interval, display }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /admin/stats — admin dashboard stats
    if (url.pathname === "/admin/stats" && request.method === "GET") {
      const authHeader = request.headers.get("Authorization") || "";
      if (authHeader !== `Bearer ${env.ADMIN_TOKEN}`) {
        return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let totalUsers = parseInt(await env.USERS.get("stats:totalUsers") || "0", 10);
      let premiumUsers = parseInt(await env.USERS.get("stats:premiumUsers") || "0", 10);
      let compedUsers = parseInt(await env.USERS.get("stats:compedUsers") || "0", 10);

      // Migration fallback: if counters haven't been seeded, run the scan once
      if (totalUsers === 0) {
        let cursor = null;
        let scannedTotal = 0;
        let scannedPremium = 0;
        let scannedComped = 0;
        do {
          const listOpts = { limit: 1000 };
          if (cursor) listOpts.cursor = cursor;
          const result = await env.USERS.list(listOpts);
          for (const key of result.keys) {
            if (key.name.startsWith("stats:") || key.name.startsWith("transcript:") || key.name.startsWith("saved:")) continue;
            const u = await env.USERS.get(key.name, "json");
            if (u) {
              scannedTotal++;
              if (u.plan === "premium") {
                scannedPremium++;
                if (u.comped) scannedComped++;
              }
            }
          }
          cursor = result.list_complete ? null : result.cursor;
        } while (cursor);
        if (scannedTotal > 0) {
          totalUsers = scannedTotal;
          premiumUsers = scannedPremium;
          compedUsers = scannedComped;
          await env.USERS.put("stats:totalUsers", String(totalUsers));
          await env.USERS.put("stats:premiumUsers", String(premiumUsers));
          await env.USERS.put("stats:compedUsers", String(compedUsers));
        }
      }

      const freeUsers = totalUsers - premiumUsers;
      // Paying premium only — comps (100%-off) are real users but $0 of revenue.
      const paidPremiumUsers = Math.max(0, premiumUsers - compedUsers);
      const priceAmount = parseInt(env.STRIPE_PRICE_AMOUNT || "500");
      const estimatedMRR = paidPremiumUsers * priceAmount / 100;
      const wallHits = parseInt(await env.USERS.get("stats:wallHits") || "0", 10);
      const anonAsks = parseInt(await env.USERS.get("stats:anonAsks") || "0", 10);
      return new Response(JSON.stringify({
        ok: true,
        totalUsers,
        premiumUsers,
        compedUsers,
        paidPremiumUsers,
        freeUsers,
        estimatedMRR,
        funnel: { anonAsks, wallHits },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },

  // Scheduled reconciliation (Cloudflare Cron — see wrangler.toml [triggers]).
  // resolveGracePeriod() otherwise only runs lazily on /auth/me and /chat, so a
  // lapsed-grace user who never returns is never downgraded and keeps inflating
  // premiumUsers / estimatedMRR. This sweep reconciles every grace-flagged user.
  async scheduled(_event, env) {
    let cursor = null;
    let reconciled = 0;
    do {
      const listOpts = { limit: 1000 };
      if (cursor) listOpts.cursor = cursor;
      const result = await env.USERS.list(listOpts);
      for (const key of result.keys) {
        if (key.name.startsWith("stats:") || key.name.startsWith("transcript:")) continue;
        const u = await env.USERS.get(key.name, "json");
        if (u && u.gracePeriodEndsAt) {
          const before = u.plan;
          await resolveGracePeriod(u, env);
          if (before === "premium" && u.plan === "free") reconciled++;
        }
      }
      cursor = result.list_complete ? null : result.cursor;
    } while (cursor);
    return reconciled;
  },
};

export default handler;

// Node.js testing compatibility
try { module.exports = handler; } catch { /* ESM environment */ }
