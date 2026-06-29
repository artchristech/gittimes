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
      // Any logged-in account can chat — free accounts get a daily allowance,
      // premium gets unlimited. Only anonymous visitors hit the paywall.
      fetch(WORKER + '/auth/me', {
        headers: { 'Authorization': 'Bearer ' + accountSession }
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok && data.user) { planUser = data.user; renderPlanStrip(); showChat(); }
        else showPaywall();
      })
      .catch(showPaywall);
    } else {
      showPaywall();
    }
  }

  // --- Plan transparency strip: what your plan is for + quota remaining ---
  var planUser = null;
  var planStrip = null;

  function planInfo(u) {
    if (!u) return null;
    if (u.plan === 'premium') {
      return { tier: 'Premium', detail: 'Deep research, repo lookups & side-by-side compares' };
    }
    var today = new Date().toISOString().slice(0, 10);
    var used = (u.freeChatUsage && u.freeChatUsage.day === today) ? u.freeChatUsage.count : 0;
    var limit = u.freeDailyLimit || 3;
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
    if (info.tier === 'Free') {
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
  function renderAnswer(aiDiv, answerText, sources) {
    aiDiv.innerHTML = linkifyCitations(renderMarkdown(answerText || ''), sources);
    appendSources(aiDiv, sources);
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
        renderAnswer(div, m.text || '', m.sources);
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
      renderAnswer(aiDiv, answer, sources);
      msgs.scrollTop = msgs.scrollHeight;

      history_msgs.push({ role: 'assistant', content: answer });
      display_msgs.push({ role: 'ai', text: answer, sources: sources });
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
