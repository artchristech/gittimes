# Git Times desk — successor briefing

_Written 2026-09-03 from the repo at `main` 897355c, the `gh-pages` branch, the GitHub Actions run history, and the two open PRs. Christopher hands editorial and product to the desk; the coding agent that wrote this keeps the repo until the desk briefs a new one. Nothing below is from memory of prior sessions — it is all re-derived from files and logs today._

**How to read the flags.** `GUESS:` marks something inferred but not verified. `UNVERIFIABLE FROM HERE:` marks something that needs a person with credentials or a browser (this sandbox cannot reach gittimes.com, the Cloudflare Worker, or the VPS).

---

## 1. Repos, branches, and the publish path

**One repo.** `https://github.com/artchristech/gittimes`. Default branch `main`. There is no README; `CONTEXT.md` and `BUILDLOG.md` are the orientation docs. Tests: `npm test` (986 passing today, ~10 s). Lint: `npm run lint` (clean).

**The site is the `gh-pages` branch, served by GitHub Pages.** `CNAME` on that branch is `gittimes.com`; DNS A-records point at GitHub Pages' four IPs. `CONTEXT.md` says "fronted by Cloudflare" — GUESS: if so it is DNS-only (grey-cloud), because the apex resolves to GitHub, not Cloudflare. Nothing in the repo references Fastly; Fastly is only GitHub Pages' own CDN.

**Three other deploy surfaces exist and must not be confused with the site:**

| Surface | Where | How it deploys |
|---|---|---|
| Chat / accounts / Stripe / newsletter | Cloudflare Worker `gittimes-chat` at `https://gittimes-chat.mandalazenwave.workers.dev` | `cd worker && wrangler deploy` (owner-authed), or `.github/workflows/deploy-worker.yml` on push to `worker/**` if the `CF_API_TOKEN` repo secret exists |
| Agent REST API + editor's desk | `api-server.js` on a VPS (`66.55.144.173`, `/home/chris/gittimes`, systemd units in `deploy/`) | `deploy/DEPLOY.md`. **`api.gittimes.com` has no DNS record today** (see §6) |
| Model price catalog | `data/ai-models.json` on `main` | `.github/workflows/sync-models.yml`, 05:00 UTC daily, commits "chore: sync AI model pricing data" — that is why `main`'s recent history is all bot commits |

**What regenerates today's edition.** `.github/workflows/daily-edition.yml`:

- Cron `0 7 * * *` UTC. Note the runs on Sep 1–3 actually started around 12:00 UTC, five hours late; August runs started 07:35–08:20 UTC. GUESS: GitHub scheduler delay, not a config change.
- Manual: Actions → "Daily Edition" → Run workflow → tick **`skip_newsletter`**. CLI: `gh workflow run "Daily Edition" -f skip_newsletter=true`. Always tick it for a same-day republish — the Worker's `/newsletter/send` has no per-date dedup and a second publish double-sends.
- Steps, in order: checkout `main` → Node 20 → `apt-get install ffmpeg` → `npm ci` → `npm test` → checkout `gh-pages` into `site/` → `node src/sync-models.js` → **`node publish-edition.js`** → `peaceiris/actions-gh-pages` pushes `site/` to `gh-pages` with `keep_files: true` → on failure, `gh issue create --label pipeline-failure`.
- Locally: `npm run publish` (= sync-models + `publish-edition.js`) with a `.env` holding `GITHUB_TOKEN`, `OPENROUTER_API_KEY`, `PUBLISH_DIR=./site`. It syncs `site/` from `origin/gh-pages` first. Pushing the result to `gh-pages` is manual (no script). `node publish-edition.js --dry-run` generates and validates without writing.

**UI-only changes never go through a publish.** `public/chat.js` and `public/search.js` are copied to the site root on every publish, so the rule from `CONTEXT.md` stands: commit the file to `main` *and* push it surgically to `gh-pages` via a worktree (`deploy/publish-account-page.sh` is the pattern). Both files are byte-identical between `main` and `gh-pages` today.

## 2. The daily pipeline, step by step

`publish-edition.js` → `src/pipeline.js` → `src/publish.js`. Everything below is fail-soft unless marked **FATAL**.

