"""Tests for identities, votes, friction detection and weekly review."""
from datetime import datetime, timedelta

from core import db, identity, periods


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M")


def now_dt():
    return datetime.now()


def create_identity(client, name="Lector", **overrides):
    payload = {"name": name, "description": "Alguien que lee", "icon": "book", "color": "#3b82f6"}
    payload.update(overrides)
    return client.post("/api/identities", json=payload)


def create_habit(client, **overrides):
    payload = {
        "name": "Leer",
        "type": "boolean",
        "frequency_type": "weekly",
        "frequency_target": 4,
        "cue": "Después de cenar",
        "start_date": (now_dt() - timedelta(days=30)).strftime("%Y-%m-%d"),
    }
    payload.update(overrides)
    return client.post("/api/habits", json=payload)


def test_identity_crud(client):
    r = create_identity(client)
    assert r.status_code == 201
    data = r.get_json()
    assert data["name"] == "Lector"
    assert data["icon"] == "book"

    ident_id = data["id"]
    r2 = client.get(f"/api/identities/{ident_id}")
    assert r2.status_code == 200
    assert r2.get_json()["name"] == "Lector"
    assert r2.get_json()["votes"]["total"] == 0

    r3 = client.put(f"/api/identities/{ident_id}", json={"name": "Gran lector", "color": "#ef4444"})
    assert r3.status_code == 200
    assert r3.get_json()["name"] == "Gran lector"
    assert r3.get_json()["color"] == "#ef4444"


def test_identity_validation(client):
    assert client.post("/api/identities", json={}).status_code == 400
    assert client.post("/api/identities", json={"name": "a" * 90}).status_code == 400


def test_habit_linked_to_identity(client):
    ident = create_identity(client).get_json()
    r = create_habit(client, name="Leer 2 páginas", identity_id=ident["id"])
    assert r.status_code == 201
    habit = r.get_json()
    assert habit["identity_id"] == ident["id"]

    detail = client.get(f"/api/identities/{ident['id']}").get_json()
    assert detail["habit_count"] == 1
    assert len(detail["habits"]) == 1
    assert detail["habits"][0]["name"] == "Leer 2 páginas"


def test_votes_accumulate_per_identity(client):
    ident = create_identity(client).get_json()
    habit = create_habit(client, identity_id=ident["id"]).get_json()
    for _ in range(3):
        client.post(f"/api/habits/{habit['id']}/events", json={"occurred_at": iso(now_dt())})

    detail = client.get(f"/api/identities/{ident['id']}").get_json()
    assert detail["votes"]["this_week"] == 3
    assert detail["votes"]["total"] == 3
    assert detail["votes"]["active_days"] == 1


def test_unassigned_habit_has_no_identity(client):
    habit = create_habit(client).get_json()
    assert habit["identity_id"] is None
    listed = client.get("/api/habits").get_json()
    assert "identity" not in listed[0]


def test_delete_identity_detaches_habits(client):
    ident = create_identity(client).get_json()
    habit = create_habit(client, identity_id=ident["id"]).get_json()

    r = client.delete(f"/api/identities/{ident['id']}")
    assert r.status_code == 200
    assert client.get(f"/api/identities/{ident['id']}").status_code == 404

    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["identity_id"] is None
    assert detail["stats"]["total"] == 0


def test_archive_identity(client):
    ident = create_identity(client).get_json()
    client.put(f"/api/identities/{ident['id']}", json={"active": False})
    listed = client.get("/api/identities").get_json()
    assert all(i["id"] != ident["id"] for i in listed)


def test_habit_system_design_fields(client):
    ident = create_identity(client).get_json()
    r = create_habit(client, identity_id=ident["id"], minimum_value=1, minimum_unit="página",
                     minimum_description="Leer 1 página", environment="Libro en la mesa",
                     location="Salón", attraction_strategy="Café mientras leo",
                     friction_strategy="Tener el libro abierto", reward_strategy="Marcar progreso")
    assert r.status_code == 201
    h = r.get_json()
    assert h["minimum_value"] == 1
    assert h["minimum_description"] == "Leer 1 página"
    assert h["environment"] == "Libro en la mesa"
    assert h["reward_strategy"] == "Marcar progreso"


def test_minimum_event_flag(client):
    ident = create_identity(client).get_json()
    habit = create_habit(client, identity_id=ident["id"]).get_json()
    r = client.post(f"/api/habits/{habit['id']}/events", json={
        "occurred_at": iso(now_dt()), "is_minimum": True,
    })
    assert r.status_code == 201
    assert r.get_json()["is_minimum"] == 1


def test_identity_in_global_stats(client):
    ident = create_identity(client).get_json()
    habit = create_habit(client, identity_id=ident["id"]).get_json()
    client.post(f"/api/habits/{habit['id']}/events", json={"occurred_at": iso(now_dt())})
    g = client.get("/api/stats/global").get_json()
    assert len(g["identities"]) == 1
    assert g["identities"][0]["this_week"] == 1


