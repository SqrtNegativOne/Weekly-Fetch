from pathlib import Path

POST_LIMIT = 20
MIN_KARMA  = 100
OUTPUT_DIR = Path("output")
LAST_MONTHLY_PATH = Path("last_monthly.json")

HEADERS = {"User-Agent": "weekly-reddit-fetcher/1.0"}


def load_list(path):
    return [l.strip() for l in Path(path).read_text().splitlines() if l.strip()]


# Loaded at import time
WEEKLY_SUBREDDITS  = load_list("weekly.txt")
MONTHLY_SUBREDDITS = load_list("monthly.txt")
