"""Theme preference: stored in the settings table (kept across resets)."""
from core import db


def test_theme_default_light(conn):
    assert db.get_setting(conn, "theme") is None


def test_theme_get_default_light(client):
    r = client.get("/api/settings/theme")
    assert r.status_code == 200
    assert r.get_json() == {"theme": "light"}


def test_theme_put_dark(client):
    r = client.put("/api/settings/theme", json={"theme": "dark"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["ok"] is True and body["theme"] == "dark"


def test_theme_put_then_get(client):
    client.put("/api/settings/theme", json={"theme": "dark"})
    r = client.get("/api/settings/theme")
    assert r.get_json() == {"theme": "dark"}
    r = client.put("/api/settings/theme", json={"theme": "light"})
    assert r.get_json()["theme"] == "light"
    assert client.get("/api/settings/theme").get_json() == {"theme": "light"}


def test_theme_put_invalid(client):
    r = client.put("/api/settings/theme", json={"theme": "sepia"})
    assert r.status_code == 400
    assert client.get("/api/settings/theme").get_json() == {"theme": "light"}


def test_theme_normalizes_case_and_whitespace(client):
    client.put("/api/settings/theme", json={"theme": " DARK "})
    assert client.get("/api/settings/theme").get_json() == {"theme": "dark"}


def test_theme_persists_across_reset(conn):
    db.set_setting(conn, "theme", "dark")
    db.reset_all_data(conn)
    assert db.get_setting(conn, "theme") == "dark"