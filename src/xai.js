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
  chooseLeadPrompt,
  EDITOR_LENSES,
  lensLeadPrompt,
  leadRationalePrompt,
} = require("./prompts");
const { enrichCandidatesWithSignals } = require("./signals");

const { SECTIONS, SECTION_ORDER } = require("./sections");
const { mastheadQuote } = require("./quotes");
const { isVersionChurn } = require("./editorial");

// Provider is env-driven. Defaults to a free OpenRouter model so the daily
// edition can generate at $0; override with LLM_MODEL / LLM_BASE_URL.
const MODEL = process.env.LLM_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";
const BASE_URL = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";

function createClient(apiKey) {
  return new OpenAI({
    baseURL: BASE_URL,
    apiKey: apiKey || process.env.OPENROUTER_API_KEY,
    timeout: 120_000,
    // OpenRouter attribution headers (ignored by other providers).
    defaultHeaders: {
      "HTTP-Referer": "https://gittimes.com",
      "X-Title": "The Git Times",
    },
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
    // OpenRouter: disable model "thinking" so the structured HEADLINE:/BODY:
    // output isn't eaten by a free reasoning model's token budget. Set
    // LLM_REASONING=true to re-enable. Non-OpenRouter providers ignore this.
    if (process.env.LLM_REASONING !== "true") {
      params.reasoning = { enabled: false };
    }
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

  // Demote version-churn secondaries (a patch bump with no material change is
  // not a story) to Quick Hits before spending an LLM call on a full article.
  const churnToQuickHits = [];
  const materialSecondary = [];
  for (const r of sectionData.secondary) {
    if (isVersionChurn(r)) {
      churnToQuickHits.push({ ...r, summary: r.description });
    } else {
      materialSecondary.push(r);
    }
  }
  if (churnToQuickHits.length > 0) {
    console.log(`  Demoted ${churnToQuickHits.length} version-churn release(s) to Quick Hits in ${sectionConfig.label}`);
  }

  // Lead + material secondary articles in parallel (with parse-level retry)
  const [leadArticle, ...allSecondary] = await Promise.all([
    generateArticleWithRetry(client, MODEL, leadArticlePrompt, sectionData.lead, leadTokens, llmLimit, coverage),
    ...materialSecondary.map((r) =>
      generateArticleWithRetry(client, MODEL, secondaryArticlePrompt, r, 800, llmLimit, coverage)
    ),
  ]);

  // Quick hits
  let quickHits = sectionData.quickHits || [];
  quickHits = quickHits.concat(churnToQuickHits);
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
 * Skips _isTrend articles.
 * @param {object} sections - Generated sections keyed by section id
 * @param {object} client - OpenAI client
 * @param {function} llmLimit - p-limit limiter
 */
async function _attachSentiment(sections, client, llmLimit, { fetchXSentimentForRepo }) {

  const tasks = []; // { article, repo }

  for (const id of SECTION_ORDER) {
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
 * Internal helper: generate content for all sections,
 * pick tagline, and log article count.
 * @param {object} sections - { frontPage: { lead, secondary, quickHits }, ai: {...}, ... }
 * @param {object} client - OpenAI client
 * @param {function} llmLimit - p-limit limiter
 * @returns {Promise<{ sections: object, tagline: string }>}
 */
async function _generateBaseSections(sections, client, llmLimit, coverage) {

  const result = {};
  for (const id of SECTION_ORDER) {
    const sectionData = sections[id];
    if (!sectionData) {
      result[id] = { lead: null, secondary: [], quickHits: [], isEmpty: true };
      continue;
    }
    const config = SECTIONS[id];
    console.log(`  Generating ${config.label}...`);
    result[id] = await generateSectionContent(sectionData, config, client, llmLimit, coverage);
  }

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

  // X sentiment is opt-in (X_SENTIMENT=true): it needs a provider with the x_search tool
  // (Grok), which OpenRouter does not offer. Off by default since dropping xAI.
  if (process.env.X_SENTIMENT === "true" && options.fetchXSentimentForRepo) {
    await _attachSentiment(base.sections, client, llmLimit, { fetchXSentimentForRepo: options.fetchXSentimentForRepo });
  }

  return base;
}

/**
 * Editor-in-chief: choose the front-page lead from the breakout shortlist on
 * SIGNIFICANCE, not star velocity. The shortlist (ranked by momentum) is the
 * filter; this LLM call is the decision. Falls back to the top-ranked candidate
 * if the editor is unavailable or returns an unusable choice.
 * @returns {Promise<{ chosen, why, viaEditor }>}
 */
async function chooseEditorialLead(client, candidates, llmLimit, opts = {}) {
  const fallback = { chosen: candidates[0], why: null, viaEditor: false };
  if (!candidates || candidates.length <= 1) return fallback;

  const threadBlock = opts.threadBlock || null;
  try {
    const raw = await llmLimit(() => chat(client, MODEL, chooseLeadPrompt(candidates, threadBlock), 300));
    const whyMatch = lastMatch(raw, /WHY:\s*(.+)/);
    const why = whyMatch?.[1]?.trim() || null;

    // Prefer an explicit number, but a weak model often answers with the repo
    // name instead — match that against the candidate list as a fallback.
    let idx = -1;
    const leadMatch = lastMatch(raw, /LEAD:\s*#?(\d+)/);
    if (leadMatch) idx = parseInt(leadMatch[1], 10) - 1;
    if (!(idx >= 0 && idx < candidates.length)) {
      const leadLine = (lastMatch(raw, /LEAD:\s*(.+)/)?.[1] || raw).toLowerCase();
      idx = candidates.findIndex((c) => {
        const name = (c.repo.full_name || c.repo.name || "").toLowerCase();
        const short = name.split("/").pop();
        return name && (leadLine.includes(name) || (short && leadLine.includes(short)));
      });
    }

    if (!(idx >= 0 && idx < candidates.length)) {
      console.warn("Editor-in-chief returned an unparseable choice; using top momentum candidate");
      return fallback;
    }
    return { chosen: candidates[idx], why, viaEditor: true };
  } catch (err) {
    console.warn(`Editor-in-chief lead selection failed, using top momentum candidate: ${err.message}`);
    return fallback;
  }
}

/**
 * Tolerant-parse a single editor/panelist response into {idx, why}. Accepts a
 * `LEAD: #n` number OR a repo name in the LEAD line (the free model often answers
 * with the name). Returns idx -1 when nothing usable is found.
 */
function parseLeadVote(raw, candidates) {
  const whyMatch = lastMatch(raw, /WHY:\s*(.+)/);
  const why = whyMatch?.[1]?.trim() || null;
  let idx = -1;
  const leadMatch = lastMatch(raw, /LEAD:\s*#?(\d+)/);
  if (leadMatch) idx = parseInt(leadMatch[1], 10) - 1;
  if (!(idx >= 0 && idx < candidates.length)) {
    const leadLine = (lastMatch(raw, /LEAD:\s*(.+)/)?.[1] || raw).toLowerCase();
    idx = candidates.findIndex((c) => {
      const name = (c.repo.full_name || c.repo.name || "").toLowerCase();
      const short = name.split("/").pop();
      return name && (leadLine.includes(name) || (short && leadLine.includes(short)));
    });
  }
  if (!(idx >= 0 && idx < candidates.length)) return { idx: -1, why };
  return { idx, why };
}

/**
 * Editorial panel: N lens-differentiated editors vote on the lead, votes are
 * tallied, and a synthesis call writes the "Why this leads today" rationale.
 * Returns {chosen, why, viaEditor, viaPanel, lensVotes} or NULL to signal the
 * caller to fall back to the single-call chooseEditorialLead. Fully fail-soft:
 * any thrown error, or no usable votes, yields null. Disabled by
 * GT_DISABLE_PANEL=1 or when there is <2 candidates. EDITOR_MODEL (env) overrides
 * the model for this decision only.
 */
async function runEditorPanel(client, candidates, llmLimit, opts = {}) {
  if (process.env.GT_DISABLE_PANEL === "1") return null;
  if (!candidates || candidates.length <= 1) return null;
  const threadBlock = opts.threadBlock || null;
  const model = process.env.EDITOR_MODEL || MODEL;

  try {
    // Run the lenses concurrently; each panelist is independently fail-soft.
    const votes = await Promise.all(
      EDITOR_LENSES.map((lens) =>
        llmLimit(() => chat(client, model, lensLeadPrompt(candidates, lens.directive, threadBlock), 200))
          .then((raw) => ({ lens: lens.key, ...parseLeadVote(raw, candidates) }))
          .catch(() => ({ lens: lens.key, idx: -1, why: null }))
      )
    );

    const valid = votes.filter((v) => v.idx >= 0);
    if (valid.length === 0) return null; // nothing usable → caller falls back

    // Tally; ties broken by candidate order (momentum rank).
    const tally = new Map();
    for (const v of valid) tally.set(v.idx, (tally.get(v.idx) || 0) + 1);
    let winnerIdx = valid[0].idx;
    let best = -1;
    for (let i = 0; i < candidates.length; i++) {
      const n = tally.get(i) || 0;
      if (n > best) { best = n; winnerIdx = i; }
    }

    const winner = candidates[winnerIdx];
    const winnerName = winner.repo.full_name || winner.repo.name;
    const lensNotes = valid.filter((v) => v.idx === winnerIdx).map((v) => v.why);
    // If no winning-lens notes, fall back to any notes so the synthesis has grounding.
    const notes = lensNotes.length ? lensNotes : valid.map((v) => v.why);

    // Synthesis: one call for the rationale. Fail-soft to a winning-lens note.
    let why = notes.find(Boolean) || null;
    try {
      const winnerLine = `${winnerName} — ${winner.repo.description || "no description"}`;
      const raw = await llmLimit(() => chat(client, model, leadRationalePrompt(winnerLine, notes), 120));
      const text = (raw || "").trim().replace(/^["“]|["”]$/g, "").trim();
      if (text) why = text;
    } catch {
      /* keep the lens-note fallback */
    }

    return { chosen: winner, why, viaEditor: true, viaPanel: true, lensVotes: votes };
  } catch (err) {
    console.warn(`Editor panel failed, falling back to single-call editor: ${err.message}`);
    return null;
  }
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

  const editorialMeta = { breakout: null, trends: [], sleepers: [], leadEditor: null };

  // Editor-in-chief: pick the lead from the breakout shortlist on significance,
  // not star velocity. Mutates editorialPlan.breakout to the chosen candidate.
  const candidates = editorialPlan.breakoutCandidates && editorialPlan.breakoutCandidates.length > 0
    ? editorialPlan.breakoutCandidates
    : (editorialPlan.breakout ? [editorialPlan.breakout] : []);
  if (candidates.length > 0) {
    // Cross-source significance: enrich candidates with real-world-attention
    // signals (HN discussion, package downloads) before the editor decides.
    // Fail-soft — any source error leaves the candidate un-enriched, never throws.
    try {
      await enrichCandidatesWithSignals(candidates, {});
    } catch (e) {
      console.warn(`Candidate signal enrichment failed (non-fatal): ${e.message}`);
    }
    const leadOpts = { threadBlock: options.threadContext || null };
    // Panel of lens-differentiated editors first; fail-soft to the single call.
    let decision = await runEditorPanel(client, candidates, llmLimit, leadOpts);
    if (!decision) {
      decision = await chooseEditorialLead(client, candidates, llmLimit, leadOpts);
    }
    editorialPlan.breakout = { repo: decision.chosen.repo, delta: decision.chosen.delta, reason: decision.chosen.reason };
    editorialMeta.leadEditor = {
      chosen: decision.chosen.repo.full_name || decision.chosen.repo.name,
      why: decision.why,
      viaEditor: decision.viaEditor,
      viaPanel: !!decision.viaPanel,
      consideredCount: candidates.length,
    };
    if (decision.viaEditor) {
      console.log(`  Editor-in-chief lead${decision.viaPanel ? " (panel)" : ""}: ${editorialMeta.leadEditor.chosen}${decision.why ? ` — ${decision.why}` : ""}`);
    }
  }

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
        // Surface the editor/panel rationale as the front-page "Why this leads
        // today" byline. Only when the chosen lead is the editor's pick.
        if (editorialMeta.leadEditor && editorialMeta.leadEditor.why) {
          breakoutArticle.leadRationale = editorialMeta.leadEditor.why;
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
        _trendRepos: trend.repos.map(r => ({
          name: r.full_name || r.name,
          url: `https://github.com/${r.full_name || r.name}`,
          language: r.language || null,
        })),
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

  // X sentiment is opt-in (X_SENTIMENT=true): it needs a provider with the x_search tool
  // (Grok), which OpenRouter does not offer. Off by default since dropping xAI.
  if (process.env.X_SENTIMENT === "true" && options.fetchXSentimentForRepo) {
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

module.exports = { createClient, generateAllContent, generateEditorialContent, generateSectionContent, parseArticle, parseQuickHits, sanitizePrompt, lastMatch, chat, MODEL, _attachSentiment, deduplicateContent, chooseEditorialLead, runEditorPanel, parseLeadVote };
