const OpenAI = require("openai");

const pRetryP = import("p-retry");
const pLimitP = import("p-limit");

const {
  leadArticlePrompt,
  secondaryArticlePrompt,
  quickHitPrompt,
} = require("./prompts");

const BIG_MODEL = "grok-4-1-fast-reasoning";
const SMALL_MODEL = "grok-4-1-fast-reasoning";

function createClient(apiKey) {
  return new OpenAI({
    baseURL: "https://api.x.ai/v1",
    apiKey,
  });
}

function sanitizePrompt(text) {
  // Remove characters that may cause issues with some API endpoints
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

const ARTICLE_MARKERS = /\bHEADLINE:|BODY:/;

function pickStructuredOutput(msg) {
  const content = (msg.content || "").trim();
  const reasoning = (msg.reasoning || "").trim();

  // Prefer whichever field contains the structured article markers
  if (ARTICLE_MARKERS.test(content)) return content;
  if (ARTICLE_MARKERS.test(reasoning)) return reasoning;

  // Neither has markers — prefer content if non-empty, else reasoning
  return content || reasoning;
}

async function _chat(client, model, prompt, maxTokens = 1024, options = {}) {
  try {
    const clean = sanitizePrompt(prompt);
    const params = {
      model,
      messages: [{ role: "user", content: clean }],
      max_tokens: maxTokens,
      temperature: 0.7,
    };
    if (options.tools) params.tools = options.tools;
    const response = await client.chat.completions.create(params);
    if (!response.choices?.length) {
      throw new Error(`No choices returned from ${model}`);
    }
    const msg = response.choices[0].message;
    const result = pickStructuredOutput(msg);
    if (!result) {
      throw new Error(`Empty response from ${model}`);
    }
    return result;
  } catch (err) {
    console.error(`LLM call failed (model=${model}): ${err.status} ${err.message}`);
    throw err;
  }
}

async function chat(client, model, prompt, maxTokens = 1024, options = {}) {
  const { default: pRetry, AbortError } = await pRetryP;
  return pRetry(() => _chat(client, model, prompt, maxTokens, options), {
    retries: 2,
    minTimeout: 2000,
    randomize: true,
    onFailedAttempt(info) {
      const err = info.error || {};
      console.warn(
        `LLM attempt ${info.attemptNumber} failed (${info.retriesLeft} left): ${err.message || String(err)}`
      );
      if (err.status && err.status >= 400 && err.status < 500) {
        throw new AbortError(err.message);
      }
    },
  });
}

function lastMatch(text, pattern) {
  const matches = [...text.matchAll(new RegExp(pattern, "g"))];
  return matches.length ? matches[matches.length - 1] : null;
}

function parseArticle(text, repo) {
  // Use LAST occurrence of each marker — reasoning models echo the format
  // instructions early in their thinking, then produce the real output later.
  const headlineMatch = lastMatch(text, /(?:^|\n)\bHEADLINE:\s*(.+)/);
  const subheadlineMatch = lastMatch(text, /SUBHEADLINE:\s*(.+)/);
  const buildersTakeMatch = lastMatch(text, /BUILDERS_TAKE:\s*([\s\S]*?)$/);

  // For BODY, find the last BODY: marker and grab everything until the last BUILDERS_TAKE:
  let body = null;
  const bodyMarkers = [...text.matchAll(/BODY:\s*/g)];
  if (bodyMarkers.length) {
    const lastBodyStart = bodyMarkers[bodyMarkers.length - 1].index + bodyMarkers[bodyMarkers.length - 1][0].length;
    const btMarkers = [...text.matchAll(/BUILDERS_TAKE:/g)];
    const lastBtStart = btMarkers.length ? btMarkers[btMarkers.length - 1].index : text.length;
    if (lastBodyStart < lastBtStart) {
      body = text.slice(lastBodyStart, lastBtStart).trim();
    }
  }

  const headline = headlineMatch?.[1]?.trim() || null;
  const subheadline = subheadlineMatch?.[1]?.trim() || "";
  const buildersTake = buildersTakeMatch?.[1]?.trim() || "";

  const failed = !headline || !body;
  if (failed && repo) {
    console.warn(`Warning: Failed to parse structured output for ${repo.name}, using fallback`);
  }

  return {
    headline: headline || (repo ? `${repo.shortName}: ${repo.description}`.slice(0, 80) : "Untitled"),
    subheadline: subheadline || (repo ? repo.description : ""),
    body: body || (repo ? repo.description : text),
    buildersTake,
    _isFallback: failed,
  };
}

function parseQuickHits(text, repos) {
  const lines = text.split("\n").filter((l) => l.trim());
  return repos.map((repo, i) => {
    const line = lines.find((l) => l.startsWith(`${i + 1}.`));
    const summary = line
      ? line.replace(/^\d+\.\s*/, "").trim()
      : repo.description;
    return { ...repo, summary };
  });
}

/**
 * Generate an article with one parse-level retry.
 * If the first LLM response fails to parse, re-prompt once before giving up.
 */
async function generateArticleWithRetry(client, model, promptFn, repo, maxTokens, llmLimit) {
  try {
    const raw = await llmLimit(() => chat(client, model, promptFn(repo), maxTokens));
    const article = { ...parseArticle(raw, repo), repo };
    if (!article._isFallback) return article;

    // Retry once with a nudge to use the required format
    console.warn(`Retrying article generation for ${repo.name} after parse failure`);
    const retryRaw = await llmLimit(() => chat(client, model, promptFn(repo), maxTokens));
    const retryArticle = { ...parseArticle(retryRaw, repo), repo };
    return retryArticle;
  } catch (err) {
    console.warn(`Article generation failed for ${repo.name}: ${err.message}, using fallback`);
    return { ...parseArticle("", repo), repo };
  }
}

/**
 * Generate content for a single section.
 * @param {object} sectionData - { lead, secondary, quickHits }
 * @param {object} sectionConfig - Section config from sections.js
 * @param {object} client - OpenAI client
 * @param {function} llmLimit - p-limit limiter shared across sections
 * @returns {Promise<object>} { lead, secondary, quickHits, isEmpty }
 */
async function generateSectionContent(sectionData, sectionConfig, client, llmLimit) {
  if (!sectionData.lead) {
    return { lead: null, secondary: [], quickHits: sectionData.quickHits || [], isEmpty: true };
  }

  const isFrontPage = sectionConfig.id === "frontPage";
  const leadModel = isFrontPage ? BIG_MODEL : SMALL_MODEL;
  const leadTokens = isFrontPage ? 2000 : 1200;

  // Lead + all secondary articles in parallel (with parse-level retry)
  const [leadArticle, ...allSecondary] = await Promise.all([
    generateArticleWithRetry(client, leadModel, leadArticlePrompt, sectionData.lead, leadTokens, llmLimit),
    ...sectionData.secondary.map((r) =>
      generateArticleWithRetry(client, SMALL_MODEL, secondaryArticlePrompt, r, 800, llmLimit)
    ),
  ]);

  // Quick hits
  let quickHits = sectionData.quickHits || [];
  if (quickHits.length > 0) {
    const quickHitsRaw = await llmLimit(() => chat(client, SMALL_MODEL, quickHitPrompt(quickHits), 600));
    quickHits = parseQuickHits(quickHitsRaw, quickHits);
  }

  // Demote fallback articles from secondary to quick hits
  const goodSecondary = [];
  const demotedToQuickHits = [];
  for (const article of allSecondary) {
    if (article._isFallback) {
      demotedToQuickHits.push({ ...article.repo, summary: article.repo.description });
    } else {
      goodSecondary.push(article);
    }
  }

  // If lead is a fallback and there are good secondaries, promote the first good one
  let finalLead = leadArticle;
  if (finalLead._isFallback && goodSecondary.length > 0) {
    demotedToQuickHits.push({ ...finalLead.repo, summary: finalLead.repo.description });
    finalLead = goodSecondary.shift();
  }

  quickHits.push(...demotedToQuickHits);

  return {
    lead: finalLead,
    secondary: goodSecondary,
    quickHits,
    isEmpty: false,
  };
}

/**
 * Generate content for all sections.
 * @param {object} sections - { frontPage: { lead, secondary, quickHits }, ai: {...}, ... }
 * @param {string} apiKey - xAI API key
 * @returns {Promise<object>} { sections: { frontPage: {...}, ... }, tagline }
 */
async function generateAllContent(sections, apiKey) {
  const { SECTIONS, SECTION_ORDER } = require("./sections");
  const client = createClient(apiKey);
  const { default: pLimit } = await pLimitP;
  const llmLimit = pLimit(3);

  console.log("Generating articles for all sections...");

  const result = {};
  for (const id of SECTION_ORDER) {
    if (SECTIONS[id].isXPulse) continue; // X Pulse has no GitHub data
    const sectionData = sections[id];
    if (!sectionData) {
      result[id] = { lead: null, secondary: [], quickHits: [], isEmpty: true };
      continue;
    }
    const config = SECTIONS[id];
    console.log(`  Generating ${config.label}...`);
    result[id] = await generateSectionContent(sectionData, config, client, llmLimit);
  }

  // Annotate articles with X.com sentiment
  const { fetchXSentimentForRepo } = require("./x-sentiment");
  for (const id of SECTION_ORDER) {
    const section = result[id];
    if (!section || section.isEmpty) continue;
    // Lead
    if (section.lead?.repo) {
      section.lead.xSentiment = await fetchXSentimentForRepo(client, llmLimit, section.lead.repo);
    }
    // Secondary (parallel, respecting llmLimit)
    await Promise.all(section.secondary.map(async (article) => {
      article.xSentiment = await fetchXSentimentForRepo(client, llmLimit, article.repo);
    }));
  }

  // Generate X Pulse
  const { fetchXPulse } = require("./x-sentiment");
  console.log("  Generating X Pulse...");
  const xPulseData = await fetchXPulse(client, llmLimit);
  result["xPulse"] = {
    lead: null,
    secondary: [],
    quickHits: [],
    isEmpty: xPulseData.pulseItems.length === 0,
    isXPulse: true,
    pulseItems: xPulseData.pulseItems,
  };

  // Pick a daily pioneer quote for the masthead
  const { mastheadQuote } = require("./quotes");
  const tagline = mastheadQuote();

  const totalArticles = SECTION_ORDER.reduce((sum, id) => {
    const s = result[id];
    if (!s) return sum;
    return sum + (s.lead ? 1 : 0) + s.secondary.length + s.quickHits.length;
  }, 0);
  console.log(`Generated ${totalArticles} total articles across ${SECTION_ORDER.length} sections`);

  return { sections: result, tagline };
}

module.exports = { createClient, generateAllContent, generateSectionContent, parseArticle, parseQuickHits, sanitizePrompt, lastMatch, chat };
