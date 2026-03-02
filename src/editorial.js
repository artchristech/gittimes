/**
 * Editorial brain: breakout detection, trend clustering, sleeper identification.
 */

const THEME_KEYWORDS = {
  "ai-agents": ["agent", "ai-agent", "autonomous", "autogen", "crew", "langchain", "langgraph", "agentic"],
  "llm-tools": ["llm", "gpt", "openai", "anthropic", "gemini", "ollama", "inference", "transformer", "fine-tune", "rag", "embedding"],
  "rust-systems": ["rust", "memory-safe", "wasm", "tokio", "async-runtime"],
  "dev-tools": ["cli", "devtool", "linter", "formatter", "bundler", "build-tool", "vscode", "neovim", "ide", "terminal", "developer-tools"],
  "self-hosted": ["self-hosted", "selfhosted", "homelab", "home-automation", "docker", "kubernetes", "k8s"],
  "security-tools": ["security", "cybersecurity", "pentest", "vulnerability", "exploit", "encryption", "auth"],
  "web-frameworks": ["web", "react", "vue", "svelte", "nextjs", "frontend", "backend", "api", "rest", "graphql", "http"],
  "data-infra": ["database", "data", "analytics", "etl", "streaming", "kafka", "postgres", "redis", "vector-db"],
};

/**
 * Build a searchable text blob from a repo for theme matching.
 */
function _repoText(repo) {
  const parts = [
    (repo.description || "").toLowerCase(),
    (repo.full_name || repo.name || "").toLowerCase(),
    (repo.language || "").toLowerCase(),
    ...(repo.topics || []).map((t) => t.toLowerCase()),
  ];
  return parts.join(" ");
}

/**
 * Find the repo with the highest breakout score.
 * Score = absoluteGain * (1 + min(relativeGain, 10))
 * Minimum threshold: 100 stars gained.
 * @param {Array} repos - Raw GitHub repo objects
 * @param {Map} deltas - From computeDeltas
 * @returns {{ repo: object, delta: object, reason: string } | null}
 */
function identifyBreakout(repos, deltas) {
  if (!deltas || deltas.size === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const repo of repos) {
    const delta = deltas.get(repo.full_name);
    if (!delta || delta.starDelta === null || delta.starDelta < 100) continue;

    const absoluteGain = delta.starDelta;
    const relativeGain = delta.previousStars > 0 ? absoluteGain / delta.previousStars : 10;
    const score = absoluteGain * (1 + Math.min(relativeGain, 10));

    if (score > bestScore) {
      bestScore = score;
      best = {
        repo,
        delta,
        reason: `Gained ${absoluteGain.toLocaleString()} stars (${delta.previousStars ? Math.round(relativeGain * 100) + "%" : "new"} growth) in ${delta.daysSinceSnapshot} day(s)`,
      };
    }
  }

  return best;
}

/**
 * Group repos by theme keywords.
 * Only returns clusters with 2+ repos. Cap at 3 clusters, sorted by size.
 * @param {Array} repos - Raw GitHub repo objects
 * @returns {Array<{ theme: string, repos: Array }>}
 */
function clusterTrends(repos) {
  const clusters = {};

  for (const repo of repos) {
    const text = _repoText(repo);

    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      const matches = keywords.some((kw) => text.includes(kw));
      if (matches) {
        if (!clusters[theme]) clusters[theme] = [];
        // Avoid duplicates within a cluster
        if (!clusters[theme].some((r) => (r.full_name || r.name) === (repo.full_name || repo.name))) {
          clusters[theme].push(repo);
        }
      }
    }
  }

  // Filter to clusters with 2+ repos, sort by size descending, cap at 3
  return Object.entries(clusters)
    .filter(([, repos]) => repos.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)
    .map(([theme, repos]) => ({ theme, repos }));
}

/**
 * Find repos with <500 stars but >30 that are either growing or have 3+ topics.
 * @param {Array} repos - Raw GitHub repo objects
 * @param {Map} deltas - From computeDeltas
 * @returns {Array<{ repo: object, reason: string }>} Max 2
 */
function identifySleepers(repos, deltas) {
  const candidates = [];

  for (const repo of repos) {
    const stars = repo.stargazers_count || 0;
    if (stars > 500 || stars <= 30) continue;

    const delta = deltas ? deltas.get(repo.full_name) : null;
    const isGrowing = delta && delta.starDelta !== null && delta.starDelta > 20;
    const hasTopics = (repo.topics || []).length >= 3;

    if (isGrowing) {
      candidates.push({
        repo,
        reason: `Under-the-radar with ${stars} stars, gained ${delta.starDelta} since last snapshot`,
      });
    } else if (hasTopics) {
      candidates.push({
        repo,
        reason: `Under-the-radar with ${stars} stars and ${repo.topics.length} topics: ${repo.topics.slice(0, 5).join(", ")}`,
      });
    }
  }

  return candidates.slice(0, 2);
}

/**
 * Orchestrate editorial decisions.
 * @param {Array} allRepos - Raw GitHub repo objects
 * @param {Map} deltas - From computeDeltas
 * @returns {{ breakout: object|null, trends: Array, sleepers: Array, remaining: Array }}
 */
function makeEditorialPlan(allRepos, deltas) {
  const breakout = identifyBreakout(allRepos, deltas);
  const trends = clusterTrends(allRepos);
  const sleepers = identifySleepers(allRepos, deltas);

  // Build set of assigned repo names
  const assigned = new Set();
  if (breakout) {
    assigned.add(breakout.repo.full_name || breakout.repo.name);
  }
  for (const trend of trends) {
    for (const repo of trend.repos) {
      assigned.add(repo.full_name || repo.name);
    }
  }
  for (const sleeper of sleepers) {
    assigned.add(sleeper.repo.full_name || sleeper.repo.name);
  }

  const remaining = allRepos.filter((r) => !assigned.has(r.full_name || r.name));

  return { breakout, trends, sleepers, remaining };
}

module.exports = { identifyBreakout, clusterTrends, identifySleepers, makeEditorialPlan };
