#!/usr/bin/env node
/**
 * Mock edition for visual iteration.
 *
 * Renders fixture data through the REAL pipeline (assembleHtml → templates/
 * newspaper.html + styles/newspaper.css), so what you see is exactly what
 * ships. Edit the CSS, re-run (or use --watch), refresh the browser.
 *
 *   npm run mock            # writes mock/index.html once
 *   npm run mock -- --watch # rebuilds on changes to styles/, templates/, src/render.js
 */
const fs = require("fs");
const path = require("path");
const { assembleHtml } = require("../src/render");

const OUT_DIR = path.join(__dirname, "..", "mock");
const OUT = path.join(OUT_DIR, "index.html");

// --- Fixtures: one of every state the paper can produce -------------------

function repo(name, overrides = {}) {
  return {
    url: `https://github.com/${name}`,
    name,
    stars: 12800,
    language: "Rust",
    releaseName: null,
    createdAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

const LEAD = {
  headline: "Open Runtime Puts Coding Agents on Laptops for Free",
  subheadline:
    "A 40MB Rust binary runs tool-calling agents locally, cutting cloud inference out of the loop for everyday tasks.",
  body:
    "The project ships a single static binary that hosts a full agent loop against any local GGUF model. Builders report it handles file edits and shell tasks that previously required a hosted frontier model. Under the hood it compiles a tool schema straight into the sampler's grammar, so the model can't emit malformed calls. Early benchmarks put it within striking distance of hosted mid-tier models on routine coding tasks. The maintainers say multi-agent support lands next month. **The catch:** context is capped at 32k tokens, and there is no Windows build yet.",
  useCases: [
    "Solo devs running agents offline on laptops",
    "Teams cutting inference spend on routine tasks",
    "Privacy-sensitive shops keeping code local",
  ],
  repo: repo("example/agent-rt", { releaseName: "v0.9.0" }),
  xSentiment: {
    sentiment: "positive",
    postCount: 14,
    blurb: "Builders praise the tiny footprint; some question the context cap.",
  },
  priorCoverage: [{ date: "2026-06-24", headline: "Agent Runtime Hits 10k Stars" }],
  leadRationale:
    "It moves real agent workloads off the cloud, which changes the cost math for every solo builder.",
};

const SECONDARY = [
  {
    headline: "Vector Database Learns to Forget, Slashing Index Bloat",
    subheadline: "Time-decay pruning keeps hot vectors fast while cold ones age out of the index automatically.",
    body:
      "The engine now expires vectors on a configurable decay curve instead of growing forever. Operators report indexes shrinking 60% with no recall loss on recent data. A compaction pass runs in the background with bounded IO. **The catch:** decay tuning is manual and a bad curve silently drops relevant results.",
    useCases: ["RAG apps with rolling news corpora", "Ops teams capping vector-store spend"],
    repo: repo("example/vectordb", { language: "Go", stars: 8400 }),
    xSentiment: { sentiment: "mixed", postCount: 6, blurb: "Praise for the idea, worries about silent recall loss." },
  },
  {
    // Edge case: very long headline + short body (no remainder behind the fold)
    headline:
      "Tiny Postgres Extension Turns Every Table Into a Streaming Change Feed Without Kafka, Debezium, or a Single New Server",
    subheadline: "Logical decoding piped straight to webhooks — infrastructure teams delete a whole moving part.",
    body: "One `CREATE EXTENSION` and every table emits ordered change events to any HTTP endpoint. **The catch:** delivery is at-least-once, so consumers must dedupe.",
    useCases: ["Side projects needing CDC without ops burden"],
    repo: repo("example/pg-feed", { language: "C", stars: 2100 }),
  },
  {
    // Edge case: trend article (no single repo)
    headline: "Agent Frameworks Are Quietly Converging on the Same Three Primitives",
    subheadline: "Planner, tool registry, memory store — five new projects this week ship the identical skeleton.",
    body:
      "Across this week's trending repos the architecture is now interchangeable: a planner loop, a typed tool registry, and a pluggable memory store. The differentiation has moved to guardrails and cost controls. **The catch:** convergence means most of these projects will be abandoned within a year.",
    useCases: ["Builders picking a framework that will survive"],
    repo: { url: "#", name: "trend", shortName: "agent-primitives", language: "", stars: 0 },
    _isTrend: true,
    _trendRepos: [
      { url: "https://github.com/a/one", name: "a/one" },
      { url: "https://github.com/b/two", name: "b/two" },
      { url: "https://github.com/c/three", name: "c/three" },
    ],
  },
];

const DEEP_CUTS = [
  {
    headline: "Forgotten Parser Library Quietly Powers Half the New Agents",
    subheadline: "A four-year-old grammar engine turns out to be the dependency everyone shares.",
    body:
      "Dig into the lockfiles of this month's agent frameworks and the same parser appears in most of them. Its author still maintains it solo. **The catch:** bus factor of one for half an ecosystem.",
    useCases: ["Anyone auditing their agent stack's dependencies"],
    repo: repo("example/grammarlib", { language: "TypeScript", stars: 900, createdAt: "2022-03-01T00:00:00Z" }),
  },
];

const QUICK_HITS = [
  { name: "example/tinygrad", shortName: "tinygrad", url: "https://github.com/example/tinygrad", stars: 29000, summary: "A minimalist autograd engine that now compiles to WebGPU." },
  { name: "example/sqlfluff", shortName: "sqlfluff", url: "https://github.com/example/sqlfluff", stars: 9000, summary: "SQL linter adds dialect-aware auto-fixes for dbt projects." },
  { name: "example/hotwire", shortName: "hotwire", url: "https://github.com/example/hotwire", stars: 4200, summary: "Live-reload proxy that diffs server HTML into the DOM." },
  { name: "example/quietlog", shortName: "quietlog", url: "https://github.com/example/quietlog", stars: 1100, summary: "Structured logger that samples noisy lines automatically." },
];

const SECTION = {
  lead: LEAD,
  secondary: SECONDARY,
  deepCuts: DEEP_CUTS,
  quickHits: QUICK_HITS,
  isEmpty: false,
};

const EMPTY = { isEmpty: true, secondary: [], quickHits: [] };

const CONTENT = {
  tagline: "All the code that's fit to ship. (MOCK EDITION — fixture data)",
  sections: {
    frontPage: SECTION,
    ai: SECTION,
    robotics: EMPTY,
    cyber: EMPTY,
    systems: EMPTY,
    diy: EMPTY,
    gamedev: EMPTY,
  },
  modelDrops: [
    { id: "1", author: "nvidia", name: "Nemotron-3-Embed", task: "sentence-similarity", likes: 72, downloads: 100, ageDays: 2, url: "https://huggingface.co/x" },
    { id: "2", author: "unsloth", name: "inkling-GGUF", task: "image-text-to-text", likes: 106, downloads: 100, ageDays: 1, url: "https://huggingface.co/y" },
    { id: "3", author: "internlm", name: "Intern-S2-Preview", task: "image-text-to-text", likes: 48, downloads: 100, ageDays: 3, url: "https://huggingface.co/z" },
  ],
  ghReleases: [
    { repo: "ggml-org/llama.cpp", owner: "ggml-org", name: "llama.cpp", tag: "b4600", title: "b4600", reactions: 82, ageDays: 1, url: "https://github.com/ggml-org/llama.cpp" },
  ],
};

// --- Build ----------------------------------------------------------------

async function build() {
  const html = await assembleHtml(CONTENT, { date: new Date() });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log(`[${new Date().toLocaleTimeString()}] wrote ${path.relative(process.cwd(), OUT)}`);
}

async function main() {
  await build();
  if (!process.argv.includes("--watch")) return;

  const watched = [
    path.join(__dirname, "..", "styles"),
    path.join(__dirname, "..", "templates"),
    path.join(__dirname, "..", "src", "render.js"),
  ];
  console.log("watching styles/, templates/, src/render.js — Ctrl-C to stop");
  let timer = null;
  for (const target of watched) {
    fs.watch(target, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // render.js is require-cached; clear so edits take effect on rebuild.
        delete require.cache[require.resolve("../src/render")];
        const { assembleHtml: fresh } = require("../src/render");
        fresh(CONTENT, { date: new Date() })
          .then((html) => {
            fs.writeFileSync(OUT, html);
            console.log(`[${new Date().toLocaleTimeString()}] rebuilt`);
          })
          .catch((err) => console.error("rebuild failed:", err.message));
      }, 150);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