1. **Preconditions.** `GITHUB_TOKEN` and `OPENROUTER_API_KEY` missing → exit 1 before any work.
2. **Memory.** Reads `site/editions/manifest.json`: repo names from the last 7 editions (excluded from today), lead repos from the last 3 (excluded from lead), coverage map from the last 7 ("Previously in The Times"), and the last 3 front pages as thread context for the editor-in-chief prompt.
3. **The SQLite question.** `data/gittimes.db` is gitignored. In CI it is created empty each run and re-hydrated from `manifest.json` + `history.json` (`src/db.js` ~line 648). Editions and star snapshots survive that; **`model_prices` (the price tape), `entity_events`, `featured_releases`, `edition_meta`, `lead_slate`, `editor_picks` do not.** GUESS, but I read the code twice: in CI the Price Board always falls back to the rolling ticker window, the registry's "tracked since" restarts daily, and the editor's desk rulings only influence the lead on a machine that keeps its DB (the VPS). The logs print `Price tape: N day(s) on file` — check that line in a recent run to confirm.
4. **GitHub Search** (`src/github.js`, REST `search/repositories`, token from Actions):
   - Front page, query A: `created:>{7d ago} stars:>50`, sort stars, 30 results.
   - Front page, query B: `stars:>1000 pushed:>{3d ago}`, sort updated, 30 results. This is where `curl/curl`, `pytorch`, `kubernetes` come from.
   - Per section (`src/sections.js`: ai, robotics, cyber, systems, diy, gameDev): `topic:{t} stars:>30 pushed:>{3d}` (15 each) and `language:"{l}" stars:>100 pushed:>{3d}` (15 each).
   - Enrichment: `/releases/latest`, README, star trajectories via GraphQL. **The GraphQL calls fail on every CI run** with "Resource not accessible by integration" (the default Actions token lacks the scope). Non-fatal; trajectories are simply absent in CI. A PAT in a repo secret would fix it.
5. **Editorial plan** (`src/editorial.js`): breakout / trend / sleeper picks from star deltas in `site/editions/history.json`. Lead eligibility (`src/recency.js`): a release or creation date inside 7 days; windows 7/21/45. Editor's desk rulings (`src/desk.js`) injected if any exist.
6. **Generation** (`src/xai.js`). OpenAI SDK pointed at `https://openrouter.ai/api/v1`, 120 s timeout, `p-retry` 2 retries (aborts on non-429 4xx). Model `LLM_MODEL`, default **`nvidia/nemotron-3-super-120b-a12b:free`**. Lead chosen by `chooseLeadPrompt` plus lens votes. Article calls are wrapped and fall back to the repo description. **FATAL:** the quick-hits call at `src/xai.js:388` is not wrapped — one exhausted retry there aborts the whole run. That is exactly what killed Sep 1 (§6).
7. **Bands**, all wrapped: AI ticker (`src/ai-ticker.js` from `data/ai-models.json`), AI Wire (HN + arXiv, `src/ai-headlines.js`), Model Drops (Hugging Face, `src/model-drops.js`, plus one LLM headline call), GitHub Releases (`src/github-releases.js` watchlist + registry companies), Business desks and company registry (`src/registry.js`, `src/desks.js`), Price Board (`src/price-board.js`), Pushups.
8. **Validate** (`validateContent`). Errors → exit 1. `--dry-run` stops here.
9. **Publish** (`src/publish.js`). Writes `site/editions/YYYY-MM-DD/index.html` and per-article pages, `site/latest/`, `site/index.html`, archive, markets, prices, business pages, `subscribe/`, `account/`, `desk/`, `pricing/`, `docs/` + `docs/openapi.json`, `feed.xml`/`feed.atom`, copies `chat.js` + `search.js`, **rebuilds `site/data/corpus.json` from the DB** (step 15b), writes `.nojekyll` and `CNAME`, updates `manifest.json`.
10. **After publish**: telemetry to `edition_meta`; `history.json` snapshot; ticker snapshot; **newsletter** via Worker `/newsletter/send` (Bearer `NEWSLETTER_SECRET`) unless `SKIP_NEWSLETTER=true`; promo video via Puppeteer + ffmpeg to `site/promos/`; promos gallery.
11. **Deploy** pushes `site/` to `gh-pages`.

