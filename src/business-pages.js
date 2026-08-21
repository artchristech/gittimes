/**
 * The Business desk pages and company files.
 *
 * The strip on the front page is the trailer; these are the pages. Three desk
 * pages (Big Labs / Startups / Unicorns), a browsable company index, and one
 * permanent file per company.
 *
 * WHY THE ENTITY PAGE IS THE POINT. A desk page is a snapshot — it answers "who
 * shipped this week". The company file is the thing the paper did not previously
 * have at all: a durable address for a recurring character, accumulating across
 * editions. It's what makes "what did DeepSeek ship this quarter" answerable, it
 * is the surface the archive and the AI Desk's corpus actually pay off on, and
 * it's the structured object an agent-facing API can sell. Desk pages are views
 * of today; company files are the record.
 *
 * TWO SOURCING RULES, both enforced here rather than trusted to prose:
 *   1. Every claim renders from a fetched record and prints its receipt. There is
 *      no funding / valuation / headcount / revenue anywhere on these pages, and
 *      the company file states that absence explicitly rather than letting a
 *      reader assume the omission is an oversight.
 *   2. No LLM writes on these pages. Every line is composed deterministically
 *      from counts and dates. A generated business essay is exactly where an
 *      invented number would enter, and that is the one error a business desk
 *      does not survive. (A gated, evidence-bound desk column is a later call.)
 *
 * I/O lives in `writeBusinessPages`; every renderer above it is pure.
 */

const fs = require("fs");
const path = require("path");

const { escapeHtml } = require("./render");
const { applyTemplate } = require("./template-utils");
const { DESK_ORDER, DESKS, humanDays } = require("./desks");
const { TIER_BIG_LAB, TIER_STARTUP, TIER_UNICORN } = require("./registry");

// A provisional org earns a permanent page only once it has RECURRED. One
// appearance is a mention; a file implies the paper is following someone. Also
// keeps a page-per-org from exploding across the site over months.
const PROVISIONAL_MIN_EVENTS = 2;
// Backstop on a single run's page count. Purely defensive.
const MAX_ENTITY_PAGES = 400;

const TIER_LABEL = {
  [TIER_BIG_LAB]: "Big Lab",
  [TIER_UNICORN]: "Scaled Private",
  [TIER_STARTUP]: "Startup",
};
const TIER_DESK = {
  [TIER_BIG_LAB]: "big-labs",
  [TIER_UNICORN]: "unicorns",
  [TIER_STARTUP]: "startups",
};
const EVENT_LABEL = {
  "model-drop": "Model drop",
  release: "Release",
  repo: "Repo activity",
};

// --- URLs ------------------------------------------------------------------

/**
 * Permanent slug for a company. Curated ids are already clean; provisional ids
 * arrive as `org:<login>`. Stability matters more than prettiness here — this is
 * the address of a recurring character, and it must not move once published.
 */
