#!/usr/bin/env node
// Build a single-file provenance graph for one repo's path through the paper.
// Usage: node scripts/story-graph.js [repo] [outfile]

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DATA_DIR = process.env.GITTIMES_DATA_DIR || 'data';
const DB = `${DATA_DIR}/gittimes.db`;
const REPO = process.argv[2] || 'Comfy-Org/ComfyUI';
const OUT = process.argv[3] || 'story-graph.html';

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
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lit = (s) => String(s).replace(/'/g, "''");
const R = lit(REPO);

// Trigger db.js's idempotent migrations so placement columns exist before we read them.
try { execFileSync('node', ['-e', `require('./src/db').getDb(${JSON.stringify(DATA_DIR)})`], { stdio: 'ignore' }); } catch { /* older tree */ }
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

const gaps = [
  ['lead_slate', `${leadSlate[0]?.n ?? 0} rows for this repo`, 'No ranking, no rejection reasons. The desk’s judgment is unrecoverable.'],
  ['edition_repos.headline', `${appearances.filter((a) => a.headline).length}/${appearances.length} populated`, 'The card text this repo actually ran under was not kept.'],
  ['edition_meta', `${editions.filter((e) => e.model).length}/${editions.length} populated`, 'Which model wrote these editions is unrecorded.'],
  ['repo_snapshots coverage', `${snapshots.filter((s) => s.date <= lastApp).length} of ${snapshots.length} predate the last appearance`, 'Most telemetry was captured after the coverage window closed.'],
  ['editor_picks', '0 rows', 'No human or model ever second-guessed these calls on the record.'],
  ['placement', hasPlacement
    ? `${appearances.filter((a) => a.section).length}/${appearances.length} populated`
    : 'column absent',
    'Section, slot and rank now written at publish time — including quick hits, which were previously silent.'],
];

const data = {
  repo: REPO,
  appearances: appearances.length,
  leads: everLed.length,
  nodes, edges, gaps,
  generated: new Date().toISOString().slice(0, 10),
};

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>How ${esc(REPO)} Got Printed — GitTimes Provenance</title>
<style>
:root{
  --paper:#f4f1ea; --ink:#141210; --mid:#5c564d; --rule:#c9c2b4;
  --red:#9d2b26; --blue:#2c4a6b; --gap:#a8741c;
  --node:#fffdf8;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--paper);color:var(--ink);
  font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  overflow:hidden}
header{position:absolute;top:0;left:0;right:0;z-index:5;padding:14px 20px 12px;
  background:linear-gradient(var(--paper) 70%,rgba(244,241,234,0));pointer-events:none}
h1{margin:0;font-size:26px;letter-spacing:-.01em;font-weight:600}
h1 em{font-style:italic;color:var(--red)}
.dek{margin:4px 0 0;font-size:13px;color:var(--mid);max-width:70ch;line-height:1.45}
.rules{position:absolute;top:0;left:0;right:0;bottom:0}
#stage{position:absolute;inset:0;cursor:grab}
#stage.drag{cursor:grabbing}
svg{position:absolute;top:0;left:0;overflow:visible}
.lane{font:11px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;fill:var(--mid)}
.lane-rule{stroke:var(--rule);stroke-width:1}
path.wire{fill:none;stroke:var(--mid);stroke-width:1.4;opacity:.55}
path.wire.spiked{stroke:var(--red);stroke-dasharray:5 4;opacity:.8}
path.wire.feed{stroke:var(--blue);stroke-width:1;opacity:.4;stroke-dasharray:2 3}
.node{position:absolute;width:230px;background:var(--node);border:1px solid var(--ink);
  padding:9px 11px 10px;cursor:pointer;transition:transform .12s,box-shadow .12s}
.node:hover{transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--ink)}
.node.sel{box-shadow:3px 3px 0 var(--red);border-color:var(--red)}
.node .kind{font:10px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--mid);
  border-bottom:1px solid var(--rule);padding-bottom:4px;margin-bottom:6px;display:flex;justify-content:space-between}
