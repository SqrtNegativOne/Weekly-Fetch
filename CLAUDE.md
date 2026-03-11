# Weekly Fetch — Project Guide for Claude

## What is this?

Weekly Fetch is a Windows desktop app (pywebview + FastAPI) that fetches top posts from Reddit, Bluesky, Tumblr, Instagram, and Mastodon on a user-defined schedule, then presents them as a distraction-free flashcard digest.

## Architecture

```
app.py            ← Entry point. Starts uvicorn in a thread, opens pywebview.
                    app.py --fetch  → headless mode used by Task Scheduler.
                    app.py --fetch --force → manual mode (skip schedule checks).
WeeklyFetch.spec  ← PyInstaller build spec → dist/WeeklyFetch/WeeklyFetch.exe
src/
  server.py       ← FastAPI app (create_app). API routes + static file serving.
  db.py           ← SQLite helpers. Database: digests.db.
  notify.py       ← winotify Windows toast notifications.
  log.py          ← Central loguru config. Import `logger` from here.
                    Sinks: weekly_fetch.log (file) + stderr (dev).
  config.py       ← BASE_DIR, BUNDLE_DIR, POST_LIMIT, Source dataclass,
                    load_settings(), save_settings(), load_sources().
  fetch/          ← Per-platform fetcher subpackage:
    reddit.py     ← fetch_subreddit(name, time_filter, progress, min_karma)
    bluesky.py    ← fetch_bluesky(name, progress, min_likes)
    tumblr.py     ← fetch_tumblr(name, progress, min_notes)
    instagram.py  ← fetch_instagram(name, progress, min_likes)
    mastodon.py   ← fetch_mastodon(name, progress, min_favorites)
  main.py         ← Headless fetch orchestrator called by Task Scheduler.
                    Uses tqdm progress bar. Writes fetch.lock while running.
                    Writes fetch_progress.json for GUI progress display.
                    Writes per-source errors to fetch_errors.json.
                    --force flag: skip is_due() checks, fetch all sources.
  schedule.py     ← is_due(), current_day_tag(), load_state(), save_state(),
                    mark_fetched(), reddit_time_filter(), elapsed_time_filter(),
                    schedule_label().
ui/               ← Single-page web frontend served by FastAPI at /static/*.
  index.html      ← App shell: custom titlebar, sidebar, views, viewer overlay.
  app.js          ← SPA routing, Sources/Settings forms, report list.
  digest.js       ← Flashcard viewer (initDigestViewer). Keyboard shortcuts.
  digest.css      ← All styles. Design-token based.
settings.json     ← { data_dir, schedule_time, start_fullscreen }
accounts.json     ← Platform source lists with per-entry schedule + threshold.
last_fetch.json   ← State: maps "platform/name" → ISO datetime of last fetch.
data/digests.db   ← SQLite (reports + notes).
fetch.lock        ← Temporary lock file present while a fetch is running.
fetch_progress.json ← Written by main.py during fetch. Read by /api/fetch-status.
                    Contains {total, done, current, done_list} for GUI progress.
.github/workflows/release.yml ← Builds .exe on v* tag push.
```

## Key facts

- **Single source of truth:** SQLite (`digests.db`). No standalone HTML files.
- **Day-based report tags:** `"2026-03-10"` — one report per fetch run.
- **BASE_DIR:** directory of the exe (frozen) or repo root (dev).
- **BUNDLE_DIR:** sys._MEIPASS (frozen) or repo root (dev) — for `ui/` assets.
- **Frameless window:** `app.py` opens pywebview with `frameless=True`.
  The custom title bar uses `-webkit-app-region: drag` (works in Edge WebView2).
  Window controls (min/max/close) call Python via `window.pywebview.api.*`.
- **venv has no pip by default** — use `python -m ensurepip` first.
- **Task Scheduler task name:** `WeeklyFetchDigest`
- **fetch.lock:** created by `main.py` at start, deleted on finish. Used by
  `/api/fetch-status` to show a "generating" indicator in the UI.
