import html as html_mod
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

import requests

from config import HEADERS, POST_LIMIT


class _StripTags(HTMLParser):
    """Strips all HTML tags, leaving only the text content."""

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def get_text(self) -> str:
        return "".join(self.parts).strip()


def _strip_html(html_text: str) -> str:
    """Return plain text from an HTML string."""
    parser = _StripTags()
    parser.feed(html_text)
    return parser.get_text()


def fetch_mastodon(handle: str, progress=None, min_favorites: int = 10, since: datetime | None = None) -> list[dict]:
    """Fetch recent posts from a Mastodon account using the public API.

    Handle format: ``username@instance.social`` (no leading @).
    No authentication is required — public profiles are open to anyone.

    Steps:
      1. Split handle into username + instance domain.
      2. Look up the numeric account ID via /api/v1/accounts/lookup.
      3. Fetch recent statuses, filtering by date (last 7 days) and
         favourites_count >= min_favorites.
    """
    # ── 1. Parse handle ───────────────────────────────────────────────────────
    if "@" not in handle:
        print(f"[mastodon] Invalid handle '{handle}' — expected username@instance")
        return []

    username, instance = handle.split("@", 1)

    if progress is not None:
        progress.set_description(f"@{handle}: Mastodon")

    # ── 2. Resolve username → numeric account ID ──────────────────────────────
    # The lookup endpoint returns an Account object if the user exists.
    lookup_url = f"https://{instance}/api/v1/accounts/lookup"
    try:
        resp = requests.get(lookup_url, headers=HEADERS,
                            params={"acct": username}, timeout=15)
        resp.raise_for_status()
        account_id = resp.json()["id"]
    except Exception as exc:
        print(f"[mastodon] Could not look up {handle}: {exc}")
        if progress is not None:
            progress.update(1)
        return []

    # ── 3. Fetch statuses ─────────────────────────────────────────────────────
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
        print(f"[mastodon] Could not fetch statuses for {handle}: {exc}")
        if progress is not None:
            progress.update(1)
        return []

    if progress is not None:
        progress.update(1)

    cutoff = since if since is not None else (datetime.now(timezone.utc) - timedelta(days=7))
    posts: list[dict] = []

    for status in statuses:
        # ── Favourites filter ──────────────────────────────────────────────────
        if status.get("favourites_count", 0) < min_favorites:
            continue

        # ── Date filter ────────────────────────────────────────────────────────
        created_str = status.get("created_at", "")
        try:
            created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            if created_dt < cutoff:
                continue
        except ValueError:
            pass  # keep the post if we can't parse the date

        # ── Extract plain text from HTML content ───────────────────────────────
        # Mastodon delivers status.content as HTML, e.g.:
        #   <p>Hello <a href="...">world</a></p>
        raw_text = _strip_html(status.get("content", ""))
        title    = html_mod.escape(raw_text[:120] + ("…" if len(raw_text) > 120 else ""))
        if not title:
            title = "[Post]"

        link = status.get("url", "")

        # ── Content type ───────────────────────────────────────────────────────
        # Check media_attachments for images; fall back to text post.
        attachments = status.get("media_attachments", [])
        image_attachments = [a for a in attachments if a.get("type") == "image"]

        if image_attachments:
            content_type = "image"
            content      = {"url": image_attachments[0].get("url", "")}
        else:
            content_type = "text"
            content      = {"text": raw_text}

        posts.append({
            "title":    title,
            "link":     link,
            "score":    status.get("favourites_count", 0),
            "type":     content_type,
            "content":  content,
            "comments": [],
            "platform": "mastodon",
            "author":   handle,
        })

        if len(posts) >= POST_LIMIT:
            break

    return posts
