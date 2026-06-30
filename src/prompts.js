/**
 * Sanitize repo-supplied fields to prevent prompt injection.
 * Strips output markers (HEADLINE:, BODY:, etc.) that could hijack
 * the structured output parser in xai.js.
 */
function sanitizeRepoField(text) {
  if (!text) return text;
  return String(text).replace(/\b(HEADLINE|SUBHEADLINE|BODY|USE_CASES|SIMILAR_PROJECTS)\s*:/gi, "$1 -");
}

// Forces every article to carry one honest limitation or open question, so the
// piece reads as reporting rather than a rewritten README. Shared across prompts.
const HONEST_LIMITATION_GUIDELINE = `- A press release lists only strengths; an article is honest. You MUST surface one genuine limitation, trade-off, maturity gap, or open question — e.g. early version, narrow scope, missing platform, heavy dependency, unproven at scale, or a design choice that won't suit everyone. Base it on the data — the Signals line (open issues, last-commit age), a thin/aging release, or a narrow scope are good grounds; if the data is thin, raise the most important question a builder would ask before adopting. Do not invent flaws and do not let it become marketing ("the only catch is it's too powerful").
`;

function timestampLine(repo) {
  const parts = [];
  if (repo.createdAt) parts.push(`Created: ${repo.createdAt}`);
  if (repo.pushedAt) parts.push(`Last pushed: ${repo.pushedAt}`);
  return parts.length > 0 ? `- ${parts.join(" | ")}` : "";
}

// Observable signals a writer can ground an honest limitation in, instead of
// guessing. Open-issue load and a stale last-release both hint at real caveats.
function signalsLine(repo) {
  const parts = [];
  if (repo.openIssues != null) parts.push(`Open issues: ${repo.openIssues}`);
  if (repo.forks != null) parts.push(`Forks: ${repo.forks}`);
  const rel = repo.releaseName || (repo.starTrajectory && repo.starTrajectory.createdAt);
  if (repo.pushedAt) {
    const days = Math.round((Date.now() - new Date(repo.pushedAt).getTime()) / 86400000);
    if (!Number.isNaN(days)) parts.push(`Last commit: ${days}d ago`);
  }
  void rel;
  return parts.length ? `- Signals: ${parts.join(" | ")}` : "";
}

function trajectoryContext(repo) {
  if (!repo.starTrajectory) return "";
  const t = repo.starTrajectory;
  const created = new Date(t.createdAt);
  const ageDays = Math.round((Date.now() - created.getTime()) / 86400000);
  const ageStr = ageDays < 30 ? `${ageDays} days old` :
    ageDays < 365 ? `${Math.round(ageDays / 30)} months old` :
    `${(ageDays / 365).toFixed(1)} years old`;
  return `\n- Project age: ${ageStr} | Community: ${t.totalStars.toLocaleString()} stars | Traction: ${t.growthPattern}`;
}

/**
 * Returns a freshness directive for established repos (≥ 90 days old).
 * New repos get no directive — introductory framing is appropriate for them.
 */
function editorialFramingDirective(repo) {
  const createdStr = repo.createdAt || (repo.starTrajectory && repo.starTrajectory.createdAt);
  if (!createdStr) return "";
  const ageDays = Math.round((Date.now() - new Date(createdStr).getTime()) / 86400000);
  if (ageDays < 90) return "";
  const ageLabel = ageDays < 365
    ? `~${Math.round(ageDays / 30)} months old`
    : `~${(ageDays / 365).toFixed(1)} years old`;
  return `
FRESHNESS DIRECTIVE — This project is ${ageLabel}. It is NOT new.
- Do NOT introduce this project as if readers are hearing about it for the first time.
- Assume your audience is aware this project exists.
- If there is a genuine recent hook — a new capability, a breaking change, a major release, or a real adoption milestone — lead with it.
- Do NOT manufacture a hook. A patch/point release with no material change is NOT news; never headline a version number for its own sake.
- This is a daily newspaper, not a directory. If there is no concrete recent development, report the single most recent concrete change plainly and keep it SHORT — do NOT pad with evergreen "why this project still matters" significance.
- BANNED evergreen framings (do not use any phrasing like these): "remains a", "still the", "a staple", "the go-to", "a vital guide", "a hands-on guide", "stands the test of time", "as relevant as ever", "continues to be".
- Frame: "what's changed" or "why it matters now", never "meet this project."
`;
}

