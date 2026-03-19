from datetime import datetime

import requests

from config import HEADERS, POST_LIMIT
from fetch.base import BaseFetcher, register, strip_html
from log import logger


@register
class MastodonFetcher(BaseFetcher):
    """Fetch recent posts from a Mastodon account using the public API.

    Handle format: ``username@instance.social`` (no leading @).
    No authentication is required — public profiles are open to anyone.

    Steps:
      1. Split handle into username + instance domain.
      2. Look up the numeric account ID via /api/v1/accounts/lookup.
      3. Fetch recent statuses, filtering by date (last 7 days) and
         favourites_count >= source.threshold.
    """

    platform = "mastodon"

    def fetch_posts(self, source, progress, since: datetime | None,
                    *, accounts_config: dict) -> list[dict]:
        handle = source.name

        # ── 1. Parse handle ───────────────────────────────────────────────────
        if "@" not in handle:
            logger.error("[mastodon] Invalid handle '{}' — expected username@instance", handle)
            return []

        username, instance = handle.split("@", 1)

        if progress is not None:
            progress.set_description(f"@{handle}: Mastodon")

        # ── 2. Resolve username → numeric account ID ──────────────────────────
        # The lookup endpoint returns an Account object if the user exists.
        lookup_url = f"https://{instance}/api/v1/accounts/lookup"
        try:
            resp = requests.get(lookup_url, headers=HEADERS,
                                params={"acct": username}, timeout=15)
            resp.raise_for_status()
            account_id = resp.json()["id"]
        except Exception as exc:
            logger.error("[mastodon] Could not look up {}: {}", handle, exc)
            if progress is not None:
                progress.update(1)
            return []

        # ── 3. Fetch statuses ─────────────────────────────────────────────────
        statuses_url = f"https://{instance}/api/v1/accounts/{account_id}/statuses"
        params = {
            "limit": 40,
            "exclude_replies": "true",
            "exclude_reblogs": "true",
        }
        try:
            resp = requests.get(statuses_url, headers=HEADERS, params=params, timeout=15)
            resp.raise_for_status()
            statuses = resp.json()
        except Exception as exc:
            logger.error("[mastodon] Could not fetch statuses for {}: {}", handle, exc)
            if progress is not None:
                progress.update(1)
            return []

        if progress is not None:
            progress.update(1)

        cutoff = self.compute_cutoff(since)
        posts: list[dict] = []

        for status in statuses:
            # ── Date filter ────────────────────────────────────────────────────
            created_str = status.get("created_at", "")
            created_at: datetime | None = None
            try:
                created_at = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                if created_at < cutoff:
                    continue
            except ValueError:
                pass  # keep the post if we can't parse the date

            # ── Extract plain text from HTML content ───────────────────────────
            # Mastodon delivers status.content as HTML, e.g.:
            #   <p>Hello <a href="...">world</a></p>
            raw_text = strip_html(status.get("content", ""))
            title    = self.make_title(raw_text)
            link     = status.get("url", "")

            # ── Content type ───────────────────────────────────────────────────
            # Check media_attachments for images; fall back to text post.
            attachments = status.get("media_attachments", [])
            image_attachments = [a for a in attachments if a.get("type") == "image"]

            if image_attachments:
                content_type = "image"
                content      = {"url": image_attachments[0].get("url", "")}
                if raw_text:
                    content["text"] = raw_text
            else:
                content_type = "text"
                content      = {"text": raw_text}

            posts.append(self.make_post(
                title=title,
                link=link,
                score=status.get("favourites_count", 0),
                content_type=content_type,
                content=content,
                author=handle,
                created_at=created_at,
            ))

            if len(posts) >= POST_LIMIT:
                break

        return posts
