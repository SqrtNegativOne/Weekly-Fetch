"""Tests for schedule.py — is_due, schedule_window_days, reddit_time_filter."""
from datetime import datetime

import pytest

from schedule import is_due, reddit_time_filter, schedule_window_days
from config import Source


def src(schedule: dict) -> Source:
    return Source(platform="reddit", name="test", schedule=schedule, threshold=10)


def state_with(source: Source, last_iso: str) -> dict:
    return {f"{source.platform}/{source.name}": last_iso}


# ── is_due: every_weekday ─────────────────────────────────────────────────────

def test_is_due_weekday_match_not_yet_run_today():
    # Monday = weekday 0
    s = src({"every_weekday": "Monday"})
    now = datetime(2026, 3, 16, 9, 0)   # Monday
    last = "2026-03-09T09:00:00"        # last Monday
    assert is_due(s, state_with(s, last), now)

def test_is_due_weekday_wrong_day():
    s = src({"every_weekday": "Monday"})
    now = datetime(2026, 3, 17, 9, 0)   # Tuesday
    last = "2026-03-09T09:00:00"
    assert not is_due(s, state_with(s, last), now)

def test_is_due_weekday_already_run_today():
    s = src({"every_weekday": "Monday"})
    now = datetime(2026, 3, 16, 18, 0)  # Monday evening
    last = "2026-03-16T09:00:00"        # already ran this morning
    assert not is_due(s, state_with(s, last), now)

def test_is_due_never_fetched():
    s = src({"every_weekday": "Monday"})
    assert is_due(s, {}, datetime(2026, 3, 17, 9, 0))  # any day → due


# ── is_due: every_n_days ──────────────────────────────────────────────────────

def test_is_due_n_days_elapsed():
    s = src({"every_n_days": 3})
    now = datetime(2026, 3, 19, 9, 0)
    last = "2026-03-16T09:00:00"        # exactly 3 days ago
    assert is_due(s, state_with(s, last), now)

def test_is_due_n_days_not_elapsed():
    s = src({"every_n_days": 3})
    now = datetime(2026, 3, 18, 9, 0)
    last = "2026-03-16T09:00:00"        # only 2 days ago
    assert not is_due(s, state_with(s, last), now)


# ── is_due: every_n_weeks ─────────────────────────────────────────────────────

def test_is_due_n_weeks_elapsed():
    s = src({"every_n_weeks": 2})
    now = datetime(2026, 3, 19, 9, 0)
    last = "2026-03-05T09:00:00"        # 14 days ago
    assert is_due(s, state_with(s, last), now)

def test_is_due_n_weeks_not_elapsed():
    s = src({"every_n_weeks": 2})
    now = datetime(2026, 3, 19, 9, 0)
    last = "2026-03-12T09:00:00"        # only 7 days ago
    assert not is_due(s, state_with(s, last), now)


# ── is_due: day_n_of_month ────────────────────────────────────────────────────

def test_is_due_day_of_month_correct_day_new_month():
    s = src({"day_n_of_month": 1})
    now = datetime(2026, 3, 1, 9, 0)
    last = "2026-02-01T09:00:00"
    assert is_due(s, state_with(s, last), now)

def test_is_due_day_of_month_wrong_day():
    s = src({"day_n_of_month": 1})
    now = datetime(2026, 3, 5, 9, 0)
    last = "2026-02-01T09:00:00"
    assert not is_due(s, state_with(s, last), now)

def test_is_due_day_of_month_already_run_this_month():
    s = src({"day_n_of_month": 1})
    now = datetime(2026, 3, 1, 18, 0)
    last = "2026-03-01T09:00:00"
    assert not is_due(s, state_with(s, last), now)


# ── schedule_window_days ──────────────────────────────────────────────────────

@pytest.mark.parametrize("schedule,expected", [
    ({"every_n_days": 1},    1.0),
    ({"every_n_days": 3},    3.0),
    ({"every_weekday": "Friday"}, 7.0),
    ({"every_n_weeks": 1},   7.0),
    ({"every_n_weeks": 2},   14.0),
    ({"every_n_months": 1},  30.0),
    ({"day_n_of_month": 15}, 30.0),
    ({},                     7.0),   # unknown → safe default
])
def test_schedule_window_days(schedule, expected):
    assert schedule_window_days(schedule) == expected


# ── reddit_time_filter ────────────────────────────────────────────────────────

@pytest.mark.parametrize("schedule,expected", [
    ({"every_n_days": 1},       "day"),
    ({"every_n_days": 7},       "week"),
    ({"every_n_days": 14},      "month"),
    ({"every_weekday": "Monday"}, "week"),
    ({"every_n_weeks": 1},      "week"),
    ({"every_n_weeks": 3},      "month"),
    ({"every_n_months": 1},     "month"),
    ({"day_n_of_month": 1},     "month"),
])
def test_reddit_time_filter(schedule, expected):
    assert reddit_time_filter(schedule) == expected
