**Problem**

The Git Times promo video creation pipeline needs a full audit, a concrete improvement plan, code-level improvements, and proof that it actually produces a real, playable promo video for today's edition (2026-06-23). Your job has five required deliverable groups — partial completion is failure:

1. Investigate and critique the existing promo video pipeline.
2. Rate it 5/10 across EXACTLY 5 named categories, and write 5 markdown guideline files (one per category) describing how to take each from 5/10 to 10/10. Each category's critique must be expressed as a measurable rubric (a concrete 5/10 anchor and a concrete 10/10 anchor — a number, a file that exists, or a command that passes — never adjectives alone).
3. IMPLEMENT the improvements you describe, in the code (real edits, not doc-only).
4. CREATE a new promo video for today's edition and PROVE the MP4 truly rendered (correct codec, exact dimensions, real duration, non-zero size).
5. Verify everything and report.

The single biggest failure mode — and the thing this prompt exists to prevent — is an executor that declares success without an actual, verified, playable MP4 on disk. A script that "ran without error", an empty/truncated file, a 0-byte MP4, a still image, or a 2-second clip all count as FAILURE. You must end with a video that ffprobe confirms is h264, exactly the chosen dimensions, and longer than 10 seconds.

**Context**

Git Times is an AI-generated newspaper for builders, live at gittimes.com. Stack: Node.js, better-sqlite3, puppeteer (already a dependency), and ffmpeg/ffprobe at `/opt/homebrew/bin/`. The promo pipeline turns a published edition's HTML into an animated, self-contained HTML promo (GSAP via CDN, newspaper aesthetic, 5 scenes), then records it frame-by-frame with puppeteer and stitches PNGs into an MP4 with ffmpeg.

How the pipeline fits together:
- `generate-promo.js [YYYY-MM-DD]` calls `src/promo.js` `generateEditionPromo(outDir, dateStr)`, which writes `site/promos/<date>.html`.
- `src/promo.js` (~690 lines): `extractEditionData()` regex-parses an edition's `index.html` (tries `site/editions/<date>/index.html`, then `site/latest/index.html`, then fetches `https://gittimes.com`) into `{date, tagline, lead{headline,sub,repo,repoUrl}, sections}`. `generatePromoHtml()` builds the animated HTML and exposes `window.__tl` (the GSAP timeline) and `window.__promoReady`. Aesthetic: Playfair Display / IBM Plex Sans / JetBrains Mono, paper `#faf8f5`, ink `#1a1a1a`, accent `#8b0000`, SVG film grain. 5 scenes: masthead, lead with a floating-headline morph, section headlines, pull-quote, CTA.
- `record-promo.js [YYYY-MM-DD] [vertical|square|landscape|all]`: puppeteer loads the promo via `file://`, waits up to 15s for `window.__promoReady`, pauses `window.__tl`, computes `totalFrames = ceil(duration*30)`, steps the timeline frame-by-frame screenshotting PNGs into a temp `.frames` dir, then ffmpeg stitches them (libx264, crf 18, preset slow, scaled to format dims) into `site/promos/<date>.mp4` (or `-square`/`-landscape`). Default format is `vertical` = 1080x1920. There is a detached-frame retry loop.

The EXACTLY 5 categories you must use (verbatim): (1) Visual Design & Motion, (2) Editorial Content & Copy, (3) Technical Robustness & Reliability, (4) Audio & Production Polish, (5) Automation & Distribution. For each category, the markdown file and your critique must state a measurable 5/10 anchor and a measurable 10/10 anchor. Example of the required sharpness — for "Technical Robustness & Reliability": 5/10 = "no quality gate; the pipeline can emit a 0-byte or partial-scene MP4 with exit code 0"; 10/10 = "a gate asserts the MP4 is non-empty, h264, correct dims, duration>10s, and exits non-zero on any failure." Every improvement you implement must trace back to a specific 5→10 gap in its category's file.

