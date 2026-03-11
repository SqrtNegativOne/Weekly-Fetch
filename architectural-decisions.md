# Architectural Decisions — Weekly Fetch

## Base Fetcher Refactoring

### Template Method Pattern

- **The "Template Method" pattern** is what `BaseFetcher` implements: the base class defines the interface (`fetch_posts`), and subclasses fill in the platform-specific logic. Python doesn't need abstract base classes for this — convention + documentation is enough.
- **A registry decorator** (`@register`) is a clean alternative to manually maintaining a dict. When Python imports the module, the decorator runs and self-registers the class — zero maintenance overhead.
- The `progress_steps` class variable encodes platform-specific progress budget on the class itself: Reddit needs 21 ticks (1 listing + 20 comments) while others need 1. By encoding this on the class, `main.py` can compute total ticks generically without any platform-specific conditionals.

---

### Class Conversion — Import-Time Registration

- The class conversion is mostly mechanical: the old function signature `fetch_bluesky(handle, progress, min_likes, since)` maps to `fetch_posts(source, progress, since, *, accounts_config)`. The old args become: `handle=source.name`, `min_likes=source.threshold`.
- The `@register` decorator runs at **import time** — so `import fetch.bluesky` is enough to register `BlueskyFetcher` into `FETCHERS`. This is why `main.py` needs those explicit `import fetch.*` lines even though it never calls anything from them directly.

---

### `progress_steps` and Decoupling

- `progress_steps = POST_LIMIT + 1` is a **class-level constant** that `main.py` reads via `FETCHERS[platform].progress_steps` — a clean form of metadata-on-class. Compare this to the old approach where `main.py` hardcoded `(POST_LIMIT + 1) * len(reddit_due)`, with explicit knowledge that Reddit specifically was the outlier.
- Moving the `elapsed_time_filter` logic into `RedditFetcher._time_filter_from_since` reduces coupling: `main.py` no longer needs to import from `schedule.py` just for this Reddit-specific detail. The knowledge lives where it belongs — on the Reddit fetcher.
