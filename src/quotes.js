/**
 * Curated quotes from the pioneers of computer science and information theory.
 * One is chosen at random for each edition's masthead.
 */

const QUOTES = [
  // Alan Turing
  { text: "Those who can imagine anything, can create the impossible.", author: "Alan Turing" },
  { text: "We can only see a short distance ahead, but we can see plenty there that needs to be done.", author: "Alan Turing" },
  { text: "A computer would deserve to be called intelligent if it could deceive a human into believing that it was human.", author: "Alan Turing" },
  { text: "Sometimes it is the people no one imagines anything of who do the things that no one can imagine.", author: "Alan Turing" },

  // Claude Shannon
  { text: "Information is the resolution of uncertainty.", author: "Claude Shannon" },
  { text: "I just wondered how things were put together.", author: "Claude Shannon" },
  { text: "The fundamental problem of communication is reproducing at one point a message selected at another point.", author: "Claude Shannon" },

  // Charles Babbage
  { text: "The economy of human time is the next advantage of machinery in manufactures.", author: "Charles Babbage" },
  { text: "At each increase of knowledge, as well as on the contrivance of every new tool, human labour becomes abridged.", author: "Charles Babbage" },
  { text: "Errors using inadequate data are much less than those using no data at all.", author: "Charles Babbage" },

  // Arthur C. Clarke
  { text: "Any sufficiently advanced technology is indistinguishable from magic.", author: "Arthur C. Clarke" },
  { text: "The only way to discover the limits of the possible is to go beyond them into the impossible.", author: "Arthur C. Clarke" },
  { text: "Before you become too entranced with gorgeous gadgets, remember that the greatest invention of all was the book.", author: "Arthur C. Clarke" },

  // Edsger Dijkstra
  { text: "Simplicity is prerequisite for reliability.", author: "Edsger Dijkstra" },
  { text: "If debugging is the process of removing bugs, then programming must be the process of putting them in.", author: "Edsger Dijkstra" },
  { text: "The computing scientist's main challenge is not to get confused by the complexities of his own making.", author: "Edsger Dijkstra" },
  { text: "Program testing can be used to show the presence of bugs, but never to show their absence.", author: "Edsger Dijkstra" },

  // Donald Knuth
  { text: "Premature optimization is the root of all evil.", author: "Donald Knuth" },
  { text: "Programs are meant to be read by humans and only incidentally for computers to execute.", author: "Donald Knuth" },
  { text: "Science is what we understand well enough to explain to a computer; art is everything else.", author: "Donald Knuth" },
  { text: "The best programs are written so that computing machines can perform them quickly and so that human beings can understand them clearly.", author: "Donald Knuth" },

  // John von Neumann
  { text: "If people do not believe that mathematics is simple, it is only because they do not realize how complicated life is.", author: "John von Neumann" },
  { text: "There's no sense in being precise when you don't even know what you're talking about.", author: "John von Neumann" },
  { text: "In mathematics you don't understand things. You just get used to them.", author: "John von Neumann" },

  // Grace Hopper
  { text: "The most dangerous phrase in the language is: We've always done it this way.", author: "Grace Hopper" },
  { text: "A ship in port is safe, but that is not what ships are for.", author: "Grace Hopper" },
  { text: "One accurate measurement is worth a thousand expert opinions.", author: "Grace Hopper" },

  // Ada Lovelace
  { text: "The Analytical Engine weaves algebraic patterns just as the Jacquard loom weaves flowers and leaves.", author: "Ada Lovelace" },
  { text: "That brain of mine is something more than merely mortal, as time will show.", author: "Ada Lovelace" },

  // Dennis Ritchie
  { text: "UNIX is basically a simple operating system, but you have to be a genius to understand the simplicity.", author: "Dennis Ritchie" },

  // Ken Thompson
  { text: "When in doubt, use brute force.", author: "Ken Thompson" },

  // Linus Torvalds
  { text: "Talk is cheap. Show me the code.", author: "Linus Torvalds" },
  { text: "Most good programmers do programming not because they expect to get paid, but because it is fun to program.", author: "Linus Torvalds" },
];

/**
 * Pick a random quote, seeded by the current UTC date so each edition gets
 * a consistent quote for the day but a different one tomorrow.
 * @param {Date} [date] - Optional date override (defaults to now)
 * @returns {{ text: string, author: string }}
 */
function pickQuote(date) {
  const d = date || new Date();
  // Simple day-based seed: YYYYMMDD as an integer
  const seed = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const index = seed % QUOTES.length;
  return QUOTES[index];
}

/**
 * Format a quote for the masthead tagline.
 * @param {Date} [date] - Optional date override
 * @returns {string} Formatted quote string
 */
function mastheadQuote(date) {
  const { text, author } = pickQuote(date);
  return `\u201C${text}\u201D \u2014 ${author}`;
}

module.exports = { QUOTES, pickQuote, mastheadQuote };
