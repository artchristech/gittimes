const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  fetchGitHubReleases,
  selectReleases,
  isPatchNoise,
  WATCHED_REPOS,
} = require("../src/github-releases");
const { renderGitHubReleases } = require("../src/render");

const NOW = Date.parse("2026-07-01T00:00:00Z");
const iso = (d) => new Date(NOW - d * 86400000).toISOString();
const R = (repo, tag, ageDays, extra = {}) => ({
  repo,
  tag_name: tag,
  name: extra.title ?? tag,
  published_at: iso(ageDays),
  draft: extra.draft ?? false,
  prerelease: extra.prerelease ?? false,
  html_url: "url" in extra ? extra.url : `https://github.com/${repo}/releases/tag/${tag}`,
  reactions: { total_count: extra.reactions ?? 0 },
});

describe("isPatchNoise", () => {
  it("treats minor/major releases as news and patch bumps as noise", () => {
    assert.equal(isPatchNoise("v1.2.0"), false);
    assert.equal(isPatchNoise("v2.0"), false);
    assert.equal(isPatchNoise("release-3.1"), false);
    assert.equal(isPatchNoise("v1.2.3"), true);
    assert.equal(isPatchNoise("v0.10.1.post1"), true);
  });

  it("treats non-semver build tags as noise (the llama.cpp firehose)", () => {
    assert.equal(isPatchNoise("b6432"), true);
    assert.equal(isPatchNoise("nightly-20260630"), true);
  });
});

