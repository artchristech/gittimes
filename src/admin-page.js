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
 * @returns {string} a complete HTML document
 */
function renderAdminPage(basePath = "") {
  const api = `${basePath}/api/admin`;
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
</style>
</head>
<body>
<header>
  <h1>The Editor's Desk</h1>
  <div class="sub">Rule on what should have led. The paper stays as printed; the pick trains tomorrow.</div>
</header>
<main>
  <div class="gate" id="gate">
    <label for="tok">Admin token</label>
    <div class="row">
      <input id="tok" type="password" autocomplete="off" placeholder="GT_ADMIN_TOKEN">
      <button id="save-tok">Unlock</button>
      <span class="status" id="gate-status"></span>
    </div>
  </div>
  <div id="list"></div>
</main>
<script>
(function () {
  var API = ${JSON.stringify(api)};
  var KEY = "gittimes.admin.token";
  var list = document.getElementById("list");
  var gateStatus = document.getElementById("gate-status");
  var tokInput = document.getElementById("tok");

  function token() { return localStorage.getItem(KEY) || ""; }

  function api_(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "X-Admin-Token": token(), "Content-Type": "application/json" }, opts.headers || {});
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

  if (token()) { gateStatus.textContent = "Token stored."; load(); }
  else { list.innerHTML = '<p class="empty">Enter the admin token to begin.</p>'; }
})();
</script>
</body>
</html>`;
}

module.exports = { renderAdminPage };
