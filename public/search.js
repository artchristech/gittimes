/* The Git Times — archive search ("the fold").
 *
 * A slim dateline bar under the masthead opens a full-page search surface.
 * The edition never unloads: on open, everything on the page is wrapped once
 * into a #gt-fold container which is frozen in place (position:fixed at its
 * current box) and compressed with a transform — search mode is a layer, not
 * a route. Escape / the fold line unfolds the paper back to the exact scroll
 * position. Transforms + opacity only; the corpus is the same /data/corpus.json
 * the AI Desk grounds on, fetched lazily on first open.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var BASE = "";
  try {
    BASE = new URL(script.src, window.location.href).pathname.replace(/\/search\.js.*$/, "");
  } catch {
    BASE = "";
  }

  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FOLD_MS = REDUCED ? 0 : 280;
  var MAX_RESULTS = 24;

  var state = {
    open: false,
    savedY: 0,
    corpus: null, // array of chunks
    fetching: null, // in-flight promise
    fold: null, // wrapper element, created on first open
    timer: null,
  };

  // --- DOM: trigger bar (belongs to the masthead) + search layer ---

  var bar = document.createElement("div");
  bar.className = "gt-search-bar";
  bar.innerHTML =
    '<button type="button" class="gt-search-bar-btn" aria-label="Search the archive (press /)">' +
    '<span class="gt-search-bar-hint">Ask the archive&hellip;</span>' +
    '<kbd class="gt-search-bar-kbd" aria-hidden="true">/</kbd>' +
    "</button>";

  var layer = document.createElement("div");
  layer.className = "gt-search-layer";
  layer.id = "gt-search-layer";
  layer.hidden = true;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "Search the archive");
  layer.innerHTML =
    '<button type="button" class="gt-foldline" aria-label="Close search and unfold the paper">' +
    '<span class="gt-foldline-rule" aria-hidden="true"></span>' +
    '<span class="gt-foldline-label">Fold the search away &mdash; back to the paper <kbd>esc</kbd></span>' +
    "</button>" +
    '<div class="gt-search-inner">' +
    '<div class="gt-search-head">' +
    '<input class="gt-search-input" id="gt-search-input" type="search" ' +
    'placeholder="Ask the archive&hellip;" autocomplete="off" spellcheck="false" ' +
    'aria-label="Search the archive">' +
    "</div>" +
    '<p class="gt-search-status" id="gt-search-status" aria-live="polite"></p>' +
    '<div class="gt-clippings" id="gt-clippings"></div>' +
    "</div>";

  function init() {
    var masthead = document.querySelector(".masthead");
    if (masthead && masthead.parentNode) {
      masthead.parentNode.insertBefore(bar, masthead.nextSibling);
    } else {
      document.body.insertBefore(bar, document.body.firstChild);
    }
    document.body.appendChild(layer);

    bar.querySelector(".gt-search-bar-btn").addEventListener("click", openSearch);
    bar.addEventListener("pointerenter", ensureCorpus, { once: true });
    layer.querySelector(".gt-foldline").addEventListener("click", closeSearch);
    input().addEventListener("input", onType);

    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented) return;
      if (e.key === "Escape" && state.open) {
        e.preventDefault();
        closeSearch();
        return;
      }
      if (e.key === "/" && !state.open && !e.metaKey && !e.ctrlKey && !e.altKey) {
        var t = e.target;
        if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
        e.preventDefault();
        openSearch();
      }
    });
  }

  function input() {
    return layer.querySelector("#gt-search-input");
  }

  // --- The fold ---

  // Wrap every body child except the search layer into one container we can
  // transform. Done once, lazily, after every other script has initialized —
  // moving nodes preserves element identity, so their listeners survive.
  function ensureFold() {
    if (state.fold) return state.fold;
    var fold = document.createElement("div");
    fold.className = "gt-fold";
    var kids = Array.prototype.slice.call(document.body.childNodes);
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === layer) continue;
      fold.appendChild(kids[i]);
    }
    document.body.insertBefore(fold, layer);
    state.fold = fold;
    return fold;
  }

  function openSearch() {
    if (state.open) return;
    state.open = true;
    clearTimeout(state.timer);
    ensureCorpus();

    var fold = ensureFold();
    state.savedY = window.scrollY || window.pageYOffset || 0;

    // Freeze the paper at its exact on-screen box so nothing jumps when it
    // leaves the flow, then compress it with a transform.
    var rect = fold.getBoundingClientRect();
    fold.style.position = "fixed";
    fold.style.top = rect.top + "px";
    fold.style.left = rect.left + "px";
    fold.style.width = rect.width + "px";
    fold.style.willChange = "transform, opacity";
    void fold.offsetHeight; // commit the frozen box before the transition starts

    document.body.classList.add("gt-searching");
    layer.hidden = false;
    requestAnimationFrame(function () {
      layer.classList.add("gt-search-open");
    });

    var field = input();
    field.focus({ preventScroll: true });
    render(field.value);
  }

  function closeSearch() {
    if (!state.open) return;
    state.open = false;

    layer.classList.remove("gt-search-open");
    document.body.classList.remove("gt-searching");

    var fold = state.fold;
    clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      layer.hidden = true;
      fold.style.position = "";
      fold.style.top = "";
      fold.style.left = "";
      fold.style.width = "";
      fold.style.willChange = "";
      window.scrollTo(0, state.savedY);
    }, FOLD_MS);
  }

  // --- Corpus + search ---

  function ensureCorpus() {
    if (state.corpus || state.fetching) return state.fetching;
    state.fetching = fetch(BASE + "/data/corpus.json", { credentials: "omit" })
      .then(function (res) {
        if (!res.ok) throw new Error("corpus " + res.status);
        return res.json();
      })
      .then(function (data) {
        var chunks = (data && data.chunks) || [];
        for (var i = 0; i < chunks.length; i++) {
          var c = chunks[i];
          c._title = String(c.title || "").toLowerCase();
          c._text = String(c.text || "").toLowerCase();
          c._repo = String(c.repo || "").toLowerCase();
        }
        state.corpus = chunks;
        if (state.open) render(input().value);
      })
      .catch(function () {
        state.fetching = null;
        if (state.open) {
          setStatus("The archive is unreachable right now — try again shortly.");
        }
      });
    return state.fetching;
  }

  function score(chunk, terms) {
    var s = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var inTitle = chunk._title.indexOf(t) !== -1;
      var inRepo = chunk._repo.indexOf(t) !== -1;
      var inText = chunk._text.indexOf(t) !== -1;
      if (!inTitle && !inRepo && !inText) return 0; // every term must land somewhere
      if (inTitle) s += 4;
      if (inRepo) s += 3;
      if (inText) s += 1;
    }
    return s;
  }

  function search(query) {
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < state.corpus.length; i++) {
      var s = score(state.corpus[i], terms);
      if (s > 0) out.push({ c: state.corpus[i], s: s });
    }
    out.sort(function (a, b) {
      if (b.s !== a.s) return b.s - a.s;
      return a.c.date < b.c.date ? 1 : a.c.date > b.c.date ? -1 : 0;
    });
    return out.slice(0, MAX_RESULTS).map(function (r) {
      return r.c;
    });
  }

  function latestEditions() {
    var out = [];
    for (var i = 0; i < state.corpus.length && out.length < 12; i++) {
      if (state.corpus[i].type === "edition") out.push(state.corpus[i]);
    }
    return out;
  }

  // --- Rendering: results as clippings ---

  var debounce = null;
  function onType() {
    clearTimeout(debounce);
    var q = input().value;
    debounce = setTimeout(function () {
      render(q);
    }, 90);
  }

  function setStatus(text) {
    layer.querySelector("#gt-search-status").textContent = text;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function fmtDate(iso) {
    var d = new Date(iso + "T00:00:00Z");
    if (isNaN(d)) return iso || "";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function clippingHtml(c, i) {
    var href = BASE + String(c.url || "#");
    var kicker =
      c.type === "edition" ? "Edition" : c.repo ? esc(c.repo) : "Coverage";
    return (
      '<a class="gt-clipping" href="' +
      esc(href) +
      '" style="--gt-i:' +
      Math.min(i, 12) +
      '">' +
      '<span class="gt-clipping-kicker">' + kicker + "</span>" +
      '<h3 class="gt-clipping-hed">' + esc(c.title) + "</h3>" +
      '<p class="gt-clipping-catch">' + esc(c.text) + "</p>" +
      '<time class="gt-clipping-date">' + esc(fmtDate(c.date)) + "</time>" +
      "</a>"
    );
  }

  function render(query) {
    if (!state.corpus) {
      setStatus("Opening the archive…");
      return;
    }
    var q = String(query || "").trim();
    var results = q ? search(q) : latestEditions();
    var box = layer.querySelector("#gt-clippings");

    if (!q) {
      setStatus("The latest editions, fresh from the desk — or ask for anything the paper has covered.");
    } else if (results.length === 0) {
      setStatus("No clippings for “" + q + "” — the paper hasn’t covered it yet.");
    } else {
      setStatus(
        results.length + (results.length === 1 ? " clipping" : " clippings") + " from the archive"
      );
    }

    var html = "";
    for (var i = 0; i < results.length; i++) html += clippingHtml(results[i], i);
    box.innerHTML = html;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
