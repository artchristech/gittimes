const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { parseQuickHits } = require("../src/xai");

const repo = (name, description = "fallback description") => ({
  name,
  description,
  language: "Rust",
  url: `https://github.com/${name}`,
  stars: 100,
});

const run = (lines, repos) => parseQuickHits(lines.join("\n"), repos);

describe("quick-hit repo-label echo", () => {
  it("strips an owner/repo prefix the model echoed from the prompt", () => {
    // Verbatim from the 2026-08-15 front page.
    const [hit] = run(
      ["1. elie222/rakazo: An open-source Grok Bot alternative that lets you plug in any LLM model and self-host it."],
      [repo("elie222/rakazo")]
    );
    assert.equal(hit.summary.startsWith("An open-source Grok Bot alternative"), true);
    assert.equal(hit.summary.includes("elie222/rakazo:"), false);
  });

  it("strips a bare project-name prefix", () => {
    const [hit] = run(
      ["1. Fyrox — A full-featured, Rust-powered 3D and 2D game engine with a scene editor."],
      [repo("FyroxEngine/Fyrox")]
    );
    assert.equal(hit.summary.startsWith("A full-featured"), true);
  });

  it("strips an owner-only prefix", () => {
    const [hit] = run(
      ["1. Ultralytics: Delivers a unified framework for real-time vision tasks from detection to tracking."],
      [repo("ultralytics/ultralytics")]
    );
    assert.equal(hit.summary.startsWith("Delivers a unified framework"), true);
  });

  it("tolerates the language parenthetical the prompt format carries", () => {
    const [hit] = run(
      ["1. SanderMertens/flecs (C): A blazing-fast entity-component-system for C and C++ with strong ergonomics."],
      [repo("SanderMertens/flecs")]
    );
    assert.equal(hit.summary.startsWith("A blazing-fast"), true);
  });

  it("leaves a summary that merely MENTIONS another project alone", () => {
    // The echo is a formatting artifact; a sentence that opens by naming a
    // different project is real copy and must survive untouched.
    const line = "1. Kubernetes: the orchestrator this tool replaces, rebuilt as a single Go binary.";
    const [hit] = run([line], [repo("acme/tinykube")]);
    assert.equal(hit.summary, "Kubernetes: the orchestrator this tool replaces, rebuilt as a single Go binary.");
  });

  it("never trades a real sentence for a fragment", () => {
    const [hit] = run(["1. acme/thing: too short"], [repo("acme/thing")]);
    assert.equal(hit.summary, "acme/thing: too short");
  });

  it("leaves a clean summary untouched", () => {
    const clean = "Turns scanned documents into searchable, indexed archives with OCR and tagging.";
    const [hit] = run([`1. ${clean}`], [repo("paperless-ngx/paperless-ngx")]);
    assert.equal(hit.summary, clean);
  });

  it("still falls back to the description when the model skips a line", () => {
    const hits = run(["1. only one line"], [repo("a/one"), repo("b/two", "second repo description")]);
    assert.equal(hits[0].summary, "only one line");
    assert.equal(hits[1].summary, "second repo description");
  });
});
