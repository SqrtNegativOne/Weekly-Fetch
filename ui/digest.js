/**
 * digest.js — flashcard viewer for pending artifacts.
 *
 * Called by app.js with a flat array of pending artifacts.
 * The viewer is inline in #view-home (not an overlay).
 *
 * Keyboard shortcuts (active when viewer is showing):
 *   h / ←        previous card
 *   l / →        next card
 *   j / ↓        scroll card down
 *   k / ↑        scroll card up
 *   c            toggle comments section
 *   Ctrl+N       focus notes sidebar
 *   Enter        archive current & move to next
 *   Ctrl+Z       undo last action
 */

// ── Undo stack (session-scoped, in-memory) ────────────────────────────────────
var undoStack = [];

function pushUndo(action) {
  undoStack.push(action);
}

async function popUndo() {
  if (undoStack.length === 0) return false;
  var action = undoStack.pop();

  if (action.type === 'compound') {
    // Reverse sub-actions in reverse order
    for (var i = action.actions.length - 1; i >= 0; i--) {
      await reverseAction(action.actions[i]);
    }
  } else {
    await reverseAction(action);
  }
  return true;
}

async function reverseAction(action) {
  if (action.type === 'archive') {
    // Unarchive via API
    await fetch('/api/artifacts/' + action.artifactId + '/unarchive', { method: 'POST' });
    // Re-insert into viewer
    if (typeof window._reinsertArtifact === 'function') {
      window._reinsertArtifact(action.artifactData, action.index);
    }
  } else if (action.type === 'note_edit') {
    await fetch('/api/artifacts/' + action.artifactId + '/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: action.previousText }),
    });
    if (typeof window._restoreNoteText === 'function') {
      window._restoreNoteText(action.artifactId, action.previousText);
    }
  } else if (action.type === 'todo_edit') {
    await fetch('/api/artifacts/' + action.artifactId + '/todo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: action.previousText }),
    });
    if (typeof window._restoreTodoText === 'function') {
      window._restoreTodoText(action.artifactId, action.previousText);
    }
  }
}

