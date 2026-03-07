import json
from datetime import datetime

from .config import LAST_MONTHLY_PATH


def current_week_tag() -> str:
    now = datetime.now()
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"


def should_fetch_monthly() -> bool:
    if not LAST_MONTHLY_PATH.exists():
        return True
    data = json.loads(LAST_MONTHLY_PATH.read_text())
    now = datetime.now()
    return (now.year, now.month) != (data["year"], data["month"])


def update_monthly_timestamp() -> None:
    now = datetime.now()
    LAST_MONTHLY_PATH.write_text(json.dumps({"year": now.year, "month": now.month}))