- **fetch_errors.json:** written by `main.py` when per-source errors occur.
  Read + deleted by `GET /api/fetch-errors`. GUI polls this when the lock
  disappears and shows each error as an in-app error toast.
- **weekly_fetch.log:** loguru log file in BASE_DIR. Rotates at 5 MB, 3 files kept.
  Import `logger` from `src/log.py` in any Python module. Do NOT use `print()`
  for errors — use `logger.error(...)`.
- **POST_LIMIT = 20** — max posts fetched per Reddit source.
- **`start_fullscreen`** — boolean setting; if true, window opens maximized.

## Source dataclass (src/config.py)

```python
@dataclass
class Source:
    platform:  str   # "reddit" | "bluesky" | "tumblr" | "instagram" | "mastodon"
    name:      str   # subreddit, handle, blog, username, or "handle@instance"
    schedule:  dict  # e.g. {"every_weekday": "Saturday"}
    threshold: int   # min_karma / min_likes / min_notes / min_favorites
```

`load_sources()` in `config.py` parses `accounts.json` into a flat `list[Source]`.

## Schedule format (accounts.json)

Each source entry has a `schedule` dict. `schedule.py` supports these keys:

```json
{ "every_weekday": "Saturday" }   // every named weekday
{ "every_n_days": 7 }             // every N days
{ "every_n_weeks": 2 }            // every N weeks
{ "every_n_months": 1 }           // every N months
{ "day_n_of_month": 1 }           // day N of each month
```

State (last fetch times) is stored in `last_fetch.json` as `"platform/name" → ISO datetime`.

The UI (app.js) maps the first three types to: `weekday`, `ndays`, `monthday`.

## Accounts.json platform keys

```json
{
  "reddit":   { "min_karma":     100, "subreddits": [...] },
  "bluesky":  { "min_likes":      50, "accounts":   [...] },
  "tumblr":   { "min_notes":       5, "blogs":      [...] },
  "instagram":{ "min_likes":     100, "accounts":   [...] },
  "mastodon": { "min_favorites":  10, "accounts":   [...] }
}
```

## API routes (src/server.py)

```
GET  /api/reports                → list day tags
GET  /api/reports/{tag}          → posts + notes for that day
POST /api/reports/{tag}/notes/{id} → save note text

GET/POST /api/accounts           → read/write accounts.json
GET/POST /api/settings           → read/write settings.json

POST /api/install-task           → register Windows scheduled task
POST /api/remove-task            → delete scheduled task
GET  /api/fetch-status           → { "running": bool, "progress": {...} }
GET  /api/fetch-errors           → list of error strings from last run (then clears file)
POST /api/run-now                → trigger a forced fetch (--force) in a background thread
```

## UI design tokens (digest.css)

- Surfaces: `--bg-deep`, `--bg-surface`, `--bg-elevated`, `--bg-hover`
- Text: `--text-1` through `--text-4` (4 opacity levels)
- Accent: `--accent` (#6366f1 indigo), `--accent-light`, `--accent-surface`
- Platforms: `--reddit`, `--bluesky`, `--tumblr`, `--instagram`
- Radius: `--r-sm` / `--r-md` / `--r-lg` / `--r-full`
- Title bar height: `--titlebar-h: 36px`

## Viewer keyboard shortcuts

`h`/`←` prev card · `l`/`→` next card · `j`/`↓` scroll down · `k`/`↑` scroll up
`c` toggle comments · `Ctrl+N` focus notes sidebar

## Distribution

PyInstaller via `WeeklyFetch.spec` → `dist/WeeklyFetch/WeeklyFetch.exe`.
GitHub Actions builds on `v*` tag push and creates a release with a zip.

## Running in dev

```bash
python -m ensurepip          # if venv has no pip
pip install -r requirements.txt
python app.py                # opens the pywebview window
python app.py --fetch        # headless scheduled fetch (respects is_due)
python app.py --fetch --force  # headless forced fetch (all sources)
```