/**
 * Build a PRIOR COVERAGE block for the LLM prompt when a repo has been covered before.
 * Returns empty string if no prior coverage exists.
 * @param {object} repo - Enriched repo object
 * @param {Map} [coverage] - Map<repoName, [{date, headline}]>
 * @returns {string}
 */
function priorCoverageBlock(repo, coverage) {
  if (!coverage) return "";
  const repoName = repo.name || repo.full_name;
  if (!repoName || !coverage.has(repoName)) return "";

  const entries = coverage.get(repoName).slice(0, 3);
  if (entries.length === 0) return "";

  const lines = entries.map((e) => `  - ${e.date}: "${e.headline}"`).join("\n");
  return `\nPRIOR COVERAGE (this repo has appeared in recent editions):
${lines}

IMPORTANT EDITORIAL DIRECTION:
- Do NOT rehash the original coverage or repeat similar angles.
- Write about what is NEW or CHANGED — a new release, adoption milestone, breaking change, community development, or technical evolution.
- Do not reference prior articles or frame this as a "follow-up" or "update" — write it as a standalone piece with a fresh angle.
`;
}

function leadArticlePrompt(repo, coverage) {
  const desc = sanitizeRepoField(repo.description);
  const readme = sanitizeRepoField(repo.readmeExcerpt);
  const release = sanitizeRepoField(repo.releaseNotes);
  const topics = sanitizeRepoField((repo.topics || []).join(", ") || "none listed");
  return `You are a senior technology journalist writing for The Git Times, a broadsheet newspaper for builders and developers. Write a compelling 300-400 word article about this GitHub project.

PROJECT DATA:
- Name: ${repo.name}
- Description: ${desc}
- Language: ${repo.language}
- Topics: ${topics}
${timestampLine(repo)}
${signalsLine(repo)}
${repo.releaseName ? `- Latest release: ${repo.releaseName}` : ""}${trajectoryContext(repo)}

README EXCERPT:
${readme || "(no readme available)"}

${release ? `RELEASE NOTES:\n${release}` : ""}
${priorCoverageBlock(repo, coverage)}${editorialFramingDirective(repo)}EDITORIAL GUIDELINES:
- The story is WHAT this project does and WHY it matters to builders — not how many stars it has.
- Do not lead with, emphasize, or build narratives around star counts or GitHub popularity metrics.
- Focus on: the problem it solves, how it works technically, what's new or different about it, and who should care.
- Stars may be mentioned once for context but should never be the headline, lede, or thesis.
${HONEST_LIMITATION_GUIDELINE}Write in authoritative newspaper style. No hype, no fluff — give builders the signal they need.
Do not include a word count anywhere in the output.
Write entirely in English. Do not reference multilingual documentation, language badges, or translations — focus on what the project does technically.

Output EXACTLY in this format (include the markers):

HEADLINE: [A compelling newspaper headline about what this project does or why it matters, 8-12 words]
SUBHEADLINE: [A clarifying subheadline, 12-20 words]
BODY: [300-400 word article body. Write in short, punchy paragraphs. Include concrete details from the readme and release notes. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names, and bullet lists where appropriate. End the body with a separate short paragraph beginning **The catch:** that states one honest limitation, trade-off, missing capability, or open question a builder should weigh.]
USE_CASES:
1. [8-12 word use case — who + what, no narrative]
2. [8-12 word use case]
3. [8-12 word use case]`;
}

