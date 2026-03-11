import html as html_mod
from datetime import datetime, timedelta, timezone

import requests

from config import HEADERS, POST_LIMIT


def fetch_bluesky(handle: str, progress=None, min_likes: int = 50) -> list[dict]:
    """Fetch recent posts from a Bluesky account via the public AT Protocol API.

    No login required — we hit public.api.bsky.app which is open to anyone.
    Only posts from the last 7 days with at least min_likes likes are included.
    """
    if progress is not None:
        progress.set_description(f"@{handle}: Bluesky")

    url    = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed"
    params = {"actor": handle, "limit": 100, "filter": "posts_no_replies"}

    resp = requests.get(url, headers=HEADERS, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    if progress is not None:
        progress.update(1)

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    posts  = []

    for item in data.get("feed", []):
        post_view = item.get("post", {})
        record    = post_view.get("record", {})

        # ── Like filter ──────────────────────────────────────────────────────
        if post_view.get("likeCount", 0) < min_likes:
            continue

        # ── Date filter ──────────────────────────────────────────────────────
        created_str = record.get("createdAt", "")
        try:
            created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            if created_dt < cutoff:
                continue
        except ValueError:
            pass  # keep the post if we can't parse the date

        # ── Title (first 120 chars of post text) ─────────────────────────────
        text  = record.get("text", "")
        title = html_mod.escape(text[:120] + ("…" if len(text) > 120 else ""))
        if not title:
            title = "[Post]"

        # ── Link ─────────────────────────────────────────────────────────────
        uri_parts = post_view.get("uri", "").split("/")
        post_id   = uri_parts[-1] if uri_parts else ""
        link      = f"https://bsky.app/profile/{handle}/post/{post_id}"

        # ── Content type ─────────────────────────────────────────────────────
        # The 'embed' in the record describes what was attached; the 'embed'
        # in post_view contains the resolved URLs we can actually display.
        embed_record = record.get("embed", {})
        embed_type   = embed_record.get("$type", "")
        view_embed   = post_view.get("embed", {})

        if "images" in embed_type:
            view_images = view_embed.get("images", [])
            img_url     = view_images[0].get("fullsize", "") if view_images else ""
            content_type = "image"
            content      = {"url": img_url}

        elif "external" in embed_type:
            ext          = view_embed.get("external", {})
            content_type = "link"
            content      = {"url": ext.get("uri", "")}

        elif "video" in embed_type:
            # Public API doesn't expose a direct video URL — show as link to post
            content_type = "link"
            content      = {"url": link}

        else:
            content_type = "text"
            content      = {"text": text}

        posts.append({
            "title":    title,
            "link":     link,
            "score":    post_view.get("likeCount", 0),
            "type":     content_type,
            "content":  content,
            "comments": [],
            "platform": "bluesky",
            "author":   handle,
        })

        if len(posts) >= POST_LIMIT:
            break

    return posts