// ── Main viewer init ──────────────────────────────────────────────────────────
window.initDigestViewer = function (POSTS) {
  let current = 0;

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

  const subPaletteMap = {};
  let nextPaletteIdx  = 0;

  function getPalette(post) {
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
    const labels = { bluesky: 'bsky', tumblr: 'tumblr', instagram: 'ig', mastodon: 'masto', twitter: 'twitter' };
    const label  = labels[platform] || platform;
    return '<span class="platform-badge pb-' + platform + '">' + label + '</span>';
  }

  // ── Build source start-index map ──────────────────
  const subStarts      = {};
  const subPlatformMap = {};
  POSTS.forEach((p, i) => {
    if (!(p.source_name in subStarts)) {
      subStarts[p.source_name]      = i;
      subPlatformMap[p.source_name] = p.platform || 'reddit';
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

  function rebuildTabs() {
    tabsEl.innerHTML = '';
    tabDefs.length = 0;

    // Rebuild source start indices
    var newSubStarts = {};
    var newSubPlatformMap = {};
    POSTS.forEach((p, i) => {
      if (!(p.source_name in newSubStarts)) {
        newSubStarts[p.source_name] = i;
        newSubPlatformMap[p.source_name] = p.platform || 'reddit';
      }
    });

    var subList = Object.keys(newSubStarts);
    subList.forEach((sub, si) => {
      var start    = newSubStarts[sub];
      var end      = si + 1 < subList.length
        ? newSubStarts[subList[si + 1]] - 1
        : POSTS.length - 1;
      var platform = newSubPlatformMap[sub] || 'reddit';
      var count    = end - start + 1;
      var btn      = makeTab(platformPrefix(platform) + sub + ' (' + count + ')');
      btn.onclick  = () => navigateTo(start);
      tabDefs.push({ start, end, el: btn });
    });
  }

  rebuildTabs();

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
  const sidebarEl    = document.getElementById('sidebar');
  const cardScrollEl = document.getElementById('card-scroll');

  function renderCard(index) {
    if (POSTS.length === 0) {
      showEmpty();
      return;
    }
    if (index < 0) index = 0;
    if (index >= POSTS.length) index = POSTS.length - 1;

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

    sidebarEl.style.display = '';

    const commentsEl = document.getElementById('card-comments');

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
        '<a href="' + escAttr(p.link) + '" target="_blank" rel="noopener">' + (p.title || '[Post]') + '</a>' +
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

    // Populate notes + todos sidebar
    const notesEl     = document.getElementById('notes');
    const todosEl     = document.getElementById('todos');
    const notesTitEl  = document.getElementById('notes-post-title');
    notesEl.value     = bulletizeNote(p.note || '');
    todosEl.value     = p.todo || '';
    notesTitEl.textContent = decodeHtml(p.title || '');

    cardScrollEl.scrollTop = 0;
  }

  // ── Show empty state ──────────────────────────────
  function showEmpty() {
    document.getElementById('viewer-container').style.display = 'none';
    document.getElementById('home-empty').style.display = 'flex';
  }

  // ── Navigation ────────────────────────────────────
  function navigateTo(index) {
    if (POSTS.length === 0) { showEmpty(); return; }
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
    if (POSTS.length === 0) return;
    var p = POSTS[current];
    var removedIndex = current;

    // Archive via API
    await fetch('/api/artifacts/' + p.id + '/archive', { method: 'POST' });

    // Push undo action
    pushUndo({ type: 'archive', artifactId: p.id, artifactData: p, index: removedIndex });

    // Remove from local array
    POSTS.splice(current, 1);

    if (POSTS.length === 0) {
      rebuildTabs();
      showEmpty();
      showToastFromViewer('All pending artifacts archived');
      return;
    }

    // Rebuild tabs since counts changed
    rebuildTabs();

    // Stay at same index (next card slides in), or go to last if we were at end
    if (current >= POSTS.length) current = POSTS.length - 1;
    renderCard(current);
  }

  // ── Re-insert an artifact (for undo) ──────────────
  window._reinsertArtifact = function (data, originalIndex) {
    // Re-insert at the original position (or end if out of bounds)
    var idx = Math.min(originalIndex, POSTS.length);
    POSTS.splice(idx, 0, data);

    // Show viewer if it was hidden
    document.getElementById('viewer-container').style.display = '';
    document.getElementById('home-empty').style.display = 'none';

    rebuildTabs();
    renderCard(idx);
    showToastFromViewer('Artifact restored');
  };

  // ── Restore note/todo text (for undo) ─────────────
  window._restoreNoteText = function (artifactId, text) {
    var p = POSTS.find(x => x.id === artifactId);
    if (p) p.note = text;
    if (POSTS[current] && POSTS[current].id === artifactId) {
      document.getElementById('notes').value = bulletizeNote(text);
    }
  };

  window._restoreTodoText = function (artifactId, text) {
    var p = POSTS.find(x => x.id === artifactId);
    if (p) p.todo = text;
    if (POSTS[current] && POSTS[current].id === artifactId) {
      document.getElementById('todos').value = text;
    }
  };

  // ── Smooth scroll for j/k keys ────────────────────
  let _scrollTarget = 0;
  let _scrollRaf    = null;

  function _smoothScroll(delta) {
    _scrollTarget += delta;
    if (_scrollRaf) return;
    _scrollRaf = requestAnimationFrame(function step() {
      const s = _scrollTarget * 0.25;
      if (Math.abs(s) < 1) {
        cardScrollEl.scrollTop += _scrollTarget;
        _scrollTarget = 0;
        _scrollRaf = null;
        return;
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

    var inText = e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT';

    // Ctrl+Z → undo (works even in textarea)
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      popUndo().then(function (undone) {
        if (!undone) showToastFromViewer('Nothing to undo', 'error');
      });
      return;
    }

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
      _smoothScroll(200);
      return;
    }
    if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      _smoothScroll(-200);
      return;
    }

    if (e.key === 'c') {
      const commentsEl = document.getElementById('card-comments');
      if (commentsEl && commentsEl.style.display !== 'none') {
        commentsEl.classList.toggle('comments-open');
      }
      return;
    }

    // Enter → archive & next
    if (e.key === 'Enter') {
      e.preventDefault();
      archiveCurrent();
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
      const noted = POSTS.filter(p => p.note && p.note.trim());
      if (noted.length === 0) {
        showToastFromViewer('No notes to copy', 'error');
        return;
      }
      const lines = [];
      noted.forEach(p => {
        lines.push('## ' + (p.title || '[Post]'));
        lines.push(p.note);
        lines.push('');
      });
      navigator.clipboard.writeText(lines.join('\n')).then(function () {
        showToastFromViewer('Notes copied to clipboard');
      }).catch(function () {
        showToastFromViewer('Copy failed', 'error');
      });
    };
  }

  function showToastFromViewer(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
    else console.log(msg);
  }

  // ── Notes — save to API on change, auto-archive ───
  const notesTextarea = document.getElementById('notes');
  const todosTextarea = document.getElementById('todos');

  let _notesSaveTimer = null;
  let _todosSaveTimer = null;

  function saveNoteToApi(p, text) {
    if (!p || !p.id) return;
    fetch('/api/artifacts/' + p.id + '/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(console.error);
  }

  function saveTodoToApi(p, text) {
    if (!p || !p.id) return;
    fetch('/api/artifacts/' + p.id + '/todo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(console.error);
  }

  // Coalesce undo: if top of stack is same artifact+type, update previousText
  function pushTextUndo(type, artifactId, previousText) {
    var top = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
    if (top && top.type === type && top.artifactId === artifactId) {
      // Coalesce — keep the original previousText, don't push a new entry
      return;
    }
    pushUndo({ type: type, artifactId: artifactId, previousText: previousText });
  }

  function _notesInput() {
    var p = POSTS[current];
    if (!p) return;
    var prevText = p.note || '';
    var text = notesTextarea.value;
    p.note = text;

    pushTextUndo('note_edit', p.id, prevText);

    clearTimeout(_notesSaveTimer);
    _notesSaveTimer = setTimeout(function () {
      saveNoteToApi(p, text);
      // Auto-archive when note becomes non-empty
      if (text.trim() && p._status !== 'auto_archived') {
        p._status = 'auto_archived';
        autoArchive(p);
      }
    }, 800);
  }

  function _todosInput() {
    var p = POSTS[current];
    if (!p) return;
    var prevText = p.todo || '';
    var text = todosTextarea.value;
    p.todo = text;

    pushTextUndo('todo_edit', p.id, prevText);

    clearTimeout(_todosSaveTimer);
    _todosSaveTimer = setTimeout(function () {
      saveTodoToApi(p, text);
      // Auto-archive when todo becomes non-empty
      if (text.trim() && p._status !== 'auto_archived') {
        p._status = 'auto_archived';
        autoArchive(p);
      }
    }, 800);
  }

  function autoArchive(p) {
    // Silently archive via API (don't remove from viewer — user is still editing)
    fetch('/api/artifacts/' + p.id + '/archive', { method: 'POST' }).catch(console.error);
  }

  function _notesBlur() {
    var p = POSTS[current];
    if (!p) return;
    clearTimeout(_notesSaveTimer);
    saveNoteToApi(p, notesTextarea.value);
  }

  function _todosBlur() {
    var p = POSTS[current];
    if (!p) return;
    clearTimeout(_todosSaveTimer);
    saveTodoToApi(p, todosTextarea.value);
  }

  // Auto bullet: Enter → "• " on next line (only in notes)
  function _notesKeydown(e) {
    if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      var ta    = e.target;
      var start = ta.selectionStart;
      ta.value = ta.value.substring(0, start) + '\n• ' + ta.value.substring(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = start + 3;
      ta.dispatchEvent(new Event('input'));
    }
  }

  function _todosKeydown(e) {
    // Prevent Enter from triggering archive when in textarea
    if (e.key === 'Enter' && !e.ctrlKey) {
      e.stopPropagation();
    }
  }

  // Seed empty notes textarea with "• " on focus
  function _notesFocus(e) {
    if (!e.target.value.trim()) {
      e.target.value = '• ';
      e.target.selectionStart = e.target.selectionEnd = e.target.value.length;
    }
  }

  // Remove any listeners from a previous initDigestViewer call before re-adding
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
    todosInput: _todosInput, todosBlur: _todosBlur,
    todosKeydown: _todosKeydown,
  };
  notesTextarea.addEventListener('input',   _notesInput);
  notesTextarea.addEventListener('blur',    _notesBlur);
  notesTextarea.addEventListener('keydown', _notesKeydown);
  notesTextarea.addEventListener('focus',   _notesFocus);
  todosTextarea.addEventListener('input',   _todosInput);
  todosTextarea.addEventListener('blur',    _todosBlur);
  todosTextarea.addEventListener('keydown', _todosKeydown);

  if (POSTS.length > 0) {
    renderCard(0);
  } else {
    showEmpty();
  }
};
