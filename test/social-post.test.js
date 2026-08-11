const { test } = require("node:test");
const assert = require("node:assert");
const { composePost } = require("../scripts/social-post");

const edition = {
  date: "2026-06-24",
  url: "/editions/2026-06-24/",
  headline: "Cloudflare Releases Agent-Driven Security Audit Skill for Autonomous Vulnerability Discovery",
  subheadline:
    "A six-phase AI agent pipeline that independently verifies findings to reduce false positives in security audits",
};

test("x post fits 280 with url counted as 23", () => {
  const post = composePost(edition, "x");
  const url = post.match(/https?:\/\/\S+/)[0];
  const counted = post.length - url.length + 23;
  assert.ok(counted <= 280, `counted ${counted} > 280`);
  assert.ok(post.startsWith(edition.headline), "headline must survive verbatim");
});

test("bluesky post fits 300 with full url counted", () => {
  const post = composePost(edition, "bluesky");
  assert.ok(post.length <= 300, `length ${post.length} > 300`);
  assert.ok(post.startsWith(edition.headline), "headline must survive verbatim");
});

test("long deck is trimmed with ellipsis, headline untouched", () => {
  const long = { ...edition, subheadline: "word ".repeat(80).trim() };
  const post = composePost(long, "bluesky");
  assert.ok(post.length <= 300, `length ${post.length} > 300`);
  assert.ok(post.includes("…"), "trim marker expected");
  assert.ok(post.startsWith(long.headline));
});

test("utm source matches network", () => {
  assert.ok(composePost(edition, "x").includes("utm_source=x"));
  assert.ok(composePost(edition, "bluesky").includes("utm_source=bluesky"));
});
