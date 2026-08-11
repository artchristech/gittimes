# The Editor's Desk

A private admin surface for ruling on front pages *after* they're printed. You never
change the paper that ran — you say what should have led, and that ruling is fed
forward into the next edition's lead decision as standing editorial policy.

The point is taste transfer, not puppeteering. The editor-in-chief still chooses;
it just now knows what you keep telling it.

## The loop

```
publish  ──▶ lead_slate      (the candidates today's lead was chosen from)
                  │
   /admin ──▶ editor_picks   (your ruling: "X led, but Y should have — because…")
                  │
        distill ──▶ editor_rubric  (many rulings → one short house rule)
                  │
next publish ◀── buildDeskBlock()  (rulings injected into the lead prompt)
```

Nothing here can take an edition down. Every step is fail-soft: with no rulings on
file, `buildDeskBlock()` returns `null` and the lead prompts are byte-identical to
what they were before the desk existed.

## Turning it on

The desk is off unless a token is set. No token, no admin surface at all — the page
and every `/api/admin/*` route 404 as if they were never written.

```bash
openssl rand -hex 32   # put the result in GT_ADMIN_TOKEN (deploy/api.env)
```

Then restart the API and open `/admin`. Paste the token once; the browser keeps it
in `localStorage`. Serve it behind the same nginx TLS as the rest of the API — the
token is the only thing guarding the ruling log.

## Ruling

Each edition shows the slate the lead was chosen from, with the story that actually
led marked `LED`. Pick the one that should have led, write one sentence saying why,
save.

- Picking a *different* story records an **override**.
- Picking the story that already led records a **confirm** — do this sometimes. A
  corpus made only of corrections teaches "avoid what the editor hates", never
  "find what the editor loves".
- One ruling per edition; saving again replaces it. Withdrawing removes it.

**The "why" is the highest-value field and the one you'll be tempted to skip.** It
is what makes the rubric possible; the repo names alone don't generalize.

Because the ruling is retrospective, you can use hindsight — you know by now which
story mattered a week later. That's better editorial signal than a live pick.

## The rubric

Injecting two hundred one-line rulings into a prompt doesn't scale. Once you have a
handful on file, compress them:

```bash
npm run rubric          # distill and store
npm run rubric -- --dry-run
npm run rubric:show
```

The distilled house rule leads the desk block, followed by the most recent rulings
verbatim. Re-run it whenever the corpus grows meaningfully.

## Data

| Table | What it holds |
| --- | --- |
| `lead_slate` | The candidate slate per edition, ranked, with the chosen one flagged. Recorded at publish. |
| `editor_picks` | One ruling per edition: verdict, what led, what should have led, why. |
| `editor_rubric` | The single distilled house rule. |

Rulings are also mirrored to `data/editor-picks.jsonl` — append-only, one JSON object
per line, including the slate they were ruled against. That file is the durable
training corpus; it survives independent of sqlite and is what you'd feed a reranker
or a preference-tuning run later. `GET /api/admin/pairs` returns the same thing from
the database.

Editions published before the desk existed carry no slate and don't appear in the
admin list — there's nothing to rule between.

## Endpoints

All require `X-Admin-Token` (or `Authorization: Bearer …`).

| Route | Purpose |
| --- | --- |
| `GET /admin` | The page itself (carries no secret) |
| `GET /api/admin/desk?limit=30` | Recent editions + slates + existing rulings |
| `POST /api/admin/pick` | `{date, preferred, why}` |
| `DELETE /api/admin/pick/:date` | Withdraw a ruling |
| `GET /api/admin/pairs?limit=200` | The preference corpus |

## Kill switch

`GT_DISABLE_DESK=1` on the publish job stops rulings from reaching the lead prompt
while leaving the admin surface and the log intact.