Known dead ends: `extractEditionData()` returns `null` and only logs if it cannot find a lead headline — a real, silent failure that produces no usable promo; the daily CI workflow (`.github/workflows/daily-edition.yml`) does NOT run the promo, so it is rarely exercised; today's edition (`site/editions/2026-06-23/`) may not exist yet because the daily cron runs at 07:00 UTC, so blindly recording `2026-06-23` may fail or silently fall back; `window.__promoReady` can time out (15s) if the GSAP/font CDN fetch fails offline, yielding either a hang or a bad recording; ffmpeg can produce a 0-byte or truncated file without throwing in a way the script catches; long timelines can hit puppeteer `protocolTimeout`. The ONLY existing rendered output is `site/promos/2026-03-19.mp4` (from March) — do not mistake it for proof of today's run, and do not delete it. There is currently NO `npm run promo` script and NO automated check that any rendered video is correct — adding both is central to this task. Do NOT swap GSAP for another engine or remove the `window.__tl`/`window.__promoReady` capture contract (record-promo.js depends on it). Do NOT rewrite `extractEditionData()` into a full DOM parser or add a parsing dependency — keep it regex-based and harden it. If you add audio, build it from ffmpeg's native generators (`sine`/`anoisesrc`/`aevalsrc`) or a committed royalty-free file — no network fetch, no new dep, no secrets.

**Inputs**

- `/Users/christopherharris/projects/gittimes` — project root (cwd for all commands).
- `/Users/christopherharris/projects/gittimes/generate-promo.js` — promo HTML generator entry point.
- `/Users/christopherharris/projects/gittimes/src/promo.js` — extraction + HTML generation (~690 lines).
- `/Users/christopherharris/projects/gittimes/record-promo.js` — puppeteer + ffmpeg recorder.
- `/Users/christopherharris/projects/gittimes/package.json` — scripts: `generate`, `sync-models`, `publish`, `test` (`node --test test/*.test.js`), `lint` (`npx eslint src/ worker/ test/ generate.js publish-edition.js`), `mcp`, `api`. NO promo script yet.
- `/Users/christopherharris/projects/gittimes/site/editions/` — published editions, one dir per date (`<date>/index.html`).
- `/Users/christopherharris/projects/gittimes/site/editions/2026-06-22/index.html` — most recent known edition (unverified it is newest at run time).
- `/Users/christopherharris/projects/gittimes/site/editions/2026-06-23/` — TODAY's edition (unverified; may not exist).
- `/Users/christopherharris/projects/gittimes/site/latest/index.html` — copy of latest edition (unverified).
- `/Users/christopherharris/projects/gittimes/site/promos/` — promo output dir; `site/promos/2026-03-19.mp4` is the only existing MP4 (stale, from March).
- `/Users/christopherharris/projects/gittimes/src/render.js` — the site renderer that produces the edition markup the extractor regexes against (read it to harden extraction).
- `/Users/christopherharris/projects/gittimes/src/sections.js` — `SECTIONS` config (labels) used by the extractor.
- `/Users/christopherharris/projects/gittimes/.github/workflows/daily-edition.yml` — daily CI (unverified exact contents; does not run promo).
- `/Users/christopherharris/projects/gittimes/test/` — existing `*.test.js`, run via `node --test test/*.test.js`.
- `/Users/christopherharris/projects/gittimes/docs/promo-guidelines/` — write the 5 guideline markdown files here (create the dir).
- `/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/ffprobe` — video tooling (verify presence before recording).

Read the three pipeline files and `package.json` in full before changing anything. Do not invent file contents — confirm by reading. Verify any `(unverified)` path with `ls` before relying on it.

**Constraints**

