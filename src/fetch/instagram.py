import html as html_mod
from datetime import datetime, timedelta, timezone

from config import POST_LIMIT


def fetch_instagram(username: str, progress=None, min_likes: int = 100) -> list[dict]:
    """Fetch recent public Instagram posts using instaloader.

    instaloader scrapes Instagram without an official API — no login needed
    for public profiles, but Instagram may rate-limit heavy use.

    We import instaloader lazily (inside this function) so the rest of the app
    keeps working even if instaloader is not installed.
    """
    try:
        import instaloader
    except ImportError:
        print(f"[instagram] instaloader is not installed — skipping @{username}. "
              f"Run: pip install instaloader")
        return []

    if progress is not None:
        progress.set_description(f"@{username}: Instagram")

    try:
        loader  = instaloader.Instaloader()
        profile = instaloader.Profile.from_username(loader.context, username)
        cutoff  = datetime.now(timezone.utc) - timedelta(days=7)
        posts   = []

        for post in profile.get_posts():
            # Instagram returns posts newest-first, so the first post older than
            # our cutoff means we can stop iterating.
            post_dt = post.date_utc
            if post_dt.tzinfo is None:
                post_dt = post_dt.replace(tzinfo=timezone.utc)
            if post_dt < cutoff:
                break

            if post.likes < min_likes:
                continue

            # ── Title (caption) ───────────────────────────────────────────────
            caption   = post.caption or ""
            title_raw = caption[:120] + ("…" if len(caption) > 120 else "")
            if not title_raw:
                title_raw = "[Video]" if post.is_video else "[Image]"
            title = html_mod.escape(title_raw)

            link = f"https://www.instagram.com/p/{post.shortcode}/"

            if post.is_video:
                content_type = "video"
                content      = {"url": post.video_url or ""}
            else:
                content_type = "image"
                content      = {"url": post.url}

            posts.append({
                "title":    title,
                "link":     link,
                "score":    post.likes,
                "type":     content_type,
                "content":  content,
                "comments": [],
                "platform": "instagram",
                "author":   "@" + username,
            })

            if progress is not None:
                progress.update(1)

            if len(posts) >= POST_LIMIT:
                break

    except Exception as exc:
        print(f"[instagram] Error fetching @{username}: {exc}")
        return []

    return posts
