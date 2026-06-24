/**
 * Editorial brain: breakout detection, trend clustering, sleeper identification.
 */

const { leadEligible } = require("./recency");

const TRAJECTORY_MULTIPLIERS = {
  "stagnant":     1.5,  // dormant project spiking = something big happened
  "slow-burn":    1.3,  // normally 1-2 stars/day, now surging
  "steady":       1.2,  // consistent project with unexpected spike
  "recent-surge": 1.0,  // already surging, delta is expected
  "explosive":    0.85, // common on trending, often ephemeral
  "early-stage":  0.7,  // <100 stars, limited signal
};

const THEME_KEYWORDS = {
  "ai-agents": ["agent", "ai-agent", "autonomous", "autogen", "crew", "langchain", "langgraph", "agentic", "multi-agent", "tool-use"],
  "mcp": ["mcp", "model-context-protocol", "mcp-server"],
  "llm-tools": ["llm", "gpt", "openai", "anthropic", "claude", "gemini", "ollama", "transformer", "prompt", "chatbot"],
  "rag-search": ["rag", "retrieval", "vector-search", "semantic-search", "reranker", "knowledge-base", "embedding", "vector-db"],
  "inference": ["inference", "quantization", "quantized", "gguf", "vllm", "serving", "kv-cache", "throughput"],
  "local-ai": ["local-llm", "on-device", "offline-ai", "edge-ai", "local-first"],
  "model-training": ["fine-tune", "fine-tuning", "lora", "rlhf", "pretrain", "distillation"],
  "evals": ["eval", "evals", "benchmark", "leaderboard", "red-team", "guardrail"],
  "rust-systems": ["rust", "memory-safe", "wasm", "tokio", "async-runtime"],
  "dev-tools": ["cli", "devtool", "linter", "formatter", "bundler", "build-tool", "vscode", "neovim", "ide", "terminal", "developer-tools"],
  "self-hosted": ["self-hosted", "selfhosted", "homelab", "home-automation", "docker", "kubernetes", "k8s"],
  "security-tools": ["security", "cybersecurity", "pentest", "vulnerability", "exploit", "encryption", "auth"],
  "web-frameworks": ["web", "react", "vue", "svelte", "nextjs", "frontend", "backend", "api", "rest", "graphql", "http"],
  "data-infra": ["database", "data", "analytics", "etl", "streaming", "kafka", "postgres", "redis"],
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

// Cache one word-boundary regex per keyword. Substring matching (the old
// `text.includes(kw)`) produced false themes — "storage" matched "rag",
// "video" matched "ide", "rapid" matched "api". A boundary that treats
// hyphens as separators keeps "ai-agent" matching "agent" while rejecting
// those accidental substrings.
const _kwRegexCache = new Map();
function _keywordMatches(text, kw) {
  let re = _kwRegexCache.get(kw);
  if (!re) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i");
    _kwRegexCache.set(kw, re);
  }
  return re.test(text);
}

/**
 * Find the repo with the highest breakout score.
 * Score = absoluteGain * (1 + min(relativeGain, 10))
 * Minimum threshold: 100 stars gained.
 * @param {Array} repos - Raw GitHub repo objects
 * @param {Map} deltas - From computeDeltas
 * @returns {{ repo: object, delta: object, reason: string } | null}
 */
const NON_LATIN_RE = /[\u3000-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0980-\u09FF]/g;
function _hasNonEnglishContent(repo) {
  const text = `${repo.name || ""} ${repo.description || ""}`;
  const matches = text.match(NON_LATIN_RE);
  return matches !== null && matches.length > text.length * 0.15;
}

/**
 * Rank breakout candidates by star-momentum score. This is the FILTER step —
 * it shortlists who is moving — not the editorial decision of what leads. The
 * editor-in-chief (an LLM) chooses the lead from this shortlist on significance.
 * @returns {Array<{ repo, delta, reason, score }>} sorted best-first
 */
