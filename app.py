"""Habit Tracker — Flask backend.

Local-first single-user web application. SQLite persists everything on disk,
nothing is sent to external servers.
"""
import os
import socket
from datetime import datetime

from flask import Flask, g, jsonify, request, send_from_directory

from core import db, identity, obstacles, periods, seed, semantics, stats

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, static_folder=None)


# ---------------------------------------------------------------------------
# Database lifecycle
# ---------------------------------------------------------------------------

def get_conn():
    if "conn" not in g:
        g.conn = db.get_connection()
    return g.conn


@app.teardown_appcontext
def close_conn(exc):
    conn = g.pop("conn", None)
    if conn is not None:
        conn.close()


def now():
    return datetime.now()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def habit_summary(habit, conn, now_dt):
    events = db.list_events_since(conn, habit["id"], "1970-01-01T00:00")
    goal = stats.week_goal_status(habit, events, now_dt)
    today_start = periods.period_today(now_dt)[0]
    summary = {
        **habit,
        "goal": goal,
        "today_count": stats.count_in(events, today_start, now_dt),
        "total": len(events),
        "friction": identity.friction_status(habit, events, now_dt),
    }
    if habit.get("identity_id"):
        ident = db.get_identity(conn, habit["identity_id"])
        if ident:
            summary["identity"] = {"id": ident["id"], "name": ident["name"], "icon": ident["icon"], "color": ident["color"]}
    return summary


def validate_habit_payload(data, partial=False):
    """Basic validation for habit create/update. Returns (errors, clean_data)."""
    errors = {}
    name = (data.get("name") or "").strip()
    if not partial and not name:
        errors["name"] = "El nombre es obligatorio."
    if name and len(name) > 100:
        errors["name"] = "El nombre es demasiado largo."
    ftype = data.get("frequency_type", "weekly")
    if ftype not in ("daily", "weekly", "monthly", "specific_days"):
        errors["frequency_type"] = "Tipo de frecuencia no válido."
    f_target = data.get("frequency_target")
    if f_target is not None:
        try:
            f_target = int(f_target)
            if f_target < 1:
                errors["frequency_target"] = "La frecuencia debe ser al menos 1."
        except (TypeError, ValueError):
            errors["frequency_target"] = "La frecuencia debe ser un número."
        data["frequency_target"] = f_target
    htype = data.get("type")
    if htype and htype not in ("boolean", "count", "duration", "quantity", "distance", "repetitions", "sessions"):
        errors["type"] = "Tipo de hábito no válido."
    tv = data.get("target_value")
    if tv not in (None, ""):
        try:
            data["target_value"] = float(tv)
        except (TypeError, ValueError):
            errors["target_value"] = "La cantidad debe ser un número."
    for key in ("frequency_days", "reminder_days"):
        val = data.get(key)
        if val and not isinstance(val, list):
            errors[key] = "Formato inválido."
    start = data.get("start_date")
    if start:
        try:
            datetime.strptime(str(start)[:10], "%Y-%m-%d")
        except ValueError:
            errors["start_date"] = "Fecha de inicio no válida."
    iid = data.get("identity_id")
    if iid not in (None, ""):
        try:
            data["identity_id"] = int(iid)
        except (TypeError, ValueError):
            errors["identity_id"] = "Identidad no válida."
    mv = data.get("minimum_value")
    if mv not in (None, ""):
        try:
            data["minimum_value"] = float(mv)
        except (TypeError, ValueError):
            errors["minimum_value"] = "La versión mínima debe ser un número."
    for key in ("minimum_unit", "minimum_description", "environment", "location",
                "attraction_strategy", "friction_strategy", "reward_strategy"):
        val = data.get(key)
        if val is not None and not isinstance(val, str):
            errors[key] = "Formato inválido."
    return errors, data


def serialize_event(e):
    return e


def _identity_link_payload(conn, row):
    if row is None:
        return None
    ident = db.get_identity(conn, row["identity_id"])
    if ident is None:
        return None
    return {**row, "identity": {
        "id": ident["id"], "name": ident["name"],
        "icon": ident["icon"], "color": ident["color"],
    }}


def _top_suggestion(habit, conn):
    identities = db.list_identities(conn)
    if not identities:
        return None
    candidates = semantics.suggest_identity_for_habit(habit, identities, conn)
    return candidates[0] if candidates else None


