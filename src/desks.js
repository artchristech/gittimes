/**
 * The Business desks — Big Labs, Startups, Unicorns.
 *
 * These are three SELECTIONS over the company registry (registry.js), not three
 * more entries in sections.js. That distinction is the design: sections.js is a
 * TOPIC axis (what the code does — AI, Robotics, Cyber…), and a company is an
 * ACTOR. Filing actors as more topics double-files every artifact (a DeepSeek
 * release is both "AI" and "Big Labs") and forecloses the badge layer, where
 * stage becomes something a company HAS rather than a section it lives in.
 *
 * Two rules the shapes below enforce, both from the failure modes this desk
 * invites:
 *
 *  1. CADENCE DIFFERS PER DESK. Big Labs has daily material; startups weekly;
 *     unicorn-tier movement monthly at best. A fixed per-section budget demands
 *     content on days when there isn't any, and the only way a generator can
 *     comply is to invent it — which on a business desk means inventing facts
 *     about real companies. So each desk declares `minItems: 0` where honest and
 *     returns `{ empty: true }` rather than padding.
 *
 *  2. NOTHING IS CLAIMED THAT WASN'T FETCHED. Every row carries the evidence
 *     from its underlying event. There is no funding, valuation, headcount or
 *     revenue field anywhere in this file, because no source in the pipeline
 *     emits one.
 *
 * Pure and I/O-free — feed it buildRegistry() output.
 */

const { TIER_BIG_LAB, TIER_UNICORN, TIER_STARTUP } = require("./registry");

const DESKS = {
  bigLabs: {
    id: "bigLabs",
    label: "Big Labs",
    slug: "big-labs",
    tier: TIER_BIG_LAB,
    kicker: "Who shipped, who went quiet",
    // The one desk with genuinely daily material, and the only one that reports
    // absence: a roster lab with nothing shipped is itself the story, so quiet
    // labs are KEPT rather than filtered out.
    cadence: "daily",
    minItems: 3,
    maxItems: 8,
    windowDays: 30,
    includeQuiet: true,
    // Quiet labs get RESERVED slots rather than competing on recency — ranked by
    // freshness they'd always lose to whoever shipped this morning, and the
    // ledger would silently become an activity leaderboard. "Mistral has shipped
    // nothing in six weeks" is the row that makes this a beat and not a feed.
    quietSlots: 2,
  },
  startups: {
    id: "startups",
    label: "Startups",
    slug: "startups",
    tier: TIER_STARTUP,
    kicker: "Small teams, first ships, real traction",
    cadence: "weekly",
    minItems: 0,
    maxItems: 3,
    windowDays: 21,
    includeQuiet: false,
  },
  unicorns: {
    id: "unicorns",
    label: "Unicorns",
    slug: "unicorns",
    tier: TIER_UNICORN,
    // "Scaled private company" is the whole claim. The paper has no valuation
    // source and this desk never prints a number.
    kicker: "Scaled, private, and shipping in public",
    cadence: "monthly",
    minItems: 0,
    maxItems: 4,
    windowDays: 30,
    includeQuiet: false,
  },
};

const DESK_ORDER = ["bigLabs", "startups", "unicorns"];

/** Freshest evidence-bearing event an entity has, or null. */
function leadEvent(entity) {
  return (entity.events || []).find((e) => Number.isFinite(e.ageDays)) || (entity.events || [])[0] || null;
}

/**
 * A Big Labs ledger row. The load-bearing column is `lastShippedDays` — the
 * paper's actual beat is cadence and silence, both of which are matters of
 * public record.
 *
 * NOTE (deliberate gap): a true "announced → shipped" column needs an
 * announcements feed — lab blogs / newsroom RSS — which the pipeline does not
 * have yet. Rather than approximate it from vibes, this reports only what the
 * push and release logs prove. Wire an announcements source and the column
 * becomes computable; until then it stays unbuilt rather than unsourced.
 */
