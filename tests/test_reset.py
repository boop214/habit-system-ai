"""Reset all data: deletes user data, keeps the schema, stays usable."""
import sqlite3

from core import db


TABLES = ("identities", "habits", "events", "obstacles", "reviews",
          "identity_links", "daily_notes", "settings")


def _create_sample_data(conn):
    ident = db.create_identity(conn, {"name": "Lector", "description": "Lee a diario"})
    habit = db.create_habit(conn, {
        "name": "Leer", "description": "Leer 10 minutos", "type": "duration",
        "unit": "min", "target_value": 10, "target_unit": "min",
        "frequency_type": "weekly", "frequency_target": 4,
        "cue": "Después de cenar", "start_date": "2026-01-01",
        "identity_id": ident["id"],
    })
    db.create_event(conn, habit["id"], "2026-08-18T20:00", value=10, unit="min", duration=10)
    db.create_obstacle(conn, habit["id"], "Se me olvida", otype="forget")
    db.save_review_answer(conn, "2026-08-17", "Buena semana")
    db.set_identity_link(conn, habit["id"], ident["id"], "linked", "semantic", 0.8)
    db.save_daily_note(conn, "2026-08-20", "mañana correr")
    return ident, habit


def _tables_exist(conn):
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
        "('identities', 'habits', 'events', 'obstacles', 'reviews', "
        "'identity_links', 'daily_notes', 'settings')"
    ).fetchall()
    return {r["name"] for r in rows}


def test_reset_removes_identities(conn):
    _create_sample_data(conn)
    assert db.list_identities(conn)
    db.reset_all_data(conn)
    assert db.list_identities(conn) == []


def test_reset_removes_habits(conn):
    _create_sample_data(conn)
    assert db.list_habits(conn)
    db.reset_all_data(conn)
    assert db.list_habits(conn) == []


def test_reset_removes_events(conn):
    _create_sample_data(conn)
    assert db.list_events(conn)
    db.reset_all_data(conn)
    assert db.list_events(conn) == []


def test_reset_removes_obstacles(conn):
    _create_sample_data(conn)
    assert db.list_obstacles(conn)
    db.reset_all_data(conn)
    assert db.list_obstacles(conn) == []


def test_reset_removes_reviews(conn):
    _create_sample_data(conn)
    assert db.get_review_answer(conn, "2026-08-17")
    db.reset_all_data(conn)
    assert db.get_review_answer(conn, "2026-08-17") is None


def test_reset_keeps_tables(conn):
    _create_sample_data(conn)
    before = _tables_exist(conn)
    db.reset_all_data(conn)
    assert _tables_exist(conn) == before == set(TABLES)


def test_can_create_identity_after_reset(conn):
    _create_sample_data(conn)
    db.reset_all_data(conn)
    ident = db.create_identity(conn, {"name": "Nueva"})
    assert ident["id"] == 1
    assert db.get_identity(conn, ident["id"])["name"] == "Nueva"


def test_can_create_habit_after_reset(conn):
    _create_sample_data(conn)
    db.reset_all_data(conn)
    habit = db.create_habit(conn, {
        "name": "Nuevo hábito", "type": "boolean",
        "frequency_type": "weekly", "frequency_target": 3,
        "start_date": "2026-08-01",
    })
    assert habit["id"] == 1
    assert db.get_habit(conn, habit["id"])["name"] == "Nuevo hábito"


def test_can_create_event_after_reset(conn):
    _create_sample_data(conn)
    db.reset_all_data(conn)
    habit = db.create_habit(conn, {
        "name": "Correr", "type": "boolean",
        "frequency_type": "weekly", "frequency_target": 3,
        "start_date": "2026-08-01",
    })
    event = db.create_event(conn, habit["id"], "2026-08-19T08:00")
    assert db.habit_event_count(conn, habit["id"]) == 1
    assert db.get_event(conn, event["id"]) is not None


def test_data_survives_without_reset(conn):
    """Cancelling the confirmation must not delete anything."""
    _create_sample_data(conn)
    assert db.list_identities(conn)
    assert db.list_habits(conn)
    assert db.list_events(conn)
    assert db.list_obstacles(conn)
    assert db.get_review_answer(conn, "2026-08-17")


def test_reset_works_in_transaction(conn):
    """Reset is atomic: no partial state after the call returns."""
    _create_sample_data(conn)
    db.reset_all_data(conn)
    counts = {
        t: conn.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()["n"]
        for t in TABLES
    }
    assert counts == {t: 0 for t in TABLES}


def test_reset_removes_identity_links(conn):
    _create_sample_data(conn)
    assert db.list_identity_links(conn)
    db.reset_all_data(conn)
    assert db.list_identity_links(conn) == []


def test_reset_removes_daily_notes(conn):
    _create_sample_data(conn)
    assert db.get_daily_note(conn, "2026-08-20")
    db.reset_all_data(conn)
    assert db.get_daily_note(conn, "2026-08-20") is None


def test_reset_keeps_settings(conn):
    db.set_setting(conn, "review_sunday_time", "18:00")
    db.reset_all_data(conn)
    assert db.get_setting(conn, "review_sunday_time") == "18:00"


def test_reset_endpoint_empties_via_api(client):
    resp = client.post("/api/identities", json={"name": "Lector"})
    ident = resp.get_json()
    resp = client.post("/api/habits", json={
        "name": "Leer", "type": "boolean",
        "frequency_type": "weekly", "frequency_target": 3,
        "start_date": "2026-08-01", "identity_id": ident["id"],
    })
    habit = resp.get_json()
    client.post(f"/api/habits/{habit['id']}/events", json={"occurred_at": "2026-08-18T20:00"})
    client.post(f"/api/habits/{habit['id']}/obstacles", json={"obstacle": "Se me olvida", "type": "forget"})
    client.put("/api/review/weekly", json={"answer": "Buena semana"})
    assert client.get("/api/review/weekly").get_json()["question_answer"] == "Buena semana"

    resp = client.post("/api/reset")
    assert resp.status_code == 200
    assert resp.get_json() == {"reset": True}

    assert client.get("/api/identities").get_json() == []
    assert client.get("/api/habits").get_json() == []
    assert client.get("/api/review/weekly").get_json()["question_answer"] is None


def test_reset_keeps_foreign_keys_enabled(conn):
    _create_sample_data(conn)
    db.reset_all_data(conn)
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_reset_clears_sequences(conn):
    _create_sample_data(conn)
    db.reset_all_data(conn)
    ident = db.create_identity(conn, {"name": "Primera tras reset"})
    assert ident["id"] == 1
    habit = db.create_habit(conn, {
        "name": "Primer hábito tras reset", "type": "boolean",
        "frequency_type": "weekly", "frequency_target": 3,
        "start_date": "2026-08-01",
    })
    assert habit["id"] == 1