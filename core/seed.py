"""Realistic demo data so the app can be explored immediately.

Events are generated deterministically (fixed random seed) over the previous
~6 weeks. Demo rows are tagged with is_demo=1 so they can be removed in one
click from Settings.
"""
import random
from datetime import datetime, timedelta

from . import db, periods

HABIT_TEMPLATES = [
    {
        "name": "Leer",
        "description": "Leer al menos 10 minutos",
        "type": "duration",
        "unit": "min",
        "target_value": 10,
        "target_unit": "min",
        "frequency_type": "weekly",
        "frequency_target": 4,
        "cue": "Después de cenar",
        "color": "#3b82f6",
        "icon": "book",
        "identity": "Lector",
        "hours": (20, 22),   # most common time slot
        "value_range": (10, 30),
        "minimum_value": 1,
        "minimum_unit": "min",
        "minimum_description": "Leer 1 página",
        "environment": "Dejar el libro sobre la mesa antes de cenar.",
        "location": "Salón",
        "attraction_strategy": "Tomar el café mientras leo.",
        "friction_strategy": "Tener el libro abierto en la página siguiente.",
        "reward_strategy": "Marcar el progreso al terminar.",
    },
    {
        "name": "Correr",
        "description": "Salir a correr 5 km",
        "type": "distance",
        "unit": "km",
        "target_value": 5,
        "target_unit": "km",
        "frequency_type": "weekly",
        "frequency_target": 3,
        "cue": "Al despertar",
        "color": "#f97316",
        "icon": "run",
        "identity": "Persona activa",
        "hours": (7, 9),
        "value_range": (4, 8),
        "minimum_value": 1,
        "minimum_unit": "km",
        "minimum_description": "Caminar 10 minutos",
        "environment": "Dejar las zapatillas junto a la puerta.",
        "location": "Parque",
        "attraction_strategy": "Escuchar el podcast favorito mientras corro.",
        "friction_strategy": "Tener la ropa deportiva preparada la noche anterior.",
        "reward_strategy": "Registrar el km recorrido al volver.",
    },
    {
        "name": "Meditar",
        "description": "Meditar 10 minutos",
        "type": "duration",
        "unit": "min",
        "target_value": 10,
        "target_unit": "min",
        "frequency_type": "weekly",
        "frequency_target": 5,
        "cue": "Después de desayunar",
        "color": "#8b5cf6",
        "icon": "zen",
        "identity": "Persona tranquila",
        "hours": (8, 10),
        "value_range": (8, 15),
        "minimum_value": 1,
        "minimum_unit": "min",
        "minimum_description": "Respirar conscientemente 1 minuto",
        "environment": "Un cojín de meditación visible en el salón.",
        "location": "Salón",
        "attraction_strategy": "Encender una vela que me guste.",
        "friction_strategy": "Empezar con 1 minuto si el día es difícil.",
        "reward_strategy": "Tomar un sorbo de té al terminar.",
    },
    {
        "name": "Inglés",
        "description": "Practicar inglés 30 minutos",
        "type": "sessions",
        "unit": "sesiones",
        "target_value": 30,
        "target_unit": "min",
        "frequency_type": "weekly",
        "frequency_target": 4,
        "cue": "Antes de dormir",
        "color": "#10b981",
        "icon": "flag",
        "identity": "Persona que aprende",
        "hours": (21, 23),
        "value_range": (15, 45),
        "minimum_value": 5,
        "minimum_unit": "min",
        "minimum_description": "Escuchar 5 minutos en inglés",
        "environment": "Tener la app de idiomas en la pantalla de inicio.",
        "location": "Habitación",
        "attraction_strategy": "Ver una serie que me gusta en versión original.",
        "friction_strategy": "Empezar solo con 5 minutos.",
        "reward_strategy": "Añadir palabras nuevas a la lista personal.",
    },
]

