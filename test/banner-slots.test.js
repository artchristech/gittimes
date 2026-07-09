const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  resolveBannerSlots,
  applyBannerSlots,
  detectUntracked,
  buildBannerRoster,
} = require("../src/sync-models");

// All tests here are network-independent: resolveBannerSlots / applyBannerSlots
// are pure, taking a fixture catalog array + slot specs and computing from those.

describe("resolveBannerSlots — newest-wins + exclude guardrail", () => {
  it("AC3: picks newest-by-created within match, excluding dev stubs (grok 4.20/4.3/build -> 4.3)", () => {
    const catalog = [
      { id: "x-ai/grok-4.20", created: 100, name: "xAI: Grok 4.20", pricing: { prompt: "0", completion: "0.0000025" } },
      { id: "x-ai/grok-4.3", created: 200, name: "xAI: Grok 4.3", pricing: { prompt: "0", completion: "0.0000030" } },
      { id: "x-ai/grok-build-0.1", created: 300, name: "xAI: Grok Build 0.1", pricing: { prompt: "0", completion: "0.0000001" } },
    ];
    const out = resolveBannerSlots(catalog, [{ label: "Grok", match: "x-ai/grok-", exclude: ["-build"] }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].openrouterId, "x-ai/grok-4.3", "the excluded newer build stub must not win");
    assert.equal(out[0].output, 3, "0.0000030 * 1e6");
  });

  it("without an exclude, the dev stub (newest) WOULD win — proves exclude is load-bearing", () => {
    const catalog = [
      { id: "x-ai/grok-4.3", created: 200, name: "xAI: Grok 4.3", pricing: { prompt: "0", completion: "0.000003" } },
      { id: "x-ai/grok-build-0.1", created: 300, name: "xAI: Grok Build 0.1", pricing: { prompt: "0", completion: "0.0000001" } },
    ];
    const out = resolveBannerSlots(catalog, [{ label: "Grok", match: "x-ai/grok-" }]);
    assert.equal(out[0].openrouterId, "x-ai/grok-build-0.1");
  });
});

describe("resolveBannerSlots — pin override (AC4)", () => {
  it("pin forces an exact id despite a newer catalog sibling", () => {
    const catalog = [
      { id: "openai/gpt-5.5", created: 100, name: "OpenAI: GPT-5.5", pricing: { prompt: "0", completion: "0.00003" } },
      { id: "openai/gpt-6", created: 999, name: "OpenAI: GPT-6", pricing: { prompt: "0", completion: "0.00009" } },
    ];
    const out = resolveBannerSlots(catalog, [{ label: "GPT", match: "openai/gpt-", pin: "openai/gpt-5.5" }]);
    assert.equal(out[0].openrouterId, "openai/gpt-5.5", "pin wins over newer gpt-6");
    assert.equal(out[0].output, 30);
  });

  it("a pin that isn't in the catalog is skipped gracefully (no throw, slot omitted)", () => {
    const catalog = [{ id: "openai/gpt-5.5", created: 100, name: "OpenAI: GPT-5.5", pricing: { prompt: "0", completion: "0.00003" } }];
    const out = resolveBannerSlots(catalog, [{ label: "GPT", match: "openai/gpt-", pin: "openai/does-not-exist" }]);
    assert.deepEqual(out, []);
  });
});