**Run time.** Whole workflow 22–28 minutes on a normal day (Aug 20–Sep 3 sample); one 63-minute outlier on Aug 26. Generation itself is roughly 15–20 of those minutes.

**Failure behaviour.** Exit 1 → deploy step skipped → `gh-pages` untouched, yesterday's edition stays as `/latest/`. Then two things that are supposed to happen, don't:
- The alert step fails every time: `could not add label: 'pipeline-failure' not found`. The repo has zero issues. Nobody is notified.
- `retry-edition.yml` waits 15 min and re-dispatches, claiming up to 3 runs/day. In practice it fires **once**: the retry is dispatched with `GITHUB_TOKEN`, and that run's completion does not raise a `workflow_run` event, so a second failure is final. Observed on Sep 1. It also only matches `conclusion == failure`, so a *cancelled* run (Aug 19) never retries.

**corpus.json.** Two copies. The committed `data/corpus.json` was built 2026-06-29 (699 chunks) and is now only a test fixture (`test/corpus.test.js` skips if absent). The live one is `gh-pages:data/corpus.json`: 2,348 chunks, 133 edition chunks from 2026-02-27 to 2026-09-03, 559 KB, rebuilt on every publish.

## 3. Search as it actually works today

**Client.** `public/search.js`, ~330 lines, ES5, no dependencies, loaded by `templates/newspaper.html` (`<script defer src="/search.js">`) and injected after `.masthead` on every edition page. A bar reading "Ask the archive… /" opens a full-page layer; `/` opens, `Esc` closes; the page is wrapped once in `.gt-fold` and frozen with a transform ("the fold"). Corpus is fetched lazily from `/data/corpus.json` on hover or first open, ~560 KB per new visitor.

**Scoring** (`score()` in `search.js`):
- Lowercase, split on whitespace. No stemming, no stopwords, no tokenization — plain substring match.
- Every term must appear somewhere or the chunk scores 0.
- Per term: +4 if in `title`, +3 if in `repo`, +1 if in `text`.
- Sort by score, tie-break newest date. Top 24. 90 ms debounce. Empty query shows the 12 newest edition chunks.
- Fewer than 3 results, and chat is loaded (`body.chat-on`) → an "Ask the AI Desk" card hands the query to `window.__gtChat.ask(q)`.

**Chunk shape** (`src/build-corpus.js`), one per repo ever covered plus one per edition:

```json
{ "type": "repo", "date": "2026-06-24", "repo": "Blinue/Magpie",
  "title": "Magpie scales Windows apps with GPU-powered resolution upscaling",
  "text": "Blinue Magpie Blinue/Magpie Magpie scales Windows apps …",
  "url": "/editions/2026-06-24/", "stars": 14025, "appearances": 1, "i": 0 }
```

`text` is capped at 240 chars and is *headline only* — repo words + most recent headline, or for editions headline + subhead + tagline. No article bodies, no section, no topics, no "the catch". A repo covered five times gets one chunk with `appearances: 5` and only its latest headline.

**The desk uses a different ranker.** Worker chat grounds on the same file with BM25 + 45-day recency half-life, k=6, min score 2.5 (`src/retrieve.js`, inlined verbatim in `worker/index.js` — keep them byte-identical). So a query can find 20 clippings in search and ground nothing in chat, or vice versa.

**What to change first to make "Ask the archive" real** (ordered by leverage):
1. **Put the reporting in the corpus.** Add a ~300-char excerpt (first paragraph + "The catch") and the section id to each repo chunk, and one chunk per *appearance* rather than per repo. Bodies live in `site/editions/DATE/…/index.html`; `build-corpus.js` already runs after they are written. This is the change that turns keyword hits into answers.
2. **One ranker.** Port `tokenize` + `scoreChunks` from `src/retrieve.js` into `search.js` (it is dependency-free; ES5-ify) so search and desk agree, and keep the substring rule only for `owner/name` matches.
3. **A URL.** Read `?q=` on load and open the fold; `history.replaceState` on type; emit `/search/` from `publish.js`. Today a search result cannot be linked or indexed.
4. **Fix the handoff.** The "Ask the AI Desk" card shows for anyone with chat loaded, but a free or signed-out reader who clicks it hits the Premium wall (§4).

