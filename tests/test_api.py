"""End-to-end API tests using Flask's test client with an isolated database."""
from datetime import datetime, timedelta

from core import periods


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M")


def now_dt():
    return datetime.now()


def this_monday():
    return periods.start_of_week(now_dt())


def create_habit(client, **overrides):
    payload = {
        "name": "Leer",
        "description": "Leer 10 minutos",
        "type": "duration",
        "unit": "min",
        "target_value": 10,
        "target_unit": "min",
        "frequency_type": "weekly",
        "frequency_target": 4,
        "cue": "Después de cenar",
        "start_date": (now_dt() - timedelta(days=30)).strftime("%Y-%m-%d"),
    }
    payload.update(overrides)
    return client.post("/api/habits", json=payload)


def test_create_habit_validation(client):
    r = client.post("/api/habits", json={})
    assert r.status_code == 400
    assert "name" in r.get_json()["errors"]


def test_create_and_get_habit(client):
    r = create_habit(client)
    assert r.status_code == 201
    data = r.get_json()
    assert data["name"] == "Leer"
    assert data["frequency_target"] == 4

    r2 = client.get(f"/api/habits/{data['id']}")
    assert r2.status_code == 200
    detail = r2.get_json()
    assert detail["stats"]["total"] == 0
    assert detail["goal"]["target"] == 4
    assert detail["events"] == []
    assert detail["insights"] == []


def test_create_event_and_count(client):
    habit = create_habit(client).get_json()
    r = client.post(f"/api/habits/{habit['id']}/events", json={
        "occurred_at": iso(now_dt()),
        "value": 15,
    })
    assert r.status_code == 201
    event = r.get_json()
    assert event["value"] == 15
    assert event["unit"] == "min"

    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["stats"]["total"] == 1
    assert detail["goal"]["this_week"] == 1
    assert len(detail["events"]) == 1


def test_multiple_events_same_day(client):
    habit = create_habit(client).get_json()
    for _ in range(3):
        assert client.post(f"/api/habits/{habit['id']}/events", json={
            "occurred_at": iso(now_dt()),
        }).status_code == 201
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["stats"]["total"] == 3
    assert detail["stats"]["active_days"] == 1
    assert detail["stats"]["today_count"] == 3


def test_event_value_inference_by_type(client):
    h = create_habit(client).get_json()
    r = client.post(f"/api/habits/{h['id']}/events", json={"occurred_at": iso(now_dt())})
    assert r.get_json()["value"] == 10  # target_value used for duration type


def test_boolean_habit_event(client):
    h = create_habit(client, type="boolean", frequency_target=7, frequency_type="daily").get_json()
    r = client.post(f"/api/habits/{h['id']}/events", json={"occurred_at": iso(now_dt())})
    assert r.status_code == 201
    assert r.get_json()["value"] == 1


def test_edit_and_delete_event(client):
    habit = create_habit(client).get_json()
    ev = client.post(f"/api/habits/{habit['id']}/events", json={
        "occurred_at": iso(now_dt()), "value": 10, "notes": "antes de editar",
    }).get_json()

    moved = iso(this_monday() - timedelta(days=1))  # previous week
    r = client.put(f"/api/events/{ev['id']}", json={"occurred_at": moved, "notes": "editado"})
    assert r.status_code == 200
    assert r.get_json()["notes"] == "editado"

    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["goal"]["this_week"] == 0
    assert detail["goal"]["prev_week"] == 1

    assert client.delete(f"/api/events/{ev['id']}").status_code == 200
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["stats"]["total"] == 0


def test_update_habit_target_reflects_goal(client):
    habit = create_habit(client, frequency_target=4).get_json()
    client.post(f"/api/habits/{habit['id']}/events", json={"occurred_at": iso(now_dt())})
    client.post(f"/api/habits/{habit['id']}/events", json={"occurred_at": iso(now_dt())})

    r = client.put(f"/api/habits/{habit['id']}", json={"frequency_target": 2})
    assert r.status_code == 200

    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["goal"]["target"] == 2
    assert detail["goal"]["achieved"] is True
    assert detail["goal"]["percent"] == 100


def test_archive_and_delete_habit(client):
    habit = create_habit(client).get_json()
    client.put(f"/api/habits/{habit['id']}", json={"active": False})
    listed = client.get("/api/habits").get_json()
    assert all(h["id"] != habit["id"] for h in listed)

    assert client.delete(f"/api/habits/{habit['id']}").status_code == 200
    assert client.get(f"/api/habits/{habit['id']}").status_code == 404


def test_edit_habit_preserves_events(client):
    habit = create_habit(client).get_json()
    client.post(f"/api/habits/{habit['id']}/events", json={"occurred_at": iso(now_dt())})
    client.put(f"/api/habits/{habit['id']}", json={"name": "Leer libros"})
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["name"] == "Leer libros"
    assert detail["stats"]["total"] == 1


def test_global_stats(client):
    create_habit(client, name="Leer", frequency_target=2)
    create_habit(client, name="Correr", frequency_target=3, type="distance", unit="km")
    habits = client.get("/api/habits").get_json()
    for h in habits:
        client.post(f"/api/habits/{h['id']}/events", json={"occurred_at": iso(now_dt())})

    g = client.get("/api/stats/global").get_json()
    assert g["total_habits"] == 2
    assert g["week_realizations"] == 2
    assert g["total_realizations"] == 2
    assert len(g["by_habit"]) == 2


def test_demo_data_lifecycle(client):
    r = client.post("/api/demo")
    assert r.status_code == 200
    assert r.get_json()["created"] == 4

    habits = client.get("/api/habits").get_json()
    assert len(habits) == 4
    for h in habits:
        detail = client.get(f"/api/habits/{h['id']}").get_json()
        assert detail["stats"]["total"] > 0

    user_habit = create_habit(client, name="Propio").get_json()
    r = client.delete("/api/demo")
    assert r.get_json()["habits_deleted"] == 4

    habits = client.get("/api/habits").get_json()
    assert len(habits) == 1
    assert habits[0]["name"] == "Propio"


def test_event_invalid_date(client):
    habit = create_habit(client).get_json()
    r = client.post(f"/api/habits/{habit['id']}/events", json={"occurred_at": "not-a-date"})
    assert r.status_code == 400


def test_state_endpoint(client):
    assert client.get("/api/state").get_json() == {"has_habits": False, "has_demo": False, "has_identities": False}
    create_habit(client)
    assert client.get("/api/state").get_json() == {"has_habits": True, "has_demo": False, "has_identities": False}


def test_week_transition_consistency(client):
    """Events just before and after the week boundary land in different weeks."""
    habit = create_habit(client).get_json()
    monday = this_monday()
    client.post(f"/api/habits/{habit['id']}/events", json={
        "occurred_at": iso(monday - timedelta(seconds=1)), "value": 10,
    })
    client.post(f"/api/habits/{habit['id']}/events", json={
        "occurred_at": iso(monday + timedelta(seconds=1)), "value": 10,
    })
    detail = client.get(f"/api/habits/{habit['id']}").get_json()
    assert detail["goal"]["prev_week"] == 1
    assert detail["goal"]["this_week"] == 1