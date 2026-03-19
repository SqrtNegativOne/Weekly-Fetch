import html as html_mod
import time
from datetime import datetime, timezone

from config import POST_LIMIT
from fetch.base import BaseFetcher, register
from log import logger


@register
class InstagramFetcher(BaseFetcher):
    """Fetch recent public Instagram posts using instaloader.

    instaloader scrapes Instagram without an official API — no login needed
    for public profiles, but Instagram may rate-limit heavy use.

    We import instaloader lazily (inside fetch_posts) so the rest of the app
    keeps working even if instaloader is not installed.
    """

    platform = "instagram"

    def fetch_posts(self, source, progress, since: datetime | None,
                    *, accounts_config: dict) -> list[dict]:
        username = source.name

        try:
            import instaloader
        except ImportError:
            logger.error("[instagram] instaloader is not installed — skipping @{}. "
                         "Run: pip install instaloader", username)
            return []

        if progress is not None:
            progress.set_description(f"@{username}: Instagram")

        try:
            loader  = instaloader.Instaloader(max_connection_attempts=1)
            profile = instaloader.Profile.from_username(loader.context, username)
            cutoff  = self.compute_cutoff(since)
            posts   = []

            for post in profile.get_posts():
                try:
                    # Instagram returns posts newest-first, so the first post older
                    # than our cutoff means we can stop iterating.
                    post_dt = post.date_utc
                    if post_dt.tzinfo is None:
                        post_dt = post_dt.replace(tzinfo=timezone.utc)
                    if post_dt < cutoff:
                        break

                    # ── Title (caption) ───────────────────────────────────────────
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

                    # Include full caption as body text
                    if caption:
                        content["text"] = caption

                    posts.append(self.make_post(
                        title=title,
                        link=link,
                        score=post.likes,
                        content_type=content_type,
                        content=content,
                        author="@" + username,
                        created_at=post_dt,
                    ))

                    if progress is not None:
                        progress.update(1)

                    if len(posts) >= POST_LIMIT:
                        break

                    time.sleep(0.7)  # avoid triggering Instagram's rate limit

                except instaloader.exceptions.TooManyRequestsException:
                    logger.warning(
                        "[instagram] Rate-limited by Instagram while fetching @{} "
                        "— stopping early, returning {} posts collected so far.",
                        username, len(posts),
                    )
                    return posts

        except instaloader.exceptions.TooManyRequestsException:
            logger.warning(
                "[instagram] Rate-limited by Instagram on profile load for @{} "
                "— skipping.",
                username,
            )
            return []
        except Exception as exc:
            logger.error("[instagram] Error fetching @{}: {}", username, exc)
            return []

        return posts