## 4. AI Desk

**Worker.** Name `gittimes-chat`, `worker/index.js` (~2,200 lines, zero-build, zero-dep). URL `https://gittimes-chat.mandalazenwave.workers.dev`, baked into every page as `window.__WORKER_URL` from the `CHAT_WORKER_URL` repo secret. KV namespaces `SUBSCRIBERS`, `USERS`, `SESSIONS`, `MAGIC_LINKS` (ids in `wrangler.toml`). `ALLOWED_ORIGIN = https://gittimes.com`. Hourly cron reconciles lapsed grace periods. All account and payment state is KV keyed by email — there is no SQL on the money path.

**Auth (magic link).** `POST /auth/send-magic-link` → 64-hex token in `MAGIC_LINKS` (15-min TTL) → email via Resend from `EMAIL_FROM` or `The Git Times <noreply@gittimes.com>` → `GET /auth/verify?token=` → 30-day session in `SESSIONS` → browser stores it in `localStorage['gittimes-session']` and sends `Authorization: Bearer`. Disposable-email and per-IP rate limits on both. `MAGIC_LINK_ENABLED = "true"`. A Clerk path exists (`POST /auth/clerk-exchange`; `wrangler.toml` points at a **dev** instance `humble-hermit-34.clerk.accounts.dev`) and `/account/` only mounts Clerk when the `CLERK_PUBLISHABLE_KEY` + `CLERK_FRONTEND_API` repo secrets are set. UNVERIFIABLE FROM HERE whether they are; the published page decides at publish time.

**Stripe.** `GET /checkout?session_token=` → hosted Checkout, `$5/mo` (`STRIPE_PRICE_ID`; `?interval=annual` uses `STRIPE_PRICE_ID_ANNUAL` if set). `POST /stripe/webhook` handles `checkout.session.completed` (flip to premium, owner alert to `ALERT_EMAIL`), `customer.subscription.deleted`, `invoice.payment_failed` (3-day grace), `invoice.paid` (clear grace). `POST /billing/portal`. `GET /pricing` returns the display price. A 100%-off promo `CPHnews` is referenced in the docs.

**What Premium gates: the entire desk.** `FREE_DAILY_CHAT_LIMIT = "0"`, so a free account gets `429 {"upgrade":true, "message":"The AI Desk is part of Premium…"}` before any model call; anonymous gets `400`. Premium: `CHAT_MONTHLY_LIMIT = "1000"` turns/month, model `CHAT_MODEL = "openai/gpt-4o-mini"` via OpenRouter, BM25 grounding with `[n]` citations, intent-gated repo tool-use and compares, optional streamed thinking, saved answers, server-side transcript memory. 30 requests/min per IP.

**Free-vs-paid copy mismatches (real, in the templates today):**
- `templates/pricing.html` lines 10 and 12 (the `og:description` and `meta description`) say **"Free daily, or $5/mo"** and **"Free and $5/mo Premium plans for the AI Desk"**. The FAQ on the same page says the desk is Premium-only. Search engines and link previews show the first version.
- `templates/account.html` line 282 promises **"Unlimited AI chat"**; the cap is 1,000/month.
- `public/chat.js` line 190: the paywall button reads **"Sign in — it's free"** when signed out. The sign-in is free; asking is not. A reader signs up and immediately meets a second wall.
- `public/search.js`: the "Ask the AI Desk" card copy ("Put the question to the desk") makes no mention of Premium.
- `docs/first-conversion-sim.md` and `docs/build-out-sheet.md` still describe a 3-questions-a-day free wall. That was the old setting; do not plan from them.

## 5. Secrets, by name only