def _valid_date(value):
    try:
        datetime.strptime(str(value), "%Y-%m-%d")
        return str(value)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Static
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/favicon.ico")
def favicon():
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
        "<rect width='32' height='32' rx='7' fill='%234f7cff'/>"
        "<text x='16' y='23' font-size='18' text-anchor='middle' fill='white'>✓</text>"
        "</svg>"
    )
    return svg, 200, {"Content-Type": "image/svg+xml"}


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


@app.route("/service-worker.js")
def service_worker():
    # Served from the web root so its default scope is "/" and it can control
    # the application entry point ("/") as well as every /static/ asset.
    resp = send_from_directory(STATIC_DIR, "service-worker.js")
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/api/state")
def api_state():
    conn = get_conn()
    habits = db.list_habits(conn, include_inactive=True)
    identities = db.list_identities(conn, include_inactive=True)
    has_any = len(habits) > 0
    has_demo = any(h["is_demo"] for h in habits)
    return jsonify({
        "has_habits": has_any,
        "has_demo": has_demo,
        "has_identities": len(identities) > 0,
    })


# ---------------------------------------------------------------------------
# Identities
# ---------------------------------------------------------------------------

@app.route("/api/identities")
def api_list_identities():
    conn = get_conn()
    now_dt = now()
    identities = [identity.identity_summary(i, conn, now_dt) for i in db.list_identities(conn)]
    return jsonify(identities)


@app.route("/api/identities", methods=["POST"])
def api_create_identity():
    conn = get_conn()
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"errors": {"name": "El nombre es obligatorio."}}), 400
    if len(name) > 80:
        return jsonify({"errors": {"name": "El nombre es demasiado largo."}}), 400
    identity_row = db.create_identity(conn, data)
    return jsonify(identity_row), 201


@app.route("/api/identities/<int:identity_id>")
def api_get_identity(identity_id):
    conn = get_conn()
    now_dt = now()
    identity_row = db.get_identity(conn, identity_id)
    if identity_row is None:
        return jsonify({"error": "Identidad no encontrada."}), 404
    habits = identity.habits_for_identity(conn, identity_id)
    habits = [habit_summary(h, conn, now_dt) for h in habits]
    votes = identity.identity_votes(identity_row, conn, now_dt)
    return jsonify({
        **identity.identity_summary(identity_row, conn, now_dt),
        "habits": habits,
        "evidence": identity.identity_evidence(votes, now_dt),
    })


@app.route("/api/identities/<int:identity_id>", methods=["PUT"])
def api_update_identity(identity_id):
    conn = get_conn()
    if db.get_identity(conn, identity_id) is None:
        return jsonify({"error": "Identidad no encontrada."}), 404
    data = request.get_json(silent=True) or {}
    name = data.get("name")
    if name is not None and not (name or "").strip():
        return jsonify({"errors": {"name": "El nombre es obligatorio."}}), 400
    updated = db.update_identity(conn, identity_id, data)
    return jsonify(updated)


@app.route("/api/identities/<int:identity_id>", methods=["DELETE"])
def api_delete_identity(identity_id):
    conn = get_conn()
    if not db.delete_identity(conn, identity_id):
        return jsonify({"error": "Identidad no encontrada."}), 404
    return jsonify({"ok": True})


@app.route("/api/habits/<int:habit_id>/obstacles", methods=["POST"])
def api_create_obstacle(habit_id):
    conn = get_conn()
    habit = db.get_habit(conn, habit_id)
    if habit is None:
        return jsonify({"error": "Hábito no encontrado."}), 404
    data = request.get_json(silent=True) or {}
    obstacle = (data.get("obstacle") or "").strip()
    if not obstacle:
        return jsonify({"errors": {"obstacle": "Elige un obstáculo."}}), 400
    otype = (data.get("type") or "").strip() or None
    saved = db.create_obstacle(conn, habit_id, obstacle, data.get("note"), otype)
    suggestion = obstacles.redesign_suggestion(habit, otype) if otype else None
    saved["suggestion"] = suggestion
    return jsonify(saved), 201


# ---------------------------------------------------------------------------
# Weekly review
# ---------------------------------------------------------------------------

@app.route("/api/review/weekly")
def api_weekly_review():
    conn = get_conn()
    now_dt = now()

    def summary_fn(h):
        events = db.list_events_since(conn, h["id"], "1970-01-01T00:00")
        return habit_summary(h, conn, now_dt)

    data = identity.weekly_review(conn, now_dt, summary_fn)
    data["schedule"] = identity.review_schedule(conn, now_dt)
    return jsonify(data)


