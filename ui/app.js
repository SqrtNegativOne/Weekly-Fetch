/**
 * app.js — SPA routing and API integration for Weekly Fetch.
 *
 * Responsibilities:
 *   - Show/hide views (home, sources, archive, settings, about)
 *   - Load pending artifacts and hand off to initDigestViewer()
 *   - Archive page: search, filter, pagination
 *   - Sources: load from / save to /api/accounts
 *   - Settings: load from / save to /api/settings
 *   - Task buttons: install, remove, run-now
 *   - Toast notifications for user feedback
 */

// ── State ────────────────────────────────────────────────────────────────────

var _fetchRunning = false;

// ── Fetch status polling ─────────────────────────────────────────────────────

async function pollFetchStatus() {
  var wasRunning = _fetchRunning;
  try {
    var res = await api('GET', '/api/fetch-status');
    _fetchRunning = res.running;
    updateFetchProgress(res.progress || null);
  } catch (e) {
    _fetchRunning = false;
    updateFetchProgress(null);
  }

  var fetchingEl = document.getElementById('home-fetching');
  if (fetchingEl) {
    fetchingEl.style.display = _fetchRunning ? 'flex' : 'none';
  }

  // Fetch just finished — reload pending artifacts and surface any errors
  if (wasRunning && !_fetchRunning) {
    loadPending();
    showFetchErrors();
  }
}

function updateFetchProgress(progress) {
  var bar    = document.getElementById('fetch-progress-bar');
  var status = document.getElementById('fetch-progress-status');
  var grid   = document.getElementById('fetch-progress-grid');
  if (!bar || !status || !grid) return;

  if (!progress) {
    bar.style.width = '0%';
    status.textContent = 'Starting\u2026';
    grid.innerHTML = '';
    return;
  }

  var pct = progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  bar.style.width = pct + '%';

  // Status text
  var fetching = (progress.sources || []).filter(function (s) {
    return s.status === 'fetching';
  }).length;
  if (fetching > 0) {
    status.textContent = 'Fetching ' + fetching + ' source' +
      (fetching > 1 ? 's' : '') +
      '  (' + progress.done + '/' + progress.total + ')';
  } else if (progress.done >= progress.total && progress.total > 0) {
    status.textContent = 'Saving\u2026';
  } else {
    status.textContent = 'Starting\u2026';
  }

  // Matrix grid — one cell per source
  var icons = { pending: '\u25cb', fetching: '\u25cb', done: '\u2713', error: '\u2717' };
  var html = '';
  (progress.sources || []).forEach(function (src) {
    var icon = icons[src.status] || '\u25cb';
    var cls = 'fetch-cell fetch-cell--' + src.status +
      ' fetch-cell--' + (src.platform || '');
    html += '<div class="' + cls + '">' +
      '<span class="fetch-cell-icon">' + icon + '</span>' +
      '<span class="fetch-cell-label">' +
        src.label.replace(/</g, '&lt;') + '</span></div>';
  });
  grid.innerHTML = html;
}

async function showFetchErrors() {
  try {
    var errors = await api('GET', '/api/fetch-errors');
    errors.forEach(function (msg) {
      showToast(msg, 'error');
    });
  } catch (e) {
    // silently ignore
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || res.statusText);
  }
  return res.json();
}

// ── Toast notifications ───────────────────────────────────────────────────────

function showToast(msg, type) {
  type = type || 'success';
  var container = document.getElementById('toast-container');
  if (!container) return;
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function () {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(function () { el.remove(); }, 300);
  }, 3500);
}

// ── View routing ──────────────────────────────────────────────────────────────

var VIEWS = ['home', 'sources', 'archive', 'usage', 'settings', 'about'];

function showView(name) {
  VIEWS.forEach(function (v) {
    var el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('active', v === name);
  });
  document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
}

// ── Pending artifacts (Home view) ─────────────────────────────────────────────

async function loadPending() {
  var data;
  try {
    data = await api('GET', '/api/artifacts/pending');
  } catch (e) {
    console.error('Failed to load pending artifacts:', e);
    return;
  }

  var artifacts    = data.artifacts || [];
  var pendingNotes = data.pending_notes || 0;
  var pendingTodos = data.pending_todos || 0;

  var viewerAppEl = document.getElementById('viewer-app');
  var emptyEl     = document.getElementById('home-empty');

  if (artifacts.length === 0 && pendingNotes === 0 && pendingTodos === 0) {
    // Truly empty — nothing to do
    viewerAppEl.style.display = 'none';
    emptyEl.style.display = 'flex';
  } else {
    viewerAppEl.style.display = '';
    emptyEl.style.display = 'none';
    window.initDigestViewer(data);
  }
}

