#!/usr/bin/env node
// Render one repo's provenance as a single self-contained HTML canvas.
// Usage: node scripts/story-graph.js [repo] [outfile]
//        GITTIMES_DATA_DIR=/path/to/data node scripts/story-graph.js ...

const { writeFileSync } = require('node:fs');
const { buildGraph } = require('./lib/story-graph-data');

const REPO = process.argv[2] || 'Comfy-Org/ComfyUI';
const OUT = process.argv[3] || 'story-graph.html';
const data = buildGraph({ dataDir: process.env.GITTIMES_DATA_DIR || 'data', repo: REPO });

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const { appearances: nApp, leads: nLeads } = data;
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
#ledger li{margin:0 0 5px;line-height:1.35;list-style:none;padding-left:15px;position:relative}
#ledger .mk{position:absolute;left:0;color:var(--gap)}
#ledger li.ok{color:var(--mid)}
#ledger li.ok .mk{color:#3d6b3d}
#ledger ul{margin:0;padding:0}
#ledger b{font-family:ui-monospace,monospace;font-size:11px;font-weight:400;background:#f0e7d3;padding:0 3px}
#ledger .sh{cursor:pointer;float:right;color:var(--mid)}
</style></head><body>

<header>
  <h1>How <em>${esc(REPO)}</em> got printed — ${nApp} appearance${nApp === 1 ? '' : 's'}, ${
    nLeads === 0 ? 'never the lead'
      : nLeads === nApp ? 'led every time'
      : `${nLeads} as the lead`}</h1>
  <p class="dek">Every node is one recorded step in the pipeline. Dashed amber nodes are places the pipeline
  made a decision and did not write down why. Drag to pan, scroll to zoom, click any node for its record.</p>
</header>

<div id="stage"><svg id="wires"></svg><div id="layer"></div></div>

<div id="ledger">
  <h3><span id="ledger-h">Provenance ledger</span> <span class="sh" id="sh">hide</span></h3>
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
  <span>${esc(REPO)} · ${nApp} appearances · ${nLeads} leads · built ${data.generated}</span>
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
  .map(g => '<li class="' + (g[3] ? 'ok' : '') + '"><span class="mk">' + (g[3] ? '✓' : '•') + '</span>' +
    '<b>' + escape2(g[0]) + '</b> — ' + escape2(g[1]) + '<br>' + escape2(g[2]) + '</li>').join('');
document.getElementById('ledger-h').textContent =
  DATA.gaps.every(g => g[3]) ? 'Provenance ledger — complete' : 'Provenance ledger';
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
console.log(`${OUT} — ${data.nodes.length} nodes, ${data.edges.length} edges, ${data.gaps.length} recorded gaps`);
