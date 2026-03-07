(function () {
  const POSTS = JSON.parse(document.getElementById('posts-data').textContent);
  let current = 0;

  // ── Subreddit colour palettes ───────────────────
  // Each entry is [blob1, blob2, blob3] colours.
  const PALETTES = [
    ['#6366f1', '#8b5cf6', '#a78bfa'],  // indigo-violet
    ['#06b6d4', '#0d9488', '#22d3ee'],  // cyan-teal
    ['#f43f5e', '#e11d48', '#fb7185'],  // rose-crimson
    ['#f59e0b', '#ef4444', '#f97316'],  // amber-orange
    ['#10b981', '#059669', '#34d399'],  // emerald
    ['#3b82f6', '#1d4ed8', '#60a5fa'],  // blue
    ['#ec4899', '#a855f7', '#f0abfc'],  // pink-fuchsia
    ['#0ea5e9', '#6366f1', '#38bdf8'],  // sky-indigo
  ];
  const COVER_PALETTE = ['#1e3a5f', '#0f2744', '#2563eb'];
  const NOTES_PALETTE = ['#92400e', '#b45309', '#d97706'];

  const subPaletteMap = {};
  let nextPaletteIdx = 0;

  function getPalette(post) {
    if (post.type === 'cover')         return COVER_PALETTE;
    if (post.type === 'notes_summary') return NOTES_PALETTE;
    if (!(post.subreddit in subPaletteMap))
      subPaletteMap[post.subreddit] = nextPaletteIdx++ % PALETTES.length;
    return PALETTES[subPaletteMap[post.subreddit]];
  }

  // CSS transition: background-color 1.4s ease is declared on .blob in CSS.
  // We just set the target colour and the browser interpolates smoothly,
  // even if interrupted mid-transition — no manual animation tracking needed.
  const BLOB_IDS = ['blob1', 'blob2', 'blob3'];

  function updateBg(palette) {
    BLOB_IDS.forEach((id, i) => {
      document.getElementById(id).style.backgroundColor = palette[i];
    });
  }

  // ── Build subreddit start-index map ─────────────
  const subStarts = {};
  POSTS.forEach((p, i) => {
    if (p.type === 'cover' || p.type === 'notes_summary') return;
    if (!(p.subreddit in subStarts)) subStarts[p.subreddit] = i;
  });

  // ── Build tab bar ───────────────────────────────
  // tabDefs: [{start, end, el}] — used to highlight the active tab range.
  const tabDefs = [];
  const tabsEl  = document.getElementById('tabs');

  function makeTab(label, extraClass) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    tabsEl.appendChild(btn);
    return btn;
  }

  // Digest tab (cover card, index 0)
  const coverBtn = makeTab('⊙ Digest', 'tab-special');
  coverBtn.onclick = () => navigateTo(0);
  tabDefs.push({ start: 0, end: 0, el: coverBtn });

  // Subreddit tabs
  const subList = Object.keys(subStarts);
  subList.forEach((sub, i) => {
    const start = subStarts[sub];
    const end   = i + 1 < subList.length
      ? subStarts[subList[i + 1]] - 1
      : POSTS.length - 2;   // -2 because last is notes_summary
    const btn = makeTab('r/' + sub);
    btn.onclick = () => navigateTo(start);
    tabDefs.push({ start, end, el: btn });
  });

  // Notes tab (notes_summary card, last index)
  const notesTabBtn = makeTab('✎ Notes', 'tab-special');
  notesTabBtn.onclick = () => navigateTo(POSTS.length - 1);
  tabDefs.push({ start: POSTS.length - 1, end: POSTS.length - 1, el: notesTabBtn });

  // ── Helpers ─────────────────────────────────────
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

  // ── Special card renderers ───────────────────────

  function renderCoverCard(p) {
    const weekly  = p.subreddits.filter(s => s.period === 'weekly');
    const monthly = p.subreddits.filter(s => s.period === 'monthly');
    const chips   = arr => arr.map(s =>
      `<span class="chip">r/${escAttr(s.name)}<em>${s.count}</em></span>`
    ).join('');

    // Estimate reading time: count words across all post titles + text bodies
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
        '<div class="cover-eyebrow">Reddit Digest</div>' +
        '<div class="cover-week">' + escAttr(p.week_tag) + '</div>' +
        '<div class="cover-meta">Generated ' + escAttr(p.generated) +
          ' &nbsp;&middot;&nbsp; ' + p.total_posts + ' posts' +
          ' &nbsp;&middot;&nbsp; ~' + readMins + ' min read</div>' +
        '<div class="cover-section">' +
          '<div class="cover-section-label">Weekly</div>' +
          '<div class="cover-chips">' + chips(weekly) + '</div>' +
        '</div>' +
        (monthly.length
          ? '<div class="cover-section">' +
              '<div class="cover-section-label">Monthly</div>' +
              '<div class="cover-chips">' + chips(monthly) + '</div>' +
            '</div>'
          : '') +
        '<details class="cover-hint">' +
          '<summary>keyboard shortcuts</summary>' +
          '<div class="cover-hint-body">' +
            '<kbd>&larr;</kbd> / <kbd>&rarr;</kbd> &nbsp; navigate cards<br>' +
            '<kbd>&uarr;</kbd> / <kbd>&darr;</kbd> &nbsp; also navigate<br>' +
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

    // Group by subreddit
    const groups = {};
    noted.forEach(p => {
      const k = p.subreddit || '—';
      if (!groups[k]) groups[k] = [];
      groups[k].push(p);
    });

    let html = '<div class="ns-header">Your Notes</div>';
    for (const [sub, posts] of Object.entries(groups)) {
      html += '<div class="note-group"><div class="note-group-label">r/' + escAttr(sub) + '</div>';
      for (const p of posts) {
        const note = escAttr(localStorage.getItem('note:' + p.link) || '');
        html +=
          '<div class="note-item">' +
            '<div class="note-item-title">' +
              '<a href="' + escAttr(p.link) + '" target="_blank" rel="noopener">' + p.title + '</a>' +
            '</div>' +
            '<pre class="note-item-text">' + note + '</pre>' +
          '</div>';
      }
      html += '</div>';
    }
    document.getElementById('card').innerHTML = html;
  }

  // ── Comment thread renderer ──────────────────────
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

    return (
      '<div class="comments-section">' +
        '<div class="comments-header">Top Comments</div>' +
        renderThread(comments) +
      '</div>'
    );
  }

  // ── Main render function ─────────────────────────
  function renderCard(index) {
    const p = POSTS[index];
    current = index;

    // Tab highlights
    tabDefs.forEach(({ start, end, el }) => {
      el.classList.toggle('active', index >= start && index <= end);
    });

    // Progress
    document.getElementById('topbar-progress').textContent =
      (index + 1) + ' / ' + POSTS.length;
    document.getElementById('nav-label').textContent =
      (index + 1) + ' of ' + POSTS.length;
    document.getElementById('btn-prev').disabled = index === 0;
    document.getElementById('btn-next').disabled = index === POSTS.length - 1;

    // Background
    updateBg(getPalette(p));

    // Card content
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
      // Normal post
      let contentHtml = '';
      if (p.type === 'text' && p.content.text) {
        contentHtml = '<div class="selftext">' + marked.parse(p.content.text) + '</div>';
      } else if ((p.type === 'image' || p.type === 'gallery') && p.content.url) {
        contentHtml = '<img src="' + escAttr(p.content.url) + '" alt="" loading="lazy">';
      } else if (p.type === 'video' && p.content.url) {
        contentHtml = '<video src="' + escAttr(p.content.url) + '" controls muted preload="none"></video>';
      } else if (p.type === 'link' && p.content.url) {
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
        '</div>' +
        contentHtml;

      // MathJax (loads async — guards against it not being ready yet)
      if (p.type === 'text' && typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        MathJax.typesetPromise([document.getElementById('card')]).catch(console.error);
      }

      // Comments in their own sibling card
      const commentsHtml = renderComments(p.comments);
      if (commentsHtml) {
        commentsEl.innerHTML = commentsHtml;
        commentsEl.style.display = '';
      } else {
        commentsEl.innerHTML = '';
        commentsEl.style.display = 'none';
      }
    }

    // Sidebar notes
    const notesEl    = document.getElementById('notes');
    const notesTitEl = document.getElementById('notes-post-title');
    if (p.type === 'notes_summary') {
      notesEl.value       = '';
      notesTitEl.textContent = 'Showing all notes in card';
    } else {
      notesEl.value       = localStorage.getItem('note:' + p.link) || '';
      notesTitEl.textContent = p.type === 'cover' ? 'Cover page' : decodeHtml(p.title);
    }

    document.getElementById('card-scroll').scrollTop = 0;
  }

  // ── Navigation ───────────────────────────────────
  function navigateTo(index) {
    if (index < 0 || index >= POSTS.length || index === current) return;
    const cardEl = document.getElementById('card');
    const cls    = index > current ? 'anim-fwd' : 'anim-bwd';
    cardEl.classList.remove('anim-fwd', 'anim-bwd');
    void cardEl.offsetWidth;  // force reflow so animation restarts
    cardEl.classList.add(cls);
    renderCard(index);
  }

  function navigate(delta) { navigateTo(current + delta); }
  window.navigate = navigate;

  // Arrow keys (skip when typing in the notes textarea)
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   navigate(-1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigate(1);
  });

  // Auto-save notes per post (keyed by permalink)
  document.getElementById('notes').addEventListener('input', () => {
    const p = POSTS[current];
    if (p.type === 'notes_summary') return;
    localStorage.setItem('note:' + p.link, document.getElementById('notes').value);
  });

  renderCard(0);
})();
