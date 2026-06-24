# 05 — Automation & Distribution

**Current rating: 5/10**

## Evidence (code-grounded)
- `package.json` had **no `promo` script**. Producing a video required manually running `node generate-promo.js <date>` then `node record-promo.js <date> <format>` — two steps, easy to forget one, no gate between them.
- The daily CI (`.github/workflows/daily-edition.yml`) does **not** run the promo, so the pipeline was rarely exercised and drifted (the extractor broke against new markup and nobody noticed).
- Edition selection was implicit and order-fragile: `generateEditionPromo` tried `editions/<date>` then `latest`, but the recorder, run separately, could pick a stale `*.html` if the generate step silently failed.
- No single command produced a *verified* artifact, and no thumbnail/captions were produced for distribution.

## Measurable anchors
- **5/10 anchor:** there is no one-command path; `node -e "console.log(!!require('./package.json').scripts.promo)"` prints `false`, and producing a verified video requires ≥2 manual commands with no gate.
- **10/10 anchor:** a single `npm run promo` chains select-edition → generate → record → quality-gate and exits non-zero on any failure. Observable: `node -e "console.log(!!require('./package.json').scripts.promo)"` prints `true`; `npm run promo -- <date>` exits 0 and ends with a `GATE OK ...` line; the script prints the exact edition source and reason used.

## Prioritized checklist (5 → 10)
1. [x] Add `npm run promo` → `node run-promo.js`, a single orchestrator chaining generate + record + gate. — **shipped**.
2. [x] Implement explicit, reported edition selection in `run-promo.js`: `editions/<date>` → `latest` → most-recent `editions/*`, logging which source and why. — **shipped**.
3. [x] Add `npm run promo:gate` for ad-hoc verification of any rendered MP4. — **shipped**.
4. [x] Add `run-promo.js`/`record-promo.js`/`generate-promo.js` to the lint scope so the pipeline stays clean. — **shipped** (lint script updated).
5. [ ] (Recommendation, optional) Add a **separate, non-blocking** CI job (`continue-on-error: true`, manual or post-publish trigger) that runs `npm run promo` so drift is caught — must NOT be on the daily publish critical path.

## Done when
`node -e "console.log(!!require('./package.json').scripts.promo)"` prints `true`, and `npm run promo -- <date>` completes exit 0 with a final `GATE OK` line and a printed edition source + reason.
