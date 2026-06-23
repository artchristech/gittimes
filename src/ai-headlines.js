/**
 * Non-repo AI intake. Git Times' editorial funnel is otherwise GitHub-trending
 * only, which is structurally blind to the day's actual AI headline (a model
 * launch, a paper, a lab announcement) when it isn't a trending repo. This pulls
 * the wider web's top AI stories from Hacker News (Algolia API, no key) so the
 * paper can point at what builders are actually reading today.
 */

// Title must look AI-relevant. HN's "AI" full-text query is noisy, so we filter
// titles too. Word-boundary, not substring (avoid "rail" matching "ai").
const AI_TITLE_RE = /\b(ai|a\.i\.|llms?|gpt(?:-?\d(?:\.\d)?)?|chatgpt|claude|gemini|anthropic|openai|deepmind|mistral|llama|grok|agent(?:s|ic)?|transformer|diffusion|neural|inference|fine-?tun\w*|rag|embeddings?|machine learning|deep learning|ml|model weights?|open-?weight)\b/i;

function _domain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Rank + filter raw HN hits into clean headline objects. Pure (no I/O) so it's
 * unit-testable. Keeps externally-linked AI stories above a points floor,
 * dedupes by URL, sorts by points, caps at `limit`.
 * @param {Array} hits - HN Algolia hits
 * @param {object} [opts] - { limit, minPoints }
 * @returns {Array<{title,url,source,points,comments,discussionUrl}>}
 */
function selectTopHeadlines(hits, opts = {}) {
  const { limit = 5, minPoints = 40 } = opts;
  if (!Array.isArray(hits)) return [];
  const seen = new Set();
  return hits
    .filter((h) => h && h.title && h.url) // external link only (skips Ask/Show HN self-posts)
    .filter((h) => (h.points || 0) >= minPoints)
    .filter((h) => AI_TITLE_RE.test(h.title))
    .filter((h) => {
      if (seen.has(h.url)) return false;
      seen.add(h.url);
      return true;
    })
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, limit)
    .map((h) => ({
      title: h.title,
      url: h.url,
      source: _domain(h.url),
      points: h.points || 0,
      comments: h.num_comments || 0,
      discussionUrl: h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : null,
    }));
}

/**
 * Fetch recent top AI headlines from Hacker News. Returns [] on any failure —
 * the AI Wire is a bonus block, never a reason to fail the edition.
 * @param {object} [options] - { limit, minPoints, hoursBack, fetchImpl, nowMs, timeoutMs }
 * @returns {Promise<Array>}
 */
async function fetchAIHeadlines(options = {}) {
  const {
    limit = 5,
    minPoints = 30,
    hoursBack = 48,
    fetchImpl = globalThis.fetch,
    nowMs = Date.now(),
    timeoutMs = 10_000,
  } = options;

  if (typeof fetchImpl !== "function") {
    console.warn("AI Wire: no fetch available, skipping");
    return [];
  }

  // search_by_date returns NEWEST first — those are all low-point fresh posts,
  // so we MUST filter by points server-side or every result is a 1-point post.
  // This returns recent stories that already cleared the points bar.
  const sinceTs = Math.floor((nowMs - hoursBack * 3600 * 1000) / 1000);
  const url =
    "https://hn.algolia.com/api/v1/search_by_date" +
    `?tags=story&query=AI&hitsPerPage=60&numericFilters=created_at_i>${sinceTs},points>=${minPoints}`;

  const AbortCtor = globalThis.AbortController;
  const controller = typeof AbortCtor === "function" ? new AbortCtor() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, controller ? { signal: controller.signal } : {});
    if (!res || !res.ok) {
      console.warn(`AI Wire: HN fetch returned ${res ? res.status : "no response"}`);
      return [];
    }
    const data = await res.json();
    const headlines = selectTopHeadlines(data.hits || [], { limit, minPoints });
    console.log(`AI Wire: ${headlines.length} non-repo headline(s) from Hacker News`);
    return headlines;
  } catch (err) {
    console.warn(`AI Wire: fetch failed (non-fatal): ${err.message}`);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// --- arXiv research intake -------------------------------------------------

/**
 * Parse arXiv Atom XML into clean entries. Pure (no I/O) so it's testable.
 * Minimal regex parse — no XML dep. Returns research-flavored headline objects.
 * @param {string} xml
 * @param {number} limit
 */
function parseArxivAtom(xml, limit = 3) {
  if (!xml || typeof xml !== "string") return [];
  const entries = xml.split("<entry>").slice(1);
  const out = [];
  for (const e of entries) {
    const title = (e.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").replace(/\s+/g, " ").trim();
    const id = (e.match(/<id>([\s\S]*?)<\/id>/)?.[1] || "").trim();
    if (!title || !/^https?:\/\//.test(id)) continue;
    out.push({
      title,
      url: id,
      source: "arXiv",
      points: 0,
      comments: 0,
      discussionUrl: null,
      kind: "research",
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Fetch the most recent AI papers from arXiv (cs.AI / cs.LG / cs.CL). Returns []
 * on any failure — research is a bonus tier, never a reason to fail the edition.
 * @param {object} [options] - { limit, fetchImpl, timeoutMs }
 */
async function fetchArxiv(options = {}) {
  const { limit = 3, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = options;
  if (typeof fetchImpl !== "function") return [];

  const url =
    "http://export.arxiv.org/api/query" +
    "?search_query=" + encodeURIComponent("cat:cs.AI OR cat:cs.LG OR cat:cs.CL") +
    "&sortBy=submittedDate&sortOrder=descending&max_results=" + Math.max(limit, 5);

  const AbortCtor = globalThis.AbortController;
  const controller = typeof AbortCtor === "function" ? new AbortCtor() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, controller ? { signal: controller.signal } : {});
    if (!res || !res.ok) {
      console.warn(`AI Wire (arXiv): fetch returned ${res ? res.status : "no response"}`);
      return [];
    }
    const xml = await res.text();
    const papers = parseArxivAtom(xml, limit);
    console.log(`AI Wire: ${papers.length} arXiv paper(s)`);
    return papers;
  } catch (err) {
    console.warn(`AI Wire (arXiv): fetch failed (non-fatal): ${err.message}`);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { fetchAIHeadlines, selectTopHeadlines, fetchArxiv, parseArxivAtom, _domain };