function ledgerRow(entity) {
  const s = entity.stats;
  const ev = leadEvent(entity);
  // Silence only counts as silence where we watch a channel that would show
  // shipping. For a company we cannot see (no open weights, no watched repos)
  // an empty window is our blind spot, and calling it "quiet" would report a
  // measurement gap as a fact about the company.
  const observed = s.observed !== false;
  const quiet = observed && (!Number.isFinite(s.lastActivityDays) || s.lastActivityDays >= 30);
  return {
    entityId: entity.id,
    name: entity.name,
    country: entity.country || null,
    shipped: ev ? ev.title : null,
    shippedUrl: ev ? ev.url : null,
    shippedType: ev ? ev.type : null,
    releases30d: s.releases30d,
    drops30d: s.drops30d,
    lastShippedDays: s.lastActivityDays,
    openWeights: s.openWeights,
    storyCount: s.storyCount,
    badges: entity.badges || [],
    quiet,
    observed,
    signals: s.signals || [],
    evidence: ev ? ev.evidence : null,
  };
}

/** A Startups / Unicorns card. Same evidence contract, narrative shape. */
function card(entity) {
  const s = entity.stats;
  const ev = leadEvent(entity);
  return {
    entityId: entity.id,
    name: entity.name,
    headline: ev ? ev.title : null,
    url: ev ? ev.url : null,
    facts: [
      Number.isFinite(s.oldestRepoDays) ? { k: "org age", v: humanDays(s.oldestRepoDays) } : null,
      s.repoCount ? { k: "repos tracked", v: String(s.repoCount) } : null,
      Number.isFinite(s.starDelta7d) && s.starDelta7d ? { k: "stars 7d", v: `+${s.starDelta7d}` } : null,
      s.releases30d ? { k: "releases 30d", v: String(s.releases30d) } : null,
      Number.isFinite(s.lastActivityDays) ? { k: "last ship", v: humanDays(s.lastActivityDays) } : null,
    ].filter(Boolean),
    badges: entity.badges || [],
    // Printed verbatim under the card: what the pipeline saw, and where.
    evidence: ev ? ev.evidence : null,
    // Printed verbatim as the "not claimed" line. Naming the absence in the data
    // model (rather than in a prompt) is what keeps it out of the prose.
    notClaimed: ["valuation", "funding", "headcount", "revenue"],
  };
}

