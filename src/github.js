const https = require("https");

const GITHUB_API = "https://api.github.com";

const pRetryP = import("p-retry");
const pLimitP = import("p-limit");

function _request(url, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        "User-Agent": "DAGitNews/1.0",
        Accept: "application/vnd.github+json",
      },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;

    https
      .get(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`GitHub API returned invalid JSON (status ${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      })
      .on("error", reject);
  });
}

async function request(url, token) {
  const { default: pRetry, AbortError } = await pRetryP;
  return pRetry(() => _request(url, token), {
    retries: 3,
    minTimeout: 1000,
    randomize: true,
    onFailedAttempt(info) {
      const msg = info.error?.message || String(info.error);
      console.warn(
        `GitHub request attempt ${info.attemptNumber} failed (${info.retriesLeft} left): ${msg}`
      );
      if (/GitHub API 4\d{2}:/.test(msg)) {
        throw new AbortError(msg);
      }
    },
  });
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

async function fetchOSSInsightTrending() {
  try {
    const data = await _request(
      "https://api.ossinsight.io/v1/trends/repos?period=past_week",
      null
    );
    const rows = data?.data?.rows || [];
    return rows.map((row) => ({
      full_name: row.repo_name,
      name: (row.repo_name || "").split("/").pop(),
      html_url: `https://github.com/${row.repo_name}`,
      stargazers_count: row.stars || 0,
      forks_count: row.forks || 0,
      language: row.primary_language || "Unknown",
      description: row.description || "",
      topics: [],
      created_at: new Date().toISOString(),
      pushed_at: new Date().toISOString(),
      _isOSSInsight: true,
    }));
  } catch (err) {
    console.warn(`OSSInsight fetch failed (non-fatal): ${err.message}`);
    return [];
  }
}

/**
 * Score a single repo with normalized signals.
 * @param {object} repo - Repository object
 * @param {object} [options] - { recentRepoNames?: Set<string>, now?: number }
 * @returns {number} Composite score
 */
function scoreRepo(repo, options = {}) {
  const now = options.now || Date.now();
  const recentRepoNames = options.recentRepoNames || new Set();

  // Star velocity: log-dampen, cap at 1.0
  const ageMs = now - new Date(repo.created_at).getTime();
  const ageDays = Math.max(ageMs / 86400000, 1);
  const rawVelocity = repo.stargazers_count / ageDays;
  const velocityScore = Math.min(Math.log1p(rawVelocity) / 5, 1.0);

  // Recency: linear decay over 7 days (0-1)
  const pushedMs = now - new Date(repo.pushed_at).getTime();
  const recencyScore = Math.max(0, 1 - pushedMs / (7 * 86400000));

  // Release bonus: linear decay over 30 days (1.0 → 0)
  let releaseScore = 0;
  if (repo._latestRelease) {
    const relDateStr = repo._latestRelease.published_at || repo._latestRelease.created_at;
    if (relDateStr) {
      const relAgeMs = now - new Date(relDateStr).getTime();
      const relAgeDays = relAgeMs / 86400000;
      releaseScore = Math.max(0, 1 - relAgeDays / 30);
    } else {
      releaseScore = 0.5; // release exists but no date — partial credit
    }
  }

  // Engagement ratio: (forks + issues) / stars, capped at 1
  const stars = repo.stargazers_count || 0;
  const forks = repo.forks_count || 0;
  const issues = repo.open_issues_count || 0;
  const engagementScore = stars > 0 ? Math.min((forks + issues * 0.3) / stars, 1) : 0;

  // OSSInsight repos have fabricated timestamps — zero out velocity & recency
  const effectiveVelocity = repo._isOSSInsight ? 0 : velocityScore;
  const effectiveRecency = repo._isOSSInsight ? 0 : recencyScore;

  // Weighted sum
  let score =
    effectiveVelocity * 0.35 +
    effectiveRecency * 0.25 +
    releaseScore * 0.15 +
    engagementScore * 0.10;

  // History penalty: -0.5 if repo appeared in recent editions
  if (recentRepoNames.has(repo.full_name)) {
    score -= 0.5;
  }

  return score;
}

/**
 * Parameterized categorization with topic diversity enforcement.
 * @param {Array} scoredRepos - Repos sorted by score descending
 * @param {{ secondary: number, quickHits: number }} budget - Slot counts
 * @returns {{ lead: object|null, secondary: Array, quickHits: Array }}
 */
