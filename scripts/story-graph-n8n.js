#!/usr/bin/env node
// Emit one repo's provenance as an importable n8n workflow.
//
//   node scripts/story-graph-n8n.js [repo] [outfile]
//   GITTIMES_DATA_DIR=/path/to/data node scripts/story-graph-n8n.js ...
//
// Then in n8n: Workflows -> ... -> Import from File.
//
// Nodes are Set nodes carrying the real record as JSON rather than inert NoOp
// stubs, so the workflow actually runs: hit Execute and every node's output
// panel shows that step's provenance. The wires are the pipeline, the data is
// what the pipeline actually wrote down.

const { writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { buildGraph } = require('./lib/story-graph-data');

const REPO = process.argv[2] || 'Comfy-Org/ComfyUI';
const OUT = process.argv[3] || 'story-graph.n8n.json';
const data = buildGraph({ dataDir: process.env.GITTIMES_DATA_DIR || 'data', repo: REPO });

// Deterministic UUIDs: same DB in, same file out, so re-exports diff cleanly.
function uuid(key) {
  const h = createHash('md5').update(`gittimes:${REPO}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const COL_X = [-460, -60, 360, 800];
const ROW_Y = 260;
const TITLE = { signal: 'Signal', intake: 'Intake', desk: 'Desk', print: 'Print' };

// n8n keys connections by node NAME, so names must be unique and stable.
const nameOf = new Map();
for (const n of data.nodes) {
  const date = n.id.replace(/^[a-z]+-/, '');
  nameOf.set(n.id, `${TITLE[n.kind]} · ${date}`);
}

const nodes = [];

// Manual trigger — the entry point n8n needs to run anything.
nodes.push({
  parameters: {},
  id: uuid('trigger'),
  name: "When clicking 'Execute workflow'",
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [COL_X[0] - 320, Math.round((data.nodes.filter((n) => n.col === 1).length - 1) * ROW_Y / 2)],
});

for (const n of data.nodes) {
  const record = { step: n.kind, title: n.title };
  if (n.subtitle) record.summary = n.subtitle;
  for (const [k, v] of n.fields) record[k] = v;
  record.recorded = n.status === 'gap' ? 'INCOMPLETE' : n.status === 'orphan' ? 'ORPHAN' : 'complete';
  record.provenanceNote = n.note || '';

  const flag = n.status === 'gap' ? '⚠ unrecorded decision — ' : n.status === 'orphan' ? 'orphan — ' : '';

  nodes.push({
    parameters: {
      mode: 'raw',
      jsonOutput: JSON.stringify(record, null, 2),
      options: {},
    },
    id: uuid(n.id),
    name: nameOf.get(n.id),
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [COL_X[n.col], n.rank * ROW_Y],
    notes: `${flag}${n.title}${n.subtitle ? ` — ${n.subtitle}` : ''}`,
    notesInFlow: true,
  });
}

// --- Connections -----------------------------------------------------------
const connections = {};
const connect = (fromId, toId) => {
  const from = nameOf.get(fromId), to = nameOf.get(toId);
  if (!from || !to) return;
  connections[from] ??= { main: [[]] };
  connections[from].main[0].push({ node: to, type: 'main', index: 0 });
};
for (const e of data.edges) connect(e.from, e.to);

// The trigger feeds every node with no inbound edge, so Execute lights the
// whole canvas instead of one orphaned branch.
const hasInbound = new Set(data.edges.map((e) => e.to));
const roots = data.nodes.filter((n) => !hasInbound.has(n.id));
connections["When clicking 'Execute workflow'"] = {
  main: [roots.map((n) => ({ node: nameOf.get(n.id), type: 'main', index: 0 }))],
};

// --- Sticky notes ----------------------------------------------------------
const laneCount = Math.max(1, data.nodes.filter((n) => n.col === 1).length);
const sticky = (key, content, position, width, height, color) => nodes.push({
  parameters: { content, height, width, color },
  id: uuid(key),
  name: `Note · ${key}`,
  type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1,
  position,
});

sticky('title',
  `## How ${REPO} got printed\n\n` +
  `${data.appearances} appearance${data.appearances === 1 ? '' : 's'} · ${data.leads} as the lead\n\n` +
  'Each row is one edition. Left to right: the signal the pipeline stored, the candidate pool it entered, ' +
  'where the desk placed it, what actually went to print. **Execute the workflow** to see each step’s record ' +
  'in its output panel.',
  [COL_X[0] - 320, -260], 460, 210, 4);

['Signal — stored telemetry', 'Intake — entered the pool', 'Desk — where it landed', 'Print — what shipped']
  .forEach((label, i) => sticky(`col-${i}`, `### ${label}`, [COL_X[i], -110], 300, 70, 7));

const ledger = data.gaps
  .map((g) => `${g[3] ? '✅' : '⚠️'} **${g[0]}** — ${g[1]}\n${g[2]}`)
  .join('\n\n');
sticky('ledger',
  `## Provenance ledger\n\nWhat the pipeline did and did not write down.\n\n${ledger}`,
  [COL_X[0] - 320, laneCount * ROW_Y - 120], 460, 520, 3);

// The UI's "Import from File" mints a workflow id, but `n8n import:workflow`
// does not — it inserts verbatim and hits a NOT NULL constraint without one.
// Derived from the repo so re-importing updates the same workflow in place.
// Keyed on repo AND output file: two exports of the same repo (real DB vs a
// fixture) are different workflows, so importing one never silently replaces
// the other. Re-exporting the same pair still updates in place.
const workflowId = createHash('md5')
  .update(`gittimes:workflow:${REPO}:${OUT.replace(/^.*\//, '')}`)
  .digest('base64url').slice(0, 16);

const workflow = {
  id: workflowId,
  versionId: uuid('version'),
  name: `GitTimes provenance — ${REPO}${/example|fixture|demo/i.test(OUT) ? ' (example data)' : ''}`,
  nodes,
  connections,
  active: false,
  settings: { executionOrder: 'v1' },
  pinData: {},
  meta: { instanceId: 'gittimes-story-graph' },
  tags: [],
};

writeFileSync(OUT, JSON.stringify(workflow, null, 2));
console.log(
  `${OUT} — ${nodes.length} n8n nodes (${data.nodes.length} steps + ${nodes.length - data.nodes.length - 1} notes/trigger), ` +
  `${Object.keys(connections).length} connection sources`
);
