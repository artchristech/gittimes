# 04 — Audio & Production Polish

**Current rating: 5/10**

## Evidence (code-grounded)
- The ffmpeg encode in `record-promo.js` was video-only: `ffmpeg -y -framerate 30 -i frame-%05d.png -c:v libx264 ... out.mp4`. There was **no `-c:a`, no audio input** — every rendered MP4 was silent. On social platforms a silent promo reads as broken or low-effort.
- No poster/thumbnail frame was extracted, so there was no still image for social cards / link previews.
- No fade-in/out on anything audio (there was no audio), and no `-shortest` guard.

## Measurable anchors
- **5/10 anchor:** the rendered MP4 has **no audio stream**. Observable: `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 site/promos/<date>.mp4` prints **nothing** (empty).
- **10/10 anchor:** the MP4 carries an `aac` audio bed (≥128 kbps) built from ffmpeg native generators with a fade-in and fade-out, plus a poster JPG. Observable: the same ffprobe prints `aac`; `ls site/promos/<date>.jpg` exists; and `ffprobe -show_entries stream=bit_rate -select_streams a:0` shows ~192k.

## Prioritized checklist (5 → 10)
1. [x] Build a self-contained audio bed from ffmpeg native generators (`sine` low drone + `anoisesrc` brown ambience), mixed via `amix`, with `afade` in/out. No network, no new dep, no committed asset needed. — **shipped** (`audioBedArgs()` in `record-promo.js`).
2. [x] Mux audio into the encode: `-c:a aac -b:a 192k -shortest`, mapping `0:v:0` + the filtered `[aout]`. — **shipped**.
3. [x] Extract a poster frame ~30% into the clip → `site/promos/<date>.jpg`. — **shipped**.
4. [x] Gate now requires the aac stream (`requireAudio: true`) so a silent render fails. — **shipped**.
5. [ ] Optionally allow a committed royalty-free bed via `PROMO_AUDIO=<path>` override.

## Done when
`ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 site/promos/<date>.mp4` prints `aac`, the bit rate is ~192k, and `site/promos/<date>.jpg` exists.
