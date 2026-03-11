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
  var list   = document.getElementById('fetch-progress-list');
  if (!bar || !status || !list) return;

  if (!progress) {
    bar.style.width = '0%';
    status.textContent = 'Starting\u2026';
    list.innerHTML = '';
    return;
  }

  var pct = progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  bar.style.width = pct + '%';

  if (progress.current) {
    status.textContent = 'Fetching ' + progress.current +
      '  (' + progress.done + '/' + progress.total + ')';
  } else if (progress.done >= progress.total && progress.total > 0) {
    status.textContent = 'Saving\u2026';
  } else {
    status.textContent = 'Starting\u2026';
  }

  var html = '';
  (progress.done_list || []).forEach(function (src) {
    html += '<div class="fetch-done-item">\u2713 ' +
      src.replace(/</g, '&lt;') + '</div>';
  });
  list.innerHTML = html;
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

var VIEWS = ['home', 'sources', 'archive', 'settings', 'about'];

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
  var artifacts;
  try {
    artifacts = await api('GET', '/api/artifacts/pending');
  } catch (e) {
    console.error('Failed to load pending artifacts:', e);
    return;
  }

  var viewerAppEl = document.getElementById('viewer-app');
  var emptyEl     = document.getElementById('home-empty');

  if (!artifacts || artifacts.length === 0) {
    viewerAppEl.style.display = 'none';
    emptyEl.style.display = 'flex';
  } else {
    viewerAppEl.style.display = '';
    emptyEl.style.display = 'none';
    window.initDigestViewer(artifacts);
  }
}

// ── Archive page ──────────────────────────────────────────────────────────────

var _archiveOffset = 0;
var _archiveSearch = '';
var _archivePlatform = '';

