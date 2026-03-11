/**
 * digest.js — flashcard viewer for the app.
 *
 * Called by app.js after a report is fetched from /api/reports/{tag}.
 *
 * Keyboard shortcuts (active when viewer is open and not typing):
 *   h / ←        previous card
 *   l / →        next card
 *   j / ↓        scroll card down
 *   k / ↑        scroll card up
 *   c            toggle comments section
 *   Ctrl+N       focus notes sidebar
 */
window.initDigestViewer = function (POSTS, weekTag) {
  let current = 0;

  // ── Subreddit colour palettes ─────────────────────
  const PALETTES = [
    ['#6366f1', '#8b5cf6', '#a78bfa'],
    ['#06b6d4', '#0d9488', '#22d3ee'],
    ['#f43f5e', '#e11d48', '#fb7185'],
    ['#f59e0b', '#ef4444', '#f97316'],
    ['#10b981', '#059669', '#34d399'],
    ['#3b82f6', '#1d4ed8', '#60a5fa'],
    ['#ec4899', '#a855f7', '#f0abfc'],
    ['#0ea5e9', '#6366f1', '#38bdf8'],
  ];
  const COVER_PALETTE = ['#1e3a5f', '#0f2744', '#2563eb'];
  const NOTES_PALETTE = ['#92400e', '#b45309', '#d97706'];

  const subPaletteMap = {};
  let nextPaletteIdx  = 0;

  function getPalette(post) {
    if (post.type === 'cover')         return COVER_PALETTE;
    if (post.type === 'notes_summary') return NOTES_PALETTE;
    if (!(post.subreddit in subPaletteMap))
      subPaletteMap[post.subreddit] = nextPaletteIdx++ % PALETTES.length;
    return PALETTES[subPaletteMap[post.subreddit]];
  }

  const BLOB_IDS = ['blob1', 'blob2', 'blob3'];
  function updateBg(palette) {
    BLOB_IDS.forEach((id, i) => {
      document.getElementById(id).style.backgroundColor = palette[i];
    });
  }

  // ── Platform helpers ──────────────────────────────
  function platformPrefix(platform) {
    if (platform === 'reddit')    return 'r/';
    if (platform === 'bluesky')   return '@';
    if (platform === 'instagram') return '@';
    if (platform === 'mastodon')  return '@';
    return '';
  }

  function platformBadge(platform) {
    if (!platform || platform === 'reddit') return '';
    const labels = { bluesky: 'bsky', tumblr: 'tumblr', instagram: 'ig', mastodon: 'masto' };
    const label  = labels[platform] || platform;
    return '<span class="platform-badge pb-' + platform + '">' + label + '</span>';
  }

  // ── Pre-populate localStorage from DB notes ───────
  POSTS.forEach(p => {
    if (p.note && p.link && !localStorage.getItem('note:' + p.link)) {
      localStorage.setItem('note:' + p.link, p.note);
    }
  });

  // ── Build subreddit start-index map ──────────────
  const subStarts      = {};
  const subPlatformMap = {};
  POSTS.forEach((p, i) => {
    if (p.type === 'cover' || p.type === 'notes_summary') return;
    if (!(p.subreddit in subStarts)) {
      subStarts[p.subreddit]      = i;
      subPlatformMap[p.subreddit] = p.platform || 'reddit';
    }
  });

  // ── Build tab bar ─────────────────────────────────
  const tabDefs = [];
  const tabsEl  = document.getElementById('tabs');
  tabsEl.innerHTML = '';

  function makeTab(label, extraClass) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    tabsEl.appendChild(btn);
    return btn;
  }

  const coverBtn = makeTab('\u2299 Digest', 'tab-special');
  coverBtn.onclick = () => navigateTo(0);
  tabDefs.push({ start: 0, end: 0, el: coverBtn });

  const subList = Object.keys(subStarts);
  subList.forEach((sub, i) => {
    const start    = subStarts[sub];
    const end      = i + 1 < subList.length
      ? subStarts[subList[i + 1]] - 1
      : POSTS.length - 2;
    const platform = subPlatformMap[sub] || 'reddit';
    const count    = end - start + 1;
    const btn      = makeTab(platformPrefix(platform) + sub + ' (' + count + ')');
    btn.onclick    = () => navigateTo(start);
    tabDefs.push({ start, end, el: btn });
  });

  const notesTabBtn = makeTab('\u270e Notes', 'tab-special');
  notesTabBtn.onclick = () => navigateTo(POSTS.length - 1);
  tabDefs.push({ start: POSTS.length - 1, end: POSTS.length - 1, el: notesTabBtn });

  // ── Bullet-point helpers ──────────────────────────
  function bulletizeNote(text) {
    if (!text.trim()) return '';
    return text.split('\n').map(function (line) {
      if (!line.trim()) return '';
      if (line.trimStart().startsWith('• ')) return line;
      return '• ' + line;
    }).filter(Boolean).join('\n');
  }

  // ── Helpers ───────────────────────────────────────
  function escAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function decodeHtml(s) {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  }
  function scoreClass(n) {
    return n >= 2000 ? 'score-high' : n >= 500 ? 'score-mid' : 'score-low';
  }

  // ── Special card renderers ────────────────────────

  function renderCoverCard(p) {
    const byPlatform = {};
    p.subreddits.forEach(s => {
      const pf = s.platform || 'reddit';
      if (!byPlatform[pf]) byPlatform[pf] = [];
      byPlatform[pf].push(s);
    });

    const platformNames = {
      reddit: 'Reddit', bluesky: 'Bluesky',
      tumblr: 'Tumblr', instagram: 'Instagram', mastodon: 'Mastodon',
    };

    function chipEl(s) {
      const prefix = platformPrefix(s.platform || 'reddit');
      const period = s.period ? '<small>' + escAttr(s.period) + '</small>' : '';
      return '<span class="chip chip-' + (s.platform || 'reddit') + '">' +
        prefix + escAttr(s.name) + period + '<em>' + s.count + '</em></span>';
    }

    let sectionsHtml = '';
    for (const [pf, srcs] of Object.entries(byPlatform)) {
      if (!srcs.length) continue;
      const pfLabel = platformNames[pf] || pf;
      sectionsHtml +=
        '<div class="cover-section">' +
          '<div class="cover-section-label">' + pfLabel + '</div>' +
          '<div class="cover-chips">' + srcs.map(chipEl).join('') + '</div>' +
        '</div>';
    }

    const words = POSTS
      .filter(q => q.type !== 'cover' && q.type !== 'notes_summary')
      .reduce((acc, q) => {
        let w = q.title ? q.title.split(/\s+/).length : 0;
        if (q.content && q.content.text) w += q.content.text.split(/\s+/).length;
        return acc + w;
      }, 0);
    const readMins = Math.max(1, Math.ceil(words / 200));

    document.getElementById('card').innerHTML =
      '<div class="cover-card">' +
        '<div class="cover-eyebrow">Digest</div>' +
        '<div class="cover-week">' + escAttr(p.week_tag) + '</div>' +
        '<div class="cover-meta">Generated ' + escAttr(p.generated) +
          ' &nbsp;&middot;&nbsp; ' + p.total_posts + ' posts' +
          ' &nbsp;&middot;&nbsp; ~' + readMins + ' min read</div>' +
        sectionsHtml +
        '<details class="cover-hint">' +
          '<summary>keyboard shortcuts</summary>' +
          '<div class="cover-hint-body">' +
            '<kbd>h</kbd> / <kbd>l</kbd> &nbsp; previous / next card<br>' +
            '<kbd>j</kbd> / <kbd>k</kbd> &nbsp; scroll down / up<br>' +
            '<kbd>c</kbd> &nbsp; toggle comments<br>' +
            '<kbd>Ctrl+N</kbd> &nbsp; focus notes<br>' +
            '<kbd>Esc</kbd> &nbsp; back to home<br>' +
          '</div>' +
        '</details>' +
      '</div>';
  }

  function renderNotesSummary() {
    const real  = POSTS.filter(p => p.type !== 'cover' && p.type !== 'notes_summary');
    const noted = real.filter(p => localStorage.getItem('note:' + p.link));

    if (noted.length === 0) {
      document.getElementById('card').innerHTML =
        '<div class="ns-header">Your Notes</div>' +
        '<div class="ns-empty">No notes yet.<br>' +
        'Navigate through cards and use the sidebar to jot thoughts.</div>';
      return;
    }

    const groups = {};
    noted.forEach(p => {
      const k = p.subreddit || '—';
      if (!groups[k]) groups[k] = [];
      groups[k].push(p);
    });

    let html = '<div class="ns-header">Your Notes</div>';
    for (const [sub, posts] of Object.entries(groups)) {
      const platform   = (posts[0] && posts[0].platform) || 'reddit';
      const groupLabel = platformPrefix(platform) + sub;
      html += '<div class="note-group"><div class="note-group-label">' +
        escAttr(groupLabel) + '</div>';
      for (const p of posts) {
        const raw     = localStorage.getItem('note:' + p.link) || '';
        const bullets = raw.split('\n')
          .map(l => l.replace(/^•\s*/, '').trim())
          .filter(Boolean)
          .map(t => '<li>' + escAttr(t) + '</li>')
          .join('');
        html +=
          '<div class="note-item">' +
            '<div class="note-item-title">' +
              '<a href="' + escAttr(p.link) + '" target="_blank" rel="noopener">' + p.title + '</a>' +
            '</div>' +
            '<ul class="note-item-list">' + bullets + '</ul>' +
          '</div>';
      }
      html += '</div>';
    }
    document.getElementById('card').innerHTML = html;
  }

  // ── Comment thread renderer ───────────────────────
  function renderComments(comments) {
    if (!comments || comments.length === 0) return '';

    function renderThread(list) {
      return list.map(c => {
        const body    = marked.parse(c.body || '');
        const replies = c.replies && c.replies.length > 0
          ? '<div class="comment-replies">' + renderThread(c.replies) + '</div>'
          : '';
        return (
          '<div class="comment">' +
            '<div class="comment-meta">' +
              escAttr(c.author) + ' &nbsp;&middot;&nbsp; ' +
              Number(c.score).toLocaleString() + ' pts' +
            '</div>' +
            '<div class="comment-body">' + body + '</div>' +
            replies +
          '</div>'
        );
      }).join('');
    }

    return '<div class="comments-section">' + renderThread(comments) + '</div>';
  }

  // ── Main render function ──────────────────────────
  const sidebarEl   = document.getElementById('sidebar');
  const cardScrollEl = document.getElementById('card-scroll');

  function renderCard(index) {
    const p = POSTS[index];
    current = index;

    tabDefs.forEach(({ start, end, el }) => {
      el.classList.toggle('active', index >= start && index <= end);
    });

    document.getElementById('topbar-progress').textContent =
      (index + 1) + ' / ' + POSTS.length;
    document.getElementById('topbar').style.setProperty(
      '--progress', ((index + 1) / POSTS.length * 100) + '%');

    updateBg(getPalette(p));

    const isSpecialCard = p.type === 'cover' || p.type === 'notes_summary';
    sidebarEl.style.display = isSpecialCard ? 'none' : '';

    const commentsEl = document.getElementById('card-comments');
    if (p.type === 'cover') {
      renderCoverCard(p);
      commentsEl.style.display = 'none';
      commentsEl.innerHTML = '';
    } else if (p.type === 'notes_summary') {
      renderNotesSummary();
      commentsEl.style.display = 'none';
      commentsEl.innerHTML = '';
    } else {
      let contentHtml = '';
      if (p.type === 'text' && p.content && p.content.text) {
        contentHtml = '<div class="selftext">' + marked.parse(p.content.text) + '</div>';
      } else if ((p.type === 'image' || p.type === 'gallery') && p.content && p.content.url) {
        contentHtml = '<img src="' + escAttr(p.content.url) + '" alt="" loading="lazy">';
      } else if (p.type === 'video' && p.content && p.content.url) {
        contentHtml = '<video src="' + escAttr(p.content.url) + '" controls muted preload="none"></video>';
      } else if (p.type === 'link' && p.content && p.content.url) {
        let domain = p.content.url;
        try { domain = new URL(p.content.url).hostname; } catch (e) {}
        contentHtml =
          '<div class="ext-link"><a href="' + escAttr(p.content.url) +
          '" target="_blank" rel="noopener">' + escAttr(domain) + '</a></div>';
      }

      const sc = scoreClass(p.score);
      document.getElementById('card').innerHTML =
        '<div class="card-title">' +
          '<a href="' + escAttr(p.link) + '" target="_blank" rel="noopener">' + p.title + '</a>' +
          '<span class="score ' + sc + '">' + p.score.toLocaleString() + '</span>' +
          platformBadge(p.platform) +
        '</div>' +
        contentHtml;

      if (p.type === 'text' && typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        MathJax.typesetPromise([document.getElementById('card')]).catch(console.error);
      }

      const commentsHtml = renderComments(p.comments);
      if (commentsHtml) {
        commentsEl.innerHTML =
          '<button class="comments-toggle" onclick="this.parentElement.classList.toggle(\'comments-open\')">' +
            'Top Comments (' + p.comments.length + ')' +
            '<span class="comments-chevron">&#9660;</span>' +
          '</button>' +
          '<div class="comments-collapsible">' + commentsHtml + '</div>';
        commentsEl.style.display = 'block';
        commentsEl.classList.remove('comments-open');
      } else {
        commentsEl.innerHTML = '';
        commentsEl.style.display = 'none';
      }

      // Populate notes sidebar
      const notesEl    = document.getElementById('notes');
      const notesTitEl = document.getElementById('notes-post-title');
      notesEl.value       = bulletizeNote(localStorage.getItem('note:' + p.link) || '');
      notesTitEl.textContent = decodeHtml(p.title);
    }

    cardScrollEl.scrollTop = 0;
  }

  // ── Navigation ────────────────────────────────────
  function navigateTo(index) {
    if (index < 0 || index >= POSTS.length || index === current) return;
    const cardEl = document.getElementById('card');
    const cls    = index > current ? 'anim-fwd' : 'anim-bwd';
    cardEl.classList.remove('anim-fwd', 'anim-bwd');
    void cardEl.offsetWidth;
    cardEl.classList.add(cls);
    renderCard(index);
  }

  function navigate(delta) { navigateTo(current + delta); }
  window.navigate = navigate;

  // ── Keyboard shortcuts ────────────────────────────
  //
  // When focus is in a textarea/input we don't capture h/j/k/l/c.
  // Ctrl+N works everywhere (it's an explicit toggle intent).
  function _onKeyDown(e) {
    const inText = e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT';

    // Ctrl+N → focus notes sidebar (works even when typing)
    if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      const notesEl = document.getElementById('notes');
      if (notesEl && sidebarEl.style.display !== 'none') {
        notesEl.focus();
        notesEl.selectionStart = notesEl.selectionEnd = notesEl.value.length;
      }
      return;
    }

    if (inText) return;

    if (e.key === 'ArrowLeft'  || e.key === 'h') { e.preventDefault(); navigate(-1); return; }
    if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); navigate(1);  return; }

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      cardScrollEl.scrollBy({ top: 120, behavior: 'smooth' });
      return;
    }
    if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      cardScrollEl.scrollBy({ top: -120, behavior: 'smooth' });
      return;
    }

    if (e.key === 'c') {
      const commentsEl = document.getElementById('card-comments');
      if (commentsEl && commentsEl.style.display !== 'none') {
        commentsEl.classList.toggle('comments-open');
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (typeof window.viewerBack === 'function') window.viewerBack();
      return;
    }
  }

  document.removeEventListener('keydown', window._digestKeyDown);
  window._digestKeyDown = _onKeyDown;
  document.addEventListener('keydown', _onKeyDown);

  // ── Copy notes button ─────────────────────────────
  const copyBtn = document.getElementById('btn-copy-notes');
  if (copyBtn) {
    copyBtn.onclick = function () {
      const real  = POSTS.filter(p => p.type !== 'cover' && p.type !== 'notes_summary');
      const noted = real.filter(p => localStorage.getItem('note:' + p.link));
      if (noted.length === 0) {
        showToastFromViewer('No notes to copy', 'error');
        return;
      }
      const lines = [];
      noted.forEach(p => {
        lines.push('## ' + p.title);
        const raw = localStorage.getItem('note:' + p.link) || '';
        lines.push(raw);
        lines.push('');
      });
      navigator.clipboard.writeText(lines.join('\n')).then(function () {
        showToastFromViewer('Notes copied to clipboard');
      }).catch(function () {
        showToastFromViewer('Copy failed', 'error');
      });
    };
  }

  // showToast is defined in app.js — call it if available, else console.log
  function showToastFromViewer(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
    else console.log(msg);
  }

  // ── Notes — save to localStorage + API on change ──
  const notesTextarea = document.getElementById('notes');

  let _notesSaveTimer = null;

  function saveNoteToApi(p, text) {
    if (!p || !p.id || !weekTag) return;
    fetch('/api/reports/' + encodeURIComponent(weekTag) + '/notes/' + p.id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(console.error);
  }

  function _notesInput() {
    const p = POSTS[current];
    if (!p || p.type === 'notes_summary' || p.type === 'cover') return;
    const text = notesTextarea.value;
    localStorage.setItem('note:' + p.link, text);

    clearTimeout(_notesSaveTimer);
    _notesSaveTimer = setTimeout(() => saveNoteToApi(p, text), 800);
  }

  function _notesBlur() {
    const p = POSTS[current];
    if (!p || p.type === 'notes_summary' || p.type === 'cover') return;
    clearTimeout(_notesSaveTimer);
    saveNoteToApi(p, notesTextarea.value);
  }

  // Auto bullet: Enter → "• " on next line
  function _notesKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const ta    = e.target;
      const start = ta.selectionStart;
      ta.value = ta.value.substring(0, start) + '\n• ' + ta.value.substring(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = start + 3;
      ta.dispatchEvent(new Event('input'));
    }
  }

  // Seed empty textarea with "• " on focus
  function _notesFocus(e) {
    if (!e.target.value.trim()) {
      e.target.value = '• ';
      e.target.selectionStart = e.target.selectionEnd = e.target.value.length;
    }
  }

  // Remove any listeners from a previous initDigestViewer call before re-adding
  if (window._notesHandlers) {
    notesTextarea.removeEventListener('input',   window._notesHandlers.input);
    notesTextarea.removeEventListener('blur',    window._notesHandlers.blur);
    notesTextarea.removeEventListener('keydown', window._notesHandlers.keydown);
    notesTextarea.removeEventListener('focus',   window._notesHandlers.focus);
  }
  window._notesHandlers = { input: _notesInput, blur: _notesBlur, keydown: _notesKeydown, focus: _notesFocus };
  notesTextarea.addEventListener('input',   _notesInput);
  notesTextarea.addEventListener('blur',    _notesBlur);
  notesTextarea.addEventListener('keydown', _notesKeydown);
  notesTextarea.addEventListener('focus',   _notesFocus);

  renderCard(0);
};
