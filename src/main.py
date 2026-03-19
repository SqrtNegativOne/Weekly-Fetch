"""Entry point for Weekly Fetch (headless fetch script).

Run from the project root:
    python src/main.py

This script is what Windows Task Scheduler fires on a schedule.
It fetches posts, saves to SQLite as pending artifacts, and shows a toast notification.
"""
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Ensure src/ is on sys.path so bare `import config` etc. work regardless
# of which directory Python is launched from.
sys.path.insert(0, str(Path(__file__).parent))

from tqdm import tqdm

from config import BASE_DIR, load_accounts, load_settings, load_sources
from db import init_db, save_artifacts
# Importing each fetcher module registers it into fetch.base.FETCHERS via @register.
import fetch.reddit
import fetch.bluesky
import fetch.tumblr
import fetch.instagram
import fetch.mastodon
import fetch.twitter
from fetch.base import FETCHERS
from log import logger
from notify import notify_new_artifacts
from schedule import current_day_tag, is_due, load_state, mark_fetched, save_state, schedule_window_days

_ERRORS_PATH = BASE_DIR / "fetch_errors.json"
_PROGRESS_PATH = BASE_DIR / "fetch_progress.json"

MAX_WORKERS = 4

# ── Age-scaled threshold (Option A) ──────────────────────────────────────────
# Engagement on social platforms follows an exponential saturation curve:
#   S(t) = A · (1 − e^(−λt))
# where λ = ln(2) / half_life.  Empirically, Reddit posts accumulate ~50% of
# their final score within the first 6 hours (R²=0.98 exponential fit).
# We scale the user's threshold by the fraction of final score a post of age
# `t` is expected to have earned, so posts published late in the fetch window
# are judged fairly against posts that had more time to accumulate engagement.
_ENGAGEMENT_HALF_LIFE_HOURS = 6.0
_MIN_POST_AGE_HOURS = 4.0   # posts younger than this have too little evidence


def _passes_threshold(post: dict, threshold: int,
                      now: datetime, window_days: float) -> bool:
    """Return True if this post meets the age-scaled threshold.

    For platforms without score data (supports_threshold=False) main.py skips
    this call entirely, so we only see posts with meaningful scores here.
    """
    if threshold <= 0:
        return True

    score      = post.get("score", 0)
    created_at = post.get("created_at")

    if created_at is None:
        # No timestamp available — fall back to raw score comparison.
        return score >= threshold

    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    age_hours = (now - created_at).total_seconds() / 3600

    if age_hours < _MIN_POST_AGE_HOURS:
        return False    # too new — insufficient evidence; B will catch it next run

    lam          = math.log(2) / _ENGAGEMENT_HALF_LIFE_HOURS
    window_hours = window_days * 24
    saturation   = (1 - math.exp(-lam * age_hours)) / (1 - math.exp(-lam * window_hours))
    saturation   = min(saturation, 1.0)  # cap for posts older than the window

    return score >= threshold * saturation


