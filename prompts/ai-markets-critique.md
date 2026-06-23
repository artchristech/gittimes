Roleplay a frontier AI builder in **June 2026**, scroll through the Git Times "AI Markets" page (gittimes.com/markets) top-to-bottom **in character**, reason about the actual state of AI as of June 2026, and produce a HARSH, first-person critique written as a single markdown file. You are NOT changing any code. You are writing a review.

This is a persona-driven deliverable. The entire critique must read as a named, opinionated person doing a live scroll-and-react, then crystallizing their reactions into a structured findings section. Do not write a detached audit. Write what this specific person sees, thinks, and curses at as they scroll.

# Problem

The Git Times "AI Markets" page was just overhauled and nobody has stress-tested it against its actual target user: a builder who has to make a real model-selection decision on a real budget. Write a critique markdown file at `/Users/christopherharris/projects/gittimes/docs/markets-critique.md` that opens with a concrete first-person persona, narrates a top-to-bottom scroll of the page in that voice, and then resolves into a structured findings section covering three explicit buckets — (1) information DISPLAYED, (2) information MISSING, (3) lack of USER INTERACTION — with severity-tagged findings, a ranked "Top 5 to fix first", a blunt overall verdict, and a letter grade.

# Context

The Git Times is an AI newspaper for builders (gittimes.com). The page under review is "AI Markets" at gittimes.com/markets — "the daily price of intelligence." Zero-framework Node.js: no site build step, server-side string-templated static HTML/CSS, vanilla JS, strict CSP (`script-src 'self' 'unsafe-inline'`; no CDN libs). The page was just overhauled. Any fix you propose must fit that stack — no framework, no bundler, no CDN libraries; interactivity must be hand-rolled vanilla JS under the CSP.

Current sections, in scroll order (rendered by `src/markets.js` into `templates/markets.html`):
1. **Editorial masthead** — kicker "THE GIT TIMES · MARKET DESK", "AI Markets" headline, italic standfirst "The daily price of intelligence — what every frontier model costs, how fast it runs, and how good it actually is.", two freshness chips (green "Pricing live · synced Xh ago"; red-dot "Evals curated · as of 2026-06-15").
2. **Hero — Cost of Intelligence Index** — big $-figure (avg output $/Mtok over 11 tracked models) + 30-day area chart + 4 stat cards (cheapest frontier / highest quality / best value / fastest).
3. **Model Evals (Quality Desk)** — 11 models ranked by a composite Quality Index (0–100) with bars for MMLU-Pro, GPQA Diamond, SWE-bench Verified, LMArena Elo. Labeled "Curated · as of 2026-06-15". **The eval numbers are editorial placeholders, NOT independently sourced or live** — treat undisclosed/under-cited placeholder data presented with authoritative bars as a credibility problem, not a layout problem.
4. **The Value Frontier** — inline-SVG scatter, Quality vs output price; "best value" called as Llama 4 Maverick (cheap wins quality-per-dollar — arguably a misleading default).
5. **Frontier Board** — one table: Model / Provider / Quality / Input$ / Output$ / 24h delta / Context / 30d sparkline. Prices live from OpenRouter daily. No function-calling / latency / throughput columns.
6. **Inference Speed Leaderboard** — 4 curated rows (Cerebras / SambaNova / Groq / Fireworks), all on "Llama 4 Maverick" (thin, uniform, single-model sample).
7. **Image Generation** — ~7 models, price/img + an editorial letter grade (A+/A/A-).
8. **"More from the desk"** (collapsed `<details>`) — New on the Market, On Our Radar (untracked frontier models), full 310-model OpenRouter catalog by provider.

11 tracked models: Claude Opus 4.8, Claude Sonnet 4.6, GPT-5.5, GPT-5.4, Gemini 3.1 Pro, Gemini 3.5 Flash, Grok 4.20, DeepSeek V3.2, DeepSeek R1, Llama 4 Maverick, Mistral Large.

Interaction reality: the page is ENTIRELY static — no sort, filter, search, compare, cost calculator, recommender, unit/currency toggles. The only JS is decorative motion (count-up, chart draw-in, reveal-on-scroll), gated behind `prefers-reduced-motion`. Tables do not sort on click; the 310-model catalog is only browsable via nested `<details>`. The June-2026 builder mentally benchmarks this against the trackers they already keep open (Artificial Analysis, OpenRouter model pages, LMArena) which offer live sourced benchmarks plus sort/filter and far more metrics (TTFT, throughput, context, function-calling, uptime) — reason about that gap where relevant.

**Known dead ends:** none yet — no prior critique exists.

# Inputs

