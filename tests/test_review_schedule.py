"""Weekly review schedule: the review opens only on Sunday at the chosen hour
until the day ends; otherwise a countdown points to the next opening."""
from datetime import datetime

from core import db, identity

WEDNESDAY = datetime(2026, 8, 19, 10, 0)      # 2026-08-19 is a Wednesday
SUNDAY_BEFORE = datetime(2026, 8, 23, 17, 32)  # Sunday 17:32
SUNDAY_AFTER = datetime(2026, 8, 23, 18, 0, 30)  # Sunday just past 18:00
SUNDAY_NEXT = datetime(2026, 8, 30, 10, 0)     # next Sunday


def _set(conn, time_str):
    db.set_setting(conn, "review_sunday_time", time_str)


# ---------------------------------------------------------------------------
# Settings CRUD
# ---------------------------------------------------------------------------

def test_setting_default_none(conn):
    assert db.get_setting(conn, "review_sunday_time") is None


def test_set_setting_and_get(conn):
    _set(conn, "18:00")
    assert db.get_setting(conn, "review_sunday_time") == "18:00"


def test_set_setting_overwrites(conn):
    _set(conn, "18:00")
    _set(conn, "20:30")
    assert db.get_setting(conn, "review_sunday_time") == "20:30"


def test_set_setting_none_clears(conn):
    _set(conn, "18:00")
    db.set_setting(conn, "review_sunday_time", "")
    assert db.get_setting(conn, "review_sunday_time") is None


# ---------------------------------------------------------------------------
# Schedule states
# ---------------------------------------------------------------------------

def test_schedule_disabled_without_setting(conn):
    s = identity.review_schedule(conn, WEDNESDAY)
    assert s == {"enabled": False, "day": 7, "time": None,
                 "open": False, "next_at": None}


def test_schedule_enabled_invalid_time_is_disabled(conn):
    _set(conn, "25:99")
    s = identity.review_schedule(conn, WEDNESDAY)
    assert s["enabled"] is False


def test_schedule_weekday_before_sunday_counts_down(conn):
    _set(conn, "18:00")
    s = identity.review_schedule(conn, WEDNESDAY)
    assert s["enabled"] is True
    assert s["time"] == "18:00"
    assert s["open"] is False
    assert s["next_at"] == "2026-08-23T18:00:00"


def test_schedule_sunday_before_hour_counts_down(conn):
    _set(conn, "18:00")
    s = identity.review_schedule(conn, SUNDAY_BEFORE)
    assert s["open"] is False
    assert s["next_at"] == "2026-08-23T18:00:00"


def test_schedule_sunday_at_hour_is_open(conn):
    _set(conn, "18:00")
    s = identity.review_schedule(conn, datetime(2026, 8, 23, 18, 0, 0))
    assert s["open"] is True
    assert s["next_at"] == "2026-08-30T18:00:00"


def test_schedule_sunday_after_hour_is_open(conn):
    _set(conn, "18:00")
    s = identity.review_schedule(conn, SUNDAY_AFTER)
    assert s["open"] is True
    assert s["next_at"] == "2026-08-30T18:00:00"


def test_schedule_next_sunday_points_forward(conn):
    _set(conn, "18:00")
    s = identity.review_schedule(conn, SUNDAY_NEXT)
    assert s["open"] is False
    assert s["next_at"] == "2026-08-30T18:00:00"


def test_schedule_normalizes_hour(conn):
    _set(conn, "8:5")
    s = identity.review_schedule(conn, WEDNESDAY)
    assert s["time"] == "08:05"


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def test_weekly_review_includes_schedule(client):
    data = client.get("/api/review/weekly").get_json()
    assert data["schedule"]["enabled"] is False
    assert data["schedule"]["time"] is None


def test_put_review_setting_saves(client):
    r = client.put("/api/settings/review", json={"time": "18:00"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["ok"] is True
    assert body["schedule"]["enabled"] is True
    assert body["schedule"]["time"] == "18:00"


def test_put_review_setting_invalid_hour(client):
    r = client.put("/api/settings/review", json={"time": "26:00"})
    assert r.status_code == 400
    r = client.put("/api/settings/review", json={"time": "18:61"})
    assert r.status_code == 400
    r = client.put("/api/settings/review", json={"time": "ab:cd"})
    assert r.status_code == 400


def test_put_review_setting_empty_clears(client):
    client.put("/api/settings/review", json={"time": "18:00"})
    r = client.put("/api/settings/review", json={"time": ""})
    assert r.status_code == 200
    assert r.get_json()["schedule"]["enabled"] is False
    data = client.get("/api/review/weekly").get_json()
    assert data["schedule"]["enabled"] is False


def test_review_setting_persists_after_save(client):
    client.put("/api/settings/review", json={"time": "20:30"})
    data = client.get("/api/review/weekly").get_json()
    assert data["schedule"]["time"] == "20:30"