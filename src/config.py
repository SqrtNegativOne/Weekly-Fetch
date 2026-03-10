import json
from dataclasses import dataclass
from pathlib import Path

# ── Directory references ─────────────────────────────────────────────────────
_SRC_DIR  = Path(__file__).parent          # …/src/
_ROOT_DIR = _SRC_DIR.parent               # project root

# ── Constants ────────────────────────────────────────────────────────────────
POST_LIMIT    = 20
ACCOUNTS_PATH = _ROOT_DIR / "accounts.json"
SETTINGS_PATH = _ROOT_DIR / "settings.json"

HEADERS = {"User-Agent": "weekly-fetch/1.0"}

# Keep MIN_KARMA as an alias so fetch.py's default parameter still works
MIN_KARMA = 100

_DEFAULT_SETTINGS = {
    "output_dir":    "output",
    "data_dir":      "data",
    "schedule_day":  "Saturday",
    "schedule_time": "09:00",
}


# ── Settings helpers ──────────────────────────────────────────────────────────

def load_settings() -> dict:
    """Read settings.json, falling back to defaults for any missing key."""
    if not SETTINGS_PATH.exists():
        return dict(_DEFAULT_SETTINGS)
    stored = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    return {**_DEFAULT_SETTINGS, **stored}


def save_settings(data: dict) -> None:
    """Merge `data` into settings.json (preserves keys not in `data`)."""
    current = load_settings()
    current.update(data)
    SETTINGS_PATH.write_text(
        json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _resolve_output_dir() -> Path:
    """Return the output directory from settings, resolved against project root."""
    p = Path(load_settings()["output_dir"])
    return p if p.is_absolute() else _ROOT_DIR / p


# OUTPUT_DIR is evaluated at import time.  Code that writes HTML should use
# this constant; it reads settings.json so the value is dynamic per run.
OUTPUT_DIR = _resolve_output_dir()


# ── Source dataclass ─────────────────────────────────────────────────────────

@dataclass
class Source:
    platform:  str   # "reddit" | "bluesky" | "tumblr" | "instagram"
    name:      str   # subreddit name, handle, blog, username
    schedule:  dict  # e.g. {"every_weekday": "Saturday"} — see schedule.py
    threshold: int   # min_karma / min_likes / min_notes


# ── Helpers ──────────────────────────────────────────────────────────────────

def load_accounts() -> dict:
    """Load accounts.json. Returns {} if the file doesn't exist yet."""
    if not ACCOUNTS_PATH.exists():
        return {}
    return json.loads(ACCOUNTS_PATH.read_text(encoding="utf-8"))


def _parse_entries(entries: list, platform: str,
                   default_threshold: int, threshold_key: str) -> list[Source]:
    """Turn a list of entry dicts (or legacy plain strings) into Source objects.

    Each entry can be either:
      - A plain string like "MachineLearning"   → uses all defaults
      - A dict like {"name": "...", "schedule": {...}, "<threshold_key>": N}
    """
    default_schedule = {"every_weekday": "Saturday"}
    sources = []
    for entry in entries:
        if isinstance(entry, str):
            sources.append(Source(platform, entry, default_schedule, default_threshold))
        else:
            sources.append(Source(
                platform,
                entry["name"],
                entry.get("schedule", default_schedule),
                int(entry.get(threshold_key, default_threshold)),
            ))
    return sources


def load_sources() -> list[Source]:
    """Parse accounts.json into a flat list of Source objects."""
    accounts = load_accounts()
    sources: list[Source] = []

    r = accounts.get("reddit", {})
    sources += _parse_entries(
        r.get("subreddits", []), "reddit", int(r.get("min_karma", 100)), "karma")

    b = accounts.get("bluesky", {})
    sources += _parse_entries(
        b.get("accounts", []), "bluesky", int(b.get("min_likes", 50)), "min_likes")

    t = accounts.get("tumblr", {})
    sources += _parse_entries(
        t.get("blogs", []), "tumblr", int(t.get("min_notes", 5)), "min_notes")

    i = accounts.get("instagram", {})
    sources += _parse_entries(
        i.get("accounts", []), "instagram", int(i.get("min_likes", 100)), "min_likes")

    return sources
