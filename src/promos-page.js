#!/usr/bin/env node
/**
 * Promos gallery page — surfaces the per-edition promo videos that the publish
 * pipeline already renders into site/promos/<date>.mp4 but which were, until now,
 * orphaned URLs that nothing on the site linked to.
 *
 * The page lives at site/promos/index.html, sitting alongside the very assets it
 * lists (<date>.mp4, <date>.jpg poster, <date>.vtt captions). It mirrors the
 * Archive page (src/archive.js + templates/archive.html) in structure and styling.
 *
 * Source of truth for "which editions have a video" = the files actually present
 * in site/promos/, NOT the manifest — so a render that failed (non-fatal) simply
 * doesn't appear, and a backfill of older promos shows up automatically.
 *
 * Usage (CLI, standalone backfill):
 *   node src/promos-page.js
 *   PUBLISH_DIR=./site BASE_PATH="" node src/promos-page.js
 */
const fs = require("fs");
const path = require("path");
const { escapeHtml } = require("./render");
const { applyTemplate } = require("./template-utils");

const DATE_MP4 = /^(\d{4}-\d{2}-\d{2})\.mp4$/;

/**
 * Scan outDir/promos for rendered promo videos and join them to manifest metadata.
 * @param {string} outDir - Site output dir (e.g. "./site")
 * @param {Array} manifest - Array of { date, headline, tagline, url }
 * @returns {Array<{date,mp4,poster,vtt,headline,tagline,url}>} newest-first
 */
function collectPromoEntries(outDir, manifest) {
  const promosDir = path.join(outDir, "promos");
  if (!fs.existsSync(promosDir)) return [];

  const byDate = new Map(manifest.map((e) => [e.date, e]));

  const entries = [];
  for (const file of fs.readdirSync(promosDir)) {
    const m = file.match(DATE_MP4);
    if (!m) continue; // ignore index.html, posters, captions, anything else
    const date = m[1];
    const meta = byDate.get(date) || {};
    const has = (ext) => fs.existsSync(path.join(promosDir, `${date}.${ext}`));
    entries.push({
      date,
      mp4: `${date}.mp4`,
      poster: has("jpg") ? `${date}.jpg` : null,
      vtt: has("vtt") ? `${date}.vtt` : null,
      headline: meta.headline || "Edition",
      tagline: meta.tagline || "",
      url: meta.url || `/editions/${date}/`,
    });
  }

  // Newest first (ISO dates sort lexically).
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return entries;
}

/**
 * Render the Promos gallery page HTML.
 * @param {Array} entries - From collectPromoEntries
 * @param {string} basePath - Base path for links (e.g. "")
 * @returns {string} Complete HTML string
 */
function renderPromosPage(entries, basePath) {
  const cards = entries.map((entry) => {
    const displayDate = new Date(entry.date + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const editionUrl = entry.url.startsWith("http") ? entry.url : `${basePath}${entry.url}`;
    const mediaBase = `${basePath}/promos/${entry.date}`;
    const poster = entry.poster ? ` poster="${escapeHtml(mediaBase)}.jpg"` : "";
    const track = entry.vtt
      ? `<track kind="captions" srclang="en" label="English" src="${escapeHtml(mediaBase)}.vtt" default>`
      : "";
    return `
    <figure class="promo-card">
      <video class="promo-video" controls preload="none" playsinline${poster}>
        <source src="${escapeHtml(mediaBase)}.mp4" type="video/mp4">
        ${track}
      </video>
      <figcaption class="promo-meta">
        <span class="promo-date">${escapeHtml(displayDate)}</span>
        <a href="${escapeHtml(editionUrl)}" class="promo-headline">${escapeHtml(entry.headline)}</a>
      </figcaption>
    </figure>`;
  });

  const list = cards.length
    ? `<div class="promos-grid">${cards.join("\n")}</div>`
    : `<p class="promos-empty">No promo videos yet. Each edition's promo appears here once it's rendered.</p>`;

  return applyTemplate("promos", basePath).replace("{{PROMO_LIST}}", list);
}

/**
 * Build and write site/promos/index.html from the current promos dir + manifest.
 * Convenience entrypoint for both the publish pipeline and standalone backfill.
 * @param {string} outDir
 * @param {string} basePath
 * @returns {{count:number, path:string}}
 */
function writePromosPage(outDir, basePath) {
  // Lazy require to stay clear of the render.js <-> publish.js circular tangle.
  const { readManifest } = require("./publish");
  const manifest = readManifest(outDir);
  const entries = collectPromoEntries(outDir, manifest);
  const html = renderPromosPage(entries, basePath);
  const promosDir = path.join(outDir, "promos");
  if (!fs.existsSync(promosDir)) fs.mkdirSync(promosDir, { recursive: true });
  const outPath = path.join(promosDir, "index.html");
  fs.writeFileSync(outPath, html);
  return { count: entries.length, path: outPath };
}

module.exports = { collectPromoEntries, renderPromosPage, writePromosPage };

// CLI: standalone backfill / regeneration.
if (require.main === module) {
  const outDir = process.env.PUBLISH_DIR || "./site";
  const basePath = process.env.BASE_PATH || "";
  const { count, path: outPath } = writePromosPage(outDir, basePath);
  console.log(`Promos page: ${count} video${count === 1 ? "" : "s"} -> ${outPath}`);
}