function categorizeDiverseForSection(scoredRepos, budget) {
  if (!scoredRepos || scoredRepos.length === 0) {
    return { lead: null, secondary: [], quickHits: [] };
  }

  const totalPromoted = 1 + budget.secondary; // lead + secondary

  // Adaptive cap: fewer distinct languages → higher per-language cap
  const top15 = scoredRepos.slice(0, 15);
  const distinctLangs = new Set(top15.map((r) => r.language || "Unknown")).size;
  const maxPerLang = Math.max(2, Math.ceil(totalPromoted / distinctLangs));

  const promoted = [];
  const overflow = [];
  const langCount = {};

  for (const repo of scoredRepos) {
    const lang = repo.language || "Unknown";
    if (promoted.length < totalPromoted) {
      const count = langCount[lang] || 0;
      if (count < maxPerLang) {
        promoted.push(repo);
        langCount[lang] = count + 1;
      } else {
        overflow.push(repo);
      }
    } else {
      overflow.push(repo);
    }
  }

  // Backfill if diversity filter left fewer than needed
  if (promoted.length < totalPromoted) {
    for (const repo of overflow) {
      if (promoted.length >= totalPromoted) break;
      promoted.push(repo);
    }
    // Remove backfilled repos from overflow
    const promotedSet = new Set(promoted.map((r) => r.full_name));
    overflow.length = 0;
    for (const repo of scoredRepos) {
      if (!promotedSet.has(repo.full_name)) {
        overflow.push(repo);
      }
    }
  }

  const lead = promoted[0] || null;
  const secondary = promoted.slice(1);
  const quickHits = overflow.slice(0, budget.quickHits);

  return { lead, secondary, quickHits };
}

/**
 * Categorize scored repos with topic diversity enforcement.
 * Fills lead + secondary (7 slots) with max 2 per language.
 * Overflow goes to quickHits along with remaining repos.
 * @param {Array} scoredRepos - Repos sorted by score descending, each with _score and language
 * @returns {{ lead: object|null, secondary: Array, quickHits: Array }}
 */
function categorizeDiverse(scoredRepos) {
  return categorizeDiverseForSection(scoredRepos, { secondary: 6, quickHits: 10 });
}

async function fetchTrending(token, options = {}) {
  const recentRepoNames = options.recentRepoNames || new Set();
  const sevenDaysAgo = daysAgo(7);
  const threeDaysAgo = daysAgo(3);

  // Query A: New repos created in last 7 days with >50 stars
  const queryA = `created:>${sevenDaysAgo} stars:>50`;
  const urlA = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(queryA)}&sort=stars&order=desc&per_page=30`;

  // Query B: Established repos (>1000 stars) pushed in last 3 days
  const queryB = `stars:>1000 pushed:>${threeDaysAgo}`;
  const urlB = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(queryB)}&sort=updated&order=desc&per_page=30`;

  console.log("Fetching trending repos...");
  const [resultA, resultB, ossInsightRepos] = await Promise.all([
    request(urlA, token),
    request(urlB, token),
    fetchOSSInsightTrending(),
  ]);

  // Deduplicate by full_name
  const seen = new Set();
  const repos = [];
  for (const repo of [...resultA.items, ...resultB.items]) {
    if (!seen.has(repo.full_name)) {
      seen.add(repo.full_name);
      repos.push(repo);
    }
  }

  // Add OSSInsight repos not already in the list
  let ossAdded = 0;
  for (const repo of ossInsightRepos) {
    if (!seen.has(repo.full_name)) {
      seen.add(repo.full_name);
      repos.push(repo);
      ossAdded++;
    }
  }
  if (ossAdded > 0) {
    console.log(`Added ${ossAdded} repos from OSSInsight`);
  }

  console.log(`Found ${repos.length} unique repos`);

  // Score ALL repos (without release info first)
  const now = Date.now();
  const scoreOpts = { recentRepoNames, now };
  const preScored = repos.map((repo) => ({
    ...repo,
    _score: scoreRepo(repo, scoreOpts),
  }));
  preScored.sort((a, b) => b._score - a._score);

  // Fetch latest release for top 15 candidates (max 5 concurrent)
  const { default: pLimit } = await pLimitP;
  const ghLimit = pLimit(5);
  const top15 = preScored.slice(0, 15);
  const withReleases = await Promise.all(
    top15.map((repo) =>
      ghLimit(async () => {
        try {
          const release = await request(
            `${GITHUB_API}/repos/${repo.full_name}/releases/latest`,
            token
          );
          return { ...repo, _latestRelease: release };
        } catch {
          return { ...repo, _latestRelease: null };
        }
      })
    )
  );

  // Re-score top 15 with release bonus factored in
  const reScored = withReleases.map((repo) => ({
    ...repo,
    _score: scoreRepo(repo, scoreOpts),
  }));
  reScored.sort((a, b) => b._score - a._score);

  // Categorize with topic diversity
  return categorizeDiverse(reScored);
}