describe("resolveBannerSlots — fresh label reflects resolved version (AC5)", () => {
  it("grok-4.3 fixture -> label contains 4.3, not 4.20", () => {
    const catalog = [
      { id: "x-ai/grok-4.20", created: 100, name: "xAI: Grok 4.20", pricing: { prompt: "0", completion: "0.0000025" } },
      { id: "x-ai/grok-4.3", created: 200, name: "xAI: Grok 4.3", pricing: { prompt: "0", completion: "0.000003" } },
    ];
    const out = resolveBannerSlots(catalog, [{ label: "Grok", match: "x-ai/grok-" }]);
    assert.match(out[0].label, /4\.3/);
    assert.doesNotMatch(out[0].label, /4\.20/);
  });

  it("grok-4.20 fixture (only 4.20 present) -> label contains 4.20", () => {
    const catalog = [
      { id: "x-ai/grok-4.20", created: 100, name: "xAI: Grok 4.20", pricing: { prompt: "0", completion: "0.0000025" } },
    ];
    const out = resolveBannerSlots(catalog, [{ label: "Grok", match: "x-ai/grok-" }]);
    assert.match(out[0].label, /4\.20/);
  });

  it("strips the leading 'Provider: ' from the name", () => {
    const catalog = [{ id: "anthropic/claude-sonnet-5", created: 1, name: "Anthropic: Claude Sonnet 5", pricing: { prompt: "0", completion: "0.00001" } }];
    const out = resolveBannerSlots(catalog, [{ label: "Claude", match: "anthropic/claude-" }]);
    assert.equal(out[0].label, "Claude Sonnet 5");
  });

  it("falls back to the id's last segment when name is missing", () => {
    const catalog = [{ id: "x-ai/grok-4.3", created: 1, pricing: { prompt: "0", completion: "0.000003" } }];
    const out = resolveBannerSlots(catalog, [{ label: "Grok", match: "x-ai/grok-" }]);
    assert.equal(out[0].label, "grok-4.3");
  });
});

describe("resolveBannerSlots — closes stale-roster gaps (AC6)", () => {
  // Representative fixture: each family carries an OLD (stale) member and a
  // NEWER member. The resolver must always pick the newer one.
  const catalog = [
    { id: "x-ai/grok-4.20", created: 100, name: "xAI: Grok 4.20", pricing: { prompt: "0", completion: "0.0000025" } },
    { id: "x-ai/grok-4.3", created: 200, name: "xAI: Grok 4.3", pricing: { prompt: "0", completion: "0.000003" } },
    { id: "x-ai/grok-build-0.1", created: 300, name: "xAI: Grok Build 0.1", pricing: { prompt: "0", completion: "0.0000001" } },
    { id: "deepseek/deepseek-v3.2", created: 100, name: "DeepSeek: DeepSeek V3.2", pricing: { prompt: "0", completion: "0.0000003" } },
    { id: "deepseek/deepseek-v4-pro", created: 200, name: "DeepSeek: DeepSeek V4 Pro", pricing: { prompt: "0", completion: "0.00000087" } },
    { id: "deepseek/deepseek-v4-flash", created: 150, name: "DeepSeek: DeepSeek V4 Flash", pricing: { prompt: "0", completion: "0.00000018" } },
    { id: "anthropic/claude-opus-4.8", created: 100, name: "Anthropic: Claude Opus 4.8", pricing: { prompt: "0", completion: "0.000025" } },
    { id: "anthropic/claude-fable-5", created: 200, name: "Anthropic: Claude Fable 5", pricing: { prompt: "0", completion: "0.00005" } },
  ];
  const slots = [
    { label: "Grok", match: "x-ai/grok-", exclude: ["-build"] },
    { label: "DeepSeek", match: "deepseek/deepseek-", exclude: ["-flash"] },
    { label: "Claude", match: "anthropic/claude-" },
  ];

  it("resolves the NEWER member of each pair, never the stale one", () => {
    const out = resolveBannerSlots(catalog, slots);
    const byLabel = Object.fromEntries(out.map((r) => [r.label, r.openrouterId]));
    assert.equal(byLabel["Grok 4.3"], "x-ai/grok-4.3");
    assert.equal(byLabel["DeepSeek V4 Pro"], "deepseek/deepseek-v4-pro");
    assert.equal(byLabel["Claude Fable 5"], "anthropic/claude-fable-5");

    const ids = out.map((r) => r.openrouterId);
    assert.ok(!ids.includes("x-ai/grok-4.20"), "stale grok-4.20 must never resolve");
    assert.ok(!ids.includes("deepseek/deepseek-v3.2"), "stale deepseek-v3.2 must never resolve");
  });

  it("preserves slot ORDER in the result", () => {
    const out = resolveBannerSlots(catalog, slots);
    assert.deepEqual(out.map((r) => r.openrouterId), [
      "x-ai/grok-4.3",
      "deepseek/deepseek-v4-pro",
      "anthropic/claude-fable-5",
    ]);
  });
});