@app.route("/api/settings/review", methods=["PUT"])
def api_save_review_setting():
    conn = get_conn()
    data = request.get_json(silent=True) or {}
    time_str = (data.get("time") or "").strip()
    if time_str:
        parts = time_str.split(":")
        valid = len(parts) == 2
        if valid:
            try:
                hour, minute = (int(p) for p in parts)
                valid = 0 <= hour <= 23 and 0 <= minute <= 59
                valid = valid and time_str == f"{hour:02d}:{minute:02d}"
            except (TypeError, ValueError):
                valid = False
        if not valid:
            return jsonify({"errors": {"time": "Hora no válida."}}), 400
    db.set_setting(conn, "review_sunday_time", time_str)
    return jsonify({"ok": True, "schedule": identity.review_schedule(conn, now())})


@app.route("/api/settings/theme", methods=["GET", "PUT"])
def api_settings_theme():
    conn = get_conn()
    if request.method == "GET":
        return jsonify({"theme": db.get_setting(conn, "theme") or "light"})
    data = request.get_json(silent=True) or {}
    theme = str(data.get("theme") or "light").strip().lower()
    if theme not in ("light", "dark"):
        return jsonify({"errors": {"theme": "Tema no válido."}}), 400
    db.set_setting(conn, "theme", theme)
    return jsonify({"ok": True, "theme": theme})


@app.route("/api/review/weekly", methods=["PUT"])
def api_save_review_answer():
    conn = get_conn()
    data = request.get_json(silent=True) or {}
    now_dt = now()
    week_start = periods.start_of_week(now_dt).strftime("%Y-%m-%d")
    answer = data.get("answer")
    if answer is not None and not isinstance(answer, str):
        return jsonify({"errors": {"answer": "Formato inválido."}}), 400
    return jsonify(db.save_review_answer(conn, week_start, answer))


# ---------------------------------------------------------------------------
# Habits
# ---------------------------------------------------------------------------

@app.route("/api/habits")
def api_list_habits():
    conn = get_conn()
    now_dt = now()
    habits = [habit_summary(h, conn, now_dt) for h in db.list_habits(conn)]
    return jsonify(habits)


@app.route("/api/habits", methods=["POST"])
def api_create_habit():
    conn = get_conn()
    data = request.get_json(silent=True) or {}
    errors, data = validate_habit_payload(data)
    if data.get("identity_id") and db.get_identity(conn, data["identity_id"]) is None:
        errors["identity_id"] = "La identidad no existe."
    if errors:
        return jsonify({"errors": errors}), 400
    habit = db.create_habit(conn, data)
    return jsonify(habit), 201


@app.route("/api/habits/<int:habit_id>")
def api_get_habit(habit_id):
    conn = get_conn()
    habit = db.get_habit(conn, habit_id)
    if habit is None:
        return jsonify({"error": "Hábito no encontrado."}), 404
    now_dt = now()
    events = db.list_events_since(conn, habit_id, "1970-01-01T00:00")
    start_date = habit.get("start_date") or "1970-01-01"
    detail = habit_summary(habit, conn, now_dt)
    detail["stats"] = stats.habit_stats(habit, events, now_dt)
    detail["streak"] = stats.consistency_streak(habit, events, now_dt)
    detail["events"] = events[::-1]  # newest first
    detail["insights"] = stats.insights(habit, events, now_dt)
    detail["suggestion"] = stats.goal_suggestion(habit, events, now_dt)
    detail["obstacle_counts"] = db.obstacle_counts(conn, habit_id)
    detail["main_obstacle"] = db.main_obstacle(conn, habit_id)
    detail["identity_links"] = [
        l for l in (_identity_link_payload(conn, row)
                    for row in db.list_identity_links(conn, habit_id=habit_id))
        if l and l["status"] == "linked"
    ]
    detail["semantic_suggestion"] = _top_suggestion(habit, conn)
    detail["charts"] = {
        "weekly": stats.weekly_counts(events, start_date, now_dt),
        "monthly": stats.monthly_counts(events, start_date, now_dt),
        "daily": stats.daily_counts(events, start_date, now_dt),
        "year_days": [{"date": d.isoformat(), "count": stats.count_on_date(events, d)}
                      for d in periods.calendar_year_days(now_dt)],
    }
    return jsonify(detail)