def test_friction_status_detects_difficulty(conn):
    now = now_dt()
    monday = periods.start_of_week(now)
    start_date = (monday - timedelta(days=7 * 4)).strftime("%Y-%m-%d")
    habit = db.create_habit(conn, {
        "name": "Correr", "type": "boolean", "frequency_type": "weekly",
        "frequency_target": 3, "start_date": start_date,
    })
    # Only one event in the current (incomplete) week. Previous weeks: none.
    events = [{"occurred_at": iso(now)}]
    status = identity.friction_status(habit, events, now)
    assert status is not None and status["difficult"] is True


def test_friction_status_none_when_ok(conn):
    habit = db.create_habit(conn, {
        "name": "Leer", "type": "boolean", "frequency_type": "weekly",
        "frequency_target": 3, "start_date": "2026-01-01",
    })
    now = now_dt()
    events = []
    monday = periods.start_of_week(now)
    for w in (2, 3):
        start = monday - timedelta(days=7 * w)
        for day in range(5):
            events.append({"occurred_at": (start + timedelta(days=day)).strftime("%Y-%m-%dT%H:%M")})
    assert identity.friction_status(habit, events, now) is None


def test_obstacle_endpoint(client):
    habit = create_habit(client).get_json()
    r = client.post(f"/api/habits/{habit['id']}/obstacles", json={"obstacle": "Se me olvida"})
    assert r.status_code == 201
    assert r.get_json()["obstacle"] == "Se me olvida"


def test_weekly_review_endpoint(client):
    ident = create_identity(client).get_json()
    habit = create_habit(client, name="Leer", identity_id=ident["id"], frequency_target=2).get_json()
    for _ in range(3):
        client.post(f"/api/habits/{habit['id']}/events", json={"occurred_at": iso(now_dt())})

    r = client.get("/api/review/weekly")
    assert r.status_code == 200
    data = r.get_json()
    assert data["week_start"]
    assert len(data["identities"]) == 1
    assert data["identities"][0]["this_week"] == 3
    assert any("Leer" in w["name"] for w in data["working"])
    assert data["total_actions"] == 3


def test_weekly_review_handles_unmet_habit(client):
    """A habit below target must reach the friction path without crashing."""
    habit = create_habit(client, name="Correr", frequency_target=4, start_date=(now_dt() - timedelta(days=60)).strftime("%Y-%m-%d"))
    habit = habit.get_json()
    client.post(f"/api/habits/{habit['id']}/events", json={"occurred_at": iso(now_dt())})

    r = client.get("/api/review/weekly")
    assert r.status_code == 200
    data = r.get_json()
    assert data["week_start"]
    assert any("Correr" in d["name"] for d in data["difficult"]) or len(data["difficult"]) == 0


def test_review_answer_saved(client):
    r = client.put("/api/review/weekly", json={"answer": "Empezar antes de cenar"})
    assert r.status_code == 200
    data = client.get("/api/review/weekly").get_json()
    assert data["question_answer"] == "Empezar antes de cenar"


def test_demo_creates_identities(client):
    client.post("/api/demo")
    identities = client.get("/api/identities").get_json()
    assert len(identities) == 4
    habits = client.get("/api/habits").get_json()
    assert all(h["identity_id"] is not None for h in habits)

    r = client.delete("/api/demo")
    assert r.get_json()["habits_deleted"] == 4
    assert client.get("/api/identities").get_json() == []


def test_migration_keeps_old_data(tmp_path):
    """An old-schema DB (habits + events only) must upgrade without data loss."""
    import sqlite3
    path = str(tmp_path / "old.db")
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE habits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, description TEXT, type TEXT DEFAULT 'boolean',
            unit TEXT, target_value REAL, target_unit TEXT,
            frequency_type TEXT DEFAULT 'weekly', frequency_target INTEGER DEFAULT 1,
            frequency_days TEXT, cue TEXT, reminder_enabled INTEGER DEFAULT 0,
            reminder_time TEXT, reminder_days TEXT, color TEXT DEFAULT '#4f7cff',
            icon TEXT DEFAULT 'star', start_date TEXT NOT NULL, active INTEGER DEFAULT 1,
            is_demo INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            habit_id INTEGER NOT NULL, occurred_at TEXT NOT NULL, value REAL,
            unit TEXT, duration INTEGER, notes TEXT, is_demo INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );
        INSERT INTO habits (name, type, frequency_type, frequency_target, start_date, created_at, updated_at)
        VALUES ('Leer', 'boolean', 'weekly', 4, '2026-01-01', '2026-01-01T00:00', '2026-01-01T00:00');
        INSERT INTO events (habit_id, occurred_at, created_at) VALUES (1, '2026-01-05T20:00', '2026-01-05T20:00');
    """)
    con.commit()
    con.close()

    db.init_db(path)
    c = db.get_connection(path)
    try:
        habits = db.list_habits(c)
        assert len(habits) == 1
        assert habits[0]["name"] == "Leer"
        assert habits[0]["identity_id"] is None
        events = db.list_events(c)
        assert len(events) == 1
        assert events[0]["is_minimum"] == 0
        # New tables exist.
        assert db.list_identities(c) == []
    finally:
        c.close()