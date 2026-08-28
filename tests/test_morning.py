"""'Mañana' notebook: per-date free text, plan != register, discreet
detection, persistent accept/reject of detected associations."""
import sqlite3

from core import db


def _identity(client, name):
    return client.post("/api/identities", json={"name": name}).get_json()


def _habit(client, name, identity_id=None, description=None):
    return client.post("/api/habits", json={
        "name": name, "description": description, "type": "boolean",
        "frequency_type": "weekly", "frequency_target": 3,
        "start_date": "2026-08-01", "identity_id": identity_id,
    }).get_json()


def _note(client, date, content):
    return client.put(f"/api/notes/{date}", json={"content": content})


# ---------------------------------------------------------------------------
# Free-text storage
# ---------------------------------------------------------------------------

def test_note_create_and_get(client):
    resp = _note(client, "2026-08-21", "planear la semana")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["content"] == "planear la semana"
    got = client.get("/api/notes/2026-08-21").get_json()
    assert got["content"] == "planear la semana"


def test_note_edit_overwrites(client):
    _note(client, "2026-08-21", "primera versión")
    resp = _note(client, "2026-08-21", "segunda versión")
    assert resp.get_json()["content"] == "segunda versión"
    assert client.get("/api/notes/2026-08-21").get_json()["content"] == "segunda versión"


def test_empty_note_is_allowed(client):
    resp = _note(client, "2026-08-21", "")
    assert resp.status_code == 200
    got = client.get("/api/notes/2026-08-21").get_json()
    assert got["content"] == ""


def test_multiline_and_symbols_kept(client):
    text = "07:30 levantarme\n\ncomprar leche!!!\n\n13:30 comer"
    _note(client, "2026-08-21", text)
    assert client.get("/api/notes/2026-08-21").get_json()["content"] == text


def test_dates_are_independent(client):
    _note(client, "2026-08-21", "nota del 21")
    _note(client, "2026-08-22", "nota del 22")
    assert client.get("/api/notes/2026-08-21").get_json()["content"] == "nota del 21"
    assert client.get("/api/notes/2026-08-22").get_json()["content"] == "nota del 22"
    assert client.get("/api/notes/2026-08-20").get_json()["content"] == ""


def test_invalid_date_rejected(client):
    assert client.get("/api/notes/not-a-date").status_code == 400
    assert _note(client, "not-a-date", "x").status_code == 400


def test_note_survives_restart(tmp_path):
    path = str(tmp_path / "restart.db")
    db.init_db(path)
    conn1 = db.get_connection(path)
    db.save_daily_note(conn1, "2026-08-21", "nota persistente")
    conn1.close()
    conn2 = db.get_connection(path)
    try:
        assert db.get_daily_note(conn2, "2026-08-21")["content"] == "nota persistente"
    finally:
        conn2.close()


# ---------------------------------------------------------------------------
# Plan != register
# ---------------------------------------------------------------------------

def test_writing_a_note_never_creates_events(client):
    ident = _identity(client, "Runner")
    habit = _habit(client, "Correr 20 minutos", identity_id=ident["id"])
    _note(client, "2026-08-21", "17:30 Correr 20 minutos por el parque")
    stats = client.get(f"/api/habits/{habit['id']}").get_json()["stats"]
    assert stats["total"] == 0
    assert stats["this_month"] == 0


def test_writing_a_note_never_creates_votes_or_links(client):
    ident = _identity(client, "Runner")
    habit = _habit(client, "Correr 20 minutos", identity_id=ident["id"])
    resp = _note(client, "2026-08-21", "preparar las zapatillas para mañana")
    assert resp.status_code == 200
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["identity_links"] == []
    assert client.get("/api/identities").get_json()[0]["votes"]["total"] == 0


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

def test_note_detects_habit(client):
    ident = _identity(client, "Runner")
    habit = _habit(client, "Correr 20 minutos", identity_id=ident["id"])
    body = _note(client, "2026-08-21", "17:30 Correr 20 minutos").get_json()
    habits = [d for d in body["detections"] if d["type"] == "habit"]
    assert habits and habits[0]["habit_id"] == habit["id"]
    assert habits[0]["identity"]["id"] == ident["id"]
    assert habits[0]["confidence"] >= 0.4


def test_note_detects_identity_only(client):
    ident = _identity(client, "Runner")
    habit = _habit(client, "Leer 10 minutos")
    body = _note(client, "2026-08-21", "preparar las zapatillas").get_json()
    assert any(d["type"] == "identity" and d["identity_id"] == ident["id"]
               for d in body["detections"])


