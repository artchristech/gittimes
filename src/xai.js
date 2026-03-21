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

const { SECTIONS, SECTION_ORDER } = require("./sections");
const { mastheadQuote } = require("./quotes");

const MODEL = "grok-4.20-0309-reasoning";

function createClient(apiKey) {
  return new OpenAI({
    baseURL: "https://api.x.ai/v1",
    apiKey,
    timeout: 120_000,
  });
}

function sanitizePrompt(text) {
  // Remove characters that may cause issues with some API endpoints
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function _repoId(repoOrArticle) {
  if (!repoOrArticle) return null;
  const r = repoOrArticle.repo || repoOrArticle;
  return r.full_name || r.name || null;
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
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw new AbortError(err.message);
      }
    },
  });
}

function lastMatch(text, pattern) {
  const matches = [...text.matchAll(new RegExp(pattern, "g"))];
  return matches.length ? matches[matches.length - 1] : null;
}

function parseNumberedList(block) {
  if (!block) return [];
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s*/.test(l))
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function parseArticle(text, repo) {
  // Use LAST occurrence of each marker — reasoning models echo the format
  // instructions early in their thinking, then produce the real output later.
  const headlineMatch = lastMatch(text, /(?:^|\n)\bHEADLINE:\s*(.+)/);
  const subheadlineMatch = lastMatch(text, /SUBHEADLINE:\s*(.+)/);

  // For BODY, find the last BODY: marker and grab everything until the last USE_CASES:
  let body = null;
  const bodyMarkers = [...text.matchAll(/BODY:\s*/g)];
  if (bodyMarkers.length) {
    const lastBodyStart = bodyMarkers[bodyMarkers.length - 1].index + bodyMarkers[bodyMarkers.length - 1][0].length;
    const ucMarkers = [...text.matchAll(/USE_CASES:/g)];
    const lastUcStart = ucMarkers.length ? ucMarkers[ucMarkers.length - 1].index : text.length;
    if (lastBodyStart < lastUcStart) {
      body = text.slice(lastBodyStart, lastUcStart).trim();
    }
  }

  // Parse USE_CASES: block (between USE_CASES: and SIMILAR_PROJECTS:)
  let useCases = [];
  const ucMatches = [...text.matchAll(/USE_CASES:\s*/g)];
  const spMatches = [...text.matchAll(/SIMILAR_PROJECTS:\s*/g)];
  if (ucMatches.length) {
    const lastUcEnd = ucMatches[ucMatches.length - 1].index + ucMatches[ucMatches.length - 1][0].length;
    const lastSpStart = spMatches.length ? spMatches[spMatches.length - 1].index : text.length;
    if (lastUcEnd <= lastSpStart) {
      useCases = parseNumberedList(text.slice(lastUcEnd, lastSpStart));
    }
  }

  // Parse SIMILAR_PROJECTS: block (from SIMILAR_PROJECTS: to end)
  let similarProjects = [];
  if (spMatches.length) {
    const lastSpEnd = spMatches[spMatches.length - 1].index + spMatches[spMatches.length - 1][0].length;
    similarProjects = parseNumberedList(text.slice(lastSpEnd));
  }

  const headline = headlineMatch?.[1]?.trim() || null;
  const subheadline = subheadlineMatch?.[1]?.trim() || "";

  const failed = !headline || !body;
  if (failed && repo) {
    console.warn(`Warning: Failed to parse structured output for ${repo.name}, using fallback`);
  }

  return {
    headline: headline || (repo ? `${repo.shortName}: ${repo.description}`.slice(0, 80) : "Untitled"),
    subheadline: subheadline || (repo ? repo.description : ""),
    body: body || (repo ? repo.description : text),
    useCases,
    similarProjects,
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
async function generateArticleWithRetry(client, model, promptFn, repo, maxTokens, llmLimit, coverage) {
  try {
    const raw = await llmLimit(() => chat(client, model, promptFn(repo, coverage), maxTokens));
    const article = { ...parseArticle(raw, repo), repo };
    if (!article._isFallback) return article;

    // Retry once with a nudge to use the required format
    console.warn(`Retrying article generation for ${repo.name} after parse failure`);
    const retryRaw = await llmLimit(() => chat(client, model, promptFn(repo, coverage), maxTokens));
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
async function generateSectionContent(sectionData, sectionConfig, client, llmLimit, coverage) {
  if (!sectionData.lead) {
    return { lead: null, secondary: [], quickHits: sectionData.quickHits || [], isEmpty: true };
  }

  const isFrontPage = sectionConfig.id === "frontPage";
  const leadTokens = isFrontPage ? 2000 : 1200;

  // Lead + all secondary articles in parallel (with parse-level retry)
  const [leadArticle, ...allSecondary] = await Promise.all([
    generateArticleWithRetry(client, MODEL, leadArticlePrompt, sectionData.lead, leadTokens, llmLimit, coverage),
    ...sectionData.secondary.map((r) =>
      generateArticleWithRetry(client, MODEL, secondaryArticlePrompt, r, 800, llmLimit, coverage)
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
 * Attach X sentiment data to eligible articles across all sections.
 * Eligible: lead + featured secondary (first 2 for frontPage, first 1 for others) + deepCuts.
 * Skips _isTrend articles and memes section.
 * @param {object} sections - Generated sections keyed by section id
 * @param {object} client - OpenAI client
 * @param {function} llmLimit - p-limit limiter
 */
async function _attachSentiment(sections, client, llmLimit, { fetchXSentimentForRepo }) {

  const tasks = []; // { article, repo }

  for (const id of SECTION_ORDER) {
    if (SECTIONS[id]?.isMemes) continue;
    const section = sections[id];
    if (!section || section.isEmpty) continue;

    const isFrontPage = id === "frontPage";
    const featuredCount = isFrontPage ? 2 : 1;

    // Lead
    if (section.lead && !section.lead._isTrend) {
      tasks.push(section.lead);
    }

    // Featured secondary (only the ones rendered with renderFeaturedArticle)
    if (section.secondary) {
      for (const article of section.secondary.slice(0, featuredCount)) {
        if (!article._isTrend) {
          tasks.push(article);
        }
      }
    }

    // Deep cuts
    if (section.deepCuts) {
      for (const article of section.deepCuts) {
        if (!article._isTrend) {
          tasks.push(article);
        }
      }
    }
  }

  if (tasks.length === 0) return;

  console.log(`Fetching X sentiment for ${tasks.length} articles...`);

  const results = await Promise.all(
    tasks.map((article) =>
      fetchXSentimentForRepo(client, llmLimit, article.repo)
        .then((result) => ({ article, result, ok: true }))
        .catch(() => ({ article, result: null, ok: false }))
    )
  );

  let succeeded = 0;
  for (const { article, result, ok } of results) {
    if (ok && result) {
      article.xSentiment = result;
      if (!result._failed) succeeded++;
    }
  }

  console.log(`X sentiment: ${succeeded}/${tasks.length} succeeded`);
}

/**
 * Internal helper: generate content for all non-memes sections, add memes placeholder,
 * pick tagline, and log article count.
 * @param {object} sections - { frontPage: { lead, secondary, quickHits }, ai: {...}, ... }
 * @param {object} client - OpenAI client
 * @param {function} llmLimit - p-limit limiter
 * @returns {Promise<{ sections: object, tagline: string }>}
 */
async function _generateBaseSections(sections, client, llmLimit, coverage) {

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
    result[id] = await generateSectionContent(sectionData, config, client, llmLimit, coverage);
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
async function generateAllContent(sections, apiKey, options = {}) {
  const client = options.client || createClient(apiKey);
  const { default: pLimit } = await pLimitP;
  const llmLimit = pLimit(3);
  const coverage = options.coverage || null;

  console.log("Generating articles for all sections...");

  const base = await _generateBaseSections(sections, client, llmLimit, coverage);

  if (process.env.X_SENTIMENT !== "false" && options.fetchXSentimentForRepo) {
    await _attachSentiment(base.sections, client, llmLimit, { fetchXSentimentForRepo: options.fetchXSentimentForRepo });
  }

  return base;
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
  const client = options.client || createClient(apiKey);
  const githubToken = options.githubToken || process.env.GITHUB_TOKEN;
  const coverage = options.coverage || null;
  const { default: pLimit } = await pLimitP;
  const llmLimit = pLimit(3);

  console.log("Generating articles for all sections (editorial mode)...");

  // Step 1: Generate standard content for all sections
  const base = await _generateBaseSections(sections, client, llmLimit, coverage);
  const result = base.sections;

  const editorialMeta = { breakout: null, trends: [], sleepers: [] };

  // Build a set of all repos already placed in any section
  const editorialSeen = new Set();
  for (const id of SECTION_ORDER) {
    const s = result[id];
    if (!s || s.isEmpty) continue;
    if (s.lead) { const rid = _repoId(s.lead); if (rid) editorialSeen.add(rid); }
    for (const a of s.secondary || []) { const rid = _repoId(a); if (rid) editorialSeen.add(rid); }
    for (const a of s.quickHits || []) { const rid = _repoId(a); if (rid) editorialSeen.add(rid); }
  }

  // Step 2: Generate breakout article and override front page lead
  if (editorialPlan.breakout) {
    try {
      console.log(`  Generating breakout article for ${editorialPlan.breakout.repo.full_name || editorialPlan.breakout.repo.name}...`);
      const enrichRepo = options.enrichRepo;
      const fetchStarTrajectory = options.fetchStarTrajectory;
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

      const breakoutPrompt = breakoutArticlePrompt(breakoutRepo, editorialPlan.breakout.delta, coverage);
      const raw = await llmLimit(() => chat(client, MODEL, breakoutPrompt, 2500));
      const breakoutArticle = { ...parseArticle(raw, breakoutRepo), repo: breakoutRepo };

      if (!breakoutArticle._isFallback && result.frontPage && result.frontPage.lead) {
        const breakoutName = breakoutRepo.full_name || breakoutRepo.name;
        const currentLeadName = result.frontPage.lead.repo?.name || result.frontPage.lead.repo?.full_name;
        const isSameAsLead = breakoutName === currentLeadName;

        // Remove breakout repo from ALL sections' secondary/quickHits
        for (const id of SECTION_ORDER) {
          const s = result[id];
          if (!s || s.isEmpty) continue;
          s.secondary = (s.secondary || []).filter((a) => _repoId(a) !== breakoutName);
          s.quickHits = (s.quickHits || []).filter((a) => _repoId(a) !== breakoutName);
          // If the breakout repo is a non-frontPage lead, demote it
          if (id !== "frontPage" && s.lead && _repoId(s.lead) === breakoutName) {
            if (s.secondary.length > 0) {
              s.lead = s.secondary.shift();
            } else {
              s.lead = null;
              s.isEmpty = !s.quickHits.length;
            }
          }
        }
        editorialSeen.add(breakoutName);

        // Demote current lead to secondary (unless it's the same repo)
        if (!isSameAsLead) {
          result.frontPage.secondary.unshift(result.frontPage.lead);
        }
        result.frontPage.lead = breakoutArticle;
        editorialMeta.breakout = {
          repo: breakoutName,
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
        if (editorialSeen.has(repoName)) {
          console.log(`  Skipping sleeper ${repoName} (already in edition)`);
          continue;
        }
        console.log(`  Generating sleeper article for ${repoName}...`);
        const enrichRepoFn = options.enrichRepo;
        // Enrich the sleeper repo if it's a raw GitHub object
        let sleeperRepo = sleeper.repo;
        if (!sleeperRepo.readmeExcerpt && sleeperRepo.full_name) {
          try {
            const token = githubToken;
            if (token) sleeperRepo = await enrichRepoFn(sleeperRepo, token);
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
          editorialSeen.add(repoName);
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

  if (process.env.X_SENTIMENT !== "false" && options.fetchXSentimentForRepo) {
    await _attachSentiment(result, client, llmLimit, { fetchXSentimentForRepo: options.fetchXSentimentForRepo });
  }

  return { sections: result, tagline: base.tagline, editorialMeta };
}

/**
 * Post-generation safety-net dedup. Walks all sections in SECTION_ORDER;
 * earlier sections win ties. Within a section: lead > secondary > deepCuts > quickHits.
 * Mutates content.sections in place and returns the count of removed duplicates.
 */
function deduplicateContent(content) {
  const seen = new Set();
  let removed = 0;

  for (const id of SECTION_ORDER) {
    const s = content.sections?.[id];
    if (!s || s.isEmpty) continue;

    // Lead
    if (s.lead) {
      const rid = _repoId(s.lead);
      if (rid && seen.has(rid)) {
        // Demote: promote first secondary or null out
        if (s.secondary && s.secondary.length > 0) {
          s.lead = s.secondary.shift();
        } else {
          s.lead = null;
        }
        removed++;
      } else if (rid) {
        seen.add(rid);
      }
    }

    // Secondary
    if (s.secondary) {
      s.secondary = s.secondary.filter((a) => {
        const rid = _repoId(a);
        if (rid && seen.has(rid)) { removed++; return false; }
        if (rid) seen.add(rid);
        return true;
      });
    }

    // Deep cuts
    if (s.deepCuts) {
      s.deepCuts = s.deepCuts.filter((a) => {
        const rid = _repoId(a);
        if (rid && seen.has(rid)) { removed++; return false; }
        if (rid) seen.add(rid);
        return true;
      });
    }

    // Quick hits
    if (s.quickHits) {
      s.quickHits = s.quickHits.filter((a) => {
        const rid = _repoId(a);
        if (rid && seen.has(rid)) { removed++; return false; }
        if (rid) seen.add(rid);
        return true;
      });
    }
  }

  if (removed > 0) {
    console.log(`Dedup removed ${removed} duplicate(s) across sections`);
  }
  return removed;
}

module.exports = { createClient, generateAllContent, generateEditorialContent, generateSectionContent, parseArticle, parseQuickHits, sanitizePrompt, lastMatch, chat, MODEL, _attachSentiment, deduplicateContent };
