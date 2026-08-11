/**
 * The company registry — the entity layer the Business desks are views over.
 *
 * Every FLOW source the paper already runs (HF model drops, the GitHub releases
 * firehose, trending repos) emits ARTIFACTS: a model, a tag, a repo. None of them
 * emit an ACTOR. That's why coverage has no recurring characters — "deepseek-ai"
 * is a string that happens to reappear, not a thing the paper tracks.
 *
 * This module resolves those artifacts onto canonical company entities, rolls each
 * entity's activity up into stats, and derives its tier and badges. Big Labs,
 * Startups and Unicorns are then three SELECTIONS over one registry (see desks.js),
 * not three independent keyword queries — which is what makes badges, entity pages,
 * "what did they ship last quarter" in the AI Desk, and a structured agent API all
 * fall out of the same build instead of each needing their own.
 *
 * SOURCING DISCIPLINE (load-bearing — a business desk dies of one invented fact):
 *   - Every stat here is computed from a fetched record. Nothing is inferred.
 *   - Each event carries `evidence` naming its source and fetch time, so the
 *     renderer can print the receipt and a claim with no fetch behind it has
 *     nowhere to sit.
 *   - The registry NEVER models funding, valuation, headcount or revenue. There
 *     is no feed for them. `tier: "unicorn"` is a curated editorial label meaning
 *     "scaled private company", NOT a valuation assertion, and no code path turns
 *     it into a number.
 *
 * Pure and I/O-free so it's unit-testable; persistence lives in db.js.
 */

const { ageDays } = require("./recency");

// --- Tiers -----------------------------------------------------------------
//
// bigLab  — frontier model lab or hyperscaler AI org. Curated.
// unicorn — scaled private company. Curated, editorial, no valuation claimed.
// startup — small/young org. DERIVED from data (org age + team size + traction),
//           never curated, because "small and new" is the one stage the pipeline
//           can actually see.
const TIER_BIG_LAB = "bigLab";
const TIER_UNICORN = "unicorn";
const TIER_STARTUP = "startup";
const TIERS = [TIER_BIG_LAB, TIER_UNICORN, TIER_STARTUP];

/**
 * Curated roster. `github`/`hf` are the alias keys artifacts resolve through —
 * add an alias here and every past and future artifact from that org files under
 * the entity automatically.
 *
 * MAINTENANCE: this list is editorial. Tier is a human judgement about what kind
 * of company this is, reviewed by a human, and is deliberately NOT derived from
 * live data — deriving "unicorn" would mean asserting a valuation the paper
 * cannot source. Adding a company here is a coverage decision, not a fact claim.
 */
