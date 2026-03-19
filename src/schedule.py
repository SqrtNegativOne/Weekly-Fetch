import json
import math
from datetime import datetime
from pathlib import Path

from config import BASE_DIR, Source

LAST_FETCH_PATH = BASE_DIR / "last_fetch.json"

WEEKDAY_MAP = {
    "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
    "Friday": 4, "Saturday": 5, "Sunday": 6,
}


# ── Day tag ──────────────────────────────────────────────────────────────────

def current_day_tag() -> str:
    """Return today's date as an ISO string like '2026-03-10'."""
    return datetime.now().strftime("%Y-%m-%d")


# ── State persistence ─────────────────────────────────────────────────────────
# last_fetch.json maps "platform/name" → ISO datetime string of last fetch.
# Example: {"reddit/MachineLearning": "2026-03-08T09:00:00"}

def load_state() -> dict:
    if not LAST_FETCH_PATH.exists():
        return {}
    return json.loads(LAST_FETCH_PATH.read_text(encoding="utf-8"))


def save_state(state: dict) -> None:
    LAST_FETCH_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _key(source: Source) -> str:
    return f"{source.platform}/{source.name}"


def mark_fetched(source: Source, state: dict, now: datetime) -> None:
    """Record that this source was successfully fetched at `now`."""
    state[_key(source)] = now.isoformat()


# ── Due-check logic ───────────────────────────────────────────────────────────
# Schedule dict must have exactly one of these keys:
#
#   every_n_days:    N        fetch every N days          (N=1 → daily)
#   every_weekday:   "Name"   fetch on that weekday       ("Saturday", "Monday", …)
#   every_n_weeks:   N        fetch every N weeks
#   every_n_months:  N        fetch every N months        (N=1 → monthly)
#   day_n_of_month:  N        fetch on day N each month   (N=1 → 1st of month)

def is_due(source: Source, state: dict, now: datetime) -> bool:
    """Return True if this source should be fetched in the current run."""
    last_str = state.get(_key(source))
    if last_str is None:
        return True                         # never fetched → always due

    last  = datetime.fromisoformat(last_str)
    sched = source.schedule

    if "every_n_days" in sched:
        return (now - last).days >= sched["every_n_days"]

    if "every_weekday" in sched:
        target = WEEKDAY_MAP[sched["every_weekday"]]
        # Due if today is the target weekday AND we haven't already run today
        return now.weekday() == target and now.date() > last.date()

    if "every_n_weeks" in sched:
        return (now - last).days >= sched["every_n_weeks"] * 7

    if "every_n_months" in sched:
        months_elapsed = (now.year - last.year) * 12 + (now.month - last.month)
        return months_elapsed >= sched["every_n_months"]

    if "day_n_of_month" in sched:
        return (now.day == sched["day_n_of_month"]
                and (now.year, now.month) != (last.year, last.month))

    return True   # unknown schedule type → always fetch


# ── Reddit time_filter helper ─────────────────────────────────────────────────
# Reddit's API accepts time=day|week|month|year|all. We pick the one that best
# matches the source's fetch cadence so you get fresh top posts each run.

def elapsed_time_filter(state: dict, source: "Source", now: datetime) -> str:
    """Pick a Reddit time filter based on actual days since the last fetch.

    Used by --force (manual) runs so the filter matches reality rather than
    the configured schedule cadence.
    """
    last_str = state.get(_key(source))
    if last_str is None:
        return "month"                  # never fetched → cast a wide net
    days = (now - datetime.fromisoformat(last_str)).days
    if days <= 1:   return "day"
    if days <= 7:   return "week"
    if days <= 31:  return "month"
    return "year"


def reddit_time_filter(schedule: dict) -> str:
    if "every_n_days" in schedule:
        n = schedule["every_n_days"]
        if n <= 1:   return "day"
        if n <= 7:   return "week"
        if n <= 31:  return "month"
        return "year"

    if "every_weekday" in schedule:
        return "week"

    if "every_n_weeks" in schedule:
        n = schedule["every_n_weeks"]
        if n == 1:  return "week"
        if n <= 4:  return "month"
        return "year"

    if "every_n_months" in schedule or "day_n_of_month" in schedule:
        return "month"

    return "week"   # safe default


# ── Window size helper ────────────────────────────────────────────────────────

def schedule_window_days(schedule: dict) -> float:
    """Return the fetch cadence as a number of days.

    Used to compute the age-scaled threshold: a post is compared against the
    fraction of final engagement it should have earned at its current age
    relative to this window.
    """
    if "every_n_days" in schedule:
        return float(schedule["every_n_days"])
    if "every_weekday" in schedule:
        return 7.0
    if "every_n_weeks" in schedule:
        return float(schedule["every_n_weeks"]) * 7
    if "every_n_months" in schedule:
        return float(schedule["every_n_months"]) * 30
    if "day_n_of_month" in schedule:
        return 30.0
    return 7.0   # safe default


# ── Age-scaled threshold ─────────────────────────────────────────────────────
# Engagement on social platforms follows an exponential saturation curve:
#   S(t) = A · (1 − e^(−λt))
# where λ = ln(2) / half_life.  Empirically, Reddit posts accumulate ~50% of
# their final score within the first 6 hours (R²=0.98 exponential fit).
# We scale the user's threshold by the fraction of final score a post of age
# `t` is expected to have earned, so posts published late in the fetch window
# are judged fairly against posts that had more time to accumulate engagement.

ENGAGEMENT_HALF_LIFE_HOURS = 6.0
MIN_POST_AGE_HOURS         = 4.0   # posts younger than this have too little evidence


def passes_threshold(post: dict, threshold: int,
                     now: datetime, window_days: float) -> bool:
    """Return True if this post meets the age-scaled threshold.

    For platforms without score data (supports_threshold=False) main.py skips
    this call entirely, so we only see posts with meaningful scores here.
    """
    from datetime import timezone  # avoid circular; datetime already imported above

    if threshold <= 0:
        return True

    score      = post.get("score", 0)
    created_at = post.get("created_at")

    if created_at is None:
        # No timestamp available — fall back to raw score comparison.
        return score >= threshold

    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    age_hours = (now - created_at).total_seconds() / 3600

    if age_hours < MIN_POST_AGE_HOURS:
        return False    # too new — insufficient evidence; B will catch it next run

    lam          = math.log(2) / ENGAGEMENT_HALF_LIFE_HOURS
    window_hours = window_days * 24
    saturation   = (1 - math.exp(-lam * age_hours)) / (1 - math.exp(-lam * window_hours))
    saturation   = min(saturation, 1.0)  # cap for posts older than the window

    return score >= threshold * saturation


# ── Human-readable label ──────────────────────────────────────────────────────

def schedule_label(schedule: dict) -> str:
    """Return a short human-readable description of a schedule dict."""
    if "every_n_days" in schedule:
        n = schedule["every_n_days"]
        return "Daily" if n == 1 else f"Every {n} days"

    if "every_weekday" in schedule:
        return f"Every {schedule['every_weekday']}"

    if "every_n_weeks" in schedule:
        n = schedule["every_n_weeks"]
        return "Weekly" if n == 1 else f"Every {n} weeks"

    if "every_n_months" in schedule:
        n = schedule["every_n_months"]
        return "Monthly" if n == 1 else f"Every {n} months"

    if "day_n_of_month" in schedule:
        n = schedule["day_n_of_month"]
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n if n < 20 else n % 10, "th")
        return f"{n}{suffix} of month"

    return "Custom"
