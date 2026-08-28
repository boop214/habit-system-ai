"""Tests for statistics, goals, streaks and insights."""
from datetime import datetime, timedelta

from core import stats


# A full week (Mon..Sun) so that events on any weekday are inside "this week".
NOW = datetime(2026, 8, 16, 23, 0)  # Sunday 23:00
MONDAY = datetime(2026, 8, 10, 0, 0)
PREV_MONDAY = datetime(2026, 8, 3, 0, 0)


def ev(day_offset=0, hour=12, minute=0, value=1, unit=None, duration=None):
    """Event at MONDAY + day_offset, at the given hour/minute."""
    dt = MONDAY + timedelta(days=day_offset, hours=hour, minutes=minute)
    return {"occurred_at": dt.strftime("%Y-%m-%dT%H:%M"), "value": value, "unit": unit, "duration": duration}


def base_habit(**overrides):
    h = {
        "name": "Leer",
        "type": "duration",
        "unit": "min",
        "target_value": 10,
        "frequency_type": "weekly",
        "frequency_target": 4,
        "start_date": "2026-01-01",
    }
    h.update(overrides)
    return h


# ---------------------------------------------------------------------------
# Counting
# ---------------------------------------------------------------------------

def test_count_in_boundaries():
    events = [ev(0), ev(2)]
    assert stats.count_in(events, MONDAY, MONDAY + timedelta(days=1)) == 1
    assert stats.count_in(events, MONDAY, MONDAY + timedelta(days=7)) == 2
    assert stats.count_in(events, MONDAY, MONDAY) == 0


def test_multiple_events_same_day():
    events = [ev(0, 9), ev(0, 10), ev(0, 11), ev(1, 9)]
    assert stats.count_on_date(events, MONDAY.date()) == 3
    assert stats.count_by_day(events)[MONDAY.date()] == 3


