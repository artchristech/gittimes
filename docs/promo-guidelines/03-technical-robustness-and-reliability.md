# 03 — Technical Robustness & Reliability

**Current rating: 5/10**

## Evidence (code-grounded)
- **Silent null:** `generateEditionPromo()` (`src/promo.js`) did `if (!data.lead.headline) { console.error(...); return null; }`. Combined with the stale extractor, every real edition silently produced **nothing** — the failure mode this whole effort targets.
- **No quality gate:** `record-promo.js` ran `ffmpeg ... { stdio: "pipe" }` and on success printed "Video ready" with **no verification**. ffmpeg can write a 0-byte or truncated MP4 and still exit 0; nothing asserted codec, dimensions, or duration. A partial render was indistinguishable from a good one.
- **Readiness timeout swallowed:** `page.waitForFunction("window.__promoReady === true", {timeout:15000})` would reject and bubble as a generic error; offline (CDN fetch fail) meant a confusing crash, not a clear cause.
- **ffmpeg presence unchecked:** a missing binary was discovered only *after* a multi-minute frame capture.

## Measurable anchors
- **5/10 anchor:** no quality gate; the pipeline can emit a 0-byte or partial-scene MP4 with exit code 0. Observable: `: > /tmp/x.mp4 && node record-promo.js ... ; echo $?` could print `0` against junk output, and `generateEditionPromo` returns `null` (not throw) on missing headline.
- **10/10 anchor:** a gate asserts the MP4 is non-empty (>100 KB), h264, exact dims, duration in (10s, 180s), aac audio present, and exits non-zero on any failure; the silent-null path **throws** with a diagnostic. Observable: `node src/promo-gate.js /tmp/empty.mp4; echo $?` prints `1`; `node src/promo-gate.js site/promos/<date>.mp4 && echo PASS` prints `OK ... ` then `PASS`.

## Prioritized checklist (5 → 10)
1. [x] New `src/promo-gate.js` `checkRenderedPromo()` — asserts existence, size floor, h264, exact dims, duration window, optional aac; throws / exits non-zero on failure (fails closed). — **shipped**.
2. [x] Replace silent `return null` on missing lead headline with a thrown `Error` naming the file checked and what was extracted. — **shipped**.
3. [x] Wrap the `__promoReady` wait; on timeout, close the browser and throw a clear "CDN/offline" diagnostic including whether `__tl` exists. — **shipped** in `record-promo.js`.
4. [x] `assertFfmpeg()` before frame capture; switch shell `execSync` string to `execFileSync` (no shell injection surface). — **shipped**.
5. [x] Run the gate inside `record-promo.js` after encode AND again in `run-promo.js`. — **shipped**.
6. [x] Unit tests prove the gate fails closed on missing / 0-byte / junk files and that generation throws on missing headline. — **shipped** in `test/promo.test.js`.

## Done when
`node src/promo-gate.js /tmp/empty.mp4; echo $?` → `1`; `node src/promo-gate.js site/promos/<date>.mp4` prints an `OK ...` line; and `node --test test/promo.test.js` shows the "fails closed" and "fail-loud" suites passing.