function rankBreakoutCandidates(repos, deltas, limit = 6) {
  if (!deltas || deltas.size === 0) return [];

  const scored = [];
  for (const repo of repos) {
    const delta = deltas.get(repo.full_name);
    if (!delta || delta.starDelta === null || delta.starDelta < 100) continue;
    // Skip non-English repos from breakout lead — audience is English-speaking
    if (_hasNonEnglishContent(repo)) continue;

    const absoluteGain = delta.starDelta;
    const relativeGain = delta.previousStars > 0 ? absoluteGain / delta.previousStars : 10;
    const baseScore = absoluteGain * (1 + Math.min(relativeGain, 10));
    const pattern = repo.starTrajectory?.growthPattern;
    const trajectoryMultiplier = (pattern && TRAJECTORY_MULTIPLIERS[pattern]) || 1.0;
    const score = baseScore * trajectoryMultiplier;

    let reason = `Gained ${absoluteGain.toLocaleString()} stars (${delta.previousStars ? Math.round(relativeGain * 100) + "%" : "new"} growth) in ${delta.daysSinceSnapshot} day(s)`;
    if (trajectoryMultiplier !== 1.0) {
      reason += ` [trajectory: ${pattern}, ${trajectoryMultiplier}x]`;
    }

    scored.push({ repo, delta, reason, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function identifyBreakout(repos, deltas) {
  const ranked = rankBreakoutCandidates(repos, deltas, 1);
  if (ranked.length === 0) return null;
  const { repo, delta, reason } = ranked[0];
  return { repo, delta, reason };
}

/**
 * The editor-in-chief's candidate slate. The +100-star breakout bar usually
 * yields a single qualifier, which starves the editor (one candidate = no real
 * choice = de-facto star velocity). This guarantees a real slate: start with the
 * breakouts, then backfill with lower movers, then with the highest-star recent
 * repos — so the editor always has something to weigh on significance.
 * @returns {Array<{repo, delta, reason, score}>}
 */
function selectLeadCandidates(repos, deltas, opts = {}) {
  const { min = 4, max = 6, now = Date.now() } = opts;
  const out = rankBreakoutCandidates(repos, deltas, max);
  const have = new Set(out.map((c) => c.repo.full_name || c.repo.name));

  const add = (repo, reason, score) => {
    const id = repo.full_name || repo.name;
    if (have.has(id) || _hasNonEnglishContent(repo)) return;
    have.add(id);
    out.push({ repo, delta: (deltas && deltas.get(repo.full_name)) || null, reason, score });
  };

  // Tier 2: any positive mover below the +100 bar, by gain.
  if (out.length < min && deltas) {
    const movers = [];
    for (const repo of repos) {
      const d = deltas.get(repo.full_name);
      if (d && d.starDelta != null && d.starDelta > 0 && d.starDelta < 100) {
        movers.push({ repo, gain: d.starDelta });
      }
    }
    movers.sort((a, b) => b.gain - a.gain);
    for (const m of movers) {
      if (out.length >= min) break;
      add(m.repo, `Gained ${m.gain} stars recently`, m.gain);
    }
  }

  // Tier 3: highest-star recent repos with no usable delta — significance, not momentum.
  if (out.length < min) {
    const byStars = repos
      .filter((r) => (r.stargazers_count || 0) > 0)
      .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
    for (const repo of byStars) {
      if (out.length >= min) break;
      add(repo, `Notable project (${(repo.stargazers_count || 0).toLocaleString()} stars)`, 0);
    }
  }

  // RECENCY GATE (lead bar): the front-page lead must have a genuine recent hook
  // — a release within the lead window, or a brand-new repo — not push activity
  // alone. Filter the slate to lead-eligible candidates so a years-old-but-
  // recently-pushed repo can never headline. Fall back to the full slate only if
  // NONE qualify, so an edition always has a lead.
  const eligible = out.filter((c) => leadEligible(c.repo, now));
  const slate = eligible.length > 0 ? eligible : out;
  return slate.slice(0, max);
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
      const matches = keywords.some((kw) => _keywordMatches(text, kw));
      if (matches) {
        if (!clusters[theme]) clusters[theme] = [];
        // Avoid duplicates within a cluster
        if (!clusters[theme].some((r) => (r.full_name || r.name) === (repo.full_name || repo.name))) {
          clusters[theme].push(repo);
        }
      }
    }
  }

  // Filter to clusters with 2+ repos, sort by size descending.
  const sorted = Object.entries(clusters)
    .filter(([, repos]) => repos.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  // Diversity cap: pick up to 3 trends, but skip a cluster that mostly repeats
  // repos already covered by a chosen trend. Without this, ai-agents/llm-tools/
  // dev-tools all match the same agent repos and the edition runs "agents" three
  // times. A new trend must bring a majority of fresh repos.
  const selected = [];
  const usedRepos = new Set();
  for (const [theme, repos] of sorted) {
    const names = repos.map((r) => r.full_name || r.name);
    const overlap = names.filter((n) => usedRepos.has(n)).length;
    if (selected.length > 0 && overlap > repos.length * 0.5) continue;
    selected.push({ theme, repos });
    names.forEach((n) => usedRepos.add(n));
    if (selected.length >= 3) break;
  }
  return selected;
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

// Detect a release whose only "news" is a patch bump with no material change.
// A point release like v3.16.3 with thin/boilerplate notes is churn, not a
// story — it should be demoted to Quick Hits rather than inflated into a
// headline. A repo with no semver release, an x.y.0 minor/major, or notes that
// describe real change (new features, breaking changes, adoption) is NOT churn.
const MATERIAL_CHANGE_RE = /\b(add(ed|s)?|new|introduc\w*|support|breaking|launch\w*|redesign\w*|rewr\w*|rework\w*|major|migrat\w*|deprecat\w*|remove[ds]?|first release|initial release|now\s+\w+|overhaul\w*|revamp\w*)\b/i;

function isVersionChurn(repo) {
  if (!repo) return false;
  const name = repo.releaseName || "";
  const m = name.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false; // no semver release tag → not a churn case
  const patch = parseInt(m[3], 10);
  if (patch === 0) return false; // x.y.0 = minor/major bump, material enough
  const notes = (repo.releaseNotes || "").trim();
  if (MATERIAL_CHANGE_RE.test(notes)) return false; // notes describe real change
  // Patch release with thin, non-material notes → version churn.
  return notes.length < 240;
}

/**
 * Orchestrate editorial decisions.
 * @param {Array} allRepos - Raw GitHub repo objects
 * @param {Map} deltas - From computeDeltas
 * @returns {{ breakout: object|null, trends: Array, sleepers: Array, remaining: Array }}
 */
function makeEditorialPlan(allRepos, deltas) {
  // Breakout (the >=100 headline signal) stays strict; the editor's slate is broadened.
  const strictBreakouts = rankBreakoutCandidates(allRepos, deltas, 6);
  const breakout = strictBreakouts.length > 0
    ? { repo: strictBreakouts[0].repo, delta: strictBreakouts[0].delta, reason: strictBreakouts[0].reason }
    : null;
  const breakoutCandidates = selectLeadCandidates(allRepos, deltas, { min: 4, max: 6 });
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

  return { breakout, breakoutCandidates, trends, sleepers, remaining };
}

module.exports = { identifyBreakout, rankBreakoutCandidates, selectLeadCandidates, clusterTrends, identifySleepers, makeEditorialPlan, isVersionChurn, TRAJECTORY_MULTIPLIERS };
