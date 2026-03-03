/**
 * Sanitize repo-supplied fields to prevent prompt injection.
 * Strips output markers (HEADLINE:, BODY:, etc.) that could hijack
 * the structured output parser in xai.js.
 */
function sanitizeRepoField(text) {
  if (!text) return text;
  return String(text).replace(/\b(HEADLINE|SUBHEADLINE|BODY|BUILDERS_TAKE)\s*:/gi, "$1 -");
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

function leadArticlePrompt(repo) {
  const desc = sanitizeRepoField(repo.description);
  const readme = sanitizeRepoField(repo.readmeExcerpt);
  const release = sanitizeRepoField(repo.releaseNotes);
  const topics = sanitizeRepoField(repo.topics.join(", ") || "none listed");
  return `You are a senior technology journalist writing for The Git Times, a broadsheet newspaper for builders and developers. Write a compelling 300-400 word article about this GitHub project.

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

EDITORIAL GUIDELINES:
- The story is WHAT this project does and WHY it matters to builders — not how many stars it has.
- Do not lead with, emphasize, or build narratives around star counts or GitHub popularity metrics.
- Focus on: the problem it solves, how it works technically, what's new or different about it, and who should care.
- Stars may be mentioned once for context but should never be the headline, lede, or thesis.
Write in authoritative newspaper style. No hype, no fluff — give builders the signal they need.
Write entirely in English. Do not reference multilingual documentation, language badges, or translations — focus on what the project does technically.

Output EXACTLY in this format (include the markers):

HEADLINE: [A compelling newspaper headline about what this project does or why it matters, 8-12 words]
SUBHEADLINE: [A clarifying subheadline, 12-20 words]
BODY: [300-400 word article body. Write in short, punchy paragraphs. Include concrete details from the readme and release notes. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names, and bullet lists where appropriate.]
BUILDERS_TAKE: [2-3 sentences of practical advice for developers considering this project. What should they know before diving in?]`;
}

function secondaryArticlePrompt(repo) {
  const desc = sanitizeRepoField(repo.description);
  const readme = sanitizeRepoField(repo.readmeExcerpt);
  const release = sanitizeRepoField(repo.releaseNotes);
  const topics = sanitizeRepoField(repo.topics.join(", ") || "none listed");
  return `You are a technology journalist writing for The Git Times, a broadsheet newspaper for builders. Write a tight 150-200 word article about this GitHub project.

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

EDITORIAL GUIDELINES:
- Focus on what this project does and why it matters. Do not lead with or emphasize star counts.
Write in crisp newspaper style. No hype. Concrete details only.
Write entirely in English. Do not reference multilingual documentation, language badges, or translations — focus on what the project does technically.

Output EXACTLY in this format (include the markers):

HEADLINE: [Newspaper headline about what this project does, 6-10 words]
SUBHEADLINE: [Clarifying subheadline, 10-16 words]
BODY: [150-200 word article. Short paragraphs, concrete details. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names, and bullet lists where appropriate.]
BUILDERS_TAKE: [1-2 sentences of practical advice for developers.]`;
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

function breakoutArticlePrompt(repo, delta) {
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
${repo.releaseName ? `- Latest release: ${repo.releaseName}` : ""}${trajectoryContext(repo)}

README EXCERPT:
${readme || "(no readme available)"}

${release ? `RELEASE NOTES:\n${release}` : ""}

EDITORIAL GUIDELINES:
- This project is getting attention. Your job is to explain WHY — what does it do, what problem does it solve, and what makes it technically interesting?
- Do NOT lead with star counts, growth numbers, or popularity metrics. Those are not the story.
- The story is the PROJECT — its capabilities, its approach, who it's for, and what it changes.
- You may mention that it's gaining traction, but as context, not as the headline or lede.
Write entirely in English. Do not reference multilingual documentation, language badges, or translations.

Output EXACTLY in this format (include the markers):

HEADLINE: [A compelling newspaper headline about what this project does or changes, 8-12 words]
SUBHEADLINE: [A clarifying subheadline about its capabilities or significance, 12-20 words]
BODY: [400-500 word article body. Lead with what the project does. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names, and bullet lists where appropriate.]
BUILDERS_TAKE: [2-3 sentences of practical advice for developers considering this project.]`;
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
Write entirely in English.

Output EXACTLY in this format (include the markers):

HEADLINE: [A compelling headline about the trend pattern, 8-12 words]
SUBHEADLINE: [A clarifying subheadline, 12-20 words]
BODY: [250-350 word article. Focus on the pattern. Reference repos as evidence. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names, and bullet lists where appropriate.]
BUILDERS_TAKE: [2-3 sentences about what this trend means for developers.]`;
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
Write entirely in English.

Output EXACTLY in this format (include the markers):

HEADLINE: [An intriguing headline about what this project does, 6-10 words]
SUBHEADLINE: [A clarifying subheadline, 10-16 words]
BODY: [150-200 word feature. Short paragraphs. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names.]
BUILDERS_TAKE: [1-2 sentences of practical advice.]`;
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
  leadArticlePrompt,
  secondaryArticlePrompt,
  quickHitPrompt,
  breakoutArticlePrompt,
  trendArticlePrompt,
  sleeperArticlePrompt,
  editorInChiefPrompt,
};
