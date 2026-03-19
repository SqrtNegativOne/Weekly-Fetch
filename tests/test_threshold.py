"""Tests for passes_threshold() — the age-scaled score filter."""
import math
from datetime import datetime, timedelta, timezone

import pytest

from schedule import (
    ENGAGEMENT_HALF_LIFE_HOURS,
    MIN_POST_AGE_HOURS,
    passes_threshold,
)

# Fixed reference time used across all tests.
NOW = datetime(2026, 3, 19, 12, 0, 0, tzinfo=timezone.utc)
WEEKLY = 7.0   # fetch window in days


def make_post(score: int, age_hours: float | None) -> dict:
    """Build a minimal post dict. age_hours=None means no created_at."""
    if age_hours is None:
        return {"score": score, "created_at": None}
    created_at = NOW - timedelta(hours=age_hours)
    return {"score": score, "created_at": created_at}


# ── Zero / disabled threshold ─────────────────────────────────────────────────

def test_zero_threshold_always_passes():
    assert passes_threshold(make_post(0, 24), threshold=0, now=NOW, window_days=WEEKLY)

def test_negative_threshold_always_passes():
    assert passes_threshold(make_post(0, 24), threshold=-1, now=NOW, window_days=WEEKLY)


# ── No timestamp fallback ─────────────────────────────────────────────────────

def test_no_created_at_passes_when_score_meets_threshold():
    assert passes_threshold(make_post(100, None), threshold=100, now=NOW, window_days=WEEKLY)

def test_no_created_at_fails_when_score_below_threshold():
    assert not passes_threshold(make_post(99, None), threshold=100, now=NOW, window_days=WEEKLY)


# ── Minimum age floor ─────────────────────────────────────────────────────────

def test_post_under_min_age_is_rejected():
    """Posts younger than MIN_POST_AGE_HOURS are always rejected."""
    assert not passes_threshold(
        make_post(9999, MIN_POST_AGE_HOURS - 0.1), threshold=1, now=NOW, window_days=WEEKLY
    )

def test_post_exactly_at_min_age_is_evaluated():
    """At exactly MIN_POST_AGE_HOURS the post enters age-scaled evaluation."""
    # At 4 h in a 168 h window: saturation ≈ (1−e^(−λ·4))/(1−e^(−λ·168))
    # With λ = ln2/6: numerator ≈ 0.370, denominator ≈ 1.0 → ~37% of threshold.
    # A score of 37 should pass for threshold=100.
    lam = math.log(2) / ENGAGEMENT_HALF_LIFE_HOURS
    sat = (1 - math.exp(-lam * MIN_POST_AGE_HOURS)) / (1 - math.exp(-lam * WEEKLY * 24))
    effective = 100 * sat
    assert passes_threshold(make_post(math.ceil(effective), MIN_POST_AGE_HOURS), 100, NOW, WEEKLY)
    assert not passes_threshold(make_post(math.floor(effective) - 1, MIN_POST_AGE_HOURS), 100, NOW, WEEKLY)


# ── Saturation curve correctness ──────────────────────────────────────────────

def test_half_life_age_needs_roughly_half_threshold():
    """At age == half-life, saturation ≈ 50% of window saturation.
    For a window much larger than the half-life this is close to 50% of threshold."""
    # Use a very large window so S(window) ≈ 1
    lam = math.log(2) / ENGAGEMENT_HALF_LIFE_HOURS
    sat = (1 - math.exp(-lam * ENGAGEMENT_HALF_LIFE_HOURS)) / (1 - math.exp(-lam * 365 * 24))
    effective = 100 * sat
    # Should be very close to 50
    assert 45 < effective < 55

def test_24h_post_needs_most_of_threshold():
    """A 24-hour-old post in a weekly window should need ~90%+ of the threshold."""
    lam = math.log(2) / ENGAGEMENT_HALF_LIFE_HOURS
    sat = (1 - math.exp(-lam * 24)) / (1 - math.exp(-lam * WEEKLY * 24))
    assert sat > 0.90

def test_score_just_above_effective_threshold_passes():
    lam = math.log(2) / ENGAGEMENT_HALF_LIFE_HOURS
    age_h = 24.0
    sat = (1 - math.exp(-lam * age_h)) / (1 - math.exp(-lam * WEEKLY * 24))
    effective = 100 * sat
    assert passes_threshold(make_post(math.ceil(effective), age_h), 100, NOW, WEEKLY)

def test_score_just_below_effective_threshold_fails():
    lam = math.log(2) / ENGAGEMENT_HALF_LIFE_HOURS
    age_h = 24.0
    sat = (1 - math.exp(-lam * age_h)) / (1 - math.exp(-lam * WEEKLY * 24))
    effective = 100 * sat
    assert not passes_threshold(make_post(math.floor(effective) - 1, age_h), 100, NOW, WEEKLY)


# ── Saturation cap for old posts ──────────────────────────────────────────────

def test_post_older_than_window_needs_full_threshold():
    """A post older than the window should require the full (uncapped) threshold."""
    assert passes_threshold(make_post(100, WEEKLY * 24 + 48), 100, NOW, WEEKLY)
    assert not passes_threshold(make_post(99, WEEKLY * 24 + 48), 100, NOW, WEEKLY)


# ── Naive datetime is treated as UTC ─────────────────────────────────────────

def test_naive_created_at_treated_as_utc():
    naive_created = NOW.replace(tzinfo=None) - timedelta(hours=24)
    post = {"score": 100, "created_at": naive_created}
    lam = math.log(2) / ENGAGEMENT_HALF_LIFE_HOURS
    sat = (1 - math.exp(-lam * 24)) / (1 - math.exp(-lam * WEEKLY * 24))
    effective = 100 * sat
    assert passes_threshold(post, 100, NOW, WEEKLY) == (100 >= effective)
