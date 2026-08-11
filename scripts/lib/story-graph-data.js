// Shared provenance model for one repo's path through the paper.
// Read-only. Consumed by both story-graph.js (HTML canvas) and
// story-graph-n8n.js (n8n workflow JSON) so the two never drift.

const { execFileSync } = require('node:child_process');

/**
 * @param {{dataDir?: string, repo: string}} opts
 * @returns {{repo, appearances, leads, nodes, edges, gaps, generated}}
 */
function buildGraph({ dataDir = 'data', repo: REPO }) {
  const DB = `${dataDir}/gittimes.db`;
  // Read-only. Tables owned by other modules (lead_slate lives in desk.js) may not
  // exist in every DB this is pointed at; a missing table is an empty result, not
  // a crash. Any other sqlite error still throws.
  function q(sql) {
    let raw;
    try {
      raw = execFileSync('sqlite3', ['-json', DB, sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) {
      if (/no such table/.test(String(e.stderr || ''))) return [];
      throw e;
    }
    return raw ? JSON.parse(raw) : [];
  }
  const lit = (s) => String(s).replace(/'/g, "''");
  const R = lit(REPO);

  // Trigger db.js's idempotent migrations so placement columns exist before we read them.
  try { execFileSync('node', ['-e', `require('./src/db').getDb(${JSON.stringify(dataDir)})`], { stdio: 'ignore' }); } catch { /* older tree */ }
  const hasPlacement = execFileSync('sqlite3', [DB, 'PRAGMA table_info(edition_repos)'], { encoding: 'utf8' })
    .includes('|section|');
  const P = hasPlacement ? ', section, slot, slot_rank AS rank' : '';
  
  const appearances = q(`SELECT edition_date AS date, headline${P} FROM edition_repos
                         WHERE repo_name='${R}' ORDER BY 1`);
  const snapshots = q(`SELECT date, stars, forks, issues FROM repo_snapshots
                       WHERE repo_name='${R}' ORDER BY 1`);
  const dates = appearances.map((a) => `'${lit(a.date)}'`).join(',') || `''`;
  const editions = q(`SELECT e.date, e.headline, e.subheadline, e.tagline,
                             m.model, m.llm_calls, m.total_tokens, m.elapsed_ms
                      FROM editions e LEFT JOIN edition_meta m ON m.date = e.date
                      WHERE e.date IN (${dates}) ORDER BY e.date`);
  const pool = q(`SELECT edition_date AS date, COUNT(*) AS n FROM edition_repos
                  WHERE edition_date IN (${dates}) GROUP BY 1 ORDER BY 1`);
  const releases = q(`SELECT edition_date AS date, tag FROM featured_releases WHERE repo='${R}'`);
  const leadSlate = q(`SELECT COUNT(*) AS n FROM lead_slate WHERE repo_name='${R}'`);
  const everLed = q(`SELECT date FROM editions WHERE headline LIKE '%${lit(REPO.split('/')[1])}%'`);
  
  const byDate = (rows) => Object.fromEntries(rows.map((r) => [r.date, r]));
  const ed = byDate(editions);
  const pl = byDate(pool);
  const rel = byDate(releases);
  
  const nodes = [];
  const edges = [];
  const push = (n) => (nodes.push(n), n.id);
  
  // ---- Rail 0: SIGNAL (repo telemetry actually stored) ----
  snapshots.forEach((s, i) => {
    const prev = snapshots[i - 1];
    const d = prev ? s.stars - prev.stars : null;
    const days = prev ? Math.round((Date.parse(s.date) - Date.parse(prev.date)) / 864e5) : null;
    push({
      id: `sig-${s.date}`, col: 0, rank: i, kind: 'signal',
      title: s.date,
      subtitle: d === null ? 'first snapshot on record' : `${d >= 0 ? '+' : ''}${d.toLocaleString()} stars / ${days}d`,
      fields: [
        ['stars', s.stars.toLocaleString()],
        ['forks', s.forks.toLocaleString()],
        ['open issues', s.issues.toLocaleString()],
        ['Δ stars', d === null ? '—' : `${d >= 0 ? '+' : ''}${d.toLocaleString()}`],
        ['rate', d === null ? '—' : `${(d / days).toFixed(0)}/day`],
      ],
      note: 'repo_snapshots — the only quantitative signal the pipeline persists for this repo.',
    });
  });
  
  // ---- Rails 1-3: one lane per appearance ----
  appearances.forEach((a, i) => {
    const e = ed[a.date] || {};
    const n = pl[a.date]?.n ?? 0;
    const covering = snapshots.filter((s) => s.date <= a.date).pop();
  
    const intake = push({
      id: `in-${a.date}`, col: 1, rank: i, kind: 'intake',
      title: a.date,
      subtitle: `entered pool of ${n}`,
      fields: [
        ['candidates that day', String(n)],
        ['release featured', rel[a.date] ? rel[a.date].tag : 'no'],
        ['telemetry at intake', covering ? `${covering.date} snapshot` : 'none — no snapshot predates this edition'],
      ],
      status: covering ? 'ok' : 'gap',
      note: covering
        ? `Nearest stored snapshot is ${covering.date}.`
        : 'The paper considered this repo with no star history on record. Selection ran on same-day API data that was never persisted.',
    });
  
    const placed = a.section || a.slot;
    const desk = push({
      id: `desk-${a.date}`, col: 2, rank: i, kind: 'desk',
      title: placed ? `${a.slot || 'placed'} · ${a.section || '—'}` : 'passed over',
      subtitle: placed
        ? `slot ${a.rank >= 0 ? `#${a.rank + 1}` : '—'}, 1 of ${n} considered`
        : `1 of ${n} considered, not the lead`,
      fields: [
        ['verdict', placed ? `ran as ${a.slot} in ${a.section}` : 'ran as a card, not the lead'],
        ['position in slot', a.rank >= 0 ? `#${a.rank + 1}` : 'not recorded'],
        ['scored against', `${n - 1} other candidates`],
        ['reason recorded', '—'],
        ['rejected alternatives', '—'],
      ],
      status: placed ? 'ok' : 'gap',
      note: placed
        ? 'Placement is on the record. The ranking reason is still only captured for lead candidates (lead_slate); card-level demotions carry no reason string.'
        : 'Placement was never written for this edition — it predates the placement columns. Editions published from now on record section, slot and rank.',
    });
  
    const print = push({
      id: `out-${a.date}`, col: 3, rank: i, kind: 'print',
      title: e.headline || '(no edition headline)',
      subtitle: (e.subheadline || '').length > 96 ? e.subheadline.slice(0, 96).trimEnd() + '…' : (e.subheadline || ''),
      fields: [
        ['led with', e.headline ? e.headline.split(' ').slice(0, 3).join(' ') + '…' : '—'],
        ['this repo’s card headline', a.headline || 'not recorded'],
        ['model', e.model || 'not recorded'],
        ['llm calls', e.llm_calls != null ? String(e.llm_calls) : 'not recorded'],
        ['tokens', e.total_tokens ? e.total_tokens.toLocaleString() : 'not recorded'],
      ],
      status: a.headline ? 'ok' : 'gap',
      note: e.tagline ? `Edition epigraph: ${e.tagline}` : 'No epigraph on record.',
    });
  
    edges.push({ from: intake, to: desk, kind: 'main' });
    edges.push({ from: desk, to: print, kind: 'spiked' });
  
    if (covering) edges.push({ from: `sig-${covering.date}`, to: intake, kind: 'feed' });
  });
  
  // snapshots taken after the last appearance feed nothing
  const lastApp = appearances.at(-1)?.date;
  snapshots.forEach((s) => {
    if (lastApp && s.date > lastApp) nodes.find((n) => n.id === `sig-${s.date}`).status = 'orphan';
  });
  
  // The ledger reports coverage honestly in both directions: a field that is now
  // fully populated says so, rather than keeping its complaint.
  const nSnapCover = snapshots.filter((s) => lastApp && s.date <= lastApp).length;
  const gaps = [
    ['lead_slate', `${leadSlate[0]?.n ?? 0} rows for this repo`,
      (leadSlate[0]?.n ?? 0) > 0
        ? 'The ranking this repo sat in, and the reason attached to it, are on the record.'
        : 'No ranking, no rejection reasons. The desk’s judgment is unrecoverable.',
      (leadSlate[0]?.n ?? 0) > 0],
    ['edition_repos.headline',
      `${appearances.filter((a) => a.headline).length}/${appearances.length} populated`,
      appearances.length > 0 && appearances.every((a) => a.headline)
        ? 'The card text this repo ran under is preserved for every appearance.'
        : 'The card text this repo actually ran under was not kept.',
      appearances.length > 0 && appearances.every((a) => a.headline)],
    ['edition_meta',
      `${editions.filter((e) => e.model).length}/${editions.length} populated`,
      editions.every((e) => e.model) && editions.length
        ? 'Model, call count and token spend recorded for every edition.'
        : 'Which model wrote these editions is unrecorded.',
      editions.length > 0 && editions.every((e) => e.model)],
    ['repo_snapshots coverage',
      `${nSnapCover} of ${snapshots.length} predate the last appearance`,
      nSnapCover === snapshots.length && snapshots.length
        ? 'Every stored snapshot falls inside the coverage window.'
        : 'Some telemetry was captured after the coverage window closed.',
      nSnapCover === snapshots.length && snapshots.length > 0],
    ['editor_picks', '0 rows', 'No human or model ever second-guessed these calls on the record.', false],
    ['placement',
      hasPlacement ? `${appearances.filter((a) => a.section).length}/${appearances.length} populated` : 'column absent',
      'Section, slot and rank written at publish time — including quick hits, which were previously silent.',
      hasPlacement && appearances.length > 0 && appearances.every((a) => a.section)],
  ];
  
  const data = {
    repo: REPO,
    appearances: appearances.length,
    leads: everLed.length,
    nodes, edges, gaps,
    generated: new Date().toISOString().slice(0, 10),
  };

  return data;
}

module.exports = { buildGraph };
