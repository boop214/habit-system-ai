"""Semantic identity detection: concept-level matching, confidence,
suggestions (never silent decisions) and persistent accept/reject."""
from core import db, semantics


def _identity(conn, name, **kw):
    data = {"name": name}
    data.update(kw)
    return db.create_identity(conn, data)


def _habit(conn, name, description=None, unit=None, identity_id=None, cue=None):
    return db.create_habit(conn, {
        "name": name,
        "description": description,
        "type": "boolean",
        "unit": unit,
        "cue": cue,
        "frequency_type": "weekly",
        "frequency_target": 3,
        "start_date": "2026-08-01",
        "identity_id": identity_id,
    })


# ---------------------------------------------------------------------------
# Normalization / tokens
# ---------------------------------------------------------------------------

def test_normalize_folds_accents_and_case():
    assert semantics.normalize("Correr 5 Km") == "correr 5 km"
    assert semantics.normalize("Méditar") == "meditar"
    assert "runner" in semantics.tokenize("Soy Runner!!")


def test_stopwords_removed():
    assert "lee" in semantics.tokenize("una persona que lee")
    assert "persona" not in semantics.tokenize("una persona que lee")


# ---------------------------------------------------------------------------
# Concept understanding
# ---------------------------------------------------------------------------

def test_concept_for_runner():
    group = semantics.concept_for({"name": "Runner"})
    assert group is not None
    assert "correr" in group["terms"]


def test_concept_for_persona_activa():
    group = semantics.concept_for({"name": "Persona activa"})
    assert group is not None
    assert "caminar" in group["terms"]
    assert "gimnasio" in group["terms"]


# ---------------------------------------------------------------------------
# Confidence levels (Runner examples from the spec)
# ---------------------------------------------------------------------------

