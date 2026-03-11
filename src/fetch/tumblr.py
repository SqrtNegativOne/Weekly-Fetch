from datetime import datetime, timezone

import feedparser
import requests

from config import HEADERS, POST_LIMIT
from fetch.base import BaseFetcher, first_image, register


@register
class TumblrFetcher(BaseFetcher):
    """Fetch recent posts from a Tumblr blog via its public RSS feed.

    Tumblr RSS doesn't include note counts, so source.threshold is accepted for
    interface consistency but only applied when note data happens to be
    available (which is rare). The effective filter is the 7-day date window.
    """

    platform = "tumblr"

    def fetch_posts(self, source, progress, since: datetime | None,
                    *, accounts_config: dict) -> list[dict]:
        blog = source.name

        if progress is not None:
            progress.set_description(f"{blog}: Tumblr RSS")

        url  = f"https://{blog}.tumblr.com/rss"
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()

        if progress is not None:
            progress.update(1)

        # feedparser parses RSS/Atom — pass the raw text so it uses our fetched content
        feed   = feedparser.parse(resp.text)
        cutoff = self.compute_cutoff(since)
        posts  = []

        for entry in feed.entries:
            # ── Date filter ──────────────────────────────────────────────────
            published = entry.get("published_parsed")
            if published:
                pub_dt = datetime(*published[:6], tzinfo=timezone.utc)
                if pub_dt < cutoff:
                    continue  # stop here — RSS is chronological, no older posts follow

            # ── Title ────────────────────────────────────────────────────────
            title_raw = entry.get("title", "")
            title     = self.make_title(title_raw, fallback="[Post]")
            link      = entry.get("link", "")

            # ── Content: prefer full content over summary ─────────────────────
            raw_html = ""
            if entry.get("content"):
                raw_html = entry["content"][0].get("value", "")
            elif entry.get("summary"):
                raw_html = entry.get("summary", "")

            img_url = first_image(raw_html)

            if img_url:
                content_type = "image"
                content      = {"url": img_url}
            else:
                content_type = "link"
                content      = {"url": link}

            posts.append(self.make_post(
                title=title,
                link=link,
                score=0,   # RSS has no note-count field
                content_type=content_type,
                content=content,
                author=blog,
            ))

            if len(posts) >= POST_LIMIT:
                break

        return posts