IDENTITY_TEMPLATES = {
    "Lector": {"icon": "book", "color": "#3b82f6", "description": "Una persona que disfruta aprendiendo y leyendo con frecuencia."},
    "Persona activa": {"icon": "run", "color": "#f97316", "description": "Alguien que se mueve con regularidad y cuida su energía."},
    "Persona tranquila": {"icon": "zen", "color": "#8b5cf6", "description": "Alguien que cultiva calma y presencia cada día."},
    "Persona que aprende": {"icon": "flag", "color": "#10b981", "description": "Alguien que dedica tiempo a aprender algo nuevo."},
}

# Weekly counts for the 6 most recent weeks, oldest first. The last entry is
# the current (ongoing) week and matches the README example.
WEEK_COUNTS = {
    "Leer": [2, 3, 4, 4, 3, 3],
    "Correr": [1, 2, 3, 2, 3, 2],
    "Meditar": [3, 4, 4, 5, 5, 5],
    "Inglés": [2, 3, 3, 4, 4, 4],
}


def create_demo_data(conn, now=None):
    """Create demo identities + habits + events. Returns the list of created habits."""
    now = now or datetime.now()
    rng = random.Random(42)
    created = []
    existing_demo = conn.execute("SELECT COUNT(*) AS n FROM habits WHERE is_demo = 1").fetchone()["n"]
    if existing_demo:
        return []

    identities = {}
    for name, meta in IDENTITY_TEMPLATES.items():
        identities[name] = db.create_identity(
            conn,
            {"name": name, "description": meta["description"], "icon": meta["icon"], "color": meta["color"], "is_demo": True},
        )

    for tpl in HABIT_TEMPLATES:
        start_date = (now - timedelta(days=42)).strftime("%Y-%m-%d")
        habit = db.create_habit(
            conn,
            {
                "name": tpl["name"],
                "description": tpl["description"],
                "type": tpl["type"],
                "unit": tpl["unit"],
                "target_value": tpl["target_value"],
                "target_unit": tpl["target_unit"],
                "frequency_type": tpl["frequency_type"],
                "frequency_target": tpl["frequency_target"],
                "cue": tpl["cue"],
                "color": tpl["color"],
                "icon": tpl["icon"],
                "start_date": start_date,
                "is_demo": True,
                "identity_id": identities[tpl["identity"]]["id"],
                "minimum_value": tpl.get("minimum_value"),
                "minimum_unit": tpl.get("minimum_unit"),
                "minimum_description": tpl.get("minimum_description"),
                "environment": tpl.get("environment"),
                "location": tpl.get("location"),
                "attraction_strategy": tpl.get("attraction_strategy"),
                "friction_strategy": tpl.get("friction_strategy"),
                "reward_strategy": tpl.get("reward_strategy"),
            },
        )
        created.append(habit)

        counts = WEEK_COUNTS[tpl["name"]]
        week_start = periods.start_of_week(now) - timedelta(days=7 * (len(counts) - 1))
        for w_idx, count in enumerate(counts):
            week_begin = week_start + timedelta(days=7 * w_idx)
            # Choose distinct days within the week, avoiding future days.
            available = []
            for d in range(7):
                day = week_begin + timedelta(days=d)
                if day <= now:
                    available.append(day)
            rng.shuffle(available)
            chosen = available[:count]
            for day in chosen:
                hour = rng.randint(*tpl["hours"])
                minute = rng.choice([0, 5, 10, 15, 20, 25, 30])
                occurred = day.replace(hour=hour, minute=minute)
                if occurred > now:
                    occurred = now - timedelta(minutes=5)
                value = rng.randint(*tpl["value_range"])
                duration = value if tpl["type"] in ("duration", "sessions") else None
                if tpl["type"] == "sessions":
                    value = 1
                db.create_event(
                    conn,
                    habit["id"],
                    occurred.strftime("%Y-%m-%dT%H:%M"),
                    value=value,
                    unit=tpl["unit"],
                    duration=duration,
                    is_demo=True,
                )
    return created