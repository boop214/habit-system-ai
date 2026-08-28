"""Statistics, trends and insights.

These functions are pure: they receive events (lists of dicts with an
'occurred_at' local ISO datetime) and habits (dicts), plus a `now` datetime,
and return plain data. This keeps them unit-testable without a database.
"""
from datetime import datetime, time as dtime, timedelta

from . import periods


# ---------------------------------------------------------------------------
# Counting helpers
# ---------------------------------------------------------------------------

def event_dt(event):
    return periods.parse_dt(event["occurred_at"])


def count_in(events, start, end):
    """Number of events with occurred_at in [start, end)."""
    return sum(1 for e in events if start <= event_dt(e) < end)


def count_on_date(events, day):
    """Number of events occurring on a given date."""
    start = datetime.combine(day, dtime.min)
    end = start + timedelta(days=1)
    return count_in(events, start, end)


def value_sum_in(events, start, end):
    """Sum of event values in [start, end)."""
    return sum(e.get("value") or 0 for e in events if start <= event_dt(e) < end)


def count_by_day(events):
    """Map of date -> number of events."""
    out = {}
    for e in events:
        day = event_dt(e).date()
        out[day] = out.get(day, 0) + 1
    return out


def weekly_counts(events, start_date, now, weeks=12):
    """Count of events per week bucket, last `weeks` buckets ending at `now`."""
    buckets = periods.week_buckets(start_date, now)[-weeks:]
    return [{"label": b[0], "start": b[1], "end": b[2], "count": count_in(events, b[1], b[2])} for b in buckets]


def monthly_counts(events, start_date, now):
    buckets = periods.month_buckets(start_date, now)
    return [{"label": b[0], "start": b[1], "end": b[2], "count": count_in(events, b[1], b[2])} for b in buckets]


def daily_counts(events, start_date, now, days=30):
    buckets = periods.day_buckets(start_date, now, days)
    return [{"label": b[0], "start": b[1], "end": b[2], "count": count_in(events, b[1], b[2])} for b in buckets]


def weekly_average(events, start_date, now, weeks=None):
    """Average weekly count. `weeks` = number of recent buckets to consider
    (None = since start_date)."""
    buckets = periods.week_buckets(start_date, now)
    if weeks:
        buckets = buckets[-weeks:]
    if not buckets:
        return 0.0
    return sum(count_in(events, b[1], b[2]) for b in buckets) / len(buckets)


def monthly_average(events, start_date, now):
    buckets = periods.month_buckets(start_date, now)
    if not buckets:
        return 0.0
    return sum(count_in(events, b[1], b[2]) for b in buckets) / len(buckets)


def active_days(events):
    return len(count_by_day(events))


def best_week(events, start_date, now):
    buckets = periods.week_buckets(start_date, now)
    if not buckets:
        return 0
    return max(count_in(events, b[1], b[2]) for b in buckets)


# ---------------------------------------------------------------------------
# Trend
# ---------------------------------------------------------------------------

def trend(events, start_date, now, window=4):
    """Compare the last `window` weekly buckets with the `window` before them.

    Returns one of "up", "down", "stable" with supporting numbers.
    """
    buckets = periods.week_buckets(start_date, now)
    if len(buckets) < 3:
        return {"direction": "stable", "recent": 0.0, "previous": 0.0}
    recent = buckets[-window:]
    previous = buckets[-2 * window:-window]
    if not previous:
        return {"direction": "stable", "recent": 0.0, "previous": 0.0}
    recent_avg = sum(count_in(events, b[1], b[2]) for b in recent) / len(recent)
    prev_avg = sum(count_in(events, b[1], b[2]) for b in previous) / len(previous)
    diff = recent_avg - prev_avg
    if diff >= 0.5:
        direction = "up"
    elif diff <= -0.5:
        direction = "down"
    else:
        direction = "stable"
    return {"direction": direction, "recent": recent_avg, "previous": prev_avg, "diff": diff}


# ---------------------------------------------------------------------------
# Goals (frequency-aware)
# ---------------------------------------------------------------------------

