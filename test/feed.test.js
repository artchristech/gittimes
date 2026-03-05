const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { generateRss, generateAtom } = require("../src/feed");

const mockManifest = [
  {
    date: "2026-03-04",
    headline: "AI Takes Over GitHub Trending",
    subheadline: "Neural networks dominate the charts",
    tagline: "The age of AI builders",
    url: "/editions/2026-03-04/",
  },
  {
    date: "2026-03-03",
    headline: "Rust Momentum Continues",
    subheadline: "Systems language gains ground",
    tagline: "Low-level renaissance",
    url: "/editions/2026-03-03/",
  },
  {
    date: "2026-03-02",
    headline: "Open Source Milestones",
    subheadline: "Several projects cross 100k stars",
    tagline: "",
    url: "/editions/2026-03-02/",
  },
];

// --------------- generateRss ---------------

describe("generateRss", () => {
  it("produces valid RSS 2.0 XML structure", () => {
    const xml = generateRss(mockManifest, "https://gittimes.com");
    assert.ok(xml.startsWith('<?xml version="1.0"'));
    assert.ok(xml.includes("<rss version=\"2.0\""));
    assert.ok(xml.includes("<channel>"));
    assert.ok(xml.includes("</channel>"));
    assert.ok(xml.includes("</rss>"));
  });

  it("includes channel metadata", () => {
    const xml = generateRss(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes("<title>The Git Times</title>"));
    assert.ok(xml.includes("<link>https://gittimes.com</link>"));
    assert.ok(xml.includes("<language>en-us</language>"));
  });

  it("includes self-referencing atom:link", () => {
    const xml = generateRss(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes('href="https://gittimes.com/feed.xml"'));
    assert.ok(xml.includes('rel="self"'));
  });

  it("renders items with CDATA titles", () => {
    const xml = generateRss(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes("<![CDATA[AI Takes Over GitHub Trending]]>"));
    assert.ok(xml.includes("<![CDATA[Rust Momentum Continues]]>"));
  });

  it("uses tagline as description, falls back to subheadline", () => {
    const xml = generateRss(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes("<![CDATA[The age of AI builders]]>"));
    // Third entry has empty tagline — falls back to subheadline
    assert.ok(xml.includes("<![CDATA[Several projects cross 100k stars]]>"));
  });

  it("builds correct item links from siteUrl + entry url", () => {
    const xml = generateRss(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes("<link>https://gittimes.com/editions/2026-03-04/</link>"));
    assert.ok(xml.includes("<link>https://gittimes.com/editions/2026-03-03/</link>"));
  });

  it("includes guid with isPermaLink", () => {
    const xml = generateRss(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes('<guid isPermaLink="true">https://gittimes.com/editions/2026-03-04/</guid>'));
  });

  it("respects limit parameter", () => {
    const xml = generateRss(mockManifest, "https://gittimes.com", 1);
    const itemCount = (xml.match(/<item>/g) || []).length;
    assert.equal(itemCount, 1);
  });

  it("handles empty manifest", () => {
    const xml = generateRss([], "https://gittimes.com");
    assert.ok(xml.includes("<channel>"));
    assert.ok(!xml.includes("<item>"));
  });

  it("falls back to constructed URL when entry.url is missing", () => {
    const manifest = [{ date: "2026-01-01", headline: "Test" }];
    const xml = generateRss(manifest, "https://gittimes.com");
    assert.ok(xml.includes("https://gittimes.com/editions/2026-01-01/"));
  });
});

// --------------- generateAtom ---------------

describe("generateAtom", () => {
  it("produces valid Atom 1.0 XML structure", () => {
    const xml = generateAtom(mockManifest, "https://gittimes.com");
    assert.ok(xml.startsWith('<?xml version="1.0"'));
    assert.ok(xml.includes('xmlns="http://www.w3.org/2005/Atom"'));
    assert.ok(xml.includes("</feed>"));
  });

  it("includes feed metadata", () => {
    const xml = generateAtom(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes("<title>The Git Times</title>"));
    assert.ok(xml.includes("<subtitle>"));
    assert.ok(xml.includes("<author>"));
  });

  it("includes self and alternate links", () => {
    const xml = generateAtom(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes('href="https://gittimes.com" rel="alternate"'));
    assert.ok(xml.includes('href="https://gittimes.com/feed.atom" rel="self"'));
  });

  it("renders entries with CDATA titles", () => {
    const xml = generateAtom(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes("<![CDATA[AI Takes Over GitHub Trending]]>"));
  });

  it("includes entry links and ids", () => {
    const xml = generateAtom(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes('href="https://gittimes.com/editions/2026-03-04/"'));
    assert.ok(xml.includes("<id>https://gittimes.com/editions/2026-03-04/</id>"));
  });

  it("includes updated timestamps in ISO format", () => {
    const xml = generateAtom(mockManifest, "https://gittimes.com");
    assert.ok(xml.includes("<updated>2026-03-04T12:00:00.000Z</updated>"));
  });

  it("respects limit parameter", () => {
    const xml = generateAtom(mockManifest, "https://gittimes.com", 2);
    const entryCount = (xml.match(/<entry>/g) || []).length;
    assert.equal(entryCount, 2);
  });

  it("handles empty manifest", () => {
    const xml = generateAtom([], "https://gittimes.com");
    assert.ok(xml.includes("<feed"));
    assert.ok(!xml.includes("<entry>"));
  });
});
