/**
 * app.js — SPA routing and API integration for Weekly Fetch.
 *
 * Responsibilities:
 *   - Populate the report list sidebar from /api/reports
 *   - Show/hide views (home, accounts, settings, viewer overlay)
 *   - Load a report and hand off to initDigestViewer()
 *   - Accounts: load from / save to /api/accounts
 *   - Settings: load from / save to /api/settings
 *   - Task buttons: install, remove, run-now
 *   - Toast notifications for user feedback
 */

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

var VIEWS = ['home', 'accounts', 'settings'];

function showView(name) {
  VIEWS.forEach(function (v) {
    var el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('active', v === name);
  });
  document.querySelectorAll('.nav-btn').forEach(function (btn) {
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
  // Date-based tags: "2026-03-10" → { label: "Mar 10", year: "2026" }
  var m = tag.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var month = months[parseInt(m[2], 10) - 1] || m[2];
    return { label: month + ' ' + parseInt(m[3], 10), year: m[1] };
  }
  // Legacy week tags: "2026-W10" → { label: "Week 10", year: "2026" }
  var w = tag.match(/^(\d{4})-W(\d+)$/);
  if (w) return { label: 'Week ' + parseInt(w[2]), year: w[1] };
  return { label: tag, year: '' };
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
    emptyEl.style.display = '';
    return;
  }

  emptyEl.style.display = 'none';

  tags.forEach(function (tag) {
    if (listEl.querySelector('[data-tag="' + tag + '"]')) return;
    var btn = document.createElement('button');
    btn.className = 'report-item';
    btn.dataset.tag = tag;

    var info = formatTag(tag);
    if (info.year) {
      btn.innerHTML =
        '<span class="report-week">' + info.label + '</span>' +
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
  document.getElementById('view-home').querySelector('.home-subtitle').textContent =
    'Loading ' + tag + '\u2026';

  var posts;
  try {
    posts = await api('GET', '/api/reports/' + encodeURIComponent(tag));
  } catch (e) {
    document.getElementById('view-home').querySelector('.home-subtitle').textContent =
      'Failed to load report: ' + e.message;
    return;
  }

  if (!posts || posts.length === 0) {
    document.getElementById('view-home').querySelector('.home-subtitle').textContent =
      'No posts found for ' + tag + '.';
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
  document.getElementById('viewer-overlay').classList.add('active');
  window.initDigestViewer(posts, weekTag);
}

function closeViewer() {
  document.getElementById('viewer-overlay').classList.remove('active');
}

window.viewerBack = function () {
  closeViewer();
  document.getElementById('view-home').querySelector('.home-subtitle').textContent =
    'Select a report from the sidebar,\nor go to Settings to run a fetch.';
  showView('home');
};

// ── Accounts ──────────────────────────────────────────────────────────────────

// Platform config: maps platform → { listKey, thresholdKey, namePlaceholder }
var PLATFORM_CONFIG = {
  reddit:    { listKey: 'subreddits', thresholdKey: 'karma',    globalKey: 'min_karma', namePlaceholder: 'MachineLearning' },
  bluesky:   { listKey: 'accounts',   thresholdKey: 'min_likes', globalKey: 'min_likes', namePlaceholder: 'jay.bsky.social' },
  tumblr:    { listKey: 'blogs',      thresholdKey: 'min_notes', globalKey: 'min_notes', namePlaceholder: 'staff' },
  instagram: { listKey: 'accounts',   thresholdKey: 'min_likes', globalKey: 'min_likes', namePlaceholder: 'natgeo' },
};

// Schedule presets the user can pick from
var SCHEDULE_OPTIONS = [
  { label: 'Every Saturday',   value: { every_weekday: 'Saturday' } },
  { label: 'Every Sunday',     value: { every_weekday: 'Sunday' } },
  { label: 'Every Monday',     value: { every_weekday: 'Monday' } },
  { label: 'Every Tuesday',    value: { every_weekday: 'Tuesday' } },
  { label: 'Every Wednesday',  value: { every_weekday: 'Wednesday' } },
  { label: 'Every Thursday',   value: { every_weekday: 'Thursday' } },
  { label: 'Every Friday',     value: { every_weekday: 'Friday' } },
  { label: 'Daily',            value: { every_n_days: 1 } },
  { label: 'Every 3 days',     value: { every_n_days: 3 } },
  { label: 'Weekly',           value: { every_n_weeks: 1 } },
  { label: 'Every 2 weeks',    value: { every_n_weeks: 2 } },
  { label: 'Monthly',          value: { every_n_months: 1 } },
];

function scheduleToIndex(sched) {
  if (!sched) return 0;
  for (var i = 0; i < SCHEDULE_OPTIONS.length; i++) {
    var opt = SCHEDULE_OPTIONS[i].value;
    var keys = Object.keys(opt);
    if (keys.length === 1 && keys[0] in sched && sched[keys[0]] === opt[keys[0]]) return i;
  }
  return 0;
}

function createEntryRow(platform, entry) {
  // entry can be a string (legacy: just a name) or an object { name, schedule, <threshold> }
  var name = typeof entry === 'string' ? entry : (entry.name || '');
  var schedule = typeof entry === 'object' ? entry.schedule : null;
  var cfg = PLATFORM_CONFIG[platform];
  var threshold = '';
  if (typeof entry === 'object' && entry[cfg.thresholdKey] != null) {
    threshold = String(entry[cfg.thresholdKey]);
  }

  var row = document.createElement('div');
  row.className = 'entry-row';

  // Name input
  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'entry-name';
  nameInput.placeholder = cfg.namePlaceholder;
  nameInput.value = name;

  // Schedule dropdown
  var schedSelect = document.createElement('select');
  schedSelect.className = 'entry-schedule';
  SCHEDULE_OPTIONS.forEach(function (opt, i) {
    var option = document.createElement('option');
    option.value = i;
    option.textContent = opt.label;
    schedSelect.appendChild(option);
  });
  schedSelect.value = scheduleToIndex(schedule);

  // Local threshold override (optional)
  var threshInput = document.createElement('input');
  threshInput.type = 'number';
  threshInput.className = 'entry-threshold';
  threshInput.placeholder = 'default';
  threshInput.min = '0';
  threshInput.title = 'Local threshold override (leave empty to use global)';
  threshInput.value = threshold;

  // Remove button
  var removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'entry-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.title = 'Remove';
  removeBtn.onclick = function () { row.remove(); };

  row.appendChild(nameInput);
  row.appendChild(schedSelect);
  row.appendChild(threshInput);
  row.appendChild(removeBtn);

  return row;
}

window.addEntry = function (platform) {
  var container = document.getElementById(platform + '-entries');
  container.appendChild(createEntryRow(platform, ''));
  // Focus the new name input
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
    var schedIdx = parseInt(row.querySelector('.entry-schedule').value) || 0;
    var threshVal = row.querySelector('.entry-threshold').value.trim();
    var entry = {
      name: name,
      schedule: SCHEDULE_OPTIONS[schedIdx].value,
    };
    if (threshVal !== '') {
      entry[cfg.thresholdKey] = parseInt(threshVal) || 0;
    }
    entries.push(entry);
  });
  return entries;
}

async function loadAccounts() {
  var data;
  try {
    data = await api('GET', '/api/accounts');
  } catch (e) {
    showToast('Failed to load accounts: ' + e.message, 'error');
    return;
  }

  var r  = data.reddit    || {};
  var b  = data.bluesky   || {};
  var t  = data.tumblr    || {};
  var ig = data.instagram || {};

  document.getElementById('reddit-min-karma').value    = r.min_karma ?? 100;
  document.getElementById('bluesky-min-likes').value   = b.min_likes ?? 10;
  document.getElementById('tumblr-min-notes').value    = t.min_notes ?? 5;
  document.getElementById('instagram-min-likes').value = ig.min_likes ?? 100;

  populateEntries('reddit',    r.subreddits);
  populateEntries('bluesky',   b.accounts);
  populateEntries('tumblr',    t.blogs);
  populateEntries('instagram', ig.accounts);
}

async function saveAccounts() {
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
  };

  try {
    await api('POST', '/api/accounts', data);
    showToast('Accounts saved');
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

  document.getElementById('setting-data-dir').value     = data.data_dir     || 'data';
  document.getElementById('setting-schedule-time').value = data.schedule_time || '09:00';

  var daySelect = document.getElementById('setting-schedule-day');
  for (var i = 0; i < daySelect.options.length; i++) {
    if (daySelect.options[i].value === data.schedule_day) {
      daySelect.options[i].selected = true;
      break;
    }
  }
}

function getSettingsFromForm() {
  return {
    data_dir:      document.getElementById('setting-data-dir').value.trim(),
    schedule_day:  document.getElementById('setting-schedule-day').value,
    schedule_time: document.getElementById('setting-schedule-time').value,
  };
}

// ── Initialisation ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {

  // Nav buttons
  document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
    btn.onclick = function () {
      showView(btn.dataset.view);
      if (btn.dataset.view === 'accounts') loadAccounts();
      if (btn.dataset.view === 'settings') loadSettings();
    };
  });

  // Accounts save
  document.getElementById('btn-save-accounts').onclick = saveAccounts;

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

  // Run Now — with loading state
  document.getElementById('btn-run-now').onclick = async function () {
    var btn = document.getElementById('btn-run-now');
    var origText = btn.textContent;
    btn.textContent = 'Running\u2026';
    btn.disabled = true;
    try {
      var res = await api('POST', '/api/run-now');
      showToast(res.msg || 'Fetch started');
      setTimeout(loadReports, 30000);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  };

  // Viewer back button
  document.getElementById('viewer-back').onclick = window.viewerBack;

  // Initial data load
  loadReports();
});