const SEED_ENTITIES = [
  // --- Frontier labs & hyperscaler AI orgs ---
  { id: "openai", name: "OpenAI", tier: TIER_BIG_LAB, country: "US", github: ["openai"], hf: ["openai"], domains: ["openai.com"] },
  { id: "anthropic", name: "Anthropic", tier: TIER_BIG_LAB, country: "US", github: ["anthropics"], hf: ["Anthropic"], domains: ["anthropic.com"] },
  { id: "google-deepmind", name: "Google DeepMind", tier: TIER_BIG_LAB, country: "US", github: ["google-deepmind", "google", "google-research"], hf: ["google"], domains: ["deepmind.google"] },
  { id: "meta-ai", name: "Meta AI", tier: TIER_BIG_LAB, country: "US", github: ["facebookresearch", "meta-llama", "pytorch"], hf: ["meta-llama", "facebook"], domains: ["ai.meta.com"] },
  { id: "microsoft", name: "Microsoft", tier: TIER_BIG_LAB, country: "US", github: ["microsoft"], hf: ["microsoft"], domains: ["microsoft.com"] },
  { id: "nvidia", name: "NVIDIA", tier: TIER_BIG_LAB, country: "US", github: ["NVIDIA", "NVIDIA-NeMo"], hf: ["nvidia"], domains: ["nvidia.com"] },
  { id: "mistral", name: "Mistral AI", tier: TIER_BIG_LAB, country: "FR", github: ["mistralai"], hf: ["mistralai"], domains: ["mistral.ai"] },
  { id: "deepseek", name: "DeepSeek", tier: TIER_BIG_LAB, country: "CN", github: ["deepseek-ai"], hf: ["deepseek-ai"], domains: ["deepseek.com"] },
  { id: "qwen", name: "Qwen", tier: TIER_BIG_LAB, country: "CN", github: ["QwenLM"], hf: ["Qwen"], domains: ["qwen.ai"] },
  { id: "xai", name: "xAI", tier: TIER_BIG_LAB, country: "US", github: ["xai-org"], hf: ["xai-org"], domains: ["x.ai"] },
  { id: "ai2", name: "Allen Institute for AI", tier: TIER_BIG_LAB, country: "US", github: ["allenai"], hf: ["allenai"], domains: ["allenai.org"] },
  { id: "cohere", name: "Cohere", tier: TIER_BIG_LAB, country: "CA", github: ["cohere-ai"], hf: ["CohereForAI", "CohereLabs"], domains: ["cohere.com"] },
  { id: "ai21", name: "AI21 Labs", tier: TIER_BIG_LAB, country: "IL", github: ["AI21Labs"], hf: ["ai21labs"], domains: ["ai21.com"] },
  { id: "moonshot", name: "Moonshot AI", tier: TIER_BIG_LAB, country: "CN", github: ["MoonshotAI"], hf: ["moonshotai"], domains: ["moonshot.cn"] },
  { id: "zhipu", name: "Z.ai / Zhipu", tier: TIER_BIG_LAB, country: "CN", github: ["THUDM", "zai-org"], hf: ["THUDM", "zai-org"], domains: ["z.ai"] },
  { id: "bytedance", name: "ByteDance", tier: TIER_BIG_LAB, country: "CN", github: ["bytedance"], hf: ["bytedance-research", "ByteDance"], domains: ["bytedance.com"] },
  { id: "tencent", name: "Tencent", tier: TIER_BIG_LAB, country: "CN", github: ["Tencent"], hf: ["tencent"], domains: ["tencent.com"] },
  { id: "alibaba", name: "Alibaba", tier: TIER_BIG_LAB, country: "CN", github: ["alibaba"], hf: ["Alibaba-NLP"], domains: ["alibaba.com"] },
  { id: "apple", name: "Apple", tier: TIER_BIG_LAB, country: "US", github: ["apple", "ml-explore"], hf: ["apple"], domains: ["apple.com"] },
  { id: "ibm", name: "IBM", tier: TIER_BIG_LAB, country: "US", github: ["ibm-granite", "IBM"], hf: ["ibm-granite"], domains: ["ibm.com"] },
  { id: "stability", name: "Stability AI", tier: TIER_BIG_LAB, country: "GB", github: ["Stability-AI"], hf: ["stabilityai"], domains: ["stability.ai"] },
  { id: "black-forest-labs", name: "Black Forest Labs", tier: TIER_BIG_LAB, country: "DE", github: ["black-forest-labs"], hf: ["black-forest-labs"], domains: ["blackforestlabs.ai"] },
  { id: "kyutai", name: "Kyutai", tier: TIER_BIG_LAB, country: "FR", github: ["kyutai-labs"], hf: ["kyutai"], domains: ["kyutai.org"] },
  { id: "internlm", name: "Shanghai AI Lab", tier: TIER_BIG_LAB, country: "CN", github: ["InternLM"], hf: ["internlm"], domains: ["shlab.org.cn"] },
  { id: "01ai", name: "01.AI", tier: TIER_BIG_LAB, country: "CN", github: ["01-ai"], hf: ["01-ai"], domains: ["01.ai"] },

  // --- Scaled private companies ("unicorn" tier = scaled + private, no number claimed) ---
  { id: "huggingface", name: "Hugging Face", tier: TIER_UNICORN, country: "US", github: ["huggingface"], hf: ["HuggingFaceTB", "HuggingFaceH4", "huggingface"], domains: ["huggingface.co"] },
  { id: "anysphere", name: "Anysphere (Cursor)", tier: TIER_UNICORN, country: "US", github: ["cursor", "getcursor"], hf: [], domains: ["cursor.com"] },
  { id: "perplexity", name: "Perplexity", tier: TIER_UNICORN, country: "US", github: ["perplexity-ai"], hf: ["perplexity-ai"], domains: ["perplexity.ai"] },
  { id: "vercel", name: "Vercel", tier: TIER_UNICORN, country: "US", github: ["vercel"], hf: [], domains: ["vercel.com"] },
  { id: "supabase", name: "Supabase", tier: TIER_UNICORN, country: "SG", github: ["supabase"], hf: [], domains: ["supabase.com"] },
  { id: "replit", name: "Replit", tier: TIER_UNICORN, country: "US", github: ["replit"], hf: ["replit"], domains: ["replit.com"] },
  { id: "elevenlabs", name: "ElevenLabs", tier: TIER_UNICORN, country: "US", github: ["elevenlabs"], hf: ["elevenlabs"], domains: ["elevenlabs.io"] },
  { id: "groq", name: "Groq", tier: TIER_UNICORN, country: "US", github: ["groq"], hf: ["Groq"], domains: ["groq.com"] },
  { id: "together", name: "Together AI", tier: TIER_UNICORN, country: "US", github: ["togethercomputer"], hf: ["togethercomputer"], domains: ["together.ai"] },
  { id: "databricks", name: "Databricks", tier: TIER_UNICORN, country: "US", github: ["databricks"], hf: ["databricks"], domains: ["databricks.com"] },
  { id: "langchain", name: "LangChain", tier: TIER_UNICORN, country: "US", github: ["langchain-ai"], hf: [], domains: ["langchain.com"] },
  { id: "ollama", name: "Ollama", tier: TIER_UNICORN, country: "US", github: ["ollama"], hf: [], domains: ["ollama.com"] },
  { id: "modal", name: "Modal", tier: TIER_UNICORN, country: "US", github: ["modal-labs"], hf: [], domains: ["modal.com"] },
  { id: "fireworks", name: "Fireworks AI", tier: TIER_UNICORN, country: "US", github: ["fw-ai"], hf: ["fireworks-ai"], domains: ["fireworks.ai"] },
];

