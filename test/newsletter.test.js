const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { sendNewsletter } = require("../src/newsletter");

describe("sendNewsletter", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls fetch with correct URL, headers, and body", async () => {
    let capturedUrl, capturedOpts;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return { json: async () => ({ ok: true, sent: 5 }) };
    };

    const edition = {
      headline: "Test Headline",
      subheadline: "Sub",
      tagline: "Tag",
      date: "2026-03-05",
      url: "https://gittimes.com/editions/2026-03-05/",
      repos: ["repo/one", "repo/two"],
    };

    await sendNewsletter({
      workerUrl: "https://worker.example.com",
      newsletterSecret: "secret123",
      edition,
    });

    assert.equal(capturedUrl, "https://worker.example.com/newsletter/send");
    assert.equal(capturedOpts.method, "POST");
    assert.equal(capturedOpts.headers.Authorization, "Bearer secret123");
    assert.equal(capturedOpts.headers["Content-Type"], "application/json");
    const body = JSON.parse(capturedOpts.body);
    assert.equal(body.headline, "Test Headline");
    assert.deepEqual(body.repos, ["repo/one", "repo/two"]);
  });

  it("returns the sent count on success", async () => {
    globalThis.fetch = async () => ({
      json: async () => ({ ok: true, sent: 42 }),
    });

    const sent = await sendNewsletter({
      workerUrl: "https://worker.example.com",
      newsletterSecret: "s",
      edition: { headline: "H" },
    });

    assert.equal(sent, 42);
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = async () => ({
      json: async () => ({ ok: false, error: "Unauthorized" }),
    });

    await assert.rejects(
      () =>
        sendNewsletter({
          workerUrl: "https://worker.example.com",
          newsletterSecret: "bad",
          edition: { headline: "H" },
        }),
      { message: "Unauthorized" },
    );
  });

  it("throws with default message when error field is missing", async () => {
    globalThis.fetch = async () => ({
      json: async () => ({ ok: false }),
    });

    await assert.rejects(
      () =>
        sendNewsletter({
          workerUrl: "https://worker.example.com",
          newsletterSecret: "bad",
          edition: { headline: "H" },
        }),
      { message: "Newsletter send failed" },
    );
  });
});
