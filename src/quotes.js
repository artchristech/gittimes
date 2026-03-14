/**
 * Curated quotes on technology, information, and humanity's relationship with tools.
 * Drawn from philosophers, futurists, media theorists, and systems thinkers.
 * One is chosen at random for each edition's masthead.
 */

const QUOTES = [
  // Media & technology theory
  { text: "We shape our tools, and thereafter our tools shape us.", author: "Marshall McLuhan" },
  { text: "The medium is the message.", author: "Marshall McLuhan" },
  { text: "We drive into the future using only our rearview mirror.", author: "Marshall McLuhan" },
  { text: "We are what we behold. We shape our tools and then our tools shape us.", author: "John Culkin" },
  { text: "Technology is the knack of so arranging the world that we don't have to experience it.", author: "Max Frisch" },
  { text: "The information you have is not the information you want. The information you want is not the information you need.", author: "Neil Postman" },
  { text: "New technology is not additive; it is ecological. A new medium does not add something; it changes everything.", author: "Neil Postman" },
  { text: "Consider what the world would lose if each mind were to do its own indexing.", author: "Vannevar Bush" },

  // Philosophy of technology
  { text: "The question concerning technology is never merely technical.", author: "Martin Heidegger" },
  { text: "Everywhere we remain unfree and chained to technology, whether we passionately affirm or deny it.", author: "Martin Heidegger" },
  { text: "Tools for conviviality are those which give each person who uses them the greatest opportunity to enrich the environment with the fruits of their vision.", author: "Ivan Illich" },
  { text: "Technology is not a neutral tool. It is a system that carries its own values.", author: "Ursula Franklin" },
  { text: "Whether a technology is liberating or enslaving depends on who controls it.", author: "Ursula Franklin" },

  // Systems & cybernetics
  { text: "The purpose of a system is what it does.", author: "Stafford Beer" },
  { text: "The major problems of the world are the result of the difference between how nature works and the way people think.", author: "Gregory Bateson" },
  { text: "The best material model of a cat is another, or preferably the same, cat.", author: "Norbert Wiener" },
  { text: "Progress imposes not only new possibilities for the future but new restrictions.", author: "Norbert Wiener" },

  // Futurism & design
  { text: "You never change things by fighting the existing reality. To change something, build a new model that makes the existing model obsolete.", author: "Buckminster Fuller" },
  { text: "We are called to be architects of the future, not its victims.", author: "Buckminster Fuller" },
  { text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
  { text: "Technology is anything that wasn't around when you were born.", author: "Alan Kay" },
  { text: "Civilization advances by extending the number of important operations which we can perform without thinking about them.", author: "Alfred North Whitehead" },
  { text: "We are as gods and might as well get good at it.", author: "Stewart Brand" },

  // Science & complexity
  { text: "We live in a society exquisitely dependent on science and technology, in which hardly anyone knows anything about science and technology.", author: "Carl Sagan" },
  { text: "For a successful technology, reality must take precedence over public relations, for nature cannot be fooled.", author: "Richard Feynman" },
  { text: "Technology is a gift of God. After the gift of life it is perhaps the greatest of God's gifts.", author: "Freeman Dyson" },

  // Technology & humanity
  { text: "It has become appallingly obvious that our technology has exceeded our humanity.", author: "Albert Einstein" },
  { text: "The real problem is not whether machines think but whether men do.", author: "B.F. Skinner" },
  { text: "The factory of the future will have only two employees, a man and a dog. The man will be there to feed the dog. The dog will be there to keep the man from touching the equipment.", author: "Warren Bennis" },
  { text: "The art challenges the technology, and the technology inspires the art.", author: "John Lasseter" },
];

/**
 * Load recently used taglines from the database and/or manifest JSON.
 * Checks both sources to handle pre-migration and post-migration states.
 * @param {string} [outDir] - Output directory (defaults to ./site)
 * @returns {Set<string>} Set of recently used quote texts
 */
function _recentTaglines(outDir) {
  const used = new Set();

  // Try database
  try {
    const db = require("./db");
    for (const t of db.getUsedTaglines(db.resolveDataDir(outDir || "./site"))) {
      used.add(t);
    }
  } catch {
    // Non-fatal
  }

  // Also check JSON (covers pre-migration taglines not yet in DB)
  try {
    const fs = require("fs");
    const path = require("path");
    const dir = outDir || "./site";
    const manifestPath = path.join(dir, "editions", "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      for (const entry of manifest) {
        if (entry.tagline) used.add(entry.tagline);
      }
    }
  } catch {
    // Non-fatal
  }

  return used;
}

/**
 * Pick a quote that hasn't been used in recent editions.
 * Falls back to date-seeded selection if all quotes have been used.
 * @param {Date} [date] - Optional date override (defaults to now)
 * @param {string} [outDir] - Output directory for manifest lookup
 * @returns {{ text: string, author: string }}
 */
function pickQuote(date, outDir) {
  const d = date || new Date();
  const seed = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

  const recentTaglines = _recentTaglines(outDir);

  // Filter to quotes not recently used
  const available = QUOTES.filter(
    (q) => !recentTaglines.has(`\u201C${q.text}\u201D \u2014 ${q.author}`)
  );

  // If all quotes have been used, allow any (full cycle reset)
  const pool = available.length > 0 ? available : QUOTES;

  const index = seed % pool.length;
  return pool[index];
}

/**
 * Format a quote for the masthead tagline.
 * @param {Date} [date] - Optional date override
 * @param {string} [outDir] - Output directory for manifest lookup
 * @returns {string} Formatted quote string
 */
function mastheadQuote(date, outDir) {
  const { text, author } = pickQuote(date, outDir);
  return `\u201C${text}\u201D \u2014 ${author}`;
}

module.exports = { QUOTES, pickQuote, mastheadQuote };