// --- Identity --------------------------------------------------------------

/** Lowercase slug; the alias index is case-insensitive because org logins are. */
const norm = (s) => String(s || "").trim().toLowerCase();

/** `owner/repo` → `owner`; a bare org passes through unchanged. */
function ownerOf(ref) {
  const s = String(ref || "").trim();
  if (!s) return "";
  return s.includes("/") ? s.split("/")[0] : s;
}

/**
 * Build the alias → entityId lookup. Every github org, hf org and domain a
 * company publishes under collapses to one id, which is the whole point: a
 * Meta artifact lands under `meta-ai` whether it arrived as `facebookresearch`,
 * `meta-llama` or `pytorch`.
 * @param {Array} [entities=SEED_ENTITIES]
 * @returns {Map<string,string>}
 */
function buildAliasIndex(entities = SEED_ENTITIES) {
  const index = new Map();
  for (const e of entities) {
    if (!e || !e.id) continue;
    const put = (k) => {
      const key = norm(k);
      if (key && !index.has(key)) index.set(key, e.id);
    };
    put(e.id);
    put(e.name);
    for (const g of e.github || []) put(g);
    for (const h of e.hf || []) put(h);
    for (const d of e.domains || []) put(d);
  }
  return index;
}

/**
 * Resolve any artifact reference (repo full_name, HF model id, bare org) to a
 * seeded entity id, or null when the org isn't on the roster. A null here is
 * not a failure — it's how an unknown small team enters the registry as a
 * provisional entity, which is exactly how the Startups desk gets populated.
 * @param {string} ref
 * @param {Map<string,string>} index
 * @returns {string|null}
 */