@app.route("/api/habits/<int:habit_id>", methods=["PUT"])
def api_update_habit(habit_id):
    conn = get_conn()
    habit = db.get_habit(conn, habit_id)
    if habit is None:
        return jsonify({"error": "Hábito no encontrado."}), 404
    data = request.get_json(silent=True) or {}
    errors, data = validate_habit_payload(data, partial=True)
    if data.get("identity_id") and db.get_identity(conn, data["identity_id"]) is None:
        errors["identity_id"] = "La identidad no existe."
    if errors:
        return jsonify({"errors": errors}), 400
    updated = db.update_habit(conn, habit_id, data)
    return jsonify(updated)


@app.route("/api/habits/<int:habit_id>", methods=["DELETE"])
def api_delete_habit(habit_id):
    conn = get_conn()
    if not db.delete_habit(conn, habit_id):
        return jsonify({"error": "Hábito no encontrado."}), 404
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Semantic identity links (many-to-many habit <-> identity)
# ---------------------------------------------------------------------------

@app.route("/api/habits/<int:habit_id>/identity-links", methods=["POST"])
def api_set_identity_link(habit_id):
    conn = get_conn()
    habit = db.get_habit(conn, habit_id)
    if habit is None:
        return jsonify({"error": "Hábito no encontrado."}), 404
    data = request.get_json(silent=True) or {}
    identity_id = data.get("identity_id")
    try:
        identity_id = int(identity_id)
    except (TypeError, ValueError):
        return jsonify({"errors": {"identity_id": "Identidad no válida."}}), 400
    if db.get_identity(conn, identity_id) is None:
        return jsonify({"errors": {"identity_id": "La identidad no existe."}}), 404
    decision = (data.get("decision") or "accept")
    if decision not in ("accept", "reject"):
        return jsonify({"errors": {"decision": "Decisión no válida."}}), 400
    status = "linked" if decision == "accept" else "rejected"
    link = db.set_identity_link(
        conn, habit_id, identity_id, status, "semantic",
        confidence=data.get("confidence") if isinstance(data.get("confidence"), (int, float)) else None,
    )
    return jsonify(_identity_link_payload(conn, link)), 201


@app.route("/api/habits/<int:habit_id>/identity-links/<int:identity_id>", methods=["DELETE"])
def api_delete_identity_link(habit_id, identity_id):
    conn = get_conn()
    if not db.delete_identity_link(conn, habit_id, identity_id):
        return jsonify({"error": "Vínculo no encontrado."}), 404
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def infer_event_value(habit, data):
    """Fill value/unit/duration when not supplied by the client."""
    htype = habit.get("type")
    target_value = habit.get("target_value")
    value = data.get("value")
    if value in (None, ""):
        if htype == "boolean":
            value = 1
        elif htype == "sessions":
            value = 1
        else:
            value = target_value or 1
    try:
        value = float(value)
    except (TypeError, ValueError):
        value = 1
    duration = data.get("duration")
    if duration in (None, ""):
        if htype == "duration":
            duration = value
        elif htype == "sessions":
            duration = target_value
    unit = data.get("unit") or habit.get("unit")
    return value, duration, unit


@app.route("/api/habits/<int:habit_id>/events", methods=["POST"])
def api_create_event(habit_id):
    conn = get_conn()
    habit = db.get_habit(conn, habit_id)
    if habit is None:
        return jsonify({"error": "Hábito no encontrado."}), 404
    data = request.get_json(silent=True) or {}
    occurred_at = data.get("occurred_at")
    if not occurred_at:
        occurred_at = now().strftime("%Y-%m-%dT%H:%M")
    try:
        periods.parse_dt(occurred_at)
    except ValueError:
        return jsonify({"errors": {"occurred_at": "Fecha no válida."}}), 400
    value, duration, unit = infer_event_value(habit, data)
    event = db.create_event(
        conn,
        habit_id,
        occurred_at,
        value=value,
        unit=unit,
        duration=duration,
        notes=(data.get("notes") or "").strip() or None,
        is_demo=bool(data.get("is_demo")),
        is_minimum=bool(data.get("is_minimum")),
    )
    return jsonify(serialize_event(event)), 201


@app.route("/api/events/<int:event_id>", methods=["PUT"])
def api_update_event(event_id):
    conn = get_conn()
    event = db.get_event(conn, event_id)
    if event is None:
        return jsonify({"error": "Registro no encontrado."}), 404
    data = request.get_json(silent=True) or {}
    if "occurred_at" in data and data["occurred_at"]:
        try:
            periods.parse_dt(data["occurred_at"])
        except ValueError:
            return jsonify({"errors": {"occurred_at": "Fecha no válida."}}), 400
    updated = db.update_event(conn, event_id, data)
    return jsonify(serialize_event(updated))


