const { lastMatch, chat } = require("./xai");

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
function parseXSentiment(text, repo) {
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
      chat(client, "grok-4-1-fast-reasoning", prompt, 300, { tools: [X_SEARCH_TOOL] })
    );
    return parseXSentiment(raw, repo);
  } catch (err) {
    console.warn(`X sentiment fetch failed for ${repo.name}: ${err.message}`);
    return { sentiment: "unknown", blurb: "", postCount: 0, topPost: null, _failed: true };
  }
}

/**
 * Parse X Pulse items from structured LLM output.
 * @param {string} text - Raw LLM response
 * @returns {object[]} Array of pulse items
 */
function parseXPulse(text) {
  if (!text || !text.trim()) return [];

  const blocks = text.split(/---/).filter((b) => b.trim());
  const items = [];

  for (const block of blocks) {
    if (items.length >= 8) break;

    const topicMatch = lastMatch(block, /TOPIC:\s*(.+)/);
    const blurbMatch = lastMatch(block, /BLURB:\s*(.+)/);
    const sentimentMatch = lastMatch(block, /SENTIMENT:\s*(.+)/);
    const handlesMatch = lastMatch(block, /HANDLES:\s*(.+)/);

    const topic = topicMatch?.[1]?.trim();
    if (!topic) continue;

    let sentiment = sentimentMatch?.[1]?.trim().toLowerCase() || "neutral";
    if (!VALID_SENTIMENTS.includes(sentiment)) sentiment = "neutral";

    items.push({
      topic,
      blurb: blurbMatch?.[1]?.trim() || "",
      sentiment,
      handles: handlesMatch?.[1]?.trim() || "",
    });
  }

  return items;
}

/**
 * Fetch X Pulse trending topics via Grok's x_search tool.
 * @param {object} client - OpenAI client
 * @param {function} llmLimit - p-limit limiter
 * @returns {Promise<object>} { pulseItems: [...] }
 */
async function fetchXPulse(client, llmLimit) {
  try {
    const prompt = `Search X.com for the top 8 trending topics in the tech/developer/open-source space right now. For each topic, provide a brief summary of the conversation.

Respond with items separated by "---", each in this EXACT format:
TOPIC: <short topic title>
BLURB: <one sentence summary of the discussion>
SENTIMENT: <one of: buzzing, positive, neutral, mixed, quiet>
HANDLES: <2-3 notable accounts discussing this, comma-separated>

---

Provide up to 8 topics.`;

    const raw = await llmLimit(() =>
      chat(client, "grok-4-1-fast-reasoning", prompt, 2000, { tools: [X_SEARCH_TOOL] })
    );
    return { pulseItems: parseXPulse(raw) };
  } catch (err) {
    console.warn(`X Pulse fetch failed: ${err.message}`);
    return { pulseItems: [] };
  }
}

module.exports = { fetchXSentimentForRepo, parseXSentiment, fetchXPulse, parseXPulse };