async function enrichRepo(repo, token) {
  const [readmeData, releaseData] = await Promise.all([
    request(
      `${GITHUB_API}/repos/${repo.full_name}/readme`,
      token
    ).catch(() => null),
    repo._latestRelease
      ? Promise.resolve(repo._latestRelease)
      : request(
          `${GITHUB_API}/repos/${repo.full_name}/releases/latest`,
          token
        ).catch(() => null),
  ]);

  let readmeExcerpt = "";
  if (readmeData && readmeData.content) {
    const decoded = Buffer.from(readmeData.content, "base64").toString("utf-8");
    readmeExcerpt = decoded.slice(0, 2000);
  }

  let releaseNotes = "";
  if (releaseData && releaseData.body) {
    releaseNotes = releaseData.body.slice(0, 1500);
  }

  return {
    name: repo.full_name,
    shortName: repo.name,
    description: repo.description || "",
    url: repo.html_url,
    stars: repo.stargazers_count,
    language: repo.language || "Unknown",
    topics: repo.topics || [],
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    readmeExcerpt,
    releaseNotes,
    releaseName: releaseData ? releaseData.tag_name || releaseData.name : null,
  };
}

function toQuickHit(repo) {
  return {
    name: repo.full_name,
    shortName: repo.name,
    description: repo.description || "",
    url: repo.html_url,
    stars: repo.stargazers_count,
    language: repo.language || "Unknown",
    topics: repo.topics || [],
  };
}

/**
 * Fetch repos matching a section's topic/language queries.
 * @param {string} token - GitHub token
 * @param {object} sectionConfig - Section config with query.topics and query.languages
 * @param {object} [options] - { recentRepoNames?: Set }
 * @returns {Promise<Array>} Flat array of repos, deduplicated by full_name
 */
async function fetchSectionRepos(token, sectionConfig, options = {}) {
  const { default: pLimit } = await pLimitP;
  const ghLimit = pLimit(3);
  const threeDaysAgo = daysAgo(3);

  const queries = [];

  // Top 3 topics
  const topics = (sectionConfig.query.topics || []).slice(0, 3);
  for (const t of topics) {
    const q = `topic:${t} stars:>30 pushed:>${threeDaysAgo}`;
    const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=15`;
    queries.push(ghLimit(() => request(url, token).catch(() => ({ items: [] }))));
  }

  // All languages
  for (const lang of sectionConfig.query.languages || []) {
    const q = `language:"${lang}" stars:>100 pushed:>${threeDaysAgo}`;
    const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=15`;
    queries.push(ghLimit(() => request(url, token).catch(() => ({ items: [] }))));
  }

  const results = await Promise.all(queries);

  // Deduplicate by full_name
  const seen = new Set();
  const repos = [];
  for (const result of results) {
    for (const repo of result.items || []) {
      if (!seen.has(repo.full_name)) {
        seen.add(repo.full_name);
        repos.push(repo);
      }
    }
  }

  return repos;
}

/**
 * Fetch, score, categorize, and enrich repos for a single topic section.
 * @param {string} token - GitHub token
 * @param {object} sectionConfig - Section config
 * @param {object} [options] - { globalSeen?: Set, recentRepoNames?: Set }
 * @returns {Promise<{ lead, secondary, quickHits }>}
 */
