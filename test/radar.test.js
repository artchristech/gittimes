const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { detectUntracked, buildFirstSeen } = require("../src/sync-models");

// The Radar is the paper's only intake for a model that ships as an ENDPOINT —
// no weights, no repo, nothing for the GitHub or Hugging Face funnels to catch.
// These tests are written against the case that broke it: Ox Alpha, listed
// 2026-08-20 in an anonymous `stealth/` namespace at $0 with a 1M context, which
// the original provider-allowlist + $1/M price gate discarded twice over.
//
// Pure + network-free: detectUntracked takes a catalog array and a clock.

const DAY = 86400000;
const NOW = Date.parse("2026-08-24T12:00:00Z");
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

const OX_ALPHA = {
  id: "stealth/ox-alpha",
  name: "Ox Alpha",
  created: unix("2026-08-20T00:00:00Z"),
  context_length: 1048576,
  pricing: { prompt: "0", completion: "0" },
  architecture: { input_modalities: ["text", "image", "video"] },
  supported_parameters: ["tools", "tool_choice", "temperature"],
};

const TRACKED_FLAGSHIP = {
  id: "anthropic/claude-opus-5",
  name: "Anthropic: Claude Opus 5",
  created: unix("2026-05-01T00:00:00Z"),
  context_length: 500000,
  pricing: { prompt: "0.000015", completion: "0.000075" },
};

const COMMODITY = {
  id: "somelab/tiny-7b",
  name: "SomeLab: Tiny 7B",
  created: unix("2026-08-22T00:00:00Z"),
  context_length: 8192,
  pricing: { prompt: "0.00000005", completion: "0.0000002" }, // $0.05 / $0.20 per M
  architecture: { input_modalities: ["text"] },
  supported_parameters: ["temperature"],
};

// The standing lane reads percentiles off the live catalog, so its tests need a
// POPULATION, not a fixture of one. This is the shape of the real thing: mostly
// mid-market models, a long tail of cheap ones.
const FILLER = Array.from({ length: 60 }, (_, i) => ({
  id: `filler/model-${i}`,
  name: `Filler ${i}`,
  created: unix("2026-02-01T00:00:00Z"),
  context_length: 32000 + i * 1000,
  pricing: { prompt: "0.0000005", completion: "0.000002" }, // $2/M out
}));

const EXPENSIVE_LEGACY = {
  id: "openai/o1-pro",
  name: "OpenAI: o1-pro",
  created: unix("2025-03-01T00:00:00Z"),
  context_length: 128000,
  pricing: { prompt: "0.00015", completion: "0.0006" }, // $600/M out
};

describe("detectUntracked — the capability gate", () => {
  it("surfaces a free, anonymously-namespaced frontier listing (the Ox Alpha regression)", () => {
    const radar = detectUntracked([OX_ALPHA, COMMODITY], ["anthropic/claude-opus-5"], { nowMs: NOW });
    const ox = radar.find((m) => m.id === "stealth/ox-alpha");
    assert.ok(ox, "a 1M-context multimodal tool-calling model must reach the radar regardless of who ships it");
    assert.equal(ox.free, true, "$0 in and out is a free listing, not a missing price");
    assert.equal(ox.isNew, true, "listed 4 days before the clock — inside the new-listing window");
    assert.equal(ox.outputPrice, 0);
  });

  it("does NOT gate on the provider namespace", () => {
    // The whole point: `stealth` is on no allowlist and never will be.
    const radar = detectUntracked([OX_ALPHA], [], { nowMs: NOW });
    assert.equal(radar.length, 1);
    assert.equal(radar[0].id.split("/")[0], "stealth");
  });

  it("does NOT gate on price — $0 is a classification, never a rejection", () => {
    const freeButPlain = { ...OX_ALPHA, id: "stealth/ox-mini", context_length: 400000 };
    const radar = detectUntracked([freeButPlain], [], { nowMs: NOW });
    assert.equal(radar.length, 1, "a free model must not be filtered out for being free");
    assert.ok(radar[0].signals.includes("free"));
  });

  it("explains why each row qualified", () => {
    const radar = detectUntracked([OX_ALPHA], [], { nowMs: NOW });
    assert.deepEqual(radar[0].signals, ["free", "1M context", "multimodal + tool calling", "new listing"]);
  });

  it("rejects a cheap small-context text-only model even on the day it lists", () => {
    const radar = detectUntracked([COMMODITY, ...FILLER], [], { nowMs: NOW });
    assert.deepEqual(radar, [], "an arrival still has to clear the capability floor");
  });

  it("admits a modest multimodal tool-caller on the day it lists, not three weeks later", () => {
    const modest = {
      id: "somelab/omni-mini",
      name: "SomeLab: Omni Mini",
      created: unix("2026-08-22T00:00:00Z"),
      context_length: 32000,
      pricing: { prompt: "0.0000001", completion: "0.0000004" }, // $0.40/M out — no price signal
      architecture: { input_modalities: ["text", "image"] },
      supported_parameters: ["tools"],
    };
    const fresh = detectUntracked([modest, ...FILLER], [], { nowMs: NOW });
    assert.equal(fresh.length, 1, "the arrival is the news");
    assert.deepEqual(fresh[0].signals, ["multimodal + tool calling", "new listing"]);

    const stale = detectUntracked([modest, ...FILLER], [], { nowMs: NOW + 30 * DAY });
    assert.deepEqual(stale, [], "once the arrival is old news, an average model is inventory");
  });
});

