import html
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests

from config import HEADERS, POST_LIMIT
from fetch.base import BaseFetcher, register
from log import logger


# ── Module-level helpers (used internally by RedditFetcher) ───────────────────

# How many comment-fetch threads to run in parallel per subreddit.
# Keeps us under Reddit's rate limits while still being ~4x faster.
_COMMENT_WORKERS = 4

def parse_comment(child: dict, depth_remaining: int) -> dict | None:
    """Recursively parse a single Reddit comment child dict.

    Returns None for 'more' placeholders (load-more buttons) so callers can
    filter them out easily.  Only goes `depth_remaining` levels deep so we
    don't explode for deeply-nested threads.
    """
    if child.get("kind") == "more":
        return None

    data = child.get("data", {})

    # Collect up to 5 direct replies at each level
    replies_raw = (
        data.get("replies", {}) or {}
    )
    reply_children = (
        replies_raw.get("data", {}).get("children", [])
        if isinstance(replies_raw, dict)
        else []
    )

    replies = []
    if depth_remaining > 0:
        for rc in reply_children[:5]:
            parsed = parse_comment(rc, depth_remaining - 1)
            if parsed is not None:
                replies.append(parsed)

    return {
        "author":  data.get("author", "[deleted]"),
        "score":   data.get("score", 0),
        "body":    data.get("body", ""),
        "replies": replies,
    }