.node .t{font-size:14px;font-weight:600;line-height:1.25}
.node .s{font-size:12px;color:var(--mid);line-height:1.35;margin-top:3px;font-style:italic}
.node.gap{border-style:dashed;border-color:var(--gap);background:#faf5e9}
.node.gap .kind{color:var(--gap)}
.node.orphan{opacity:.5}
.dot{width:7px;height:7px;border-radius:50%;background:var(--gap);display:inline-block}
aside{position:absolute;top:0;right:0;bottom:0;width:340px;background:var(--node);
  border-left:1px solid var(--ink);padding:18px 20px;overflow-y:auto;z-index:6;
  transform:translateX(100%);transition:transform .18s}
aside.open{transform:none}
aside h2{margin:0 0 2px;font-size:17px;line-height:1.25}
aside .meta{font:10px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--mid)}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
td{padding:5px 0;border-bottom:1px solid var(--rule);vertical-align:top}
td:first-child{color:var(--mid);width:44%;font-size:12px}
.note{font-size:13px;line-height:1.5;border-left:2px solid var(--red);padding-left:10px;color:#332f29}
button.x{position:absolute;top:14px;right:16px;border:0;background:none;font-size:20px;cursor:pointer;color:var(--mid)}
footer{position:absolute;bottom:0;left:0;right:0;padding:10px 20px;z-index:5;
  background:linear-gradient(rgba(244,241,234,0),var(--paper) 40%);
  font:11px ui-monospace,monospace;color:var(--mid);display:flex;gap:18px;flex-wrap:wrap;pointer-events:none}
.key{display:flex;align-items:center;gap:6px}
.sw{width:22px;height:0;border-top:2px solid}
#ledger{position:absolute;left:20px;top:165px;width:300px;max-height:calc(100vh - 230px);
  overflow-y:auto;background:var(--node);
  border:1px solid var(--gap);padding:11px 13px;z-index:5;font-size:12px}
#ledger h3{margin:0 0 6px;font:10px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--gap)}
#ledger li{margin:0 0 5px;line-height:1.35;list-style:none}
#ledger ul{margin:0;padding:0}
#ledger b{font-family:ui-monospace,monospace;font-size:11px;font-weight:400;background:#f0e7d3;padding:0 3px}
#ledger .sh{cursor:pointer;float:right;color:var(--mid)}
</style></head><body>

<header>
  <h1>How <em>${esc(REPO)}</em> got printed — six times, never the lead</h1>
  <p class="dek">Every node is one recorded step in the pipeline. Dashed amber nodes are places the pipeline
  made a decision and did not write down why. Drag to pan, scroll to zoom, click any node for its record.</p>
</header>

<div id="stage"><svg id="wires"></svg><div id="layer"></div></div>

<div id="ledger">
  <h3>What was not recorded <span class="sh" id="sh">hide</span></h3>
  <ul id="gaps"></ul>
</div>

<aside id="panel"><button class="x" id="close">×</button>
  <div class="meta" id="p-kind"></div><h2 id="p-title"></h2>
  <div class="s" id="p-sub" style="font-style:italic;color:var(--mid);font-size:13px"></div>
  <table id="p-fields"></table><div class="note" id="p-note"></div>
</aside>

<footer>
  <span class="key"><span class="sw" style="border-color:var(--blue);border-top-style:dashed"></span>telemetry feed</span>
  <span class="key"><span class="sw" style="border-color:var(--mid)"></span>selection</span>
  <span class="key"><span class="sw" style="border-color:var(--red);border-top-style:dashed"></span>spiked to a card</span>
  <span class="key"><span class="dot"></span>unrecorded decision</span>
  <span>${esc(REPO)} · ${appearances.length} appearances · ${everLed.length} leads · built ${data.generated}</span>
</footer>

<script>
const DATA = ${JSON.stringify(data)};
const LANES = ['Signal','Intake','Desk','Print'];
const COL_X = [350, 670, 990, 1310];
const ROW_H = 215, TOP = 165;

const layer = document.getElementById('layer');
const svg = document.getElementById('wires');
const pos = {};

// lane headers
LANES.forEach((name, i) => {
  const t = document.createElementNS('http://www.w3.org/2000/svg','text');
  t.setAttribute('x', COL_X[i]); t.setAttribute('y', TOP - 26);
  t.setAttribute('class','lane'); t.textContent = name;
  svg.appendChild(t);
  const l = document.createElementNS('http://www.w3.org/2000/svg','line');
  l.setAttribute('x1', COL_X[i]); l.setAttribute('x2', COL_X[i] + 230);
  l.setAttribute('y1', TOP - 16); l.setAttribute('y2', TOP - 16);
  l.setAttribute('class','lane-rule'); svg.appendChild(l);
});