// ── Archive page ──────────────────────────────────────────────────────────────

var _archiveOffset = 0;
var _archiveSearch = '';
var _archivePlatform = '';
var _archiveTab = 'artifacts';

async function loadArchive(search, platform, offset, append) {
  _archiveSearch   = search || '';
  _archivePlatform = platform || '';
  _archiveOffset   = offset || 0;

  var items;
  try {
    var params = new URLSearchParams();
    if (_archiveSearch) params.set('search', _archiveSearch);
    if (_archivePlatform) params.set('platform', _archivePlatform);
    params.set('limit', '50');
    params.set('offset', String(_archiveOffset));

    var endpoint;
    if (_archiveTab === 'notes')    endpoint = '/api/notes/archived';
    else if (_archiveTab === 'todos') endpoint = '/api/todos/archived';
    else                              endpoint = '/api/artifacts/archived';

    items = await api('GET', endpoint + '?' + params.toString());
  } catch (e) {
    showToast('Failed to load archive: ' + e.message, 'error');
    return;
  }

  var listEl = document.getElementById('archive-list');
  var moreBtn = document.getElementById('btn-archive-more');

  if (!append) {
    listEl.innerHTML = '';
  }

  var emptyLabel = _archiveTab === 'notes' ? 'notes' :
                   _archiveTab === 'todos' ? 'todos' : 'artifacts';

  if (!items || items.length === 0) {
    if (!append) {
      listEl.innerHTML = '<div class="archive-empty">No archived ' + emptyLabel + ' found.</div>';
    }
    moreBtn.style.display = 'none';
    return;
  }

  if (_archiveTab === 'notes') {
    renderArchiveNotes(items, listEl);
  } else if (_archiveTab === 'todos') {
    renderArchiveTodos(items, listEl);
  } else {
    renderArchiveArtifacts(items, listEl);
  }

  // Show "Load more" if we got a full page
  moreBtn.style.display = items.length >= 50 ? '' : 'none';
}

function renderArchiveArtifacts(artifacts, listEl) {
  artifacts.forEach(function (a) {
    var row = document.createElement('div');
    row.className = 'archive-item';

    var platformClass = a.platform ? 'archive-item-' + a.platform : '';
    row.classList.add(platformClass);

    var notePreview = '';
    if (a.note && a.note.trim()) {
      var preview = a.note.replace(/^•\s*/gm, '').trim();
      if (preview.length > 80) preview = preview.substring(0, 80) + '\u2026';
      notePreview = '<div class="archive-item-note">' + escHtml(preview) + '</div>';
    }

    var archivedDate = '';
    if (a.archived_at) {
      var d = new Date(a.archived_at);
      archivedDate = d.toLocaleDateString();
    }

    row.innerHTML =
      '<div class="archive-item-title">' +
        '<a href="' + escHtml(a.link || '#') + '" target="_blank" rel="noopener">' +
          escHtml(a.title || '[Post]') +
        '</a>' +
      '</div>' +
      '<div class="archive-item-meta">' +
        '<span class="platform-badge pb-' + (a.platform || 'reddit') + '">' +
          escHtml(a.platform || 'reddit') +
        '</span> ' +
        '<span>' + escHtml(a.source_name || '') + '</span>' +
        '<span class="archive-item-score">' + (a.score || 0).toLocaleString() + ' pts</span>' +
        (archivedDate ? '<span class="archive-item-date">' + archivedDate + '</span>' : '') +
      '</div>' +
      notePreview;

    listEl.appendChild(row);
  });
}

function renderArchiveNotes(notes, listEl) {
  notes.forEach(function (n) {
    var row = document.createElement('div');
    row.className = 'archive-item';
    if (n.platform) row.classList.add('archive-item-' + n.platform);

    var archivedDate = '';
    if (n.archived_at) {
      archivedDate = new Date(n.archived_at).toLocaleDateString();
    }

    var preview = (n.note_text || '').replace(/^•\s*/gm, '').trim();
    if (preview.length > 200) preview = preview.substring(0, 200) + '\u2026';

    row.innerHTML =
      '<div class="archive-item-title">' +
        '<a href="' + escHtml(n.link || '#') + '" target="_blank" rel="noopener">' +
          escHtml(n.title || '[Post]') +
        '</a>' +
      '</div>' +
      '<div class="archive-item-meta">' +
        '<span class="platform-badge pb-' + (n.platform || 'reddit') + '">' +
          escHtml(n.platform || 'reddit') +
        '</span> ' +
        '<span>' + escHtml(n.source_name || '') + '</span>' +
        (archivedDate ? '<span class="archive-item-date">' + archivedDate + '</span>' : '') +
      '</div>' +
      '<div class="archive-item-note">' + escHtml(preview) + '</div>';

    listEl.appendChild(row);
  });
}

