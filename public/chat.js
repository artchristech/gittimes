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
  var scoped = null; // { el, title } when focused on a single story

  // Reveal the per-article "Ask about this" buttons now that chat is available.
  document.body.classList.add('chat-on');

  function updatePaywall() {
    if (sessionId) {
      paywall.style.display = 'none';
      inputRow.style.display = 'flex';
    } else if (accountSession) {
      fetch(WORKER + '/auth/me', {
        headers: { 'Authorization': 'Bearer ' + accountSession }
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok && data.user && data.user.plan === 'premium') {
          paywall.style.display = 'none';
          inputRow.style.display = 'flex';
        } else {
          paywall.style.display = 'flex';
          inputRow.style.display = 'none';
        }
      })
      .catch(function() {
        paywall.style.display = 'flex';
        inputRow.style.display = 'none';
      });
    } else {
      paywall.style.display = 'flex';
      inputRow.style.display = 'none';
    }
  }
  updatePaywall();

  if (accountSession) {
    unlockBtn.href = WORKER + '/checkout?session_token=' + encodeURIComponent(accountSession);
  } else {
    unlockBtn.href = '/account/?error=login_required';
  }

  function openPanel() {
    if (!panel.classList.contains('open')) {
      panel.classList.add('open');
      fab.classList.add('open');
    }
    input.focus();
  }

  fab.addEventListener('click', function() {
    var open = panel.classList.toggle('open');
    fab.classList.toggle('open', open);
    if (open) input.focus();
  });

  // --- Context assembly ---

  function articleTitle(article) {
    var hh = article.querySelector('.hybrid-headline');
    if (!hh) return 'this story';
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
    var article = btn.closest('.hybrid-article');
    if (!article) return;
    setScope(article);
    openPanel();
  });

  function addMsg(role, text) {
    var div = document.createElement('div');
    div.className = role === 'user' ? 'chat-msg-user' : 'chat-msg-ai';
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  async function sendMessage() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendBtn.disabled = true;
    addMsg('user', text);

    var context = getContext();
    var label = scoped ? 'Story in focus' : "Today's stories";
    var userMsg = context ? label + ':\n' + context + '\n\nQuestion: ' + text : text;
    history_msgs.push({ role: 'user', content: userMsg });

    var aiDiv = addMsg('ai', '');
    aiDiv.classList.add('streaming');
    var full = '';

    try {
      var chatHeaders = { 'Content-Type': 'application/json' };
      if (accountSession) chatHeaders['Authorization'] = 'Bearer ' + accountSession;
      var res = await fetch(WORKER + '/chat', {
        method: 'POST',
        headers: chatHeaders,
        body: JSON.stringify({ session_id: sessionId, messages: history_msgs })
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
            var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
            if (delta && delta.content) {
              full += delta.content;
              aiDiv.textContent = full;
              msgs.scrollTop = msgs.scrollHeight;
            }
          } catch(e) {}
        }
      }

      history_msgs.push({ role: 'assistant', content: full });
    } catch(e) {
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
})();