describe("resolveBannerSlots — per-slot shape + key derivation (AC2)", () => {
  it("returns the documented per-slot fields", () => {
    const catalog = [{ id: "x-ai/grok-4.3", created: 1777591821, name: "xAI: Grok 4.3", context_length: 131072, pricing: { prompt: "0.000002", completion: "0.0000025" } }];
    const [r] = resolveBannerSlots(catalog, [{ label: "Grok", match: "x-ai/grok-" }]);
    assert.deepEqual(Object.keys(r).sort(), ["context_length", "created", "input", "key", "label", "openrouterId", "output", "provider", "source"].sort());
    assert.equal(r.openrouterId, "x-ai/grok-4.3");
    assert.equal(r.input, 2);
    assert.equal(r.output, 2.5);
    assert.equal(r.context_length, 131072);
    assert.equal(r.created, 1777591821);
    assert.equal(r.source, "banner-slot");
  });

  it("reuses an existing trackedModels key when the resolved id matches its openrouterId", () => {
    const catalog = [{ id: "openai/gpt-5.5", created: 1, name: "OpenAI: GPT-5.5", pricing: { prompt: "0", completion: "0.00003" } }];
    const tracked = [{ key: "gpt-5.5", openrouterId: "openai/gpt-5.5", label: "GPT-5.5", provider: "OpenAI" }];
    const [r] = resolveBannerSlots(catalog, [{ label: "GPT", match: "openai/gpt-" }], tracked);
    assert.equal(r.key, "gpt-5.5", "reuses the tracked key");
  });

  it("synthesizes a stable key from the id when no tracked entry matches", () => {
    const catalog = [{ id: "x-ai/grok-4.3", created: 1, name: "xAI: Grok 4.3", pricing: { prompt: "0", completion: "0.000003" } }];
    const [r] = resolveBannerSlots(catalog, [{ label: "Grok", match: "x-ai/grok-" }]);
    assert.equal(r.key, "x-ai-grok-4-3", "id.replace(/[/.:]+/g,'-')");
  });

  it("derives a provider display name from the id slug", () => {
    const catalog = [{ id: "moonshotai/kimi-k2.6", created: 1, name: "MoonshotAI: Kimi K2.6", pricing: { prompt: "0", completion: "0.0000034" } }];
    const [r] = resolveBannerSlots(catalog, [{ label: "Kimi", match: "moonshotai/kimi-" }]);
    assert.equal(r.provider, "Moonshot");
  });
});

describe("resolveBannerSlots — total / never throws (AC9)", () => {
  it("empty catalog returns [] (no throw)", () => {
    assert.deepEqual(resolveBannerSlots([], [{ label: "Grok", match: "x-ai/grok-" }]), []);
  });

  it("empty slots returns [] (no throw)", () => {
    assert.deepEqual(resolveBannerSlots([{ id: "x-ai/grok-4.3", created: 1, pricing: { prompt: "0", completion: "0.000003" } }], []), []);
  });

  it("no-match slot is omitted, not thrown", () => {
    const catalog = [{ id: "x-ai/grok-4.3", created: 1, name: "xAI: Grok 4.3", pricing: { prompt: "0", completion: "0.000003" } }];
    const out = resolveBannerSlots(catalog, [{ label: "Nope", match: "acme/nothing-" }]);
    assert.deepEqual(out, []);
  });

  it("missing created counts as 0; a model with created still beats one without", () => {
    const catalog = [
      { id: "x-ai/grok-a", name: "A", pricing: { prompt: "0", completion: "0.000001" } },
      { id: "x-ai/grok-b", created: 5, name: "B", pricing: { prompt: "0", completion: "0.000002" } },
    ];
    const out = resolveBannerSlots(catalog, [{ label: "Grok", match: "x-ai/grok-" }]);
    assert.equal(out[0].openrouterId, "x-ai/grok-b");
  });

  it("missing/NaN pricing yields null prices but still resolves the slot", () => {
    const catalog = [{ id: "x-ai/grok-4.3", created: 1, name: "xAI: Grok 4.3" }];
    const out = resolveBannerSlots(catalog, [{ label: "Grok", match: "x-ai/grok-" }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].input, null);
    assert.equal(out[0].output, null);
  });

  it("tolerates junk entries in the catalog (null / no id)", () => {
    const catalog = [null, {}, { id: 42 }, { id: "x-ai/grok-4.3", created: 1, name: "xAI: Grok 4.3", pricing: { prompt: "0", completion: "0.000003" } }];
    const out = resolveBannerSlots(catalog, [{ label: "Grok", match: "x-ai/grok-" }]);
    assert.equal(out[0].openrouterId, "x-ai/grok-4.3");
  });

  it("non-array inputs return [] (no throw)", () => {
    assert.deepEqual(resolveBannerSlots(null, null), []);
    assert.deepEqual(resolveBannerSlots(undefined, [{ label: "x", match: "y" }]), []);
  });
});

