function leadArticlePrompt(repo) {
  return `You are a senior technology journalist writing for DAGitNews, a broadsheet newspaper for builders and developers. Write a compelling 300-400 word article about this GitHub project.

PROJECT DATA:
- Name: ${repo.name}
- Description: ${repo.description}
- Stars: ${repo.stars.toLocaleString()} | Language: ${repo.language}
- Topics: ${repo.topics.join(", ") || "none listed"}
- Created: ${repo.createdAt} | Last pushed: ${repo.pushedAt}
${repo.releaseName ? `- Latest release: ${repo.releaseName}` : ""}

README EXCERPT:
${repo.readmeExcerpt || "(no readme available)"}

${repo.releaseNotes ? `RELEASE NOTES:\n${repo.releaseNotes}` : ""}

Write in authoritative newspaper style. No hype, no fluff — give builders the signal they need. Explain what the project does, why it matters, and what makes it noteworthy right now.

Output EXACTLY in this format (include the markers):

HEADLINE: [A compelling newspaper headline, 8-12 words]
SUBHEADLINE: [A clarifying subheadline, 12-20 words]
BODY: [300-400 word article body. Write in short, punchy paragraphs. Include concrete details from the readme and release notes. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names, and bullet lists where appropriate.]
BUILDERS_TAKE: [2-3 sentences of practical advice for developers considering this project. What should they know before diving in?]`;
}

function secondaryArticlePrompt(repo) {
  return `You are a technology journalist writing for DAGitNews, a broadsheet newspaper for builders. Write a tight 150-200 word article about this GitHub project.

PROJECT DATA:
- Name: ${repo.name}
- Description: ${repo.description}
- Stars: ${repo.stars.toLocaleString()} | Language: ${repo.language}
- Topics: ${repo.topics.join(", ") || "none listed"}
- Created: ${repo.createdAt} | Last pushed: ${repo.pushedAt}
${repo.releaseName ? `- Latest release: ${repo.releaseName}` : ""}

README EXCERPT:
${repo.readmeExcerpt || "(no readme available)"}

${repo.releaseNotes ? `RELEASE NOTES:\n${repo.releaseNotes}` : ""}

Write in crisp newspaper style. No hype. Concrete details only.

Output EXACTLY in this format (include the markers):

HEADLINE: [Newspaper headline, 6-10 words]
SUBHEADLINE: [Clarifying subheadline, 10-16 words]
BODY: [150-200 word article. Short paragraphs, concrete details. Use markdown formatting: **bold** for emphasis, \`backticks\` for code/tool names, and bullet lists where appropriate.]
BUILDERS_TAKE: [1-2 sentences of practical advice for developers.]`;
}

function quickHitPrompt(repos) {
  const list = repos
    .map(
      (r, i) =>
        `${i + 1}. ${r.name} (${r.stars.toLocaleString()} stars, ${r.language}): ${r.description}`
    )
    .join("\n");

  return `You are writing one-line summaries for a newspaper's "Quick Hits" section. Each summary must be a single punchy sentence, max 30 words, that tells a builder what the project does and why it's interesting right now.

REPOS:
${list}

Output EXACTLY in this format — one line per repo, numbered to match:

${repos.map((_, i) => `${i + 1}. [single sentence summary]`).join("\n")}`;
}

function editionTaglinePrompt(lead, secondary) {
  const names = [lead, ...secondary].map((r) => `${r.name} (${r.language})`).join(", ");
  return `You write pithy taglines for DAGitNews, a tech newspaper. Today's trending repos are: ${names}.

Write a single tagline (max 15 words) that captures today's theme — witty, observational, like a newspaper edition subtitle. No quotes, no hype. Just the tagline, nothing else.`;
}

module.exports = {
  leadArticlePrompt,
  secondaryArticlePrompt,
  quickHitPrompt,
  editionTaglinePrompt,
};