describe("detectUntracked — the standing lane", () => {
  it("keeps the roster-gap case the original gate was built for", () => {
    const radar = detectUntracked([EXPENSIVE_LEGACY, ...FILLER], [], { nowMs: NOW });
    const legacy = radar.find((m) => m.id === "openai/o1-pro");
    assert.ok(legacy, "an untracked outlier is a gap in the roster with or without an event");
    assert.ok(legacy.signals.includes("premium priced"));
    assert.equal(legacy.isNew, false, "listed in 2025 — old, and honestly labelled so");
  });

  it("reads its bar off the live catalog instead of a hardcoded number", () => {
    // Same model, two markets. In a cheap market it is an outlier; in a market
    // where everything costs this much it is ordinary — which is precisely the
    // drift that made "$1/M = frontier" admit two thirds of the catalog.
    const candidate = {
      id: "somelab/pricey",
      name: "SomeLab: Pricey",
      created: unix("2026-01-01T00:00:00Z"),
      context_length: 32000,
      pricing: { prompt: "0.000002", completion: "0.00001" }, // $10/M out
    };
    const cheapMarket = detectUntracked([candidate, ...FILLER], [], { nowMs: NOW });
    assert.equal(cheapMarket.length, 1, "$10 stands out in a $2 market");

    const richMarket = detectUntracked(
      [candidate, ...FILLER.map((m) => ({ ...m, pricing: { prompt: "0.000004", completion: "0.00002" } }))],
      [],
      { nowMs: NOW }
    );
    assert.deepEqual(richMarket, [], "the same $10 is unremarkable in a $20 market");
  });

  it("never lets the relative bar fall below the absolute floor", () => {
    // A catalog of toys makes every toy a percentile leader. The floor is what
    // stops a 4k-context $0.02 model being crowned 'frontier' by arithmetic.
    const toys = Array.from({ length: 30 }, (_, i) => ({
      id: `toy/model-${i}`,
      name: `Toy ${i}`,
      created: unix("2026-01-01T00:00:00Z"),
      context_length: 4096,
      pricing: { prompt: "0.00000001", completion: "0.00000002" },
    }));
    assert.deepEqual(detectUntracked(toys, [], { nowMs: NOW }), []);
  });
});

