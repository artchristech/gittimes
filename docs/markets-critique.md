# AI Markets — Harsh Builder Critique

> **Reviewer persona.** I'm **Dev Rao**, CTO and co-founder of a 9-person startup shipping an agentic code-review product. In June 2026 I'm doing my monthly model re-evaluation: our pipeline burns ~**40M tokens/day** (roughly 70% input / 30% output) and I have a **$6,000/mo inference ceiling**. The decision I came to this page to make: *which model do I run the agent loop on, and do I move our cheap "triage" pass to something even cheaper without tanking SWE-bench-grade accuracy?* I keep Artificial Analysis, OpenRouter's model pages, and LMArena open in three tabs already. The only reason I clicked a *newspaper's* market page is that someone on my team said it "finally looks legit." Let's see if it survives contact with a real decision.
>
> *Evidence I actually looked:* I opened the rendered page and read it top to bottom. The Cost of Intelligence Index reads **$10.35 /M tokens**, the freshness chips say **"Pricing live · synced … "** and **"Evals curated · as of 2026-06-15"**, the Quality Desk tops out at **Claude Opus 4.8 (86.4)**, the Value Frontier flags **Llama 4 Maverick** as "best value," and the speed board shows **Cerebras 969 tok/s on Llama 4 Maverick**. Those are the numbers I'm reacting to below.

---

## Scroll-order walkthrough (in character)

**Masthead.** Fine. "THE GIT TIMES · MARKET DESK," big serif "AI Markets," a standfirst promising "what every frontier model costs, how fast it runs, and how good it actually is." Two chips: a green "Pricing live · synced Xh ago" and a red-dot "Evals curated · as of 2026-06-15." I actually respect the honesty of splitting live-vs-curated up front — most trackers don't. But the standfirst writes a check the page can't cash: it promises *cost, speed, AND quality* for *every* frontier model, and within two scrolls I find quality exists for 11 models, speed for exactly one.

**Hero — Cost of Intelligence Index, $10.35/M.** Pretty. A big number, a 30-day area line, four stat cards (cheapest / highest quality / best value / fastest). My first reaction as a buyer: *$10.35 of what?* It's the unweighted average of 11 hand-picked models' output price. That's a vanity index — it moves when the desk adds or drops a model, not when the market moves. I bill on a 70/30 input/output split; an output-only average is almost irrelevant to my actual cost. The chart had no data the first time I loaded it ("Trend chart builds as daily snapshots accumulate"), so the headline "index" launched with no index.

**Model Evals (Quality Desk).** This is the section that made my team say "legit," and it's the section that makes me trust the page *less*, not more. Opus 4.8 at 86.4 composite, bars for MMLU-Pro / GPQA / SWE-bench Verified / LMArena Elo, labeled "Curated · as of 2026-06-15." It looks exactly like Artificial Analysis. But the chip already told me these are *curated*, and when I open the data the note says the numbers are editorial and not live. So I'm looking at authoritative-looking benchmark bars that are, by the page's own admission, hand-typed. For a builder, a made-up benchmark table rendered with the visual authority of a real one is worse than no table.

**The Value Frontier.** Quality-vs-price scatter, "best value: Llama 4 Maverick." Of course it is — Maverick is the cheapest model on the board ($0.60/M out) so quality-per-dollar (q/$ ≈ 123) mechanically crowns it. That's not an insight, it's an artifact of dividing by a small number. No frontier builder ships their agent loop on the cheapest possible model; I need "best quality above my accuracy floor," and this chart actively points me the wrong way.

**Frontier Board.** Finally a real table: Model / Provider / Quality / Input$ / Output$ / 24h / Context / 30d. Prices are genuinely live (Opus $25/M out, GPT-5.5 $30/M out — matches what I pay). This is the most useful thing on the page. And I can't sort it, filter it, or compare two rows. It's a screenshot of a spreadsheet.

**Inference Speed Leaderboard.** Four rows — Cerebras, SambaNova, Groq, Fireworks — *all running Llama 4 Maverick*. So the page's entire latency story is "here is how fast four providers serve one open model." I'm trying to decide between Opus 4.8 and GPT-5.5 for an agent loop; their tok/s and time-to-first-token are nowhere. This section answers a question nobody on my team is asking.

**Image Generation.** Letter grades A+/A/A- with no rubric. Irrelevant to me, and the subjective grades undercut the data-desk credibility the rest of the page is trying to build.

**More from the desk.** The 310-model OpenRouter catalog is buried in nested `<details>`. The single most valuable raw asset on the page — every priced model — is hidden behind two clicks and, when opened, is an un-sortable, un-filterable wall.

