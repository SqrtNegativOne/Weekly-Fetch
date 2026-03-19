"""Shared base class, helpers, and registry for all platform fetchers.

Every platform fetcher (reddit, bluesky, etc.) is a subclass of BaseFetcher.
Shared HTML utilities that were previously duplicated across tumblr.py,
twitter.py, and mastodon.py now live here.
"""
import html as html_mod
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

from config import POST_LIMIT


# ── Shared HTML helpers ───────────────────────────────────────────────────────

class FirstImageExtractor(HTMLParser):
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


def first_image(html_text: str) -> str:
    """Return the URL of the first image in an HTML fragment, or ''."""
    extractor = FirstImageExtractor()
    extractor.feed(html_text)
    return extractor.url


class StripTags(HTMLParser):
    """Strips all HTML tags, leaving only the text content."""

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def get_text(self) -> str:
        return "".join(self.parts).strip()


def strip_html(html_text: str) -> str:
    """Return plain text from an HTML string."""
    parser = StripTags()
    parser.feed(html_text)
    return parser.get_text()


# ── Base class ────────────────────────────────────────────────────────────────

class BaseFetcher:
    """Abstract base for platform fetchers.

    Subclasses MUST set `platform` and override `fetch_posts`.

    Design notes:
    - Fetchers are stateless — no __init__ needed. Instantiate once, call many.
    - `source.name` is the identifier (handle, subreddit, username, etc.).
    - `source.threshold` replaces all the old min_karma/min_likes/... kwargs.
    - `accounts_config` is the full accounts.json dict — most fetchers ignore
      it; TwitterFetcher reads `rss_base` from it.
    - Threshold filtering is NOT done inside fetchers. main.py applies an
      age-scaled threshold after fetching so that recently-published posts
      are judged fairly. Fetchers that cannot provide a meaningful score
      (Tumblr, Twitter) set supports_threshold = False to skip filtering.
    """

    platform: str = ""          # e.g. "bluesky" — subclass MUST set this
    progress_steps: int = 1     # ticks per source; RedditFetcher overrides to POST_LIMIT+1
    supports_threshold: bool = True  # False for RSS-only platforms with no score data

    # ── Helpers subclasses can call ───────────────────────────────────────────

    def make_title(self, raw_text: str, fallback: str = "[Post]") -> str:
        """Truncate to 120 chars and HTML-escape. Returns fallback if empty."""
        truncated = raw_text[:120] + ("…" if len(raw_text) > 120 else "")
        escaped = html_mod.escape(truncated)
        return escaped or fallback

    def compute_cutoff(self, since: datetime | None) -> datetime:
        """Return since if provided, else 7 days ago (UTC)."""
        return since if since is not None else (datetime.now(timezone.utc) - timedelta(days=7))

    def make_post(self, *, title: str, link: str, score: int,
                  content_type: str, content: dict,
                  author: str, comments: list | None = None,
                  created_at: datetime | None = None) -> dict:
        """Build the standard post dict that db.py / the UI expect."""
        return {
            "title":      title,
            "link":       link,
            "score":      score,
            "type":       content_type,
            "content":    content,
            "comments":   comments or [],
            "platform":   self.platform,
            "author":     author,
            "created_at": created_at,   # datetime | None; used for age-scaled threshold
        }

    # ── Interface subclasses MUST implement ───────────────────────────────────

    def fetch_posts(self, source, progress, since: datetime | None,
                    *, accounts_config: dict) -> list[dict]:
        """Fetch posts for one source. Override in each platform subclass.

        Args:
            source:         Source dataclass (source.name, source.threshold).
            progress:       tqdm progress bar (may be None in tests).
            since:          datetime of last successful fetch, or None.
            accounts_config: Full accounts.json dict (e.g. for rss_base).

        Returns:
            List of post dicts (see make_post for the schema).
        """
        raise NotImplementedError(f"{self.__class__.__name__} must implement fetch_posts")


# ── Fetcher registry ──────────────────────────────────────────────────────────

# Maps platform name → fetcher instance.  Populated by @register.
FETCHERS: dict[str, BaseFetcher] = {}


def register(cls):
    """Class decorator. Adds cls() to FETCHERS under cls.platform.

    Usage::

        @register
        class BlueskyFetcher(BaseFetcher):
            platform = "bluesky"
            ...
    """
    FETCHERS[cls.platform] = cls()
    return cls