function secondaryArticlePrompt(repo, coverage) {
  const desc = sanitizeRepoField(repo.description);
  const readme = sanitizeRepoField(repo.readmeExcerpt);
  const release = sanitizeRepoField(repo.releaseNotes);
  const topics = sanitizeRepoField((repo.topics || []).join(", ") || "none listed");
  return `You are a technology journalist writing for The Git Times, a broadsheet newspaper for builders. Write a tight 150-200 word article about this GitHub project.

PROJECT DATA:
- Name: ${repo.name}
- Description: ${desc}
- Language: ${repo.language}
- Topics: ${topics}
${timestampLine(repo)}
${signalsLine(repo)}
${repo.releaseName ? `- Latest release: ${repo.releaseName}` : ""}${trajectoryContext(repo)}

README EXCERPT:
${readme || "(no readme available)"}

${release ? `RELEASE NOTES:\n${release}` : ""}
${priorCoverageBlock(repo, coverage)}${editorialFramingDirective(repo)}EDITORIAL GUIDELINES:
- Focus on what this project does and why it matters. Do not lead with or emphasize star counts.
${HONEST_LIMITATION_GUIDELINE}Write in crisp newspaper style. No hype. Concrete details only.
Do not include a word count anywhere in the output.
Write entirely in English. Do not reference multilingual documentation, language badges, or translations — focus on what the project does technically.

Output EXACTLY in this format (include the markers):

HEADLINE: [Newspaper headline about what this project does, 6-10 words]
SUBHEADLINE: [Clarifying subheadline, 10-16 words]
BODY: [150-200 word article. Short paragraphs, concrete details. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names, and bullet lists where appropriate. End with one sentence beginning **The catch:** naming an honest limitation or open question.]
USE_CASES:
1. [8-12 word use case — who + what, no narrative]
2. [8-12 word use case]
3. [8-12 word use case]`;
}

function quickHitPrompt(repos) {
  const list = repos
    .map(
      (r, i) =>
        `${i + 1}. ${r.name} (${r.language}): ${r.description}`
    )
    .join("\n");

  return `You are writing one-line summaries for a newspaper's "Quick Hits" section. Each summary must be a single punchy sentence, max 30 words, that tells a builder what the project does and why it's worth a look. Focus on capabilities, not popularity metrics.

REPOS:
${list}

Output EXACTLY in this format — one line per repo, numbered to match:

${repos.map((_, i) => `${i + 1}. [single sentence summary]`).join("\n")}`;
}

function breakoutArticlePrompt(repo, delta, coverage) {
  const desc = sanitizeRepoField(repo.description);
  const readme = sanitizeRepoField(repo.readmeExcerpt);
  const release = sanitizeRepoField(repo.releaseNotes);
  const topics = sanitizeRepoField((repo.topics || []).join(", ") || "none listed");
  return `You are a senior technology journalist writing for The Git Times, a broadsheet newspaper for builders and developers. Write a compelling 400-500 word SPOTLIGHT article about this GitHub project that is gaining significant developer attention right now.

PROJECT DATA:
- Name: ${repo.name}
- Description: ${desc}
- Language: ${repo.language}
- Topics: ${topics}
${timestampLine(repo)}
${signalsLine(repo)}
${repo.releaseName ? `- Latest release: ${repo.releaseName}` : ""}${trajectoryContext(repo)}

README EXCERPT:
${readme || "(no readme available)"}

${release ? `RELEASE NOTES:\n${release}` : ""}

${priorCoverageBlock(repo, coverage)}${editorialFramingDirective(repo)}EDITORIAL GUIDELINES:
- This project is getting attention. Your job is to explain WHY — what does it do, what problem does it solve, and what makes it technically interesting?
- Do NOT lead with star counts, growth numbers, or popularity metrics. Those are not the story.
- The story is the PROJECT — its capabilities, its approach, who it's for, and what it changes.
- You may mention that it's gaining traction, but as context, not as the headline or lede.
${HONEST_LIMITATION_GUIDELINE}Do not include a word count anywhere in the output.
Write entirely in English. Do not reference multilingual documentation, language badges, or translations.

Output EXACTLY in this format (include the markers):

HEADLINE: [A compelling newspaper headline about what this project does or changes, 8-12 words]
SUBHEADLINE: [A clarifying subheadline about its capabilities or significance, 12-20 words]
BODY: [400-500 word article body. Lead with what the project does. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names, and bullet lists where appropriate. End the body with a separate short paragraph beginning **The catch:** that states one honest limitation, trade-off, or open question.]
USE_CASES:
1. [8-12 word use case — who + what, no narrative]
2. [8-12 word use case]
3. [8-12 word use case]`;
}