def _write_progress(total: int, done: int,
                    sources_status: list[dict]) -> None:
    """Write current fetch progress so the GUI can display it."""
    _PROGRESS_PATH.write_text(json.dumps({
        "pid": os.getpid(),
        "total": total,
        "done": done,
        "sources": sources_status,
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

    # Write an initial progress entry immediately so the GUI shows the panel.
    _write_progress(0, 0, [])

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

    try:
        # Progress bar budget — each fetcher knows how many ticks it needs.
        # RedditFetcher.progress_steps = POST_LIMIT + 1; others = 1.
        total_steps = sum(
            FETCHERS[s.platform].progress_steps
            for s in due
            if s.platform in FETCHERS
        )

        bar_format = "{l_bar}{bar}| {n}/{total} [{elapsed}<{remaining}]"
        results: dict[str, list] = {}
        total_sources = len(due)

        # Build per-source status list for the GUI progress matrix.
        # Each entry tracks its label, platform, and status.
        sources_status: list[dict] = []
        jobs: list[tuple] = []          # (index, source, fetcher, since)

        accounts = load_accounts()

        for i, source in enumerate(due):
            label = f"{source.platform}/{source.name}"
            fetcher = FETCHERS.get(source.platform)

            if fetcher is None:
                _append_error(errors,
                    f"Unknown platform '{source.platform}' — skipped")
                sources_status.append({"label": label,
                    "platform": source.platform, "status": "error"})
                continue

            # Compute the cutoff datetime from the last fetch.
            # Option B: extend the look-back by one full fetch window so posts
            # that narrowly missed the threshold last time are re-evaluated
            # with their now-higher score.  INSERT OR IGNORE deduplicates
            # anything already stored.
            window_days = schedule_window_days(source.schedule)
            if force:
                since = None
            else:
                last_str = state.get(f"{source.platform}/{source.name}")
                if last_str:
                    since = datetime.fromisoformat(last_str)
                    if since.tzinfo is None:
                        since = since.replace(tzinfo=timezone.utc)
                    since -= timedelta(days=window_days)   # B: extend look-back
                else:
                    since = None

            sources_status.append({"label": label,
                "platform": source.platform, "status": "pending"})
            jobs.append((len(sources_status) - 1, source, fetcher, since, window_days))

        done_count = sum(1 for s in sources_status if s["status"] == "error")
        _write_progress(total_sources, done_count, sources_status)

        # ── Fan-out: submit all jobs to the thread pool ──────────────────
        now_utc = datetime.now(timezone.utc)

        with tqdm(total=max(total_steps, 1), unit="req",
                  bar_format=bar_format, dynamic_ncols=True) as progress:

            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                futures = {}
                for idx, source, fetcher, since, window_days in jobs:
                    sources_status[idx]["status"] = "fetching"
                    future = pool.submit(
                        fetcher.fetch_posts, source, progress, since,
                        accounts_config=accounts)
                    futures[future] = (idx, source, fetcher, window_days)

                _write_progress(total_sources, done_count, sources_status)

                # ── Fan-in: collect results as they arrive ───────────────
                for future in as_completed(futures):
                    idx, source, fetcher, window_days = futures[future]
                    try:
                        posts = future.result()
                        # Option A: age-scaled threshold filter (skipped for
                        # platforms that don't expose meaningful scores).
                        if fetcher.supports_threshold:
                            posts = [
                                p for p in posts
                                if _passes_threshold(
                                    p, source.threshold, now_utc, window_days)
                            ]
                        results[source.name] = posts
                        mark_fetched(source, state, now)
                        sources_status[idx]["status"] = "done"
                    except Exception as exc:
                        _append_error(errors,
                            f"{source.platform}/{source.name}: {exc}")
                        if fetcher.progress_steps == 1:
                            progress.update(1)
                        sources_status[idx]["status"] = "error"

                    done_count = sum(1 for s in sources_status
                                     if s["status"] in ("done", "error"))
                    _write_progress(total_sources, done_count, sources_status)

        save_state(state)

        # ── Save to SQLite ────────────────────────────────────────────────────
        settings = load_settings()
        data_dir = Path(settings["data_dir"])
        if not data_dir.is_absolute():
            data_dir = BASE_DIR / data_dir
        db_path = data_dir / "digests.db"
        init_db(db_path)

        total_new = 0
        for source in due:
            if source.name in results:
                total_new += save_artifacts(
                    db_path, source.platform, source.name,
                    results[source.name])
        logger.info("Saved {} source(s), {} new artifact(s) to {}",
                     len(results), total_new, db_path)

        # ── Toast notification ────────────────────────────────────────────────
        if total_new > 0:
            notify_new_artifacts(total_new)

    except Exception as exc:
        _append_error(errors, f"Fetch failed: {exc}")

    finally:
        _flush_errors(errors)
        _PROGRESS_PATH.unlink(missing_ok=True)
        logger.info("Fetch complete ({} error(s))", len(errors))


if __name__ == "__main__":
    main(force="--force" in sys.argv)