function renderArchiveTodos(todos, listEl) {
  todos.forEach(function (t) {
    var row = document.createElement('div');
    row.className = 'archive-item';
    if (t.platform) row.classList.add('archive-item-' + t.platform);

    var archivedDate = '';
    if (t.archived_at) {
      archivedDate = new Date(t.archived_at).toLocaleDateString();
    }

    var preview = (t.todo_text || '').trim();
    if (preview.length > 200) preview = preview.substring(0, 200) + '\u2026';

    row.innerHTML =
      '<div class="archive-item-title">' +
        '<a href="' + escHtml(t.link || '#') + '" target="_blank" rel="noopener">' +
          escHtml(t.title || '[Post]') +
        '</a>' +
      '</div>' +
      '<div class="archive-item-meta">' +
        '<span class="platform-badge pb-' + (t.platform || 'reddit') + '">' +
          escHtml(t.platform || 'reddit') +
        '</span> ' +
        '<span>' + escHtml(t.source_name || '') + '</span>' +
        (archivedDate ? '<span class="archive-item-date">' + archivedDate + '</span>' : '') +
      '</div>' +
      '<div class="archive-item-note">' + escHtml(preview) + '</div>';

    listEl.appendChild(row);
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Usage page ────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (seconds < 60) return seconds + 's';
  var m = Math.floor(seconds / 60);
  var s = seconds % 60;
  if (m < 60) return m + 'm ' + s + 's';
  var h = Math.floor(m / 60);
  m = m % 60;
  return h + 'h ' + m + 'm';
}

async function loadUsage() {
  var stats;
  try {
    stats = await api('GET', '/api/usage/stats');
  } catch (e) {
    showToast('Failed to load usage: ' + e.message, 'error');
    return;
  }

  // Summary cards
  var summaryEl = document.getElementById('usage-summary');
  summaryEl.innerHTML =
    '<div class="usage-stat-card">' +
      '<div class="usage-stat-value">' + formatDuration(stats.total_time_seconds) + '</div>' +
      '<div class="usage-stat-label">Total time</div>' +
    '</div>' +
    '<div class="usage-stat-card">' +
      '<div class="usage-stat-value">' + stats.total_sessions + '</div>' +
      '<div class="usage-stat-label">Sessions</div>' +
    '</div>' +
    '<div class="usage-stat-card">' +
      '<div class="usage-stat-value">' + stats.total_artifacts_viewed + '</div>' +
      '<div class="usage-stat-label">Artifacts viewed</div>' +
    '</div>';

  // Time per source bars
  var barsEl = document.getElementById('usage-source-bars');
  if (!stats.per_source || stats.per_source.length === 0) {
    barsEl.innerHTML = '<div class="usage-empty">No usage data yet.</div>';
  } else {
    var maxTime = Math.max.apply(null, stats.per_source.map(function (s) { return s.time_seconds; }));
    if (maxTime === 0) maxTime = 1;
    barsEl.innerHTML = stats.per_source.map(function (s) {
      var pct = Math.round((s.time_seconds / maxTime) * 100);
      var platformColor = 'var(--' + (s.platform || 'accent') + ', var(--accent))';
      return '<div class="usage-bar-row">' +
        '<div class="usage-bar-label">' + escHtml(s.source) + '</div>' +
        '<div class="usage-bar-track">' +
          '<div class="usage-bar-fill" style="width:' + pct + '%;background:' + platformColor + '"></div>' +
        '</div>' +
        '<div class="usage-bar-value">' + formatDuration(s.time_seconds) + '</div>' +
      '</div>';
    }).join('');
  }

  // Notes & Todos bars
  var notesEl = document.getElementById('usage-notes-bars');
  var withNotes = stats.per_source.filter(function (s) { return s.note_count > 0 || s.todo_count > 0; });
  if (withNotes.length === 0) {
    notesEl.innerHTML = '<div class="usage-empty">No notes or todos yet.</div>';
  } else {
    var maxNT = Math.max.apply(null, withNotes.map(function (s) { return s.note_count + s.todo_count; }));
    if (maxNT === 0) maxNT = 1;
    notesEl.innerHTML = withNotes.map(function (s) {
      var total = s.note_count + s.todo_count;
      var pct = Math.round((total / maxNT) * 100);
      return '<div class="usage-bar-row">' +
        '<div class="usage-bar-label">' + escHtml(s.source) + '</div>' +
        '<div class="usage-bar-track">' +
          '<div class="usage-bar-fill" style="width:' + pct + '%;background:var(--accent)"></div>' +
        '</div>' +
        '<div class="usage-bar-value">' + s.note_count + 'n / ' + s.todo_count + 't' + (s.posts_fetched ? '  (of ' + s.posts_fetched + ')' : '') + '</div>' +
      '</div>';
    }).join('');
  }

  // Recent sessions
  var sessEl = document.getElementById('usage-sessions-list');
  if (!stats.recent_sessions || stats.recent_sessions.length === 0) {
    sessEl.innerHTML = '<div class="usage-empty">No sessions recorded yet.</div>';
  } else {
    sessEl.innerHTML = stats.recent_sessions.map(function (s) {
      var d = new Date(s.started_at);
      var dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return '<div class="usage-session-row">' +
        '<span class="usage-session-date">' + dateStr + '</span>' +
        '<span class="usage-session-dur">' + formatDuration(s.duration_seconds) + '</span>' +
        '<span class="usage-session-count">' + s.artifacts_viewed + ' viewed</span>' +
      '</div>';
    }).join('');
  }

  // Dormant sources
  var dormantEl = document.getElementById('usage-dormant');
  try {
    var stale = await api('GET', '/api/stats/stale-sources');
    if (!stale || stale.length === 0) {
      dormantEl.innerHTML = '<div class="usage-empty">All sources fetched recently.</div>';
    } else {
      dormantEl.innerHTML = stale.map(function (s) {
        var d = new Date(s.last_fetch);
        var dateStr = d.toLocaleDateString();
        var platformColor = 'var(--' + (s.platform || 'accent') + ', var(--accent))';
        return '<div class="usage-dormant-row">' +
          '<span class="usage-dormant-dot" style="background:' + platformColor + '"></span>' +
          '<span class="usage-dormant-name">' + escHtml(s.platform + '/' + s.source_name) + '</span>' +
          '<span class="usage-dormant-meta">last fetched ' + dateStr + ' &middot; ' + s.total_artifacts + ' total</span>' +
        '</div>';
      }).join('');
    }
  } catch (e) {
    dormantEl.innerHTML = '';
  }
}

// ── Sources (was: Accounts) ───────────────────────────────────────────────────

var PLATFORM_CONFIG = {
  reddit:    { listKey: 'subreddits', thresholdKey: 'karma',         globalKey: 'min_karma',     namePlaceholder: 'MachineLearning',      prefix: 'r/', thresholdLabel: 'karma' },
  bluesky:   { listKey: 'accounts',   thresholdKey: 'min_likes',     globalKey: 'min_likes',     namePlaceholder: 'jay.bsky.social',      prefix: '',   thresholdLabel: 'likes' },
  tumblr:    { listKey: 'blogs',      thresholdKey: 'min_notes',     globalKey: 'min_notes',     namePlaceholder: 'staff',                prefix: '',   thresholdLabel: 'notes' },
  instagram: { listKey: 'accounts',   thresholdKey: 'min_likes',     globalKey: 'min_likes',     namePlaceholder: 'natgeo',               prefix: '@',  thresholdLabel: 'likes' },
  mastodon:  { listKey: 'accounts',   thresholdKey: 'min_favorites', globalKey: 'min_favorites', namePlaceholder: 'username@mastodon.social', prefix: '', thresholdLabel: 'favorites' },
  twitter:   { listKey: 'accounts',   thresholdKey: 'min_likes',     globalKey: 'min_likes',     namePlaceholder: 'elonmusk',             prefix: '@',  thresholdLabel: 'likes' },
};

/**
 * Try to extract a clean source ID from a pasted URL.
 * Returns the extracted ID, or null if the value isn't a URL.
 * Returns '' (empty string) if it looks like a URL but we can't parse it.
 */
function tryParseSourceUrl(platform, value) {
  value = value.trim();
  // Only attempt parsing if it looks like a URL
  if (!/^https?:\/\//i.test(value) && !value.includes('.com') && !value.includes('.org') &&
      !value.includes('.net') && !value.includes('.social') && !value.includes('.app')) {
    return null; // not a URL — leave it as-is
  }

  var m;
  if (platform === 'reddit') {
    // https://www.reddit.com/r/MachineLearning/...
    m = value.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/);
    return m ? m[1] : '';
  }
  if (platform === 'bluesky') {
    // https://bsky.app/profile/jay.bsky.social
    m = value.match(/bsky\.app\/profile\/([A-Za-z0-9._-]+)/);
    return m ? m[1] : '';
  }
  if (platform === 'tumblr') {
    // https://staff.tumblr.com/ or https://www.tumblr.com/staff
    m = value.match(/tumblr\.com\/([A-Za-z0-9_-]+)/) || value.match(/([A-Za-z0-9_-]+)\.tumblr\.com/);
    if (m) {
      var blog = m[1];
      if (blog === 'www') {
        // try the path form: tumblr.com/blogname
        m = value.match(/tumblr\.com\/([A-Za-z0-9_-]+)/);
        return m ? m[1] : '';
      }
      return blog;
    }
    return '';
  }
  if (platform === 'instagram') {
    // https://www.instagram.com/natgeo/
    m = value.match(/instagram\.com\/([A-Za-z0-9._]+)/);
    return m ? m[1] : '';
  }
  if (platform === 'mastodon') {
    // https://mastodon.social/@username → username@mastodon.social
    m = value.match(/https?:\/\/([^/]+)\/@([A-Za-z0-9_]+)/);
    return m ? (m[2] + '@' + m[1]) : '';
  }
  if (platform === 'twitter') {
    // https://twitter.com/elonmusk or https://x.com/elonmusk
    m = value.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/);
    return m ? m[1] : '';
  }
  return null;
}