function trendArticlePrompt(trend) {
  const repoList = trend.repos
    .map(
      (r) =>
        `  - ${r.full_name || r.name} (${r.language || "Unknown"}): ${sanitizeRepoField(r.description) || "no description"}`
    )
    .join("\n");

  return `You are a senior technology journalist writing for The Git Times. Write a 250-350 word TREND article about an emerging pattern in open source.

TREND THEME: ${trend.theme}

REPOS IN THIS CLUSTER:
${repoList}

The story is the PATTERN, not any single repo. Reference individual repos as evidence of the trend. Explain what this cluster tells us about where open source is heading. Focus on what these projects do and what the pattern means technically — not on popularity metrics.
- Be honest about the pattern: end the body with a short paragraph beginning **The catch:** noting where the trend is overhyped, immature, fragmented, or still unproven — the counter-take a skeptical builder would raise.
Do not include a word count anywhere in the output.
Write entirely in English.

Output EXACTLY in this format (include the markers):

HEADLINE: [A compelling headline about the trend pattern, 8-12 words]
SUBHEADLINE: [A clarifying subheadline, 12-20 words]
BODY: [250-350 word article. Focus on the pattern. Reference repos as evidence. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names, and bullet lists where appropriate. End with a **The catch:** paragraph as instructed above.]
USE_CASES:
1. [8-12 word use case — who + what, no narrative]
2. [8-12 word use case]
3. [8-12 word use case]`;
}

function sleeperArticlePrompt(sleeper) {
  const repo = sleeper.repo;
  const name = repo.full_name || repo.name;
  const description = sanitizeRepoField(repo.description) || "no description";
  const language = repo.language || "Unknown";
  const topics = sanitizeRepoField((repo.topics || []).join(", ") || "none listed");

  return `You are a technology journalist writing for The Git Times "Deep Cuts" section — hidden gems most developers haven't discovered yet. Write a 150-200 word feature.

PROJECT DATA:
- Name: ${name}
- Description: ${description}
- Language: ${language}
- Topics: ${topics}

WHY SELECTED: ${sleeper.reason}

Frame this as a discovery — what does this project do and why should builders pay attention? Focus on its capabilities and potential, not its popularity metrics.
- Stay honest: end with one sentence beginning **The catch:** naming why it's still under the radar — early, niche, rough edges, or unproven.
Do not include a word count anywhere in the output.
Write entirely in English.

Output EXACTLY in this format (include the markers):

HEADLINE: [An intriguing headline about what this project does, 6-10 words]
SUBHEADLINE: [A clarifying subheadline, 10-16 words]
BODY: [150-200 word feature. Short paragraphs. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names. End with a **The catch:** sentence as instructed above.]
USE_CASES:
1. [8-12 word use case — who + what, no narrative]
2. [8-12 word use case]
3. [8-12 word use case]`;
}

function editorInChiefPrompt(candidateSummary) {
  return `You are the Editor-in-Chief of The Git Times, a daily tech newspaper. Review today's candidate repos and make editorial decisions.

TOP CANDIDATES:
${candidateSummary}

Based on this data, respond with:
1. LEAD: Which repo should be the front page lead and why (1 sentence)
2. TRENDS: Name up to 3 patterns you see across these repos (1 sentence each)
3. SLEEPERS: Identify 1-2 under-the-radar repos worth featuring (1 sentence each)

Be specific. Reference repo names. Prioritize signal over noise.`;
}

/**
 * Build a one-line summary per breakout candidate for the lead editor.
 * @param {Array<{repo, reason}>} candidates
 * @returns {string}
 */
function candidateSummaryLines(candidates) {
  return candidates
    .map((c, i) => {
      const r = c.repo;
      const name = r.full_name || r.name;
      const desc = sanitizeRepoField(r.description) || "no description";
      const lang = r.language || "Unknown";
      const topics = (r.topics || []).slice(0, 4).join(", ");
      const signals = c.signalSummary ? ` | ${c.signalSummary}` : "";
      return `${i + 1}. ${name} — ${desc} | ${lang}${topics ? ` | topics: ${topics}` : ""} | momentum: ${c.reason}${signals}`;
    })
    .join("\n");
}

