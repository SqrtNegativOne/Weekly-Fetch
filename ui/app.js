/**
 * app.js — SPA routing and API integration for Weekly Fetch.
 *
 * Responsibilities:
 *   - Populate the report list sidebar from /api/reports
 *   - Show/hide views (home, sources, settings, about, viewer overlay)
 *   - Load a report and hand off to initDigestViewer()
 *   - Sources: load from / save to /api/accounts
 *   - Settings: load from / save to /api/settings
 *   - Task buttons: install, remove, run-now
 *   - Toast notifications for user feedback
 */

// ── Home CTA state ────────────────────────────────────────────────────────────

var _hasSources  = false;
var _hasReports  = false;
var _fetchRunning = false;

function updateHomeCta() {
  var noSrc    = document.getElementById('home-no-sources');
  var hasSrc   = document.getElementById('home-has-sources');
  var readyCta = document.getElementById('home-ready');
  var fetching = document.getElementById('home-fetching');

  // CTA area: three states based on sources + reports
  noSrc.style.display  = 'none';
  hasSrc.style.display = 'none';
  readyCta.style.display = 'none';
  if (_hasReports) {
    readyCta.style.display = 'flex';
  } else if (_hasSources) {
    hasSrc.style.display = 'flex';
  } else {
    noSrc.style.display = 'flex';
  }

  // Progress panel: visible whenever a fetch is running, overlays the bottom
  fetching.style.display = _fetchRunning ? 'flex' : 'none';
}

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
  // Fetch just finished — refresh the report list and surface any errors
  if (wasRunning && !_fetchRunning) {
    loadReports();
    showFetchErrors();
  }
  updateHomeCta();
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
    // If the endpoint itself fails, silently ignore — it's not critical
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

var VIEWS = ['home', 'sources', 'settings', 'about'];

function showView(name) {
  VIEWS.forEach(function (v) {
    var el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('active', v === name);
  });
  document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
  if (name !== 'home') {
    document.querySelectorAll('.report-item').forEach(function (el) {
      el.classList.remove('active');
    });
  }
  closeViewer();
}

// ── Report list ───────────────────────────────────────────────────────────────

function formatTag(tag) {
  // Date-based tags: "2026-03-10" → { day: "10", month: "March", year: "2026" }
  var m = tag.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    var month = months[parseInt(m[2], 10) - 1] || m[2];
    return { day: String(parseInt(m[3], 10)), month: month, year: m[1] };
  }
  // Legacy week tags: "2026-W10" → { day: "W10", month: "", year: "2026" }
  var w = tag.match(/^(\d{4})-W(\d+)$/);
  if (w) return { day: 'W' + parseInt(w[2]), month: '', year: w[1] };
  return { day: tag, month: '', year: '' };
}

async function loadReports() {
  var tags;
  try {
    tags = await api('GET', '/api/reports');
  } catch (e) {
    console.error('Failed to load reports:', e);
    return;
  }

  var listEl  = document.getElementById('report-list');
  var emptyEl = document.getElementById('report-list-empty');

  if (!tags || tags.length === 0) {
    _hasReports = false;
    updateHomeCta();
    emptyEl.style.display = '';
    return;
  }

  _hasReports = true;
  updateHomeCta();
  emptyEl.style.display = 'none';

  tags.forEach(function (tag) {
    if (listEl.querySelector('[data-tag="' + tag + '"]')) return;
    var btn = document.createElement('button');
    btn.className = 'report-item';
    btn.dataset.tag = tag;

    var info = formatTag(tag);
    if (info.year) {
      btn.innerHTML =
        '<span class="report-day">' + info.day + '</span>' +
        '<span class="report-month">' + info.month + '</span>' +
        '<span class="report-year">' + info.year + '</span>';
    } else {
      btn.textContent = tag;
    }

    btn.onclick = function () { openReport(tag, btn); };
    listEl.appendChild(btn);
  });
}

