"""Database layer: schema, connection and CRUD operations.

All dates/datetimes are stored as local time ISO strings. The app is a local
single-user tool, so local time is the canonical timezone. Daylight saving is
handled by Python's localtime semantics at display time.
"""
import json
import os
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "habits.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'boolean',
    unit TEXT,
    target_value REAL,
    target_unit TEXT,
    frequency_type TEXT NOT NULL DEFAULT 'weekly',
    frequency_target INTEGER DEFAULT 1,
    frequency_days TEXT,
    cue TEXT,
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_time TEXT,
    reminder_days TEXT,
    color TEXT DEFAULT '#4f7cff',
    icon TEXT DEFAULT 'star',
    start_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    occurred_at TEXT NOT NULL,
    value REAL,
    unit TEXT,
    duration INTEGER,
    notes TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_habit ON events(habit_id);
CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at);
"""

IDENTITY_SCHEMA = """
CREATE TABLE IF NOT EXISTS identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT 'star',
    color TEXT DEFAULT '#4f7cff',
    active INTEGER NOT NULL DEFAULT 1,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

OBSTACLES_SCHEMA = """
CREATE TABLE IF NOT EXISTS obstacles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    obstacle TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start TEXT NOT NULL,
    answer TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(week_start)
);
"""

IDENTITY_LINKS_SCHEMA = """
CREATE TABLE IF NOT EXISTS identity_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    identity_id INTEGER NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'linked',
    source TEXT NOT NULL DEFAULT 'semantic',
    confidence REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(habit_id, identity_id)
);

CREATE TABLE IF NOT EXISTS daily_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

SETTINGS_SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

FEEDBACK_SCHEMA = """
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    technical_info TEXT,
    created_at TEXT NOT NULL
);
"""

# Columns added in later versions. `_migrate` adds them idempotently so
# existing databases keep working without data loss.
HABIT_NEW_COLUMNS = [
    ("identity_id", "INTEGER REFERENCES identities(id)"),
    ("minimum_value", "REAL"),
    ("minimum_unit", "TEXT"),
    ("minimum_description", "TEXT"),
    ("environment", "TEXT"),
    ("location", "TEXT"),
    ("attraction_strategy", "TEXT"),
    ("friction_strategy", "TEXT"),
    ("reward_strategy", "TEXT"),
]

EVENT_NEW_COLUMNS = [
    ("is_minimum", "INTEGER NOT NULL DEFAULT 0"),
]

IDENTITY_NEW_COLUMNS = [
    ("is_demo", "INTEGER NOT NULL DEFAULT 0"),
]

OBSTACLE_NEW_COLUMNS = [
    ("type", "TEXT"),
]


def _ensure_columns(conn, table, columns):
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    for name, declaration in columns:
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")


def get_connection(db_path=None):
    path = db_path or os.environ.get("HABIT_DB_PATH") or DB_PATH
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path=None):
    conn = get_connection(db_path)
    try:
        conn.executescript(SCHEMA)
        conn.executescript(IDENTITY_SCHEMA)
        conn.executescript(OBSTACLES_SCHEMA)
        conn.executescript(IDENTITY_LINKS_SCHEMA)
        conn.executescript(SETTINGS_SCHEMA)
        conn.executescript(FEEDBACK_SCHEMA)
        _ensure_columns(conn, "habits", HABIT_NEW_COLUMNS)
        _ensure_columns(conn, "events", EVENT_NEW_COLUMNS)
        _ensure_columns(conn, "identities", IDENTITY_NEW_COLUMNS)
        _ensure_columns(conn, "obstacles", OBSTACLE_NEW_COLUMNS)
        conn.commit()
    finally:
        conn.close()


def now_iso():
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _habit_from_row(row):
    if row is None:
        return None
    habit = dict(row)
    for key in ("frequency_days", "reminder_days"):
        if habit.get(key):
            try:
                habit[key] = json.loads(habit[key])
            except (TypeError, ValueError):
                habit[key] = []
        else:
            habit[key] = []
    habit["active"] = bool(habit["active"])
    habit["reminder_enabled"] = bool(habit["reminder_enabled"])
    habit["is_demo"] = bool(habit["is_demo"])
    return habit


def _event_from_row(row):
    if row is None:
        return None
    return dict(row)


def _identity_from_row(row):
    if row is None:
        return None
    identity = dict(row)
    identity["active"] = bool(identity["active"])
    identity["is_demo"] = bool(identity["is_demo"])
    return identity


# ---------------------------------------------------------------------------
# Identities
# ---------------------------------------------------------------------------

def list_identities(conn, include_inactive=False):
    sql = "SELECT * FROM identities"
    if not include_inactive:
        sql += " WHERE active = 1"
    sql += " ORDER BY active DESC, created_at ASC"
    return [_identity_from_row(r) for r in conn.execute(sql).fetchall()]


def get_identity(conn, identity_id):
    row = conn.execute("SELECT * FROM identities WHERE id = ?", (identity_id,)).fetchone()
    return _identity_from_row(row)


def create_identity(conn, data):
    fields = {
        "name": (data.get("name") or "").strip(),
        "description": (data.get("description") or "").strip() or None,
        "icon": data.get("icon") or "star",
        "color": data.get("color") or "#4f7cff",
        "is_demo": 1 if data.get("is_demo") else 0,
    }
    ts = now_iso()
    fields["created_at"] = ts
    fields["updated_at"] = ts
    cols = ", ".join(fields.keys())
    placeholders = ", ".join("?" for _ in fields)
    cur = conn.execute(
        f"INSERT INTO identities ({cols}) VALUES ({placeholders})",
        tuple(fields.values()),
    )
    conn.commit()
    return get_identity(conn, cur.lastrowid)


def update_identity(conn, identity_id, data):
    identity = get_identity(conn, identity_id)
    if identity is None:
        return None
    merged = dict(identity)
    for key in ("name", "description", "icon", "color"):
        if key in data:
            merged[key] = data[key]
    if "active" in data:
        merged["active"] = bool(data["active"])
    conn.execute(
        """UPDATE identities SET name = ?, description = ?, icon = ?, color = ?,
           active = ?, updated_at = ? WHERE id = ?""",
        (
            (merged["name"] or "").strip(),
            (merged.get("description") or "").strip() or None,
            merged.get("icon", "star"),
            merged.get("color", "#4f7cff"),
            1 if merged["active"] else 0,
            now_iso(),
            identity_id,
        ),
    )
    conn.commit()
    return get_identity(conn, identity_id)


def delete_identity(conn, identity_id):
    """Remove an identity. Its habits stay but lose the link (become unassigned)."""
    identity = get_identity(conn, identity_id)
    if identity is None:
        return False
    conn.execute("UPDATE habits SET identity_id = NULL WHERE identity_id = ?", (identity_id,))
    cur = conn.execute("DELETE FROM identities WHERE id = ?", (identity_id,))
    conn.commit()
    return cur.rowcount > 0


def identity_habit_count(conn, identity_id):
    row = conn.execute("SELECT COUNT(*) AS n FROM habits WHERE identity_id = ? AND active = 1", (identity_id,)).fetchone()
    return row["n"] if row else 0


def identity_events(conn, identity_id, since_iso="1970-01-01T00:00", include_demo=True):
    """All events belonging to habits linked to an identity."""
    sql = """
        SELECT e.* FROM events e
        JOIN habits h ON h.id = e.habit_id
        WHERE h.identity_id = ? AND e.occurred_at >= ?
    """
    params = [identity_id, since_iso]
    if not include_demo:
        sql += " AND e.is_demo = 0 AND h.is_demo = 0"
    sql += " ORDER BY e.occurred_at ASC, e.id ASC"
    return [_event_from_row(r) for r in conn.execute(sql, tuple(params)).fetchall()]


# ---------------------------------------------------------------------------
# Habits
# ---------------------------------------------------------------------------

def list_habits(conn, include_inactive=False):
    sql = "SELECT * FROM habits"
    if not include_inactive:
        sql += " WHERE active = 1"
    sql += " ORDER BY active DESC, created_at ASC"
    rows = conn.execute(sql).fetchall()
    return [_habit_from_row(r) for r in rows]


def get_habit(conn, habit_id):
    row = conn.execute("SELECT * FROM habits WHERE id = ?", (habit_id,)).fetchone()
    return _habit_from_row(row)


def create_habit(conn, data):
    fields = {
        "name": data.get("name", "").strip(),
        "description": (data.get("description") or "").strip() or None,
        "type": data.get("type", "boolean"),
        "unit": data.get("unit"),
        "target_value": data.get("target_value"),
        "target_unit": data.get("target_unit"),
        "frequency_type": data.get("frequency_type", "weekly"),
        "frequency_target": data.get("frequency_target", 1),
        "frequency_days": json.dumps(data.get("frequency_days", [])),
        "cue": (data.get("cue") or "").strip() or None,
        "reminder_enabled": 1 if data.get("reminder_enabled") else 0,
        "reminder_time": data.get("reminder_time"),
        "reminder_days": json.dumps(data.get("reminder_days", [])),
        "color": data.get("color", "#4f7cff"),
        "icon": data.get("icon", "star"),
        "start_date": data.get("start_date") or datetime.now().strftime("%Y-%m-%d"),
        "is_demo": 1 if data.get("is_demo") else 0,
        "identity_id": data.get("identity_id"),
        "minimum_value": data.get("minimum_value"),
        "minimum_unit": (data.get("minimum_unit") or "").strip() or None,
        "minimum_description": (data.get("minimum_description") or "").strip() or None,
        "environment": (data.get("environment") or "").strip() or None,
        "location": (data.get("location") or "").strip() or None,
        "attraction_strategy": (data.get("attraction_strategy") or "").strip() or None,
        "friction_strategy": (data.get("friction_strategy") or "").strip() or None,
        "reward_strategy": (data.get("reward_strategy") or "").strip() or None,
    }
    ts = now_iso()
    fields["created_at"] = ts
    fields["updated_at"] = ts
    cols = ", ".join(fields.keys())
    placeholders = ", ".join("?" for _ in fields)
    cur = conn.execute(
        f"INSERT INTO habits ({cols}) VALUES ({placeholders})",
        tuple(fields.values()),
    )
    conn.commit()
    return get_habit(conn, cur.lastrowid)


def update_habit(conn, habit_id, data):
    habit = get_habit(conn, habit_id)
    if habit is None:
        return None
    merged = dict(habit)
    for key in (
        "name", "description", "type", "unit", "target_value", "target_unit",
        "frequency_type", "frequency_target", "cue", "color", "icon",
        "start_date", "reminder_time", "identity_id", "minimum_value",
        "minimum_unit", "minimum_description", "environment", "location",
        "attraction_strategy", "friction_strategy", "reward_strategy",
    ):
        if key in data:
            merged[key] = data[key]
    for key in ("frequency_days", "reminder_days"):
        if key in data:
            merged[key] = data.get(key) or []
    if "reminder_enabled" in data:
        merged["reminder_enabled"] = bool(data["reminder_enabled"])
    if "active" in data:
        merged["active"] = bool(data["active"])

    sql = """
        UPDATE habits SET
            name = ?, description = ?, type = ?, unit = ?, target_value = ?,
            target_unit = ?, frequency_type = ?, frequency_target = ?,
            frequency_days = ?, cue = ?, reminder_enabled = ?,
            reminder_time = ?, reminder_days = ?, color = ?, icon = ?,
            start_date = ?, active = ?, is_demo = ?, identity_id = ?,
            minimum_value = ?, minimum_unit = ?, minimum_description = ?,
            environment = ?, location = ?, attraction_strategy = ?,
            friction_strategy = ?, reward_strategy = ?, updated_at = ?
        WHERE id = ?
    """
    conn.execute(
        sql,
        (
            (merged["name"] or "").strip(),
            (merged.get("description") or "").strip() or None,
            merged["type"],
            merged.get("unit"),
            merged.get("target_value"),
            merged.get("target_unit"),
            merged["frequency_type"],
            merged.get("frequency_target") or 0,
            json.dumps(merged.get("frequency_days") or []),
            (merged.get("cue") or "").strip() or None,
            1 if merged["reminder_enabled"] else 0,
            merged.get("reminder_time"),
            json.dumps(merged.get("reminder_days") or []),
            merged.get("color", "#4f7cff"),
            merged.get("icon", "star"),
            merged.get("start_date") or datetime.now().strftime("%Y-%m-%d"),
            1 if merged["active"] else 0,
            1 if merged.get("is_demo") else 0,
            merged.get("identity_id"),
            merged.get("minimum_value"),
            (merged.get("minimum_unit") or "").strip() or None,
            (merged.get("minimum_description") or "").strip() or None,
            (merged.get("environment") or "").strip() or None,
            (merged.get("location") or "").strip() or None,
            (merged.get("attraction_strategy") or "").strip() or None,
            (merged.get("friction_strategy") or "").strip() or None,
            (merged.get("reward_strategy") or "").strip() or None,
            now_iso(),
            habit_id,
        ),
    )
    conn.commit()
    return get_habit(conn, habit_id)


def delete_habit(conn, habit_id):
    cur = conn.execute("DELETE FROM habits WHERE id = ?", (habit_id,))
    conn.commit()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def list_events(conn, habit_id=None, limit=None, offset=None, include_demo=True):
    sql = "SELECT * FROM events"
    params = []
    if habit_id is not None:
        sql += " WHERE habit_id = ?"
        params.append(habit_id)
    if not include_demo:
        sql += " AND is_demo = 0" if not params else " AND is_demo = 0"
    sql += " ORDER BY occurred_at DESC, id DESC"
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    if offset:
        sql += " OFFSET ?"
        params.append(offset)
    rows = conn.execute(sql, tuple(params)).fetchall()
    return [_event_from_row(r) for r in rows]


def list_events_since(conn, habit_id, since_iso, include_demo=True):
    """Events for a habit with occurred_at >= since_iso (ordered ascending)."""
    sql = "SELECT * FROM events WHERE habit_id = ? AND occurred_at >= ?"
    params = [habit_id, since_iso]
    if not include_demo:
        sql += " AND is_demo = 0"
    sql += " ORDER BY occurred_at ASC, id ASC"
    rows = conn.execute(sql, tuple(params)).fetchall()
    return [_event_from_row(r) for r in rows]


def create_event(conn, habit_id, occurred_at, value=None, unit=None, duration=None, notes=None, is_demo=False, is_minimum=False):
    cur = conn.execute(
        """INSERT INTO events (habit_id, occurred_at, value, unit, duration, notes, is_demo, is_minimum, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (habit_id, occurred_at, value, unit, duration, notes, 1 if is_demo else 0, 1 if is_minimum else 0, now_iso()),
    )
    conn.commit()
    return get_event(conn, cur.lastrowid)


