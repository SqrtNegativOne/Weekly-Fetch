from datetime import datetime, timezone

import feedparser
import requests

from config import HEADERS, POST_LIMIT
from fetch.base import BaseFetcher, first_image, register, strip_html


@register
class TwitterFetcher(BaseFetcher):
    """Fetch recent tweets from a Twitter/X account via an RSS feed.

    Uses a Nitter-compatible RSS endpoint. The rss_base URL is read from
    accounts_config (accounts.json) so the caller doesn't need to pass it.

    source.threshold (min_likes) is accepted for interface consistency but
    NOT enforced — RSS feeds don't include like counts. The effective filter
    is the date window (since or 7-day default).
    """

    platform = "twitter"
    supports_threshold = False  # RSS has no like-count field

    def fetch_posts(self, source, progress, since: datetime | None,
                    *, accounts_config: dict) -> list[dict]:
        handle = source.name

        # Build the RSS URL from accounts.json rss_base
        rss_base = accounts_config.get("twitter", {}).get("rss_base", "")
        rss_url  = f"{rss_base}/{handle}/rss" if rss_base else ""

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
        cutoff = self.compute_cutoff(since)
        posts: list[dict] = []

        for entry in feed.entries:
            # ── Date filter ──────────────────────────────────────────────────
            published  = entry.get("published_parsed")
            created_at = None
            if published:
                created_at = datetime(*published[:6], tzinfo=timezone.utc)
                if created_at < cutoff:
                    continue  # RSS is chronological — no older posts follow

            # ── Title ────────────────────────────────────────────────────────
            title_raw = entry.get("title", "")
            title     = self.make_title(title_raw, fallback="[Tweet]")
            link      = entry.get("link", "")

            # ── Content: prefer full content over summary ────────────────────
            raw_html = ""
            if entry.get("content"):
                raw_html = entry["content"][0].get("value", "")
            elif entry.get("summary"):
                raw_html = entry.get("summary", "")

            img_url = first_image(raw_html)
            plain_text = strip_html(raw_html) if raw_html else ""

            if img_url:
                content_type = "image"
                content      = {"url": img_url}
                if plain_text:
                    content["text"] = plain_text
            else:
                content_type = "link"
                content      = {"url": link}

            posts.append(self.make_post(
                title=title,
                link=link,
                score=0,   # RSS has no like-count field
                content_type=content_type,
                content=content,
                author="@" + handle,
                created_at=created_at,
            ))

            if len(posts) >= POST_LIMIT:
                break

        return posts
