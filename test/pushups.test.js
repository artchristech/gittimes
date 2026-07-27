const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { selectPushups, collectFeaturedRepos, formGrade, fetchPushups } = require("../src/pushups");
const { renderPushups } = require("../src/render");

describe("formGrade", () => {
  it("grades the buckets honestly", () => {
    assert.equal(formGrade(150), "beast mode");
    assert.equal(formGrade(60), "strict form");
    assert.equal(formGrade(25), "solid set");
    assert.equal(formGrade(7), "warming up");
    assert.equal(formGrade(2), "light stretch");
    assert.equal(formGrade(0), "rest day");
  });
});

describe("selectPushups", () => {
  it("ranks by reps, biggest set first, capped at limit", () => {
    const out = selectPushups(
      [
        { repo: "a/one", reps: 3 },
        { repo: "b/two", reps: 80 },
        { repo: "c/three", reps: 12 },
      ],
      { limit: 2 }
    );
    assert.deepEqual(out.map((p) => p.repo), ["b/two", "c/three"]);
    assert.equal(out[0].form, "strict form");
    assert.equal(out[0].owner, "b");
    assert.equal(out[0].name, "two");
  });

  it("drops rest days — zero reps never makes the board", () => {
    const out = selectPushups([{ repo: "a/lazy", reps: 0 }, { repo: "b/busy", reps: 1 }]);
    assert.deepEqual(out.map((p) => p.repo), ["b/busy"]);
  });

  it("labels a full page as 100+ reps", () => {
    const out = selectPushups([{ repo: "a/beast", reps: 100, capped: true }]);
    assert.equal(out[0].repsLabel, "100+");
    assert.equal(out[0].form, "beast mode");
  });

  it("tolerates garbage rows without throwing", () => {
    const out = selectPushups([null, {}, { repo: "noslash", reps: 5 }, { repo: "a/b", reps: "x" }]);
    assert.deepEqual(out, []);
    assert.deepEqual(selectPushups(null), []);
  });
});

describe("collectFeaturedRepos", () => {
  it("walks sections in order, dedupes, and fail-softs on missing shapes", () => {
    const content = {
      sections: {
        frontPage: {
          lead: { repo: { full_name: "acme/lead" } },
          secondary: [{ repo: { full_name: "acme/second" } }, { repo: { full_name: "acme/lead" } }],
          quickHits: [{ repo: { full_name: "acme/quick" } }, { notARepo: true }],
        },
        empty: { isEmpty: true, lead: { repo: { full_name: "never/shown" } } },
        ai: { lead: { repo: {} }, deepCuts: [{ repo: { full_name: "acme/deep" } }] },
      },
    };
    assert.deepEqual(collectFeaturedRepos(content), [
      "acme/lead",
      "acme/second",
      "acme/quick",
      "acme/deep",
    ]);
    assert.deepEqual(collectFeaturedRepos(null), []);
    assert.deepEqual(collectFeaturedRepos({}), []);
  });
});

describe("fetchPushups", () => {
  const NOW = Date.parse("2026-07-21T00:00:00Z");
  const okJson = (body) => ({ ok: true, json: async () => body });

  it("counts commits per repo and returns the ranked board", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes("acme/busy")) return okJson(new Array(42).fill({}));
      return okJson(new Array(3).fill({}));
    };
    const out = await fetchPushups({
      repos: ["acme/busy", "acme/slow"],
      fetchImpl,
      token: "t",
      nowMs: NOW,
    });
    assert.deepEqual(out.map((p) => [p.repo, p.reps]), [["acme/busy", 42], ["acme/slow", 3]]);
    assert.ok(calls[0].includes("since="));
  });

  it("returns [] when every fetch fails — never throws", async () => {
    const out = await fetchPushups({
      repos: ["a/b"],
      fetchImpl: async () => {
        throw new Error("boom");
      },
      nowMs: NOW,
    });
    assert.deepEqual(out, []);
  });

  it("returns [] with no repos and no fetch calls", async () => {
    let called = false;
    const out = await fetchPushups({ repos: [], fetchImpl: async () => (called = true) });
    assert.deepEqual(out, []);
    assert.equal(called, false);
  });
});

describe("renderPushups", () => {
  it("renders the band with ranks, reps and form; empty input renders nothing", () => {
    const html = renderPushups(
      selectPushups([{ repo: "acme/busy", reps: 42 }, { repo: "acme/slow", reps: 3 }])
    );
    assert.match(html, /The Pushup Report/);
    assert.match(html, /1\. busy/);
    assert.match(html, /42 reps/);
    assert.match(html, /solid set/);
    assert.match(html, /light stretch/);
    assert.equal(renderPushups([]), "");
    assert.equal(renderPushups(null), "");
  });

  it("escapes hostile repo names", () => {
    const html = renderPushups([
      { repo: "x/y", owner: "<img>", name: "<script>", reps: 5, repsLabel: "5", form: "warming up", url: "https://github.com/x/y/commits" },
    ]);
    assert.ok(!html.includes("<script>"));
  });
});