function resolveEntityRef(ref, index) {
  if (!ref || !index) return null;
  const owner = norm(ownerOf(ref));
  if (!owner) return null;
  return index.get(owner) || null;
}

/** Provisional entity for an org with no roster entry. Tier is derived later. */
function provisionalEntity(owner, kind) {
  const login = String(owner);
  return {
    id: `org:${norm(login)}`,
    name: login,
    tier: null,
    curated: false,
    country: null,
    github: kind === "hf" ? [] : [login],
    hf: kind === "hf" ? [login] : [],
    domains: [],
  };
}

// --- Event harvest ---------------------------------------------------------

const EVENT_MODEL_DROP = "model-drop";
const EVENT_RELEASE = "release";
const EVENT_REPO = "repo";

/**
 * Turn the FLOW sources into entity-attributed events. Each event is a dated
 * thing a named company did, with a source receipt attached — the unit the
 * Business desks report and the entity timeline is built from.
 *
 * @param {object} sources
 * @param {Array} [sources.modelDrops] - selectModelDrops() output
 * @param {Array} [sources.releases]   - selectReleases() output
 * @param {Array} [sources.repos]      - raw GitHub repo records (rawCandidates)
 * @param {object} [opts] - { entities, nowMs, fetchedAt }
 * @returns {{ events: Array, entities: Map<string,object> }}
 */
function harvestEvents(sources = {}, opts = {}) {
  const {
    entities: seed = SEED_ENTITIES,
    nowMs = Date.now(),
    fetchedAt = new Date(nowMs).toISOString(),
  } = opts;

  const index = buildAliasIndex(seed);
  const byId = new Map(seed.filter((e) => e && e.id).map((e) => [e.id, { ...e, curated: true }]));
  const events = [];

  // An artifact from an unknown org creates that org as a provisional entity
  // rather than being dropped — the registry grows from the flow.
  const entityFor = (ref, kind) => {
    const owner = ownerOf(ref);
    if (!owner) return null;
    const id = resolveEntityRef(owner, index);
    if (id) return byId.get(id) || null;
    const prov = provisionalEntity(owner, kind);
    if (!byId.has(prov.id)) {
      byId.set(prov.id, prov);
      index.set(norm(owner), prov.id);
    }
    return byId.get(prov.id);
  };

  for (const d of sources.modelDrops || []) {
    if (!d || !d.id) continue;
    const entity = entityFor(d.author || d.id, "hf");
    if (!entity) continue;
    events.push({
      entityId: entity.id,
      type: EVENT_MODEL_DROP,
      title: d.name || d.id,
      url: d.url || `https://huggingface.co/${d.id}`,
      occurredAt: d.createdAt || null,
      ageDays: Number.isFinite(d.ageDays) ? d.ageDays : ageDays(d.createdAt, nowMs),
      metrics: { likes: d.likes || 0, downloads: d.downloads || 0, task: d.task || null },
      evidence: { source: "huggingface:/api/models", ref: d.id, fetchedAt },
    });
  }

  for (const r of sources.releases || []) {
    if (!r || !r.repo) continue;
    const entity = entityFor(r.repo, "github");
    if (!entity) continue;
    events.push({
      entityId: entity.id,
      type: EVENT_RELEASE,
      title: `${r.name || ownerOf(r.repo)} ${r.tag || ""}`.trim(),
      url: r.url || `https://github.com/${r.repo}`,
      occurredAt: r.publishedAt || null,
      ageDays: Number.isFinite(r.ageDays) ? r.ageDays : ageDays(r.publishedAt, nowMs),
      metrics: { reactions: r.reactions || 0, tag: r.tag || null, repo: r.repo },
      evidence: { source: "github:/repos/:repo/releases", ref: r.repo, fetchedAt },
    });
  }

  for (const repo of sources.repos || []) {
    const fullName = repo && (repo.full_name || repo.name);
    if (!fullName || !String(fullName).includes("/")) continue;
    const entity = entityFor(fullName, "github");
    if (!entity) continue;
    // Repo records are the only source carrying org-age and team-size signal,
    // which is what the derived `startup` tier is computed from.
    const created = repo.created_at || null;
    const orgAge = ageDays(created, nowMs);
    if (Number.isFinite(orgAge)) {
      entity.oldestRepoDays = Math.max(entity.oldestRepoDays || 0, Math.floor(orgAge));
    }
    events.push({
      entityId: entity.id,
      type: EVENT_REPO,
      title: fullName,
      url: repo.html_url || `https://github.com/${fullName}`,
      occurredAt: repo.pushed_at || null,
      ageDays: ageDays(repo.pushed_at, nowMs),
      metrics: {
        repo: fullName,
        stars: repo.stargazers_count || 0,
        starDelta: Number.isFinite(repo.starDelta) ? repo.starDelta : null,
        createdAt: created,
        language: repo.language || null,
      },
      evidence: { source: "github:/search/repositories", ref: fullName, fetchedAt },
    });
  }

  return { events, entities: byId };
}

