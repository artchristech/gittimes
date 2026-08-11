/**
 * The Editor's Desk — the private admin page.
 *
 * A single self-contained HTML page served by api-server.js at /admin. It lists
 * recent editions with the candidate slate each lead was chosen from, and lets
 * the human editor rule: "this one should have led, because…". Rulings never
 * change the printed edition — they feed forward into tomorrow's lead prompt.
 *
 * The page itself carries no secret. Every data call is gated on the admin token,
 * which the editor pastes once and the browser keeps in localStorage.
 */

/**
 * @param {string} [basePath] - path prefix the API is mounted under ("" by default)
 * @param {{accountEnabled?: boolean, tokenEnabled?: boolean}} [opts]
 * @returns {string} a complete HTML document
 */
function renderAdminPage(basePath = "", opts = {}) {
  const api = `${basePath}/api/admin`;
  const accountEnabled = opts.accountEnabled !== false;
  const tokenEnabled = opts.tokenEnabled !== false;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>The Editor's Desk — The Git Times</title>
<style>
  :root { --ink:#111; --paper:#f6f3ec; --rule:#111; --muted:#6b6459; --accent:#8b2020; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font-family: Georgia, "Times New Roman", serif; line-height:1.45; }
  header { border-bottom:3px double var(--rule); padding:1.5rem 1rem .75rem; text-align:center; }
  h1 { margin:0; font-size:2rem; letter-spacing:.04em; text-transform:uppercase; }
  .sub { color:var(--muted); font-size:.85rem; font-style:italic; margin-top:.3rem; }
  main { max-width:52rem; margin:0 auto; padding:1.5rem 1rem 4rem; }
  .gate { border:1px solid var(--rule); padding:1rem; margin-bottom:1.5rem; background:#fff; }
  .gate input { font:inherit; padding:.4rem; width:16rem; border:1px solid var(--muted); }
  button { font:inherit; padding:.4rem .9rem; border:1px solid var(--rule); background:#fff;
           cursor:pointer; }
  button:hover { background:var(--ink); color:var(--paper); }
  button[disabled] { opacity:.4; cursor:default; }
  .edition { border-top:1px solid var(--rule); padding:1.25rem 0; }
  .edition h2 { margin:0 0 .15rem; font-size:1.15rem; }
  .date { font-size:.75rem; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
  .ruling { font-size:.8rem; color:var(--accent); font-style:italic; margin:.35rem 0 0; }
  ul.slate { list-style:none; margin:.75rem 0 .5rem; padding:0; }
  ul.slate li { padding:.3rem 0; display:flex; gap:.5rem; align-items:flex-start; }
  ul.slate label { cursor:pointer; }
  .repo { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size:.85rem; }
  .desc { color:var(--muted); font-size:.8rem; }
  .led { font-size:.65rem; letter-spacing:.1em; background:var(--ink); color:var(--paper);
         padding:.05rem .35rem; vertical-align:.1em; }
  textarea { width:100%; font:inherit; font-size:.9rem; padding:.5rem; border:1px solid var(--muted);
             background:#fff; }
  .row { display:flex; gap:.75rem; align-items:center; margin-top:.5rem; }
  .status { font-size:.8rem; color:var(--muted); }
  .empty { color:var(--muted); font-style:italic; }
  .err { color:var(--accent); }
  .signin { display:inline-block; border:1px solid var(--rule); padding:.4rem .9rem;
            text-decoration:none; color:var(--ink); background:#fff; }
  .signin:hover { background:var(--ink); color:var(--paper); }
  details summary { cursor:pointer; margin-top:.5rem; }
</style>
</head>
<body>
<header>
  <h1>The Editor's Desk</h1>
  <div class="sub">Rule on what should have led. The paper stays as printed; the pick trains tomorrow.</div>
</header>
<main>
  <div class="gate" id="gate">
    <div id="whoami" class="status"></div>
    <div class="row" id="signin-row" hidden>
      <a class="signin" href="https://gittimes.com/desk/">Sign in with your Git Times account</a>
    </div>
    <details id="tok-fallback"${tokenEnabled ? "" : " hidden"}>
      <summary class="status">Use the shared admin token instead</summary>
      <div class="row">
        <input id="tok" type="password" autocomplete="off" placeholder="GT_ADMIN_TOKEN">
        <button id="save-tok">Unlock</button>
      </div>
    </details>
    <span class="status" id="gate-status"></span>
  </div>
  <div id="list"></div>
</main>
<script>
(function () {
  var API = ${JSON.stringify(api)};
  var ACCOUNT_ENABLED = ${JSON.stringify(accountEnabled)};
  var KEY = "gittimes.admin.token";
  var SKEY = "gittimes-session";

  // The site lives on gittimes.com and this page on api.gittimes.com — separate
  // origins, so the account session cannot simply be read from localStorage. The
  // /desk/ bridge on the site forwards it here in the URL fragment, which the
  // browser never sends to a server. Consume it once, then scrub the address bar.
  (function adoptSessionFromHash() {
    var m = (location.hash || "").match(/[#&]s=([A-Za-z0-9._-]+)/);
    if (!m) return;
    try { localStorage.setItem(SKEY, m[1]); } catch (e) { /* private mode */ }
    history.replaceState(null, "", location.pathname + location.search);
  })();
  var list = document.getElementById("list");
  var gateStatus = document.getElementById("gate-status");
  var tokInput = document.getElementById("tok");

  function token() { return localStorage.getItem(KEY) || ""; }
  function session() { return localStorage.getItem(SKEY) || ""; }
  function haveCredential() { return !!(token() || session()); }

  function api_(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      "X-Admin-Token": token(),
      "X-Gittimes-Session": session(),
      "Content-Type": "application/json",
    }, opts.headers || {});
    return fetch(API + path, opts).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) throw new Error(b.error || ("HTTP " + r.status));
        return b;
      });
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(editions) {
    if (!editions.length) {
      list.innerHTML = '<p class="empty">No editions with a recorded candidate slate yet. ' +
        'Slates are recorded from the next publish onward.</p>';
      return;
    }
    list.innerHTML = editions.map(function (e) {
      var pick = e.pick;
      var ruling = "";
      if (pick) {
        ruling = pick.verdict === "confirm"
          ? '<p class="ruling">Ruled: correct call.' + (pick.why ? " &mdash; " + esc(pick.why) : "") + "</p>"
          : '<p class="ruling">Ruled: ' + esc(pick.preferredRepo) + " should have led." +
            (pick.why ? " &mdash; " + esc(pick.why) : "") + "</p>";
      }
      var items = e.slate.map(function (c, i) {
        var id = "p-" + e.date + "-" + i;
        var checked = pick ? (pick.preferredRepo === c.repo) : c.chosen;
        return '<li><input type="radio" id="' + esc(id) + '" name="pick-' + esc(e.date) + '" value="' +
          esc(c.repo) + '"' + (checked ? " checked" : "") + '>' +
          '<label for="' + esc(id) + '"><span class="repo">' + esc(c.repo) + "</span>" +
          (c.chosen ? ' <span class="led">LED</span>' : "") +
          (c.description ? '<br><span class="desc">' + esc(c.description) + "</span>" : "") +
          "</label></li>";
      }).join("");
      return '<section class="edition" data-date="' + esc(e.date) + '">' +
        '<div class="date">' + esc(e.date) + "</div>" +
        "<h2>" + esc(e.headline || "(untitled edition)") + "</h2>" +
        ruling +
        '<ul class="slate">' + items + "</ul>" +
        '<textarea rows="2" placeholder="Why? One sentence. This is the part that teaches.">' +
        esc(pick ? pick.why : "") + "</textarea>" +
        '<div class="row"><button class="save">Save ruling</button>' +
        (pick ? '<button class="del">Withdraw</button>' : "") +
        '<span class="status"></span></div></section>';
    }).join("");
  }

  function load() {
    list.innerHTML = '<p class="empty">Loading&hellip;</p>';
    api_("/desk?limit=30").then(function (b) { render(b.editions || []); })
      .catch(function (err) {
        list.innerHTML = '<p class="err">' + esc(err.message) + "</p>";
      });
  }

  list.addEventListener("click", function (ev) {
    var btn = ev.target.closest("button");
    if (!btn) return;
    var section = btn.closest(".edition");
    var date = section.getAttribute("data-date");
    var status = section.querySelector(".status");

    if (btn.classList.contains("del")) {
      btn.disabled = true;
      status.textContent = "Withdrawing\\u2026";
      api_("/pick/" + date, { method: "DELETE" })
        .then(load)
        .catch(function (e) { status.textContent = e.message; btn.disabled = false; });
      return;
    }

    var chosen = section.querySelector('input[name="pick-' + date + '"]:checked');
    if (!chosen) { status.textContent = "Pick a story first."; return; }
    var why = section.querySelector("textarea").value.trim();
    btn.disabled = true;
    status.textContent = "Saving\\u2026";
    api_("/pick", {
      method: "POST",
      body: JSON.stringify({ date: date, preferred: chosen.value, why: why }),
    }).then(load).catch(function (e) { status.textContent = e.message; btn.disabled = false; });
  });

  document.getElementById("save-tok").addEventListener("click", function () {
    localStorage.setItem(KEY, tokInput.value.trim());
    tokInput.value = "";
    gateStatus.textContent = "Token stored.";
    load();
  });

  var signinRow = document.getElementById("signin-row");
  var whoami = document.getElementById("whoami");

  if (haveCredential()) {
    whoami.textContent = session() ? "Signed in with your Git Times account." : "Unlocked with the shared token.";
    load();
  } else if (ACCOUNT_ENABLED) {
    signinRow.hidden = false;
    whoami.textContent = "Not signed in.";
    list.innerHTML = '<p class="empty">Sign in with your Git Times account to rule on front pages.</p>';
  } else {
    list.innerHTML = '<p class="empty">Enter the admin token to begin.</p>';
  }
})();
</script>
</body>
</html>`;
}


/**
 * The /desk/ bridge, published on the SITE origin (gittimes.com).
 *
 * The desk itself is served by the API on api.gittimes.com, which cannot read the
 * account session because localStorage is per-origin. This page runs where the
 * session actually lives, and forwards it in the URL fragment — fragments are
 * never sent to a server, so the token stays out of access logs, Referer headers,
 * and the CDN. If there is no session it just points at the sign-in page.
 *
 * It reveals nothing on its own: to a signed-out visitor it is a link to /account/.
 *
 * @param {string} apiBase - origin the desk is served from (e.g. https://api.gittimes.com)
 * @param {string} [basePath] - site path prefix
 * @returns {string} a complete HTML document
 */
function renderDeskBridgePage(apiBase, basePath = "") {
  const api = String(apiBase || "https://api.gittimes.com").replace(/\/$/, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>The Editor's Desk — The Git Times</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f6f3ec; color:#111; font-family:Georgia,"Times New Roman",serif; text-align:center; }
  .box { max-width:28rem; padding:2rem; }
  h1 { font-size:1.5rem; letter-spacing:.04em; text-transform:uppercase; margin:0 0 .5rem; }
  p { color:#6b6459; font-size:.9rem; }
  a { display:inline-block; margin-top:1rem; border:1px solid #111; padding:.45rem 1rem;
      text-decoration:none; color:#111; background:#fff; }
</style>
</head>
<body>
<div class="box">
  <h1>The Editor's Desk</h1>
  <p id="msg">Checking your session&hellip;</p>
  <a id="go" href="${basePath}/account/" hidden>Sign in</a>
</div>
<script>
(function () {
  var API = ${JSON.stringify(api)};
  var msg = document.getElementById("msg");
  var go = document.getElementById("go");
  var s = "";
  try { s = localStorage.getItem("gittimes-session") || ""; } catch (e) { /* private mode */ }
  if (s) {
    msg.textContent = "Signed in. Opening the desk\u2026";
    location.replace(API + "/admin#s=" + encodeURIComponent(s));
  } else {
    msg.textContent = "You need to be signed in to your Git Times account to rule on front pages.";
    go.hidden = false;
  }
})();
</script>
</body>
</html>`;
}

module.exports = { renderAdminPage, renderDeskBridgePage };