function entitySlug(id) {
  return String(id || "")
    .replace(/^org:/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unknown";
}

const entityPath = (basePath, id) => `${basePath}/companies/${entitySlug(id)}/`;
const deskPath = (basePath, slug) => `${basePath}/${slug}/`;

/**
 * Slug → entity, with collisions resolved deterministically (first by id sort)
 * so a rebuild never silently reassigns a URL to a different company.
 */
function assignSlugs(entities) {
  const taken = new Map();
  const out = new Map();
  for (const e of [...entities].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    let slug = entitySlug(e.id);
    if (taken.has(slug)) {
      let n = 2;
      while (taken.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    taken.set(slug, e.id);
    out.set(e.id, slug);
  }
  return out;
}

// --- Shared fragments ------------------------------------------------------

function badgeHtml(badges) {
  if (!Array.isArray(badges) || badges.length === 0) return "";
  return `<span class="ent-badges">${badges
    .map(
      (b) =>
        `<span class="ent-badge ent-badge-${escapeHtml(b.tone || "plain")}">${escapeHtml(b.label)}</span>`
    )
    .join("")}</span>`;
}

/**
 * The receipt. Rendering the source inline is what keeps an unsourced claim from
 * having anywhere to sit — a row with no evidence renders visibly bare rather
 * than looking identical to a sourced one.
 *
 * Only ever called where a CLAIM is made. A lab that shipped nothing has no
 * receipt because there is nothing to receipt, and marking that row "no source"
 * would report an absence of activity as an absence of sourcing.
 */
function evidenceHtml(evidence) {
  if (!evidence || !evidence.source) {
    return `<span class="ent-evidence ent-evidence-none">no source on file</span>`;
  }
  const ref = evidence.ref ? ` &middot; ${escapeHtml(evidence.ref)}` : "";
  const when = evidence.fetchedAt ? ` &middot; fetched ${escapeHtml(String(evidence.fetchedAt).slice(0, 10))}` : "";
  return `<span class="ent-evidence">${escapeHtml(evidence.source)}${ref}${when}</span>`;
}

const NOT_CLAIMED = "valuation, funding, headcount, revenue";

function notClaimedHtml() {
  return `<p class="ent-notclaimed"><span class="ent-notclaimed-k">Not claimed</span> ${NOT_CLAIMED} &mdash; The Git Times has no source for them and does not infer them.</p>`;
}

function page(name, basePath, fields) {
  return applyTemplate(name, basePath)
    .replace(/\{\{PAGE_TITLE\}\}/g, escapeHtml(fields.title))
    .replace(/\{\{PAGE_DESC\}\}/g, escapeHtml(fields.desc))
    .replace(/\{\{PAGE_KICKER\}\}/g, escapeHtml(fields.kicker))
    .replace(/\{\{PAGE_HEADLINE\}\}/g, escapeHtml(fields.headline))
    .replace(/\{\{PAGE_DECK\}\}/g, escapeHtml(fields.deck))
    .replace("{{PAGE_BODY}}", fields.body);
}

// --- Desk pages ------------------------------------------------------------

/**
 * A deck composed from counts, not prose. Says what the desk is looking at and
 * — load-bearing — how much of it is silent, so a quiet week reads as a finding
 * rather than a thin page.
 */
function deskDeck(desk) {
  const shipped = desk.items.filter((i) => i.shipped || (!i.quiet && i.observed !== false)).length;
  const quiet = desk.items.filter((i) => i.quiet).length;
  const unobserved = desk.items.filter((i) => i.observed === false).length;
  const spec = DESKS[desk.id] || {};
  const parts = [`${desk.tracked} tracked`];
  if (shipped) parts.push(`${shipped} shipped in the last ${spec.windowDays || 30} days`);
  if (quiet) parts.push(`${quiet} quiet`);
  if (unobserved) parts.push(`${unobserved} not covered by these signals`);
  return `${parts.join(" &middot; ")}. Every figure below comes from a fetched record; nothing here is inferred.`;
}

/** Big Labs — the ledger. Cadence and silence, both matters of public record. */
function renderLedger(desk, basePath) {
  const rows = desk.items
    .map((row) => {
      // Three distinct states, and conflating the last two is the bug this
      // column exists to avoid: shipped / measured-and-silent / not measurable.
      const shipped = row.shipped
        ? `<a href="${escapeHtml(row.shippedUrl || "#")}" target="_blank" rel="noopener">${escapeHtml(row.shipped)}</a>`
        : row.observed === false
          ? `<span class="ledger-unobserved">not covered &mdash; ships outside open weights and watched repos</span>`
          : `<span class="ledger-quiet">nothing shipped in this window</span>`;
      return `
      <tr${row.quiet ? ' class="ledger-row-quiet"' : row.observed === false ? ' class="ledger-row-unobserved"' : ""}>
        <th scope="row" class="ledger-org">
          <a href="${escapeHtml(entityPath(basePath, row.entityId))}">${escapeHtml(row.name)}</a>
          ${row.country ? `<small>${escapeHtml(row.country)}</small>` : ""}
        </th>
        <td class="ledger-ship">${shipped}${row.shipped ? `<br>${evidenceHtml(row.evidence)}` : ""}</td>
        <td class="ledger-num">${row.releases30d || 0}</td>
        <td class="ledger-num">${row.drops30d || 0}</td>
        <td class="ledger-num">${escapeHtml(humanDays(row.lastShippedDays))}</td>
      </tr>`;
    })
    .join("");
  return `
    <table class="ledger-table">
      <caption class="ledger-caption">Shipping cadence over the last 30 days, measured from open weights and watched public repos. Labs that ship products rather than weights are marked <em>not covered</em> &mdash; this desk does not mistake its own blind spot for their silence.</caption>
      <thead>
        <tr>
          <th scope="col">Lab</th>
          <th scope="col">Most recent ship</th>
          <th scope="col" class="ledger-num">Releases</th>
          <th scope="col" class="ledger-num">Drops</th>
          <th scope="col" class="ledger-num">Last ship</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>${unobservedNote(desk)}`;
}

/**
 * The coverage boundary, stated. Without this the ledger's omissions read as
 * absence of activity — a reader who doesn't see OpenAI concludes OpenAI did
 * nothing, which is the same error as printing "quiet" next to their name.
 */
function unobservedNote(desk) {
  const names = desk.unobserved || [];
  if (names.length === 0) return "";
  return `<p class="ledger-note"><span class="ent-notclaimed-k">Not covered</span> ${names
    .map((n) => escapeHtml(n))
    .join(", ")} &mdash; they ship products rather than open weights or public repos, so this desk has no signal on them and does not infer one.</p>`;
}

/** Startups / Unicorns — cards. Same evidence contract, narrative shape. */
function renderCards(desk, basePath) {
  const cards = desk.items
    .map((c) => {
      const facts = c.facts
        .map((f) => `<span class="ent-fact"><b>${escapeHtml(f.v)}</b> ${escapeHtml(f.k)}</span>`)
        .join("");
      // Three states, and the middle one is the one the ledger got wrong for
      // months: shipped / seen moving / nothing. A trending sighting is real
      // evidence and belongs on the card, but it is not a release, and putting
      // a bare repo name in the slot a shipped artifact occupies reads as one.
      const link = (label) =>
        `<a href="${escapeHtml(c.url || "#")}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
      const headline = !c.headline
        ? `<span class="ledger-quiet">no shipped artifact in this window</span>`
        : c.shipped === false || c.kind === "repo"
          ? `<span class="biz-card-sighting">Seen in trending</span> ${link(c.headline)}`
          : link(c.headline);
      return `
      <article class="biz-card">
        <h3 class="biz-card-name"><a href="${escapeHtml(entityPath(basePath, c.entityId))}">${escapeHtml(c.name)}</a></h3>
        ${badgeHtml(c.badges)}
        <p class="biz-card-head">${headline}</p>
        <div class="ent-facts">${facts}</div>
        ${c.headline ? `<p class="ent-evidence-line">${evidenceHtml(c.evidence)}</p>` : ""}
      </article>`;
    })
    .join("");
  return `<div class="biz-cards">${cards}</div>`;
}

/**
 * A dark desk is a designed state, not a blank page. It names the window it
 * looked at and what it will and won't do about coming up empty — which is the
 * whole reason these desks are allowed to run short.
 */
function renderDeskEmpty(desk) {
  const spec = DESKS[desk.id] || {};
  return `
    <div class="biz-empty">
      <p class="biz-empty-head">Nothing to report</p>
      <p>${escapeHtml(desk.reason || "No movement in this window.")}</p>
      <p class="biz-empty-note">This desk runs on a ${escapeHtml(spec.cadence || "variable")} cadence and is allowed to come up empty. We would rather print nothing than fill the space.</p>
    </div>`;
}

/**
 * One desk page.
 * @param {object} desk - buildDesk() output
 * @param {object} [options] - { basePath, dateStr }
 */
function renderDeskPage(desk, options = {}) {
  const basePath = options.basePath || "";
  const body = desk.empty
    ? renderDeskEmpty(desk)
    : desk.id === "bigLabs"
      ? renderLedger(desk, basePath)
      : renderCards(desk, basePath);

  return page("business", basePath, {
    title: `The Git Times — ${desk.label}`,
    desc: `${desk.label}: ${desk.kicker}. Built from shipping records, not press releases.`,
    kicker: desk.label,
    headline: desk.label,
    deck: desk.empty ? desk.reason || "Nothing to report." : deskDeck(desk),
    body: body + notClaimedHtml(),
  });
}

// --- The Price Board -------------------------------------------------------

const money = (n) => (n >= 1 ? `$${Number(n).toFixed(2)}` : `$${Number(n).toFixed(3)}`);

function moveCell(row) {
  // An unknown is stated, never rendered as "unchanged" — that would be the
  // price-desk version of calling a lab quiet because we weren't watching.
  if (row.noBaseline) return `<span class="pb-none">no baseline in window</span>`;
  if (row.direction === "flat") return `<span class="pb-flat">unchanged</span>`;
  const arrow = row.direction === "cut" ? "&#9660;" : "&#9650;";
  const cls = row.direction === "cut" ? "pb-cut" : "pb-hike";
  return `<span class="${cls}">${arrow} ${Math.abs(row.movePct).toFixed(1)}%</span>`;
}

/**
 * The Price Board page. What each frontier model costs, and who moved inside
 * the window — the only proprietary time series this project keeps, and until
 * now the only one no desk read.
 * @param {object} board - buildPriceBoard() output
 * @param {object} [options] - { basePath }
 */
function renderPriceBoardPage(board, options = {}) {
  const basePath = options.basePath || "";

  if (!board || board.rows.length === 0) {
    return page("business", basePath, {
      title: "The Git Times — Price Board",
      desc: "What the frontier labs charge per million tokens, and who moved.",
      kicker: "Price Board",
      headline: "Price Board",
      deck: "No pricing data available for this edition.",
      body: `<div class="biz-empty"><p class="biz-empty-head">Board is dark</p><p>The pricing sync produced no tracked models for this edition.</p></div>${notClaimedHtml()}`,
    });
  }

  const rows = board.rows
    .map((r) => {
      const name = r.entityId
        ? `<a href="${escapeHtml(entityPath(basePath, r.entityId))}">${escapeHtml(r.lab)}</a>`
        : escapeHtml(r.lab);
      const was = r.wasOutput != null ? `<small>was ${escapeHtml(money(r.wasOutput))}</small>` : "";
      return `
      <tr class="pb-row-${escapeHtml(r.direction)}">
        <th scope="row" class="pb-model">${escapeHtml(r.label)}<small>${name}</small></th>
        <td class="ledger-num">${escapeHtml(money(r.input))}</td>
        <td class="ledger-num">${escapeHtml(money(r.output))}${was}</td>
        <td class="ledger-num">${moveCell(r)}</td>
      </tr>`;
    })
    .join("");

  const baseline = board.baselineDate
    ? `Compared against ${escapeHtml(board.baselineDate)} (${board.baselineAgeDays} days ago), the oldest snapshot inside the ${board.windowDays}-day window.`
    : `No snapshot in the ${board.windowDays}-day window is old enough to compare against yet, so no row shows a move.`;

  const body = `
    <table class="ledger-table price-board">
      <caption class="ledger-caption">Published list price per million tokens, from the daily OpenRouter sync. ${baseline}</caption>
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col" class="ledger-num">$/M in</th>
          <th scope="col" class="ledger-num">$/M out</th>
          <th scope="col" class="ledger-num">Change</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
    <p class="ledger-note"><span class="ent-notclaimed-k">Coverage</span> ${board.covered} of ${board.rows.length} models have a baseline in the window; the rest are listed at current price with no change shown. Snapshots exist only for days the paper published, so the series is deliberately sparse rather than interpolated.</p>`;

  return page("business", basePath, {
    title: "The Git Times — Price Board",
    desc: "What the frontier labs charge per million tokens, and who moved.",
    kicker: "Price Board",
    headline: "Price Board",
    deck: `${board.rows.length} frontier models &middot; ${board.movers.length} moved inside ${board.windowDays} days. A price cut is strategy made public.`,
    body: body + notClaimedHtml(),
  });
}

// --- Company index ---------------------------------------------------------

/**
 * Every company with a file, grouped by tier. The registry made browsable —
 * cheap to build and the natural landing spot for both a reader following a
 * company and an agent enumerating coverage.
 */
function renderCompanyIndexPage(entities, options = {}) {
  const basePath = options.basePath || "";
  const groups = [TIER_BIG_LAB, TIER_UNICORN, TIER_STARTUP]
    .map((tier) => {
      const mine = entities.filter((e) => e.tier === tier);
      if (mine.length === 0) return "";
      const rows = mine
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((e) => {
          const last = Number.isFinite(e.stats?.lastActivityDays)
            ? `last ship ${escapeHtml(humanDays(e.stats.lastActivityDays))}`
            : "no ship on file";
          const stories = e.stats?.storyCount
            ? ` &middot; ${e.stats.storyCount} ${e.stats.storyCount === 1 ? "story" : "stories"}`
            : "";
          return `
          <li class="co-row">
            <a class="co-name" href="${escapeHtml(entityPath(basePath, e.id))}">${escapeHtml(e.name)}</a>
            <span class="co-meta">${last}${stories}</span>
          </li>`;
        })
        .join("");
      return `
      <section class="co-group">
        <h3 class="co-group-head"><a href="${escapeHtml(deskPath(basePath, TIER_DESK[tier]))}">${escapeHtml(TIER_LABEL[tier])}</a> <span class="co-count">${mine.length}</span></h3>
        <ul class="co-list">${rows}
        </ul>
      </section>`;
    })
    .join("");

  return page("business", basePath, {
    title: "The Git Times — Companies",
    desc: "Every company The Git Times tracks, by stage. Coverage built from shipping records.",
    kicker: "Companies",
    headline: "Companies",
    deck: `${entities.length} companies on file. A company earns a file by recurring, not by appearing once.`,
    body: (groups || `<div class="biz-empty"><p class="biz-empty-head">No companies on file yet.</p></div>`) + notClaimedHtml(),
  });
}

// --- Company file ----------------------------------------------------------

function renderTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return `<p class="ent-timeline-empty">No events recorded yet. This file opens when the company next ships something the paper tracks.</p>`;
  }
  const items = timeline
    .map((ev) => {
      const when = ev.occurredAt ? String(ev.occurredAt).slice(0, 10) : ev.editionDate || "";
      const title = ev.url
        ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener">${escapeHtml(ev.title)}</a>`
        : escapeHtml(ev.title);
      const metrics = [];
      if (ev.metrics?.likes) metrics.push(`&#9829; ${Number(ev.metrics.likes).toLocaleString()}`);
      if (ev.metrics?.reactions) metrics.push(`&#9650; ${Number(ev.metrics.reactions).toLocaleString()}`);
      if (ev.metrics?.tag) metrics.push(escapeHtml(String(ev.metrics.tag)));
      return `
      <li class="ent-tl">
        <span class="ent-tl-when">${escapeHtml(when)}</span>
        <span class="ent-tl-type">${escapeHtml(EVENT_LABEL[ev.type] || ev.type || "Event")}</span>
        <h4 class="ent-tl-title">${title}</h4>
        ${metrics.length ? `<span class="ent-tl-metrics">${metrics.join(" &middot; ")}</span>` : ""}
        ${evidenceHtml(ev.evidence)}
      </li>`;
    })
    .join("");
  return `<ul class="ent-timeline">${items}</ul>`;
}

function statRow(k, v) {
  return `<div class="ent-kv"><span>${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>`;
}

/**
 * One company file. Sidebar = what we know and since when; body = every dated
 * thing they did, newest first, each with its receipt.
 * @param {object} entity - registry entity (tier, stats, badges)
 * @param {Array} timeline - getEntityTimeline() output (cumulative, from the DB)
 * @param {object} [options] - { basePath }
 */
function renderEntityPage(entity, timeline = [], options = {}) {
  const basePath = options.basePath || "";
  const s = entity.stats || {};
  const tierLabel = TIER_LABEL[entity.tier] || "Tracked";
  const deskSlug = TIER_DESK[entity.tier];

  const stats = [
    s.firstSeen ? statRow("Tracked since", s.firstSeen) : "",
    statRow("Events on file", s.storyCount || timeline.length || 0),
    statRow("Releases 30d", s.releases30d || 0),
    statRow("Model drops 30d", s.drops30d || 0),
    Number.isFinite(s.lastActivityDays) ? statRow("Last ship", humanDays(s.lastActivityDays)) : statRow("Last ship", "none on file"),
    Number.isFinite(s.oldestRepoDays) ? statRow("Oldest repo", humanDays(s.oldestRepoDays)) : "",
    statRow("Open weights", s.openWeights ? "yes" : "none seen"),
    entity.country ? statRow("Country", entity.country) : "",
  ]
    .filter(Boolean)
    .join("");

  const aliases = [...(entity.github || []), ...(entity.hf || [])];
  const aliasHtml = aliases.length
    ? `<p class="ent-aliases"><span class="ent-notclaimed-k">Publishes as</span> ${aliases.map((a) => escapeHtml(a)).join(", ")}</p>`
    : "";

  const body = `
    <div class="ent-layout">
      <aside class="ent-side">
        <span class="ent-tier">${escapeHtml(tierLabel)}</span>
        ${badgeHtml(entity.badges)}
        <div class="ent-stats">${stats}</div>
        ${deskSlug ? `<p class="ent-deskback"><a href="${escapeHtml(deskPath(basePath, deskSlug))}">All ${escapeHtml(tierLabel)} coverage &rarr;</a></p>` : ""}
        ${aliasHtml}
      </aside>
      <div class="ent-body">
        <h3 class="ent-body-head">Everything they shipped, as we recorded it</h3>
        ${renderTimeline(timeline)}
      </div>
    </div>`;

  const deck = s.firstSeen
    ? `${tierLabel} &middot; tracked since ${s.firstSeen} &middot; ${s.storyCount || timeline.length} events on file.`
    : `${tierLabel} &middot; ${timeline.length} events on file.`;

  return page("business", basePath, {
    title: `The Git Times — ${entity.name}`,
    desc: `What ${entity.name} has shipped, recorded edition by edition from public release data.`,
    kicker: "Company file",
    headline: entity.name,
    deck,
    body: body + notClaimedHtml(),
  });
}

// --- Selection + IO --------------------------------------------------------

/**
 * Which companies get a permanent file. Curated roster members always do — they
 * are who the paper covers, and a silent lab still needs an address. Provisional
 * orgs must have recurred (see PROVISIONAL_MIN_EVENTS).
 */
function selectPageableEntities(entities = [], opts = {}) {
  const min = opts.minEvents || PROVISIONAL_MIN_EVENTS;
  return entities
    .filter((e) => e && e.id)
    .filter((e) => e.curated || (e.stats?.storyCount || 0) >= min || (e.stats?.eventCount || 0) >= min)
    .slice(0, opts.maxPages || MAX_ENTITY_PAGES);
}

function writePage(dir, html) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
}

/**
 * Write every Business page into the site tree.
 *
 * MUST run AFTER recordRegistry() for the edition: company files read the
 * cumulative timeline out of the DB, so writing them first would publish files
 * that are missing the very edition being published.
 *
 * @param {string} outDir
 * @param {object} args
 * @param {object} args.desks - buildBusinessDesks() output
 * @param {Array}  args.entities - buildRegistry().entities
 * @param {function} args.getTimeline - (entityId) => timeline rows (injected for testability)
 * @param {string} [args.basePath]
 * @returns {{ desks: number, companies: number, paths: string[] }}
 */
function writeBusinessPages(outDir, args = {}) {
  const { desks = {}, entities = [], getTimeline = () => [], basePath = "", priceBoard = null } = args;
  const paths = [];

  if (priceBoard) {
    writePage(path.join(outDir, "prices"), renderPriceBoardPage(priceBoard, { basePath }));
    paths.push("/prices/");
  }

  for (const id of DESK_ORDER) {
    const desk = desks[id];
    if (!desk) continue;
    writePage(path.join(outDir, desk.slug), renderDeskPage(desk, { basePath }));
    paths.push(`/${desk.slug}/`);
  }

  const pageable = selectPageableEntities(entities, args);
  const slugs = assignSlugs(pageable);
  writePage(path.join(outDir, "companies"), renderCompanyIndexPage(pageable, { basePath }));
  paths.push("/companies/");

  for (const entity of pageable) {
    let timeline;
    try {
      timeline = getTimeline(entity.id) || [];
    } catch {
      // A company file with no timeline still beats a broken publish.
      timeline = [];
    }
    const slug = slugs.get(entity.id) || entitySlug(entity.id);
    writePage(path.join(outDir, "companies", slug), renderEntityPage(entity, timeline, { basePath }));
    paths.push(`/companies/${slug}/`);
  }

  return { desks: DESK_ORDER.length, companies: pageable.length, paths };
}

module.exports = {
  entitySlug,
  entityPath,
  deskPath,
  assignSlugs,
  selectPageableEntities,
  renderDeskPage,
  renderPriceBoardPage,
  renderCompanyIndexPage,
  renderEntityPage,
  writeBusinessPages,
  PROVISIONAL_MIN_EVENTS,
};