// --- Roll-up ---------------------------------------------------------------

const within = (e, days) => Number.isFinite(e.ageDays) && e.ageDays <= days;

/**
 * Collapse an entity's events into the stats the desks rank on and the entity
 * page prints. Every field is a count or a date derived from fetched records.
 * @param {object} entity
 * @param {Array} events - this entity's events
 * @param {object} [opts] - { nowMs, history: { storyCount, firstSeen } }
 */
function rollUp(entity, events = [], opts = {}) {
  const { history = {} } = opts;
  const releases = events.filter((e) => e.type === EVENT_RELEASE);
  const drops = events.filter((e) => e.type === EVENT_MODEL_DROP);
  const repos = events.filter((e) => e.type === EVENT_REPO);

  const ages = events.map((e) => e.ageDays).filter(Number.isFinite);
  const lastActivityDays = ages.length ? Math.min(...ages) : null;

  const starDelta = repos.reduce(
    (sum, e) => sum + (Number.isFinite(e.metrics?.starDelta) ? e.metrics.starDelta : 0),
    0
  );

  return {
    entityId: entity.id,
    releases30d: releases.filter((e) => within(e, 30)).length,
    releases90d: releases.filter((e) => within(e, 90)).length,
    drops30d: drops.filter((e) => within(e, 30)).length,
    repoCount: new Set(repos.map((e) => e.metrics?.repo).filter(Boolean)).size,
    eventCount: events.length,
    lastActivityDays,
    starDelta7d: starDelta || null,
    oldestRepoDays: Number.isFinite(entity.oldestRepoDays) ? entity.oldestRepoDays : null,
    openWeights: drops.length > 0,
    // From the DB, not the wire: how long this paper has been covering them.
    storyCount: history.storyCount || 0,
    firstSeen: history.firstSeen || null,
  };
}

/**
 * Tier for an entity. Curated tiers win outright — a roster entry is a human
 * editorial decision and data never overrides it. Everything else falls to the
 * one stage the pipeline can actually observe: small and young and shipping.
 *
 * Deliberately returns null rather than guessing. An unresolved org is simply
 * not on a Business desk this edition; it is never promoted on a hunch.
 */
function classifyTier(entity, stats = {}, opts = {}) {
  if (entity && entity.tier) return entity.tier;
  const { maxOrgAgeDays = 730, minStarDelta = 150 } = opts;
  const age = stats.oldestRepoDays;
  if (!Number.isFinite(age) || age > maxOrgAgeDays) return null;
  const traction = (stats.starDelta7d || 0) >= minStarDelta || stats.releases30d > 0 || stats.drops30d > 0;
  return traction ? TIER_STARTUP : null;
}