async function fetchAndEnrichSection(token, sectionConfig, options = {}) {
  const globalSeen = options.globalSeen || new Set();
  const recentRepoNames = options.recentRepoNames || new Set();

  const repos = await fetchSectionRepos(token, sectionConfig, options);

  // Filter out repos already claimed by other sections
  const filtered = repos.filter((r) => !globalSeen.has(r.full_name));

  if (filtered.length === 0) {
    return { lead: null, secondary: [], quickHits: [] };
  }

  // Score
  const now = Date.now();
  const scoreOpts = { recentRepoNames, now };
  const scored = filtered.map((repo) => ({
    ...repo,
    _score: scoreRepo(repo, scoreOpts),
  }));
  scored.sort((a, b) => b._score - a._score);

  // Categorize with section budget
  const { lead, secondary, quickHits } = categorizeDiverseForSection(scored, sectionConfig.budget);

  // Only mark lead + secondary as claimed to prevent duplicate headlines,
  // while allowing quickHit-level repos to appear across sections.
  const claimed = [lead, ...secondary].filter(Boolean);
  for (const repo of claimed) {
    globalSeen.add(repo.full_name);
  }

  if (!lead) {
    return { lead: null, secondary: [], quickHits: quickHits.map(toQuickHit) };
  }

  console.log(`  [${sectionConfig.label}] Lead: ${lead.full_name}, Secondary: ${secondary.length}, Quick hits: ${quickHits.length}`);

  // Enrich lead + secondary
  const { default: pLimit } = await pLimitP;
  const enrichLimit = pLimit(5);
  const enriched = await Promise.all(
    [lead, ...secondary].map((r) => enrichLimit(() => enrichRepo(r, token)))
  );

  return {
    lead: enriched[0],
    secondary: enriched.slice(1),
    quickHits: quickHits.map(toQuickHit),
  };
}

/**
 * Fetch all sections: Front Page first (via existing fetchAndEnrich), then topic sections.
 * @param {string} token - GitHub token
 * @param {object} [options] - { recentRepoNames?: Set }
 * @returns {Promise<object>} { frontPage: {...}, ai: {...}, ... }
 */
async function fetchAllSections(token, options = {}) {
  const { SECTIONS, SECTION_ORDER } = require("./sections");
  const recentRepoNames = options.recentRepoNames || new Set();

  // Front Page first — uses existing fetchAndEnrich (unchanged behavior)
  console.log("Fetching Front Page...");
  const frontPageData = await fetchAndEnrich(token, { recentRepoNames });

  // Build globalSeen from Front Page lead + secondary only (not quickHits).
  // Only lead repos are hard-excluded to prevent duplicate headlines;
  // secondary/quickHit overlap across sections is acceptable to avoid
  // leaving topic sections completely empty.
  const globalSeen = new Set();
  if (frontPageData.lead) globalSeen.add(frontPageData.lead.name);
  for (const r of frontPageData.secondary) globalSeen.add(r.name);

  const sections = { frontPage: frontPageData };

  // Process remaining sections sequentially
  for (const id of SECTION_ORDER) {
    if (id === "frontPage") continue;
    const config = SECTIONS[id];
    if (!config || !config.query) continue;
    console.log(`Fetching section: ${config.label}...`);
    sections[id] = await fetchAndEnrichSection(token, config, { globalSeen, recentRepoNames });
  }

  return sections;
}

async function fetchAndEnrich(token, options = {}) {
  const { lead, secondary, quickHits } = await fetchTrending(token, options);

  if (!lead) throw new Error("No repos found — check your GitHub token and network.");

  console.log(`Lead: ${lead.full_name}`);
  console.log(`Secondary: ${secondary.map((r) => r.full_name).join(", ")}`);
  console.log(`Quick hits: ${quickHits.length} repos`);

  // Enrich lead + secondary in parallel (max 5 concurrent)
  const { default: pLimit } = await pLimitP;
  const enrichLimit = pLimit(5);
  console.log("Enriching repos...");
  const enriched = await Promise.all(
    [lead, ...secondary].map((r) => enrichLimit(() => enrichRepo(r, token)))
  );

  const enrichedLead = enriched[0];
  const enrichedSecondary = enriched.slice(1);
  const quickHitsList = quickHits.map(toQuickHit);

  return {
    lead: enrichedLead,
    secondary: enrichedSecondary,
    quickHits: quickHitsList,
  };
}

module.exports = { fetchAndEnrich, fetchAllSections, fetchSectionRepos, fetchAndEnrichSection, daysAgo, scoreRepo, categorizeDiverse, categorizeDiverseForSection };