def test_unrelated_text_has_no_detections(client):
    _identity(client, "Runner")
    _habit(client, "Correr 20 minutos")
    body = _note(client, "2026-08-21", "comprar leche y llamar a mamá").get_json()
    assert body["detections"] == []


def test_detections_refresh_after_edit(client):
    ident = _identity(client, "Runner")
    habit = _habit(client, "Correr 20 minutos", identity_id=ident["id"])
    assert _note(client, "2026-08-21", "leer un rato").get_json()["detections"] == []
    body = _note(client, "2026-08-21", "salir a correr 20 minutos").get_json()
    assert any(d["type"] == "habit" and d["habit_id"] == habit["id"]
               for d in body["detections"])


# ---------------------------------------------------------------------------
# Accept / reject associations from the notebook
# ---------------------------------------------------------------------------

def test_accept_association_persists(client):
    ident = _identity(client, "Runner")
    habit = _habit(client, "Preparar zapatillas")
    body = _note(client, "2026-08-21", "preparar las zapatillas").get_json()
    det = next(d for d in body["detections"]
               if d.get("identity") and d["identity"]["id"] == ident["id"])
    resp = client.post(f"/api/habits/{habit['id']}/identity-links", json={
        "identity_id": det["identity"]["id"], "decision": "accept",
        "confidence": det["confidence"],
    })
    assert resp.status_code == 201
    assert resp.get_json()["status"] == "linked"
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert [l["identity"]["id"] for l in detail["identity_links"]] == [ident["id"]]
    assert detail["semantic_suggestion"] is None


def test_reject_association_persists_and_stops_suggestions(client):
    ident = _identity(client, "Runner")
    habit = _habit(client, "Preparar zapatillas")
    assert client.get(f"/api/habits/{habit['id']}").get_json()["semantic_suggestion"] is not None
    resp = client.post(f"/api/habits/{habit['id']}/identity-links", json={
        "identity_id": ident["id"], "decision": "reject",
    })
    assert resp.status_code == 201
    assert resp.get_json()["status"] == "rejected"
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["identity_links"] == []
    assert detail["semantic_suggestion"] is None


def test_delete_link_restores_suggestion(client):
    ident = _identity(client, "Runner")
    habit = _habit(client, "Preparar zapatillas")
    client.post(f"/api/habits/{habit['id']}/identity-links", json={
        "identity_id": ident["id"], "decision": "reject",
    })
    resp = client.delete(f"/api/habits/{habit['id']}/identity-links/{ident['id']}")
    assert resp.status_code == 200
    assert client.get(f"/api/habits/{habit['id']}").get_json()["semantic_suggestion"] is not None


def test_unknown_identity_link_returns_404(client):
    ident = _identity(client, "Runner")
    habit = _habit(client, "Preparar zapatillas")
    resp = client.delete(f"/api/habits/{habit['id']}/identity-links/999")
    assert resp.status_code == 404


def test_suggestion_chain_after_decision(client):
    """After accept, the next best candidate may appear (other identities)."""
    runner = _identity(client, "Runner")
    activa = _identity(client, "Persona activa")
    habit = _habit(client, "Correr 5 km")
    client.post(f"/api/habits/{habit['id']}/identity-links", json={
        "identity_id": runner["id"], "decision": "accept", "confidence": 1.0,
    })
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert [l["identity"]["id"] for l in detail["identity_links"]] == [runner["id"]]
    if detail["semantic_suggestion"] is not None:
        assert detail["semantic_suggestion"]["identity_id"] == activa["id"]


# ---------------------------------------------------------------------------
# Register as done (explicit only)
# ---------------------------------------------------------------------------

def test_register_as_done_creates_one_event(client):
    ident = _identity(client, "Runner")
    habit = _habit(client, "Correr 20 minutos", identity_id=ident["id"])
    _note(client, "2026-08-21", "correr 20 minutos")
    assert client.get(f"/api/habits/{habit['id']}").get_json()["stats"]["total"] == 0
    resp = client.post(f"/api/notes/2026-08-21/done/{habit['id']}")
    assert resp.status_code == 201
    stats = client.get(f"/api/habits/{habit['id']}").get_json()["stats"]
    assert stats["total"] == 1
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["events"] and detail["events"][0]["occurred_at"].startswith("2026-08-21")


def test_register_as_done_for_unknown_habit(client):
    resp = client.post("/api/notes/2026-08-21/done/999")
    assert resp.status_code == 404


def test_register_as_done_invalid_date(client):
    resp = client.post("/api/notes/bad/done/1")
    assert resp.status_code == 400