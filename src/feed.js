const { Feed } = require("feed");

/**
 * Generate RSS 2.0 and Atom 1.0 feed strings from an editions manifest.
 * @param {Array} manifest - Array of { date, headline, subheadline, tagline, url }
 * @param {string} siteUrl - Base URL of the site (e.g. "https://user.github.io/dagitnews")
 * @param {object} [options] - { limit?: number }
 * @returns {{ rss: string, atom: string }}
 */
function generateFeed(manifest, siteUrl, options = {}) {
  const limit = options.limit || 30;
  const entries = manifest.slice(0, limit);

  const feed = new Feed({
    title: "DAGitNews",
    description: "AI-generated newspaper for builders — trending GitHub projects as rich, readable stories",
    id: siteUrl + "/",
    link: siteUrl + "/",
    language: "en",
    feedLinks: {
      rss: siteUrl + "/feed.xml",
      atom: siteUrl + "/feed.atom",
    },
    updated: entries.length > 0 ? new Date(entries[0].date + "T12:00:00Z") : new Date(),
  });

  for (const entry of entries) {
    feed.addItem({
      title: entry.headline || `DAGitNews — ${entry.date}`,
      id: entry.url || `${siteUrl}/editions/${entry.date}/`,
      link: entry.url || `${siteUrl}/editions/${entry.date}/`,
      description: entry.subheadline || entry.tagline || "",
      date: new Date(entry.date + "T12:00:00Z"),
    });
  }

  return {
    rss: feed.rss2(),
    atom: feed.atom1(),
  };
}

module.exports = { generateFeed };