def period_target(habit):
    """Return (period_name, target) describing the habit's frequency.

    period_name is one of "day", "week", "month".
    """
    ft = habit.get("frequency_type") or "weekly"
    ftarget = habit.get("frequency_target") or 0
    if ft == "daily":
        return "day", int(ftarget)
    if ft == "monthly":
        return "month", int(ftarget)
    if ft == "specific_days":
        return "week", max(1, len(habit.get("frequency_days") or []))
    return "week", int(ftarget)


def week_goal_status(habit, events, now):
    """Progress toward the habit objective (day/week/month aware).

    Returns the period progress plus the weekly numbers so the UI can show
    both "X / N esta semana" and "hoy" where appropriate.
    """
    period, target = period_target(habit)
    ws, _we = periods.period_this_week(now)
    ps, pe = periods.period_previous_week(now)
    this_week = count_in(events, ws, now)
    prev_week = count_in(events, ps, pe)

    if period == "day":
        today_start = periods.period_today(now)[0]
        period_count = count_in(events, today_start, now)
    elif period == "month":
        month_start = periods.period_this_month(now)[0]
        period_count = count_in(events, month_start, now)
    else:
        period_count = this_week

    percent = round((period_count / target) * 100) if target else None
    return {
        "period": period,
        "target": target,
        "period_count": period_count,
        "period_percent": percent,
        "period_achieved": target > 0 and period_count >= target,
        "period_remaining": max(0, target - period_count) if target else 0,
        "this_week": this_week,
        "prev_week": prev_week,
        "weekly_target": 7 * target if period == "day" else target,
        "achieved": target > 0 and period_count >= target,
        "percent": percent,
        "remaining": max(0, target - period_count) if target else 0,
    }


# ---------------------------------------------------------------------------
# Full habit statistics
# ---------------------------------------------------------------------------

def habit_stats(habit, events, now):
    """Comprehensive statistics for a single habit."""
    start_date = habit.get("start_date") or "1970-01-01"
    ws, _we = periods.period_this_week(now)
    ps, pe = periods.period_previous_week(now)
    ms, _me = periods.period_this_month(now)
    pms, pme = periods.period_previous_month(now)
    ys, _ye = periods.period_this_year(now)

    total = len(events)
    this_week = count_in(events, ws, now)
    prev_week = count_in(events, ps, pe)
    this_month = count_in(events, ms, now)
    prev_month = count_in(events, pms, pme)
    this_year = count_in(events, ys, now)
    today_start = periods.period_today(now)[0]
    today_count = count_in(events, today_start, now)

    week_avg_all = weekly_average(events, start_date, now)
    week_avg_last4 = weekly_average(events, start_date, now, weeks=4)
    month_avg = monthly_average(events, start_date, now)
    active = active_days(events)
    best = best_week(events, start_date, now)
    tr = trend(events, start_date, now)
    goal = week_goal_status(habit, events, now)

    return {
        "total": total,
        "today_count": today_count,
        "this_week": this_week,
        "prev_week": prev_week,
        "this_month": this_month,
        "prev_month": prev_month,
        "this_year": this_year,
        "week_average": round(week_avg_all, 1),
        "week_average_last4": round(week_avg_last4, 1),
        "month_average": round(month_avg, 1),
        "active_days": active,
        "best_week": best,
        "trend": tr,
        "goal": goal,
        "weeks_since_start": periods.weeks_elapsed(start_date, now),
        "months_since_start": periods.months_elapsed(start_date, now),
    }


def consistency_streak(habit, events, now, lookback=120):
    """Consecutive periods meeting the objective, walking backwards from the
    most recent period. Secondary metric, never the focus."""
    period, target = period_target(habit)
    if target <= 0:
        return 0
    start_date = habit.get("start_date") or "1970-01-01"
    if period == "day":
        buckets = periods.day_buckets(start_date, now, days=lookback)
    elif period == "month":
        buckets = periods.month_buckets(start_date, now)[-lookback:]
    else:
        buckets = periods.week_buckets(start_date, now)[-lookback:]
    counts = [count_in(events, b[1], b[2]) for b in buckets]
    streak = 0
    idx = len(counts) - 1
    if counts and counts[-1] < target:
        idx -= 1
    while idx >= 0 and counts[idx] >= target:
        streak += 1
        idx -= 1
    return streak


