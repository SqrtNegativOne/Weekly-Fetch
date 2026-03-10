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


def fetch_tumblr(blog: str, progress=None, min_notes: int = 5) -> list[dict]:
    """Fetch recent posts from a Tumblr blog via its public RSS feed.

    Tumblr RSS doesn't include note counts, so `min_notes` is accepted for
    interface consistency but only applied when note data happens to be
    available (which is rare). The effective filter is the 7-day date window.
    """
    if progress is not None:
        progress.set_description(f"{blog}: Tumblr RSS")

    url  = f"https://{blog}.tumblr.com/rss"
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()

    if progress is not None:
        progress.update(1)

    # feedparser parses RSS/Atom — pass the raw text so it uses our fetched content
    feed   = feedparser.parse(resp.text)
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    posts  = []

    for entry in feed.entries:
        # ── Date filter ──────────────────────────────────────────────────────
        published = entry.get("published_parsed")
        if published:
            pub_dt = datetime(*published[:6], tzinfo=timezone.utc)
            if pub_dt < cutoff:
                continue  # stop here — RSS is chronological, no older posts follow

        # ── Title ────────────────────────────────────────────────────────────
        title_raw = entry.get("title", "")
        title     = html_mod.escape(title_raw[:120] + ("…" if len(title_raw) > 120 else ""))
        link      = entry.get("link", "")

        # ── Content: prefer full content over summary ─────────────────────────
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
            "title":    title or "[Post]",
            "link":     link,
            "score":    0,   # RSS has no note-count field
            "type":     content_type,
            "content":  content,
            "comments": [],
            "platform": "tumblr",
            "author":   blog,
        })

        if len(posts) >= POST_LIMIT:
            break

    return posts
