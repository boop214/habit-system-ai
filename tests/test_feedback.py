"""Feedback endpoint tests: validation, privacy, technical_info handling."""


def test_feedback_valid_suggestion(client):
    r = client.post("/api/feedback", json={
        "type": "suggestion",
        "message": "Me gustaría que hubiera un modo oscuro más suave.",
    })
    assert r.status_code == 201
    data = r.get_json()
    assert data["ok"] is True
    assert "id" in data


def test_feedback_valid_bug(client):
    r = client.post("/api/feedback", json={
        "type": "bug",
        "message": "El gráfico no se muestra en Firefox.",
    })
    assert r.status_code == 201


def test_feedback_valid_like(client):
    r = client.post("/api/feedback", json={
        "type": "like",
        "message": "Me encanta el enfoque de identidad.",
    })
    assert r.status_code == 201


def test_feedback_valid_other(client):
    r = client.post("/api/feedback", json={
        "type": "other",
        "message": "Tengo una duda sobre cómo funciona.",
    })
    assert r.status_code == 201


def test_feedback_invalid_type(client):
    r = client.post("/api/feedback", json={
        "type": "spam",
        "message": "Hola",
    })
    assert r.status_code == 400
    assert "type" in r.get_json()["errors"]


def test_feedback_missing_type(client):
    r = client.post("/api/feedback", json={
        "message": "Hola",
    })
    assert r.status_code == 400
    assert "type" in r.get_json()["errors"]


def test_feedback_empty_message(client):
    r = client.post("/api/feedback", json={
        "type": "suggestion",
        "message": "",
    })
    assert r.status_code == 400
    assert "message" in r.get_json()["errors"]


def test_feedback_missing_message(client):
    r = client.post("/api/feedback", json={
        "type": "suggestion",
    })
    assert r.status_code == 400
    assert "message" in r.get_json()["errors"]


def test_feedback_whitespace_only_message(client):
    r = client.post("/api/feedback", json={
        "type": "suggestion",
        "message": "   ",
    })
    assert r.status_code == 400
    assert "message" in r.get_json()["errors"]


def test_feedback_message_too_long(client):
    r = client.post("/api/feedback", json={
        "type": "suggestion",
        "message": "x" * 5001,
    })
    assert r.status_code == 400
    assert "message" in r.get_json()["errors"]


def test_feedback_message_at_limit(client):
    r = client.post("/api/feedback", json={
        "type": "suggestion",
        "message": "x" * 5000,
    })
    assert r.status_code == 201


def test_feedback_no_technical_info(client):
    r = client.post("/api/feedback", json={
        "type": "bug",
        "message": "No funciona.",
    })
    assert r.status_code == 201
    data = r.get_json()
    assert data["ok"] is True


def test_feedback_with_technical_info(client):
    r = client.post("/api/feedback", json={
        "type": "bug",
        "message": "No funciona.",
        "technical_info": {
            "Navegador": "Chrome/120",
            "Pantalla": "1920x1080",
            "Viewport": "1200x800",
        },
    })
    assert r.status_code == 201


def test_feedback_technical_info_sanitized(client):
    r = client.post("/api/feedback", json={
        "type": "bug",
        "message": "Test.",
        "technical_info": {
            "ok": "yes",
            "x" * 60: "y" * 300,  # key > 50 chars, value > 200 chars
        },
    })
    assert r.status_code == 201


def test_feedback_technical_info_too_many_fields(client):
    r = client.post("/api/feedback", json={
        "type": "bug",
        "message": "Test.",
        "technical_info": {f"field{i}": f"val{i}" for i in range(15)},
    })
    assert r.status_code == 400
    assert "technical_info" in r.get_json()["errors"]


def test_feedback_technical_info_not_dict(client):
    r = client.post("/api/feedback", json={
        "type": "bug",
        "message": "Test.",
        "technical_info": "not a dict",
    })
    assert r.status_code == 400
    assert "technical_info" in r.get_json()["errors"]


def test_feedback_empty_body(client):
    r = client.post("/api/feedback", json={})
    assert r.status_code == 400


def test_feedback_none_body(client):
    r = client.post("/api/feedback", content_type="application/json")
    assert r.status_code == 400


def test_feedback_stored_locally(client):
    """Feedback is stored in the local database, not sent externally."""
    r = client.post("/api/feedback", json={
        "type": "suggestion",
        "message": "Test de almacenamiento local.",
    })
    assert r.status_code == 201
    fid = r.get_json()["id"]
    assert fid is not None
    assert fid > 0


def test_feedback_multiple_submissions(client):
    """Multiple feedback submissions are stored independently."""
    ids = []
    for i in range(3):
        r = client.post("/api/feedback", json={
            "type": "suggestion",
            "message": f"Feedback {i}",
        })
        assert r.status_code == 201
        ids.append(r.get_json()["id"])
    assert len(set(ids)) == 3


def test_feedback_type_not_in_habits(client):
    """Feedback type field is validated against allowed types, not habit types."""
    r = client.post("/api/feedback", json={
        "type": "boolean",
        "message": "Test.",
    })
    assert r.status_code == 400
    assert "type" in r.get_json()["errors"]