function scheduleToDisplay(sched) {
  if (!sched) return { mode: 'weeks', n: 1, weekday: 'Saturday', day: 1 };
  if (sched.every_weekday)  return { mode: 'weeks',  n: 1,                    weekday: sched.every_weekday, day: 1 };
  if (sched.every_n_days)   return { mode: 'days',   n: sched.every_n_days,   weekday: 'Saturday',          day: 1 };
  if (sched.every_n_weeks)  return { mode: 'weeks',  n: sched.every_n_weeks,  weekday: 'Saturday',          day: 1 };
  if (sched.every_n_months) return { mode: 'months', n: sched.every_n_months, weekday: 'Saturday',          day: 1 };
  if (sched.day_n_of_month) return { mode: 'months', n: 1,                    weekday: 'Saturday',          day: sched.day_n_of_month };
  return { mode: 'weeks', n: 1, weekday: 'Saturday', day: 1 };
}

var DAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
var DAYS_FULL  = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function createEntryRow(platform, entry) {
  var name = typeof entry === 'string' ? entry : (entry.name || '');
  var sched = typeof entry === 'object' ? entry.schedule : null;
  var cfg = PLATFORM_CONFIG[platform];

  var threshVal = '';
  if (typeof entry === 'object' && entry[cfg.thresholdKey] != null) {
    threshVal = String(entry[cfg.thresholdKey]);
  }

  var ds = scheduleToDisplay(sched);

  var row = document.createElement('div');
  row.className = 'source-entry';

  // ── Name row ──────────────────────────────────────
  var nameRow = document.createElement('div');
  nameRow.className = 'name-row';

  if (cfg.prefix) {
    var prefixSpan = document.createElement('span');
    prefixSpan.className = 'source-prefix';
    prefixSpan.textContent = cfg.prefix;
    nameRow.appendChild(prefixSpan);
  }

  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'source-name';
  nameInput.placeholder = cfg.namePlaceholder;
  nameInput.value = name;

  function _tryConvertUrl() {
    var result = tryParseSourceUrl(platform, nameInput.value);
    if (result === null) return;
    if (result === '') { nameInput.value = ''; showToast('Could not parse URL for ' + platform, 'error'); }
    else nameInput.value = result;
  }
  nameInput.addEventListener('paste', function () { setTimeout(_tryConvertUrl, 0); });
  nameInput.addEventListener('blur', _tryConvertUrl);
  nameRow.appendChild(nameInput);

  var removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'source-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.onclick = function () { row.remove(); };
  nameRow.appendChild(removeBtn);

  row.appendChild(nameRow);

  // ── Schedule row ───────────────────────────────────
  var schedRow = document.createElement('div');
  schedRow.className = 'sched-row';

  var schedLeft = document.createElement('div');
  schedLeft.className = 'sched-left';

  var everySpan = document.createElement('span');
  everySpan.className = 'word';
  everySpan.textContent = 'every';
  schedLeft.appendChild(everySpan);

  var nInput = document.createElement('input');
  nInput.type = 'number';
  nInput.className = 'ul-input n-input';
  nInput.min = '1';
  nInput.value = String(ds.n || 1);
  nInput.dataset.role = 'n';
  schedLeft.appendChild(nInput);

  var unitSel = document.createElement('select');
  unitSel.className = 'ul-select unit-sel';
  unitSel.dataset.role = 'unit';
  [
    { value: 'days',   label: 'day(s)'   },
    { value: 'weeks',  label: 'week(s)'  },
    { value: 'months', label: 'month(s)' },
  ].forEach(function (opt) {
    var o = document.createElement('option');
    o.value = opt.value; o.textContent = opt.label;
    unitSel.appendChild(o);
  });
  unitSel.value = ds.mode;
  schedLeft.appendChild(unitSel);

  // "on" + day pills (weeks only)
  var onWeekEls = [];

  var onSpanWeeks = document.createElement('span');
  onSpanWeeks.className = 'word';
  onSpanWeeks.textContent = 'on';
  schedLeft.appendChild(onSpanWeeks);
  onWeekEls.push(onSpanWeeks);

  var pillsWrap = document.createElement('div');
  pillsWrap.className = 'day-pills';
  DAYS_SHORT.forEach(function (letter, i) {
    var pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'day-pill';
    pill.textContent = letter;
    pill.dataset.day = DAYS_FULL[i];
    if (DAYS_FULL[i] === ds.weekday) pill.classList.add('active');
    pill.onclick = function () {
      pillsWrap.querySelectorAll('.day-pill').forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
    };
    pillsWrap.appendChild(pill);
  });
  schedLeft.appendChild(pillsWrap);
  onWeekEls.push(pillsWrap);

  // "on day" + input (months only)
  var onMonthEls = [];

  var onDaySpan = document.createElement('span');
  onDaySpan.className = 'word';
  onDaySpan.textContent = 'on day';
  schedLeft.appendChild(onDaySpan);
  onMonthEls.push(onDaySpan);

  var dayInput = document.createElement('input');
  dayInput.type = 'number';
  dayInput.className = 'ul-input monthday-input';
  dayInput.min = '1'; dayInput.max = '31';
  dayInput.value = String(ds.day || 1);
  dayInput.dataset.role = 'monthday';
  schedLeft.appendChild(dayInput);
  onMonthEls.push(dayInput);

  function applyMode(mode) {
    onWeekEls.forEach(function (el)  { el.style.display = mode === 'weeks'  ? '' : 'none'; });
    onMonthEls.forEach(function (el) { el.style.display = mode === 'months' ? '' : 'none'; });
  }
  applyMode(ds.mode);
  unitSel.onchange = function () { applyMode(unitSel.value); };

  schedRow.appendChild(schedLeft);

  // Right: threshold
  var schedRight = document.createElement('div');
  schedRight.className = 'sched-right';

  var gteSpan = document.createElement('span');
  gteSpan.className = 'gte';
  gteSpan.textContent = '\u2265';
  schedRight.appendChild(gteSpan);

  var threshInput = document.createElement('input');
  threshInput.type = 'number';
  threshInput.className = 'ul-input thresh-input';
  threshInput.placeholder = 'default';
  threshInput.min = '0';
  threshInput.value = threshVal;
  threshInput.dataset.role = 'thresh';
  schedRight.appendChild(threshInput);

  var threshLabel = document.createElement('span');
  threshLabel.className = 'word';
  threshLabel.textContent = cfg.thresholdLabel;
  schedRight.appendChild(threshLabel);

  schedRow.appendChild(schedRight);
  row.appendChild(schedRow);
  return row;
}