# ---------------------------------------------------------------------------
# Time / weekday profiles
# ---------------------------------------------------------------------------

def hour_profile(events, bucket=3):
    """Distribution of events over 3-hour blocks of the day."""
    out = {h: 0 for h in range(0, 24, bucket)}
    for e in events:
        h = event_dt(e).hour
        out[(h // bucket) * bucket] = out.get((h // bucket) * bucket, 0) + 1
    return out


def weekday_profile(events):
    out = {i: 0 for i in range(1, 8)}
    for e in events:
        d = event_dt(e).isoweekday()
        out[d] = out.get(d, 0) + 1
    return out


def most_frequent_hour(events):
    prof = hour_profile(events)
    if not events:
        return None
    top_h, top_n = max(prof.items(), key=lambda kv: kv[1])
    return top_h, top_n, len(events)


# ---------------------------------------------------------------------------
# Insights & suggestions
# ---------------------------------------------------------------------------

def _isodate_to_datetime(s):
    return datetime.strptime(str(s)[:10], "%Y-%m-%d")


def insights(habit, events, now):
    """Generate descriptive, data-driven insights (never guilt-tripping)."""
    out = []
    target = habit.get("frequency_target") or 0
    total = len(events)

    if total == 0:
        return out

    # 1. Main time of day
    top = most_frequent_hour(events)
    if top and top[1] >= 4 and top[1] / total >= 0.4:
        h = top[0]
        out.append(f"Realizas este hábito principalmente entre las {h:02d}:00 y las {h + 2:02d}:59.")

    # 2. Weekly frequency
    start_date = habit.get("start_date") or "1970-01-01"
    n_weeks = periods.weeks_elapsed(start_date, now)
    if n_weeks >= 2 and total >= 4:
        avg = weekly_average(events, start_date, now)
        out.append(f"Tu frecuencia media es de {avg:.1f} veces por semana.")

    # 3. Objective beaten repeatedly
    period, target = period_target(habit)
    if target > 0:
        if period == "day":
            last7 = periods.day_buckets(start_date, now, days=7)
            recent_days = last7[:-1] if last7 and count_in(events, last7[-1][1], last7[-1][2]) < target else last7
            recent_days = [b for b in recent_days if b[2] <= now]
            if len(recent_days) >= 3 and all(count_in(events, b[1], b[2]) >= target for b in recent_days[-3:]):
                out.append("Los últimos días has superado tu objetivo diario.")
        else:
            last3 = periods.week_buckets(start_date, now)[-3:]
            if last3:
                last = last3[-1]
                completed = last3[:-1] if count_in(events, last[1], last[2]) < target else last3
                if len(completed) >= 3 and all(count_in(events, b[1], b[2]) >= target for b in completed):
                    out.append("Las últimas 3 semanas has superado tu objetivo.")

    # 4. Weekday pattern
    wprof = weekday_profile(events)
    if total >= 8:
        high = max(wprof.values())
        low = min(wprof.values())
        if high >= 2 and low <= high * 0.4:
            low_day = min(wprof, key=wprof.get)
            pct = round((1 - low / high) * 100)
            out.append(f"Los {periods.weekday_name(low_day)} realizas este hábito un {pct}% menos que en tu día más activo.")

    # 5. Inactivity (gentle nudge)
    start_week = periods.start_of_week(now)
    five_days_ago = now - timedelta(days=5)
    if total > 0 and not any(start_week > event_dt(e) >= five_days_ago for e in events):
        out.append("No has registrado actividad en los últimos días. ¿Quieres revisar el objetivo?")

    # 6. Record week (light gamification, no guilt)
    best = best_week(events, start_date, now)
    if best >= 3 and best == max(count_in(events, b[1], b[2]) for b in periods.week_buckets(start_date, now)[-12:]):
        out.append(f"Nuevo récord personal: {best} sesiones en una semana.")

    return out


def goal_suggestion(habit, events, now):
    """Suggest adjusting the objective based on recent behaviour. Never applied
    automatically — the user decides."""
    period, target = period_target(habit)
    if target <= 0:
        return None
    start_date = habit.get("start_date") or "1970-01-01"

    def build(kind, message, suggested):
        return {"kind": kind, "message": message, "suggested_target": suggested}

    if period == "day":
        buckets = periods.day_buckets(start_date, now, days=14)
        counts = [count_in(events, b[1], b[2]) for b in buckets]
        recent = counts[-7:]
        if len(recent) < 5:
            return None
        avg = sum(recent) / 7
        if avg >= target + 1 and sum(1 for c in recent if c >= target) >= 4:
            return build("increase", (
                f"Tu objetivo era {target} {plural_of('vez', target)} al día y has conseguido una media de "
                f"{avg:.1f} en los últimos 7 días. ¿Quieres subirlo a {max(target + 1, round(avg))}?"
            ), max(target + 1, round(avg)))
        if all(c < target for c in recent) and sum(recent) / 7 < target * 0.6:
            suggested = max(1, round(sum(recent) / 7))
            if suggested < target:
                return build("decrease", (
                    f"Los últimos días has estado por debajo del objetivo de {target} al día. "
                    f"¿Quieres reducirlo temporalmente a {suggested}?"
                ), suggested)
        return None

    if period == "month":
        buckets = periods.month_buckets(start_date, now)
        counts = [count_in(events, b[1], b[2]) for b in buckets]
        if len(counts) < 3:
            return None
        recent3 = counts[-3:]
        avg = sum(recent3) / 3
        if avg >= target + 1 and sum(1 for c in recent3 if c >= target) >= 2:
            return build("increase", (
                f"Tu objetivo era {target} {plural_of('vez', target)} al mes y has conseguido una media de "
                f"{avg:.1f} en los últimos 3 meses. ¿Quieres subirlo a {max(target + 1, round(avg))}?"
            ), max(target + 1, round(avg)))
        if all(c < target for c in recent3) and avg < target * 0.6:
            suggested = max(1, round(avg))
            if suggested < target:
                return build("decrease", (
                    f"Llevas 3 meses por debajo del objetivo de {target} al mes. "
                    f"¿Quieres reducirlo temporalmente a {suggested}?"
                ), suggested)
        return None

    # week / specific_days
    if periods.weeks_elapsed(start_date, now) < 4:
        return None
    buckets = periods.week_buckets(start_date, now)
    counts = [count_in(events, b[1], b[2]) for b in buckets]

    recent4 = counts[-4:]
    avg4 = sum(recent4) / 4

    # Increase: comfortably above the target for several weeks.
    if avg4 >= target + 1 and sum(1 for c in recent4 if c >= target) >= 3:
        suggested = max(target + 1, round(avg4))
        return build("increase", (
            f"Tu objetivo era {target} {plural_of('vez', target)} por semana y has conseguido una media de "
            f"{avg4:.1f} en las últimas 4 semanas. ¿Quieres subirlo a {suggested}?"
        ), suggested)

    # Decrease: struggling for several complete weeks.
    completed = counts[:-1] if counts and counts[-1] < target else counts
    recent3 = completed[-3:]
    if len(recent3) >= 3 and all(c < target for c in recent3) and sum(recent3) / 3 < target * 0.8:
        suggested = max(1, round(sum(recent3) / 3))
        if suggested < target:
            return build("decrease", (
                f"Llevas 3 semanas por debajo del objetivo de {target} {plural_of('vez', target)} por semana. "
                f"¿Quieres reducirlo temporalmente a {suggested}?"
            ), suggested)
    return None


def plural_of(word, n):
    return word if n == 1 else f"{word}es"


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def format_duration(minutes):
    if minutes is None:
        return ""
    minutes = int(minutes)
    if minutes < 60:
        return f"{minutes} min"
    h, m = divmod(minutes, 60)
    if m == 0:
        return f"{h} h"
    return f"{h} h {m} min"