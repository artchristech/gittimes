#!/usr/bin/env node
// Bundle the Vue Flow provenance canvas into one self-contained HTML file.
//
//   node scripts/story-canvas.js [repo] [outfile]
//   GITTIMES_DATA_DIR=/path/to/data node scripts/story-canvas.js ...
//
// Vue Flow is the canvas library n8n's own editor is built on (@vue-flow/core,
// MIT). Using it directly keeps the interaction model without inheriting n8n's
// Sustainable Use License, which would bar shipping a fork on a commercial site.

const { writeFileSync } = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { buildGraph } = require('./lib/story-graph-data');

const REPO = process.argv[2] || 'Comfy-Org/ComfyUI';
const OUT = process.argv[3] || 'story-canvas.html';
const data = buildGraph({ dataDir: process.env.GITTIMES_DATA_DIR || 'data', repo: REPO });

const entry = path.join(__dirname, 'canvas', 'main.js');
const css = path.join(__dirname, 'canvas', 'canvas.css');

async function main() {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    write: false,
    // Never written (write:false) but esbuild requires an output path before it
    // will split imported CSS into its own output file.
    outdir: path.join(__dirname, '.canvas-build'),
    format: 'iife',
    target: ['es2020'],
    // Vue's bundler build reads these; without them it warns and keeps dev-only code.
    define: {
      'process.env.NODE_ENV': '"production"',
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
    loader: { '.css': 'css' },
  });

  const js = result.outputFiles.find((f) => f.path.endsWith('.js'))?.text || '';
  // esbuild emits imported CSS as a sibling output; fold it in with our own.
  const vendorCss = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text || '';
  const ownCss = await esbuild.build({
    entryPoints: [css], bundle: true, minify: true, write: false, loader: { '.css': 'css' },
  }).then((r) => r.outputFiles[0].text);

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>How ${escapeHtml(REPO)} got printed — GitTimes provenance</title>
<style>${vendorCss}\n${ownCss}</style>
</head><body>
<div id="app"></div>
<script>window.__GRAPH__=${JSON.stringify(data).replace(/</g, '\\u003c')};</script>
<script>${js}</script>
</body></html>`;

  writeFileSync(OUT, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`${OUT} — ${data.nodes.length} nodes, ${data.edges.length} edges, ${kb}KB self-contained`);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