def get_event(conn, event_id):
    row = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    return _event_from_row(row)


def update_event(conn, event_id, data):
    event = get_event(conn, event_id)
    if event is None:
        return None
    occurred_at = data.get("occurred_at", event["occurred_at"])
    conn.execute(
        """UPDATE events SET occurred_at = ?, value = ?, unit = ?, duration = ?, notes = ?, is_minimum = ?
           WHERE id = ?""",
        (
            occurred_at,
            data.get("value", event["value"]),
            data.get("unit", event["unit"]),
            data.get("duration", event["duration"]),
            data.get("notes", event["notes"]),
            1 if data.get("is_minimum", event["is_minimum"]) else 0,
            event_id,
        ),
    )
    conn.commit()
    return get_event(conn, event_id)


def delete_event(conn, event_id):
    cur = conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
    conn.commit()
    return cur.rowcount > 0


def habit_event_count(conn, habit_id):
    row = conn.execute("SELECT COUNT(*) AS n FROM events WHERE habit_id = ?", (habit_id,)).fetchone()
    return row["n"] if row else 0


def delete_demo_data(conn):
    cur = conn.execute("DELETE FROM events WHERE is_demo = 1")
    n_events = cur.rowcount
    cur = conn.execute("DELETE FROM obstacles WHERE habit_id IN (SELECT id FROM habits WHERE is_demo = 1)")
    conn.execute(
        "DELETE FROM identity_links WHERE habit_id IN (SELECT id FROM habits WHERE is_demo = 1) "
        "OR identity_id IN (SELECT id FROM identities WHERE is_demo = 1)"
    )
    cur = conn.execute("DELETE FROM habits WHERE is_demo = 1")
    n_habits = cur.rowcount
    cur = conn.execute("DELETE FROM identities WHERE is_demo = 1")
    n_identities = cur.rowcount
    conn.commit()
    return n_habits, n_events


