# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file Python script that fetches top Reddit posts via Reddit's public JSON API and writes a single combined HTML digest to `output/` per run. Subreddit lists live in external text files. Monthly subreddits are fetched automatically when a new calendar month is detected. Designed to run on a Windows schedule via `install.py`.

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

Everything lives in `main.py`:

- **`weekly.txt` / `monthly.txt`** — one subreddit name per line; loaded at import time via `load_list()`.
- **`fetch_subreddit(subreddit, time_filter)`** — hits `https://www.reddit.com/r/{sub}/top.json` (no auth, requires the `User-Agent` header to avoid 429s), filters posts by `MIN_KARMA`, returns up to `POST_LIMIT` posts. Each post dict has `title`, `link`, `score`, `type` (`text|image|video|gallery|link`), and `content` (type-specific media fields).
- **`generate_html(weekly, monthly, week_tag)`** — builds a single styled HTML page with a sticky header, TOC nav, and per-subreddit sections with embedded media cards.
- **`should_fetch_monthly()` / `update_monthly_timestamp()`** — reads/writes `last_monthly.json` to gate monthly fetches to once per calendar month.
- **`current_week_tag()`** — returns ISO week string like `2026-W08`, used in the output filename.
- Output is a single file `output/digest_{week_tag}.html`. The `output/` directory is gitignored.

`install.py` uses Windows `schtasks` to register a scheduled task — it is Windows-only and not part of the fetch logic.

## Key Constants (main.py)

| Constant | Default | Purpose |
|---|---|---|
| `POST_LIMIT` | 20 | Max posts per subreddit |
| `MIN_KARMA` | 100 | Minimum score to include a post |
| `OUTPUT_DIR` | `output/` | Where HTML files are written |
| `LAST_MONTHLY_PATH` | `last_monthly.json` | Tracks when monthly subreddits were last fetched |
