const OpenAI = require("openai");

const pRetryP = import("p-retry");
const pLimitP = import("p-limit");

const {
  leadArticlePrompt,
  secondaryArticlePrompt,
  quickHitPrompt,
  breakoutArticlePrompt,
  trendArticlePrompt,
  sleeperArticlePrompt,
} = require("./prompts");

const MODEL = "grok-4-1-fast-reasoning";

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
  const leadTokens = isFrontPage ? 2000 : 1200;

  // Lead + all secondary articles in parallel (with parse-level retry)
  const [leadArticle, ...allSecondary] = await Promise.all([
    generateArticleWithRetry(client, MODEL, leadArticlePrompt, sectionData.lead, leadTokens, llmLimit),
    ...sectionData.secondary.map((r) =>
      generateArticleWithRetry(client, MODEL, secondaryArticlePrompt, r, 800, llmLimit)
    ),
  ]);

  // Quick hits
  let quickHits = sectionData.quickHits || [];
  if (quickHits.length > 0) {
    const quickHitsRaw = await llmLimit(() => chat(client, MODEL, quickHitPrompt(quickHits), 600));
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
 * Internal helper: generate content for all non-memes sections, add memes placeholder,
 * pick tagline, and log article count.
 * @param {object} sections - { frontPage: { lead, secondary, quickHits }, ai: {...}, ... }
 * @param {object} client - OpenAI client
 * @param {function} llmLimit - p-limit limiter
 * @returns {Promise<{ sections: object, tagline: string }>}
 */
async function _generateBaseSections(sections, client, llmLimit) {
  const { SECTIONS, SECTION_ORDER } = require("./sections");

  const result = {};
  for (const id of SECTION_ORDER) {
    if (SECTIONS[id].isMemes) continue;
    const sectionData = sections[id];
    if (!sectionData) {
      result[id] = { lead: null, secondary: [], quickHits: [], isEmpty: true };
      continue;
    }
    const config = SECTIONS[id];
    console.log(`  Generating ${config.label}...`);
    result[id] = await generateSectionContent(sectionData, config, client, llmLimit);
  }

  // Memes section — blank placeholder
  result["memes"] = {
    lead: null,
    secondary: [],
    quickHits: [],
    isEmpty: true,
    isMemes: true,
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

/**
 * Generate content for all sections.
 * @param {object} sections - { frontPage: { lead, secondary, quickHits }, ai: {...}, ... }
 * @param {string} apiKey - xAI API key
 * @returns {Promise<object>} { sections: { frontPage: {...}, ... }, tagline }
 */
async function generateAllContent(sections, apiKey) {
  const client = createClient(apiKey);
  const { default: pLimit } = await pLimitP;
  const llmLimit = pLimit(3);

  console.log("Generating articles for all sections...");

  return _generateBaseSections(sections, client, llmLimit);
}

/**
 * Generate content with editorial intelligence.
 * Runs existing section generation, then overlays breakout/trend/sleeper articles.
 * @param {object} sections - { frontPage: {...}, ai: {...}, ... }
 * @param {string} apiKey - xAI API key
 * @param {object} editorialPlan - { breakout, trends, sleepers, remaining }
 * @returns {Promise<object>} Same shape as generateAllContent, with editorialMeta
 */
async function generateEditorialContent(sections, apiKey, editorialPlan, options = {}) {
  const { SECTION_ORDER } = require("./sections");
  const client = options.client || createClient(apiKey);
  const githubToken = options.githubToken || process.env.GITHUB_TOKEN;
  const { default: pLimit } = await pLimitP;
  const llmLimit = pLimit(3);

  console.log("Generating articles for all sections (editorial mode)...");

  // Step 1: Generate standard content for all sections
  const base = await _generateBaseSections(sections, client, llmLimit);
  const result = base.sections;

  const editorialMeta = { breakout: null, trends: [], sleepers: [] };

  // Step 2: Generate breakout article and override front page lead
  if (editorialPlan.breakout) {
    try {
      console.log(`  Generating breakout article for ${editorialPlan.breakout.repo.full_name || editorialPlan.breakout.repo.name}...`);
      const { enrichRepo } = require("./github");
      const { fetchStarTrajectory } = require("./star-history");
      // Enrich the breakout repo if it's a raw GitHub object
      let breakoutRepo = editorialPlan.breakout.repo;
      if (!breakoutRepo.readmeExcerpt && breakoutRepo.full_name) {
        try {
          const token = githubToken;
          if (token) breakoutRepo = await enrichRepo(breakoutRepo, token);
        } catch {
          // Use raw repo data if enrichment fails
        }
      }

      // Fetch star trajectory for the breakout repo
      if (!breakoutRepo.starTrajectory) {
        try {
          const token = githubToken;
          const fullName = breakoutRepo.name || breakoutRepo.full_name;
          if (token && fullName) {
            const trajectory = await fetchStarTrajectory(fullName, token);
            if (trajectory) {
              breakoutRepo.starTrajectory = trajectory;
              console.log(`  Breakout star trajectory: ${fullName} — ${trajectory.totalStars.toLocaleString()} stars, ${trajectory.growthPattern}`);
            }
          }
        } catch (err) {
          console.warn(`Breakout trajectory fetch failed (non-fatal): ${err.message}`);
        }
      }

      const breakoutPrompt = breakoutArticlePrompt(breakoutRepo, editorialPlan.breakout.delta);
      const raw = await llmLimit(() => chat(client, MODEL, breakoutPrompt, 2500));
      const breakoutArticle = { ...parseArticle(raw, breakoutRepo), repo: breakoutRepo };

      if (!breakoutArticle._isFallback && result.frontPage && result.frontPage.lead) {
        // Demote current lead to secondary
        result.frontPage.secondary.unshift(result.frontPage.lead);
        result.frontPage.lead = breakoutArticle;
        editorialMeta.breakout = {
          repo: breakoutRepo.full_name || breakoutRepo.name,
          reason: editorialPlan.breakout.reason,
        };
      }
    } catch (err) {
      console.warn(`Breakout article generation failed: ${err.message}`);
    }
  }

  // Step 3: Generate trend articles and append to front page secondary
  for (const trend of editorialPlan.trends || []) {
    try {
      console.log(`  Generating trend article: ${trend.theme}...`);
      const prompt = trendArticlePrompt(trend);
      const raw = await llmLimit(() => chat(client, MODEL, prompt, 1500));
      const trendArticle = {
        ...parseArticle(raw, null),
        repo: {
          name: `trend/${trend.theme}`,
          shortName: trend.theme,
          description: `Trend: ${trend.theme}`,
          url: "#",
          stars: 0,
          language: "Trend",
          topics: [],
        },
        _isTrend: true,
      };

      if (!trendArticle._isFallback && result.frontPage) {
        result.frontPage.secondary.push(trendArticle);
        editorialMeta.trends.push({
          theme: trend.theme,
          repoCount: trend.repos.length,
        });
      }
    } catch (err) {
      console.warn(`Trend article generation failed for ${trend.theme}: ${err.message}`);
    }
  }

  // Step 4: Generate sleeper articles for Deep Cuts section
  if (editorialPlan.sleepers && editorialPlan.sleepers.length > 0) {
    const deepCuts = [];
    for (const sleeper of editorialPlan.sleepers.slice(0, 2)) {
      try {
        const repoName = sleeper.repo.full_name || sleeper.repo.name;
        console.log(`  Generating sleeper article for ${repoName}...`);
        const { enrichRepo } = require("./github");
        // Enrich the sleeper repo if it's a raw GitHub object
        let sleeperRepo = sleeper.repo;
        if (!sleeperRepo.readmeExcerpt && sleeperRepo.full_name) {
          try {
            const token = githubToken;
            if (token) sleeperRepo = await enrichRepo(sleeperRepo, token);
          } catch {
            // Use raw repo data if enrichment fails
          }
        }

        const prompt = sleeperArticlePrompt({ ...sleeper, repo: sleeperRepo });
        const raw = await llmLimit(() => chat(client, MODEL, prompt, 1000));
        const sleeperArticle = {
          ...parseArticle(raw, sleeperRepo),
          repo: {
            name: sleeperRepo.full_name || sleeperRepo.name,
            shortName: sleeperRepo.name ? sleeperRepo.name.split("/").pop() : repoName,
            description: sleeperRepo.description || `Sleeper: ${repoName}`,
            url: sleeperRepo.html_url || sleeperRepo.url || `https://github.com/${repoName}`,
            stars: sleeperRepo.stargazers_count || sleeperRepo.stars || 0,
            language: sleeperRepo.language || "Unknown",
            topics: sleeperRepo.topics || [],
          },
          _isSleeper: true,
        };

        if (!sleeperArticle._isFallback) {
          deepCuts.push(sleeperArticle);
          editorialMeta.sleepers.push({
            repo: repoName,
            reason: sleeper.reason,
          });
        }
      } catch (err) {
        console.warn(`Sleeper article generation failed for ${sleeper.repo.full_name || sleeper.repo.name}: ${err.message}`);
      }
    }

    if (deepCuts.length > 0 && result.frontPage) {
      result.frontPage.deepCuts = deepCuts;
    }
  }

  return { sections: result, tagline: base.tagline, editorialMeta };
}

module.exports = { createClient, generateAllContent, generateEditorialContent, generateSectionContent, parseArticle, parseQuickHits, sanitizePrompt, lastMatch, chat };