**GitHub Actions secrets** (Settings → Secrets → Actions):
- `GITHUB_TOKEN` — automatic. Enough for search and REST; **not** enough for the GraphQL star-trajectory calls (fail every run, non-fatal).
- `OPENROUTER_API_KEY` — missing → `publish-edition.js` exits 1 immediately. No edition.
- `CHAT_WORKER_URL` — missing → pages render with no chat FAB and no "Ask about this" buttons, `search.js` never offers the desk, newsletter skipped.
- `NEWSLETTER_SECRET` — missing → newsletter skipped, non-fatal.
- `CLERK_PUBLISHABLE_KEY`, `CLERK_FRONTEND_API` — missing → `/account/` renders the magic-link form. Harmless.
- `CF_API_TOKEN` — missing → `deploy-worker.yml` prints a skip message; Worker deploys stay manual.
- Variable `PLAUSIBLE_DOMAIN` — missing → no analytics script.

**Worker secrets** (`cd worker && wrangler secret put NAME`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `STRIPE_PRICE_ID_ANNUAL` (optional), `OPENROUTER_API_KEY`, `RESEND_API_KEY`, `NEWSLETTER_SECRET`, `ADMIN_TOKEN`, `CLERK_SECRET_KEY` (optional). Breakage: no `RESEND_API_KEY` → every magic link returns 502 "Could not send the sign-in email" and nobody can sign in unless Clerk is wired; no `STRIPE_SECRET_KEY` → checkout and webhook fail; no `OPENROUTER_API_KEY` → chat fails for paying users; `NEWSLETTER_SECRET` mismatch with the repo secret → newsletter 401; no `ADMIN_TOKEN` → `/admin/stats` 401 and the funnel is unreadable (`CONTEXT.md` said it was unset on 2026-07-02; UNVERIFIABLE FROM HERE now). `deploy/worker-preflight.sh` checks all of this if you have `wrangler` and `gh` logged in.

**Local `.env`** (`.env.example`): `GITHUB_TOKEN`, `OPENROUTER_API_KEY`, `LLM_MODEL`, `CHAT_WORKER_URL`, `X_SENTIMENT`, `PLAUSIBLE_DOMAIN`.

**VPS** (`deploy/publish.env`, `deploy/api.env`, both gitignored): `GITHUB_TOKEN`, `OPENROUTER_API_KEY`, `GT_ADMIN_EMAIL`, `GT_WORKER_URL`, `GT_ADMIN_TOKEN`, and the dormant x402 set (`X402_RECEIVER`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`). All 404/off if unset by design.

**Hygiene.** `worker/.dev.vars` is gitignored but `BUILDLOG.md` (2026-06-18) records it once held a live xAI key. Confirm it was rotated. The owner alert address in `wrangler.toml` (`ALERT_EMAIL`) is config, not a secret.

## 6. Known holes: intentional or broken

**Missing edition days.** On `gh-pages` the archive has no edition for **2026-08-19**, **2026-09-01**, and the whole stretch **2026-05-20 → 2026-06-21**. Also 2026-08-19 and 09-01 are absent from `manifest.json`, so "Previous edition" links skip them cleanly.
- **2026-09-01 — broken, upstream + our own bug.** Run 282 (12:28 UTC): OpenRouter's free `nvidia/nemotron-3-super-120b-a12b:free` returned "No choices returned" on every call, then "404 Provider returned error". Articles fell back, but the unwrapped quick-hits call (`src/xai.js:388`) exhausted its retries and threw: `Publishing failed: No choices returned`. Retry run 283 at 12:47 failed identically; no third attempt for the reason in §2. Fix in two lines: wrap the quick-hits call like the article calls, and put a paid fallback in `LLM_MODEL`. Logs: `https://github.com/artchristech/gittimes/actions/runs/33507889040` and `…/33509644708`.
- **2026-08-19 — broken, infra.** Run 269 hung inside `apt-get install ffmpeg` for six hours until GitHub's job limit cancelled it. Because the conclusion was *cancelled*, not *failure*, neither the alert nor the retry fired. Fix: `timeout-minutes: 45` on the job and `cancelled` in the retry condition; consider a prebuilt ffmpeg.
- **May 20 → Jun 21 — UNVERIFIABLE FROM HERE.** The Actions list I pulled starts Aug 6. GUESS: a deliberate pause or a broken key; `BUILDLOG.md` has an entry on 06-18 about the xAI→OpenRouter migration ("chat widget 502s… xAI billing lapsed"), which fits a lapsed provider.
- **Alert step — broken every time.** `gh issue create --label pipeline-failure` fails because the label does not exist. Create the label once, or drop `--label`. Until then failures are silent.

**Stale evals (2026-07-09) — intentional design, stale in practice.** `data/ai-models-curated.json` → `evals.asOf = "2026-07-09"`, three models, hand-curated scores from LMArena / Artificial Analysis, rendered on `/markets/` as "Evals curated · as of 2026-07-09" with an "est." marker. The file's own note says scores are "hand-maintained by the desk and dated" — so the date is honest, but it is now eight weeks old and the ticker has moved on (Grok 4.6, DeepSeek V4 Pro 0813, Kimi K3 on today's banner). This is an editorial task, not a code task: update the numbers and `asOf`, or add a rule that hides the section past N days.

**`/api` 404 vs `localhost:3717` docs — an unfinished deploy, not a choice.** `gittimes.com/api/*` is GitHub Pages and will always 404; the REST API is `api-server.js` (port 3717) meant to live at `api.gittimes.com` on the VPS. That hostname has **no DNS record**. The published `/docs/` page and `docs/openapi.json` list only `http://localhost:3717` as a server; `docs/agent-api.md` says `https://api.gittimes.com`. The `/desk/` page (editor's desk bridge) also posts to `https://api.gittimes.com` by default (`GT_API_URL`), so it is dead too. Two honest options: (a) finish `deploy/DEPLOY.md` (DNS A-record → 66.55.144.173, nginx rate-limit vhost, certbot, `GT_ADMIN_EMAIL`), or (b) unlink `/docs/` and `/desk/` from the site until then and point agents at `mcp-server.js` (stdio) instead. UNVERIFIABLE FROM HERE whether the VPS is even running.

**Duplicate curl WebSocket leads — broken, two ways.** 2026-08-10 led with "Curl 8.21.0 Adds WebSocket Support for Real-Time Data Transfer"; 2026-09-03 led with "Curl 8.22.0 Adds WebSocket Support for Real-Time Data Transfers". Both came in through query B (`stars:>1000 pushed:>3d`) and qualified as leads on a fresh release tag.
- *Repeat*: lead dedup looks back 3 editions and repo dedup 7 editions; 24 days apart passes both. The "Previously in The Times" coverage map also only looks back 7 editions, so the prompt never saw the August story.
- *Claim*: curl has shipped `ws://` / `wss://` support since 7.86 (2022), non-experimental for a while now. GUESS from public curl history, but I would bet on it: the model saw a release tag plus a README mention of WebSocket and wrote "adds". The enrichment already fetches `/releases/latest`, which carries the real release notes; the lead prompt should be required to source the hook from that body, and the coverage lookback for *leads* should be 30+ editions.

## 7. What is in flight, what to read first, who decides

**This session.** Branch `claude/git-times-briefing-5240pw` is `main` plus this document. No code changes are in flight from this session. I did not run a publish, deploy anything, or touch `gh-pages`.

**Open on GitHub:**
- [PR #12 — Business surfaces](https://github.com/artchristech/gittimes/pull/12) (Aug 21, 4 commits, 18 files, +1,949). Curated YC startup roster, Big Labs "ships only", Sectors page. Based on a `main` from before the Aug 21 desk/price-board commits; GUESS: conflicts. Asks Christopher one editorial question (which companies count as "unicorn").
- [PR #13 — Ox Alpha radar](https://github.com/artchristech/gittimes/pull/13) (Aug 26, 1 commit, +723). Changes `src/sync-models.js` so a free stealth model is not rejected by the price gate; adds an arrival ledger. No owner action beyond merge.
- Six stale branches (`catalog-format`, `feat/editor-in-chief-v2`, `feat/star-velocity-and-age-badge`, `fix/honest-preview-and-deck`, `claude/elon-musk-skills-uja9fv`). GUESS: all superseded; delete after a glance.

**Last human work on `main`:** 2026-08-21 (Price Board, provenance canvas, desk fixes). Everything since is the pricing bot.

**Read first, in this order:** `CONTEXT.md` (dated 07-02; the "load-bearing facts" section is still right, the deploy-state section is not) → `.github/workflows/daily-edition.yml` → `publish-edition.js` → `src/publish.js` → `worker/wrangler.toml` → `public/search.js` + `src/build-corpus.js` → `deploy/WORKER_DEPLOY.md` → `docs/editors-desk.md` → `docs/build-out-sheet.md`. `BUILDLOG.md` is the narrative (last entry 08-07). `prompts/*.md` are twelve planning specs, some shipped, some not; treat as history.

**Already decided (do not re-litigate):**
- Front page leads on FLOW (what shipped) not STOCK (what is popular); evergreen voice is banned in the prompts.
- AI Desk is Premium-only at $5/mo on `gpt-4o-mini`; free accounts read the paper and get the newsletter.
- Two deploy surfaces: editorial changes go through a publish; UI/JS changes go surgical to `gh-pages` and mirrored on `main`. Never deploy UI via a publish.
- The editor's desk records rulings after the fact; nobody hand-places a lead.
- Marketing and distribution work is out of scope for the product build-out (the `GT-FLAT` claim in `docs/build-out-sheet.md`).
- Generation runs on a free OpenRouter model by default so an edition costs $0.

**Christopher still decides:**
1. Merge, rework, or close PR #12 and #13.
2. Whether the desk stays Premium-only. This sets the search→desk handoff copy and the pricing meta tags.
3. Whether to pay for generation (`LLM_MODEL` → a paid model, or a paid fallback after the free one fails). Sep 1 is the cost of not deciding.
4. Bring `api.gittimes.com` up, or unlink `/docs/` and `/desk/`.
5. Who owns the evals numbers on `/markets/` and how stale is acceptable.
6. Clerk go-live (currently pointed at a dev instance) versus staying on magic links.
7. The x402 agent paywall and MCP hosting — both dormant, both need a wallet or a host before any code matters.

## 8. If search ships first this week: the smallest change list, in order

1. **Copy, no deploy risk.** Fix `templates/pricing.html` lines 10 and 12 to match the FAQ; `templates/account.html` line 282 to say "1,000 questions a month"; `public/chat.js` line 190 to "Sign in" (drop "it's free"). Goes live on the next publish; `chat.js` also needs the surgical `gh-pages` copy.
2. **Gate the handoff.** In `public/search.js`, only render the "Ask the AI Desk" card when `window.__gtChat` reports the reader can ask (premium, or `freeDailyLimit > 0`); otherwise show "Premium readers can put this to the desk" with the pricing link. Surgical deploy.
3. **One ranker.** Replace `score()`/`search()` in `public/search.js` with the BM25 + recency from `src/retrieve.js`, ES5-ified, keeping an exact-substring boost for `owner/name`. Add a test that runs the same three queries through both and asserts the same top-3. Surgical deploy.
4. **Richer chunks.** In `src/build-corpus.js`, emit one chunk per (repo, edition) with `section`, `excerpt` (first paragraph + "The catch" from the article HTML, ~300 chars), and raise `MAX_TEXT` to 400. Watch the file size: 2,348 chunks are 559 KB today; per-appearance chunks with excerpts will be 1.5–2 MB. Gzip on Pages makes that ~400 KB; if that is too much, ship a light index for search and keep the full file for the Worker. Requires a publish (`skip_newsletter=true`).
5. **A URL.** `?q=` opens the fold on load; `history.replaceState` while typing; add `site/search/index.html` in `src/publish.js` so the masthead bar can be a link. Same publish.
6. **Measure.** One Plausible event on open and one on "no results" so the desk sees what readers ask. Needs `PLAUSIBLE_DOMAIN` set.

Do steps 1–3 Monday and push them surgically; they are three files and change nothing about generation. Steps 4–5 ride the same publish. Step 6 is ten lines whenever analytics is on.

---

_Everything in §6 marked "broken" is small: the alert label, the quick-hits wrap, a job timeout, a lookback constant. None of them are in the open PRs. The one hole that is not small is the API hostname, and that is a decision, not a bug._
