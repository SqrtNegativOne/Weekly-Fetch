/**
 * digest.js — flashcard viewer for pending artifacts.
 *
 * Called by app.js with a flat array of pending artifacts.
 * The viewer is inline in #view-home (not an overlay).
 *
 * Card 0 is always a synthetic cover card (count, reading time, sources).
 * Artifact cards start at index 1.
 *
 * Keyboard shortcuts:
 *   h / ←        previous card
 *   l / →        next card
 *   j / ↓        scroll down
 *   k / ↑        scroll up
 *   c            toggle comments
 *   Ctrl+N       focus notes sidebar (again or Esc to exit)
 *   Ctrl+T       focus todos sidebar (again or Esc to exit)
 *   Enter        archive current & next (skips cover)
 *   Ctrl+Z       undo last action
 */

// ── Undo stack (session-scoped, in-memory) ────────────────────────────────────
var undoStack = [];

function pushUndo(action) { undoStack.push(action); }

async function popUndo() {
  if (undoStack.length === 0) return false;
  var action = undoStack.pop();
  if (action.type === 'compound') {
    for (var i = action.actions.length - 1; i >= 0; i--)
      await reverseAction(action.actions[i]);
  } else {
    await reverseAction(action);
  }
  return true;
}

async function reverseAction(action) {
  if (action.type === 'archive') {
    await fetch('/api/artifacts/' + action.artifactId + '/unarchive', { method: 'POST' });
    if (typeof window._reinsertArtifact === 'function')
      window._reinsertArtifact(action.artifactData, action.index);
  } else if (action.type === 'note_edit') {
    await fetch('/api/artifacts/' + action.artifactId + '/note', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: action.previousText }),
    });
    if (typeof window._restoreNoteText === 'function')
      window._restoreNoteText(action.artifactId, action.previousText);
  } else if (action.type === 'todo_edit') {
    await fetch('/api/artifacts/' + action.artifactId + '/todo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: action.previousText }),
    });
    if (typeof window._restoreTodoText === 'function')
      window._restoreTodoText(action.artifactId, action.previousText);
  }
}

