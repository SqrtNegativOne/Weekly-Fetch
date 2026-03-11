import html as html_mod
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

import feedparser
import requests

from config import HEADERS, POST_LIMIT


class _FirstImageExtractor(HTMLParser):
    """Walks an HTML string and captures the src of the very first <img>."""

    def __init__(self):
        super().__init__()
        self.url = ""

    def handle_starttag(self, tag, attrs):
        if tag == "img" and not self.url:
            for name, val in attrs:
                if name == "src" and val:
                    self.url = val
                    break


def _first_image(html_text: str) -> str:
    """Return the URL of the first image in an HTML fragment, or ''."""
    extractor = _FirstImageExtractor()
    extractor.feed(html_text)
    return extractor.url


def fetch_twitter(handle: str, progress=None, min_likes: int = 50,
                  since: datetime | None = None,
                  rss_url: str = "") -> list[dict]:
    """Fetch recent tweets from a Twitter/X account via an RSS feed.

    Uses a Nitter-compatible RSS endpoint.  The caller builds the full URL
    from the configured ``rss_base`` template; this function just receives it.

    ``min_likes`` is accepted for interface consistency but **not enforced**
    — RSS feeds don't include like counts.  The effective filter is the
    date window (``since`` or 7-day default).
    """
    if not rss_url:
        if progress is not None:
            progress.update(1)
        raise RuntimeError(
            f"twitter/{handle}: no rss_base configured in accounts.json — "
            "set it to a Nitter instance URL (e.g. https://nitter.privacydev.net)"
        )

    if progress is not None:
        progress.set_description(f"@{handle}: Twitter RSS")

    resp = requests.get(rss_url, headers=HEADERS, timeout=15)
    resp.raise_for_status()

    if progress is not None:
        progress.update(1)

    feed   = feedparser.parse(resp.text)
    cutoff = since if since is not None else (datetime.now(timezone.utc) - timedelta(days=7))
    posts: list[dict] = []

    for entry in feed.entries:
        # ── Date filter ──────────────────────────────────────────────────────
        published = entry.get("published_parsed")
        if published:
            pub_dt = datetime(*published[:6], tzinfo=timezone.utc)
            if pub_dt < cutoff:
                continue  # RSS is chronological — no older posts follow

        # ── Title ────────────────────────────────────────────────────────────
        title_raw = entry.get("title", "")
        title     = html_mod.escape(title_raw[:120] + ("…" if len(title_raw) > 120 else ""))
        link      = entry.get("link", "")

        # ── Content: prefer full content over summary ────────────────────────
        raw_html = ""
        if entry.get("content"):
            raw_html = entry["content"][0].get("value", "")
        elif entry.get("summary"):
            raw_html = entry.get("summary", "")

        img_url = _first_image(raw_html)

        if img_url:
            content_type = "image"
            content      = {"url": img_url}
        else:
            content_type = "link"
            content      = {"url": link}

        posts.append({
            "title":    title or "[Tweet]",
            "link":     link,
            "score":    0,   # RSS has no like-count field
            "type":     content_type,
            "content":  content,
            "comments": [],
            "platform": "twitter",
            "author":   "@" + handle,
        })

        if len(posts) >= POST_LIMIT:
            break

    return posts
