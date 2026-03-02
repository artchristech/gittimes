const { graphqlRequest } = require("./github");

const pLimitP = import("p-limit");

/**
 * Single query per repo: gets createdAt, stargazerCount, first + last stargazers.
 * Uses aliases to fetch both endpoints of the timeline in one API call.
 */
const TRAJECTORY_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    createdAt
    stargazerCount
    earliest: stargazers(first: 1, orderBy: {field: STARRED_AT, direction: ASC}) {
      edges { starredAt }
    }
    latest: stargazers(last: 1, orderBy: {field: STARRED_AT, direction: ASC}) {
      edges { starredAt }
    }
  }
}`;

/**
 * Fetch star trajectory data for a single repo using one GraphQL call.
 * Returns creation date, total stars, first/last star dates, and derived growth pattern.
 * @param {string} fullName - "owner/repo"
 * @param {string} token - GitHub token
 * @returns {Promise<object|null>} Trajectory data
 */
async function fetchStarTrajectory(fullName, token) {
  const [owner, name] = fullName.split("/");
  if (!owner || !name) return null;

  try {
    const result = await graphqlRequest(TRAJECTORY_QUERY, { owner, name }, token);

    const repo = result.data?.repository;
    if (!repo) return null;

    const totalStars = repo.stargazerCount || 0;
    const createdAt = repo.createdAt;
    const earliestEdge = repo.earliest?.edges?.[0];
    const latestEdge = repo.latest?.edges?.[0];

    const milestones = [{ date: createdAt, approxStars: 0 }];

    if (earliestEdge) {
      milestones.push({ date: earliestEdge.starredAt, approxStars: 1 });
    }

    if (latestEdge && totalStars > 1) {
      milestones.push({ date: latestEdge.starredAt, approxStars: totalStars });
    }

    const pattern = classifyGrowthPattern(milestones, createdAt, totalStars);
    return {
      totalStars,
      createdAt,
      milestones,
      growthPattern: pattern,
      summary: formatTrajectoryForPrompt({ totalStars, createdAt, milestones, growthPattern: pattern }),
    };
  } catch (err) {
    console.warn(`Star trajectory fetch failed for ${fullName}: ${err.message}`);
    return null;
  }
}

/**
 * Classify the growth pattern based on timeline data.
 * Uses creation date, first/last star dates, total count, and age to determine pattern.
 * @param {Array} milestones - [{date, approxStars}]
 * @param {string} createdAt - ISO date string
 * @param {number} totalStars - Current star count
 * @returns {string} Growth pattern label
 */
function classifyGrowthPattern(milestones, createdAt, totalStars) {
  if (totalStars < 100) return "early-stage";

  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const totalAgeMs = now - created;
  const totalAgeDays = totalAgeMs / 86400000;

  if (totalAgeDays < 1) return "explosive";

  const velocity = totalStars / totalAgeDays;

  // Check recency of last star vs age
  const latestMilestone = milestones[milestones.length - 1];
  const latestStarDate = latestMilestone ? new Date(latestMilestone.date).getTime() : now;
  const daysSinceLastStar = (now - latestStarDate) / 86400000;

  // Check how quickly stars accumulate relative to age
  const firstStarMilestone = milestones.find((m) => m.approxStars >= 1);
  const firstStarDate = firstStarMilestone ? new Date(firstStarMilestone.date).getTime() : created;
  const activeSpanMs = latestStarDate - firstStarDate;
  const activeSpanDays = Math.max(activeSpanMs / 86400000, 1);
  const activeVelocity = totalStars / activeSpanDays;

  // Very high velocity in a short time
  if (totalAgeDays < 30 && totalStars > 500) return "explosive";
  if (activeVelocity > 100 && totalAgeDays < 90) return "explosive";

  // Recent surge: high velocity but repo is older
  if (velocity > 20 && totalAgeDays > 90) return "recent-surge";

  // Check if growth is concentrated: active span is small fraction of total age
  const activeRatio = activeSpanMs / totalAgeMs;
  if (activeRatio < 0.25 && totalStars > 500) return "recent-surge";

  // No recent activity
  if (daysSinceLastStar > 30) return "stagnant";

  // Steady vs slow-burn based on velocity
  if (velocity < 0.5) return "stagnant";
  if (velocity < 2) return "slow-burn";
  if (velocity < 20) return "steady";
  return "steady";
}

/**
 * Format trajectory data into a human-readable block for LLM prompts.
 * @param {object} trajectory - Output from fetchStarTrajectory
 * @returns {string} Formatted text block
 */
function formatTrajectoryForPrompt(trajectory) {
  if (!trajectory) return "";

  const { totalStars, createdAt, milestones, growthPattern } = trajectory;
  const created = new Date(createdAt);
  const createdStr = created.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const lines = [`STAR TRAJECTORY (verified from GitHub data):`];
  lines.push(`- Repository created: ${createdStr}`);

  // Add first star date if available
  const firstStar = milestones.find((m) => m.approxStars === 1);
  if (firstStar) {
    const firstDate = new Date(firstStar.date);
    const firstStr = firstDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (firstStr !== createdStr) {
      lines.push(`- First star: ${firstStr}`);
    }
  }

  // Add most recent star date
  const latestStar = milestones.find((m) => m.approxStars === totalStars);
  if (latestStar) {
    const latestDate = new Date(latestStar.date);
    const daysSinceLatest = Math.round((Date.now() - latestDate.getTime()) / 86400000);
    if (daysSinceLatest > 1) {
      const latestStr = latestDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      lines.push(`- Most recent star: ${latestStr} (${daysSinceLatest} days ago)`);
    } else {
      lines.push(`- Most recent star: today`);
    }
  }

  const now = new Date();
  const nowStr = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  lines.push(`- Current: ${totalStars.toLocaleString()} stars (as of ${nowStr})`);

  // Calculate age and velocity for summary
  const ageDays = Math.round((Date.now() - created.getTime()) / 86400000);
  const ageStr = ageDays < 30 ? `${ageDays} days` :
    ageDays < 365 ? `${Math.round(ageDays / 30)} months` :
    `${(ageDays / 365).toFixed(1)} years`;

  const avgPerDay = ageDays > 0 ? Math.round(totalStars / ageDays) : totalStars;
  if (avgPerDay > 0) {
    lines.push(`- Average: ~${avgPerDay.toLocaleString()} stars/day over ${ageStr}`);
  }

  const patternLabels = {
    "explosive": "Explosive viral growth",
    "recent-surge": "Recent surge in popularity",
    "steady": "Steady organic growth",
    "slow-burn": "Slow but consistent growth",
    "stagnant": "Minimal recent growth",
    "early-stage": "Early-stage project",
  };

  lines.push(`- Growth pattern: ${patternLabels[growthPattern] || growthPattern} over ${ageStr}`);
  return lines.join("\n");
}

/**
 * Batch-fetch trajectories for multiple repos with concurrency limiting and caching.
 * @param {Array} repos - Enriched repo objects with .name (full_name)
 * @param {string} token - GitHub token
 * @returns {Promise<Map<string, object>>} Map of fullName -> trajectory
 */
async function fetchTrajectories(repos, token) {
  const { default: pLimit } = await pLimitP;
  const limit = pLimit(5);
  const cache = new Map();

  const tasks = repos.map((repo) => {
    const fullName = repo.name || repo.full_name;
    if (!fullName) return Promise.resolve();
    if (cache.has(fullName)) return Promise.resolve();

    return limit(async () => {
      if (cache.has(fullName)) return;
      const trajectory = await fetchStarTrajectory(fullName, token);
      if (trajectory) {
        cache.set(fullName, trajectory);
        console.log(`  Star trajectory: ${fullName} — ${trajectory.totalStars.toLocaleString()} stars, ${trajectory.growthPattern}`);
      }
    });
  });

  await Promise.all(tasks);
  return cache;
}

module.exports = {
  fetchStarTrajectory,
  classifyGrowthPattern,
  formatTrajectoryForPrompt,
  fetchTrajectories,
};