/**
 * The editor-in-chief's lead decision. Star momentum is why these candidates
 * surfaced (the filter); it is explicitly NOT the basis for the choice. The
 * editor picks the single most SIGNIFICANT story and returns a parseable choice.
 */
function chooseLeadPrompt(candidates, threadBlock) {
  const continuity = threadBlock ? `\n${threadBlock}\n` : "";
  return `You are the Editor-in-Chief of The Git Times, a daily newspaper for builders. These candidates all gained GitHub stars recently — that momentum is only why they crossed your desk. Your job is to choose which ONE leads the front page based on SIGNIFICANCE to builders: genuine impact, novelty, a real shift in what's possible, or consequence for how people build. Do NOT choose the one with the most stars for being popular; popularity is not significance. A quietly important release should beat a viral list or a meme repo.
${continuity}
CANDIDATES:
${candidateSummaryLines(candidates)}

Respond EXACTLY in this format, nothing else:
LEAD: [the single number of the story that should lead]
WHY: [one sentence on why it is the most significant — not the most popular]`;
}

/**
 * The editorial panel — three editors, each judging by a distinct lens. The
 * panel's votes are tallied for the pick; a synthesis step writes the rationale.
 * Each lens is {key, directive} where the directive is the judging criterion.
 */
const EDITOR_LENSES = [
  { key: "impact", directive: "judge purely by IMPACT: how many builders this materially helps, and how much it changes their day-to-day work." },
  { key: "novelty", directive: "judge purely by NOVELTY: whether this does something genuinely new or newly possible, versus a well-trodden idea executed again." },
  { key: "consequence", directive: "judge purely by CONSEQUENCE TO BUILDERS: whether ignoring this would leave a serious builder behind, or whether it's safely skippable." },
];

/**
 * A single panelist's lead prompt: same candidate slate, but judged by ONE lens.
 * @param {Array} candidates
 * @param {string} lensDirective - the lens's judging criterion
 * @param {string} [threadBlock] - optional continuity context
 */
function lensLeadPrompt(candidates, lensDirective, threadBlock) {
  const continuity = threadBlock ? `\n${threadBlock}\n` : "";
  return `You are an editor on the front-page panel of The Git Times, a daily newspaper for builders. These candidates all gained GitHub stars recently — momentum is only why they crossed your desk, never the basis for your vote. For this vote you ${lensDirective} Popularity is not your criterion.
${continuity}
CANDIDATES:
${candidateSummaryLines(candidates)}

Respond EXACTLY in this format, nothing else:
LEAD: [the single number of the story that should lead by your lens]
WHY: [one sentence, by your lens only]`;
}

/**
 * Synthesis: write the one-paragraph "Why this leads today" byline for the
 * winning story, grounded in the panel's notes. No hype, newspaper voice.
 * @param {string} winnerLine - "name — description" of the winning candidate
 * @param {string[]} lensNotes - the panelists' one-line rationales
 */
function leadRationalePrompt(winnerLine, lensNotes) {
  const notes = (lensNotes || []).filter(Boolean).map((n) => `- ${n}`).join("\n");
  return `You are the Editor-in-Chief of The Git Times. Your panel chose today's front-page lead:
${winnerLine}

Panel notes:
${notes}

Write ONE sentence (max 35 words) for the byline "Why this leads today" — why this story leads, grounded in the notes, in plain newspaper voice. No hype, no adjectives-for-their-own-sake, no restating the headline. Output ONLY that sentence, nothing else.`;
}

module.exports = {
  sanitizeRepoField,
  editorialFramingDirective,
  priorCoverageBlock,
  leadArticlePrompt,
  secondaryArticlePrompt,
  quickHitPrompt,
  breakoutArticlePrompt,
  trendArticlePrompt,
  sleeperArticlePrompt,
  editorInChiefPrompt,
  candidateSummaryLines,
  chooseLeadPrompt,
  EDITOR_LENSES,
  lensLeadPrompt,
  leadRationalePrompt,
};