- Repo root: `/Users/christopherharris/projects/gittimes`
- Browser preview (open this): `/Users/christopherharris/projects/gittimes/scratch/markets-preview.html`
- Re-render the preview if stale (run from repo root): `node scratch/render-markets.js scratch/markets-preview.html`
- Renderer: `/Users/christopherharris/projects/gittimes/src/markets.js`
- Template + CSS + motion: `/Users/christopherharris/projects/gittimes/templates/markets.html`
- Curated data (tracked models, speed, images, evals block w/ `asOf`/`note`/`sources`): `/Users/christopherharris/projects/gittimes/data/ai-models-curated.json`
- Live OpenRouter pricing + 310-model catalog (`syncedAt`): `/Users/christopherharris/projects/gittimes/data/ai-models.json`
- Live page (fallback if preview won't render): `https://gittimes.com/markets`
- Competitor references to reason against (do not fetch unless useful): `https://artificialanalysis.ai`, `https://openrouter.ai/models`, `https://lmarena.ai` (unverified)
- Output file to write: `/Users/christopherharris/projects/gittimes/docs/markets-critique.md` (create the `docs/` dir if absent)

# Constraints

- Do NOT modify any page code, template, renderer, or data file. The only file you create or write is the critique markdown.
- You MUST actually open the page (preview file in a browser, or the live URL) before writing — no reviewing from the source code alone. Cite at least two concrete, observed details (exact figures, labels, or section text) as proof you looked. If the preview path/command is wrong, inspect `src/markets.js` + `templates/markets.html` to find the real one, or fall back to the live page, and note the discrepancy.
- Stay in first person, in character, for the whole narrative section. Invent a concrete persona: give them a name, a role (e.g. CTO / solo founder), and a specific product + budget decision they are on this page to make in June 2026 (e.g. "I'm picking the model to run our agentic code-review pipeline at ~40M tokens/day on a $6k/mo ceiling").
- Reason from the real June-2026 AI landscape — the persona should react to whether the tracked models, prices, and framing match what a working builder actually believes that month.
- Every finding must be tagged with: a severity (`Critical` / `Major` / `Minor`), the page location/section, why it matters to the persona's decision, and one concrete fix that fits the stack (zero-framework / vanilla JS / no build / strict CSP).
- Minimum **18 findings total**, with **at least 5 in each of the three buckets**.
- Treat the undisclosed placeholder eval data as a first-class `Critical`/`Major` credibility finding, not a footnote.
- Markdown only. No code changes. No end-of-document recap beyond the required verdict.

# Definition of done

A file exists at `/Users/christopherharris/projects/gittimes/docs/markets-critique.md` such that all of the following are observably true:

1. It opens with a named first-person persona block stating who they are, their role, and the exact product + budget model-selection decision they came to the page to make in June 2026.
2. It contains a **scroll-order narrative** section, in first person, that walks the page top-to-bottom and reacts to each major section (masthead → hero → evals → value frontier → frontier board → speed → image gen → more-from-desk), citing at least two exact observed figures/labels from the page.
3. It contains a **structured findings** section with three explicit, clearly headed buckets: **(1) Information Displayed**, **(2) Information Missing**, **(3) Lack of User Interaction**.
4. There are **≥18 findings total**, with **≥5 per bucket**, and every finding carries a `Severity:` tag of `Critical`, `Major`, or `Minor`, plus a location, a why-it-matters, and a concrete stack-compatible fix.
5. The placeholder/undisclosed eval-data issue appears as an explicit `Critical` or `Major` finding.
6. It contains a ranked **Top 5 to fix first** ordered list (exactly 5 items), each naming the finding and a one-line why-first justification.
7. It ends with a blunt **Overall verdict** paragraph in the persona's voice **and** a single **letter grade** (e.g. `Grade: C-`).

# Verification

Run these from the repo root and confirm each passes:

1. File exists: `test -f /Users/christopherharris/projects/gittimes/docs/markets-critique.md && echo OK`
2. Persona present (first-person + role + decision): `grep -iE "I'm|I am|my role|budget|tokens/day|/mo|selecting|picking|decision" /Users/christopherharris/projects/gittimes/docs/markets-critique.md | head`
3. Three buckets present: `grep -iE "Information Displayed|Information Missing|(Lack of )?User Interaction" /Users/christopherharris/projects/gittimes/docs/markets-critique.md`
4. Severity tags present and counted (expect ≥18): `grep -coE "Severity:\s*(Critical|Major|Minor)" /Users/christopherharris/projects/gittimes/docs/markets-critique.md`
5. Each bucket has ≥5 findings: split on the bucket headings and count `Severity:` tags in each section, e.g. `awk '/Information Displayed|Information Missing|User Interaction/{s=$0} /Severity:/{c[s]++} END{for(k in c)print c[k],k}' /Users/christopherharris/projects/gittimes/docs/markets-critique.md` (expect each ≥5).
6. Scroll narrative cites real page text: `grep -iE "Cost of Intelligence Index|Quality Index|Value Frontier|Frontier Board|Maverick|2026-06-15|Market Desk" /Users/christopherharris/projects/gittimes/docs/markets-critique.md`
7. Placeholder-eval credibility finding present: `grep -iE "placeholder|editorial|not (independently )?sourced|unsourced|curated" /Users/christopherharris/projects/gittimes/docs/markets-critique.md`
8. Top-5 list present: `grep -niE "Top 5 to fix first" /Users/christopherharris/projects/gittimes/docs/markets-critique.md` and confirm exactly 5 numbered items follow.
9. Verdict + letter grade present: `grep -iE "Overall verdict|Grade:\s*[A-F]" /Users/christopherharris/projects/gittimes/docs/markets-critique.md`
10. Confirm the page was actually opened: the file references at least two concrete observed details (figures/labels) that only appear when the page is rendered — spot-check against `scratch/markets-preview.html` (re-render with `node scratch/render-markets.js scratch/markets-preview.html` if missing) or the live page.
11. No page code changed: `cd /Users/christopherharris/projects/gittimes && git status --porcelain` shows only `docs/markets-critique.md` as added/modified (no edits to `src/`, `templates/`, or `data/`).

<!-- prompt-out v1 -->
