#!/usr/bin/env node
/**
 * Record a promo HTML as MP4 video using Puppeteer + ffmpeg.
 * Usage: node record-promo.js [YYYY-MM-DD] [format]
 *        node record-promo.js [YYYY-MM-DD] all
 *
 * Formats:
 *   vertical  — 1080x1920 (default, mobile/reels/stories)
 *   square    — 1080x1080 (social feeds)
 *   landscape — 1920x1080 (desktop/YouTube)
 *   all       — generates all three
 *
 * Deterministic capture: pauses the GSAP timeline, steps frame-by-frame,
 * screenshots each frame, then stitches with ffmpeg.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const FPS = 30;

const FORMATS = {
  vertical:  { width: 1080, height: 1920 },
  square:    { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
};

async function recordPromo(dateStr, format) {
  const { width, height } = FORMATS[format];

  // Resolve promo HTML path
  const outDir = process.env.PUBLISH_DIR || "./site";
  const promoDir = path.join(outDir, "promos");

  if (!dateStr) {
    // Find latest promo HTML
    const files = fs.readdirSync(promoDir).filter((f) => f.endsWith(".html"));
    files.sort().reverse();
    if (!files.length) {
      console.error("No promo HTML files found. Run generate-promo.js first.");
      process.exit(1);
    }
    dateStr = files[0].replace(".html", "");
  }

  const htmlPath = path.resolve(promoDir, `${dateStr}.html`);
  const suffix = format === "vertical" ? "" : `-${format}`;
  const mp4Path = path.resolve(promoDir, `${dateStr}${suffix}.mp4`);
  const framesDir = path.resolve(promoDir, `.frames-${dateStr}-${format}`);

  if (!fs.existsSync(htmlPath)) {
    console.error(`Promo not found: ${htmlPath}`);
    process.exit(1);
  }

  // Create temp frames directory
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });

  console.log(`Recording ${dateStr} [${format} ${width}x${height}] @ ${FPS}fps...`);

  const browser = await puppeteer.launch({ headless: true, protocolTimeout: 300000 });
  const page = await browser.newPage();
  await page.setViewport({ width, height });

  // Load the promo
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });

  // Wait for GSAP timeline to be ready
  await page.waitForFunction("window.__promoReady === true", { timeout: 15000 });

  // Pause the timeline and get duration
  const duration = await page.evaluate(() => {
    const tl = window.__tl;
    tl.pause(0);
    return tl.duration();
  });

  const totalFrames = Math.ceil(duration * FPS);
  console.log(`Timeline: ${duration.toFixed(1)}s — ${totalFrames} frames`);

  // Capture each frame — seek timeline, wait for paint, screenshot
  for (let i = 0; i <= totalFrames; i++) {
    const time = i / FPS;
    await page.evaluate((t) => {
      window.__tl.time(t);
      window.__tl.invalidate();
    }, time);

    // Brief delay for CSS/layout to settle
    await new Promise((r) => setTimeout(r, 10));

    const framePath = path.join(framesDir, `frame-${String(i).padStart(5, "0")}.png`);
    await page.screenshot({ path: framePath, type: "png" });

    if (i % FPS === 0) {
      process.stdout.write(`  ${Math.round((i / totalFrames) * 100)}%\r`);
    }
  }

  console.log(`  100% — ${totalFrames + 1} frames captured`);
  await browser.close();

  // Stitch with ffmpeg
  console.log("Encoding MP4...");
  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${framesDir}/frame-%05d.png" ` +
      `-c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow ` +
      `-vf "scale=${width}:${height}" "${mp4Path}"`,
    { stdio: "pipe" }
  );

  // Clean up frames
  fs.rmSync(framesDir, { recursive: true });

  console.log(`\nVideo ready: ${mp4Path}`);
  return mp4Path;
}

// Parse args
const args = process.argv.slice(2);
let dateArg = null;
let formatArg = "vertical";
let runAll = false;

for (const arg of args) {
  if (arg === "--format" || arg === "-f") continue;
  if (arg === "all") { runAll = true; continue; }
  if (FORMATS[arg]) { formatArg = arg; continue; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) { dateArg = arg; continue; }
  const match = arg.match(/^--format[= ](.+)/);
  if (match && FORMATS[match[1]]) { formatArg = match[1]; continue; }
}

(async () => {
  const formats = runAll ? Object.keys(FORMATS) : [formatArg];
  for (const fmt of formats) {
    await recordPromo(dateArg, fmt);
  }
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
