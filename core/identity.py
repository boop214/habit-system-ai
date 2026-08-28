"""Identity aggregation, votes, weekly review and patterns.

"Votes" are simply events: every realization of a habit linked to an identity
is one vote for that identity. They are never turned into scores or levels.
"""
from datetime import timedelta

from . import db, periods, stats


def identity_votes(identity, conn, now_dt):
    """Aggregate votes (events) for an identity across its habits."""
    events = conn.execute(
        """SELECT e.* FROM events e
           JOIN habits h ON h.id = e.habit_id
           WHERE h.identity_id = ? AND h.active = 1 AND e.occurred_at >= '1970-01-01T00:00'
           ORDER BY e.occurred_at ASC, e.id ASC""",
        (identity["id"],),
    ).fetchall()
    events = [dict(r) for r in events]

    ws, _we = periods.period_this_week(now_dt)
    ms, _me = periods.period_this_month(now_dt)
    start_date = "1970-01-01"

    this_week = stats.count_in(events, ws, now_dt)
    this_month = stats.count_in(events, ms, now_dt)
    total = len(events)
    week_average = stats.weekly_average(events, start_date, now_dt)
    week_average_last4 = stats.weekly_average(events, start_date, now_dt, weeks=4)
    active_days = stats.active_days(events)
    best_week = stats.best_week(events, start_date, now_dt)
    trajectory = stats.weekly_counts(events, start_date, now_dt, weeks=12)
    tr = stats.trend(events, start_date, now_dt)

    return {
        "this_week": this_week,
        "this_month": this_month,
        "total": total,
        "week_average": round(week_average, 1),
        "week_average_last4": round(week_average_last4, 1),
        "active_days": active_days,
        "best_week": best_week,
        "trajectory": trajectory,
        "trend": tr,
    }


def identity_evidence(votes, now_dt):
    """Descriptive, evidence-based sentences. Never a score."""
    out = []
    total = votes["total"]
    if total == 0:
        return ["Todavía no hay acciones registradas para esta identidad. Cada pequeña acción será un voto."]
    out.append(
        f"Has realizado {total} {_plural(total, 'acción', 'acciones')} relacionadas con esta identidad."
    )
    out.append(
        f"Esta semana has actuado como esta persona {votes['this_week']} "
        f"{_plural(votes['this_week'], 'vez', 'veces')}."
    )
    if votes["week_average_last4"] > 0:
        out.append(
            f"En las últimas 4 semanas has mantenido una media de "
            f"{votes['week_average_last4']} acciones por semana."
        )
    d = votes["trend"]["direction"]
    if d == "up":
        out.append("Tu frecuencia está aumentando: estás construyendo más evidencia cada semana.")
    elif d == "down":
        out.append("El ritmo ha bajado un poco. Un periodo bajo no borra la evidencia ya construida.")
    return out


def identity_summary(identity, conn, now_dt):
    """Identity plus vote aggregates and habit count."""
    votes = identity_votes(identity, conn, now_dt)
    return {
        **identity,
        "votes": votes,
        "habit_count": conn.execute(
            "SELECT COUNT(*) AS n FROM habits WHERE identity_id = ? AND active = 1", (identity["id"],)
        ).fetchone()["n"],
    }


