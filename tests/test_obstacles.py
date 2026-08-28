"""Obstacle-driven redesign: selection, suggestion, apply, cancel, patterns."""
from datetime import datetime, timedelta

from core import db, obstacles


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M")


def create_habit(client, **overrides):
    payload = {
        "name": "Leer",
        "type": "duration",
        "unit": "min",
        "target_value": 20,
        "target_unit": "min",
        "frequency_type": "weekly",
        "frequency_target": 4,
        "cue": "Después de cenar",
        "start_date": (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d"),
    }
    payload.update(overrides)
    return client.post("/api/habits", json=payload)


def select_obstacle(client, habit_id, obstacle_type, label=None):
    labels = {
        "time": "El momento no funciona",
        "hard": "Es demasiado difícil",
        "env": "Mi entorno no ayuda",
        "forget": "Se me olvida",
        "notime": "No tengo tiempo",
        "energy": "No tengo energía",
        "unclear": "No sé exactamente qué hacer",
        "other": "Otro",
    }
    body = {"obstacle": label or labels[obstacle_type], "type": obstacle_type}
    return client.post(f"/api/habits/{habit_id}/obstacles", json=body)


def test_obstacle_saved_with_type(client):
    habit = create_habit(client).get_json()
    r = select_obstacle(client, habit["id"], "forget")
    assert r.status_code == 201
    data = r.get_json()
    assert data["obstacle"] == "Se me olvida"
    assert data["type"] == "forget"
    assert data["suggestion"]["type"] == "forget"
    assert data["suggestion"]["message"] == "Necesitamos una señal más clara."


def test_suggestion_hard_reduces_duration(client):
    habit = create_habit(client).get_json()  # duration 20 min
    r = select_obstacle(client, habit["id"], "hard")
    s = r.get_json()["suggestion"]
    assert s["message"] == "Podemos hacerlo más fácil."
    assert "20 min" in s["current"]
    assert "5 min" in s["proposed"]
    assert s["apply"]["target_value"] == 5
    assert s["apply"]["minimum_value"] == 2
    assert s["apply"]["minimum_unit"] == "min"


def test_suggestion_hard_quantity(client):
    habit = create_habit(client, type="quantity", unit="páginas", target_value=10,
                         target_unit="páginas").get_json()
    r = select_obstacle(client, habit["id"], "hard")
    s = r.get_json()["suggestion"]
    assert s["apply"]["target_value"] == 3
    assert s["apply"]["minimum_value"] == 1
    assert "página" in s["apply"]["minimum_description"]


def test_suggestion_boolean_reduces_frequency(client):
    habit = create_habit(client, type="boolean", frequency_target=4).get_json()
    r = select_obstacle(client, habit["id"], "hard")
    s = r.get_json()["suggestion"]
    assert s["apply"]["frequency_target"] == 3
    assert "Reducir la frecuencia" in s["proposed"]


def test_suggestion_forget_chains_to_anchor(client):
    habit = create_habit(client).get_json()
    r = select_obstacle(client, habit["id"], "forget")
    s = r.get_json()["suggestion"]
    assert s["apply"]["cue"] == "Después de lavarme los dientes"
    assert "lavarme los dientes" in s["proposed"]


def test_suggestion_time_offers_cue_and_location(client):
    habit = create_habit(client).get_json()
    r = select_obstacle(client, habit["id"], "time")
    s = r.get_json()["suggestion"]
    assert s["message"] == "Probemos otro momento."
    assert s["apply"]["cue"] == "Después de lavarme los dientes"
    keys = {f["key"] for f in s["fields"]}
    assert {"cue", "location"} <= keys


def test_suggestion_env_proposes_preparation(client):
    habit = create_habit(client, name="Leer 2 páginas").get_json()
    r = select_obstacle(client, habit["id"], "env")
    s = r.get_json()["suggestion"]
    assert s["message"] == "¿Qué puedes cambiar en tu entorno?"
    assert "Dejar" in s["apply"]["environment"]
    assert "Leer 2 páginas" in s["apply"]["environment"]


def test_suggestion_notime_reduces_friction(client):
    habit = create_habit(client).get_json()
    r = select_obstacle(client, habit["id"], "notime")
    s = r.get_json()["suggestion"]
    assert s["message"] == "Reduzcamos la fricción temporal."
    assert s["apply"]["target_value"] == 5


def test_suggestion_energy_proposes_morning(client):
    habit = create_habit(client).get_json()
    r = select_obstacle(client, habit["id"], "energy")
    s = r.get_json()["suggestion"]
    assert s["message"].startswith("Quizá este hábito")
    assert s["apply"]["cue"] == "A primera hora de la mañana"


def test_suggestion_unclear_offers_concrete_name(client):
    habit = create_habit(client, name="Aprender programación",
                         description="").get_json()
    r = select_obstacle(client, habit["id"], "unclear")
    s = r.get_json()["suggestion"]
    assert s["message"] == "Vamos a convertirlo en una acción concreta."
    assert s["apply"]["name"] == "Aprender programación"
    keys = {f["key"] for f in s["fields"]}
    assert {"name", "description"} <= keys


def test_suggestion_other_has_no_auto_apply(client):
    habit = create_habit(client).get_json()
    r = select_obstacle(client, habit["id"], "other")
    s = r.get_json()["suggestion"]
    assert s["message"] == "¿Quieres rediseñar el hábito?"
    assert s["apply"] is None


def test_apply_change_updates_habit(client):
    habit = create_habit(client).get_json()
    events_before = 3
    for i in range(events_before):
        client.post(f"/api/habits/{habit['id']}/events",
                    json={"occurred_at": iso(datetime.now() - timedelta(days=i))})

    r = select_obstacle(client, habit["id"], "hard")
    s = r.get_json()["suggestion"]
    updated = client.put(f"/api/habits/{habit['id']}", json=s["apply"])
    assert updated.status_code == 200
    data = updated.get_json()
    assert data["target_value"] == 5
    assert data["minimum_value"] == 2

    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["total"] == events_before  # historical events untouched
    assert len(detail["events"]) == events_before


def test_cancel_does_not_modify_habit(client):
    habit = create_habit(client).get_json()
    select_obstacle(client, habit["id"], "hard")
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["target_value"] == 20
    assert detail["cue"] == "Después de cenar"


def test_main_obstacle_needs_evidence(client):
    habit = create_habit(client).get_json()
    assert client.get(f"/api/habits/{habit['id']}").get_json()["main_obstacle"] is None

    for _ in range(2):
        select_obstacle(client, habit["id"], "forget")
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["main_obstacle"] is None  # not enough data yet

    select_obstacle(client, habit["id"], "forget")
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["main_obstacle"]["obstacle"] == "Se me olvida"
    assert detail["main_obstacle"]["count"] == 3

    counts = detail["obstacle_counts"]
    assert counts[0]["obstacle"] == "Se me olvida"
    assert counts[0]["count"] == 3


def test_main_obstacle_not_dominant(client):
    habit = create_habit(client).get_json()
    for _ in range(3):
        select_obstacle(client, habit["id"], "forget")
        select_obstacle(client, habit["id"], "hard")
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["main_obstacle"] is None  # tie: no clear winner


def test_obstacle_counts_via_db(conn, sample_habit):
    db.create_obstacle(conn, sample_habit["id"], "Se me olvida", otype="forget")
    db.create_obstacle(conn, sample_habit["id"], "Se me olvida", otype="forget")
    counts = db.obstacle_counts(conn, sample_habit["id"])
    assert counts == [{"obstacle": "Se me olvida", "count": 2}]


def test_redesign_suggestion_is_pure(conn, sample_habit):
    """The suggestion must never mutate the habit or persist anything."""
    before = db.get_habit(conn, sample_habit["id"])
    obstacles.redesign_suggestion(dict(sample_habit), "hard")
    after = db.get_habit(conn, sample_habit["id"])
    assert dict(before) == dict(after)
    assert db.list_obstacles(conn) == []