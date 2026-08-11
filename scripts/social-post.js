#!/usr/bin/env node
// social-post.js — draft, queue, and post a daily social post from the edition manifest.
//
//   node scripts/social-post.js draft     # write queue/social/<date>.json (pending approval)
//   node scripts/social-post.js approve   # mark latest pending post approved
//   node scripts/social-post.js post      # send approved+unposted posts (dry-run without creds)
//
// The words are the newsroom's — headline + deck verbatim. No LLM in the loop.
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const SITE_URL = process.env.SITE_URL || "https://gittimes.dev";
const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(ROOT, "site", "editions", "manifest.json");
const QUEUE_DIR = path.join(ROOT, "queue", "social");

// X counts every URL as 23 chars regardless of length.
// Bluesky counts the full URL text against its 300-char limit.
const LIMITS = {
  x: { max: 280, urlWeight: () => 23 },
  bluesky: { max: 300, urlWeight: (url) => url.length },
};

function latestEdition() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error("Empty edition manifest");
  }
  return manifest.reduce((a, b) => (a.date > b.date ? a : b));
}

function taggedLink(edition, source) {
  return `${SITE_URL}${edition.url}?utm_source=${source}&utm_medium=social&utm_campaign=daily`;
}

/** Headline is sacred; the deck absorbs the trim. */
function composePost(edition, source) {
  const { max, urlWeight } = LIMITS[source] || LIMITS.x;
  const link = taggedLink(edition, source);
  const budget = max - urlWeight(link) - 4; // two double-newlines
  let deck = edition.subheadline || "";
  const over = edition.headline.length + deck.length - budget;
  if (over > 0) {
    deck = deck.slice(0, Math.max(0, deck.length - over - 1)).replace(/\s+\S*$/, "") + "…";
  }
  return deck
    ? `${edition.headline}\n\n${deck}\n\n${link}`
    : `${edition.headline}\n\n${link}`;
}

function queuePath(date) {
  return path.join(QUEUE_DIR, `${date}.json`);
}

function draft() {
  const edition = latestEdition();
  const file = queuePath(edition.date);
  if (fs.existsSync(file)) {
    console.log(`Already queued: ${file}`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
  const entry = {
    edition: edition.date,
    headline: edition.headline,
    posts: {
      x: composePost(edition, "x"),
      bluesky: composePost(edition, "bluesky"),
    },
    approved: false,
    posted: {},
  };
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
  console.log(`Queued for approval: ${file}`);
  console.log("---\n" + entry.posts.x);
  return entry;
}

function pendingFiles() {
  if (!fs.existsSync(QUEUE_DIR)) return [];
  return fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith(".json")).sort();
}

function approve() {
  const files = pendingFiles();
  const target = files.reverse().find((f) => {
    const e = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), "utf8"));
    return !e.approved;
  });
  if (!target) {
    console.log("Nothing pending approval.");
    return;
  }
  const file = path.join(QUEUE_DIR, target);
  const entry = JSON.parse(fs.readFileSync(file, "utf8"));
  entry.approved = true;
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
  console.log(`Approved: ${target}`);
}

async function post() {
  for (const f of pendingFiles()) {
    const file = path.join(QUEUE_DIR, f);
    const entry = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!entry.approved) continue;
    for (const network of Object.keys(entry.posts)) {
      if (entry.posted[network]) continue; // idempotent: edition+network posts once
      const result = await send(network, entry.posts[network]);
      if (result) {
        entry.posted[network] = { at: new Date().toISOString(), ...result };
        fs.writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
      }
    }
  }
}

async function send(network, text) {
  if (network === "bluesky") return sendBluesky(text);
  if (network === "x") return sendX(text);
  return null;
}

async function sendBluesky(text) {
  const handle = process.env.BSKY_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD;
  if (!handle || !password) {
    console.log(`[dry-run bluesky]\n${text}\n`);
    return null;
  }
  const base = "https://bsky.social/xrpc";
  const sessionRes = await fetch(`${base}/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password }),
  });
  if (!sessionRes.ok) throw new Error(`bsky auth failed: ${sessionRes.status}`);
  const session = await sessionRes.json();

  // Link facet so the URL is clickable.
  const urlMatch = text.match(/https?:\/\/\S+/);
  const facets = [];
  if (urlMatch) {
    const byteStart = Buffer.byteLength(text.slice(0, urlMatch.index));
    facets.push({
      index: { byteStart, byteEnd: byteStart + Buffer.byteLength(urlMatch[0]) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: urlMatch[0] }],
    });
  }
  const postRes = await fetch(`${base}/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        facets,
        createdAt: new Date().toISOString(),
      },
    }),
  });
  if (!postRes.ok) throw new Error(`bsky post failed: ${postRes.status}`);
  const record = await postRes.json();
  console.log(`Posted to Bluesky: ${record.uri}`);
  return { uri: record.uri };
}

async function sendX(text) {
  const token = process.env.X_ACCESS_TOKEN; // OAuth2 user token with tweet.write
  if (!token) {
    console.log(`[dry-run x]\n${text}\n`);
    return null;
  }
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`x post failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  console.log(`Posted to X: ${data.data.id}`);
  return { id: data.data.id };
}

async function main() {
  const cmd = process.argv[2] || "draft";
  if (cmd === "draft") draft();
  else if (cmd === "approve") approve();
  else if (cmd === "post") await post();
  else {
    console.error("Usage: social-post.js [draft|approve|post]");
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { latestEdition, composePost, draft };