describe("selectReleases", () => {
  it("keeps a recent stable release and drops one outside the window", () => {
    const out = selectReleases(
      [R("vllm-project/vllm", "v0.11.0", 3), R("pytorch/pytorch", "v2.9.0", 20)],
      { nowMs: NOW }
    );
    assert.deepEqual(out.map((r) => r.repo), ["vllm-project/vllm"]);
  });

  it("excludes drafts and prereleases", () => {
    const out = selectReleases(
      [
        R("ollama/ollama", "v0.8.0", 1, { draft: true }),
        R("qdrant/qdrant", "v1.13.0", 1, { prerelease: true }),
      ],
      { nowMs: NOW }
    );
    assert.equal(out.length, 0);
  });

  it("excludes an rc-tagged release even when the prerelease flag is unset", () => {
    const out = selectReleases([R("denoland/deno", "v3.0.0-rc.1", 1)], { nowMs: NOW });
    assert.equal(out.length, 0);
  });

  it("gates patch-bump spam unless it earned real reactions", () => {
    const out = selectReleases(
      [
        R("astral-sh/uv", "0.7.14", 1, { reactions: 3 }),
        R("ggml-org/llama.cpp", "b6432", 0, { reactions: 2 }),
        R("vllm-project/vllm", "v0.9.2", 2, { reactions: 60 }),
      ],
      { nowMs: NOW, minPatchReactions: 25 }
    );
    // Only the patch release with real pickup survives.
    assert.deepEqual(out.map((r) => r.repo), ["vllm-project/vllm"]);
  });

  it("raises the patch bar to the repo's own baseline — routine mega-repo patches lose", () => {
    // claude-code-shaped: every patch clears the absolute 25-reaction bar just
    // from audience size. The repo's own median (~35) sets the real bar (3x),
    // so a routine 37-reaction patch is noise while a 120-reaction outlier
    // patch from the same repo is news.
    const routine = [
      R("anthropics/claude-code", "v2.1.215", 1, { reactions: 37 }),
      R("anthropics/claude-code", "v2.1.214", 2, { reactions: 35 }),
      R("anthropics/claude-code", "v2.1.213", 3, { reactions: 33 }),
    ];
    assert.equal(selectReleases(routine, { nowMs: NOW }).length, 0);

    const outlier = [
      R("anthropics/claude-code", "v2.1.215", 1, { reactions: 120 }),
      R("anthropics/claude-code", "v2.1.214", 2, { reactions: 35 }),
      R("anthropics/claude-code", "v2.1.213", 3, { reactions: 33 }),
    ];
    assert.deepEqual(selectReleases(outlier, { nowMs: NOW }).map((r) => r.tag), ["v2.1.215"]);
  });

  it("falls back to the absolute patch bar when a repo has no baseline", () => {
    // Single fetched release → no sibling baseline → old behavior.
    const out = selectReleases([R("pgvector/pgvector", "v0.8.1", 1, { reactions: 30 })], {
      nowMs: NOW,
      minPatchReactions: 25,
    });
    assert.deepEqual(out.map((r) => r.tag), ["v0.8.1"]);
  });

  it("never applies the repo-relative bar to minor/major releases", () => {
    // A vX.Y.0 with modest reactions from a high-baseline repo is still news.
    const out = selectReleases(
      [
        R("astral-sh/uv", "0.12.0", 1, { reactions: 5 }),
        R("astral-sh/uv", "0.11.29", 2, { reactions: 52 }),
        R("astral-sh/uv", "0.11.28", 4, { reactions: 50 }),
      ],
      { nowMs: NOW }
    );
    assert.deepEqual(out.map((r) => r.tag), ["0.12.0"]);
  });

  it("suppresses repos on cooldown so the band rotates", () => {
    const out = selectReleases(
      [
        R("ollama/ollama", "v0.32.0", 1, { reactions: 80 }),
        R("qdrant/qdrant", "v1.15.0", 2, { reactions: 10 }),
      ],
      { nowMs: NOW, suppressRepos: new Set(["ollama/ollama"]) }
    );
    assert.deepEqual(out.map((r) => r.repo), ["qdrant/qdrant"]);
  });

  it("ranks a fresh modest release above a stale hot one (velocity, not stock)", () => {
    // The level-thinking trap: a 12d-old release with 100 reactions from a huge
    // repo must NOT outrank a 1d-old release with 30 from a smaller one.
    const out = selectReleases(
      [
        R("pytorch/pytorch", "v2.9.0", 12, { reactions: 100 }),
        R("sgl-project/sglang", "v0.5.0", 1, { reactions: 30 }),
      ],
      { nowMs: NOW }
    );
    assert.deepEqual(out.map((r) => r.repo), ["sgl-project/sglang", "pytorch/pytorch"]);
  });

  it("keeps one release per repo — the best-ranked, not the first seen", () => {
    const out = selectReleases(
      [
        R("ollama/ollama", "v0.9.0", 10, { reactions: 5 }),
        R("ollama/ollama", "v0.10.0", 1, { reactions: 5 }),
      ],
      { nowMs: NOW }
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].tag, "v0.10.0");
  });

  it("respects limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => R(`org/repo${i}`, `v${i}.1.0`, 1));
    assert.equal(selectReleases(many, { nowMs: NOW }).length, 5);
    assert.equal(selectReleases(many, { nowMs: NOW, limit: 3 }).length, 3);
  });

  it("normalizes fields and falls back to a constructed release url", () => {
    const out = selectReleases(
      [R("comfyanonymous/ComfyUI", "v1.4.0", 2, { title: "ComfyUI 1.4", reactions: 12, url: null })],
      { nowMs: NOW }
    );
    const r = out[0];
    assert.equal(r.repo, "comfyanonymous/ComfyUI");
    assert.equal(r.owner, "comfyanonymous");
    assert.equal(r.name, "ComfyUI");
    assert.equal(r.tag, "v1.4.0");
    assert.equal(r.title, "ComfyUI 1.4");
    assert.equal(r.reactions, 12);
    assert.equal(r.ageDays, 2);
    assert.equal(r.publishedAt, iso(2));
    assert.equal(r.url, "https://github.com/comfyanonymous/ComfyUI/releases/tag/v1.4.0");
  });

  it("is deterministic: same input + fixed nowMs → same output", () => {
    const input = () => [
      R("vllm-project/vllm", "v0.11.0", 3, { reactions: 40 }),
      R("astral-sh/ruff", "v0.13.0", 1, { reactions: 8 }),
      R("qdrant/qdrant", "v1.15.0", 6, { reactions: 8 }),
    ];
    assert.deepEqual(selectReleases(input(), { nowMs: NOW }), selectReleases(input(), { nowMs: NOW }));
  });

  it("returns [] for junk input", () => {
    assert.deepEqual(selectReleases(null), []);
    assert.deepEqual(
      selectReleases([{}, { repo: "no-slash", tag_name: "v1.0" }, { repo: "a/b" }], { nowMs: NOW }),
      []
    );
  });
});