describe("applyBannerSlots — backward compatible + wiring (AC9 / AC7)", () => {
  const catalog = [
    { id: "x-ai/grok-4.3", created: 200, name: "xAI: Grok 4.3", pricing: { prompt: "0", completion: "0.000003" } },
    { id: "openai/gpt-5.5", created: 100, name: "OpenAI: GPT-5.5", pricing: { prompt: "0", completion: "0.00003" } },
  ];

  it("with NO bannerSlots, models are untouched and bannerKeys === curated.bannerKeys (today's behavior)", () => {
    const models = [{ key: "gpt-5.5", output: 30 }];
    const curated = { bannerKeys: ["gpt-5.5"], trackedModels: [{ key: "gpt-5.5", openrouterId: "openai/gpt-5.5" }] };
    const res = applyBannerSlots(models, catalog, curated);
    assert.strictEqual(res.bannerKeys, curated.bannerKeys, "returns the exact curated.bannerKeys reference");
    assert.equal(res.models.length, 1, "no models appended");
  });

  it("with an empty bannerSlots array, still falls back to curated.bannerKeys", () => {
    const curated = { bannerKeys: ["a"], bannerSlots: [], trackedModels: [] };
    const res = applyBannerSlots([{ key: "a" }], catalog, curated);
    assert.deepEqual(res.bannerKeys, ["a"]);
  });

  it("with bannerSlots, appends resolved models (dedup by key) and sets bannerKeys to resolved keys in slot order", () => {
    const models = [{ key: "gpt-5.5", label: "GPT-5.5", output: 30 }]; // gpt already tracked
    const curated = {
      bannerKeys: ["gpt-5.5"],
      trackedModels: [{ key: "gpt-5.5", openrouterId: "openai/gpt-5.5", label: "GPT-5.5", provider: "OpenAI" }],
      bannerSlots: [
        { label: "Grok", match: "x-ai/grok-" },
        { label: "GPT", match: "openai/gpt-" },
      ],
    };
    const res = applyBannerSlots(models, catalog, curated);
    // Grok (synthesized key) appended; GPT (reused key) NOT duplicated.
    assert.deepEqual(res.bannerKeys, ["x-ai-grok-4-3", "gpt-5.5"], "resolved keys in slot order");
    assert.equal(res.models.length, 2, "grok appended, gpt deduped");
    const grok = res.models.find((m) => m.key === "x-ai-grok-4-3");
    assert.ok(grok && grok.output === 3, "appended grok row carries its price");
    // The reused-key row keeps the original (richer) tracked entry, not a duplicate.
    assert.equal(res.models.filter((m) => m.key === "gpt-5.5").length, 1);
  });

  it("every resolved bannerKey is present in models[] (closes the render coupling)", () => {
    const curated = {
      bannerKeys: [],
      trackedModels: [],
      bannerSlots: [{ label: "Grok", match: "x-ai/grok-" }, { label: "GPT", match: "openai/gpt-" }],
    };
    const res = applyBannerSlots([], catalog, curated);
    for (const k of res.bannerKeys) {
      assert.ok(res.models.some((m) => m.key === k), `banner key ${k} must be in models[]`);
    }
  });
});

