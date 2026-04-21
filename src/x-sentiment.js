const { lastMatch, chat, MODEL } = require("./xai");

const VALID_SENTIMENTS = ["buzzing", "positive", "neutral", "mixed", "quiet", "unknown"];

const X_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "x_search",
    description: "Search X.com (Twitter) for posts about a topic",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
};

/**
 * Parse X.com sentiment from structured LLM output.
 * @param {string} text - Raw LLM response
 * @param {object} repo - Repo object for context
 * @returns {object} { sentiment, blurb, postCount, topPost, _failed }
 */
function parseXSentiment(text, _repo) {
  if (!text || !text.trim()) {
    return { sentiment: "unknown", blurb: "", postCount: 0, topPost: null, _failed: true };
  }

  const sentimentMatch = lastMatch(text, /SENTIMENT:\s*(.+)/);
  const postCountMatch = lastMatch(text, /POST_COUNT:\s*(.+)/);
  const blurbMatch = lastMatch(text, /BLURB:\s*(.+)/);
  const topPostMatch = lastMatch(text, /TOP_POST:\s*(.+)/);

  let sentiment = sentimentMatch?.[1]?.trim().toLowerCase() || "unknown";
  if (!VALID_SENTIMENTS.includes(sentiment)) {
    sentiment = "unknown";
  }

  const postCount = parseInt(postCountMatch?.[1]?.trim(), 10) || 0;
  const blurb = blurbMatch?.[1]?.trim() || "";
  const topPostRaw = topPostMatch?.[1]?.trim() || null;
  const topPost = topPostRaw === "none" ? null : topPostRaw;

  return { sentiment, blurb, postCount, topPost, _failed: false };
}

/**
 * Fetch X.com sentiment for a specific repo via Grok's x_search tool.
 * @param {object} client - OpenAI client
 * @param {function} llmLimit - p-limit limiter
 * @param {object} repo - Repo object with name, shortName, etc.
 * @returns {Promise<object>} Sentiment data
 */
async function fetchXSentimentForRepo(client, llmLimit, repo) {
  try {
    const prompt = `Search X.com for recent posts discussing the GitHub repository "${repo.name}". Summarize the sentiment and discussion around it.

Respond with EXACTLY this format:
SENTIMENT: <one of: buzzing, positive, neutral, mixed, quiet>
POST_COUNT: <approximate number of recent posts found>
BLURB: <one sentence summary of what people are saying>
TOP_POST: <the most notable post text, or "none" if nothing found>`;

    const raw = await llmLimit(() =>
      chat(client, MODEL, prompt, 300, { tools: [X_SEARCH_TOOL] })
    );
    return parseXSentiment(raw, repo);
  } catch (err) {
    console.warn(`X sentiment fetch failed for ${repo.name}: ${err.message}`);
    return { sentiment: "unknown", blurb: "", postCount: 0, topPost: null, _failed: true };
  }
}

module.exports = { fetchXSentimentForRepo, parseXSentiment };
