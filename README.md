# Weekly Fetch

A personal Windows app that pulls top posts from Reddit, Bluesky, Tumblr, and Instagram on a schedule and lets you read them in a flashcard-style viewer.

Posts are stored in SQLite. Notes you write per-post are saved there too. The viewer runs inside a native Edge WebView2 window (no browser tab needed).

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate
python -m ensurepip   # venv ships without pip
pip install -e .

python app.py         # open the app
```

Requires Python 3.13+ and Windows (for the native window and toast notifications).

## How it works

**`app.py`** is what you run to open the app. It starts a local FastAPI server in the background and opens a native Edge WebView2 window pointing at it.

**`src/main.py`** is a headless script that Windows Task Scheduler runs silently on a schedule. It fetches posts, saves them to `data/digests.db`, writes a standalone HTML file to `output/`, and shows a Windows toast notification.

```
Task Scheduler → src/main.py → fetch → SQLite + HTML → toast notification
You → python app.py → native window → read posts, write notes
```

## Setup

### 1. Add your sources

Open the app, go to **Accounts**, and add:

- Reddit subreddits (one per line, e.g. `MachineLearning`)
- Bluesky handles, Tumblr blogs, Instagram usernames

### 2. Configure the schedule

Go to **Settings**, set the day and time, then click **Install Task**. This registers a Windows Task Scheduler job that runs `src/main.py` automatically.

You can also click **Run Now** to fetch immediately without waiting for the schedule.

### 3. Read

Click any week tag in the sidebar to open the flashcard viewer. Use arrow keys or Prev/Next to navigate. Write notes in the right sidebar — they're saved automatically to SQLite.

## File layout

```
app.py              ← open the app (run this)
install.py          ← register/update the scheduled task
src/
  main.py           ← headless fetch script (run by Task Scheduler)
  server.py         ← FastAPI backend
  db.py             ← SQLite helpers
  fetch*.py         ← platform fetchers
  render.py         ← standalone HTML generator
  schedule.py       ← fetch cadence logic
  config.py         ← settings, accounts, constants
ui/                 ← web frontend
accounts.json       ← your sources
settings.json       ← directories, schedule
data/digests.db     ← posts and notes (gitignored)
output/             ← standalone HTML digests (gitignored)
```

## Syncing across machines

Put `data/` (or wherever `data_dir` points in Settings) in a Syncthing folder. Posts and notes sync automatically. The app reads from whatever DB is there.

## Standalone HTML

Every fetch also writes `output/digest_{week}.html` — a fully self-contained file you can open in any browser, share, or archive. These don't require the app to be running.
