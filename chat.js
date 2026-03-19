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

  var sessionId = localStorage.getItem('gittimes-chat-session');
  var accountSession = localStorage.getItem('gittimes-session');
  var history_msgs = [];

  function updatePaywall() {
    if (sessionId) {
      paywall.style.display = 'none';
      inputRow.style.display = 'flex';
    } else if (accountSession) {
      // Check if user has premium plan before showing chat input
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

  fab.addEventListener('click', function() {
    var open = panel.classList.toggle('open');
    fab.classList.toggle('open', open);
    if (open) input.focus();
  });

  function getContext() {
    var active = document.querySelector('.section-panel.active');
    if (!active) return '';
    var parts = [];
    var lead = active.querySelector('.lead-headline');
    if (lead) parts.push(lead.textContent);
    var leadBody = active.querySelector('.lead-body');
    if (leadBody) parts.push(leadBody.textContent);
    active.querySelectorAll('.featured-headline').forEach(function(el) { parts.push(el.textContent); });
    active.querySelectorAll('.featured-body').forEach(function(el) { parts.push(el.textContent); });
    active.querySelectorAll('.compact-headline').forEach(function(el) { parts.push(el.textContent); });
    return parts.join('\n').substring(0, 6000);
  }

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
    var userMsg = context ? 'Article context:\n' + context + '\n\nQuestion: ' + text : text;
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
