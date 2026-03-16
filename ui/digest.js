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
  } else if (action.type === 'note_archive') {
    await fetch('/api/notes/' + action.artifactId + '/unarchive', { method: 'POST' });
    if (typeof window._refreshReviewCard === 'function')
      window._refreshReviewCard();
  } else if (action.type === 'todo_archive') {
    await fetch('/api/todos/' + action.artifactId + '/unarchive', { method: 'POST' });
    if (typeof window._refreshReviewCard === 'function')
      window._refreshReviewCard();
  } else if (action.type === 'notes_archive_all') {
    // Can't precisely undo bulk archive, but we can re-render
    // The user would need to unarchive individually from the archive page
    if (typeof window._refreshReviewCard === 'function')
      window._refreshReviewCard();
  } else if (action.type === 'todos_archive_all') {
    if (typeof window._refreshReviewCard === 'function')
      window._refreshReviewCard();
  }
}

// ── Main viewer init ──────────────────────────────────────────────────────────
window.initDigestViewer = function (data) {
  // data = { artifacts: [...], pending_notes: N, pending_todos: N }
  var ARTIFACTS = data.artifacts || [];
  var _pendingNotes = data.pending_notes || 0;
  var _pendingTodos = data.pending_todos || 0;
  var _hasReview = (_pendingNotes + _pendingTodos > 0) || ARTIFACTS.length > 0;

  // Build POSTS array: [cover?, ...artifacts, review?]
  var POSTS = [];
  if (ARTIFACTS.length > 0) {
    POSTS.push({ type: 'cover' });
    POSTS = POSTS.concat(ARTIFACTS);
  }
  if (_hasReview) {
    POSTS.push({ type: 'review' });
  }

  let current = 0;

  // ── Usage session tracking ─────────────────────
  var _sessionStartTime = Date.now();
  var _cardViewStart = Date.now();
  var _timePerSource = {};
  var _viewedIds = new Set();
  var _sessionPosted = false;

  function _flushCardTime() {
    var p = POSTS[current];
    if (!p || p.type === 'cover' || p.type === 'review') return;
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

  var REVIEW_PALETTE = ['#1a0e2e', '#2d1b4e', '#7c3aed'];

  function getPalette(post) {
    if (post.type === 'cover') return COVER_PALETTE;
    if (post.type === 'review') return REVIEW_PALETTE;
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

    // Cover tab — only if cover card exists
    var coverIdx = POSTS.findIndex(function (p) { return p.type === 'cover'; });
    if (coverIdx >= 0) {
      var coverBtn = makeTab('\u2605 Overview', 'tab-special');
      coverBtn.onclick = function () { navigateTo(coverIdx); };
      tabDefs.push({ start: coverIdx, end: coverIdx, el: coverBtn });
    }

    // Source tabs — real artifacts only
    var subStarts = {}, subPlatformMap = {};
    POSTS.forEach(function (p, i) {
      if (p.type === 'cover' || p.type === 'review') return;
      if (!(p.source_name in subStarts)) {
        subStarts[p.source_name]      = i;
        subPlatformMap[p.source_name] = p.platform || 'reddit';
      }
    });

    var subList = Object.keys(subStarts);
    subList.forEach(function (sub, si) {
      var start    = subStarts[sub];
      // end = next source start - 1, but skip review card
      var end;
      if (si + 1 < subList.length) {
        end = subStarts[subList[si + 1]] - 1;
      } else {
        // last source: end before review card if present
        var reviewIdx = POSTS.findIndex(function (p) { return p.type === 'review'; });
        end = reviewIdx >= 0 ? reviewIdx - 1 : POSTS.length - 1;
      }
      var platform = subPlatformMap[sub] || 'reddit';
      var count    = end - start + 1;
      var btn      = makeTab(platformPrefix(platform) + sub + ' (' + count + ')');
      btn.onclick  = function () { navigateTo(start); };
      tabDefs.push({ start, end, el: btn });
    });

    // Review tab — only if review card exists
    var reviewIdx = POSTS.findIndex(function (p) { return p.type === 'review'; });
    if (reviewIdx >= 0) {
      var reviewBtn = makeTab('\u2606 Review', 'tab-special');
      reviewBtn.onclick = function () { navigateTo(reviewIdx); };
      tabDefs.push({ start: reviewIdx, end: reviewIdx, el: reviewBtn });
    }
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
    var artifacts = POSTS.filter(function (p) {
      return p.type !== 'cover' && p.type !== 'review';
    });
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

    var reviewLine = '';
    if (_pendingNotes + _pendingTodos > 0) {
      var parts = [];
      if (_pendingNotes > 0) parts.push(_pendingNotes + ' note' + (_pendingNotes !== 1 ? 's' : ''));
      if (_pendingTodos > 0) parts.push(_pendingTodos + ' todo' + (_pendingTodos !== 1 ? 's' : ''));
      reviewLine = '<div class="cover-review-line">' + parts.join(' and ') + ' pending review</div>';
    }

    document.getElementById('card').innerHTML =
      '<div class="cover-card">' +
        '<div class="cover-count">' + count +
          ' artifact' + (count !== 1 ? 's' : '') + ' pending.' +
        '</div>' +
        '<div class="cover-readtime">Estimated reading time: ~' + readMins +
          ' minute' + (readMins !== 1 ? 's' : '') + '.</div>' +
        reviewLine +
        '<div class="cover-sources-label">Sources</div>' +
        '<div class="cover-sources">' + sourcesHtml + '</div>' +
        '<div class="cover-hint">Press <kbd>\u2192</kbd> or <kbd>l</kbd> to start reading</div>' +
      '</div>';
  }

  // ── Review card renderer ─────────────────────────
  async function renderReviewCard() {
    var cardEl = document.getElementById('card');
    cardEl.innerHTML = '<div class="review-card"><div class="review-loading">Loading pending review\u2026</div></div>';

    var reviewData;
    try {
      var res = await fetch('/api/pending-review');
      reviewData = await res.json();
    } catch (e) {
      cardEl.innerHTML = '<div class="review-card"><div class="review-empty">Failed to load review items.</div></div>';
      return;
    }

    var notes = reviewData.notes || [];
    var todos = reviewData.todos || [];

    if (notes.length === 0 && todos.length === 0) {
      cardEl.innerHTML = '<div class="review-card"><div class="review-empty">All notes and todos are archived!</div></div>';
      _checkTrulyEmpty();
      return;
    }

    var html = '<div class="review-card">';

    if (notes.length > 0) {
      html += '<div class="review-section" id="review-notes-section">' +
        '<div class="review-section-header">' +
          '<span class="review-section-title">Pending Notes (' + notes.length + ')</span>' +
          '<button class="review-archive-all" id="btn-archive-all-notes">Archive All Notes</button>' +
        '</div>';
      notes.forEach(function (n) {
        var preview = (n.note_text || '').replace(/^•\s*/gm, '').trim();
        var canArchive = n.artifact_status === 'archived';
        var btnAttr = canArchive
          ? 'class="review-archive-btn" data-type="note" data-id="' + n.artifact_id + '"'
          : 'class="review-archive-btn review-archive-btn--disabled" disabled title="Archive the artifact first"';
        html += '<div class="review-item review-note" data-artifact-id="' + n.artifact_id + '">' +
          '<div class="review-item-title">' +
            '<a href="' + escAttr(n.link || '#') + '" target="_blank" rel="noopener">' +
              (n.title || '[Post]') + '</a>' +
          '</div>' +
          '<div class="review-item-meta">' +
            '<span class="platform-badge pb-' + (n.platform || 'reddit') + '">' +
              (n.platform || 'reddit') + '</span> ' +
            '<span>' + escAttr(n.source_name || '') + '</span>' +
            (!canArchive ? '<span class="review-pending-badge">artifact pending</span>' : '') +
          '</div>' +
          '<div class="review-item-text">' + escAttr(preview) + '</div>' +
          '<button ' + btnAttr + '>Archive</button>' +
        '</div>';
      });
      html += '</div>';
    }

    if (todos.length > 0) {
      html += '<div class="review-section" id="review-todos-section">' +
        '<div class="review-section-header">' +
          '<span class="review-section-title">Pending Todos (' + todos.length + ')</span>' +
          '<button class="review-archive-all" id="btn-archive-all-todos">Archive All Todos</button>' +
        '</div>';
      todos.forEach(function (t) {
        var canArchive = t.artifact_status === 'archived';
        var btnAttr = canArchive
          ? 'class="review-archive-btn" data-type="todo" data-id="' + t.artifact_id + '"'
          : 'class="review-archive-btn review-archive-btn--disabled" disabled title="Archive the artifact first"';
        html += '<div class="review-item review-todo" data-artifact-id="' + t.artifact_id + '">' +
          '<div class="review-item-title">' +
            '<a href="' + escAttr(t.link || '#') + '" target="_blank" rel="noopener">' +
              (t.title || '[Post]') + '</a>' +
          '</div>' +
          '<div class="review-item-meta">' +
            '<span class="platform-badge pb-' + (t.platform || 'reddit') + '">' +
              (t.platform || 'reddit') + '</span> ' +
            '<span>' + escAttr(t.source_name || '') + '</span>' +
            (!canArchive ? '<span class="review-pending-badge">artifact pending</span>' : '') +
          '</div>' +
          '<div class="review-item-text">' + escAttr(t.todo_text || '') + '</div>' +
          '<button ' + btnAttr + '>Archive</button>' +
        '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    cardEl.innerHTML = html;

    // Bind per-item archive buttons
    cardEl.querySelectorAll('.review-archive-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var itemType = btn.dataset.type;
        var artifactId = parseInt(btn.dataset.id);
        var itemEl = btn.closest('.review-item');

        // Copy note/todo text to clipboard before archiving
        var dataArr = itemType === 'note' ? notes : todos;
        var item = dataArr.find(function (x) { return x.artifact_id === artifactId; });
        if (item) {
          var text = itemType === 'note' ? (item.note_text || '') : (item.todo_text || '');
          navigator.clipboard.writeText(text.trim()).catch(function () {});
        }

        _archiveReviewItem(itemType, artifactId, itemEl);
      });
    });

    // Bind "Archive All" buttons
    var archAllNotes = document.getElementById('btn-archive-all-notes');
    if (archAllNotes) {
      archAllNotes.addEventListener('click', async function () {
        // Copy all notes to clipboard before archiving
        if (notes.length > 0) {
          var lines = [];
          notes.forEach(function (n) {
            lines.push((n.note_text || '').trim());
          });
          navigator.clipboard.writeText(lines.join('\n')).catch(function () {});
        }
        await fetch('/api/notes/archive-all', { method: 'POST' });
        pushUndo({ type: 'notes_archive_all' });
        showToastFromViewer('All notes archived & copied to clipboard');
        renderReviewCard();
      });
    }
    var archAllTodos = document.getElementById('btn-archive-all-todos');
    if (archAllTodos) {
      archAllTodos.addEventListener('click', async function () {
        // Copy all todos to clipboard before archiving
        if (todos.length > 0) {
          var lines = [];
          todos.forEach(function (t) {
            lines.push((t.todo_text || '').trim());
          });
          navigator.clipboard.writeText(lines.join('\n')).catch(function () {});
        }
        await fetch('/api/todos/archive-all', { method: 'POST' });
        pushUndo({ type: 'todos_archive_all' });
        showToastFromViewer('All todos archived & copied to clipboard');
        renderReviewCard();
      });
    }
  }

  async function _archiveReviewItem(itemType, artifactId, itemEl) {
    var endpoint = itemType === 'note'
      ? '/api/notes/' + artifactId + '/archive'
      : '/api/todos/' + artifactId + '/archive';
    var res = await fetch(endpoint, { method: 'POST' });

    if (!res.ok) {
      showToastFromViewer('Archive the artifact first', 'error');
      return;
    }

    pushUndo({
      type: itemType === 'note' ? 'note_archive' : 'todo_archive',
      artifactId: artifactId,
    });

    // Fade out animation then re-render
    if (itemEl) {
      itemEl.classList.add('fade-out');
      setTimeout(function () {
        renderReviewCard();
      }, 350);
    } else {
      renderReviewCard();
    }
  }

  function _checkTrulyEmpty() {
    // Check if there are any real artifacts left in POSTS
    var hasArtifacts = POSTS.some(function (p) {
      return p.type !== 'cover' && p.type !== 'review';
    });
    if (!hasArtifacts) {
      // Remove review card from POSTS
      var reviewIdx = POSTS.findIndex(function (p) { return p.type === 'review'; });
      if (reviewIdx >= 0) POSTS.splice(reviewIdx, 1);
      // Remove cover if present
      var coverIdx = POSTS.findIndex(function (p) { return p.type === 'cover'; });
      if (coverIdx >= 0) POSTS.splice(coverIdx, 1);
      showEmpty();
      showToastFromViewer('You are free!');
    }
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

    // Count real artifacts (exclude cover + review)
    var artifactCount = POSTS.filter(function (p) {
      return p.type !== 'cover' && p.type !== 'review';
    }).length;

    if (p.type === 'cover') {
      document.getElementById('topbar-progress').textContent =
        artifactCount + ' pending';
      document.getElementById('topbar').style.setProperty('--progress', '0%');
    } else if (p.type === 'review') {
      document.getElementById('topbar-progress').textContent = 'Review';
      document.getElementById('topbar').style.setProperty('--progress', '100%');
    } else {
      // Find artifact position among real artifacts
      var realIndex = 0;
      for (var ri = 0; ri < index; ri++) {
        if (POSTS[ri].type !== 'cover' && POSTS[ri].type !== 'review') realIndex++;
      }
      document.getElementById('topbar-progress').textContent =
        (realIndex + 1) + ' / ' + artifactCount;
      document.getElementById('topbar').style.setProperty(
        '--progress', ((realIndex + 1) / artifactCount * 100) + '%');
    }

    updateBg(getPalette(p));

    if (p.type === 'cover') {
      sidebarEl.classList.add('sidebar-hidden');
      commentsEl.innerHTML = '';
      commentsEl.style.display = 'none';
      renderCoverCard();
      cardScrollEl.scrollTop = 0;
      return;
    }

    if (p.type === 'review') {
      sidebarEl.classList.add('sidebar-hidden');
      commentsEl.innerHTML = '';
      commentsEl.style.display = 'none';
      renderReviewCard();
      cardScrollEl.scrollTop = 0;
      return;
    }

    // ── Regular artifact card ─────────────────────
    sidebarEl.classList.remove('sidebar-hidden');

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
    // Non-text posts (image, gallery, video, link) can also carry body text
    if (p.type !== 'text' && p.content && p.content.text) {
      contentHtml += '<div class="selftext">' + marked.parse(p.content.text) + '</div>';
    }

    const sc = scoreClass(p.score);
    document.getElementById('card').innerHTML =
      '<div class="card-title">' +
        '<a href="' + escAttr(p.link) + '" target="_blank" rel="noopener">' +
          (p.title || '[Post]') + '</a>' +
        '<span class="score ' + sc + '">' + p.score.toLocaleString() + '</span>' +
        platformBadge(p.platform) +
      '</div>' + contentHtml;

    if (p.content && p.content.text && typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
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

    // On review card: Enter is a no-op (use buttons instead)
    if (POSTS[current].type === 'review') {
      return;
    }

    var p            = POSTS[current];
    var removedIndex = current;

    await fetch('/api/artifacts/' + p.id + '/archive', { method: 'POST' });
    pushUndo({ type: 'archive', artifactId: p.id, artifactData: p, index: removedIndex });

    POSTS.splice(current, 1);

    // Count remaining real artifacts
    var realCount = POSTS.filter(function (x) {
      return x.type !== 'cover' && x.type !== 'review';
    }).length;

    if (realCount === 0) {
      // Remove cover card if present
      var coverIdx = POSTS.findIndex(function (x) { return x.type === 'cover'; });
      if (coverIdx >= 0) POSTS.splice(coverIdx, 1);

      // Check if there's a review card to show
      var reviewIdx = POSTS.findIndex(function (x) { return x.type === 'review'; });
      if (reviewIdx >= 0) {
        rebuildTabs();
        renderCard(reviewIdx);
        showToastFromViewer('All artifacts archived');
        return;
      }

      // Truly empty
      showEmpty();
      showToastFromViewer('All artifacts archived');
      return;
    }

    rebuildTabs();
    if (current >= POSTS.length) current = POSTS.length - 1;
    // Skip landing on review card after archive
    if (POSTS[current] && POSTS[current].type === 'review') {
      current = Math.max(0, current - 1);
    }
    const cardEl = document.getElementById('card');
    cardEl.classList.remove('anim-fwd', 'anim-bwd');
    void cardEl.offsetWidth;
    cardEl.classList.add('anim-fwd');
    renderCard(current);
  }

  // ── Re-insert for undo ────────────────────────────
  window._reinsertArtifact = function (data, originalIndex) {
    // If cover was removed, restore it first
    var hasCover = POSTS.some(function (p) { return p.type === 'cover'; });
    if (!hasCover) {
      POSTS.unshift({ type: 'cover' });
    }

    // Insert before the review card but after other artifacts
    var reviewIdx = POSTS.findIndex(function (p) { return p.type === 'review'; });
    var maxInsert = reviewIdx >= 0 ? reviewIdx : POSTS.length;
    var idx = Math.min(Math.max(originalIndex, 1), maxInsert);
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

  window._refreshReviewCard = function () {
    // Re-add review card if it was removed
    var reviewIdx = POSTS.findIndex(function (p) { return p.type === 'review'; });
    if (reviewIdx < 0) {
      POSTS.push({ type: 'review' });
      document.getElementById('viewer-app').style.display = '';
      document.getElementById('home-empty').style.display = 'none';
      rebuildTabs();
    }
    // If currently viewing the review card, re-render it
    if (POSTS[current] && POSTS[current].type === 'review') {
      renderReviewCard();
    }
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
      if (notesEl && !sidebarEl.classList.contains('sidebar-hidden')) {
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
      if (todosEl && !sidebarEl.classList.contains('sidebar-hidden')) {
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
      const noted = POSTS.filter(p => p.type !== 'cover' && p.type !== 'review' && p.note && p.note.trim());
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
    if (!p || p.type === 'cover' || p.type === 'review') return;
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
    if (!p || p.type === 'cover' || p.type === 'review') return;
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
    if (!p || p.type === 'cover' || p.type === 'review') return;
    clearTimeout(_notesSaveTimer);
    saveNoteToApi(p, notesTextarea.value);
  }

  function _todosBlur() {
    var p = POSTS[current];
    if (!p || p.type === 'cover' || p.type === 'review') return;
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

  renderCard(0); // start at cover (or review if no artifacts)
};
