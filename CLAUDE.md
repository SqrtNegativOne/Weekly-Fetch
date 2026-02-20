# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file Python script that fetches top Reddit posts via Reddit's public JSON API and writes per-subreddit HTML digests to `output/`. Designed to run on a Windows schedule via `install.py`.

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

- **`WEEKLY_SUBREDDITS` / `MONTHLY_SUBREDDITS`** — two lists of subreddits defined at the top. Currently only `WEEKLY_SUBREDDITS` is processed in `main()`; `MONTHLY_SUBREDDITS` is defined but not yet wired in.
- **`fetch_subreddit(subreddit)`** — hits `https://www.reddit.com/r/{sub}/top.json` (no auth, requires the `User-Agent` header to avoid 429s), filters posts by `MIN_KARMA`, returns up to `POST_LIMIT` posts.
- **`generate_html(subreddit, posts, week_tag)`** — builds a minimal HTML page listing post titles as links with scores.
- **`current_week_tag()`** — returns ISO week string like `2026-W08`, used in output filenames.
- Output files are written as `output/{subreddit}_{week_tag}.html`. The `output/` directory is gitignored.

`install.py` uses Windows `schtasks` to register a scheduled task — it is Windows-only and not part of the fetch logic.

## Key Constants (main.py)

| Constant | Default | Purpose |
|---|---|---|
| `POST_LIMIT` | 20 | Max posts per subreddit |
| `MIN_KARMA` | 100 | Minimum score to include a post |
| `OUTPUT_DIR` | `output/` | Where HTML files are written |