Net: I scrolled the whole thing and I still can't complete a single real decision without opening my other three tabs.

---

## Findings

Format: each finding has **Severity** (Critical / Major / Minor), **Location**, **Why it matters**, **Fix** (must fit the stack: zero-framework, vanilla JS, no build step, strict CSP).

### (1) Information Displayed

**D1 — Editorial eval numbers rendered as authoritative benchmarks.**
- **Severity:** Critical
- **Location:** Model Evals (Quality Desk); composite Quality Index; bars for MMLU-Pro/GPQA/SWE-bench/LMArena.
- **Why it matters:** The chip and `data/ai-models-curated.json` admit these are hand-maintained, not live or independently sourced, yet they're drawn with the same authority as a real leaderboard. If I make a model bet on a typed-in SWE-bench number and it's stale or wrong, that's a production regression I own. A wrong-but-confident benchmark is worse than an absent one.
- **Fix:** Per-datapoint provenance — each cell shows a source + measurement date on hover/footnote; visually downweight curated numbers (italic, "est." tag, lighter rule) so they never read as live; or pull real numbers from a sourced feed and cite per row. Pure markup/CSS change in `src/markets.js`.

**D2 — "Cost of Intelligence Index" is an unweighted, output-only vanity metric.**
- **Severity:** Major
- **Location:** Hero — $10.35/M figure.
- **Why it matters:** It averages 11 cherry-picked models' *output* price with equal weight. It moves when the desk edits its model list, not when the market moves, and ignores input pricing entirely — so it doesn't reflect my real 70/30 spend. As a headline "price of intelligence" it's misleading.
- **Fix:** Define and disclose the methodology inline; offer a blended input+output basis (e.g. 3:1) and, ideally, usage-weight by something defensible. State the basket and weighting next to the number.

**D3 — "Best value = Llama 4 Maverick" is a divide-by-small-number artifact.**
- **Severity:** Major
- **Location:** The Value Frontier; hero "best value" stat card.
- **Why it matters:** Quality-per-dollar always crowns the cheapest model. It nudges builders toward the wrong choice — nobody runs a frontier agent loop on the cheapest model regardless of accuracy. The flagship "value" callout is actively bad advice.
- **Fix:** Reframe as "best quality above a quality floor" with an adjustable threshold, or show the Pareto frontier and label only genuinely non-dominated models. Stop crowning a single "best value."

**D4 — Speed board is a single-model, single-metric sample.**
- **Severity:** Major
- **Location:** Inference Speed Leaderboard (4 rows, all Llama 4 Maverick).
- **Why it matters:** It implies a speed story for "the market" but only covers one open model on four hosts. There's zero speed data for the closed frontier models I'm actually choosing between (Opus, GPT-5.5, Gemini 3.1 Pro), and no time-to-first-token at all.
- **Fix:** Add per-tracked-model tok/s + TTFT columns (curated is fine if labeled), or drop the section's "leaderboard" framing until it covers the tracked set.

**D5 — Image-gen letter grades have no rubric.**
- **Severity:** Minor
- **Location:** Image Generation (A+/A/A-).
- **Why it matters:** Subjective ungrounded grades on a page trying to be a data desk erode trust by association and help no one decide anything.
- **Fix:** Anchor grades to a stated rubric or a cited benchmark (e.g. an arena Elo for image models), or move image-gen to a clearly editorial sidebar.

**D6 — No "last verified" per number; one global as-of date.**
- **Severity:** Major
- **Location:** Quality Desk header ("as of 2026-06-15"); whole page.
- **Why it matters:** One blanket curated date hides which specific numbers are fresh and which are months old. A builder can't tell if the GPT-5.5 SWE-bench figure was updated this week or copied at launch.
- **Fix:** Per-row/per-cell `asOf`, surfaced in the table; flag any datapoint older than N days.