window.togglePlatSection = function (el) {
  el.closest('.plat').classList.toggle('collapsed');
};

window.addEntry = function (platform) {
  var container = document.getElementById(platform + '-entries');
  container.appendChild(createEntryRow(platform, ''));
  var inputs = container.querySelectorAll('.source-name');
  inputs[inputs.length - 1].focus();
};

function populateEntries(platform, entries) {
  var container = document.getElementById(platform + '-entries');
  container.innerHTML = '';
  (entries || []).forEach(function (entry) {
    container.appendChild(createEntryRow(platform, entry));
  });
}

function collectEntries(platform) {
  var container = document.getElementById(platform + '-entries');
  var rows = container.querySelectorAll('.source-entry');
  var cfg = PLATFORM_CONFIG[platform];
  var entries = [];
  rows.forEach(function (row) {
    var name = row.querySelector('.source-name').value.trim();
    if (!name) return;

    var n = Math.max(1, parseInt(row.querySelector('[data-role="n"]').value) || 1);
    var unit = row.querySelector('[data-role="unit"]').value;
    var activePill = row.querySelector('.day-pill.active');
    var weekday = activePill ? activePill.dataset.day : 'Saturday';
    var dayEl = row.querySelector('[data-role="monthday"]');
    var day = Math.max(1, Math.min(31, parseInt((dayEl && dayEl.value) || '1') || 1));

    var schedule;
    if (unit === 'days') {
      schedule = { every_n_days: n };
    } else if (unit === 'weeks') {
      schedule = n === 1 ? { every_weekday: weekday } : { every_n_weeks: n };
    } else {
      schedule = { day_n_of_month: day };
    }

    var threshVal = row.querySelector('[data-role="thresh"]').value.trim();
    var entry = { name: name, schedule: schedule };
    if (threshVal !== '') entry[cfg.thresholdKey] = parseInt(threshVal) || 0;
    entries.push(entry);
  });
  return entries;
}