@app.route("/api/events/<int:event_id>", methods=["DELETE"])
def api_delete_event(event_id):
    conn = get_conn()
    if not db.delete_event(conn, event_id):
        return jsonify({"error": "Registro no encontrado."}), 404
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# "Mañana" daily notes (free notebook). Planning never creates events.
# ---------------------------------------------------------------------------

def _note_detections(conn, content):
    habits = db.list_habits(conn)
    identities = db.list_identities(conn)
    return semantics.detect_note(content, habits, identities, conn)


@app.route("/api/notes/<date>")
def api_get_note(date):
    date = _valid_date(date)
    if date is None:
        return jsonify({"errors": {"date": "Fecha no válida."}}), 400
    conn = get_conn()
    note = db.get_daily_note(conn, date)
    content = note["content"] if note else ""
    return jsonify({
        "date": date,
        "content": content,
        "detections": _note_detections(conn, content),
        "saved_at": note["updated_at"] if note else None,
    })


@app.route("/api/notes/<date>", methods=["PUT"])
def api_save_note(date):
    date = _valid_date(date)
    if date is None:
        return jsonify({"errors": {"date": "Fecha no válida."}}), 400
    conn = get_conn()
    data = request.get_json(silent=True) or {}
    content = data.get("content")
    if content is None or not isinstance(content, str):
        return jsonify({"errors": {"content": "Formato inválido."}}), 400
    note = db.save_daily_note(conn, date, content)
    return jsonify({
        "date": date,
        "content": note["content"],
        "detections": _note_detections(conn, note["content"]),
        "saved": True,
        "saved_at": note["updated_at"],
    })


@app.route("/api/notes/<date>/done/<int:habit_id>", methods=["POST"])
def api_note_done(date, habit_id):
    """Explicitly register a planned habit as actually done (user decides)."""
    date = _valid_date(date)
    if date is None:
        return jsonify({"errors": {"date": "Fecha no válida."}}), 400
    conn = get_conn()
    habit = db.get_habit(conn, habit_id)
    if habit is None:
        return jsonify({"error": "Hábito no encontrado."}), 404
    if date == now().strftime("%Y-%m-%d"):
        occurred_at = now().strftime("%Y-%m-%dT%H:%M")
    else:
        occurred_at = f"{date}T20:00"
    value, duration, unit = infer_event_value(habit, {})
    event = db.create_event(
        conn, habit_id, occurred_at,
        value=value, unit=unit, duration=duration,
        notes=None, is_minimum=False,
    )
    return jsonify(serialize_event(event)), 201


# ---------------------------------------------------------------------------
# Global statistics
# ---------------------------------------------------------------------------

@app.route("/api/stats/global")
def api_global_stats():
    conn = get_conn()
    now_dt = now()
    habits = db.list_habits(conn)
    if not habits:
        return jsonify({
            "habits": [],
            "total_habits": 0,
            "active_habits": 0,
            "week_realizations": 0,
            "month_realizations": 0,
            "total_realizations": 0,
            "objectives_met": 0,
            "positive_trend": 0,
            "negative_trend": 0,
            "weekly_chart": [],
            "monthly_chart": [],
            "by_habit": [],
        })

    ws, we = periods.period_this_week(now_dt)
    ms, me = periods.period_this_month(now_dt)

    positive = 0
    negative = 0
    objectives_met = 0
    week_total = 0
    month_total = 0
    all_total = 0
    by_habit = []

    for h in habits:
        events = db.list_events_since(conn, h["id"], "1970-01-01T00:00")
        st = stats.habit_stats(h, events, now_dt)
        week_total += st["this_week"]
        month_total += st["this_month"]
        all_total += st["total"]
        if h["frequency_target"] and st["this_week"] >= h["frequency_target"]:
            objectives_met += 1
        if st["trend"]["direction"] == "up":
            positive += 1
        elif st["trend"]["direction"] == "down":
            negative += 1
        by_habit.append({
            **habit_summary(h, conn, now_dt),
            "stats": {k: v for k, v in st.items() if k in (
                "this_week", "prev_week", "this_month", "total", "week_average",
                "week_average_last4", "best_week", "active_days",
            )},
        })

    # Global weekly / monthly chart: aggregate counts across habits.
    weekly = {}
    monthly = {}
    for h in habits:
        events = db.list_events_since(conn, h["id"], "1970-01-01T00:00")
        for b in stats.weekly_counts(events, h["start_date"], now_dt, weeks=12):
            key = b["label"]
            weekly[key] = weekly.get(key, 0) + b["count"]
        for b in stats.monthly_counts(events, h["start_date"], now_dt):
            key = b["label"]
            monthly[key] = monthly.get(key, 0) + b["count"]

    identities = []
    for ident in db.list_identities(conn):
        votes = identity.identity_votes(ident, conn, now_dt)
        identities.append({
            "id": ident["id"], "name": ident["name"], "icon": ident["icon"],
            "color": ident["color"], "this_week": votes["this_week"], "total": votes["total"],
        })

    return jsonify({
        "total_habits": len(habits),
        "active_habits": len(habits),
        "week_realizations": week_total,
        "month_realizations": month_total,
        "total_realizations": all_total,
        "objectives_met": objectives_met,
        "positive_trend": positive,
        "negative_trend": negative,
        "weekly_chart": [{"label": k, "count": v} for k, v in weekly.items()],
        "monthly_chart": [{"label": k, "count": v} for k, v in monthly.items()],
        "by_habit": by_habit,
        "identities": identities,
    })