**D7 — Quality Index composite is opaque.**
- **Severity:** Minor
- **Location:** Quality Desk "Quality" column (0–100).
- **Why it matters:** I'm shown an 86.4 with no idea how MMLU/GPQA/SWE-bench/Elo were normalized and weighted. A composite I can't decompose isn't one I'll trust over the underlying benchmarks.
- **Fix:** Document the formula inline (it's a mean of max-normalized metrics); let me see/adjust weights, or at minimum expose the per-metric contribution on hover.

### (2) Information Missing

**M1 — No time-to-first-token / latency for the tracked models.**
- **Severity:** Critical
- **Location:** Whole page (Frontier Board + Speed board).
- **Why it matters:** For an interactive agent loop, TTFT and end-to-end latency are as important as price. I can't pick a model for a latency-sensitive pipeline from this page at all.
- **Fix:** Add TTFT + tok/s columns to the Frontier Board (curated/sourced, dated), per tracked model and ideally per provider.

**M2 — No prompt-caching / cached-input pricing.**
- **Severity:** Critical
- **Location:** Frontier Board pricing columns.
- **Why it matters:** My agent re-sends a large system prompt every call; cached-input pricing changes my real bill by 5–10x and flips which model is cheapest. Without it the "Input$" column is misleading for any cached workload. (The underlying data even *has* `cache_read_price` — it's just not shown.)
- **Fix:** Surface the cache-read price already present in the data as a column or sub-line; note batch pricing where it exists.

**M3 — No tool-use / function-calling / structured-output support or reliability.**
- **Severity:** Critical
- **Location:** Frontier Board.
- **Why it matters:** An agent product lives or dies on reliable tool-calling and JSON-mode. A model's MMLU score tells me nothing about whether its function-calling holds up under load. This is the #1 thing I filter on and it's absent.
- **Fix:** Add boolean/score columns for tool-use, JSON/structured output, parallel tool calls (the data already carries `supported_parameters`); ideally an agentic benchmark (e.g. τ-bench / SWE-bench-agent) beyond a single SWE-bench number.

**M4 — No rate limits / throughput-at-scale / provider uptime.**
- **Severity:** Major
- **Location:** Whole page.
- **Why it matters:** At 40M tokens/day I hit tier rate limits and care about provider reliability and incident history. None of it is here, so I can't judge whether a model is even operable at my volume.
- **Fix:** Add a reliability/limits column or a small "operability" panel (rate-limit tier, recent uptime), sourced from provider status pages.

**M5 — No reasoning/"thinking" token pricing.**
- **Severity:** Major
- **Location:** Frontier Board pricing.
- **Why it matters:** In mid-2026 the reasoning models bill thinking tokens that can dwarf visible output. A flat output-$ column wildly understates the true cost of a reasoning model like DeepSeek R1 on hard tasks.
- **Fix:** Separate reasoning-token pricing/column, or a flag + footnote where thinking tokens are billed.

**M6 — Effective vs advertised context, and knowledge cutoff.**
- **Severity:** Major
- **Location:** Frontier Board "Context" column.
- **Why it matters:** A "1M context" number is marketing; I need usable-context (long-context degradation) and the model's knowledge cutoff to decide if it fits a long-doc agent. Only the advertised number is shown.
- **Fix:** Add knowledge-cutoff column; annotate context with an effective-context note or a long-context benchmark where available.

**M7 — No open-weights flag / self-host cost.**
- **Severity:** Minor
- **Location:** Frontier Board.
- **Why it matters:** Whether a model is open-weights changes my build-vs-buy and data-residency calculus entirely; it's invisible here.
- **Fix:** Open-weights badge + a self-host $/M estimate column.

**M8 — No data-retention / privacy / compliance (zero-retention, region, SOC2/HIPAA).**
- **Severity:** Major
- **Location:** Whole page.
- **Why it matters:** I can't route customer code to a provider that trains on it or won't sign a zero-retention/region commitment. This gates procurement before price even matters, and it's absent.
- **Fix:** Add a compliance/retention column or per-provider note sourced from provider docs.

**M9 — No embeddings/rerankers.**
- **Severity:** Minor
- **Location:** Whole page (model universe is generation-only).
- **Why it matters:** My RAG stack needs embedding + reranker pricing/quality; a "model markets" page that omits them is half a map.
- **Fix:** Add an embeddings/rerankers section with price + a retrieval benchmark.

### (3) Lack of User Interaction

(Confirmed by inspection: `templates/markets.html` contains exactly two `<script>` blocks — a theme bootstrap and a decorative-motion script — and zero click-sort/filter/search handlers. The page is a static document.)

**I1 — Tables don't sort on column click.**
- **Severity:** Critical
- **Location:** Frontier Board, Quality Desk, catalog.
- **Why it matters:** The first thing any builder does on a model table is sort by price, then by quality. I can't. To find the cheapest model above a quality bar I'm reading rows by eye. This single absence makes the most useful section nearly unusable.
- **Fix:** Hand-rolled vanilla JS click-to-sort: an external `markets.js` file (CSP `script-src 'self'` allows it) attaching `addEventListener('click', …)` to `<th>`s, sorting rows from data already in the DOM or an inlined JSON `<script type="application/json">`. ~100 lines, no deps, no build.

**I2 — No filtering (provider / modality / price / context / capability).**
- **Severity:** Critical
- **Location:** Frontier Board + 310-model catalog.
- **Why it matters:** "Show me models with ≥200k context AND function-calling under $5/M output" is the query I actually have. There's no way to narrow 310 models to my shortlist.
- **Fix:** Vanilla-JS filter controls (`<select>`/range inputs) with `addEventListener('input', …)` toggling row visibility; CSP-safe with an external JS file (no inline handlers).

**I3 — No free-text search over the catalog.**
- **Severity:** Major
- **Location:** "More from the desk" → 310-model catalog.
- **Why it matters:** To check one model I expand nested `<details>` and scan by eye. A search box is table stakes for 310 rows.
- **Fix:** A single text input doing case-insensitive substring match over rows in vanilla JS.

**I4 — No model comparison (pick 2–3, diff side by side).**
- **Severity:** Critical
- **Location:** Whole page.
- **Why it matters:** My core decision is Opus 4.8 vs GPT-5.5 vs Gemini 3.1 Pro on price + quality + speed + context together. The page makes me hold three rows in my head across two sections.
- **Fix:** Row checkboxes → a sticky compare panel rendering the selected models' columns side by side; vanilla JS, state in `sessionStorage` or the URL hash.

**I5 — No cost calculator (tokens in/out + volume → $/month).**
- **Severity:** Critical
- **Location:** Hero / Frontier Board.
- **Why it matters:** The decision is financial. I want to type "28M input + 12M output per day" and see each model's monthly cost (ideally with caching). Right now I'm doing arithmetic against a $6k ceiling in my head.
- **Fix:** A small inputs→$/month widget computing from the already-loaded per-model prices; pure client-side vanilla JS.

**I6 — No deep-linkable / shareable filtered views.**
- **Severity:** Major
- **Location:** Whole page.
- **Why it matters:** When I find the shortlist I want to paste a URL to my team that reopens the same filter/sort/compare. Static page = I screenshot it instead.
- **Fix:** Encode filter/sort/compare state in the URL hash; read it on load. No backend, CSP-safe.

**I7 — No unit / currency toggles.**
- **Severity:** Minor
- **Location:** Pricing columns.
- **Why it matters:** Some of us reason in $/1k tokens, some in $/M; non-US teams want their currency. One fixed unit adds friction to every comparison.
- **Fix:** A $/M ↔ $/1k toggle (trivial client-side reformat) and optional currency conversion against a dated rate.

**I8 — Motion is decorative, not functional.**
- **Severity:** Minor
- **Location:** All JS (the motion script: count-up, chart draw-in, reveal-on-scroll).
- **Why it matters:** The page spent its entire JS budget on animation while shipping zero interactivity. The hero chart animates in but I can't hover a point to read the value or date. Polish without function reads as a demo, not a tool.
- **Fix:** Reallocate effort to I1–I5; add hover tooltips/datapoint readouts to the chart and scatter (vanilla SVG `mouseover`).

---

## Top 5 to fix first

1. **I1 — Click-to-sort tables.** Highest leverage per line of code; turns the Frontier Board from a screenshot into a tool and unblocks the most common builder action.
2. **I5 — Cost calculator (tokens→$/month).** The decision is financial; computing real monthly cost against a budget is the page's strongest possible reason to exist over Artificial Analysis.
3. **D1 — Fix eval-number credibility (provenance + visual downweighting).** Until curated numbers stop masquerading as live benchmarks, a builder can't trust anything quantitative here — this poisons the whole quality story.
4. **M3 — Add tool-use / function-calling / structured-output columns.** Agent builders filter on this first; it's the difference between "relevant to my product" and "generic price list," and the data partly exists already.
5. **I2 + I4 — Filtering and model comparison.** Together they let me go from 310 models to a 3-model side-by-side decision without leaving the page — the actual job-to-be-done.

---

## Overall verdict

It's a genuinely handsome page and the live-vs-curated honesty in the masthead is more than most trackers manage — but as a tool for a builder making a real decision in June 2026, it fails. It shows me an output-only vanity index, a quality leaderboard whose numbers are admittedly typed in, a "best value" callout that's a math artifact, a speed board for exactly one model, and then refuses to let me sort, filter, compare, or calculate anything. I left with the same three tabs open I came with. It is, today, a beautiful read-only infographic — not a market desk. The bones (live pricing, a real model table, a 310-model catalog) are good enough that a few hundred lines of dependency-free JS and an honesty pass on the evals would change my answer.

**Grade: C-**