async function loadSources() {
  var data;
  try {
    data = await api('GET', '/api/accounts');
  } catch (e) {
    showToast('Failed to load sources: ' + e.message, 'error');
    return;
  }

  var r  = data.reddit    || {};
  var b  = data.bluesky   || {};
  var t  = data.tumblr    || {};
  var ig = data.instagram || {};
  var ms = data.mastodon  || {};
  var tw = data.twitter   || {};

  document.getElementById('reddit-min-karma').value       = r.min_karma       ?? 100;
  document.getElementById('bluesky-min-likes').value      = b.min_likes       ?? 10;
  document.getElementById('tumblr-min-notes').value       = t.min_notes       ?? 5;
  document.getElementById('instagram-min-likes').value    = ig.min_likes      ?? 100;
  document.getElementById('mastodon-min-favorites').value = ms.min_favorites  ?? 10;
  document.getElementById('twitter-min-likes').value      = tw.min_likes      ?? 50;
  document.getElementById('twitter-rss-base').value       = tw.rss_base       ?? '';

  populateEntries('reddit',    r.subreddits);
  populateEntries('bluesky',   b.accounts);
  populateEntries('tumblr',    t.blogs);
  populateEntries('instagram', ig.accounts);
  populateEntries('mastodon',  ms.accounts);
  populateEntries('twitter',   tw.accounts);
}

