// Provenance canvas built on Vue Flow — the same library n8n's editor uses
// (@vue-flow/core, MIT), driven directly rather than through a fork.
//
// Deliberate divergences from n8n, because this is a record and not a program:
//   - nodes are not connectable and edges are not updatable: you cannot rewire
//     a history. In n8n a wire is an instruction; here it is a claim about what
//     happened, and a draggable wire would be a lie.
//   - there is no run/execute affordance, because nothing executes.
//   - unrecorded steps are rendered as such rather than left to look complete.

import { createApp, h, ref, computed } from 'vue';
import { VueFlow, Handle, Position, useVueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';

const DATA = window.__GRAPH__;

const COL_X = { 0: 0, 1: 380, 2: 760, 3: 1140 };
const ROW_Y = 230;
const KIND_LABEL = { signal: 'Signal', intake: 'Intake', desk: 'Desk', print: 'Print' };

/** One provenance step, drawn as an n8n-style node card. */
const StepNode = {
  props: ['data', 'selected'],
  setup(props) {
    return () => {
      const d = props.data;
      const gap = d.status === 'gap';
      const orphan = d.status === 'orphan';
      return h('div', {
        class: ['step', `kind-${d.kind}`, gap && 'is-gap', orphan && 'is-orphan', props.selected && 'is-sel']
          .filter(Boolean).join(' '),
      }, [
        h(Handle, { type: 'target', position: Position.Left, connectable: false }),
        h('div', { class: 'step-kind' }, [
          h('span', KIND_LABEL[d.kind] || d.kind),
          gap ? h('span', { class: 'flag' }, 'unrecorded') : orphan ? h('span', { class: 'flag' }, 'orphan') : null,
        ]),
        h('div', { class: 'step-title' }, d.title),
        d.subtitle ? h('div', { class: 'step-sub' }, d.subtitle) : null,
        h(Handle, { type: 'source', position: Position.Right, connectable: false }),
      ]);
    };
  },
};

const App = {
  setup() {
    const selected = ref(null);
    const ledgerOpen = ref(true);

    const nodes = DATA.nodes.map((n) => ({
      id: n.id,
      type: 'step',
      position: { x: COL_X[n.col], y: n.rank * ROW_Y },
      data: n,
      draggable: true,
      connectable: false,
    }));

    const edges = DATA.edges.map((e, i) => ({
      id: `e${i}`,
      source: e.from,
      target: e.to,
      type: 'smoothstep',
      animated: e.kind === 'feed',
      class: `wire-${e.kind}`,
      updatable: false,
      selectable: false,
    }));

    const { onNodeClick, onPaneClick, fitView } = useVueFlow();
    const refitRef = ref(null);
    onNodeClick(({ node }) => { const had = !!selected.value; selected.value = node.data; if (!had) refitRef.value?.(); });
    onPaneClick(() => { if (selected.value) { selected.value = null; refitRef.value?.(); } });

    const complete = computed(() => DATA.gaps.every((g) => g[3]));

    const panel = () => {
      const d = selected.value;
      if (!d) return null;
      return h('aside', { class: 'inspector' }, [
        h('button', { class: 'close', onClick: () => { selected.value = null; refitRef.value?.(); } }, '×'),
        h('div', { class: 'insp-kind' }, (KIND_LABEL[d.kind] || d.kind) + (d.status === 'gap' ? ' · incomplete record' : '')),
        h('h2', d.title),
        d.subtitle ? h('p', { class: 'insp-sub' }, d.subtitle) : null,
        h('table', d.fields.map(([k, v]) => h('tr', [h('td', k), h('td', v)]))),
        d.note ? h('p', { class: 'insp-note' }, d.note) : null,
      ]);
    };

    // The canvas gets its own box rather than sitting under the panels: a node
    // hidden behind the ledger is a node the reader will never click.
    const refit = () => requestAnimationFrame(() => setTimeout(() => fitView({ padding: 0.16 }), 60));
    refitRef.value = refit;

    return () => h('div', {
      class: ['app', ledgerOpen.value && 'ledger-open', selected.value && 'insp-open'].filter(Boolean).join(' '),
    }, [
      h('header', [
        h('h1', [
          'How ', h('em', DATA.repo), ' got printed — ',
          `${DATA.appearances} appearance${DATA.appearances === 1 ? '' : 's'}, `,
          DATA.leads === 0 ? 'never the lead'
            : DATA.leads === DATA.appearances ? 'led every time'
            : `${DATA.leads} as the lead`,
        ]),
        h('p', { class: 'dek' }, 'A record, not a program. Wires show what preceded what — they cannot be rewired, and nothing here executes.'),
      ]),

      h(VueFlow, {
        nodes, edges,
        nodeTypes: { step: StepNode },
        nodesConnectable: false,
        edgesUpdatable: false,
        elementsSelectable: true,
        minZoom: 0.15,
        maxZoom: 2,
        fitViewOnInit: true,
        defaultEdgeOptions: { type: 'smoothstep' },
        // Refit rather than fitView directly: the panels resize the canvas box
        // after the pane is ready, and fitting to the pre-resize width crops the
        // rightmost column.
        onPaneReady: () => refit(),
      }, {
        default: () => [
          h(Background, { patternColor: '#3a3f4b', gap: 22, size: 1.4 }),
          h(Controls, { showInteractive: false }),
          // No minimap: a provenance graph is a handful of lanes, and Vue Flow's
          // minimap ignores both CSS and width/height props here, covering the
          // print column to navigate a graph that already fits on screen.
        ],
      }),

      h('div', { class: ['ledger', complete.value && 'ok'].filter(Boolean).join(' ') }, [
        h('h3', [
          complete.value ? 'Provenance ledger — complete' : 'Provenance ledger',
          h('button', {
            class: 'toggle',
            onClick: () => { ledgerOpen.value = !ledgerOpen.value; refit(); },
          }, ledgerOpen.value ? 'hide' : 'show'),
        ]),
        ledgerOpen.value ? h('ul', DATA.gaps.map((g) => h('li', { class: g[3] ? 'ok' : '' }, [
          h('span', { class: 'mk' }, g[3] ? '✓' : '•'),
          h('b', g[0]), ' — ', g[1], h('br'), h('span', { class: 'why' }, g[2]),
        ]))) : null,
      ]),

      panel(),

      h('footer', [
        h('span', { class: 'k' }, [h('i', { class: 'sw feed' }), 'telemetry feed']),
        h('span', { class: 'k' }, [h('i', { class: 'sw main' }), 'selection']),
        h('span', { class: 'k' }, [h('i', { class: 'sw spiked' }), 'spiked to a card']),
        h('span', { class: 'k' }, [h('i', { class: 'dot' }), 'unrecorded decision']),
        h('span', { class: 'built' }, `${DATA.repo} · built ${DATA.generated} · Vue Flow (MIT)`),
      ]),
    ]);
  },
};

createApp(App).mount('#app');
