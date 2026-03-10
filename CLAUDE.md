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
```

Requires Python 3.13+. Uses `uv` for package management and `ty` for type checking.

## Architecture

```
app.py              ← pywebview + uvicorn entry point
src/
  server.py         ← FastAPI routes + serves ui/ static files
  db.py             ← SQLite helpers (init_db, save_posts, get_digest, save_note)
  notify.py         ← winotify toast notification
  config.py         ← constants, load_settings(), save_settings(), load_sources()
  main.py           ← headless fetch: fetch → render HTML → save to DB → toast
  fetch.py          ← Reddit JSON API fetcher
  fetch_bluesky.py  ← Bluesky fetcher
  fetch_tumblr.py   ← Tumblr fetcher
  fetch_instagram.py← Instagram fetcher (instaloader)
  render.py         ← generate_html() → standalone HTML digest files
  schedule.py       ← is_due(), current_week_tag(), schedule_label(), state I/O
  digest.css        ← styles for standalone HTML digests (referenced by render.py)
  digest.js         ← flashcard viewer for standalone HTML digests

ui/                 ← web frontend (served by FastAPI at /static/)
  index.html        ← app shell: left nav + views + full-screen viewer overlay
  app.js            ← SPA routing, API calls (reports, accounts, settings, tasks)
  digest.js         ← flashcard viewer; initDigestViewer(posts, weekTag) function
  digest.css        ← all styles: app-shell + viewer (blob bg, cards, sidebar)

accounts.json       ← platform account lists (reddit subreddits, bluesky handles, etc.)
settings.json       ← output_dir, data_dir, schedule_day, schedule_time
data/digests.db     ← SQLite: posts table + notes table (gitignored)
output/             ← standalone HTML digests (gitignored)
```

## Data flow

```
Task Scheduler → src/main.py
  fetch posts → save to data/digests.db → write output/digest_{tag}.html → toast

User runs app.py:
  → FastAPI starts on random localhost port
  → pywebview opens Edge WebView2 window → loads http://localhost:{port}
  → sidebar lists week tags from DB
  → click a week → flashcard viewer renders posts from DB
  → edit a note → saved to DB via POST /api/reports/{tag}/notes/{post_id}
  → Settings → Install Task → schtasks registers weekly job
```

## Key source files

### `src/config.py`
- `load_settings()` / `save_settings()` — read/write `settings.json`
- `load_sources()` — parse `accounts.json` into `list[Source]`
- `OUTPUT_DIR` — resolved from `settings.json["output_dir"]` at import time

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
GET  /api/reports                → list week tags
GET  /api/reports/{tag}          → posts + notes for a week
POST /api/reports/{tag}/notes/{id} → upsert note
GET/POST /api/accounts           → accounts.json
GET/POST /api/settings           → settings.json
POST /api/install-task           → run install.py (registers schtasks)
POST /api/remove-task            → schtasks /Delete
POST /api/run-now                → run src/main.py in a background thread
```

### `ui/digest.js`
Adapted from `src/digest.js` for the app. Key differences:
- Exported as `window.initDigestViewer(posts, weekTag)` — data passed as argument, not embedded JSON
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
| `OUTPUT_DIR` | `output/` | Where standalone HTML files are written |
| `SETTINGS_PATH` | `settings.json` | App settings |
| `ACCOUNTS_PATH` | `accounts.json` | Platform account lists |
