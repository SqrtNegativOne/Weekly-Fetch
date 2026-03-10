# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project overview

A personal Windows app that fetches top posts from Reddit, Bluesky, Tumblr, and Instagram on a schedule, stores them in SQLite, and presents them in a native flashcard-style viewer (pywebview + FastAPI + Edge WebView2).

Two entry points:

| Script | Purpose |
|--------|---------|
| `app.py` | Opens the native app window. Run this to use the app. |
| `src/main.py` | Headless fetch script. Windows Task Scheduler fires this silently. |

## Setup

```bash
# Install deps and create .venv (uv handles everything)
uv sync

# Open the app
uv run python app.py

# Register the Windows scheduled task
uv run python install.py

# Type-check
uv run ty check src/ app.py install.py

# Build distributable .exe (requires dev deps)
uv sync --group dev
uv run pyinstaller WeeklyFetch.spec
# Output: dist/WeeklyFetch/WeeklyFetch.exe
```

Requires Python 3.13+. Uses `uv` for package management and `ty` for type checking.

## Distribution

PyInstaller builds a standalone `.exe` in `dist/WeeklyFetch/`. Users unzip and double-click — no Python required.

- `WeeklyFetch.exe` — opens the app window
- `WeeklyFetch.exe --fetch` — headless fetch (used by Task Scheduler)

GitHub Releases are automated: push a tag like `v1.0.0` and the workflow builds + uploads a zip.

## Architecture

```
app.py              ← pywebview + uvicorn entry point (also: app.py --fetch for headless)
WeeklyFetch.spec    ← PyInstaller build configuration
install.py          ← register Windows scheduled task
src/
  server.py         ← FastAPI routes + serves ui/ static files
  db.py             ← SQLite helpers (init_db, save_posts, get_digest, save_note)
  notify.py         ← winotify toast notification
  config.py         ← BASE_DIR, BUNDLE_DIR, load_settings(), save_settings(), load_sources()
  main.py           ← headless fetch: fetch → save to DB → toast
  fetch.py          ← Reddit JSON API fetcher
  fetch_bluesky.py  ← Bluesky fetcher
  fetch_tumblr.py   ← Tumblr fetcher
  fetch_instagram.py← Instagram fetcher (instaloader)
  schedule.py       ← is_due(), current_day_tag(), schedule_label(), state I/O

ui/                 ← web frontend (served by FastAPI at /static/)
  index.html        ← app shell: left nav + views + toast container + viewer overlay
  app.js            ← SPA routing, API calls, toast notifications
  digest.js         ← flashcard viewer; initDigestViewer(posts, weekTag) function
  digest.css        ← all styles: design tokens + app-shell + viewer

accounts.json       ← platform account lists (reddit subreddits, bluesky handles, etc.)
settings.json       ← data_dir, schedule_day, schedule_time
data/digests.db     ← SQLite: posts table + notes table (gitignored)
.github/workflows/  ← release.yml: build .exe on tag push
```

## Data flow

```
Task Scheduler → src/main.py
  fetch posts → save to data/digests.db → toast notification

User runs app.py:
  → FastAPI starts on random localhost port
  → pywebview opens Edge WebView2 window → loads http://localhost:{port}
  → sidebar lists day tags from DB
  → click a day → flashcard viewer renders posts from DB
  → edit a note → saved to DB via POST /api/reports/{tag}/notes/{post_id}
  → Settings → Install Task → schtasks registers weekly job
```

## Key source files

### `src/config.py`
- `BASE_DIR` — user data root (exe dir when frozen, repo root when source)
- `BUNDLE_DIR` — bundled assets root (`sys._MEIPASS` when frozen, repo root when source)
- `load_settings()` / `save_settings()` — read/write `settings.json`
- `load_sources()` — parse `accounts.json` into `list[Source]`

### `src/db.py` — SQLite schema
```sql
posts  (id, week_tag, platform, source_name, fetched_at, title, link UNIQUE,
        score, post_type, content_json, comments_json)
notes  (post_id, week_tag, note_text, updated_at)  PRIMARY KEY (post_id, week_tag)
```
Posts are upserted on `link` (deduplication). Notes are deleted when text is blank.

### `src/schedule.py`
- `is_due(source, state, now)` — checks fetch cadence against `last_fetch.json`
- Schedule dict keys: `every_weekday`, `every_n_days`, `every_n_weeks`, `every_n_months`, `day_n_of_month`

### `src/server.py` — API routes
```
GET  /api/reports                → list day tags
GET  /api/reports/{tag}          → posts + notes for a day
POST /api/reports/{tag}/notes/{id} → upsert note
GET/POST /api/accounts           → accounts.json
GET/POST /api/settings           → settings.json
POST /api/install-task           → run install.py (registers schtasks)
POST /api/remove-task            → schtasks /Delete
POST /api/run-now                → run src/main.py in a background thread
```

### `ui/digest.js`
Flashcard viewer for the app.
- Exported as `window.initDigestViewer(posts, weekTag)` — data passed as argument
- Notes pre-populated from `post.note` (DB), then synced to API on blur (debounced 800 ms)
- `localStorage` used as session cache; API is the durable store

### `install.py`
Reads `schedule_day`/`schedule_time` from `settings.json`. Task name: `WeeklyFetchDigest`.
Script path: `src/main.py` (relative to project root).

## Key constants (`src/config.py`)

| Constant | Default | Purpose |
|----------|---------|---------|
| `POST_LIMIT` | 20 | Max posts fetched per source |
| `MIN_KARMA` | 100 | Default minimum score threshold |
| `SETTINGS_PATH` | `settings.json` | App settings |
| `ACCOUNTS_PATH` | `accounts.json` | Platform account lists |