def habits_for_identity(conn, identity_id):
    rows = conn.execute(
        "SELECT * FROM habits WHERE identity_id = ? AND active = 1 ORDER BY created_at ASC",
        (identity_id,),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Friction detection
# ---------------------------------------------------------------------------

def friction_status(habit, events, now_dt):
    """Detect habits that seem difficult. Never guilt — just a signal to
    review the system. Returns None or a dict with a reason."""
    period, target = stats.period_target(habit)
    if target <= 0:
        return None
    start_date = habit.get("start_date") or "1970-01-01"

    if period == "day":
        buckets = periods.day_buckets(start_date, now_dt, days=10)
        counts = [stats.count_in(events, b[1], b[2]) for b in buckets]
        completed = counts[:-1] if counts and counts[-1] < target else counts
        recent = completed[-4:]
        below = sum(1 for c in recent if c < target)
        if len(recent) >= 3 and recent[-1] < target and below >= 3:
            return {"difficult": True, "reason": "several_days", "missed": below}
        return None

    buckets = periods.month_buckets(start_date, now_dt) if period == "month" else periods.week_buckets(start_date, now_dt)
    counts = [stats.count_in(events, b[1], b[2]) for b in buckets]
    completed = counts[:-1] if counts and counts[-1] < target else counts
    recent = completed[-3:]
    below = sum(1 for c in recent if c < target)
    if len(recent) >= 2 and recent[-1] < target and below >= 2:
        return {"difficult": True, "reason": "repeated_misses", "missed": below}
    return None


# ---------------------------------------------------------------------------
# Weekly review
# ---------------------------------------------------------------------------

REVIEW_DAY = 7  # Sunday (ISO)


def review_schedule(conn, now_dt):
    """Weekly review moment configured by the user.

    The user picks an hour for Sunday. The review page only opens on Sunday
    from that hour until the day ends; the rest of the week a countdown shows
    the time until the next opening.
    """
    raw = db.get_setting(conn, "review_sunday_time")
    if not raw:
        return {"enabled": False, "day": REVIEW_DAY, "time": None,
                "open": False, "next_at": None}
    try:
        hour, minute = (int(part) for part in raw.split(":"))
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError
    except (TypeError, ValueError):
        return {"enabled": False, "day": REVIEW_DAY, "time": None,
                "open": False, "next_at": None}
    is_sunday = now_dt.isoweekday() == REVIEW_DAY
    open_now = is_sunday and (now_dt.hour, now_dt.minute) >= (hour, minute)
    next_at = periods.next_weekday_at(now_dt, REVIEW_DAY, hour, minute)
    return {
        "enabled": True,
        "day": REVIEW_DAY,
        "time": f"{hour:02d}:{minute:02d}",
        "open": open_now,
        "next_at": next_at.strftime("%Y-%m-%dT%H:%M:%S"),
    }


def weekly_review(conn, now_dt, habit_summary_fn):
    """Build the weekly review payload.

    habit_summary_fn(habit) -> dict with at least: id, name, icon, color,
    goal, identity info.
    """
    habits = [dict(r) for r in conn.execute(
        "SELECT * FROM habits WHERE active = 1 ORDER BY created_at ASC"
    ).fetchall()]
    ws = periods.start_of_week(now_dt)
    we = ws + timedelta(days=7)
    week_start = ws.strftime("%Y-%m-%d")

    rows = []
    for h in habits:
        events = conn.execute(
            "SELECT * FROM events WHERE habit_id = ? ORDER BY occurred_at ASC, id ASC", (h["id"],)
        ).fetchall()
        events = [dict(r) for r in events]
        rows.append({"habit": h, "events": events, "summary": habit_summary_fn(h)})

    # What worked: habits meeting their objective this week, best first.
    working = []
    difficult = []
    for r in rows:
        g = r["summary"].get("goal") or {}
        if g.get("achieved") and g.get("period_count", 0) > 0:
            working.append({**r["summary"], "week_count": g["period_count"]})
        elif friction_status(r["habit"], r["events"], now_dt):
            difficult.append({**r["summary"], "week_count": g.get("this_week", 0)})
    working.sort(key=lambda x: x["week_count"], reverse=True)

    # Identities reinforced this week.
    identities = []
    for identity in conn.execute("SELECT * FROM identities WHERE active = 1 ORDER BY name ASC").fetchall():
        identity = dict(identity)
        this_week = conn.execute(
            """SELECT COUNT(*) AS n FROM events e JOIN habits h ON h.id = e.habit_id
               WHERE h.identity_id = ? AND h.active = 1 AND e.occurred_at >= ? AND e.occurred_at < ?""",
            (identity["id"], ws.strftime("%Y-%m-%dT%H:%M"), we.strftime("%Y-%m-%dT%H:%M")),
        ).fetchone()["n"]
        if this_week > 0:
            identities.append({**identity, "this_week": this_week})
    identities.sort(key=lambda x: x["this_week"], reverse=True)

    # Patterns: which cues appear most among habits with registrations this week.
    cue_counts = {}
    habit_cues = []
    for r in rows:
        cue = (r["habit"].get("cue") or "").strip()
        week_count = stats.count_in(r["events"], ws, now_dt)
        if cue and week_count > 0:
            cue_counts[cue] = cue_counts.get(cue, 0) + week_count
            habit_cues.append((r["habit"]["name"], cue, week_count))
    patterns = []
    if cue_counts:
        top_cue, top_n = max(cue_counts.items(), key=lambda kv: kv[1])
        names = ", ".join(n for n, c, wc in habit_cues if c == top_cue)
        patterns.append(
            f"La señal más frecuente esta semana ha sido «{top_cue}» ({top_n} registros)."
        )
    if working:
        top = working[0]
        patterns.append(f"«{top['name']}» ha sido el hábito más consistente esta semana ({top['week_count']} acciones).")
    if difficult:
        patterns.append(f"«{difficult[0]['name']}» parece estar costando. Puedes revisar el sistema para hacerlo más fácil.")

    answer_row = conn.execute("SELECT * FROM reviews WHERE week_start = ?", (week_start,)).fetchone()
    answer = dict(answer_row)["answer"] if answer_row else None

    return {
        "week_start": week_start,
        "working": working,
        "difficult": difficult,
        "identities": identities,
        "patterns": patterns,
        "question_answer": answer,
        "total_actions": sum(r["summary"].get("goal", {}).get("this_week", 0) for r in rows),
    }


def _plural(n, one, many):
    return one if n == 1 else many