async function loadArchive(search, platform, offset, append) {
  _archiveSearch   = search || '';
  _archivePlatform = platform || '';
  _archiveOffset   = offset || 0;

  var artifacts;
  try {
    var params = new URLSearchParams();
    if (_archiveSearch) params.set('search', _archiveSearch);
    if (_archivePlatform) params.set('platform', _archivePlatform);
    params.set('limit', '50');
    params.set('offset', String(_archiveOffset));
    artifacts = await api('GET', '/api/artifacts/archived?' + params.toString());
  } catch (e) {
    showToast('Failed to load archive: ' + e.message, 'error');
    return;
  }

  var listEl = document.getElementById('archive-list');
  var moreBtn = document.getElementById('btn-archive-more');

  if (!append) {
    listEl.innerHTML = '';
  }

  if (!artifacts || artifacts.length === 0) {
    if (!append) {
      listEl.innerHTML = '<div class="archive-empty">No archived artifacts found.</div>';
    }
    moreBtn.style.display = 'none';
    return;
  }

  artifacts.forEach(function (a) {
    var row = document.createElement('div');
    row.className = 'archive-item';

    var platformClass = a.platform ? 'archive-item-' + a.platform : '';
    row.classList.add(platformClass);

    var notePreview = '';
    if (a.note && a.note.trim()) {
      var preview = a.note.replace(/^•\s*/gm, '').trim();
      if (preview.length > 80) preview = preview.substring(0, 80) + '…';
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

  // Show "Load more" if we got a full page
  moreBtn.style.display = artifacts.length >= 50 ? '' : 'none';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Sources (was: Accounts) ───────────────────────────────────────────────────

var PLATFORM_CONFIG = {
  reddit:    { listKey: 'subreddits', thresholdKey: 'karma',    globalKey: 'min_karma', namePlaceholder: 'MachineLearning' },
  bluesky:   { listKey: 'accounts',   thresholdKey: 'min_likes', globalKey: 'min_likes', namePlaceholder: 'jay.bsky.social' },
  tumblr:    { listKey: 'blogs',      thresholdKey: 'min_notes', globalKey: 'min_notes', namePlaceholder: 'staff' },
  instagram: { listKey: 'accounts',   thresholdKey: 'min_likes',     globalKey: 'min_likes',     namePlaceholder: 'natgeo' },
  mastodon:  { listKey: 'accounts',   thresholdKey: 'min_favorites', globalKey: 'min_favorites', namePlaceholder: 'username@mastodon.social' },
  twitter:   { listKey: 'accounts',   thresholdKey: 'min_likes',     globalKey: 'min_likes',     namePlaceholder: 'elonmusk' },
};

var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function scheduleToDisplay(sched) {
  if (!sched) return { type: 'weekday', weekday: 'Saturday', n: 7, day: 1 };
  if (sched.every_weekday)  return { type: 'weekday',  weekday: sched.every_weekday, n: 7, day: 1 };
  if (sched.every_n_days)   return { type: 'ndays',    weekday: 'Saturday', n: sched.every_n_days, day: 1 };
  if (sched.day_n_of_month) return { type: 'monthday', weekday: 'Saturday', n: 7, day: sched.day_n_of_month };
  return { type: 'weekday', weekday: 'Saturday', n: 7, day: 1 };
}

function displayToSchedule(type, weekday, n, day) {
  if (type === 'weekday')  return { every_weekday: weekday };
  if (type === 'ndays')    return { every_n_days: Math.max(1, parseInt(n) || 1) };
  if (type === 'monthday') return { day_n_of_month: Math.max(1, Math.min(31, parseInt(day) || 1)) };
  return { every_weekday: 'Saturday' };
}

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
  row.className = 'entry-row';

  var topLine = document.createElement('div');
  topLine.className = 'entry-row-top';

  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'entry-name';
  nameInput.placeholder = cfg.namePlaceholder;
  nameInput.value = name;

  var removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'entry-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.title = 'Remove';
  removeBtn.onclick = function () { row.remove(); };

  topLine.appendChild(nameInput);
  topLine.appendChild(removeBtn);

  var botLine = document.createElement('div');
  botLine.className = 'entry-row-bot';

  var typeSelect = document.createElement('select');
  typeSelect.className = 'entry-sched-type';
  [
    { value: 'weekday',  label: 'Every' },
    { value: 'ndays',    label: 'Every \u2026 days' },
    { value: 'monthday', label: 'Day \u2026 of month' },
  ].forEach(function (opt) {
    var o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    typeSelect.appendChild(o);
  });
  typeSelect.value = ds.type;

  var paramArea = document.createElement('div');
  paramArea.className = 'entry-sched-params';

  function buildParams(type, weekday, n, day) {
    paramArea.innerHTML = '';
    if (type === 'weekday') {
      var sel = document.createElement('select');
      sel.className = 'entry-param-select';
      sel.dataset.role = 'weekday';
      WEEKDAYS.forEach(function (d) {
        var o = document.createElement('option');
        o.value = d; o.textContent = d;
        sel.appendChild(o);
      });
      sel.value = weekday || 'Saturday';
      paramArea.appendChild(sel);

    } else if (type === 'ndays') {
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = '1'; inp.max = '365';
      inp.className = 'entry-param-num';
      inp.dataset.role = 'n';
      inp.value = n || 7;
      inp.title = 'Number of days between fetches';
      var lbl = document.createElement('span');
      lbl.className = 'entry-param-label';
      lbl.textContent = 'days';
      paramArea.appendChild(inp);
      paramArea.appendChild(lbl);

    } else if (type === 'monthday') {
      var inp2 = document.createElement('input');
      inp2.type = 'number'; inp2.min = '1'; inp2.max = '31';
      inp2.className = 'entry-param-num';
      inp2.dataset.role = 'day';
      inp2.value = day || 1;
      inp2.title = 'Day of the month (1\u201331)';
      var lbl2 = document.createElement('span');
      lbl2.className = 'entry-param-label';
      lbl2.textContent = 'of every month';
      paramArea.appendChild(inp2);
      paramArea.appendChild(lbl2);
    }
  }

  buildParams(ds.type, ds.weekday, ds.n, ds.day);

  typeSelect.onchange = function () {
    var cur = getSchedParams(paramArea);
    buildParams(typeSelect.value, cur.weekday, cur.n, cur.day);
  };

  var threshWrap = document.createElement('div');
  threshWrap.className = 'entry-thresh-wrap';
  var threshLabel = document.createElement('span');
  threshLabel.className = 'entry-thresh-label';
  threshLabel.textContent = cfg.thresholdKey === 'karma'         ? 'min karma' :
                             cfg.thresholdKey === 'min_notes'     ? 'min notes' :
                             cfg.thresholdKey === 'min_favorites' ? 'min favs' : 'min likes';
  var threshInput = document.createElement('input');
  threshInput.type = 'number';
  threshInput.className = 'entry-threshold';
  threshInput.placeholder = 'default';
  threshInput.min = '0';
  threshInput.title = 'Override the global minimum for this source. Leave empty to use the global default.';
  threshInput.value = threshVal;
  threshWrap.appendChild(threshLabel);
  threshWrap.appendChild(threshInput);

  botLine.appendChild(typeSelect);
  botLine.appendChild(paramArea);
  botLine.appendChild(threshWrap);

  row.appendChild(topLine);
  row.appendChild(botLine);
  return row;
}

function getSchedParams(paramArea) {
  var weekdayEl = paramArea.querySelector('[data-role="weekday"]');
  var nEl       = paramArea.querySelector('[data-role="n"]');
  var dayEl     = paramArea.querySelector('[data-role="day"]');
  return {
    weekday: weekdayEl ? weekdayEl.value : 'Saturday',
    n:       nEl  ? parseInt(nEl.value)  || 7 : 7,
    day:     dayEl ? parseInt(dayEl.value) || 1 : 1,
  };
}

window.addEntry = function (platform) {
  var container = document.getElementById(platform + '-entries');
  container.appendChild(createEntryRow(platform, ''));
  var inputs = container.querySelectorAll('.entry-name');
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
  var rows = container.querySelectorAll('.entry-row');
  var cfg = PLATFORM_CONFIG[platform];
  var entries = [];
  rows.forEach(function (row) {
    var name = row.querySelector('.entry-name').value.trim();
    if (!name) return;

    var type = row.querySelector('.entry-sched-type').value;
    var params = getSchedParams(row.querySelector('.entry-sched-params'));
    var threshVal = row.querySelector('.entry-threshold').value.trim();

    var entry = {
      name: name,
      schedule: displayToSchedule(type, params.weekday, params.n, params.day),
    };
    if (threshVal !== '') {
      entry[cfg.thresholdKey] = parseInt(threshVal) || 0;
    }
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
      showView(btn.dataset.view);
      if (btn.dataset.view === 'sources')  loadSources();
      if (btn.dataset.view === 'settings') loadSettings();
      if (btn.dataset.view === 'archive')  loadArchive('', '', 0, false);
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
});