DATA.nodes.forEach(n => {
  const x = COL_X[n.col], y = TOP + n.rank * ROW_H;
  const el = document.createElement('div');
  el.className = 'node ' + (n.status === 'gap' ? 'gap' : n.status === 'orphan' ? 'orphan' : '');
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.innerHTML = '<div class="kind"><span>' + n.kind + '</span>' +
    (n.status === 'gap' ? '<span class="dot"></span>' : n.status === 'orphan' ? '<span>orphan</span>' : '') +
    '</div><div class="t">' + escape2(n.title) + '</div>' +
    (n.subtitle ? '<div class="s">' + escape2(n.subtitle) + '</div>' : '');
  el.onclick = (e) => { e.stopPropagation(); select(n, el); };
  layer.appendChild(el);
  pos[n.id] = { x, y, w: 230, h: el.offsetHeight };
});

DATA.edges.forEach(e => {
  const a = pos[e.from], b = pos[e.to];
  if (!a || !b) return;
  const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
  const dx = Math.max(40, (x2 - x1) * 0.55);
  const p = document.createElementNS('http://www.w3.org/2000/svg','path');
  p.setAttribute('d', \`M\${x1} \${y1} C\${x1+dx} \${y1} \${x2-dx} \${y2} \${x2} \${y2}\`);
  p.setAttribute('class', 'wire ' + e.kind);
  svg.insertBefore(p, svg.firstChild);
});

function escape2(s){ const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

let cur = null;
function select(n, el){
  if (cur) cur.classList.remove('sel');
  cur = el; el.classList.add('sel');
  document.getElementById('p-kind').textContent = n.kind + (n.status === 'gap' ? ' · incomplete record' : '');
  document.getElementById('p-title').textContent = n.title;
  document.getElementById('p-sub').textContent = n.subtitle || '';
  document.getElementById('p-fields').innerHTML =
    n.fields.map(f => '<tr><td>' + escape2(f[0]) + '</td><td>' + escape2(f[1]) + '</td></tr>').join('');
  document.getElementById('p-note').textContent = n.note || '';
  document.getElementById('panel').classList.add('open');
}
document.getElementById('close').onclick = () => {
  document.getElementById('panel').classList.remove('open');
  if (cur) cur.classList.remove('sel'); cur = null;
};

document.getElementById('gaps').innerHTML = DATA.gaps
  .map(g => '<li><b>' + escape2(g[0]) + '</b> — ' + escape2(g[1]) + '<br>' + escape2(g[2]) + '</li>').join('');
document.getElementById('sh').onclick = () => {
  const u = document.getElementById('gaps');
  const hidden = u.style.display === 'none';
  u.style.display = hidden ? '' : 'none';
  document.getElementById('sh').textContent = hidden ? 'hide' : 'show';
};

// pan + zoom
let k = Math.min(1, Math.max(0.55, (innerWidth - 40) / 1560));
let tx = 0, ty = (1 - k) * 120, dragging = false, sx, sy;
const stage = document.getElementById('stage');
function apply(){
  const t = \`translate(\${tx}px,\${ty}px) scale(\${k})\`;
  layer.style.transform = t; layer.style.transformOrigin = '0 0';
  svg.style.transform = t; svg.style.transformOrigin = '0 0';
}
stage.addEventListener('mousedown', e => { dragging = true; sx = e.clientX - tx; sy = e.clientY - ty; stage.classList.add('drag'); });
addEventListener('mousemove', e => { if (dragging) { tx = e.clientX - sx; ty = e.clientY - sy; apply(); } });
addEventListener('mouseup', () => { dragging = false; stage.classList.remove('drag'); });
stage.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.08 : 1 / 1.08, nk = Math.min(2, Math.max(0.3, k * f));
  tx = e.clientX - (e.clientX - tx) * (nk / k); ty = e.clientY - (e.clientY - ty) * (nk / k);
  k = nk; apply();
}, { passive: false });
stage.addEventListener('click', () => document.getElementById('close').click());
apply();
</script></body></html>`;

writeFileSync(OUT, html);
console.log(`${OUT} — ${nodes.length} nodes, ${edges.length} edges, ${gaps.length} recorded gaps`);
