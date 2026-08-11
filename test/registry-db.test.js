const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { recordRegistry, getEntityHistory, getEntityTimeline, closeDb } = require("../src/db");
const { buildRegistry } = require("../src/registry");

const NOW = Date.parse("2026-07-29T00:00:00Z");
const iso = (d) => new Date(NOW - d * 86400000).toISOString();

let dataDir;

const sources = {
  modelDrops: [
    {
      id: "deepseek-ai/DeepSeek-V4",
      author: "deepseek-ai",
      name: "DeepSeek-V4",
      likes: 900,
      downloads: 12,
      createdAt: iso(2),
      ageDays: 2,
      url: "https://huggingface.co/deepseek-ai/DeepSeek-V4",
    },
  ],
  releases: [
    {
      repo: "QwenLM/Qwen-Agent",
      owner: "QwenLM",
      name: "Qwen-Agent",
      tag: "v1.2.0",
      reactions: 30,
      publishedAt: iso(1),
      ageDays: 1,
      url: "https://github.com/QwenLM/Qwen-Agent/releases/tag/v1.2.0",
    },
  ],
};

before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gittimes-registry-"));
});
after(() => {
  closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("registry persistence", () => {
  it("records entities and their events, then reads the history back", () => {
    const { entities } = buildRegistry(sources, { nowMs: NOW });
    recordRegistry(dataDir, "2026-07-29", entities);

    const history = getEntityHistory(dataDir);
    assert.ok(history.get("deepseek"), "deepseek should have a file");
    assert.equal(history.get("deepseek").storyCount, 1);
    assert.equal(history.get("deepseek").firstSeen, "2026-07-29");
  });

  it("is idempotent across a republish of the same day", () => {
    // Republishing a day is routine (skip_newsletter reruns). It must not
    // inflate the story count, or "tracked since / 31 stories" becomes fiction.
    const { entities } = buildRegistry(sources, { nowMs: NOW });
    recordRegistry(dataDir, "2026-07-29", entities);
    recordRegistry(dataDir, "2026-07-29", entities);
    assert.equal(getEntityHistory(dataDir).get("deepseek").storyCount, 1);
  });

  it("keeps first_seen sticky while last_seen advances", () => {
    const { entities } = buildRegistry(sources, { nowMs: NOW });
    recordRegistry(dataDir, "2026-08-01", entities);
    assert.equal(getEntityHistory(dataDir).get("deepseek").firstSeen, "2026-07-29");
  });

  it("accumulates distinct events into a timeline, newest first", () => {
    const later = buildRegistry(
      {
        modelDrops: [
          {
            id: "deepseek-ai/DeepSeek-V5",
            author: "deepseek-ai",
            name: "DeepSeek-V5",
            likes: 100,
            createdAt: iso(0),
            ageDays: 0,
            url: "https://huggingface.co/deepseek-ai/DeepSeek-V5",
          },
        ],
      },
      { nowMs: NOW }
    );
    recordRegistry(dataDir, "2026-08-02", later.entities);

    const timeline = getEntityTimeline(dataDir, "deepseek");
    assert.equal(timeline.length, 2);
    assert.equal(timeline[0].title, "DeepSeek-V5");
    assert.equal(getEntityHistory(dataDir).get("deepseek").storyCount, 2);
  });

  it("round-trips the evidence receipt", () => {
    const [event] = getEntityTimeline(dataDir, "qwen");
    assert.match(event.evidence.source, /github/);
    assert.equal(event.evidence.ref, "QwenLM/Qwen-Agent");
    assert.ok(event.metrics.reactions >= 0);
  });
});
