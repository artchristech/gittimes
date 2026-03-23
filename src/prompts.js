/**
 * Sanitize repo-supplied fields to prevent prompt injection.
 * Strips output markers (HEADLINE:, BODY:, etc.) that could hijack
 * the structured output parser in xai.js.
 */
function sanitizeRepoField(text) {
  if (!text) return text;
  return String(text).replace(/\b(HEADLINE|SUBHEADLINE|TAGLINE|DESCRIPTION|BODY|USE_CASES|SIMILAR_PROJECTS)\s*:/gi, "$1 -");
}

function timestampLine(repo) {
  const parts = [];
  if (repo.createdAt) parts.push(`Created: ${repo.createdAt}`);
  if (repo.pushedAt) parts.push(`Last pushed: ${repo.pushedAt}`);
  return parts.length > 0 ? `- ${parts.join(" | ")}` : "";
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
- The news hook MUST be something recent: a new release, a major update, a breaking change, a significant adoption milestone, or a shift in direction.
- If there is no recent release or change data available, focus on a specific current use case or integration that is timely — not a general overview.
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
  return `You are writing project descriptions for The Git Times, a daily catalog of trending GitHub projects for builders and developers. Your job is to tell readers what this project IS and what they can DO with it — clearly, directly, no filler.

PROJECT DATA:
- Name: ${repo.name}
- Description: ${desc}
- Language: ${repo.language}
- Topics: ${topics}
${timestampLine(repo)}
${repo.releaseName ? `- Latest release: ${repo.releaseName}` : ""}${trajectoryContext(repo)}

README EXCERPT:
${readme || "(no readme available)"}

${release ? `RELEASE NOTES:\n${release}` : ""}
${priorCoverageBlock(repo, coverage)}${editorialFramingDirective(repo)}GUIDELINES:
- Be direct. No hype, no narrative, no newspaper prose.
- Do not mention star counts, popularity, or GitHub metrics.
- Focus on: what it is, what problem it solves, how it works, what makes it different.
Write entirely in English.

Output EXACTLY in this format (include the markers):

TAGLINE: [One sentence, max 20 words: what this project is and does. Direct, concrete, no hype.]
DESCRIPTION: [2-3 sentences expanding on the tagline. What problem does it solve? How does it work? What makes it different? Be specific and technical.]
USE_CASES:
1. [8-12 word use case — who + what, no narrative]
2. [8-12 word use case]
3. [8-12 word use case]
SIMILAR_PROJECTS:
1. [project-name] - [how it compares in 1 sentence]
2. [project-name] - [how it compares]
3. [project-name] - [how it compares]`;
}

