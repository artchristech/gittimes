#!/usr/bin/env node
/**
 * Promo render quality gate.
 *
 * Asserts that a rendered promo MP4 is real and playable:
 *   - file exists and is non-empty (> MIN_BYTES)
 *   - has an h264 video stream
 *   - dimensions EXACTLY match the expected format
 *   - duration is within the expected window (> MIN_DURATION_S)
 *   - (optional) has an aac audio stream when requireAudio is set
 *
 * Throws on any failure (so callers exit non-zero). Fails CLOSED: a missing
 * ffprobe, a 0-byte file, a truncated file, or wrong codec/dims all throw.
 *
 * Usage (CLI):
 *   node src/promo-gate.js <mp4> [format] [--no-audio]
 *   format ∈ vertical|square|landscape (default vertical)
 */
const { execFileSync } = require("child_process");
const fs = require("fs");

const FFPROBE = process.env.FFPROBE_BIN || "/opt/homebrew/bin/ffprobe";

const FORMATS = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
};

const MIN_BYTES = 100 * 1024; // 100 KB — a real multi-second h264 clip is far larger
const MIN_DURATION_S = 10; // task contract: must be longer than 10s
const MAX_DURATION_S = 180; // sanity ceiling — a runaway timeline is also a failure

/**
 * @param {string} mp4Path
 * @param {object} opts
 * @param {string} [opts.format="vertical"]
 * @param {boolean} [opts.requireAudio=false]
 * @param {number} [opts.minDuration=MIN_DURATION_S]
 * @param {number} [opts.maxDuration=MAX_DURATION_S]
 * @returns {{ ok: true, codec: string, width: number, height: number, duration: number, audio: string|null, bytes: number }}
 * @throws Error on any failed assertion
 */
function checkRenderedPromo(mp4Path, opts = {}) {
  const format = opts.format || "vertical";
  const requireAudio = !!opts.requireAudio;
  const minDuration = opts.minDuration != null ? opts.minDuration : MIN_DURATION_S;
  const maxDuration = opts.maxDuration != null ? opts.maxDuration : MAX_DURATION_S;

  const expect = FORMATS[format];
  if (!expect) throw new Error(`promo-gate: unknown format "${format}"`);

  // 1. File exists and is non-empty / non-truncated.
  if (!fs.existsSync(mp4Path)) {
    throw new Error(`promo-gate: MP4 does not exist: ${mp4Path}`);
  }
  const bytes = fs.statSync(mp4Path).size;
  if (bytes < MIN_BYTES) {
    throw new Error(`promo-gate: MP4 too small (${bytes} bytes < ${MIN_BYTES}) — likely 0-byte or truncated: ${mp4Path}`);
  }

  // 2. Probe streams + format. execFileSync throws non-zero / on missing ffprobe.
  let raw;
  try {
    raw = execFileSync(
      FFPROBE,
      [
        "-v", "error",
        "-show_entries", "stream=codec_type,codec_name,width,height",
        "-show_entries", "format=duration",
        "-of", "json",
        mp4Path,
      ],
      { encoding: "utf-8" }
    );
  } catch (err) {
    throw new Error(`promo-gate: ffprobe failed (is ${FFPROBE} present?): ${err.message}`, { cause: err });
  }

  let probe;
  try {
    probe = JSON.parse(raw);
  } catch {
    throw new Error(`promo-gate: could not parse ffprobe output for ${mp4Path}`);
  }

  const streams = probe.streams || [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  if (!video) throw new Error(`promo-gate: no video stream in ${mp4Path}`);

  // 3. Codec.
  if (video.codec_name !== "h264") {
    throw new Error(`promo-gate: video codec is "${video.codec_name}", expected "h264"`);
  }

  // 4. Exact dimensions.
  if (+video.width !== expect.width || +video.height !== expect.height) {
    throw new Error(
      `promo-gate: dimensions ${video.width}x${video.height}, expected ${expect.width}x${expect.height} (${format})`
    );
  }

  // 5. Duration window.
  const duration = parseFloat((probe.format && probe.format.duration) || "0");
  if (!(duration > minDuration)) {
    throw new Error(`promo-gate: duration ${duration.toFixed(2)}s is not > ${minDuration}s`);
  }
  if (duration > maxDuration) {
    throw new Error(`promo-gate: duration ${duration.toFixed(2)}s exceeds ceiling ${maxDuration}s`);
  }

  // 6. Audio (optional).
  if (requireAudio) {
    if (!audio) throw new Error(`promo-gate: no audio stream in ${mp4Path} (audio required)`);
    if (audio.codec_name !== "aac") {
      throw new Error(`promo-gate: audio codec is "${audio.codec_name}", expected "aac"`);
    }
  }

  return {
    ok: true,
    codec: video.codec_name,
    width: +video.width,
    height: +video.height,
    duration,
    audio: audio ? audio.codec_name : null,
    bytes,
  };
}

module.exports = { checkRenderedPromo, FORMATS, MIN_BYTES, MIN_DURATION_S };

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const mp4 = args.find((a) => !a.startsWith("--") && !FORMATS[a]);
  const format = args.find((a) => FORMATS[a]) || "vertical";
  const requireAudio = !args.includes("--no-audio");
  if (!mp4) {
    console.error("Usage: node src/promo-gate.js <mp4> [vertical|square|landscape] [--no-audio]");
    process.exit(2);
  }
  try {
    const r = checkRenderedPromo(mp4, { format, requireAudio });
    console.log(
      `OK ${r.width}x${r.height} ${r.duration.toFixed(1)}s ${r.codec}` +
        (r.audio ? `+${r.audio}` : "") +
        ` ${(r.bytes / 1024).toFixed(0)}KB`
    );
  } catch (err) {
    console.error("GATE FAIL:", err.message);
    process.exit(1);
  }
}
