"""Shared pytest fixtures: in-memory DB and Flask test client."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import db  # noqa: E402


@pytest.fixture
def conn(tmp_path):
    path = str(tmp_path / "test.db")
    db.init_db(path)
    c = db.get_connection(path)
    yield c
    c.close()


@pytest.fixture
def sample_habit(conn):
    return db.create_habit(conn, {
        "name": "Leer",
        "description": "Leer 10 minutos",
        "type": "duration",
        "unit": "min",
        "target_value": 10,
        "target_unit": "min",
        "frequency_type": "weekly",
        "frequency_target": 4,
        "cue": "Después de cenar",
        "start_date": "2026-01-01",
    })


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Flask test client using an isolated SQLite database."""
    from app import app as flask_app

    path = str(tmp_path / "app_test.db")
    db.init_db(path)
    monkeypatch.setenv("HABIT_DB_PATH", path)
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as c:
        yield c