async function openReport(tag, btnEl) {
  document.querySelectorAll('.report-item').forEach(function (el) {
    el.classList.remove('active');
  });
  if (btnEl) btnEl.classList.add('active');

  showView('home');

  var posts;
  try {
    posts = await api('GET', '/api/reports/' + encodeURIComponent(tag));
  } catch (e) {
    showToast('Failed to load report: ' + e.message, 'error');
    return;
  }

  if (!posts || posts.length === 0) {
    showToast('No posts found for ' + tag, 'error');
    return;
  }

  var subMap   = {};
  var postList = [];

  posts.forEach(function (p) {
    var sub = p.subreddit || 'unknown';
    if (!subMap[sub]) subMap[sub] = { count: 0, platform: p.platform };
    subMap[sub].count++;
    postList.push(p);
  });

  var subreddits = Object.entries(subMap).map(function (entry) {
    return {
      name:     entry[0],
      platform: entry[1].platform,
      count:    entry[1].count,
      period:   '',
    };
  });

  var now = new Date();
  var generated = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');

  var allPosts = [
    {
      type:        'cover',
      title:       'Digest',
      link:        '__cover__',
      week_tag:    tag,
      generated:   generated,
      subreddits:  subreddits,
      total_posts: postList.length,
    },
    ...postList,
    { type: 'notes_summary', title: 'Your Notes', link: '__notes__' },
  ];

  openViewer(allPosts, tag);
}

// ── Viewer overlay ────────────────────────────────────────────────────────────

function openViewer(posts, weekTag) {
  var overlay = document.getElementById('viewer-overlay');
  // Cancel any in-progress close animation before opening
  overlay.classList.remove('leaving');
  overlay.classList.add('active');
  window.initDigestViewer(posts, weekTag);
}

function closeViewer() {
  var overlay = document.getElementById('viewer-overlay');
  if (!overlay.classList.contains('active')) return;
  overlay.classList.add('leaving');
  setTimeout(function () {
    overlay.classList.remove('active', 'leaving');
  }, 220);
}

window.viewerBack = function () {
  closeViewer();
  showView('home');
  updateHomeCta();
};

// ── Sources (was: Accounts) ───────────────────────────────────────────────────

// Platform config: maps platform → { listKey, thresholdKey, namePlaceholder }
var PLATFORM_CONFIG = {
  reddit:    { listKey: 'subreddits', thresholdKey: 'karma',    globalKey: 'min_karma', namePlaceholder: 'MachineLearning' },
  bluesky:   { listKey: 'accounts',   thresholdKey: 'min_likes', globalKey: 'min_likes', namePlaceholder: 'jay.bsky.social' },
  tumblr:    { listKey: 'blogs',      thresholdKey: 'min_notes', globalKey: 'min_notes', namePlaceholder: 'staff' },
  instagram: { listKey: 'accounts',   thresholdKey: 'min_likes',     globalKey: 'min_likes',     namePlaceholder: 'natgeo' },
  mastodon:  { listKey: 'accounts',   thresholdKey: 'min_favorites', globalKey: 'min_favorites', namePlaceholder: 'username@mastodon.social' },
  twitter:   { listKey: 'accounts',   thresholdKey: 'min_likes',     globalKey: 'min_likes',     namePlaceholder: 'elonmusk' },
};

var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ── Schedule data ↔ display ───────────────────────────────────────────────────
//
// Backend key names (schedule.py):
//   every_weekday  : "Saturday"   → fetch every named weekday
//   every_n_days   : N            → fetch every N days
//   day_n_of_month : N, every_n_months implied as 1  (schedule.py just checks day_n_of_month)
//
// We map these to three UI types:
//   'weekday'   → { every_weekday: "Monday" }
//   'ndays'     → { every_n_days: N }
//   'monthday'  → { day_n_of_month: N }

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

// ── Entry row builder ─────────────────────────────────────────────────────────
//
// Each row is two lines:
//   Top:    [name input ···················] [× remove]
//   Bottom: [type▼] [weekday▼ | N days | day N] [threshold field]

