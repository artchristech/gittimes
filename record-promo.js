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
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { checkRenderedPromo } = require("./src/promo-gate");

const FPS = 30;
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

const FORMATS = {
  vertical:  { width: 1080, height: 1920 },
  square:    { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
};

/**
 * Verify ffmpeg is callable. Fail loud and early rather than after a long capture.
 */
function assertFfmpeg() {
  try {
    execFileSync(FFMPEG, ["-version"], { stdio: "pipe" });
  } catch (err) {
    throw new Error(`ffmpeg not found / not runnable (FFMPEG_BIN=${FFMPEG}): ${err.message}`, { cause: err });
  }
}

/**
 * Build a tasteful, self-contained audio bed using ffmpeg native generators.
 * No network, no new dependency, no external asset. A low sine drone + soft
 * filtered noise "paper rustle" gives the promo a calm newsroom ambience, with
 * a fade-in and fade-out matched to the clip length.
 * Returns the ffmpeg filter_complex + input args appended to the encode command.
 *
 * @param {number} durationS
 * @returns {{ inputs: string[], filter: string, map: string[] }}
 */
function audioBedArgs(durationS) {
  const d = Math.max(1, durationS);
  const fadeOutStart = Math.max(0, d - 1.2);
  // Two synthesized sources mixed: a soft low drone (110Hz) and quiet brown-ish noise.
  const inputs = [
    "-f", "lavfi", "-t", String(d), "-i", "sine=frequency=110:sample_rate=44100",
    "-f", "lavfi", "-t", String(d), "-i", "anoisesrc=color=brown:sample_rate=44100:amplitude=0.04",
  ];
  // Drone gets gentle tremolo + low gain; noise is kept very quiet; mix, then fade.
  const filter =
    `[1:a]volume=0.06,tremolo=f=0.2:d=0.6[drone];` +
    `[2:a]volume=0.10,highpass=f=200,lowpass=f=2500[amb];` +
    `[drone][amb]amix=inputs=2:duration=first:normalize=0,` +
    `afade=t=in:st=0:d=1.0,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=1.2[aout]`;
  return { inputs, filter, map: ["-map", "0:v:0", "-map", "[aout]"] };
}

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

  // Fail loud and early if ffmpeg is missing — before a long frame capture.
  assertFfmpeg();

  // Create temp frames directory
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });

  console.log(`Recording ${dateStr} [${format} ${width}x${height}] @ ${FPS}fps...`);

  const launchArgs = ["--disable-features=IsolateOrigins,site-per-process"];
  if (process.env.CI) launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");

  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 600000,
    args: launchArgs,
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height });

  // Load the promo
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });

  // Wait for GSAP timeline to be ready. If the CDN (GSAP/fonts) fails offline,
  // __promoReady never flips — fail LOUD with a clear cause instead of hanging
  // or recording a blank/broken clip.
  try {
    await page.waitForFunction("window.__promoReady === true", { timeout: 15000 });
  } catch {
    const hasTl = await page.evaluate(() => typeof window.__tl !== "undefined").catch(() => false);
    await browser.close().catch(() => {});
    throw new Error(
      `Promo never became ready (window.__promoReady stayed false after 15s). ` +
        `__tl present: ${hasTl}. Likely cause: the GSAP or Google Fonts CDN could not be fetched ` +
        `(offline?). The promo HTML requires network access for those CDN assets.`
    );
  }

  // Pause the timeline and get duration
  const duration = await page.evaluate(() => {
    const tl = window.__tl;
    tl.pause(0);
    return tl.duration();
  });

  const totalFrames = Math.ceil(duration * FPS);
  console.log(`Timeline: ${duration.toFixed(1)}s — ${totalFrames} frames`);

  try {
    for (let i = 0; i <= totalFrames; i++) {
      const time = i / FPS;

      // Retry loop for transient detached-frame errors
      let attempts = 0;
      while (true) {
        try {
          await page.evaluate((t) => {
            window.__tl.time(t);
            window.__tl.invalidate();
          }, time);

          // Brief delay for CSS/layout to settle
          await new Promise((r) => setTimeout(r, 15));

          const framePath = path.join(framesDir, `frame-${String(i).padStart(5, "0")}.png`);
          await page.screenshot({ path: framePath, type: "png" });
          break;
        } catch (err) {
          attempts++;
          if (attempts >= 3 || !err.message.includes("detached")) throw err;
          // Wait and retry — frame may reattach after GC/layout
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      if (i % FPS === 0) {
        process.stdout.write(`  ${Math.round((i / totalFrames) * 100)}%`);
      }
    }

    console.log(`  100% — ${totalFrames + 1} frames captured`);
    await browser.close();

    // Stitch with ffmpeg + mux a synthesized audio bed (fade in/out).
    console.log("Encoding MP4 (with audio bed)...");
    const audio = audioBedArgs(duration);
    execFileSync(
      FFMPEG,
      [
        "-y",
        "-framerate", String(FPS),
        "-i", `${framesDir}/frame-%05d.png`,
        ...audio.inputs,
        "-filter_complex", audio.filter,
        ...audio.map,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "18",
        "-preset", "slow",
        "-vf", `scale=${width}:${height}`,
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        mp4Path,
      ],
      { stdio: "pipe" }
    );

    // Extract a poster/thumbnail frame (~30% into the clip) for social cards.
    const posterPath = path.resolve(promoDir, `${dateStr}${suffix}.jpg`);
    try {
      execFileSync(
        FFMPEG,
        ["-y", "-ss", (duration * 0.3).toFixed(2), "-i", mp4Path, "-frames:v", "1", "-q:v", "3", posterPath],
        { stdio: "pipe" }
      );
      console.log(`Poster: ${posterPath}`);
    } catch (e) {
      console.warn(`Poster extraction skipped: ${e.message}`);
    }

    // Quality gate: assert the render is real (non-empty, h264, exact dims,
    // duration > 10s, has aac audio). Throws / exits non-zero on any failure.
    const report = checkRenderedPromo(mp4Path, { format, requireAudio: true });
    console.log(
      `Gate OK: ${report.width}x${report.height} ${report.duration.toFixed(1)}s ` +
        `${report.codec}+${report.audio} ${(report.bytes / 1024).toFixed(0)}KB`
    );
  } finally {
    // Always clean up frame dir, even if capture or ffmpeg threw
    if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
    if (browser.connected) await browser.close().catch(() => {});
  }

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