describe("sync-models offline safety (AC9)", () => {
  it("exits 0 and leaves data/ai-models.json unchanged when OpenRouter is unreachable", () => {
    const root = path.join(__dirname, "..");
    const outputPath = path.join(root, "data", "ai-models.json");
    // Precondition: an existing output file is what makes the offline path exit 0.
    assert.ok(fs.existsSync(outputPath), "expected an existing data/ai-models.json");
    const before = fs.readFileSync(outputPath);

    // Preload that forces the global fetch to reject — simulating "offline".
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-offline-"));
    const preload = path.join(tmp, "no-fetch.js");
    fs.writeFileSync(preload, 'global.fetch = () => Promise.reject(new Error("offline (test)"));');

    // execFileSync throws if the process exits non-zero. The offline branch does
    // process.exit(0) after logging "Keeping existing", so this must NOT throw.
    execFileSync("node", ["-r", preload, "src/sync-models.js"], { cwd: root, stdio: "pipe" });

    const after = fs.readFileSync(outputPath);
    assert.ok(before.equals(after), "output file must be byte-for-byte unchanged when offline");

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("detectUntracked — ranked by recency, not price (AC8)", () => {
  it("an old-but-expensive model ranks below a new-but-cheap one", () => {
    const catalog = [
      { id: "openai/o1-pro-legacy", name: "OpenAI: o1-pro", created: 100, pricing: { prompt: "0.00015", completion: "0.0006" } },   // $600/M, ancient
      { id: "openai/gpt-brandnew", name: "OpenAI: GPT Brand New", created: 200, pricing: { prompt: "0.000002", completion: "0.000005" } }, // $5/M, new
    ];
    const out = detectUntracked(catalog, []);
    assert.equal(out.length, 2);
    assert.equal(out[0].created, 200, "newest first, regardless of price");
    assert.equal(out[0].id, "openai/gpt-brandnew");
    assert.equal(out[1].id, "openai/o1-pro-legacy");
  });
});

describe("resolveBannerSlots — newest FLAGSHIP, not newest-anything (R6)", () => {
  // Anthropic ships a NEWER mid-tier (Sonnet 5) than its flagship (Fable 5).
  // "Newest and best" = newest within the FLAGSHIP tier, so the slot must exclude
  // the sub-flagship tiers and resolve claude-fable-5, NOT the newer claude-sonnet-5.
  const catalog = [
    { id: "anthropic/claude-sonnet-5", created: 300, name: "Anthropic: Claude Sonnet 5", pricing: { prompt: "0", completion: "0.00001" } },
    { id: "anthropic/claude-fable-5", created: 200, name: "Anthropic: Claude Fable 5", pricing: { prompt: "0", completion: "0.00005" } },
    { id: "anthropic/claude-opus-4.8", created: 100, name: "Anthropic: Claude Opus 4.8", pricing: { prompt: "0", completion: "0.000025" } },
  ];

  it("excluding sonnet/haiku resolves flagship claude-fable-5, not the newer mid-tier sonnet-5", () => {
    const out = resolveBannerSlots(catalog, [{ label: "Claude", match: "anthropic/claude-", exclude: ["sonnet", "haiku"] }]);
    assert.equal(out[0].openrouterId, "anthropic/claude-fable-5");
    assert.equal(out[0].output, 50, "0.00005 * 1e6 = the $50/M premium tier");
  });

  it("WITHOUT the tier excludes, the newer mid-tier WOULD win — proves the exclude is load-bearing", () => {
    const out = resolveBannerSlots(catalog, [{ label: "Claude", match: "anthropic/claude-" }]);
    assert.equal(out[0].openrouterId, "anthropic/claude-sonnet-5", "newest-anything picks the wrong (mid) tier");
  });

  it("the shipped curated Claude slot excludes sonnet + haiku (config carries the flagship fix)", () => {
    const curated = require("../data/ai-models-curated.json");
    const claude = (curated.bannerSlots || []).find((s) => s.label === "Claude");
    assert.ok(claude, "a Claude slot exists");
    assert.ok(claude.exclude.includes("sonnet"), "excludes sonnet (mid tier)");
    assert.ok(claude.exclude.includes("haiku"), "excludes haiku (small tier)");
  });
});

describe("renderTickerBanner — renders auto-latest bannerModels, isolated from models (R7)", () => {
  const { renderTickerBanner } = require("../src/ai-ticker");

  it("prefers bannerModels (banner-only roster) over the models/bannerKeys legacy path", () => {
    const data = {
      // `models` drives the markets table + index — it must NOT appear in the banner.
      models: [{ key: "curated-only", label: "Curated Only", output: 99, outputDelta: null }],
      bannerKeys: ["curated-only"],
      bannerModels: [
        { key: "x-ai-grok-4-5", label: "Grok 4.5", output: 6 },
        { key: "anthropic-claude-fable-5", label: "Claude Fable 5", output: 50 },
      ],
    };
    const html = renderTickerBanner(data, { basePath: "" });
    assert.ok(html.includes("Grok 4.5"), "renders a resolved banner slot");
    assert.ok(html.includes("Claude Fable 5"));
    assert.ok(!html.includes("Curated Only"), "the curated markets row must NOT leak into the banner");
    // banner-slot rows have no outputDelta → flat dash, and must not crash.
    assert.ok(html.includes("ticker-delta flat"));
  });

  it("falls back to the legacy bannerKeys filter over models when bannerModels is absent", () => {
    const data = {
      models: [
        { key: "a", label: "Alpha", output: 10, outputDelta: null },
        { key: "b", label: "Beta", output: 20, outputDelta: null },
      ],
      bannerKeys: ["b"],
      // no bannerModels
    };
    const html = renderTickerBanner(data, { basePath: "" });
    assert.ok(html.includes("Beta"));
    assert.ok(!html.includes("Alpha"), "only the bannerKeys subset renders in the fallback path");
  });
});

describe("buildBannerRoster — easy-check report + diffable records (R8)", () => {
  const catalog = [
    { id: "x-ai/grok-4.5", created: 1783523154, name: "xAI: Grok 4.5", pricing: { prompt: "0.000003", completion: "0.000006" } },
    { id: "x-ai/grok-4.3", created: 1777591821, name: "xAI: Grok 4.3", pricing: { prompt: "0", completion: "0.000003" } },
    { id: "anthropic/claude-fable-5", created: 1781007515, name: "Anthropic: Claude Fable 5", pricing: { prompt: "0", completion: "0.00005" } },
  ];

  it("emits one report line + one record per resolved slot, with id, YYYY-MM-DD date, and price", () => {
    const { lines, records, warnings } = buildBannerRoster([
      { label: "Grok", match: "x-ai/grok-" },
      { label: "Claude", match: "anthropic/claude-" },
    ], catalog);
    assert.equal(records.length, 2);
    assert.equal(warnings.length, 0);
    const grok = records.find((r) => r.slot === "Grok");
    assert.equal(grok.id, "x-ai/grok-4.5");
    assert.ok(grok.created, "record carries created");
    assert.equal(grok.price, 6, "record carries price ($/M)");
    const grokLine = lines.find((l) => l.includes("x-ai/grok-4.5"));
    assert.match(grokLine, /\d{4}-\d{2}-\d{2}/, "line contains a YYYY-MM-DD date");
    assert.match(grokLine, /beat: x-ai\/grok-4\.3/, "line names the runner-up it beat");
  });

  it("a no-match slot produces a warning string (and no record)", () => {
    const { records, warnings } = buildBannerRoster([{ label: "Nope", match: "acme/nothing-" }], catalog);
    assert.equal(records.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /no catalog match/);
    assert.match(warnings[0], /Nope/);
  });

  it("an `expect` substring the resolved id lacks produces an 'expected X, got Y' warning", () => {
    const { records, warnings } = buildBannerRoster([
      { label: "GPT", match: "x-ai/grok-", expect: "sol" }, // resolves grok-4.5, which lacks "sol"
    ], catalog);
    assert.equal(records.length, 1, "the slot still resolves (record present)");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /expected "sol", got x-ai\/grok-4\.5/);
  });

  it("a satisfied `expect` produces NO warning", () => {
    const { warnings } = buildBannerRoster([
      { label: "Claude", match: "anthropic/claude-", expect: "claude-fable" },
    ], catalog);
    assert.equal(warnings.length, 0);
  });

  it("pure + total: empty slots / null inputs / junk entries return empty, never throw", () => {
    assert.deepEqual(buildBannerRoster([], catalog), { lines: [], records: [], warnings: [] });
    assert.deepEqual(buildBannerRoster(null, null), { lines: [], records: [], warnings: [] });
    const { records } = buildBannerRoster([{ label: "Grok", match: "x-ai/grok-" }], [null, {}, { id: 42 }]);
    assert.deepEqual(records, [], "junk catalog entries are tolerated, no match");
  });
});