function createEntryRow(platform, entry) {
  var name = typeof entry === 'string' ? entry : (entry.name || '');
  var sched = typeof entry === 'object' ? entry.schedule : null;
  var cfg = PLATFORM_CONFIG[platform];

  var threshVal = '';
  if (typeof entry === 'object' && entry[cfg.thresholdKey] != null) {
    threshVal = String(entry[cfg.thresholdKey]);
  }

  var ds = scheduleToDisplay(sched);  // { type, weekday, n, day }

  // ── Outer row ──
  var row = document.createElement('div');
  row.className = 'entry-row';

  // ── Top line: name + remove ──
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

  // ── Bottom line: schedule type + params + threshold ──
  var botLine = document.createElement('div');
  botLine.className = 'entry-row-bot';

  // Schedule type selector
  var typeSelect = document.createElement('select');
  typeSelect.className = 'entry-sched-type';
  [
    { value: 'weekday',  label: 'Every' },
    { value: 'ndays',    label: 'Every … days' },
    { value: 'monthday', label: 'Day … of month' },
  ].forEach(function (opt) {
    var o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    typeSelect.appendChild(o);
  });
  typeSelect.value = ds.type;

  // Param area — changes based on type selection
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
      inp2.title = 'Day of the month (1–31)';
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

  // Threshold override
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

  _hasSources = (r.subreddits||[]).length + (b.accounts||[]).length +
                (t.blogs||[]).length + (ig.accounts||[]).length +
                (ms.accounts||[]).length + (tw.accounts||[]).length > 0;
  updateHomeCta();
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

// ── Generate report ───────────────────────────────────────────────────────────

async function generateReport() {
  var btn = document.getElementById('btn-generate');
  var label = btn.querySelector('.nav-label');
  var orig = label.textContent;
  label.textContent = 'Fetching\u2026';
  btn.disabled = true;
  try {
    var res = await api('POST', '/api/run-now');
    showToast(res.msg || 'Fetch started');
    // Polling will auto-refresh reports when the fetch finishes
    pollFetchStatus();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    label.textContent = orig;
    btn.disabled = false;
  }
}

// ── Initialisation ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {

  // Nav buttons with data-view
  document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
    btn.onclick = function () {
      showView(btn.dataset.view);
      if (btn.dataset.view === 'sources')  loadSources();
      if (btn.dataset.view === 'settings') loadSettings();
    };
  });

  // Generate report button
  document.getElementById('btn-generate').onclick = generateReport;

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

  // Run Now (in Settings panel)
  document.getElementById('btn-run-now').onclick = async function () {
    var btn = document.getElementById('btn-run-now');
    var origText = btn.textContent;
    btn.textContent = 'Running\u2026';
    btn.disabled = true;
    try {
      var res = await api('POST', '/api/run-now');
      showToast(res.msg || 'Fetch started');
      pollFetchStatus();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  };

  // Home CTA click handlers
  document.getElementById('home-no-sources').addEventListener('click', function () {
    showView('sources');
    loadSources();
  });
  // "Generate your first report" CTA — trigger a fetch
  document.getElementById('home-has-sources').addEventListener('click', generateReport);
  // "See today's Report" CTA — open the latest report
  document.getElementById('home-ready').addEventListener('click', function () {
    var first = document.querySelector('.report-item');
    if (first) first.click();
  });

  // Activate home view + highlight nav button on startup
  showView('home');

  // Initial data load
  loadReports();

  // Seed _hasSources for the home CTA without showing the Sources view
  api('GET', '/api/accounts').then(function (data) {
    var r  = data.reddit    || {};
    var b  = data.bluesky   || {};
    var t  = data.tumblr    || {};
    var ig = data.instagram || {};
    var ms = data.mastodon  || {};
    var tw = data.twitter   || {};
    _hasSources = (r.subreddits||[]).length + (b.accounts||[]).length +
                  (t.blogs||[]).length + (ig.accounts||[]).length +
                  (ms.accounts||[]).length + (tw.accounts||[]).length > 0;
    updateHomeCta();
  }).catch(function () {});

  // Poll for in-progress fetch (Task Scheduler may fire before GUI opens).
  // Poll faster (2s) while a fetch is running, slower (5s) when idle.
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
  // Hook into the existing poll cycle
  var _origPoll = pollFetchStatus;
  pollFetchStatus = async function () {
    await _origPoll();
    adjustPollRate();
  };
});
