"""Tests for period calculations and date boundaries."""
from datetime import date, datetime, timedelta

from core import periods


def test_start_of_week_monday():
    monday = datetime(2026, 8, 10, 9, 30)  # a Monday
    assert periods.start_of_week(monday) == datetime(2026, 8, 10, 0, 0)


def test_start_of_week_any_day():
    wed = datetime(2026, 8, 12, 15, 0)  # Wednesday
    assert periods.start_of_week(wed) == datetime(2026, 8, 10, 0, 0)
    sunday = datetime(2026, 8, 16, 23, 59)
    assert periods.start_of_week(sunday) == datetime(2026, 8, 10, 0, 0)


def test_this_week_end_is_now():
    now = datetime(2026, 8, 12, 18, 0)
    start, end = periods.period_this_week(now)
    assert start == datetime(2026, 8, 10, 0, 0)
    assert end == now


def test_previous_week():
    now = datetime(2026, 8, 12, 12, 0)
    start, end = periods.period_previous_week(now)
    assert start == datetime(2026, 8, 3, 0, 0)
    assert end == datetime(2026, 8, 10, 0, 0)


def test_this_month_and_previous():
    now = datetime(2026, 8, 15, 10, 0)
    start, end = periods.period_this_month(now)
    assert start == datetime(2026, 8, 1, 0, 0)
    assert end == now

    prev_start, prev_end = periods.period_previous_month(now)
    assert prev_start == datetime(2026, 7, 1, 0, 0)
    assert prev_end == datetime(2026, 8, 1, 0, 0)


def test_previous_month_year_boundary():
    now = datetime(2026, 1, 5, 0, 0)
    start, end = periods.period_previous_month(now)
    assert start == datetime(2025, 12, 1, 0, 0)
    assert end == datetime(2026, 1, 1, 0, 0)


def test_last_days_and_custom():
    now = datetime(2026, 8, 12, 12, 0)
    start, end = periods.period_last_days(now, 7)
    assert start == datetime(2026, 8, 5, 12, 0)
    assert end == now

    cstart, cend = periods.period_custom(now, "2026-08-01", "2026-08-31")
    assert cstart == datetime(2026, 8, 1, 0, 0)
    assert cend == now  # capped at now


def test_get_period_dispatch():
    now = datetime(2026, 8, 12, 12, 0)
    assert periods.get_period("this_week", now)[0] == datetime(2026, 8, 10, 0, 0)
    assert periods.get_period("last30", now)[0] == now - timedelta(days=30)
    assert periods.get_period("all", now)[0] == datetime(1970, 1, 1)


def test_weeks_elapsed_min_one():
    assert periods.weeks_elapsed("2026-08-10", datetime(2026, 8, 10, 10, 0)) == 1
    assert periods.weeks_elapsed("2026-08-10", datetime(2026, 8, 16, 10, 0)) == 1
    assert periods.weeks_elapsed("2026-08-10", datetime(2026, 8, 23, 10, 0)) == 2


def test_months_elapsed():
    assert periods.months_elapsed("2026-01-15", datetime(2026, 1, 20)) == 1
    assert periods.months_elapsed("2026-01-15", datetime(2026, 3, 1)) == 3
    assert periods.months_elapsed("2025-12-31", datetime(2026, 1, 2)) == 2


def test_week_buckets_since_start():
    now = datetime(2026, 8, 12, 0, 0)  # Wednesday
    buckets = periods.week_buckets("2026-08-03", now)
    assert len(buckets) == 2
    assert buckets[0][1] == datetime(2026, 8, 3, 0, 0)
    assert buckets[1][1] == datetime(2026, 8, 10, 0, 0)
    assert buckets[1][2] == datetime(2026, 8, 17, 0, 0)


def test_day_buckets_covers_today():
    now = datetime(2026, 8, 12, 22, 0)
    buckets = periods.day_buckets("2026-01-01", now, days=3)
    assert len(buckets) == 3
    assert buckets[-1][1] == datetime(2026, 8, 12, 0, 0)
    assert buckets[-1][2] == datetime(2026, 8, 13, 0, 0)


def test_parse_dt_formats():
    assert periods.parse_dt("2026-08-12T18:30") == datetime(2026, 8, 12, 18, 30)
    assert periods.parse_dt("2026-08-12") == datetime(2026, 8, 12, 0, 0)
    assert periods.parse_dt("2026-08-12 18:30:00") == datetime(2026, 8, 12, 18, 30)
    assert periods.parse_dt(date(2026, 8, 12)) == datetime(2026, 8, 12, 0, 0)