"""Entry point for Weekly Fetch (headless fetch script).

Run from the project root:
    python src/main.py

This script is what Windows Task Scheduler fires on a schedule.
It fetches posts, saves to SQLite, and shows a toast notification.
"""
import sys
from datetime import datetime
from pathlib import Path

# Ensure src/ is on sys.path so bare `import config` etc. work regardless
# of which directory Python is launched from.
sys.path.insert(0, str(Path(__file__).parent))

from tqdm import tqdm

from config import BASE_DIR, POST_LIMIT, load_settings, load_sources
from db import init_db, save_posts
from fetch import fetch_subreddit
from fetch_bluesky import fetch_bluesky
from fetch_instagram import fetch_instagram
from fetch_tumblr import fetch_tumblr
from notify import notify_digest_ready
from schedule import (
    current_day_tag, is_due, load_state, mark_fetched,
    reddit_time_filter, save_state,
)


def main():
    day_tag = current_day_tag()
    now     = datetime.now()
    state   = load_state()
    sources = load_sources()

    due = [s for s in sources if is_due(s, state, now)]
    if not due:
        print("Nothing due to fetch today.")
        return

    # Progress bar budget:
    #   Reddit: (POST_LIMIT + 1) per subreddit  (1 listing req + N comment reqs)
    #   Others: 1 per source  (single API/RSS call)
    reddit_due = [s for s in due if s.platform == "reddit"]
    other_due  = [s for s in due if s.platform != "reddit"]
    total_steps = (POST_LIMIT + 1) * len(reddit_due) + len(other_due)

    bar_format = "{l_bar}{bar}| {n}/{total} [{elapsed}<{remaining}]"
    results: dict[str, list] = {}

    with tqdm(total=max(total_steps, 1), unit="req",
              bar_format=bar_format, dynamic_ncols=True) as progress:

        for source in due:
            posts: list = []
            try:
                match source.platform:
                    case "reddit":
                        tf    = reddit_time_filter(source.schedule)
                        posts = fetch_subreddit(source.name, tf, progress,
                                                min_karma=source.threshold)
                    case "bluesky":
                        posts = fetch_bluesky(source.name, progress,
                                              min_likes=source.threshold)
                    case "tumblr":
                        posts = fetch_tumblr(source.name, progress,
                                             min_notes=source.threshold)
                    case "instagram":
                        posts = fetch_instagram(source.name, progress,
                                                min_likes=source.threshold)
                    case _:
                        print(f"\n[warn] Unknown platform '{source.platform}', skipping.")
                        continue

            except Exception as exc:
                print(f"\n[{source.platform}] Error fetching {source.name}: {exc}")
                if source.platform != "reddit":
                    progress.update(1)   # keep bar moving on failure
                continue

            results[source.name] = posts
            mark_fetched(source, state, now)

    save_state(state)

    # ── Save to SQLite ────────────────────────────────────────────────────────
    settings = load_settings()
    data_dir = Path(settings["data_dir"])
    if not data_dir.is_absolute():
        data_dir = BASE_DIR / data_dir
    db_path = data_dir / "digests.db"
    init_db(db_path)
    for source in due:
        if source.name in results:
            save_posts(db_path, day_tag, source.platform, source.name,
                       results[source.name])
    print(f"Saved to DB: {db_path}")

    # ── Toast notification ────────────────────────────────────────────────────
    notify_digest_ready(day_tag)


if __name__ == "__main__":
    main()