function secondaryArticlePrompt(repo, coverage) {
  const desc = sanitizeRepoField(repo.description);
  const readme = sanitizeRepoField(repo.readmeExcerpt);
  const release = sanitizeRepoField(repo.releaseNotes);
  const topics = sanitizeRepoField((repo.topics || []).join(", ") || "none listed");
  return `You are writing project descriptions for The Git Times, a daily catalog of trending GitHub projects for builders. Tell readers what this project IS and what they can DO with it.

PROJECT DATA:
- Name: ${repo.name}
- Description: ${desc}
- Language: ${repo.language}
- Topics: ${topics}
${timestampLine(repo)}
${repo.releaseName ? `- Latest release: ${repo.releaseName}` : ""}${trajectoryContext(repo)}

README EXCERPT:
${readme || "(no readme available)"}

${release ? `RELEASE NOTES:\n${release}` : ""}
${priorCoverageBlock(repo, coverage)}${editorialFramingDirective(repo)}GUIDELINES:
- Be direct. No hype, no narrative. Do not mention star counts or popularity.
Write entirely in English.

Output EXACTLY in this format (include the markers):

TAGLINE: [One sentence, max 20 words: what this project is and does.]
DESCRIPTION: [2-3 sentences. What problem does it solve? How does it work? What makes it different?]
USE_CASES:
1. [8-12 word use case — who + what, no narrative]
2. [8-12 word use case]
3. [8-12 word use case]
SIMILAR_PROJECTS:
1. [project-name] - [how it compares]
2. [project-name] - [how it compares]
3. [project-name] - [how it compares]`;
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
  return `You are writing a SPOTLIGHT project description for The Git Times, a daily catalog of trending GitHub projects for builders. This project is gaining significant developer attention right now. Explain what it IS and what makes it technically interesting.

PROJECT DATA:
- Name: ${repo.name}
- Description: ${desc}
- Language: ${repo.language}
- Topics: ${topics}
${timestampLine(repo)}
${repo.releaseName ? `- Latest release: ${repo.releaseName}` : ""}${trajectoryContext(repo)}

README EXCERPT:
${readme || "(no readme available)"}

${release ? `RELEASE NOTES:\n${release}` : ""}

${priorCoverageBlock(repo, coverage)}${editorialFramingDirective(repo)}GUIDELINES:
- Be direct. No hype, no narrative. Do not lead with star counts or popularity metrics.
- Focus on capabilities, technical approach, and what makes it different.
Write entirely in English.

Output EXACTLY in this format (include the markers):

TAGLINE: [One sentence, max 20 words: what this project is and does.]
DESCRIPTION: [3-4 sentences. What it does, what problem it solves, how it works technically, what makes it different. Be specific.]
USE_CASES:
1. [8-12 word use case — who + what, no narrative]
2. [8-12 word use case]
3. [8-12 word use case]
SIMILAR_PROJECTS:
1. [project-name] - [how it compares in 1 sentence]
2. [project-name] - [how it compares]
3. [project-name] - [how it compares]`;
}

function trendArticlePrompt(trend) {
  const repoList = trend.repos
    .map(
      (r) =>
        `  - ${r.full_name || r.name} (${r.language || "Unknown"}): ${sanitizeRepoField(r.description) || "no description"}`
    )
    .join("\n");

  return `You are writing a TREND description for The Git Times, a daily catalog of trending GitHub projects for builders. Describe an emerging pattern across multiple projects.

TREND THEME: ${trend.theme}

REPOS IN THIS CLUSTER:
${repoList}

The story is the PATTERN, not any single repo. Reference individual repos as evidence.
Write entirely in English.

Output EXACTLY in this format (include the markers):

TAGLINE: [One sentence, max 20 words: what this trend is about.]
DESCRIPTION: [3-4 sentences. What pattern is emerging? What do these projects share? Why does it matter for builders?]
USE_CASES:
1. [8-12 word use case — who + what, no narrative]
2. [8-12 word use case]
3. [8-12 word use case]
SIMILAR_PROJECTS:
1. [project-name] - [how it compares in 1 sentence]
2. [project-name] - [how it compares]
3. [project-name] - [how it compares]`;
}

function sleeperArticlePrompt(sleeper) {
  const repo = sleeper.repo;
  const name = repo.full_name || repo.name;
  const description = sanitizeRepoField(repo.description) || "no description";
  const language = repo.language || "Unknown";
  const topics = sanitizeRepoField((repo.topics || []).join(", ") || "none listed");

  return `You are writing a "Deep Cuts" project description for The Git Times — hidden gems most developers haven't discovered yet. Tell readers what this project IS and what they can DO with it.

PROJECT DATA:
- Name: ${name}
- Description: ${description}
- Language: ${language}
- Topics: ${topics}

WHY SELECTED: ${sleeper.reason}

Focus on capabilities, not popularity metrics.
Write entirely in English.

Output EXACTLY in this format (include the markers):

TAGLINE: [One sentence, max 20 words: what this project is and does.]
DESCRIPTION: [2-3 sentences. What does it do? What problem does it solve? Why should builders pay attention?]
USE_CASES:
1. [8-12 word use case — who + what, no narrative]
2. [8-12 word use case]
3. [8-12 word use case]
SIMILAR_PROJECTS:
1. [project-name] - [how it compares]
2. [project-name] - [how it compares]
3. [project-name] - [how it compares]`;
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
};