def fetch_comments(subreddit: str, post_id: str) -> list[dict]:
    """Fetch top 10 comments for a post, up to 3 levels deep."""
    url = f"https://www.reddit.com/r/{subreddit}/comments/{post_id}.json"
    params = {"sort": "top", "limit": 10, "depth": 4}

    resp = requests.get(url, headers=HEADERS, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    # data[1] is the comments listing; data[0] is the post (we skip it)
    comment_children = data[1]["data"]["children"]

    comments = []
    for child in comment_children:
        parsed = parse_comment(child, depth_remaining=2)  # top + 2 reply levels
        if parsed is not None:
            comments.append(parsed)

    return comments


def _fetch_comments_with_delay(subreddit: str, post_id: str) -> list[dict]:
    """Fetch comments for one post with a polite delay.

    Each thread sleeps 1 second before its request.  With _COMMENT_WORKERS
    threads, this staggers requests to ~_COMMENT_WORKERS per second — fast
    enough to be a big improvement, polite enough to avoid Reddit rate-limits.
    """
    time.sleep(1)
    return fetch_comments(subreddit, post_id)


# ── Fetcher class ─────────────────────────────────────────────────────────────

@register
class RedditFetcher(BaseFetcher):
    """Fetch top posts from a subreddit using the public Reddit JSON API.

    Reddit requires (POST_LIMIT + 1) progress steps per source:
      1 step  — the top-posts listing request
      N steps — one per post, to fetch its comments

    Comment fetching is parallelised with a small thread pool (_COMMENT_WORKERS
    threads) so it completes ~4x faster than the old sequential approach.
    """

    platform       = "reddit"
    progress_steps = POST_LIMIT + 1   # 1 listing + POST_LIMIT comment fetches

    def _time_filter_from_since(self, since: datetime | None) -> str:
        """Map elapsed time since last fetch to a Reddit time_filter string.

        Reddit's /top endpoint accepts: hour, day, week, month, year, all.
        We pick the smallest window that covers the gap since the last fetch
        so we don't retrieve more posts than necessary.
        """
        if since is None:
            return "month"
        days = (datetime.now(timezone.utc) - since).days
        if days <= 1:
            return "day"
        if days <= 7:
            return "week"
        if days <= 31:
            return "month"
        return "year"

    def fetch_posts(self, source, progress, since: datetime | None,
                    *, accounts_config: dict) -> list[dict]:
        subreddit = source.name
        time_filter = self._time_filter_from_since(since)

        if progress is not None:
            progress.set_description(f"r/{subreddit}: fetching top posts")

        url = f"https://www.reddit.com/r/{subreddit}/top.json"
        params = {"t": time_filter, "limit": 100}

        resp = requests.get(url, headers=HEADERS, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        if progress is not None:
            progress.update(1)

        # ── Phase 1: Build post data (no network I/O) ─────────────────────
        # Collect qualifying posts and their IDs so we can batch-fetch
        # comments in parallel in phase 2.
        post_data: list[dict] = []   # each entry has post fields + "post_id"

        for child in data["data"]["children"]:
            post = child["data"]

            # Skip posts older than the last fetch (since is extended by B in main.py)
            created_utc = post.get("created_utc", 0)
            created_at  = datetime.fromtimestamp(created_utc, tz=timezone.utc) if created_utc else None
            if since is not None and created_at is not None and created_at < since:
                continue

            # title is HTML-escaped so it's safe to inject into innerHTML via JS
            title = html.escape(post.get("title", ""))
            link  = f"https://www.reddit.com{post.get('permalink', '')}"
            score = post.get("score", 0)

            post_hint  = post.get("post_hint", "")
            is_self    = post.get("is_self", False)
            is_gallery = post.get("is_gallery", False)

            selftext = post.get("selftext", "").strip()

            if is_self:
                # Keep raw markdown — client-side marked.js will render it
                content_type = "text"
                content = {"text": selftext}

            elif is_gallery:
                media_meta = post.get("media_metadata", {})
                first_id   = next(iter(media_meta), None)
                img_url    = ""
                if first_id:
                    img_url = html.unescape(
                        media_meta[first_id].get("s", {}).get("u", "")
                    )
                content_type = "gallery"
                content = {"url": img_url}

            elif post_hint == "image":
                images  = post.get("preview", {}).get("images", [{}])
                img_url = html.unescape(images[0].get("source", {}).get("url", ""))
                if not img_url:
                    img_url = post.get("url", "")
                content_type = "image"
                content = {"url": img_url}

            elif post_hint == "hosted:video":
                video_url = (
                    post.get("media", {})
                        .get("reddit_video", {})
                        .get("fallback_url", "")
                )
                content_type = "video"
                content = {"url": video_url}

            else:
                content_type = "link"
                content = {"url": post.get("url", "")}

            # Non-self posts can still have body text — include it
            if not is_self and selftext:
                content["text"] = selftext

            post_data.append({
                "post_id":      post.get("id", ""),
                "title":        title,
                "link":         link,
                "score":        score,
                "content_type": content_type,
                "content":      content,
                "created_at":   created_at,
            })

            if len(post_data) >= POST_LIMIT:
                break

        # ── Phase 2: Fetch comments in parallel ──────────────────────────
        # Use a small thread pool so multiple comment pages load at once.
        # Each worker sleeps 1s before its request (see _fetch_comments_with_delay)
        # so with 4 workers we make ~4 req/s — respectful enough for Reddit's
        # public API and ~4x faster than the old sequential loop.
        comment_map: dict[str, list[dict]] = {}  # post_id → comments

        if progress is not None:
            progress.set_description(f"r/{subreddit}: fetching comments ({len(post_data)} posts)")

        with ThreadPoolExecutor(max_workers=_COMMENT_WORKERS) as pool:
            futures = {
                pool.submit(_fetch_comments_with_delay, subreddit, pd["post_id"]): pd["post_id"]
                for pd in post_data
            }

            for future in as_completed(futures):
                pid = futures[future]
                try:
                    comment_map[pid] = future.result()
                except Exception:
                    logger.debug("r/{}: failed to fetch comments for post {}", subreddit, pid)
                    comment_map[pid] = []

                if progress is not None:
                    progress.update(1)

        # ── Phase 3: Assemble final post list (preserves original order) ──
        posts = []
        for pd in post_data:
            posts.append(self.make_post(
                title=pd["title"],
                link=pd["link"],
                score=pd["score"],
                content_type=pd["content_type"],
                content=pd["content"],
                author="",
                comments=comment_map.get(pd["post_id"], []),
                created_at=pd["created_at"],
            ))

        return posts