def test_runner_to_correr_5km_is_alta(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Correr 5 km", unit="km")
    s = semantics.score_habit_identity(habit, ident, conn)
    assert s["level"] == "alta"
    assert s["confidence"] >= 0.7


def test_runner_to_preparar_zapatillas_is_media(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Preparar zapatillas")
    s = semantics.score_habit_identity(habit, ident, conn)
    assert s["level"] == "media"


def test_runner_to_comprar_ropa_is_too_low(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Comprar ropa")
    s = semantics.score_habit_identity(habit, ident, conn)
    assert s["level"] is None


def test_persona_activa_related_habits(conn):
    ident = _identity(conn, "Persona activa")
    for name in ("Caminar", "Gimnasio", "Ciclismo", "Natación"):
        habit = _habit(conn, name)
        s = semantics.score_habit_identity(habit, ident, conn)
        assert s["level"] == "alta", name


def test_lector_relates_to_leer(conn):
    ident = _identity(conn, "Lector")
    habit = _habit(conn, "Leer 10 minutos")
    s = semantics.score_habit_identity(habit, ident, conn)
    assert s["level"] in ("alta", "media")


def test_irrelevant_habit_does_not_match(conn):
    ident = _identity(conn, "Runner")
    for name in ("Comprar leche", "Llamar a mamá", "Pasar por la farmacia"):
        s = semantics.score_habit_identity(_habit(conn, name), ident, conn)
        assert s["level"] is None, name


def test_description_context_lifts_confidence(conn):
    ident = _identity(conn, "Runner")
    low = _habit(conn, "Estiramiento")
    s_low = semantics.score_habit_identity(low, ident, conn)
    high = _habit(conn, "Estiramiento", description="Para recuperarme después de correr")
    s_high = semantics.score_habit_identity(high, ident, conn)
    assert s_high["confidence"] > s_low["confidence"]


# ---------------------------------------------------------------------------
# Suggestions: no silent decisions, no repeats
# ---------------------------------------------------------------------------

def test_suggestion_excludes_primary_identity(conn):
    ident = _identity(conn, "Runner")
    other = _identity(conn, "Lector")
    habit = _habit(conn, "Correr 5 km", identity_id=ident["id"])
    out = semantics.suggest_identity_for_habit(habit, [ident, other], conn)
    ids = [c["identity_id"] for c in out]
    assert ident["id"] not in ids
    assert other["id"] not in ids  # Lector no se relaciona con correr


def test_accept_prevents_future_suggestion(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Correr 5 km")
    assert semantics.suggest_identity_for_habit(habit, [ident], conn)
    db.set_identity_link(conn, habit["id"], ident["id"], "linked", "semantic", 1.0)
    assert semantics.suggest_identity_for_habit(habit, [ident], conn) == []


def test_reject_prevents_repeated_suggestion(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Correr 5 km")
    assert semantics.suggest_identity_for_habit(habit, [ident], conn)
    db.set_identity_link(conn, habit["id"], ident["id"], "rejected", "semantic")
    assert semantics.suggest_identity_for_habit(habit, [ident], conn) == []


def test_accepted_link_boosts_re_evaluation(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Preparar zapatillas")
    before = semantics.score_habit_identity(habit, ident, conn)
    db.set_identity_link(conn, habit["id"], ident["id"], "linked", "semantic", 0.6)
    after = semantics.score_habit_identity(habit, ident, conn)
    assert after["confidence"] > before["confidence"]


def test_multiple_habits_can_link_to_identity(conn):
    ident = _identity(conn, "Runner")
    h1 = _habit(conn, "Correr 5 km")
    h2 = _habit(conn, "Salir a trotar")
    db.set_identity_link(conn, h1["id"], ident["id"], "linked", "semantic", 0.9)
    db.set_identity_link(conn, h2["id"], ident["id"], "linked", "semantic", 0.8)
    assert len(db.list_identity_links(conn, identity_id=ident["id"])) == 2


def test_habit_can_link_to_several_identities(conn):
    r = _identity(conn, "Runner")
    a = _identity(conn, "Persona activa")
    habit = _habit(conn, "Correr 5 km")
    db.set_identity_link(conn, habit["id"], r["id"], "linked", "semantic", 1.0)
    db.set_identity_link(conn, habit["id"], a["id"], "linked", "semantic", 0.7)
    assert len(db.list_identity_links(conn, habit_id=habit["id"])) == 2


# ---------------------------------------------------------------------------
# Note detection (Mañana)
# ---------------------------------------------------------------------------

def test_note_detects_habit_and_identity(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Correr 20 minutos", identity_id=ident["id"])
    detections = semantics.detect_note("17:30 Correr 20 minutos", [habit], [ident], conn)
    habits = [d for d in detections if d["type"] == "habit"]
    assert habits and habits[0]["habit_id"] == habit["id"]
    assert habits[0]["identity"]["id"] == ident["id"]
    assert habits[0]["level"] in ("alta", "media")


def test_note_detects_identity_without_habit(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Leer 10 minutos")
    detections = semantics.detect_note("Preparar las zapatillas antes de salir",
                                       [habit], [ident], conn)
    assert any(d["type"] == "identity" and d["identity_id"] == ident["id"]
               for d in detections)
    assert not any(d["type"] == "habit" for d in detections)


def test_irrelevant_text_does_not_trigger(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Correr 20 minutos")
    detections = semantics.detect_note("Quiero tener un día tranquilo", [habit], [ident], conn)
    assert detections == []


def test_comprar_leche_stays_free_text(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Correr 20 minutos")
    detections = semantics.detect_note("Comprar leche y pasar por la farmacia",
                                       [habit], [ident], conn)
    assert detections == []


def test_empty_note_returns_no_detections(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Correr 20 minutos")
    assert semantics.detect_note("", [habit], [ident], conn) == []
    assert semantics.detect_note("   ", [habit], [ident], conn) == []


def test_minimum_hint_present(conn):
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Correr 30 minutos")
    db.update_habit(conn, habit["id"], {"minimum_value": 2, "minimum_unit": "min"})
    habit = db.get_habit(conn, habit["id"])
    detections = semantics.detect_note("mañana correr 30 minutos", [habit], [ident], conn)
    habits = [d for d in detections if d["type"] == "habit"]
    assert habits and habits[0]["minimum"]["value"] == 2
    assert habits[0]["minimum"]["unit"] == "min"


def test_note_with_times_and_free_lines(conn):
    ident = _identity(conn, "Persona activa")
    habit = _habit(conn, "Caminar", identity_id=ident["id"])
    text = ("07:30 levantarme\n08:00 desayunar\n\n"
            "por la mañana trabajo\n\n13:30 comer\n\n"
            "por la tarde caminar si no llueve\n\ncomprar leche!!!")
    detections = semantics.detect_note(text, [habit], [ident], conn)
    assert any(d["type"] == "habit" and d["habit_id"] == habit["id"] for d in detections)


def test_detection_is_pure(conn):
    """Detection never persists anything by itself."""
    ident = _identity(conn, "Runner")
    habit = _habit(conn, "Correr 20 minutos")
    semantics.detect_note("17:30 Correr 20 minutos", [habit], [ident], conn)
    assert db.list_events(conn) == []
    assert db.list_identity_links(conn) == []
    assert db.get_daily_note(conn, "2026-08-21") is None