describe("WATCHED_REPOS", () => {
  it("is a curated owner/name list inside the API-call budget, no dupes", () => {
    assert.ok(WATCHED_REPOS.length >= 30 && WATCHED_REPOS.length <= 60);
    assert.equal(new Set(WATCHED_REPOS).size, WATCHED_REPOS.length);
    for (const repo of WATCHED_REPOS) {
      assert.match(repo, /^[\w.-]+\/[\w.-]+$/);
    }
  });
});

describe("fetchGitHubReleases", () => {
  // Stub fetch keyed by repo — records every call, never touches the network.
  const fakeFetch = (payloadByRepo) => {
    const calls = [];
    const fn = async (url) => {
      calls.push(url);
      const m = /repos\/([^/]+\/[^/]+)\/releases/.exec(url);
      const repo = m && m[1];
      if (!payloadByRepo[repo]) return { ok: false, status: 404 };
      return { ok: true, json: async () => payloadByRepo[repo] };
    };
    fn.calls = calls;
    return fn;
  };
  // Raw API records carry no repo field — the fetcher must annotate them.
  const raw = (tag, ageDays, extra = {}) => {
    const rest = { ...R("x/x", tag, ageDays, extra) };
    delete rest.repo;
    return rest;
  };

  it("makes one bounded call per watched repo and annotates records", async () => {
    const fetchImpl = fakeFetch({
      "vllm-project/vllm": [raw("v0.11.0", 2, { reactions: 15 })],
      "astral-sh/uv": [raw("0.8.0", 1)],
    });
    const out = await fetchGitHubReleases({
      repos: ["vllm-project/vllm", "astral-sh/uv"],
      fetchImpl,
      nowMs: NOW,
      token: null,
    });
    assert.equal(fetchImpl.calls.length, 2);
    assert.ok(fetchImpl.calls[0].includes("/repos/vllm-project/vllm/releases?per_page=5"));
    assert.deepEqual(out.map((r) => r.repo).sort(), ["astral-sh/uv", "vllm-project/vllm"]);
  });

  it("degrades gracefully: failed repos are skipped, the rest still publish", async () => {
    const fetchImpl = fakeFetch({ "astral-sh/uv": [raw("0.8.0", 1)] });
    const out = await fetchGitHubReleases({
      repos: ["ggml-org/llama.cpp", "astral-sh/uv"],
      fetchImpl,
      nowMs: NOW,
      token: null,
    });
    assert.deepEqual(out.map((r) => r.repo), ["astral-sh/uv"]);
  });

  it("returns [] when no fetch implementation is available", async () => {
    assert.deepEqual(await fetchGitHubReleases({ fetchImpl: null }), []);
  });
});

describe("renderGitHubReleases", () => {
  it("renders zero markup for an empty or missing list", () => {
    assert.equal(renderGitHubReleases([]), "");
    assert.equal(renderGitHubReleases(null), "");
  });

  it("renders a linked item per release", () => {
    const html = renderGitHubReleases(
      selectReleases([R("vllm-project/vllm", "v0.11.0", 2, { reactions: 40 })], { nowMs: NOW })
    );
    assert.ok(html.includes("Just Shipped"));
    assert.ok(html.includes("https://github.com/vllm-project/vllm/releases/tag/v0.11.0"));
    assert.ok(html.includes("vllm-project"));
    assert.ok(html.includes("v0.11.0"));
  });
});