def reset_all_data(conn):
    """Delete every user-created row (including demo data) in one transaction.

    Keeps the schema, tables, migrations and the file itself intact; only the
    rows disappear. Auto-increment counters are reset so the app behaves like
    a fresh install.
    """
    conn.execute("DELETE FROM events")
    conn.execute("DELETE FROM obstacles")
    conn.execute("DELETE FROM reviews")
    conn.execute("DELETE FROM daily_notes")
    conn.execute("DELETE FROM identity_links")
    conn.execute("DELETE FROM habits")
    conn.execute("DELETE FROM identities")
    has_seq = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'"
    ).fetchone()
    if has_seq:
        conn.execute(
            "DELETE FROM sqlite_sequence WHERE name IN "
            "('identities', 'habits', 'events', 'obstacles', 'reviews', 'identity_links', 'daily_notes')"
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Obstacles & weekly review
# ---------------------------------------------------------------------------

def create_obstacle(conn, habit_id, obstacle, note=None, otype=None):
    cur = conn.execute(
        """INSERT INTO obstacles (habit_id, obstacle, note, type, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (habit_id, obstacle, (note or "").strip() or None, (otype or "").strip() or None, now_iso()),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM obstacles WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)


def list_obstacles(conn, habit_id=None, limit=10):
    sql = "SELECT * FROM obstacles"
    params = []
    if habit_id is not None:
        sql += " WHERE habit_id = ?"
        params.append(habit_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    return [dict(r) for r in conn.execute(sql, tuple(params)).fetchall()]


def obstacle_counts(conn, habit_id):
    """Per-obstacle counts for a habit (most frequent first)."""
    rows = conn.execute(
        """SELECT obstacle, COUNT(*) AS count
           FROM obstacles WHERE habit_id = ?
           GROUP BY obstacle ORDER BY count DESC, obstacle ASC""",
        (habit_id,),
    ).fetchall()
    return [{"obstacle": r["obstacle"], "count": r["count"]} for r in rows]


def main_obstacle(conn, habit_id, min_records=3):
    """Most common obstacle for a habit, only when there is enough evidence.

    Returns None until at least `min_records` records of the same obstacle
    exist AND it clearly dominates the others. Never draw conclusions too soon.
    """
    counts = conn.execute(
        """SELECT obstacle, COUNT(*) AS count
           FROM obstacles WHERE habit_id = ?
           GROUP BY obstacle ORDER BY count DESC, obstacle ASC""",
        (habit_id,),
    ).fetchall()
    if not counts:
        return None
    top = counts[0]
    if top["count"] < min_records:
        return None
    second = counts[1]["count"] if len(counts) > 1 else 0
    if top["count"] <= second:
        return None
    return {"obstacle": top["obstacle"], "count": top["count"]}


def save_review_answer(conn, week_start, answer):
    ts = now_iso()
    conn.execute(
        """INSERT INTO reviews (week_start, answer, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(week_start) DO UPDATE SET answer = excluded.answer, updated_at = excluded.updated_at""",
        (week_start, (answer or "").strip() or None, ts, ts),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM reviews WHERE week_start = ?", (week_start,)).fetchone()
    return dict(row)


def get_review_answer(conn, week_start):
    row = conn.execute("SELECT * FROM reviews WHERE week_start = ?", (week_start,)).fetchone()
    return dict(row) if row else None


def has_any_habit(conn):
    row = conn.execute("SELECT COUNT(*) AS n FROM habits").fetchone()
    return (row["n"] if row else 0) > 0


# ---------------------------------------------------------------------------
# Semantic identity links (habits <-> identities, many-to-many)
# ---------------------------------------------------------------------------

def list_identity_links(conn, habit_id=None, identity_id=None):
    sql = "SELECT * FROM identity_links"
    params = []
    if habit_id is not None:
        sql += " WHERE habit_id = ?"
        params.append(habit_id)
    elif identity_id is not None:
        sql += " WHERE identity_id = ?"
        params.append(identity_id)
    sql += " ORDER BY id ASC"
    return [dict(r) for r in conn.execute(sql, tuple(params)).fetchall()]


def get_identity_link(conn, habit_id, identity_id):
    row = conn.execute(
        "SELECT * FROM identity_links WHERE habit_id = ? AND identity_id = ?",
        (habit_id, identity_id),
    ).fetchone()
    return dict(row) if row else None


def set_identity_link(conn, habit_id, identity_id, status, source="semantic", confidence=None):
    ts = now_iso()
    existing = get_identity_link(conn, habit_id, identity_id)
    if existing:
        conn.execute(
            "UPDATE identity_links SET status = ?, source = ?, confidence = ?, updated_at = ? WHERE id = ?",
            (status, source, confidence, ts, existing["id"]),
        )
    else:
        conn.execute(
            "INSERT INTO identity_links (habit_id, identity_id, status, source, confidence, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (habit_id, identity_id, status, source, confidence, ts, ts),
        )
    conn.commit()
    return get_identity_link(conn, habit_id, identity_id)


def delete_identity_link(conn, habit_id, identity_id):
    cur = conn.execute(
        "DELETE FROM identity_links WHERE habit_id = ? AND identity_id = ?",
        (habit_id, identity_id),
    )
    conn.commit()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Daily notes ("Mañana" free notebook, one note per date)
# ---------------------------------------------------------------------------

def get_daily_note(conn, date):
    row = conn.execute("SELECT * FROM daily_notes WHERE date = ?", (date,)).fetchone()
    return dict(row) if row else None


def save_daily_note(conn, date, content):
    ts = now_iso()
    existing = conn.execute("SELECT id FROM daily_notes WHERE date = ?", (date,)).fetchone()
    if existing:
        conn.execute(
            "UPDATE daily_notes SET content = ?, updated_at = ? WHERE id = ?",
            (content, ts, existing["id"]),
        )
    else:
        conn.execute(
            "INSERT INTO daily_notes (date, content, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (date, content, ts, ts),
        )
    conn.commit()
    return get_daily_note(conn, date)


# ---------------------------------------------------------------------------
# Settings (key-value preferences, kept across resets)
# ---------------------------------------------------------------------------

def get_setting(conn, key):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(conn, key, value):
    """Store a setting. A None/empty value removes the key."""
    if value is None or str(value).strip() == "":
        conn.execute("DELETE FROM settings WHERE key = ?", (key,))
    else:
        ts = now_iso()
        conn.execute(
            """INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (key, str(value).strip(), ts),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Feedback (local storage — NOT sent externally by the application)
# ---------------------------------------------------------------------------

def create_feedback(conn, feedback_type, message, technical_info=None):
    """Store a feedback submission locally. This is local storage only;
    the application does NOT forward it to any external service.
    An external adapter can be connected later if desired."""
    ts = now_iso()
    cur = conn.execute(
        """INSERT INTO feedback (type, message, technical_info, created_at)
           VALUES (?, ?, ?, ?)""",
        (feedback_type, message, json.dumps(technical_info) if technical_info else None, ts),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM feedback WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)


def list_feedback(conn, limit=50):
    rows = conn.execute(
        "SELECT * FROM feedback ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    return [dict(r) for r in rows]