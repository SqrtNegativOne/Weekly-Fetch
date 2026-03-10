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

function formatWeekTag(tag) {
  var m = tag.match(/^(\d{4})-W(\d+)$/);
  if (m) return { week: 'Week ' + parseInt(m[2]), year: m[1] };
  return { week: tag, year: '' };
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

    var info = formatWeekTag(tag);
    if (info.year) {
      btn.innerHTML =
        '<span class="report-week">' + info.week + '</span>' +
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
      title:       'Weekly Digest',
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

function textareaToEntries(text) {
  return text.split('\n')
    .map(function (l) { return l.trim(); })
    .filter(Boolean)
    .map(function (l) {
      if (l.startsWith('{')) {
        try { return JSON.parse(l); } catch (e) { return l; }
      }
      return l;
    });
}

function entriesToTextarea(entries) {
  return entries.map(function (e) {
    return typeof e === 'string' ? e : JSON.stringify(e);
  }).join('\n');
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
  document.getElementById('reddit-subreddits').value   = entriesToTextarea(r.subreddits || []);
  document.getElementById('bluesky-min-likes').value   = b.min_likes ?? 10;
  document.getElementById('bluesky-accounts').value    = entriesToTextarea(b.accounts || []);
  document.getElementById('tumblr-min-notes').value    = t.min_notes ?? 5;
  document.getElementById('tumblr-blogs').value        = entriesToTextarea(t.blogs || []);
  document.getElementById('instagram-min-likes').value = ig.min_likes ?? 100;
  document.getElementById('instagram-accounts').value  = entriesToTextarea(ig.accounts || []);
}

async function saveAccounts() {
  var data = {
    reddit: {
      min_karma:  parseInt(document.getElementById('reddit-min-karma').value) || 100,
      subreddits: textareaToEntries(document.getElementById('reddit-subreddits').value),
    },
    bluesky: {
      min_likes: parseInt(document.getElementById('bluesky-min-likes').value) || 10,
      accounts:  textareaToEntries(document.getElementById('bluesky-accounts').value),
    },
    tumblr: {
      min_notes: parseInt(document.getElementById('tumblr-min-notes').value) || 5,
      blogs:     textareaToEntries(document.getElementById('tumblr-blogs').value),
    },
    instagram: {
      min_likes: parseInt(document.getElementById('instagram-min-likes').value) || 100,
      accounts:  textareaToEntries(document.getElementById('instagram-accounts').value),
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

  document.getElementById('setting-output-dir').value   = data.output_dir   || 'output';
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
    output_dir:    document.getElementById('setting-output-dir').value.trim(),
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
