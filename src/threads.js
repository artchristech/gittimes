/**
 * Editorial memory / continuity — turn the persisted edition manifest into
 * running-story context for the editor-in-chief.
 *
 * The manifest (site/editions/manifest.json, read via publish.readManifest) is
 * already the paper's thread ledger: each entry carries the edition date, the
 * front-page lead repo (repos[0]), and its headline. The editor never saw it —
 * it only knew "don't repeat yesterday's lead." These pure functions surface
 * the last few front pages so the editor can pick genuine follow-ups, avoid
 * rehashing the same repo without new development, and sustain narrative arcs.
 *
 * Everything here is pure + fail-soft: a missing/garbage manifest yields empty
 * context and the lead prompt is left exactly as it was (continuity off).
 */

/**
 * Build continuity context from recent manifest entries.
 * @param {Array<{date?:string, headline?:string, repos?:string[]}>} manifest
 *   Newest-first manifest entries (publish.readManifest order).
 * @param {{ lookback?: number }} [opts]
 * @returns {{ block: string, recentLeadRepos: Set<string> }}
 *   `block` is a prompt fragment (empty string when there is no usable history);
 *   `recentLeadRepos` is the set of repos that led the front page in the window.
 */
function buildLeadThreadContext(manifest, opts = {}) {
  const lookback = opts.lookback || 3;
  const recentLeadRepos = new Set();
  if (!Array.isArray(manifest) || manifest.length === 0) {
    return { block: "", recentLeadRepos };
  }

  const lines = [];
  for (const entry of manifest.slice(0, lookback)) {
    if (!entry || !Array.isArray(entry.repos) || entry.repos.length === 0) continue;
    const repo = entry.repos[0];
    if (!repo) continue;
    recentLeadRepos.add(repo);
    const date = entry.date || "recently";
    const headline = (entry.headline || "").trim() || "(headline unavailable)";
    lines.push(`- ${date}: ${repo} — "${headline}"`);
  }

  if (lines.length === 0) return { block: "", recentLeadRepos };

  const block =
    `RECENT FRONT PAGES (the running story — for continuity):\n` +
    lines.join("\n") +
    `\n\nCONTINUITY GUIDANCE: You are editing a daily paper, not resetting it each morning. ` +
    `If a candidate is a genuine new development in one of the stories above (a release shipped, ` +
    `a milestone hit, a reversal), favor it and frame it as a follow-up. Do NOT re-lead a repo from ` +
    `the list again unless there is real new news — a repeat without development reads as filler. ` +
    `Otherwise prefer the most significant fresh story.`;

  return { block, recentLeadRepos };
}

/**
 * Extract the chosen front-page lead from generated content, fail-soft.
 * @param {object} content - generated edition content
 * @returns {{ repo: string, headline: string } | null}
 */
function extractLead(content) {
  const lead =
    content && content.sections && content.sections.frontPage
      ? content.sections.frontPage.lead
      : content && content.lead;
  if (!lead) return null;
  const repo = lead.repo ? lead.repo.full_name || lead.repo.name : null;
  if (!repo) return null;
  return { repo, headline: (lead.headline || "").trim() };
}

module.exports = { buildLeadThreadContext, extractLead };