// ── Main viewer init ──────────────────────────────────────────────────────────
window.initDigestViewer = function (ARTIFACTS) {
  // POSTS[0] = synthetic cover card; POSTS[1..] = real artifacts
  var POSTS = [{ type: 'cover' }].concat(ARTIFACTS);

  let current = 0;

  // ── Usage session tracking ─────────────────────
  var _sessionStartTime = Date.now();
  var _cardViewStart = Date.now();
  var _timePerSource = {};
  var _viewedIds = new Set();
  var _sessionPosted = false;

  function _flushCardTime() {
    var p = POSTS[current];
    if (!p || p.type === 'cover') return;
    var key = (p.platform || 'unknown') + '/' + (p.source_name || 'unknown');
    var elapsed = Math.round((Date.now() - _cardViewStart) / 1000);
    _timePerSource[key] = (_timePerSource[key] || 0) + elapsed;
    _cardViewStart = Date.now();
  }

  function _postUsageSession() {
    if (_sessionPosted) return;
    _flushCardTime();
    var durationSec = Math.round((Date.now() - _sessionStartTime) / 1000);
    if (durationSec < 5) return; // skip trivial sessions
    _sessionPosted = true;
    var payload = JSON.stringify({
      started_at: new Date(_sessionStartTime).toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: durationSec,
      artifacts_viewed: _viewedIds.size,
      time_per_source: _timePerSource,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/usage/session', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/usage/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: payload, keepalive: true,
      }).catch(function () {});
    }
  }

  window._postUsageSession = _postUsageSession;
  window.addEventListener('beforeunload', _postUsageSession);

  // ── 20-20-20 Eye break overlay ─────────────────
  var _eyeBreakActive = false;
  var _eyeBreakOverlay = document.getElementById('eye-break-overlay');
  if (!_eyeBreakOverlay) {
    _eyeBreakOverlay = document.createElement('div');
    _eyeBreakOverlay.id = 'eye-break-overlay';
    _eyeBreakOverlay.innerHTML =
      '<div class="eye-break-card">' +
        '<div class="eye-break-title">20 · 20 · 20</div>' +
        '<div class="eye-break-subtitle">Look 20 feet away for 20 seconds.</div>' +
        '<div class="eye-break-timer">20</div>' +
        '<div class="eye-break-breath"><em>Take a deep breath.</em></div>' +
      '</div>';
    _eyeBreakOverlay.style.display = 'none';
    var viewerApp = document.getElementById('viewer-app');
    if (viewerApp) viewerApp.appendChild(_eyeBreakOverlay);
  }

  function _shouldShowEyeBreak() {
    return (Date.now() - _sessionStartTime) >= 20 * 60 * 1000;
  }

  function _showEyeBreak(callback) {
    _eyeBreakActive = true;
    _eyeBreakOverlay.style.display = '';
    var remaining = 20;
    var timerEl = _eyeBreakOverlay.querySelector('.eye-break-timer');
    timerEl.textContent = remaining;

    var iv = setInterval(function () {
      remaining--;
      timerEl.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(iv);
        _eyeBreakOverlay.style.display = 'none';
        _eyeBreakActive = false;
        _sessionStartTime = Date.now();
        if (callback) callback();
      }
    }, 1000);
  }

  // ── Source colour palettes ──────────────────────────
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
  const COVER_PALETTE = ['#2a1508', '#4a2010', '#c8703a'];

  const subPaletteMap = {};
  let nextPaletteIdx = 0;

  function getPalette(post) {
    if (post.type === 'cover') return COVER_PALETTE;
    if (!(post.source_name in subPaletteMap))
      subPaletteMap[post.source_name] = nextPaletteIdx++ % PALETTES.length;
    return PALETTES[subPaletteMap[post.source_name]];
  }

  const BLOB_IDS = ['blob1', 'blob2', 'blob3'];
  function updateBg(palette) {
    BLOB_IDS.forEach((id, i) => {
      var el = document.getElementById(id);
      if (el) el.style.backgroundColor = palette[i];
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
    const labels = { bluesky: 'bsky', tumblr: 'tumblr', instagram: 'ig',
                     mastodon: 'masto', twitter: 'twitter' };
    return '<span class="platform-badge pb-' + platform + '">' +
           (labels[platform] || platform) + '</span>';
  }

  // ── Tab bar ───────────────────────────────────────
  const tabDefs = [];
  const tabsEl  = document.getElementById('tabs');

  function makeTab(label, extraClass) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    tabsEl.appendChild(btn);
    return btn;
  }

  function rebuildTabs() {
    tabsEl.innerHTML = '';
    tabDefs.length = 0;

    // Cover tab — always index 0
    var coverBtn = makeTab('\u2605 Overview', 'tab-special');
    coverBtn.onclick = function () { navigateTo(0); };
    tabDefs.push({ start: 0, end: 0, el: coverBtn });

    // Source tabs — artifacts start at index 1
    var subStarts = {}, subPlatformMap = {};
    POSTS.slice(1).forEach(function (p, i) {
      var realIdx = i + 1;
      if (!(p.source_name in subStarts)) {
        subStarts[p.source_name]      = realIdx;
        subPlatformMap[p.source_name] = p.platform || 'reddit';
      }
    });

    var subList = Object.keys(subStarts);
    subList.forEach(function (sub, si) {
      var start    = subStarts[sub];
      var end      = si + 1 < subList.length
        ? subStarts[subList[si + 1]] - 1
        : POSTS.length - 1;
      var platform = subPlatformMap[sub] || 'reddit';
      var count    = end - start + 1;
      var btn      = makeTab(platformPrefix(platform) + sub + ' (' + count + ')');
      btn.onclick  = function () { navigateTo(start); };
      tabDefs.push({ start, end, el: btn });
    });
  }

  rebuildTabs();

  // ── Helpers ───────────────────────────────────────
  function escAttr(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function decodeHtml(s) {
    const t = document.createElement('textarea');
    t.innerHTML = s; return t.value;
  }
  function scoreClass(n) {
    return n >= 2000 ? 'score-high' : n >= 500 ? 'score-mid' : 'score-low';
  }
  function bulletizeNote(text) {
    if (!text.trim()) return '';
    return text.split('\n').map(function (line) {
      if (!line.trim()) return '';
      if (line.trimStart().startsWith('• ')) return line;
      return '• ' + line;
    }).filter(Boolean).join('\n');
  }

  // ── Cover card renderer ───────────────────────────
  function renderCoverCard() {
    var artifacts = POSTS.slice(1);
    var count     = artifacts.length;

    var words = artifacts.reduce(function (acc, p) {
      var w = p.title ? p.title.split(/\s+/).length : 0;
      if (p.content && p.content.text) w += p.content.text.split(/\s+/).length;
      return acc + w;
    }, 0);
    var readMins = Math.max(1, Math.ceil(words / 200));

    // Count artifacts per source
    var sourceCounts = {}, sourcePlatforms = {};
    artifacts.forEach(function (p) {
      if (!sourceCounts[p.source_name]) {
        sourceCounts[p.source_name]   = 0;
        sourcePlatforms[p.source_name] = p.platform || 'reddit';
      }
      sourceCounts[p.source_name]++;
    });

    var sourcesHtml = Object.keys(sourceCounts).map(function (name) {
      var platform = sourcePlatforms[name];
      return '<div class="cover-source-row">' +
        '<span class="platform-badge pb-' + platform + '">' + escAttr(platform) + '</span>' +
        '<span class="cover-source-name">' + platformPrefix(platform) + escAttr(name) + '</span>' +
        '<span class="cover-source-count">' + sourceCounts[name] + '</span>' +
      '</div>';
    }).join('');

    document.getElementById('card').innerHTML =
      '<div class="cover-card">' +
        '<div class="cover-count">' + count +
          ' artifact' + (count !== 1 ? 's' : '') + ' pending.' +
        '</div>' +
        '<div class="cover-readtime">Estimated reading time: ~' + readMins +
          ' minute' + (readMins !== 1 ? 's' : '') + '.</div>' +
        '<div class="cover-sources-label">Sources</div>' +
        '<div class="cover-sources">' + sourcesHtml + '</div>' +
        '<div class="cover-hint">Press <kbd>\u2192</kbd> or <kbd>l</kbd> to start reading</div>' +
      '</div>';
  }

  // ── Comment thread renderer ───────────────────────
  function renderComments(comments) {
    if (!comments || comments.length === 0) return '';
    function renderThread(list) {
      return list.map(c => {
        var body    = marked.parse(c.body || '');
        var replies = c.replies && c.replies.length > 0
          ? '<div class="comment-replies">' + renderThread(c.replies) + '</div>' : '';
        return '<div class="comment">' +
          '<div class="comment-meta">' + escAttr(c.author) + ' &nbsp;&middot;&nbsp; ' +
            Number(c.score).toLocaleString() + ' pts</div>' +
          '<div class="comment-body">' + body + '</div>' + replies + '</div>';
      }).join('');
    }
    return '<div class="comments-section">' + renderThread(comments) + '</div>';
  }

  // ── Main render ───────────────────────────────────
  const sidebarEl    = document.getElementById('sidebar');
  const cardScrollEl = document.getElementById('card-scroll');
  const commentsEl   = document.getElementById('card-comments');

  function renderCard(index) {
    _flushCardTime();
    _cardViewStart = Date.now();

    const p = POSTS[index];
    current = index;

    if (p && p.id) _viewedIds.add(p.id);

    tabDefs.forEach(({ start, end, el }) => {
      el.classList.toggle('active', index >= start && index <= end);
    });

    var artifactCount = POSTS.length - 1; // exclude cover
    if (p.type === 'cover') {
      document.getElementById('topbar-progress').textContent =
        artifactCount + ' pending';
      document.getElementById('topbar').style.setProperty('--progress', '0%');
    } else {
      var artifactIndex = index; // 1-based among artifacts
      document.getElementById('topbar-progress').textContent =
        artifactIndex + ' / ' + artifactCount;
      document.getElementById('topbar').style.setProperty(
        '--progress', (artifactIndex / artifactCount * 100) + '%');
    }

    updateBg(getPalette(p));

    if (p.type === 'cover') {
      sidebarEl.style.display = 'none';
      commentsEl.innerHTML = '';
      commentsEl.style.display = 'none';
      renderCoverCard();
      cardScrollEl.scrollTop = 0;
      return;
    }

    // ── Regular artifact card ─────────────────────
    sidebarEl.style.display = '';

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
      contentHtml = '<div class="ext-link"><a href="' + escAttr(p.content.url) +
        '" target="_blank" rel="noopener">' + escAttr(domain) + '</a></div>';
    }

    const sc = scoreClass(p.score);
    document.getElementById('card').innerHTML =
      '<div class="card-title">' +
        '<a href="' + escAttr(p.link) + '" target="_blank" rel="noopener">' +
          (p.title || '[Post]') + '</a>' +
        '<span class="score ' + sc + '">' + p.score.toLocaleString() + '</span>' +
        platformBadge(p.platform) +
      '</div>' + contentHtml;

    if (p.type === 'text' && typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
      MathJax.typesetPromise([document.getElementById('card')]).catch(console.error);
    }

    var commentsHtml = renderComments(p.comments);
    if (commentsHtml) {
      commentsEl.innerHTML =
        '<button class="comments-toggle" ' +
            'onclick="this.parentElement.classList.toggle(\'comments-open\')">' +
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

    document.getElementById('notes').value     = bulletizeNote(p.note || '');
    document.getElementById('todos').value     = p.todo || '';
    document.getElementById('notes-post-title').textContent = decodeHtml(p.title || '');

    cardScrollEl.scrollTop = 0;
  }

  // ── Show empty state ──────────────────────────────
  function showEmpty() {
    document.getElementById('viewer-app').style.display = 'none';
    document.getElementById('home-empty').style.display = 'flex';
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

  // ── Archive current artifact ──────────────────────
  async function archiveCurrent() {
    // On cover card: Enter starts reading instead of archiving
    if (POSTS[current].type === 'cover') {
      navigateTo(1);
      return;
    }

    var p            = POSTS[current];
    var removedIndex = current;

    await fetch('/api/artifacts/' + p.id + '/archive', { method: 'POST' });
    pushUndo({ type: 'archive', artifactId: p.id, artifactData: p, index: removedIndex });

    POSTS.splice(current, 1);

    // Only cover card left — all done
    if (POSTS.length <= 1) {
      POSTS.splice(0, 1); // remove cover too
      rebuildTabs();
      showEmpty();
      showToastFromViewer('All artifacts archived');
      return;
    }

    rebuildTabs();
    if (current >= POSTS.length) current = POSTS.length - 1;
    const cardEl = document.getElementById('card');
    cardEl.classList.remove('anim-fwd', 'anim-bwd');
    void cardEl.offsetWidth; // force reflow so the class removal is committed
    cardEl.classList.add('anim-fwd');
    renderCard(current);
  }

  // ── Re-insert for undo ────────────────────────────
  window._reinsertArtifact = function (data, originalIndex) {
    // If cover was removed, restore it first
    if (POSTS.length === 0) POSTS.push({ type: 'cover' });

    var idx = Math.min(Math.max(originalIndex, 1), POSTS.length);
    POSTS.splice(idx, 0, data);

    document.getElementById('viewer-app').style.display = '';
    document.getElementById('home-empty').style.display = 'none';
    rebuildTabs();
    renderCard(idx);
    showToastFromViewer('Artifact restored');
  };

  window._restoreNoteText = function (artifactId, text) {
    var p = POSTS.find(x => x.id === artifactId);
    if (p) p.note = text;
    if (POSTS[current] && POSTS[current].id === artifactId)
      document.getElementById('notes').value = bulletizeNote(text);
  };

  window._restoreTodoText = function (artifactId, text) {
    var p = POSTS.find(x => x.id === artifactId);
    if (p) p.todo = text;
    if (POSTS[current] && POSTS[current].id === artifactId)
      document.getElementById('todos').value = text;
  };

  // ── Smooth scroll ─────────────────────────────────
  let _scrollTarget = 0, _scrollRaf = null;
  function _smoothScroll(delta) {
    _scrollTarget += delta;
    if (_scrollRaf) return;
    _scrollRaf = requestAnimationFrame(function step() {
      const s = _scrollTarget * 0.25;
      if (Math.abs(s) < 1) {
        cardScrollEl.scrollTop += _scrollTarget;
        _scrollTarget = 0; _scrollRaf = null; return;
      }
      cardScrollEl.scrollTop += s;
      _scrollTarget -= s;
      _scrollRaf = requestAnimationFrame(step);
    });
  }

  // ── Keyboard shortcuts ────────────────────────────
  function _onKeyDown(e) {
    var viewHome = document.getElementById('view-home');
    if (!viewHome || !viewHome.classList.contains('active')) return;

    if (_eyeBreakActive) { e.preventDefault(); return; }

    var inText = e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT';

    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      popUndo().then(function (undone) {
        if (!undone) showToastFromViewer('Nothing to undo', 'error');
      });
      return;
    }

    if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      const notesEl = document.getElementById('notes');
      if (notesEl && sidebarEl.style.display !== 'none') {
        if (document.activeElement === notesEl) {
          notesEl.blur();
          document.getElementById('card-scroll').focus();
        } else {
          notesEl.focus();
          notesEl.selectionStart = notesEl.selectionEnd = notesEl.value.length;
        }
      }
      return;
    }

    if (e.ctrlKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      const todosEl = document.getElementById('todos');
      if (todosEl && sidebarEl.style.display !== 'none') {
        if (document.activeElement === todosEl) {
          todosEl.blur();
          document.getElementById('card-scroll').focus();
        } else {
          todosEl.focus();
          todosEl.selectionStart = todosEl.selectionEnd = todosEl.value.length;
        }
      }
      return;
    }

    if (inText) return;

    if (e.key === 'ArrowLeft'  || e.key === 'h') { e.preventDefault(); navigate(-1); return; }
    if (e.key === 'ArrowRight' || e.key === 'l') {
      e.preventDefault();
      if (_shouldShowEyeBreak()) { _showEyeBreak(function () { navigate(1); }); }
      else { navigate(1); }
      return;
    }
    if (e.key === 'j' || e.key === 'ArrowDown')  { e.preventDefault(); _smoothScroll(200); return; }
    if (e.key === 'k' || e.key === 'ArrowUp')    { e.preventDefault(); _smoothScroll(-200); return; }

    if (e.key === 'c') {
      if (commentsEl && commentsEl.style.display !== 'none')
        commentsEl.classList.toggle('comments-open');
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (POSTS[current] && POSTS[current].type !== 'cover' && _shouldShowEyeBreak()) {
        _showEyeBreak(function () { archiveCurrent(); });
      } else {
        archiveCurrent();
      }
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
      const noted = POSTS.slice(1).filter(p => p.note && p.note.trim());
      if (noted.length === 0) { showToastFromViewer('No notes to copy', 'error'); return; }
      const lines = [];
      noted.forEach(p => {
        lines.push('## ' + (p.title || '[Post]'));
        lines.push(p.note);
        lines.push('');
      });
      navigator.clipboard.writeText(lines.join('\n'))
        .then(() => showToastFromViewer('Notes copied to clipboard'))
        .catch(() => showToastFromViewer('Copy failed', 'error'));
    };
  }

  function showToastFromViewer(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
    else console.log(msg);
  }

  // ── Notes / Todos ─────────────────────────────────
  const notesTextarea = document.getElementById('notes');
  const todosTextarea = document.getElementById('todos');

  let _notesSaveTimer = null, _todosSaveTimer = null;

  function saveNoteToApi(p, text) {
    if (!p || !p.id) return;
    fetch('/api/artifacts/' + p.id + '/note', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(console.error);
  }

  function saveTodoToApi(p, text) {
    if (!p || !p.id) return;
    fetch('/api/artifacts/' + p.id + '/todo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(console.error);
  }

  function pushTextUndo(type, artifactId, previousText) {
    var top = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
    if (top && top.type === type && top.artifactId === artifactId) return; // coalesce
    pushUndo({ type, artifactId, previousText });
  }

  function _notesInput() {
    var p = POSTS[current];
    if (!p || p.type === 'cover') return;
    var prevText = p.note || '';
    p.note = notesTextarea.value;
    pushTextUndo('note_edit', p.id, prevText);
    clearTimeout(_notesSaveTimer);
    _notesSaveTimer = setTimeout(function () {
      saveNoteToApi(p, notesTextarea.value);
      if (notesTextarea.value.trim() && p._status !== 'auto_archived') {
        p._status = 'auto_archived';
        fetch('/api/artifacts/' + p.id + '/archive', { method: 'POST' }).catch(console.error);
      }
    }, 800);
  }

  function _todosInput() {
    var p = POSTS[current];
    if (!p || p.type === 'cover') return;
    var prevText = p.todo || '';
    p.todo = todosTextarea.value;
    pushTextUndo('todo_edit', p.id, prevText);
    clearTimeout(_todosSaveTimer);
    _todosSaveTimer = setTimeout(function () {
      saveTodoToApi(p, todosTextarea.value);
      if (todosTextarea.value.trim() && p._status !== 'auto_archived') {
        p._status = 'auto_archived';
        fetch('/api/artifacts/' + p.id + '/archive', { method: 'POST' }).catch(console.error);
      }
    }, 800);
  }

  function _notesBlur() {
    var p = POSTS[current];
    if (!p || p.type === 'cover') return;
    clearTimeout(_notesSaveTimer);
    saveNoteToApi(p, notesTextarea.value);
  }

  function _todosBlur() {
    var p = POSTS[current];
    if (!p || p.type === 'cover') return;
    clearTimeout(_todosSaveTimer);
    saveTodoToApi(p, todosTextarea.value);
  }

  function _notesKeydown(e) {
    if (e.key === 'Escape' || (e.ctrlKey && (e.key === 'n' || e.key === 'N'))) {
      e.preventDefault(); e.stopPropagation();
      e.target.blur();
      document.getElementById('card-scroll').focus();
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault(); e.stopPropagation();
      var ta = e.target, start = ta.selectionStart;
      ta.value = ta.value.substring(0, start) + '\n• ' + ta.value.substring(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = start + 3;
      ta.dispatchEvent(new Event('input'));
    }
  }

  function _todosKeydown(e) {
    if (e.key === 'Escape' || (e.ctrlKey && (e.key === 't' || e.key === 'T'))) {
      e.preventDefault(); e.stopPropagation();
      e.target.blur();
      document.getElementById('card-scroll').focus();
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey) e.stopPropagation();
  }

  function _notesFocus(e) {
    if (!e.target.value.trim()) {
      e.target.value = '• ';
      e.target.selectionStart = e.target.selectionEnd = e.target.value.length;
    }
  }

  if (window._notesHandlers) {
    notesTextarea.removeEventListener('input',   window._notesHandlers.notesInput);
    notesTextarea.removeEventListener('blur',    window._notesHandlers.notesBlur);
    notesTextarea.removeEventListener('keydown', window._notesHandlers.notesKeydown);
    notesTextarea.removeEventListener('focus',   window._notesHandlers.notesFocus);
    todosTextarea.removeEventListener('input',   window._notesHandlers.todosInput);
    todosTextarea.removeEventListener('blur',    window._notesHandlers.todosBlur);
    todosTextarea.removeEventListener('keydown', window._notesHandlers.todosKeydown);
  }
  window._notesHandlers = {
    notesInput: _notesInput, notesBlur: _notesBlur,
    notesKeydown: _notesKeydown, notesFocus: _notesFocus,
    todosInput: _todosInput, todosBlur: _todosBlur, todosKeydown: _todosKeydown,
  };
  notesTextarea.addEventListener('input',   _notesInput);
  notesTextarea.addEventListener('blur',    _notesBlur);
  notesTextarea.addEventListener('keydown', _notesKeydown);
  notesTextarea.addEventListener('focus',   _notesFocus);
  todosTextarea.addEventListener('input',   _todosInput);
  todosTextarea.addEventListener('blur',    _todosBlur);
  todosTextarea.addEventListener('keydown', _todosKeydown);

  renderCard(0); // always start at cover
};