# ---------------------------------------------------------------------------
# Demo data
# ---------------------------------------------------------------------------

@app.route("/api/demo", methods=["POST"])
def api_load_demo():
    conn = get_conn()
    created = seed.create_demo_data(conn)
    return jsonify({"created": len(created)})


@app.route("/api/demo", methods=["DELETE"])
def api_delete_demo():
    conn = get_conn()
    habits, events = db.delete_demo_data(conn)
    return jsonify({"habits_deleted": habits, "events_deleted": events})


# ---------------------------------------------------------------------------
# Reset all user data
# ---------------------------------------------------------------------------

@app.route("/api/reset", methods=["POST"])
def api_reset_all():
    conn = get_conn()
    db.reset_all_data(conn)
    return jsonify({"reset": True})


# ---------------------------------------------------------------------------
# Feedback (local storage — NOT sent externally by the application)
# ---------------------------------------------------------------------------

VALID_FEEDBACK_TYPES = ("suggestion", "bug", "like", "other")
MAX_MESSAGE_LENGTH = 5000
MAX_TECHNICAL_FIELDS = 10


@app.route("/api/feedback", methods=["POST"])
def api_create_feedback():
    conn = get_conn()
    data = request.get_json(silent=True) or {}

    feedback_type = (data.get("type") or "").strip()
    if feedback_type not in VALID_FEEDBACK_TYPES:
        return jsonify({"errors": {"type": "Tipo de feedback no válido."}}), 400

    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"errors": {"message": "El mensaje es obligatorio."}}), 400
    if len(message) > MAX_MESSAGE_LENGTH:
        return jsonify({"errors": {"message": f"El mensaje es demasiado largo (máximo {MAX_MESSAGE_LENGTH} caracteres)."}}), 400

    technical_info = data.get("technical_info")
    if technical_info is not None:
        if not isinstance(technical_info, dict):
            return jsonify({"errors": {"technical_info": "Formato inválido."}}), 400
        if len(technical_info) > MAX_TECHNICAL_FIELDS:
            return jsonify({"errors": {"technical_info": "Demasiados campos técnicos."}}), 400
        # Sanitize: only allow string values, max 200 chars each
        sanitized = {}
        for k, v in list(technical_info.items())[:MAX_TECHNICAL_FIELDS]:
            if isinstance(v, str):
                sanitized[str(k)[:50]] = v[:200]
            elif isinstance(v, (int, float)):
                sanitized[str(k)[:50]] = str(v)[:200]
        technical_info = sanitized if sanitized else None

    saved = db.create_feedback(conn, feedback_type, message, technical_info)
    return jsonify({"ok": True, "id": saved["id"]}), 201


def local_ip():
    """Best-effort local LAN IP, falling back to loopback."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    db.init_db()
    debug = os.environ.get("FLASK_DEBUG") == "1"
    port = 5000
    ip = local_ip()
    print("HabitTracker disponible en:")
    print()
    print(f"  Local:   http://127.0.0.1:{port}")
    if ip != "127.0.0.1":
        print(f"  Red:     http://{ip}:{port}")
    print()
    # 0.0.0.0 serves both localhost and other devices on the same LAN
    # (Windows may prompt to allow inbound access on first run).
    app.run(host="0.0.0.0", port=port, debug=debug, use_reloader=False)