def test_this_week_count_vs_previous():
    events = [ev(0), ev(1), ev(2)]  # this week
    events += [{"occurred_at": (PREV_MONDAY + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M"), "value": 1}] * 4
    goal = stats.week_goal_status(base_habit(), events, NOW)
    assert goal["this_week"] == 3
    assert goal["prev_week"] == 4
    assert goal["period"] == "week"
    assert goal["period_count"] == 3
    assert goal["percent"] == 75
    assert goal["achieved"] is False
    assert goal["remaining"] == 1


def test_weekly_goal_achieved():
    events = [ev(0), ev(1), ev(2), ev(3), ev(4)]
    goal = stats.week_goal_status(base_habit(), events, NOW)
    assert goal["achieved"] is True
    assert goal["percent"] == 125


# ---------------------------------------------------------------------------
# Frequency types
# ---------------------------------------------------------------------------

def test_daily_frequency_goal():
    habit = base_habit(frequency_type="daily", frequency_target=8)
    events = [ev(6, 8), ev(6, 9), ev(6, 10)]  # 3 today (Sunday)
    goal = stats.week_goal_status(habit, events, NOW)
    assert goal["period"] == "day"
    assert goal["period_count"] == 3
    assert goal["target"] == 8
    assert goal["this_week"] == 3


def test_specific_days_frequency_goal():
    habit = base_habit(frequency_type="specific_days", frequency_days=[1, 3, 5])
    events = [ev(0), ev(2), ev(4)]
    goal = stats.week_goal_status(habit, events, NOW)
    assert goal["period"] == "week"
    assert goal["target"] == 3  # one per selected day
    assert goal["period_count"] == 3
    assert goal["achieved"] is True


def test_monthly_frequency_goal():
    habit = base_habit(frequency_type="monthly", frequency_target=10)
    events = [ev(0), ev(2), ev(5)]
    goal = stats.week_goal_status(habit, events, NOW)
    assert goal["period"] == "month"
    assert goal["period_count"] == 3


# ---------------------------------------------------------------------------
# Averages / best week / active days
# ---------------------------------------------------------------------------

def test_weekly_average_and_best():
    # Week of Aug 3: 2 events. Week of Aug 10: 4 events.
    events = [
        {"occurred_at": (PREV_MONDAY + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M"), "value": 1},
        {"occurred_at": (PREV_MONDAY + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M"), "value": 1},
    ] + [ev(i) for i in range(4)]
    assert stats.weekly_average(events, "2026-08-03", NOW) == 3.0
    assert stats.weekly_average(events, "2026-08-03", NOW, weeks=2) == 3.0
    assert stats.best_week(events, "2026-08-03", NOW) == 4
    assert stats.active_days(events) == 6


def test_weekly_average_respects_start_date():
    events = [ev(0)]
    assert stats.weekly_average(events, "2026-08-10", NOW) == 1.0


# ---------------------------------------------------------------------------
# Trend
# ---------------------------------------------------------------------------

def test_trend_up():
    start = (NOW - timedelta(days=35)).strftime("%Y-%m-%d")
    events = []
    for w, count in enumerate([1, 2, 3, 4, 5]):
        for i in range(count):
            day = PREV_MONDAY - timedelta(days=7 * (4 - w)) + timedelta(days=i)
            events.append({"occurred_at": day.strftime("%Y-%m-%dT%H:%M"), "value": 1})
    t = stats.trend(events, start, NOW, window=4)
    assert t["direction"] == "up"
    assert t["recent"] > t["previous"]


def test_trend_down():
    start = (NOW - timedelta(days=35)).strftime("%Y-%m-%d")
    events = []
    for w, count in enumerate([5, 4, 3, 2, 1]):
        for i in range(count):
            day = PREV_MONDAY - timedelta(days=7 * (4 - w)) + timedelta(days=i)
            events.append({"occurred_at": day.strftime("%Y-%m-%dT%H:%M"), "value": 1})
    t = stats.trend(events, start, NOW, window=4)
    assert t["direction"] == "down"


def test_trend_insufficient_data_is_stable():
    events = [ev(0), ev(1)]
    t = stats.trend(events, "2026-08-10", NOW)
    assert t["direction"] == "stable"


# ---------------------------------------------------------------------------
# Streaks (secondary metric)
# ---------------------------------------------------------------------------

def test_consistency_streak_weekly():
    # Two full weeks meeting target immediately before current + current below.
    events = []
    for w in range(2):
        for i in range(4):
            day = PREV_MONDAY - timedelta(days=7 * w) + timedelta(days=i)
            events.append({"occurred_at": day.strftime("%Y-%m-%dT%H:%M"), "value": 1})
    events += [ev(0), ev(1)]  # current week: only 2 (< target 4)
    streak = stats.consistency_streak(base_habit(), events, NOW)
    assert streak == 2


def test_consistency_streak_daily():
    habit = base_habit(frequency_type="daily", frequency_target=1)
    events = [ev(6), ev(5), ev(4)]  # today, yesterday, day before
    streak = stats.consistency_streak(habit, events, NOW)
    assert streak == 3


# ---------------------------------------------------------------------------
# Goal suggestions
# ---------------------------------------------------------------------------

def test_suggestion_increase_when_exceeding():
    start = (NOW - timedelta(days=42)).strftime("%Y-%m-%d")
    events = []
    # Six full weeks ending with the current one; the last four average 5.25.
    for w, count in enumerate([2, 3, 4, 6, 6, 5]):
        for i in range(count):
            day = MONDAY - timedelta(days=7 * (5 - w)) + timedelta(days=i)
            events.append({"occurred_at": day.strftime("%Y-%m-%dT%H:%M"), "value": 1})
    suggestion = stats.goal_suggestion(base_habit(), events, NOW)
    assert suggestion is not None
    assert suggestion["kind"] == "increase"
    assert suggestion["suggested_target"] >= 5


def test_suggestion_decrease_when_struggling():
    start = (NOW - timedelta(days=42)).strftime("%Y-%m-%d")
    events = []
    # Six full weeks; recent weeks are consistently below the target of 4.
    for w, count in enumerate([4, 3, 2, 1, 1, 0]):
        for i in range(count):
            day = MONDAY - timedelta(days=7 * (5 - w)) + timedelta(days=i)
            events.append({"occurred_at": day.strftime("%Y-%m-%dT%H:%M"), "value": 1})
    suggestion = stats.goal_suggestion(base_habit(), events, NOW)
    assert suggestion is not None
    assert suggestion["kind"] == "decrease"


def test_suggestion_none_with_little_data():
    # Habit started recently: not enough weeks to judge.
    events = [ev(0), ev(1)]
    habit = base_habit(start_date="2026-08-12")
    assert stats.goal_suggestion(habit, events, NOW) is None


def test_suggestion_none_when_on_track():
    start = (NOW - timedelta(days=42)).strftime("%Y-%m-%d")
    events = []
    # Recent weeks hover right around the target of 4.
    for w, count in enumerate([0, 4, 4, 3, 4, 3]):
        for i in range(count):
            day = MONDAY - timedelta(days=7 * (5 - w)) + timedelta(days=i)
            events.append({"occurred_at": day.strftime("%Y-%m-%dT%H:%M"), "value": 1})
    assert stats.goal_suggestion(base_habit(), events, NOW) is None


# ---------------------------------------------------------------------------
# Insights
# ---------------------------------------------------------------------------

def test_insights_empty_with_no_data():
    assert stats.insights(base_habit(), [], NOW) == []


def test_insights_weekly_frequency():
    events = [ev(0), ev(1), ev(2), ev(3)]  # total 4
    texts = stats.insights(base_habit(), events, NOW)
    assert any("media" in t for t in texts)


def test_insights_main_time_of_day():
    events = [ev(0, 21), ev(1, 21), ev(2, 21), ev(3, 21), ev(4, 22)]
    texts = stats.insights(base_habit(), events, NOW)
    assert any("principalmente" in t for t in texts)


def test_insights_supera_objetivo():
    start = (NOW - timedelta(days=21)).strftime("%Y-%m-%d")
    events = []
    for w in range(3):
        week_start = MONDAY - timedelta(days=7 * (2 - w))
        for i in range(5):
            day = week_start + timedelta(days=i)
            events.append({"occurred_at": day.strftime("%Y-%m-%dT%H:%M"), "value": 1})
    texts = stats.insights(base_habit(), events, NOW)
    assert any("superado tu objetivo" in t for t in texts)


# ---------------------------------------------------------------------------
# habit_stats structure
# ---------------------------------------------------------------------------

def test_habit_stats_fields():
    events = [ev(0), ev(1), ev(2)]
    st = stats.habit_stats(base_habit(), events, NOW)
    assert st["total"] == 3
    assert st["this_week"] == 3
    assert st["active_days"] == 3
    assert st["goal"]["this_week"] == 3
    assert "week_average" in st and "trend" in st


def test_format_duration():
    assert stats.format_duration(None) == ""
    assert stats.format_duration(45) == "45 min"
    assert stats.format_duration(60) == "1 h"
    assert stats.format_duration(95) == "1 h 35 min"