const { escapeHtml } = require("./render");

/**
 * Escape text for use inside XML (same as HTML escaping).
 */
function escapeXml(str) {
  return escapeHtml(String(str || ""));
}

/**
 * Generate RSS 2.0 XML from manifest entries.
 * @param {Array} manifest - Array of { date, headline, subheadline, tagline, url }
 * @param {string} siteUrl - Base site URL (e.g. "https://gittimes.com")
 * @param {number} [limit=20] - Max items to include
 * @returns {string} RSS 2.0 XML string
 */
function generateRss(manifest, siteUrl, limit = 20) {
  const items = manifest.slice(0, limit);
  const buildDate = new Date().toUTCString();
  const lastPubDate = items.length > 0
    ? new Date(items[0].date + "T12:00:00Z").toUTCString()
    : buildDate;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The Git Times</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>AI-generated newspaper for builders — daily coverage of trending GitHub projects</description>
    <language>en-us</language>
    <lastBuildDate>${escapeXml(buildDate)}</lastBuildDate>
    <pubDate>${escapeXml(lastPubDate)}</pubDate>
    <atom:link href="${escapeXml(siteUrl)}/feed.xml" rel="self" type="application/rss+xml"/>
`;

  for (const entry of items) {
    const itemUrl = siteUrl + (entry.url || `/editions/${entry.date}/`);
    const pubDate = new Date(entry.date + "T12:00:00Z").toUTCString();
    const title = entry.headline
      ? (entry.subheadline ? `${entry.headline} — ${entry.subheadline}` : entry.headline)
      : "The Git Times Edition";
    const description = entry.subheadline || entry.tagline || "";

    xml += `    <item>
      <title><![CDATA[${title}]]></title>
      <link>${escapeXml(itemUrl)}</link>
      <guid isPermaLink="true">${escapeXml(itemUrl)}</guid>
      <pubDate>${escapeXml(pubDate)}</pubDate>
      <description><![CDATA[${description}]]></description>
    </item>
`;
  }

  xml += `  </channel>
</rss>
`;
  return xml;
}

/**
 * Generate Atom 1.0 XML from manifest entries.
 * @param {Array} manifest - Array of { date, headline, subheadline, tagline, url }
 * @param {string} siteUrl - Base site URL (e.g. "https://gittimes.com")
 * @param {number} [limit=20] - Max items to include
 * @returns {string} Atom 1.0 XML string
 */
function generateAtom(manifest, siteUrl, limit = 20) {
  const items = manifest.slice(0, limit);
  const updated = items.length > 0
    ? new Date(items[0].date + "T12:00:00Z").toISOString()
    : new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>The Git Times</title>
  <subtitle>AI-generated newspaper for builders — daily coverage of trending GitHub projects</subtitle>
  <link href="${escapeXml(siteUrl)}" rel="alternate"/>
  <link href="${escapeXml(siteUrl)}/feed.atom" rel="self" type="application/atom+xml"/>
  <id>${escapeXml(siteUrl)}/</id>
  <updated>${escapeXml(updated)}</updated>
  <author>
    <name>The Git Times</name>
  </author>
`;

  for (const entry of items) {
    const itemUrl = siteUrl + (entry.url || `/editions/${entry.date}/`);
    const entryUpdated = new Date(entry.date + "T12:00:00Z").toISOString();
    const title = entry.headline
      ? (entry.subheadline ? `${entry.headline} — ${entry.subheadline}` : entry.headline)
      : "The Git Times Edition";
    const summary = entry.subheadline || entry.tagline || "";

    xml += `  <entry>
    <title><![CDATA[${title}]]></title>
    <link href="${escapeXml(itemUrl)}" rel="alternate"/>
    <id>${escapeXml(itemUrl)}</id>
    <updated>${escapeXml(entryUpdated)}</updated>
    <summary><![CDATA[${summary}]]></summary>
  </entry>
`;
  }

  xml += `</feed>
`;
  return xml;
}

module.exports = { generateRss, generateAtom };
