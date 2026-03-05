const fs = require("fs");
const path = require("path");

let markedParse = null;

async function initMarked() {
  if (markedParse) return;
  const { marked } = await import("marked");
  marked.setOptions({ gfm: true, breaks: false });
  markedParse = marked.parse.bind(marked);
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatStars(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

const SAFE_TAGS = new Set([
  "p","strong","em","b","i","code","pre","ul","ol","li","a","br",
  "blockquote","h1","h2","h3","h4","h5","h6","hr","del","s",
  "table","thead","tbody","tr","th","td",
]);

function sanitizeArticleHtml(html) {
  // Strip event handlers
  html = html.replace(/\bon\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "");
  // Neutralize dangerous href schemes (keep http/https only)
  html = html.replace(/href\s*=\s*"(?!https?:\/\/)[a-z][a-z0-9+.-]*:[^"]*"/gi, 'href="#"');
  html = html.replace(/href\s*=\s*'(?!https?:\/\/)[a-z][a-z0-9+.-]*:[^']*'/gi, "href='#'");
  // Strip tags not in allowlist (catches script, iframe, style, object, embed, form, svg, etc.)
  html = html.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi, (match, tagName) => {
    return SAFE_TAGS.has(tagName.toLowerCase()) ? match : "";
  });
  return html;
}

function bodyToHtml(text) {
  if (markedParse) {
    return sanitizeArticleHtml(markedParse(text));
  }
  return text
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("\n      ");
}

function renderInsights(useCases, similarProjects) {
  if ((!useCases || useCases.length === 0) && (!similarProjects || similarProjects.length === 0)) {
    return "";
  }
  let html = `<div class="article-insights">`;
  if (useCases && useCases.length > 0) {
    html += `<div class="insights-col">`;
    html += `<span class="insights-label">Use Cases</span>`;
    html += `<ul>${useCases.map((uc) => `<li>${escapeHtml(uc)}</li>`).join("")}</ul>`;
    html += `</div>`;
  }
  if (similarProjects && similarProjects.length > 0) {
    html += `<div class="insights-col">`;
    html += `<span class="insights-label">Similar Projects</span>`;
    html += `<ul>${similarProjects.map((sp) => `<li>${escapeHtml(sp)}</li>`).join("")}</ul>`;
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

function renderLeadStory(article) {
  const { headline, subheadline, body, useCases, similarProjects, repo, xSentiment } = article;
  return `
    <h2 class="lead-headline">${escapeHtml(headline)}</h2>
    <p class="lead-subheadline">${escapeHtml(subheadline)}</p>
    <div class="lead-meta">
      <span><a href="${escapeHtml(repo.url)}" target="_blank">${escapeHtml(repo.name)}</a></span>
      <span>${escapeHtml(repo.language)}</span>
      ${repo.releaseName ? `<span>Latest: ${escapeHtml(repo.releaseName)}</span>` : ""}
      <span>${formatStars(repo.stars)} stars</span>
    </div>
    <div class="lead-body">
      ${bodyToHtml(body)}
      ${renderInsights(useCases, similarProjects)}
      ${renderSentimentBadge(xSentiment)}
    </div>`;
}

function renderFeaturedArticle(article) {
  const { headline, subheadline, body, useCases, similarProjects, repo, xSentiment } = article;
  return `
      <article class="featured-article">
        <h3 class="featured-headline">${escapeHtml(headline)}</h3>
        <p class="featured-subheadline">${escapeHtml(subheadline)}</p>
        <div class="featured-meta">
          <a href="${escapeHtml(repo.url)}" target="_blank">${escapeHtml(repo.name)}</a> · ${escapeHtml(repo.language)} · ${formatStars(repo.stars)} stars
        </div>
        <div class="featured-body">
          ${bodyToHtml(body)}
        </div>
        ${renderInsights(useCases, similarProjects)}
        ${renderSentimentBadge(xSentiment)}
      </article>`;
}

function renderCompactArticle(article) {
  const { headline, subheadline, repo } = article;
  return `
      <article class="compact-article">
        <h3 class="compact-headline">${escapeHtml(headline)}</h3>
        <p class="compact-subheadline">${escapeHtml(subheadline)}</p>
        <div class="compact-meta">
          <a href="${escapeHtml(repo.url)}" target="_blank">${escapeHtml(repo.name)}</a> · ${escapeHtml(repo.language)} · ${formatStars(repo.stars)} stars
        </div>
      </article>`;
}

function renderQuickHit(hit) {
  return `
      <div class="quick-hit">
        <span class="quick-hit-name"><a href="${escapeHtml(hit.url)}" target="_blank">${escapeHtml(hit.shortName || hit.name)}</a></span>
        <span class="quick-hit-summary">${escapeHtml(hit.summary)}</span>
        <span class="quick-hit-stars">${formatStars(hit.stars)}</span>
      </div>`;
}

function renderSentimentBadge(xSentiment) {
  if (!xSentiment || xSentiment._failed || xSentiment.sentiment === "unknown") {
    return "";
  }
  const sentiment = escapeHtml(xSentiment.sentiment);
  const postCount = xSentiment.postCount || 0;
  const blurb = xSentiment.blurb ? escapeHtml(xSentiment.blurb) : "";
  let badgeHtml = `<div class="x-sentiment">`;
  badgeHtml += `<span class="x-sentiment-badge x-sentiment-${sentiment}">${sentiment}`;
  if (postCount > 0) {
    badgeHtml += ` <span class="x-sentiment-count">${postCount} posts</span>`;
  }
  badgeHtml += `</span>`;
  if (blurb) {
    badgeHtml += `<span class="x-sentiment-blurb">${blurb}</span>`;
  }
  badgeHtml += `</div>`;
  return badgeHtml;
}

function renderDeepCuts(articles) {
  if (!articles || articles.length === 0) return "";
  return `<section class="deep-cuts-section">
  <h2 class="section-header">Deep Cuts</h2>
  <div class="deep-cuts-grid">${articles.map(renderFeaturedArticle).join("\n")}</div>
</section>`;
}

function renderMemesContent() {
  return `<div class="section-empty">Memes section coming soon. Check back tomorrow!</div>`;
}

/**
 * Build navigation HTML for edition pages.
 * @param {object} nav - { prev?: { url, label }, next?: { url, label }, archive?: string }
 * @returns {string} HTML string (empty string if no nav provided)
 */
function buildNavHtml(nav) {
  if (!nav) return "";
  const links = [];
  if (nav.prev) {
    links.push(`<a href="${escapeHtml(nav.prev.url)}">&larr; ${escapeHtml(nav.prev.label)}</a>`);
  }
  if (nav.archive) {
    links.push(`<a href="${escapeHtml(nav.archive)}">Archive</a>`);
  }
  if (nav.next) {
    links.push(`<a href="${escapeHtml(nav.next.url)}">${escapeHtml(nav.next.label)} &rarr;</a>`);
  }
  if (links.length === 0) return "";
  return `<nav class="edition-nav">${links.join(" · ")}</nav>`;
}

/**
 * Render the section navigation tab bar.
 * @param {string[]} sectionOrder - Array of section IDs
 * @param {object} sections - { frontPage: { isEmpty, ... }, ai: {...}, ... }
 * @param {object} sectionConfigs - SECTIONS config object
 * @returns {string} HTML string
 */
function renderSectionNav(sectionOrder, sections, sectionConfigs) {
  const tabs = sectionOrder.map((id, i) => {
    const config = sectionConfigs[id];
    const sectionData = sections[id];
    const isEmpty = !sectionData || sectionData.isEmpty;
    const activeClass = i === 0 ? " active" : "";
    const disabled = isEmpty ? " disabled" : "";
    return `<button class="section-tab${activeClass}" data-section="${escapeHtml(id)}"${disabled}>${escapeHtml(config.label)}</button>`;
  });
  return `<nav class="section-nav">${tabs.join("")}</nav>`;
}

/**
 * Render content for a single section panel.
 * @param {object} sectionData - { lead, secondary, quickHits, isEmpty }
 * @param {object} sectionConfig - Section config
 * @returns {string} HTML string
 */
function renderSectionContent(sectionData, sectionConfig) {
  if (sectionConfig.isMemes) return renderMemesContent();

  if (!sectionData || sectionData.isEmpty || !sectionData.lead) {
    return `<div class="section-empty">No stories found for ${escapeHtml(sectionConfig.label)} today. Check back tomorrow!</div>`;
  }

  const isFrontPage = sectionConfig.id === "frontPage";
  const featuredCount = isFrontPage ? 2 : 1;

  let html = "";

  // Lead story
  html += `<article class="lead-story">${renderLeadStory(sectionData.lead)}</article>`;

  // Secondary section
  if (sectionData.secondary.length > 0) {
    const featured = sectionData.secondary.slice(0, featuredCount);
    const compact = sectionData.secondary.slice(featuredCount);

    html += `<section class="secondary-section">`;
    html += `<h2 class="section-header">More Stories</h2>`;
    if (featured.length > 0) {
      html += `<div class="featured-grid">${featured.map(renderFeaturedArticle).join("\n")}</div>`;
    }
    if (compact.length > 0) {
      html += `<div class="compact-grid">${compact.map(renderCompactArticle).join("\n")}</div>`;
    }
    html += `</section>`;
  }

  // Deep Cuts (sleeper articles)
  if (sectionData.deepCuts && sectionData.deepCuts.length > 0) {
    html += renderDeepCuts(sectionData.deepCuts);
  }

  // Quick hits
  if (sectionData.quickHits.length > 0) {
    html += `<section class="quick-hits-section">`;
    html += `<h2 class="section-header">Quick Hits</h2>`;
    html += `<div class="quick-hits-list">${sectionData.quickHits.map(renderQuickHit).join("\n")}</div>`;
    html += `<button class="quick-hits-toggle">Show more</button>`;
    html += `</section>`;
  }

  return html;
}

function renderChatUi() {
  return `
  <button class="chat-fab" id="chat-fab" aria-label="Chat">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  </button>
  <div class="chat-panel" id="chat-panel">
    <div class="chat-header">Git Times Chat</div>
    <div class="chat-messages" id="chat-messages">
      <div class="chat-msg-ai">Ask me anything about today's articles.</div>
    </div>
    <div class="chat-paywall" id="chat-paywall">
      <p>Unlock AI chat to ask questions about today's stories.</p>
      <a class="chat-paywall-btn" id="chat-unlock-btn">Unlock for $1 (24h pass)</a>
    </div>
    <div class="chat-input-row" id="chat-input-row" style="display:none">
      <input class="chat-input" id="chat-input" type="text" placeholder="Ask about an article..." autocomplete="off">
      <button class="chat-send" id="chat-send">Send</button>
    </div>
  </div>`;
}

function renderChatScript(workerUrl) {
  return `<script>
(function() {
  var WORKER = ${JSON.stringify(workerUrl)};
  var fab = document.getElementById('chat-fab');
  var panel = document.getElementById('chat-panel');
  var msgs = document.getElementById('chat-messages');
  var paywall = document.getElementById('chat-paywall');
  var inputRow = document.getElementById('chat-input-row');
  var input = document.getElementById('chat-input');
  var sendBtn = document.getElementById('chat-send');
  var unlockBtn = document.getElementById('chat-unlock-btn');

  // Session management: capture from URL redirect
  var params = new URLSearchParams(location.search);
  var sessionParam = params.get('chat_session');
  if (sessionParam) {
    localStorage.setItem('gittimes-chat-session', sessionParam);
    params.delete('chat_session');
    var qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  var sessionId = localStorage.getItem('gittimes-chat-session');
  var accountSession = localStorage.getItem('gittimes-session');
  var history_msgs = [];

  function updatePaywall() {
    if (sessionId || accountSession) {
      paywall.style.display = 'none';
      inputRow.style.display = 'flex';
    } else {
      paywall.style.display = 'flex';
      inputRow.style.display = 'none';
    }
  }
  updatePaywall();

  var checkoutUrl = WORKER + '/checkout';
  if (accountSession) checkoutUrl += '?session_token=' + encodeURIComponent(accountSession);
  unlockBtn.href = checkoutUrl;

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
    return parts.join('\\n').substring(0, 6000);
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
    var userMsg = context ? 'Article context:\\n' + context + '\\n\\nQuestion: ' + text : text;
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
        var lines = buf.split('\\n');
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
</script>`;
}

/**
 * Assemble multi-section HTML from content with sections shape.
 * @param {object} content - { sections: { frontPage: {...}, ... }, tagline }
 * @param {object} options - Same as assembleHtml options
 * @returns {Promise<string>} Complete HTML string
 */
async function assembleMultiSectionHtml(content, options = {}) {
  await initMarked();
  const { SECTIONS, SECTION_ORDER } = require("./sections");
  const templatePath = path.join(__dirname, "..", "templates", "newspaper.html");
  const cssPath = path.join(__dirname, "..", "styles", "newspaper.css");

  const template = fs.readFileSync(templatePath, "utf-8");
  const css = fs.readFileSync(cssPath, "utf-8");

  const now = options.date || new Date();
  const editionDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const navHtml = buildNavHtml(options.nav);

  // Build section nav
  const sectionNavHtml = renderSectionNav(SECTION_ORDER, content.sections, SECTIONS);

  // Build section panels
  const panelsHtml = SECTION_ORDER.map((id, i) => {
    const sectionData = content.sections[id];
    const config = SECTIONS[id];
    const activeClass = i === 0 ? " active" : "";
    const panelContent = renderSectionContent(sectionData, config);
    return `<div class="section-panel${activeClass}" data-section="${escapeHtml(id)}">${panelContent}</div>`;
  }).join("\n");

  const chatWorkerUrl = process.env.CHAT_WORKER_URL || "";

  const plausibleDomain = process.env.PLAUSIBLE_DOMAIN || "";
  const analyticsScript = plausibleDomain
    ? `<script defer data-domain="${escapeHtml(plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`
    : "";
  const cspScriptSrc = plausibleDomain ? " https://plausible.io" : "";
  const cspConnectSrc = [
    chatWorkerUrl ? " " + chatWorkerUrl : "",
    plausibleDomain ? " https://plausible.io" : "",
  ].join("");

  // OG meta tag values
  const frontPageLead = content.sections?.frontPage?.lead;
  const ogTitle = escapeHtml(
    frontPageLead ? frontPageLead.headline + " — The Git Times" : "The Git Times — " + editionDate
  );
  const ogDescription = escapeHtml(
    content.tagline || (frontPageLead ? frontPageLead.subheadline : "AI-generated newspaper for builders")
  );
  const siteUrl = options.siteUrl || "https://gittimes.com";
  const dateStr = options.dateStr || toDateStr(options.date || new Date());
  const ogUrl = siteUrl + (options.basePath || "") + "/editions/" + dateStr + "/";

  let html = template
    .replace("{{STYLES}}", css)
    .replace(/\{\{EDITION_DATE\}\}/g, editionDate)
    .replace("{{EDITION_TAGLINE}}", escapeHtml(content.tagline))
    .replace("{{SECTION_NAV}}", sectionNavHtml)
    .replace("{{SECTION_PANELS}}", panelsHtml)
    // Clear legacy placeholders that are unused in multi-section mode
    .replace("{{LEAD_STORY_SECTION}}", "")
    .replace("{{SECONDARY_SECTION}}", "")
    .replace("{{QUICK_HITS_SECTION}}", "")
    .replace(/\{\{NAVIGATION\}\}/g, navHtml)
    .replace(/\{\{BASE_PATH\}\}/g, options.basePath || "")
    .replace("{{CHAT_UI}}", chatWorkerUrl ? renderChatUi() : "")
    .replace("{{CHAT_SCRIPT}}", chatWorkerUrl ? renderChatScript(chatWorkerUrl) : "")
    .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
    .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
    .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc)
    .replace("{{FEED_URL}}", siteUrl + "/feed.xml")
    .replace(/\{\{OG_TITLE\}\}/g, ogTitle)
    .replace(/\{\{OG_DESCRIPTION\}\}/g, ogDescription)
    .replace("{{OG_URL}}", ogUrl);

  return html;
}

/**
 * Assemble full HTML string from content + options.
 * Detects content shape: if content.sections exists, uses multi-section path.
 * @param {object} content - { lead, secondary, quickHits, tagline } OR { sections: {...}, tagline }
 * @param {object} [options] - { date?: Date, nav?: object }
 * @returns {Promise<string>} Complete HTML string
 */
async function assembleHtml(content, options = {}) {
  // Multi-section shape detection
  if (content.sections) {
    return assembleMultiSectionHtml(content, options);
  }

  // Legacy single-section path
  await initMarked();
  const templatePath = path.join(__dirname, "..", "templates", "newspaper.html");
  const cssPath = path.join(__dirname, "..", "styles", "newspaper.css");

  const template = fs.readFileSync(templatePath, "utf-8");
  const css = fs.readFileSync(cssPath, "utf-8");

  const now = options.date || new Date();
  const editionDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const navHtml = buildNavHtml(options.nav);

  // Build lead section — only render if lead exists
  let leadSectionHtml = "";
  if (content.lead) {
    leadSectionHtml = `<article class="lead-story">${renderLeadStory(content.lead)}</article>`;
  }

  // Build secondary section — only render if there are secondary articles
  let secondarySectionHtml = "";
  if (content.secondary && content.secondary.length > 0) {
    const featured = content.secondary.slice(0, 2);
    const compact = content.secondary.slice(2);
    secondarySectionHtml = `<section class="secondary-section">
    <h2 class="section-header">More Stories</h2>
    <div class="featured-grid">${featured.map(renderFeaturedArticle).join("\n")}</div>
    ${compact.length > 0 ? `<div class="compact-grid">${compact.map(renderCompactArticle).join("\n")}</div>` : ""}
  </section>`;
  }

  // Build quick hits section — only render if there are quick hits
  let quickHitsSectionHtml = "";
  if (content.quickHits && content.quickHits.length > 0) {
    quickHitsSectionHtml = `<section class="quick-hits-section">
    <h2 class="section-header">Quick Hits</h2>
    <div class="quick-hits-list">${content.quickHits.map(renderQuickHit).join("\n")}</div>
    <button class="quick-hits-toggle" id="qh-toggle">Show more</button>
  </section>`;
  }

  const chatWorkerUrl = process.env.CHAT_WORKER_URL || "";

  const plausibleDomain = process.env.PLAUSIBLE_DOMAIN || "";
  const analyticsScript = plausibleDomain
    ? `<script defer data-domain="${escapeHtml(plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`
    : "";
  const cspScriptSrc = plausibleDomain ? " https://plausible.io" : "";
  const cspConnectSrc = [
    chatWorkerUrl ? " " + chatWorkerUrl : "",
    plausibleDomain ? " https://plausible.io" : "",
  ].join("");

  // OG meta tag values
  const ogTitle = escapeHtml(
    content.lead ? content.lead.headline + " — The Git Times" : "The Git Times — " + editionDate
  );
  const ogDescription = escapeHtml(
    content.tagline || (content.lead ? content.lead.subheadline : "AI-generated newspaper for builders")
  );
  const siteUrl = options.siteUrl || "https://gittimes.com";
  const dateStr = options.dateStr || toDateStr(options.date || new Date());
  const ogUrl = siteUrl + (options.basePath || "") + "/editions/" + dateStr + "/";

  let html = template
    .replace("{{STYLES}}", css)
    .replace(/\{\{EDITION_DATE\}\}/g, editionDate)
    .replace("{{EDITION_TAGLINE}}", escapeHtml(content.tagline))
    .replace("{{LEAD_STORY_SECTION}}", leadSectionHtml)
    .replace("{{SECONDARY_SECTION}}", secondarySectionHtml)
    .replace("{{QUICK_HITS_SECTION}}", quickHitsSectionHtml)
    .replace(/\{\{NAVIGATION\}\}/g, navHtml)
    .replace(/\{\{BASE_PATH\}\}/g, options.basePath || "")
    // Clear multi-section placeholders unused in legacy mode
    .replace("{{SECTION_NAV}}", "")
    .replace("{{SECTION_PANELS}}", "")
    .replace("{{CHAT_UI}}", chatWorkerUrl ? renderChatUi() : "")
    .replace("{{CHAT_SCRIPT}}", chatWorkerUrl ? renderChatScript(chatWorkerUrl) : "")
    .replace("{{ANALYTICS_SCRIPT}}", analyticsScript)
    .replace("{{CSP_SCRIPT_SRC}}", cspScriptSrc)
    .replace("{{CSP_CONNECT_SRC}}", cspConnectSrc)
    .replace("{{FEED_URL}}", siteUrl + "/feed.xml")
    .replace(/\{\{OG_TITLE\}\}/g, ogTitle)
    .replace(/\{\{OG_DESCRIPTION\}\}/g, ogDescription)
    .replace("{{OG_URL}}", ogUrl);

  return html;
}

/**
 * Original render function — thin wrapper over assembleHtml.
 * Writes to dist/index.html.
 */
async function render(content) {
  const distDir = path.join(__dirname, "..", "dist");
  const outPath = path.join(distDir, "index.html");

  const html = await assembleHtml(content);

  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(outPath, html);

  console.log(`\nOutput written to ${outPath}`);
  return outPath;
}

module.exports = { render, assembleHtml, assembleMultiSectionHtml, buildNavHtml, escapeHtml, formatStars, bodyToHtml, sanitizeArticleHtml, initMarked, renderLeadStory, renderFeaturedArticle, renderCompactArticle, renderSectionNav, renderSectionContent, renderDeepCuts, renderSentimentBadge, renderMemesContent };