async function saveSources() {
  var data = {
    reddit: {
      min_karma:  parseInt(document.getElementById('reddit-min-karma').value) || 100,
      subreddits: collectEntries('reddit'),
    },
    bluesky: {
      min_likes: parseInt(document.getElementById('bluesky-min-likes').value) || 10,
      accounts:  collectEntries('bluesky'),
    },
    tumblr: {
      min_notes: parseInt(document.getElementById('tumblr-min-notes').value) || 5,
      blogs:     collectEntries('tumblr'),
    },
    instagram: {
      min_likes: parseInt(document.getElementById('instagram-min-likes').value) || 100,
      accounts:  collectEntries('instagram'),
    },
    mastodon: {
      min_favorites: parseInt(document.getElementById('mastodon-min-favorites').value) || 10,
      accounts:      collectEntries('mastodon'),
    },
    twitter: {
      min_likes: parseInt(document.getElementById('twitter-min-likes').value) || 50,
      rss_base:  document.getElementById('twitter-rss-base').value.trim(),
      accounts:  collectEntries('twitter'),
    },
  };

  try {
    await api('POST', '/api/accounts', data);
    showToast('Sources saved');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  var data;
  try {
    data = await api('GET', '/api/settings');
  } catch (e) {
    showToast('Failed to load settings: ' + e.message, 'error');
    return;
  }

  document.getElementById('setting-data-dir').value        = data.data_dir      || 'data';
  document.getElementById('setting-schedule-time').value   = data.schedule_time  || '09:00';
  document.getElementById('setting-start-fullscreen').checked =
    (data.start_fullscreen === undefined) ? true : !!data.start_fullscreen;
}

function getSettingsFromForm() {
  return {
    data_dir:         document.getElementById('setting-data-dir').value.trim(),
    schedule_time:    document.getElementById('setting-schedule-time').value,
    start_fullscreen: document.getElementById('setting-start-fullscreen').checked,
  };
}

// ── Initialisation ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {

  // Nav buttons with data-view
  document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
    btn.onclick = function () {
      // Post usage session when leaving the home (viewer) view
      var currentView = document.querySelector('.app-view.active');
      if (currentView && currentView.id === 'view-home' && btn.dataset.view !== 'home') {
        if (typeof window._postUsageSession === 'function') window._postUsageSession();
      }

      showView(btn.dataset.view);
      if (btn.dataset.view === 'sources')  loadSources();
      if (btn.dataset.view === 'settings') loadSettings();
      if (btn.dataset.view === 'archive')  loadArchive('', '', 0, false);
      if (btn.dataset.view === 'usage')    loadUsage();
      if (btn.dataset.view === 'home')     loadPending();
    };
  });

  // Sources save
  document.getElementById('btn-save-sources').onclick = saveSources;

  // Settings save
  document.getElementById('btn-save-settings').onclick = async function () {
    try {
      await api('POST', '/api/settings', getSettingsFromForm());
      showToast('Settings saved');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // Install Task
  document.getElementById('btn-install-task').onclick = async function () {
    try {
      await api('POST', '/api/settings', getSettingsFromForm());
      await api('POST', '/api/install-task', {});
      showToast('Task installed in Windows Task Scheduler');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // Remove Task
  document.getElementById('btn-remove-task').onclick = async function () {
    try {
      await api('POST', '/api/remove-task');
      showToast('Task removed');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // Run Now (in Settings panel) — navigate to Home so progress is visible
  document.getElementById('btn-run-now').onclick = async function () {
    var btn = document.getElementById('btn-run-now');
    var origText = btn.textContent;
    btn.textContent = 'Starting\u2026';
    btn.disabled = true;
    try {
      var res = await api('POST', '/api/run-now');
      showToast(res.msg || 'Fetch started');
      // Go to Home so the user can watch the progress bar
      showView('home');
      // Show fetching panel immediately (don't wait for next poll tick)
      var fetchingEl = document.getElementById('home-fetching');
      if (fetchingEl) fetchingEl.style.display = 'flex';
      // Hide viewer-app while fetching (blobs still show behind the panel)
      var viewerAppEl = document.getElementById('viewer-app');
      if (viewerAppEl) viewerAppEl.style.display = 'none';
      document.getElementById('home-empty').style.display = 'none';
      _fetchRunning = true;
      pollFetchStatus();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  };

  // Cancel fetch button
  var cancelFetchBtn = document.getElementById('btn-cancel-fetch');
  if (cancelFetchBtn) {
    cancelFetchBtn.onclick = async function () {
      cancelFetchBtn.disabled = true;
      cancelFetchBtn.textContent = 'Stopping\u2026';
      try {
        await api('POST', '/api/cancel-fetch');
        _fetchRunning = false;
        var fetchingEl = document.getElementById('home-fetching');
        if (fetchingEl) fetchingEl.style.display = 'none';
        loadPending();
      } catch (e) {
        showToast('Could not stop fetch: ' + e.message, 'error');
      } finally {
        cancelFetchBtn.disabled = false;
        cancelFetchBtn.textContent = 'Stop';
      }
    };
  }

  // Archive page: search input with debounce
  var archiveSearchEl = document.getElementById('archive-search');
  var archiveFilterEl = document.getElementById('archive-platform-filter');
  var _archiveSearchTimer = null;

  if (archiveSearchEl) {
    archiveSearchEl.addEventListener('input', function () {
      clearTimeout(_archiveSearchTimer);
      _archiveSearchTimer = setTimeout(function () {
        loadArchive(archiveSearchEl.value, archiveFilterEl.value, 0, false);
      }, 300);
    });
  }

  if (archiveFilterEl) {
    archiveFilterEl.addEventListener('change', function () {
      loadArchive(archiveSearchEl.value, archiveFilterEl.value, 0, false);
    });
  }

  // Archive: Tab switching
  document.querySelectorAll('.archive-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.archive-tab').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      _archiveTab = btn.dataset.tab;
      _archiveOffset = 0;
      loadArchive(archiveSearchEl.value, archiveFilterEl.value, 0, false);
    });
  });

  // Archive: Load More button
  var archiveMoreBtn = document.getElementById('btn-archive-more');
  if (archiveMoreBtn) {
    archiveMoreBtn.onclick = function () {
      _archiveOffset += 50;
      loadArchive(_archiveSearch, _archivePlatform, _archiveOffset, true);
    };
  }

  // Activate home view on startup
  showView('home');

  // Load pending artifacts
  loadPending();

  // Poll for in-progress fetch
  pollFetchStatus();
  var _pollTimer = setInterval(pollFetchStatus, 5000);

  var _fastPolling = false;
  function adjustPollRate() {
    if (_fetchRunning && !_fastPolling) {
      clearInterval(_pollTimer);
      _pollTimer = setInterval(pollFetchStatus, 2000);
      _fastPolling = true;
    } else if (!_fetchRunning && _fastPolling) {
      clearInterval(_pollTimer);
      _pollTimer = setInterval(pollFetchStatus, 5000);
      _fastPolling = false;
    }
  }
  var _origPoll = pollFetchStatus;
  pollFetchStatus = async function () {
    await _origPoll();
    adjustPollRate();
  };

  // ── External links → open in default browser ─────────────────────────────
  // Intercept clicks on <a target="_blank"> and route them through pywebview's
  // Python bridge instead of letting the webview navigate internally.
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[target="_blank"]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href || href === '#') return;
    if (window.pywebview && window.pywebview.api && window.pywebview.api.open_in_browser) {
      e.preventDefault();
      window.pywebview.api.open_in_browser(href);
    }
  });
});