describe("detectUntracked — arrivals the upstream date can't prove", () => {
  it("treats 'first appeared in our ledger today' as new, even with a stale created date", () => {
    // A backdated or missing `created` must not hide an arrival: the paper's own
    // ledger is the second, independent claim to newness.
    const backdated = { ...OX_ALPHA, id: "stealth/ox-beta", created: unix("2024-01-01T00:00:00Z") };
    const radar = detectUntracked([backdated], [], {
      nowMs: NOW,
      arrivals: ["stealth/ox-beta"],
      firstSeen: { "stealth/ox-beta": "2026-08-24" },
    });
    assert.equal(radar.length, 1);
    assert.equal(radar[0].isNew, true);
  });

  it("does not call a long-known listing new", () => {
    const radar = detectUntracked([{ ...OX_ALPHA, created: unix("2024-01-01T00:00:00Z") }], [], {
      nowMs: NOW,
      arrivals: [],
      firstSeen: { "stealth/ox-alpha": "2026-06-01" },
    });
    assert.equal(radar[0].isNew, false, "free still admits it — but not as an arrival");
    assert.equal(radar[0].free, true);
  });

  it("skips models already on the curated roster, including their variants", () => {
    const variant = { ...TRACKED_FLAGSHIP, id: "anthropic/claude-opus-5:thinking" };
    const radar = detectUntracked([TRACKED_FLAGSHIP, variant], ["anthropic/claude-opus-5"], { nowMs: NOW });
    assert.deepEqual(radar, [], "a tracked model and its variant are already on the board");
  });

  it("ranks a free new listing above an expensive standing one", () => {
    const radar = detectUntracked([EXPENSIVE_LEGACY, OX_ALPHA], [], { nowMs: NOW });
    assert.equal(radar[0].id, "stealth/ox-alpha", "newsworthiness, not price, orders the radar");
  });

  it("ages a listing out of NEW without dropping it", () => {
    const radar = detectUntracked([OX_ALPHA], [], { nowMs: NOW + 30 * DAY });
    assert.equal(radar.length, 1, "still frontier-class, still untracked");
    assert.equal(radar[0].isNew, false);
    assert.ok(!radar[0].signals.includes("new listing"));
  });

  it("survives malformed rows without throwing", () => {
    const radar = detectUntracked(
      [null, {}, { id: "x/y" }, { id: "a/b", pricing: {} }, OX_ALPHA],
      [],
      { nowMs: NOW }
    );
    assert.equal(radar.length, 1);
  });

  it("carries the first-seen date through when one is on file", () => {
    const radar = detectUntracked([OX_ALPHA], [], { nowMs: NOW, firstSeen: { "stealth/ox-alpha": "2026-08-21" } });
    assert.equal(radar[0].firstSeenOn, "2026-08-21");
  });
});

describe("buildFirstSeen — the arrival ledger", () => {
  const catalog = [{ id: "a/one" }, { id: "b/two" }];

  it("seeds wholesale on the first run and claims no arrivals", () => {
    const { firstSeen, bootstrapped, added } = buildFirstSeen(catalog, null, "2026-08-24");
    assert.equal(bootstrapped, true);
    assert.deepEqual(added, [], "a seeded ledger is not evidence that 395 models arrived at once");
    assert.deepEqual(firstSeen, { "a/one": "2026-08-24", "b/two": "2026-08-24" });
  });

  it("reports genuinely new ids once seeded", () => {
    const prior = { "a/one": "2026-08-01", "b/two": "2026-08-01" };
    const { firstSeen, bootstrapped, added } = buildFirstSeen(
      [...catalog, { id: "stealth/ox-alpha" }],
      prior,
      "2026-08-24"
    );
    assert.equal(bootstrapped, false);
    assert.deepEqual(added, ["stealth/ox-alpha"]);
    assert.equal(firstSeen["stealth/ox-alpha"], "2026-08-24");
    assert.equal(firstSeen["a/one"], "2026-08-01", "an existing date is never overwritten");
  });

  it("keeps a delisted id's date so a re-listing doesn't reset its history", () => {
    const prior = { "gone/model": "2026-01-01" };
    const { firstSeen } = buildFirstSeen(catalog, prior, "2026-08-24");
    assert.equal(firstSeen["gone/model"], "2026-01-01");
  });
});

describe("the bootstrap trap", () => {
  // The failure this guards against was caught in a dry run, not in review: the
  // first sync after the ledger shipped stamped all 395 catalogued ids with that
  // day's date, and a "first seen today?" test then read the whole catalog as
  // having arrived at once. The arrival SET is the honest input — buildFirstSeen
  // already knows the difference between seeding and an arrival, so the radar
  // asks it rather than re-deriving it from a date.
  it("does not report the whole catalog as new on the run that seeds the ledger", () => {
    const catalog = [
      OX_ALPHA,
      { ...OX_ALPHA, id: "old/one", created: unix("2025-01-01T00:00:00Z") },
      { ...OX_ALPHA, id: "old/two", created: unix("2025-02-01T00:00:00Z") },
    ];
    const { firstSeen, added } = buildFirstSeen(catalog, null, "2026-08-24");
    assert.deepEqual(added, [], "seeding claims no arrivals");

    const radar = detectUntracked(catalog, [], { nowMs: NOW, firstSeen, arrivals: added });
    const flaggedNew = radar.filter((m) => m.isNew).map((m) => m.id);
    assert.deepEqual(flaggedNew, ["stealth/ox-alpha"], "only the genuinely recent listing is NEW");
    assert.equal(radar.find((m) => m.id === "old/one").firstSeenOn, "2026-08-24", "the date is still on file");
  });
});