function humanDays(d) {
  if (!Number.isFinite(d)) return "—";
  if (d < 1) return "today";
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

/**
 * Build one desk from the registry.
 * @param {string} deskId
 * @param {Array} entities - buildRegistry().entities
 * @param {object} [opts] - { desks }
 * @returns {{id,label,slug,kicker,cadence,items,empty,reason}}
 */
function buildDesk(deskId, entities = [], opts = {}) {
  const spec = (opts.desks || DESKS)[deskId];
  if (!spec) throw new Error(`Unknown desk: ${deskId}`);

  const mine = entities.filter((e) => e.tier === spec.tier);
  const active = mine.filter(
    (e) => Number.isFinite(e.stats.lastActivityDays) && e.stats.lastActivityDays <= spec.windowDays
  );

  // Big Labs keeps quiet roster labs — silence is the story there. The other two
  // desks drop them, because "a startup we saw once did nothing" is not news.
  let ranked;
  if (spec.includeQuiet && spec.quietSlots) {
    // Only OBSERVED companies can hold a quiet slot. An unobserved company in
    // that slot would be the desk asserting inactivity it never measured.
    const quiet = mine
      .filter((e) => !active.includes(e) && e.stats.observed !== false)
      .sort(quietRank);
    const held = quiet.slice(0, spec.quietSlots);
    ranked = active
      .slice()
      .sort(deskRank)
      .slice(0, Math.max(0, spec.maxItems - held.length))
      .concat(held);
  } else {
    ranked = (spec.includeQuiet ? mine : active).slice().sort(deskRank).slice(0, spec.maxItems);
  }
  const shaped = spec.tier === TIER_BIG_LAB ? ranked.map(ledgerRow) : ranked.map(card);

  // The empty state is a feature. A desk below its floor runs dark and says so,
  // instead of asking the generator to fill the hole.
  const empty = active.length === 0 || shaped.length < spec.minItems;

  return {
    id: spec.id,
    label: spec.label,
    slug: spec.slug,
    kicker: spec.kicker,
    cadence: spec.cadence,
    items: empty && spec.minItems > 0 ? [] : shaped,
    empty,
    reason: empty ? `No ${spec.label.toLowerCase()} movement inside the ${spec.windowDays}d window.` : null,
    tracked: mine.length,
    // Rostered companies this desk cannot see. They are deliberately NOT ranked
    // into the rows — there is nothing to rank — but the reader has to be told
    // the coverage boundary exists, or the ledger's omissions read as absence
    // of activity. Rendered as a footnote, not as fake rows.
    unobserved: mine.filter((e) => e.stats.observed === false).map((e) => e.name),
  };
}

/**
 * Which silences are worth the slot: the ones from companies this paper covers
 * most, then the longest. A lab we've written about thirty times going dark is
 * news; one we've mentioned once is just a gap in our data.
 */
function quietRank(a, b) {
  const silence = (x) => (Number.isFinite(x.stats.lastActivityDays) ? x.stats.lastActivityDays : 0);
  return b.stats.storyCount - a.stats.storyCount || silence(b) - silence(a);
}

/** Most recently active first; volume breaks ties. */
function deskRank(a, b) {
  const recency = (x) => (Number.isFinite(x.stats.lastActivityDays) ? x.stats.lastActivityDays : 9999);
  const volume = (x) => x.stats.releases30d + x.stats.drops30d;
  return recency(a) - recency(b) || volume(b) - volume(a);
}

/**
 * All three desks.
 * @param {Array} entities - buildRegistry().entities
 */
function buildBusinessDesks(entities = [], opts = {}) {
  const out = {};
  for (const id of DESK_ORDER) out[id] = buildDesk(id, entities, opts);
  return out;
}

/**
 * The front-page Business strip — one line per desk. Cheap placement that
 * carries all three without making the actor axis compete with the topic
 * sections for slots, same shape that worked for the Model Drops band.
 * @param {object} desks - buildBusinessDesks() output
 */
function buildBusinessStrip(desks = {}, opts = {}) {
  // The Price Board leads the strip when it has a mover. A lab changing what it
  // charges is a harder, more decision-relevant fact than a repo getting tagged,
  // and unlike release cadence it is a number the reader can act on.
  const priceRow = opts.priceBoard
    ? [
        {
          deskId: "prices",
          label: "Price Board",
          slug: "prices",
          line: opts.priceHeadline || null,
          signal: (opts.priceBoard.movers || []).length > 0 ? "up" : "quiet",
          url: null,
        },
      ]
    : [];

  return priceRow.concat(DESK_ORDER.map((id) => {
    const desk = desks[id];
    if (!desk) return null;
    const top = desk.items[0];
    return {
      deskId: id,
      label: desk.label,
      slug: desk.slug,
      line: desk.empty ? desk.reason : stripLine(id, top),
      signal: desk.empty ? "quiet" : signalFor(id, desk),
      url: top ? top.url || top.shippedUrl || null : null,
    };
  })).filter(Boolean);
}

function stripLine(deskId, item) {
  if (!item) return null;
  if (deskId === "bigLabs") {
    if (item.shipped) return `${item.name} shipped ${item.shipped}`;
    return item.quiet
      ? `${item.name} has shipped nothing in ${humanDays(item.lastShippedDays)}`
      : `${item.name} ships outside the channels this desk watches`;
  }
  return item.headline ? `${item.name}: ${item.headline}` : item.name;
}

function signalFor(deskId, desk) {
  const shipping = desk.items.filter((i) => !i.quiet).length;
  if (deskId === "bigLabs") return shipping >= 3 ? "up" : "flat";
  return desk.items.length >= 2 ? "up" : "flat";
}

module.exports = {
  DESKS,
  DESK_ORDER,
  buildDesk,
  buildBusinessDesks,
  buildBusinessStrip,
  ledgerRow,
  card,
  humanDays,
};