- Do NOT commit, push, open a PR, or run `git` write operations. Leave changes in the working tree.
- Include no secrets, tokens, or API keys anywhere in code, docs, or output.
- Use EXACTLY these 5 categories, each scored 5/10, with one markdown file each, at these paths:
  - `docs/promo-guidelines/01-visual-design-and-motion.md`
  - `docs/promo-guidelines/02-editorial-content-and-copy.md`
  - `docs/promo-guidelines/03-technical-robustness-and-reliability.md`
  - `docs/promo-guidelines/04-audio-and-production-polish.md`
  - `docs/promo-guidelines/05-automation-and-distribution.md`
  Each file must contain: the category name, the current 5/10 rating with code-grounded evidence, a measurable 5/10 anchor and 10/10 anchor (observables, not adjectives), a prioritized checklist of changes to reach 10/10, and a checkable "Done when" line.
- No heavy new dependencies — reuse the existing puppeteer + ffmpeg path. Preserve the newspaper aesthetic exactly (fonts/palette/grain). Preserve the `window.__tl`/`window.__promoReady` capture contract.
- Keep `extractEditionData()` regex-based; harden it (defensive defaults + fail-loud on missing required fields) — fix the silent-null failure so a video can still be produced (or fail loudly with a clear message) rather than silently producing nothing.
- Do not touch the worker, Stripe, or x402 code. Do not break the daily CI and do not put video rendering on the daily critical path (wiring promo into CI is a recommendation only / optional and must be gated so it cannot fail the existing publish job).
- Improvements you implement must NOT break existing behavior: `npm test` and `npm run lint` must still pass after your changes. Add at least one new promo-related test under `test/`.
- Implement at least one real, shipped code change per category. Concrete targets (do as many as feasible without violating the constraints):
  - Automation: add a single `npm run promo` script that chains generate + record + the quality gate end-to-end.
  - Technical Robustness: add an automated post-render quality gate (a function/script) that asserts the MP4 is non-empty, h264, correct dimensions, and duration in the expected window, and exits non-zero / throws on failure; fix the silent `extractEditionData()` null path; handle `__promoReady` timeout, missing ffmpeg, and 0-byte/truncated output by failing loudly.
  - Audio & Production Polish: mux an audio bed into the recorder's ffmpeg invocation (built from ffmpeg native generators or a committed royalty-free file) with fade-in/out (`-shortest -c:a aac -b:a 192k`), so output MP4s contain a real audio stream; optionally extract a poster/thumbnail frame (`site/promos/<date>.jpg`).
  - Editorial Content & Copy: improve what edition data is surfaced and how copy is fit/truncated (e.g. graceful handling of long headlines, sane fallbacks); optionally generate a `.srt`/`.vtt` caption track from the edition copy.
  - Visual Design & Motion: address a concrete motion/legibility gap (e.g. text-overflow guard, pacing tunable, scene timing) consistent with the aesthetic.
- Edition selection for the final video is MANDATORY and explicit, in this order: if `site/editions/2026-06-23/index.html` exists, use it; else if `site/latest/index.html` exists, use it; else use the most recent dir under `site/editions/*`. Record which source was actually used and report it.
- The final recorded format must be one concrete format (default `vertical` = 1080x1920). State the format and its exact expected dimensions before recording, then assert them after.

**Definition of done**

All of the following must be objectively true and demonstrated in your final report:

1. The 3 pipeline files and `package.json` were read in full, and a written critique exists naming concrete weaknesses tied to specific files/lines, with an explicit 5/10 rating for each of the exactly 5 named categories plus its measurable 5/10 and 10/10 anchors.
2. Exactly 5 markdown files exist at `/Users/christopherharris/projects/gittimes/docs/promo-guidelines/` (the five paths above), each non-empty and containing the 5/10 rationale, the 5/10 and 10/10 anchors, the prioritized 5→10 checklist, and a "Done when" line. Confirm with a directory listing.
3. Code improvements are implemented in the working tree, at least one per category, including at minimum: a fix for the silent `extractEditionData()` null failure, a new `npm run promo` script in `package.json`, an automated render-correctness quality gate, and an audio stream in the rendered MP4. List the files changed and what each change does, mapping each to its category file.
4. At least one new promo-related test exists under `test/` and passes.
5. `npm test` passes (exit 0) and `npm run lint` passes (exit 0) AFTER your changes. Paste the final lines of each.
6. A NEW promo MP4 for the chosen edition exists on disk under `site/promos/`, distinct from the stale `site/promos/2026-03-19.mp4`. Report the absolute path, the edition source used (per the mandatory fallback order), and the chosen format + expected dimensions.
7. `ffprobe` proves the new MP4 is real and playable: video codec is `h264`, width and height EXACTLY match the chosen format (e.g. 1080 and 1920 for vertical), duration > 10 seconds, and file size > 0 bytes (in practice well over 100 KB). If you added audio, an `aac` audio stream is present. Paste the raw ffprobe output you relied on.
8. The new MP4's modification time is from this run (today), not the March file.

