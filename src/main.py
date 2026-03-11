"""Entry point for Weekly Fetch (headless fetch script).

Run from the project root:
    python src/main.py

This script is what Windows Task Scheduler fires on a schedule.
It fetches posts, saves to SQLite, and shows a toast notification.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure src/ is on sys.path so bare `import config` etc. work regardless
# of which directory Python is launched from.
sys.path.insert(0, str(Path(__file__).parent))

from tqdm import tqdm

from config import BASE_DIR, POST_LIMIT, load_accounts, load_settings, load_sources
from db import init_db, save_posts
from fetch.reddit import fetch_subreddit
from fetch.bluesky import fetch_bluesky
from fetch.instagram import fetch_instagram
from fetch.mastodon import fetch_mastodon
from fetch.tumblr import fetch_tumblr
from fetch.twitter import fetch_twitter
from log import logger
from notify import notify_digest_ready
from schedule import (
    current_day_tag, elapsed_time_filter, is_due, load_state, mark_fetched,
    save_state,
)

_ERRORS_PATH = BASE_DIR / "fetch_errors.json"
_PROGRESS_PATH = BASE_DIR / "fetch_progress.json"


def _write_progress(total: int, done: int, current: str,
                    done_list: list[str]) -> None:
    """Write current fetch progress so the GUI can display it."""
    _PROGRESS_PATH.write_text(json.dumps({
        "total": total,
        "done": done,
        "current": current,
        "done_list": done_list,
    }, ensure_ascii=False), encoding="utf-8")


def _append_error(errors: list, msg: str) -> None:
    """Record a human-readable error string for the GUI to display."""
    logger.error(msg)
    errors.append(msg)


def _flush_errors(errors: list) -> None:
    """Write accumulated errors to fetch_errors.json so the GUI can show them."""
    if not errors:
        return
    # Read any pre-existing errors (e.g. from a previous partial run) and merge
    existing: list = []
    if _ERRORS_PATH.exists():
        try:
            existing = json.loads(_ERRORS_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    _ERRORS_PATH.write_text(
        json.dumps(existing + errors, ensure_ascii=False),
        encoding="utf-8",
    )


def main(force: bool = False):
    mode = "force" if force else "scheduled"
    logger.info("Fetch started (mode={})", mode)
    day_tag = current_day_tag()
    now     = datetime.now()
    state   = load_state()
    sources = load_sources()
    twitter_rss_base = load_accounts().get("twitter", {}).get("rss_base", "")

    # Write a lock file so the GUI can show a "generating" indicator.
    lock_path = BASE_DIR / "fetch.lock"
    lock_path.touch(exist_ok=True)

    if force:
        due = list(sources)             # fetch everything
        logger.info("Force mode: fetching all {} source(s)", len(due))
    else:
        due = [s for s in sources if is_due(s, state, now)]

    if not due:
        logger.info("Nothing due to fetch today.")
        lock_path.unlink(missing_ok=True)
        return

    errors: list[str] = []
    done_list: list[str] = []

    try:
        # Progress bar budget:
        #   Reddit: (POST_LIMIT + 1) per subreddit  (1 listing req + N comment reqs)
        #   Others: 1 per source  (single API/RSS call)
        reddit_due = [s for s in due if s.platform == "reddit"]
        other_due  = [s for s in due if s.platform != "reddit"]
        total_steps = (POST_LIMIT + 1) * len(reddit_due) + len(other_due)

        bar_format = "{l_bar}{bar}| {n}/{total} [{elapsed}<{remaining}]"
        results: dict[str, list] = {}
        total_sources = len(due)

        # Write initial progress
        _write_progress(total_sources, 0, "", [])

        with tqdm(total=max(total_steps, 1), unit="req",
                  bar_format=bar_format, dynamic_ncols=True) as progress:

            for source in due:
                source_label = f"{source.platform}/{source.name}"
                _write_progress(total_sources, len(done_list),
                                source_label, done_list)

                # Compute the cutoff datetime from the last fetch so
                # fetchers only return posts newer than that.
                last_str = state.get(f"{source.platform}/{source.name}")
                if last_str:
                    since = datetime.fromisoformat(last_str)
                    if since.tzinfo is None:
                        since = since.replace(tzinfo=timezone.utc)
                else:
                    since = None

                posts: list = []
                try:
                    match source.platform:
                        case "reddit":
                            tf = elapsed_time_filter(state, source, now)
                            posts = fetch_subreddit(source.name, tf, progress,
                                                    min_karma=source.threshold,
                                                    since=since)
                        case "bluesky":
                            posts = fetch_bluesky(source.name, progress,
                                                  min_likes=source.threshold,
                                                  since=since)
                        case "tumblr":
                            posts = fetch_tumblr(source.name, progress,
                                                 min_notes=source.threshold,
                                                 since=since)
                        case "instagram":
                            posts = fetch_instagram(source.name, progress,
                                                    min_likes=source.threshold,
                                                    since=since)
                        case "mastodon":
                            posts = fetch_mastodon(source.name, progress,
                                                   min_favorites=source.threshold,
                                                   since=since)
                        case "twitter":
                            rss_url = f"{twitter_rss_base}/{source.name}/rss" if twitter_rss_base else ""
                            posts = fetch_twitter(source.name, progress,
                                                  min_likes=source.threshold,
                                                  since=since, rss_url=rss_url)
                        case _:
                            _append_error(errors,
                                f"Unknown platform '{source.platform}' — skipped")
                            continue

                except Exception as exc:
                    _append_error(errors,
                        f"{source.platform}/{source.name}: {exc}")
                    if source.platform != "reddit":
                        progress.update(1)   # keep bar moving on failure
                    done_list.append(source_label)
                    continue

                results[source.name] = posts
                mark_fetched(source, state, now)
                done_list.append(source_label)

        save_state(state)

        # ── Save to SQLite ────────────────────────────────────────────────────
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
        logger.info("Saved {} source(s) to {}", len(results), db_path)

        # ── Toast notification ────────────────────────────────────────────────
        notify_digest_ready(day_tag)

    except Exception as exc:
        _append_error(errors, f"Fetch failed: {exc}")

    finally:
        _flush_errors(errors)
        _PROGRESS_PATH.unlink(missing_ok=True)
        lock_path.unlink(missing_ok=True)
        logger.info("Fetch complete ({} error(s))", len(errors))


if __name__ == "__main__":
    main(force="--force" in sys.argv)
