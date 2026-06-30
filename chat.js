(function() {
  var WORKER = window.__WORKER_URL;
  var fab = document.getElementById('chat-fab');
  var panel = document.getElementById('chat-panel');
  var msgs = document.getElementById('chat-messages');
  var paywall = document.getElementById('chat-paywall');
  var inputRow = document.getElementById('chat-input-row');
  var input = document.getElementById('chat-input');
  var sendBtn = document.getElementById('chat-send');
  var unlockBtn = document.getElementById('chat-unlock-btn');
  var ctxBar = document.getElementById('chat-context');
  var ctxLabel = document.getElementById('chat-context-label');
  var ctxClear = document.getElementById('chat-context-clear');

  if (!fab || !panel) return; // chat not on this page

  var sessionId = localStorage.getItem('gittimes-chat-session');
  var accountSession = localStorage.getItem('gittimes-session');
  var history_msgs = [];
  var display_msgs = []; // visible bubbles { role:'user'|'ai', text } for rehydration
  var scoped = null; // { el, title } when focused on a single story
  var TRANSCRIPT_KEY = 'gittimes-chat-transcript';
  var THINK_KEY = 'gittimes-chat-think';
  var thinkPref = false;
  try { thinkPref = localStorage.getItem(THINK_KEY) === '1'; } catch { /* storage off */ }

  // Reveal the per-article "Ask about this" buttons now that chat is available.
  document.body.classList.add('chat-on');

  // Inject styles for the newer AI Desk elements (citations, reasoning, plan
  // strip, saved answers). These mirror the .chat-* rules in styles/newspaper.css
  // but are injected here so a surgical chat.js deploy styles every page — the
  // published pages inline CSS at varying versions, so we can't rely on theirs.
  (function injectChatStyles() {
    if (document.getElementById('chat-desk-styles')) return;
    var css = [
      '.chat-think-toggle{font-size:13px;line-height:1}',
      '.chat-think-toggle.on{opacity:1;background:color-mix(in srgb,var(--accent) 16%,transparent)}',
      '.chat-think{margin:0 0 6px;border-left:2px solid color-mix(in srgb,var(--accent) 45%,transparent);padding-left:8px}',
      '.chat-think>summary{cursor:pointer;font-family:var(--font-meta);font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-soft,var(--ink));opacity:.75;list-style:none}',
      '.chat-think>summary::-webkit-details-marker{display:none}',
      '.chat-think>summary::before{content:"\\25B8 "}',
      '.chat-think[open]>summary::before{content:"\\25BE "}',
      '.chat-think-body{font-size:12.5px;color:var(--ink-soft,var(--ink));opacity:.85;margin-top:4px}',
      '.chat-think-body p{margin:4px 0}',
      '.chat-cite{font-size:.7em}',
      '.chat-cite a{text-decoration:none;color:var(--accent);font-weight:600}',
      '.chat-cite a:hover{text-decoration:underline}',
      '.chat-sources{display:flex;flex-direction:column;gap:3px;margin-top:10px;padding-top:8px;border-top:1px dashed var(--rule-light)}',
      '.chat-sources-label{font-family:var(--font-meta);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-soft,var(--ink));opacity:.6}',
      '.chat-source{font-size:12px;color:var(--accent);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.chat-source:hover{text-decoration:underline}',
      '.chat-plan{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 14px;border-top:1px solid var(--rule-light);font-family:var(--font-meta);font-size:11px;color:var(--ink-soft,var(--ink))}',
      '.chat-plan-tier{font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-soft,var(--ink));opacity:.7}',
      '.chat-plan-tier.premium{color:var(--accent);opacity:1}',
      '.chat-plan-quota{font-weight:600}',
      '.chat-plan-detail{opacity:.6}',
      '.chat-plan-upgrade{margin-left:auto;color:var(--accent);font-weight:600;text-decoration:none;white-space:nowrap}',
      '.chat-plan-upgrade:hover{text-decoration:underline}',
      '.chat-actions{margin-top:8px}',
      '.chat-save-btn{background:none;border:1px solid var(--rule-light);color:var(--ink-soft,var(--ink));font-family:var(--font-meta);font-size:11px;padding:3px 9px;border-radius:5px;cursor:pointer;transition:border-color .15s,color .15s}',
      '.chat-save-btn:hover{border-color:var(--accent);color:var(--accent)}',
      '.chat-save-btn.saved{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,transparent);cursor:default}',
      '.chat-saved{flex:1;min-height:0;overflow:auto;padding:12px 14px}',
      '.chat-saved-head{display:flex;align-items:center;justify-content:space-between;font-family:var(--font-meta);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-soft,var(--ink));margin-bottom:10px}',
      '.chat-saved-close{background:none;border:none;color:var(--accent);font-family:var(--font-meta);font-size:11px;cursor:pointer}',
      '.chat-saved-item{display:flex;align-items:center;gap:8px;border-top:1px solid var(--rule-light);padding:8px 0}',
      '.chat-saved-open{flex:1;text-align:left;background:none;border:none;color:var(--ink);font-family:var(--font-body);font-size:13px;line-height:1.35;cursor:pointer;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.chat-saved-open:hover{color:var(--accent)}',
      '.chat-saved-remove{background:none;border:none;color:var(--ink-faint);font-size:18px;line-height:1;cursor:pointer;padding:0 4px}',
      '.chat-saved-remove:hover{color:var(--accent)}',
      '.chat-saved-empty{font-family:var(--font-body);font-size:13px;color:var(--ink-faint)}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'chat-desk-styles';
    style.textContent = css;
    document.head.appendChild(style);
  })();

  function showChat() {
    paywall.style.display = 'none';
    inputRow.style.display = 'flex';
  }
  function showPaywall() {
    paywall.style.display = 'flex';
    inputRow.style.display = 'none';
  }

  function updatePaywall() {
    if (sessionId) {
      // Legacy Stripe checkout session (24h)
      showChat();
    } else if (accountSession) {
      // The AI Desk is Premium. Free accounts only chat when a daily allowance is
      // configured (freeDailyLimit > 0); otherwise they see the upgrade paywall.
      fetch(WORKER + '/auth/me', {
        headers: { 'Authorization': 'Bearer ' + accountSession }
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok && data.user) {
          planUser = data.user;
          renderPlanStrip();
          if (canChat(data.user)) showChat();
          else showPaywall();
        } else showPaywall();
      })
      .catch(showPaywall);
    } else {
      showPaywall();
    }
  }

  // Premium chats freely; free chats only if a daily taste is configured.
  function canChat(u) {
    return !!u && (u.plan === 'premium' || (u.freeDailyLimit || 0) > 0);
  }

  // --- Plan transparency strip: what your plan is for + quota remaining ---
  var planUser = null;
  var planStrip = null;

  function planInfo(u) {
    if (!u) return null;
    if (u.plan === 'premium') {
      return { tier: 'Premium', detail: 'Deep research, repo lookups & side-by-side compares' };
    }
    var limit = u.freeDailyLimit || 0;
    if (limit <= 0) {
      // Premium-only: free plans get no AI Desk usage.
      return { tier: 'Free', detail: 'The AI Desk is a Premium feature', premiumOnly: true, upgrade: true };
    }
    var today = new Date().toISOString().slice(0, 10);
    var used = (u.freeChatUsage && u.freeChatUsage.day === today) ? u.freeChatUsage.count : 0;
    return { tier: 'Free', detail: 'Best for quick, one-off questions', remaining: Math.max(0, limit - used), limit: limit, upgrade: true };
  }

  function renderPlanStrip() {
    var info = planInfo(planUser);
    if (!info) return;
    if (!planStrip) {
      planStrip = document.createElement('div');
      planStrip.className = 'chat-plan';
      if (inputRow && inputRow.parentNode) inputRow.parentNode.insertBefore(planStrip, inputRow);
      else return;
    }
    var parts = [];
    parts.push('<span class="chat-plan-tier ' + (info.tier === 'Premium' ? 'premium' : '') + '">' + info.tier + '</span>');
    if (info.tier === 'Free' && !info.premiumOnly) {
      parts.push('<span class="chat-plan-quota">' + info.remaining + ' of ' + info.limit + ' left today</span>');
    }
    parts.push('<span class="chat-plan-detail">' + info.detail + '</span>');
    if (info.upgrade) {
      var href = accountSession ? (WORKER + '/checkout?session_token=' + encodeURIComponent(accountSession)) : '/account/';
      parts.push('<a class="chat-plan-upgrade" href="' + href + '">Go Premium →</a>');
    }
    planStrip.innerHTML = parts.join('');
  }

  // Optimistically reflect a used question so the quota updates without a refetch.
  function decrementQuota() {
    if (!planUser || planUser.plan === 'premium') return;
    if ((planUser.freeDailyLimit || 0) <= 0) return; // premium-only: no free quota to track
    var today = new Date().toISOString().slice(0, 10);
    if (!planUser.freeChatUsage || planUser.freeChatUsage.day !== today) {
      planUser.freeChatUsage = { day: today, count: 0 };
    }
    planUser.freeChatUsage.count++;
    renderPlanStrip();
  }

  updatePaywall();

  if (accountSession) {
    unlockBtn.textContent = 'Upgrade to Premium';
    unlockBtn.href = WORKER + '/checkout?session_token=' + encodeURIComponent(accountSession);
  } else {
    unlockBtn.textContent = 'Sign in — it’s free';
    unlockBtn.href = '/account/?error=login_required';
  }

  var expandBtn = document.getElementById('chat-expand');
  var closeBtn = document.getElementById('chat-close');

  // Inject a "reasoning" toggle into the header. Done from JS so shipping it is a
  // single-file (chat.js) deploy — no server-rendered markup change.
  (function setupThinkToggle() {
    var header = panel.querySelector('.chat-header');
    if (!header) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-header-btn chat-think-toggle';
    btn.setAttribute('aria-label', 'Toggle reasoning');
    btn.title = 'Show the AI’s reasoning before each answer';
    btn.textContent = '🧠';
    btn.classList.toggle('on', thinkPref);
    btn.setAttribute('aria-pressed', thinkPref ? 'true' : 'false');
    var firstBtn = header.querySelector('.chat-header-btn');
    header.insertBefore(btn, firstBtn);
    btn.addEventListener('click', function() {
      thinkPref = !thinkPref;
      try { localStorage.setItem(THINK_KEY, thinkPref ? '1' : '0'); } catch { /* storage off */ }
      btn.classList.toggle('on', thinkPref);
      btn.setAttribute('aria-pressed', thinkPref ? 'true' : 'false');
    });
  })();

  // Inject a "Saved answers" toggle into the header (logged-in readers only).
  (function setupSavedToggle() {
    if (!accountSession) return;
    var header = panel.querySelector('.chat-header');
    if (!header) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-header-btn chat-saved-toggle';
    btn.setAttribute('aria-label', 'Saved answers');
    btn.title = 'Saved answers';
    btn.textContent = '🔖';
    var firstBtn = header.querySelector('.chat-header-btn');
    header.insertBefore(btn, firstBtn);
    btn.addEventListener('click', function() {
      if (savedView && savedView.style.display === 'block') closeSaved();
      else openSaved();
    });
  })();

  function openPanel() {
    if (!panel.classList.contains('open')) {
      panel.classList.add('open');
      panel.classList.add('docked');
      document.body.classList.add('chat-docked');
      fab.classList.add('open');
    }
    input.focus();
  }

  function closePanel() {
    panel.classList.remove('open', 'docked', 'fullscreen');
    document.body.classList.remove('chat-docked', 'chat-fullscreen');
    fab.classList.remove('open');
  }

  fab.addEventListener('click', function() {
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  });

  if (expandBtn) {
    expandBtn.addEventListener('click', function() {
      var fs = panel.classList.toggle('fullscreen');
      document.body.classList.toggle('chat-fullscreen', fs);
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closePanel);
  }

  document.addEventListener('keydown', function(e) {
    // ⌘/Ctrl-K toggles the desk open/closed from anywhere.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (panel.classList.contains('open')) closePanel();
      else openPanel();
      return;
    }
    if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
  });

  // --- Context assembly ---

  function articleTitle(article) {
    var hh = article.querySelector('.hybrid-headline');
    if (!hh) {
      // Quick hits have no headline; use the repo name link instead.
      var qn = article.querySelector('.quick-hit-name');
      if (qn) return qn.textContent.trim() || 'this story';
      return 'this story';
    }
    var clone = hh.cloneNode(true);
    var share = clone.querySelector('.hybrid-share');
    if (share) share.remove();
    return clone.textContent.trim() || 'this story';
  }

  function articleContext(article) {
    if (!article) return '';
    var parts = [];
    parts.push(articleTitle(article));
    var sub = article.querySelector('.hybrid-subheadline');
    if (sub) parts.push(sub.textContent.trim());
    var summary = article.querySelector('.quick-hit-summary');
    if (summary) parts.push(summary.textContent.trim());
    var facts = [];
    if (article.dataset.repo) facts.push('Repo: ' + article.dataset.repo);
    if (article.dataset.stars) facts.push(article.dataset.stars + ' stars');
    if (article.dataset.lang) facts.push(article.dataset.lang);
    if (article.dataset.sentiment) facts.push('X sentiment: ' + article.dataset.sentiment);
    if (article.dataset.url) facts.push(article.dataset.url);
    if (facts.length) parts.push(facts.join(' · '));
    var full = article.querySelector('.hybrid-full') || article.querySelector('.hybrid-preview');
    if (full) parts.push(full.textContent.trim());
    return parts.join('\n').substring(0, 4000);
  }

  function sectionContext() {
    var active = document.querySelector('.section-panel.active') || document;
    var parts = [];
    active.querySelectorAll('.hybrid-headline').forEach(function(el) { parts.push(el.textContent.trim()); });
    active.querySelectorAll('.hybrid-subheadline').forEach(function(el) { parts.push(el.textContent.trim()); });
    active.querySelectorAll('.hybrid-preview').forEach(function(el) { parts.push(el.textContent.trim()); });
    return parts.join('\n').substring(0, 6000);
  }

  function getContext() {
    if (scoped && scoped.el && document.body.contains(scoped.el)) return articleContext(scoped.el);
    return sectionContext();
  }

  // --- Story focus ---

  function setScope(article) {
    scoped = { el: article, title: articleTitle(article) };
    ctxLabel.textContent = 'Asking about: ' + scoped.title;
    ctxBar.style.display = 'flex';
    input.placeholder = 'Ask about this story…';
  }

  function clearScope() {
    scoped = null;
    ctxBar.style.display = 'none';
    input.placeholder = 'Ask about an article…';
  }

  if (ctxClear) ctxClear.addEventListener('click', clearScope);

  // Delegated: any "Ask about this" button focuses the chat on its article.
  document.addEventListener('click', function(e) {
    var btn = e.target.closest && e.target.closest('.hybrid-ask');
    if (!btn) return;
    // Resolve the scope element: full hybrid articles or compact quick hits.
    var article = btn.closest('.hybrid-article') || btn.closest('.quick-hit');
    if (!article) return;
    setScope(article);
    openPanel();
  });

  // --- Minimal, safe Markdown renderer (escape first, then format) ---
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function renderInline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, function(_, c) { return '<code>' + c + '</code>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function renderMarkdown(text) {
    var out = [], lines = text.split('\n'), i = 0;
    while (i < lines.length) {
      var line = lines[i];
      // Fenced code block
      if (/^```/.test(line)) {
        var code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      // List block
      if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        var ordered = /^\s*\d+\.\s+/.test(line);
        var items = [];
        while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
          items.push('<li>' + renderInline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')) + '</li>');
          i++;
        }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
        continue;
      }
      if (line.trim() === '') { i++; continue; }
      // Paragraph (gather consecutive non-blank, non-block lines)
      var para = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !/^```/.test(lines[i]) &&
             !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      out.push('<p>' + renderInline(para.join(' ')) + '</p>');
    }
    return out.join('');
  }

  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }

  // Slash commands expand to natural questions that trip the research tools.
  function expandSlash(t) {
    var m = t.match(/^\/(compare|readme|releases|file)\s+(.+)/i);
    if (!m) return t;
    var arg = m[2].trim();
    switch (m[1].toLowerCase()) {
      case 'compare': return 'Compare ' + arg + ' — the key differences, trade-offs, and which to pick.';
      case 'readme': return 'Summarize the README of ' + arg + ' — what it does, how to use it, and any caveats.';
      case 'releases': return 'What are the recent releases of ' + arg + ', and what changed?';
      case 'file': return 'Show and explain the file: ' + arg + '.';
      default: return t;
    }
  }

  // Split a streamed answer into its <thinking> reasoning and the answer body.
  // The model emits "<thinking>...</thinking>" first (only when reasoning mode
  // is on); everything after the close tag is the answer.
  function splitThinking(s) {
    var open = s.indexOf('<thinking>');
    if (open === -1) return { thinking: '', answer: s, open: false };
    var rest = s.slice(open + 10);
    var close = rest.indexOf('</thinking>');
    if (close === -1) return { thinking: rest, answer: '', open: true };
    return { thinking: rest.slice(0, close), answer: rest.slice(close + 11), open: false };
  }

  // Turn [n] markers in rendered answer HTML into citation links.
  function linkifyCitations(html, sources) {
    if (!sources || !sources.length) return html;
    var byN = {};
    sources.forEach(function(s) { byN[s.n] = s; });
    return html.replace(/\[(\d+)\]/g, function(m, n) {
      var s = byN[n];
      if (!s) return m;
      return '<sup class="chat-cite"><a href="' + escAttr(s.url) + '" target="_blank" rel="noopener" title="' +
        escAttr(s.title || '') + '">[' + n + ']</a></sup>';
    });
  }

  // Render the "Thinking" disclosure above an AI bubble (created lazily).
  function renderThinking(aiDiv, text, open) {
    if (!text) return;
    if (!aiDiv._thinkEl) {
      var d = document.createElement('details');
      d.className = 'chat-think';
      d.open = true;
      var sum = document.createElement('summary');
      sum.textContent = 'Thinking';
      d.appendChild(sum);
      var body = document.createElement('div');
      body.className = 'chat-think-body';
      d.appendChild(body);
      aiDiv.parentNode.insertBefore(d, aiDiv);
      aiDiv._thinkEl = d;
      aiDiv._thinkBody = body;
    }
    aiDiv._thinkBody.innerHTML = renderMarkdown(text);
    if (typeof open === 'boolean') aiDiv._thinkEl.open = open;
  }

  // Append the citation source list under an AI bubble (once).
  function appendSources(aiDiv, sources) {
    if (!sources || !sources.length || aiDiv._srcEl) return;
    var f = document.createElement('div');
    f.className = 'chat-sources';
    var label = document.createElement('span');
    label.className = 'chat-sources-label';
    label.textContent = 'Sources';
    f.appendChild(label);
    sources.forEach(function(s) {
      var a = document.createElement('a');
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'chat-source';
      a.textContent = '[' + s.n + '] ' + s.title;
      f.appendChild(a);
    });
    aiDiv.appendChild(f);
    aiDiv._srcEl = f;
  }

  // Final render of an AI answer: markdown + inline citations + source list.
  function renderAnswer(aiDiv, answerText, sources, question) {
    aiDiv.innerHTML = linkifyCitations(renderMarkdown(answerText || ''), sources);
    appendSources(aiDiv, sources);
    aiDiv._answer = answerText || '';
    aiDiv._sources = sources || [];
    aiDiv._question = question || '';
    addSaveButton(aiDiv);
  }

  // A "Save" affordance under each answer, for logged-in readers.
  function addSaveButton(aiDiv) {
    if (!accountSession || aiDiv._saveBtn || !aiDiv._answer) return;
    var bar = document.createElement('div');
    bar.className = 'chat-actions';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-save-btn';
    btn.textContent = '☆ Save';
    btn.addEventListener('click', function() { saveAnswer(aiDiv, btn); });
    bar.appendChild(btn);
    aiDiv.appendChild(bar);
    aiDiv._saveBtn = btn;
  }

  function markSaved(btn) {
    btn.textContent = '★ Saved';
    btn.classList.add('saved');
    btn.disabled = true;
  }

  function saveAnswer(aiDiv, btn) {
    if (!accountSession) return;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    fetch(WORKER + '/chat/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accountSession },
      body: JSON.stringify({ text: aiDiv._answer, sources: aiDiv._sources, question: aiDiv._question })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d && d.ok) markSaved(btn);
      else { btn.textContent = '☆ Save'; btn.disabled = false; }
    })
    .catch(function() { btn.textContent = '☆ Save'; btn.disabled = false; });
  }

  // --- Saved-answers view (a list that swaps in over the message stream) ---
  var savedView = null;

  function ensureSavedView() {
    if (savedView) return savedView;
    savedView = document.createElement('div');
    savedView.className = 'chat-saved';
    savedView.style.display = 'none';
    if (msgs && msgs.parentNode) msgs.parentNode.insertBefore(savedView, msgs.nextSibling);
    return savedView;
  }

  function closeSaved() {
    if (savedView) savedView.style.display = 'none';
    if (msgs) msgs.style.display = '';
  }

  function openSaved() {
    if (!accountSession) return;
    ensureSavedView();
    msgs.style.display = 'none';
    savedView.style.display = 'block';
    savedView.innerHTML =
      '<div class="chat-saved-head"><span>Saved answers</span><button class="chat-saved-close" type="button">Close</button></div>' +
      '<div class="chat-saved-list">Loading…</div>';
    savedView.querySelector('.chat-saved-close').addEventListener('click', closeSaved);
    fetch(WORKER + '/chat/saved', { headers: { 'Authorization': 'Bearer ' + accountSession } })
      .then(function(r) { return r.json(); })
      .then(function(d) { renderSavedList((d && d.saved) || []); })
      .catch(function() {
        var l = savedView.querySelector('.chat-saved-list');
        if (l) l.textContent = 'Could not load saved answers.';
      });
  }

  function renderSavedList(items) {
    var list = savedView.querySelector('.chat-saved-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<p class="chat-saved-empty">No saved answers yet. Tap ☆ Save under any answer to keep it.</p>';
      return;
    }
    list.innerHTML = '';
    items.forEach(function(it) {
      var row = document.createElement('div');
      row.className = 'chat-saved-item';
      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'chat-saved-open';
      open.textContent = it.question || (it.text || '').slice(0, 80) || 'Saved answer';
      open.addEventListener('click', function() { openSavedAnswer(it); });
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'chat-saved-remove';
      rm.setAttribute('aria-label', 'Remove');
      rm.textContent = '×';
      rm.addEventListener('click', function() { removeSaved(it.id, row); });
      row.appendChild(open);
      row.appendChild(rm);
      list.appendChild(row);
    });
  }

  function openSavedAnswer(it) {
    closeSaved();
    if (it.question) addMsg('user', it.question);
    var div = addMsg('ai', '');
    renderAnswer(div, it.text || '', it.sources || [], it.question || '');
    if (div._saveBtn) markSaved(div._saveBtn);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeSaved(id, row) {
    fetch(WORKER + '/chat/saved/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accountSession },
      body: JSON.stringify({ id: id })
    })
    .then(function(r) { return r.json(); })
    .then(function() { if (row && row.parentNode) row.parentNode.removeChild(row); })
    .catch(function() {});
  }

  function addMsg(role, text) {
    var div = document.createElement('div');
    div.className = role === 'user' ? 'chat-msg-user' : 'chat-msg-ai';
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  // --- Transcript persistence (survives navigation within the tab) ---
  // We persist the model-facing history (with its stuffed context) plus the
  // visible bubbles. We do NOT persist `scoped`: it's bound to a DOM element
  // that won't exist on the next page, so scope correctly resets on navigation.
  function persistTranscript() {
    try {
      sessionStorage.setItem(TRANSCRIPT_KEY, JSON.stringify({ history: history_msgs, display: display_msgs }));
    } catch { /* private mode / quota — persistence is best-effort */ }
  }

  function rehydrateTranscript() {
    var raw;
    try { raw = sessionStorage.getItem(TRANSCRIPT_KEY); } catch { return; }
    if (!raw) return;
    var data;
    try { data = JSON.parse(raw); } catch { return; }
    if (!data || !data.display || !data.display.length) return;
    history_msgs = data.history || [];
    display_msgs = data.display;
    var starters = document.getElementById('chat-starters');
    if (starters) starters.style.display = 'none';
    display_msgs.forEach(function(m) {
      if (m.role === 'user') {
        addMsg('user', m.text);
      } else {
        var div = addMsg('ai', '');
        renderAnswer(div, m.text || '', m.sources, m.question);
      }
    });
    msgs.scrollTop = msgs.scrollHeight;
  }

  // Starter-question chips: click to ask.
  document.addEventListener('click', function(e) {
    var chip = e.target.closest && e.target.closest('.chat-starter');
    if (!chip) return;
    input.value = chip.textContent.trim();
    sendMessage();
  });

  async function sendMessage() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendBtn.disabled = true;
    var starters = document.getElementById('chat-starters');
    if (starters) starters.style.display = 'none';
    addMsg('user', text);

    var query = expandSlash(text);
    var context = getContext();
    var label = scoped ? 'Story in focus' : "Today's stories";
    var userMsg = context ? label + ':\n' + context + '\n\nQuestion: ' + query : query;
    history_msgs.push({ role: 'user', content: userMsg });
    display_msgs.push({ role: 'user', text: text });
    persistTranscript();

    var aiDiv = addMsg('ai', '');
    aiDiv.classList.add('streaming');
    var full = '';
    var sources = null;
    var reasoning = '';

    try {
      var chatHeaders = { 'Content-Type': 'application/json' };
      if (accountSession) chatHeaders['Authorization'] = 'Bearer ' + accountSession;
      var res = await fetch(WORKER + '/chat', {
        method: 'POST',
        headers: chatHeaders,
        body: JSON.stringify({ session_id: sessionId, messages: history_msgs, think: thinkPref })
      });

      if (res.status === 403) {
        localStorage.removeItem('gittimes-chat-session');
        sessionId = null;
        updatePaywall();
        aiDiv.textContent = 'Session expired. Please unlock again.';
        aiDiv.classList.remove('streaming');
        sendBtn.disabled = false;
        return;
      }

      if (res.status === 429) {
        var info = {};
        try { info = await res.json(); } catch { /* keep default {} on parse failure */ }
        var note = info.message || 'You’ve reached your limit for now.';
        aiDiv.classList.remove('streaming');
        aiDiv.innerHTML = renderMarkdown(note);
        if (info.upgrade) {
          var up = document.createElement('a');
          up.className = 'chat-upgrade-link';
          up.href = accountSession ? (WORKER + '/checkout?session_token=' + encodeURIComponent(accountSession)) : '/account/';
          up.textContent = 'Upgrade to Premium →';
          aiDiv.appendChild(up);
        }
        sendBtn.disabled = false;
        return;
      }

      if (!res.ok) throw new Error('Request failed');

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith('data: ')) continue;
          var data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            var parsed = JSON.parse(data);
            // Custom event: citation sources, sent before the model stream.
            if (parsed.sources) { sources = parsed.sources; continue; }
            var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
            if (!delta) continue;
            // Native reasoning tokens (reasoning models) feed the Thinking pane.
            if (delta.reasoning) {
              reasoning += delta.reasoning;
              renderThinking(aiDiv, reasoning, true);
            }
            if (delta.content) {
              full += delta.content;
              var sp = splitThinking(full);
              var think = reasoning + (sp.thinking ? (reasoning ? '\n' : '') + sp.thinking : '');
              if (think) renderThinking(aiDiv, think, sp.open);
              aiDiv.innerHTML = renderMarkdown(sp.answer);
              msgs.scrollTop = msgs.scrollHeight;
            }
          } catch { /* skip malformed SSE chunk */ }
        }
      }

      // Final render: separate answer from thinking, add inline citations.
      var done = splitThinking(full);
      var answer = done.answer || full;
      if (aiDiv._thinkEl) aiDiv._thinkEl.open = false; // collapse once answered
      renderAnswer(aiDiv, answer, sources, text);
      msgs.scrollTop = msgs.scrollHeight;

      history_msgs.push({ role: 'assistant', content: answer });
      display_msgs.push({ role: 'ai', text: answer, sources: sources, question: text });
      persistTranscript();
      decrementQuota();
    } catch {
      aiDiv.textContent = full || 'Something went wrong. Please try again.';
    }

    aiDiv.classList.remove('streaming');
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Restore any prior conversation from this tab session.
  rehydrateTranscript();
})();