/**
 * Badges — attributes an entity HAS, which is why stage can change without the
 * coverage being re-filed. The nav ships three desks now; badges are the layer
 * that makes a fourth cut (price leader, open weights, quiet) free later.
 */
function deriveBadges(entity, stats = {}) {
  const badges = [];
  const tier = entity.tier || stats.tier || null;
  if (tier === TIER_BIG_LAB) badges.push({ id: "big-lab", label: "Big Lab", tone: "solid" });
  if (tier === TIER_UNICORN) badges.push({ id: "scaled-private", label: "Scaled Private", tone: "solid" });
  if (tier === TIER_STARTUP) badges.push({ id: "startup", label: "Startup", tone: "solid" });
  if (Number.isFinite(stats.lastActivityDays) && stats.lastActivityDays <= 7) {
    badges.push({ id: "shipping", label: "Shipping", tone: "hot" });
  }
  if (Number.isFinite(stats.lastActivityDays) && stats.lastActivityDays >= 30) {
    badges.push({ id: "quiet", label: "Quiet", tone: "plain" });
  }
  if (stats.openWeights) badges.push({ id: "open-weights", label: "Open Weights", tone: "plain" });
  if (stats.releases30d >= 5) badges.push({ id: "high-cadence", label: "High Cadence", tone: "plain" });
  if (stats.storyCount >= 10) badges.push({ id: "regular", label: "Regular", tone: "plain" });
  return badges;
}

/**
 * Full registry build: harvest → roll up → classify → badge.
 *
 * @param {object} sources - { modelDrops, releases, repos }
 * @param {object} [opts]  - { entities, nowMs, history: Map<entityId,{storyCount,firstSeen}> }
 * @returns {{ entities: Array, events: Array, byId: Map }}
 */
function buildRegistry(sources = {}, opts = {}) {
  const { history = new Map(), nowMs = Date.now() } = opts;
  const { events, entities } = harvestEvents(sources, opts);

  const eventsByEntity = new Map();
  for (const e of events) {
    if (!eventsByEntity.has(e.entityId)) eventsByEntity.set(e.entityId, []);
    eventsByEntity.get(e.entityId).push(e);
  }

  const out = [];
  for (const [id, entity] of entities) {
    const own = eventsByEntity.get(id) || [];
    // Roster companies with no activity this window still belong in the registry
    // — "Mistral shipped nothing in six weeks" is the story on a shipped-vs-
    // announced desk, and you cannot report an absence you didn't track.
    if (own.length === 0 && !entity.curated) continue;
    const stats = rollUp(entity, own, { nowMs, history: history.get(id) || {} });
    const tier = classifyTier(entity, stats, opts);
    if (!tier) continue;
    const record = { ...entity, tier, stats, events: own.sort(byRecency) };
    record.badges = deriveBadges(record, { ...stats, tier });
    out.push(record);
  }

  out.sort(byActivity);
  return { entities: out, events, byId: entities };
}

const byRecency = (a, b) => {
  const ax = Number.isFinite(a.ageDays) ? a.ageDays : Infinity;
  const bx = Number.isFinite(b.ageDays) ? b.ageDays : Infinity;
  return ax - bx;
};

const byActivity = (a, b) => {
  const score = (x) => (x.stats.releases30d + x.stats.drops30d) * 10 + x.stats.eventCount;
  return score(b) - score(a);
};

module.exports = {
  SEED_ENTITIES,
  TIERS,
  TIER_BIG_LAB,
  TIER_UNICORN,
  TIER_STARTUP,
  EVENT_MODEL_DROP,
  EVENT_RELEASE,
  EVENT_REPO,
  buildAliasIndex,
  resolveEntityRef,
  harvestEvents,
  rollUp,
  classifyTier,
  deriveBadges,
  buildRegistry,
};