If any item cannot be satisfied, STOP and report exactly which one, why, the exact command and error output, and what you tried — do NOT claim success.

**Verification**

Run these from `/Users/christopherharris/projects/gittimes`. The video assertions are the heart of this task — do not declare done until they pass. Paste actual output.

1. Tooling present:
   - `/opt/homebrew/bin/ffmpeg -version | head -1` and `/opt/homebrew/bin/ffprobe -version | head -1` both succeed.
   - `node -e "require('puppeteer'); console.log('puppeteer ok')"` — confirm headless capability.
2. Edition source: `ls -la site/editions/2026-06-23 site/editions/2026-06-22 site/latest 2>&1` — establish which source exists; state the date you rendered and why.
3. Guideline files exist (expect exactly 5):
   - `ls -1 docs/promo-guidelines/*.md | wc -l` → 5
   - `ls -1 docs/promo-guidelines/`
4. Tests and lint still green AFTER changes:
   - `npm test 2>&1 | tail -20` → exit 0 (paste final lines)
   - `npm run lint 2>&1 | tail -20` → exit 0 (paste final lines)
5. `npm run promo` exists and produced the new video:
   - `node -e "console.log(!!require('./package.json').scripts.promo)"` → `true`
   - Run the promo command for the chosen date; it must complete with exit code 0. Identify the new MP4 path (call it `$MP4`); confirm it is NOT `site/promos/2026-03-19.mp4`.
6. The MP4 is non-empty and newer than the stale file:
   - `stat -f '%z %m %N' "$MP4"` → size clearly > 100000 and a modification time from today.
7. ffprobe correctness assertions (MUST all pass; paste raw output):
   - `/opt/homebrew/bin/ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of default=noprint_wrappers=1 "$MP4"` → `codec_name=h264`, `width=1080`, `height=1920` (or the exact dims of the format you chose).
   - `/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "$MP4"` → duration > 10.0.
   - If you added audio: `/opt/homebrew/bin/ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1 "$MP4"` → `codec_name=aac`.
   - Single hard gate (must print `OK`):
     `/opt/homebrew/bin/ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -show_entries format=duration -of json "$MP4" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=j.streams[0];const dur=parseFloat(j.format.duration);if(v.codec_name==="h264"&&+v.width===1080&&+v.height===1920&&dur>10){console.log("OK",v.width+"x"+v.height,dur.toFixed(1)+"s")}else{console.error("FAIL",JSON.stringify({v,dur}));process.exit(1)}})'`
     (Adjust the 1080/1920 literals if you deliberately chose square/landscape; state the change.)
8. Quality gate fails closed: trigger it against a deliberately empty/0-byte MP4 and show it exits non-zero (proves the gate actually guards), then passes on the real render.

In your final report include: the critique, the 5/10 ratings per category with their 5/10→10/10 anchors, the list of guideline files, the list of code changes with rationale mapped to categories, the test/lint final lines, the new MP4 absolute path + edition source + format, and the raw ffprobe output including the `OK ...` line from the hard gate. If the gate did not print `OK`, you are not done.

<!-- prompt-out v1 -->
