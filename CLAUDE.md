# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Python script that fetches top Reddit posts via Reddit's public JSON API and writes a single combined HTML digest to `output/` per run. Subreddit lists live in external text files. Monthly subreddits are fetched automatically when a new calendar month is detected. Designed to run on a Windows schedule via `install.py`.

## Commands

```bash
# Install dependencies (requires Python 3.13+)
python -m venv .venv
.venv/Scripts/activate
pip install -e .

# Run the fetcher
python main.py

# Register the Windows Task Scheduler task (runs main.py every Saturday at 09:00)
python install.py
```

There are no tests or linting configuration in this project.

## Architecture

Entry point is `main.py`. Logic is split across `src/`:

- **`weekly.txt` / `monthly.txt`** — one subreddit name per line; loaded at import time via `load_list()` in `src/config.py`.
- **`src/fetch.py`** — `fetch_subreddit(subreddit, time_filter, progress)` hits `https://www.reddit.com/r/{sub}/top.json` (no auth, requires the `User-Agent` header to avoid 429s), fetches top comments per post, filters by `MIN_KARMA`, returns up to `POST_LIMIT` posts. Each post dict has `title`, `link`, `score`, `type` (`text|image|video|gallery|link`), `content` (type-specific media fields), and `comments` (nested thread).
- **`src/render.py`** — `generate_html(weekly, monthly, week_tag)` embeds all posts as a JSON blob into the HTML shell. The shell references `src/digest.css` and `src/digest.js`.
- **`src/schedule.py`** — `should_fetch_monthly()` / `update_monthly_timestamp()` read/write `last_monthly.json` to gate monthly fetches to once per calendar month. `current_week_tag()` returns ISO week string like `2026-W08`.
- **`src/digest.css`** — all styles for the viewer UI.
- **`src/digest.js`** — all client-side logic: card rendering, navigation, background palette transitions (CSS `transition` on `.blob`), notes sidebar, keyboard shortcuts.
- Output is a single file `output/digest_{week_tag}.html`. The `output/` directory is gitignored.

`install.py` uses Windows `schtasks` to register a scheduled task — it is Windows-only and not part of the fetch logic.

## Viewer UI features

- Flashcard-style navigation (arrow keys or Prev/Next buttons) through all posts.
- Animated blob background that smoothly cross-fades colours per subreddit (CSS `transition`, not JS animation).
- Cover card shows week tag, post count, subreddit chips, estimated reading time (~200 wpm), and keyboard shortcut hints.
- Post card shows title + score badge + media content. No subreddit meta line on individual cards (visible via the tab bar instead).
- Comments rendered in a **separate sibling card** (`#card-comments`) below the post card, shown only when comments exist.
- Notes sidebar auto-saves per post to `localStorage`. Notes summary card at the end.

## Key Constants (src/config.py)

| Constant | Default | Purpose |
|---|---|---|
| `POST_LIMIT` | 20 | Max posts per subreddit |
| `MIN_KARMA` | 100 | Minimum score to include a post |
| `OUTPUT_DIR` | `output/` | Where HTML files are written |
| `LAST_MONTHLY_PATH` | `last_monthly.json` | Tracks when monthly subreddits were last fetched |
