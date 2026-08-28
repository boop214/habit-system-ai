"""Lightweight semantic matching for identities and habits.

No huge dictionary. It combines:
- textual match on normalized tokens (accents folded, lowercased)
- simple variants: singular/plural, Spanish/English aliases
- a small set of related-term groups per common concept (identity *ideas*)
- habit context: name, description, cue, unit
- previously confirmed associations (accepted links give a small boost)

Everything returns a confidence in [0, 1]. The user always decides.
"""
import re
import unicodedata

from . import db

# Generic words that never carry meaning for matching.
_STOP = {
    "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "al", "del",
    "y", "o", "a", "que", "con", "por", "para", "en", "es", "mi", "mis", "tu",
    "su", "se", "me", "te", "no", "si", "lo", "ya", "muy", "mas", "mas",
    "tengo", "quiero", "hacer", "ser", "the", "an", "of", "to", "and", "or",
    "i", "you", "my", "your", "at", "on", "in", "for", "with", "is",
    "persona", "alguien", "dia", "dias", "vida", "cosas", "vez", "veces",
    "hacer", "hoy", "manana", "momento", "poco", "mucho", "mucha",
}

# Morphological families: groups of words that refer to the same action/idea
# in Spanish and English. Used to relate e.g. "leer" with "lector".
_FAMILIES = [
    {"correr", "corriendo", "corre", "corro", "corria", "corrio", "corredor",
     "corredora", "corredores", "runner", "runners", "running", "jogging",
     "jog", "trotar", "trotando", "carrera", "carreras", "maraton",
     "maratones", "trail"},
    {"caminar", "camino", "caminando", "caminata", "paseo", "paseos", "andar",
     "andando", "senderismo", "sendero", "hiking", "walk"},
    {"leer", "leyendo", "lee", "leido", "leida", "lectura", "lector",
     "lectora", "lectores", "libro", "libros", "pagina", "paginas",
     "novela", "novelas", "capitulo", "capitulos", "kindle", "biblioteca",
     "read", "reading", "reader"},
    {"meditar", "meditacion", "meditando", "medito", "medita", "mindfulness",
     "respirar", "respiracion", "silencio", "calma", "presente"},
    {"aprender", "aprendo", "aprendiendo", "estudiar", "estudio",
     "estudiando", "practicar", "practico", "practicando", "practica",
     "idioma", "idiomas", "ingles", "curso", "cursos", "clase", "clases",
     "estudiante", "aprendiz", "learn", "learner"},
    {"entrenar", "entrenamiento", "entreno", "entrenando", "gimnasio", "gym",
     "pesas", "fuerza", "cardio", "ejercicio", "ejercicios", "ejercitar",
     "entrenador", "train", "workout"},
    {"nadar", "natacion", "nado", "nadando", "piscina", "swim", "swimming"},
    {"bicicleta", "bici", "ciclista", "ciclismo", "pedalear", "bike",
     "cycling", "cycling"},
    {"cocinar", "cocinando", "cocina", "cocinero", "cocinera", "receta",
     "recetas", "cook", "cooking"},
    {"escribir", "escritor", "escritora", "escritores", "escribiendo",
     "escribe", "escritura", "journaling", "diario", "bitacora", "write",
     "writing"},
    {"musica", "musico", "guitarra", "piano", "cantar", "cantando", "cantante",
     "music", "singing"},
    {"viajar", "viajando", "viajero", "viajera", "viajes", "viaje", "travel",
     "travelling"},
    {"vegetariano", "vegetariana", "vegano", "vegana", "verdura", "verduras",
     "fruta", "frutas", "saludable", "healthy", "plantas"},
    {"madrugar", "madrugador", "madrugadora", "temprano", "amanecer",
     "despertar", "despertarme", "levantar", "levantarme", "desayunar",
     "desayuno", "mornings"},
    {"ahorrar", "ahorro", "ahorros", "ahorrando", "ahorrador", "invertir",
     "inversion", "finanzas", "ahorra"},
    {"organizar", "organizado", "organizada", "ordenado", "ordenada",
     "planificar", "planificacion", "lista", "listas", "rutina", "rutinas",
     "agenda", "calendario", "organise", "organize"},
    {"moverse", "mover", "movimiento", "movilidad", "estiramientos",
     "estirar", "stretching", "flexibilidad", "yoga", "pilates", "activo",
     "activa", "stretch"},
    {"tranquilo", "tranquila", "calmado", "sereno", "relajado", "relajada",
     "relajarse", "relax", "tranquilidad"},
    {"creativo", "creativa", "crear", "creando", "dibujar", "pintar",
     "fotografia", "artes", "arte", "manualidades", "creative", "create",
     "drawing"},
    {"deporte", "deportes", "deportivo", "deportista", "sport", "sports",
     "jugar", "jugando", "partido", "partidos"},
]

# Concept groups: an identity is understood as an IDEA (its related terms),
# not just its literal words. `terms` are strong signals, `weights` can
# downgrade weaker terms, `aliases` are alternative names for the identity.
_CONCEPTS = {
    "runner": {
        "terms": {
            "correr", "corriendo", "runner", "running", "jogging", "jog",
            "trotar", "carrera", "carreras", "5k", "10k", "km", "maraton",
            "media maraton", "trail", "series", "velocidad", "zapatillas",
            "salir a correr", "salir a correr", "corredor", "corredora",
        },
        "weights": {"zapatillas": 0.6, "km": 0.55, "series": 0.55,
                    "velocidad": 0.5, "maraton": 0.8, "trail": 0.8},
        "aliases": {"runner", "runners", "corredor", "corredora", "corredores"},
    },
    "persona activa": {
        "terms": {
            "correr", "caminar", "senderismo", "gimnasio", "gym", "pesas",
            "fuerza", "cardio", "bicicleta", "bici", "ciclismo", "nadar",
            "natacion", "deporte", "deportes", "ejercicio", "ejercicios",
            "movilidad", "estiramientos", "entrenamiento", "activo", "activa",
            "actividad fisica", "yoga", "pilates", "salir a caminar",
            "entrenar", "moverme", "paseo",
        },
        "weights": {"movilidad": 0.5, "estiramientos": 0.5, "yoga": 0.5,
                    "pilates": 0.5, "paseo": 0.5, "actividad fisica": 0.7},
        "aliases": {"persona activa", "activo", "activa", "active person", "sporty"},
    },
    "lector": {
        "terms": {
            "leer", "leyendo", "lee", "libro", "libros", "lectura", "pagina",
            "paginas", "novela", "novelas", "capitulo", "capitulos", "kindle",
            "biblioteca", "leido", "leida",
        },
        "weights": {"pagina": 0.5, "paginas": 0.5, "capitulo": 0.5,
                    "capitulos": 0.5, "novela": 0.6, "novelas": 0.6},
        "aliases": {"lector", "lectora", "lectores", "reader", "readers", "bookworm"},
    },
    "persona tranquila": {
        "terms": {
            "meditar", "meditacion", "mindfulness", "respirar", "respiracion",
            "silencio", "calma", "calmado", "relajarse", "relax", "yoga",
            "presente", "tranquilidad", "respirar",
        },
        "weights": {"yoga": 0.5, "presente": 0.5, "tranquilidad": 0.5},
        "aliases": {"tranquilo", "tranquila", "calmado", "calmada", "zen"},
    },
    "persona que aprende": {
        "terms": {
            "aprender", "estudiar", "estudio", "estudiando", "practicar",
            "practicando", "idioma", "idiomas", "ingles", "curso", "cursos",
            "clase", "clases", "duolingo", "libros", "leer", "escuchar",
            "nuevo", "nueva", "curso online", "aprendizaje", "estudiante",
        },
        "weights": {"leer": 0.5, "libros": 0.5, "nuevo": 0.4, "nueva": 0.4,
                    "escuchar": 0.5, "nuevas": 0.4},
        "aliases": {"aprendiz", "estudiante", "learner", "student",
                    "persona que aprende"},
    },
    "cocinero": {
        "terms": {"cocinar", "cocina", "cocinando", "receta", "recetas",
                  "cocinar", "plato", "platos", "ingredientes", "hornear",
                  "cook", "cooking"},
        "weights": {"plato": 0.5, "platos": 0.5, "ingredientes": 0.5},
        "aliases": {"cocinero", "cocinera", "chef"},
    },
    "musico": {
        "terms": {"musica", "musico", "guitarra", "piano", "cantar",
                  "cantando", "cantante", "cancion", "canciones", "ritmo",
                  "music"},
        "weights": {"cancion": 0.5, "canciones": 0.5, "ritmo": 0.5},
        "aliases": {"musico", "musica", "musician", "singer"},
    },
    "viajero": {
        "terms": {"viajar", "viajando", "viaje", "viajes", "mochila", "vuelo",
                  "vuelos", "hotel", "explorar", "travel", "destino",
                  "destinos"},
        "weights": {"hotel": 0.5, "vuelo": 0.5, "vuelos": 0.5, "destino": 0.5,
                    "destinos": 0.5},
        "aliases": {"viajero", "viajera", "traveller", "traveler"},
    },
    "escritor": {
        "terms": {"escribir", "escritor", "escritora", "escribiendo",
                  "escritura", "journaling", "diario", "diarios", "bitacora",
                  "texto", "textos", "blog", "historia", "historias"},
        "weights": {"texto": 0.5, "textos": 0.5, "blog": 0.5, "diario": 0.5,
                    "diarios": 0.5},
        "aliases": {"escritor", "escritora", "writer"},
    },
}


def normalize(text):
    s = unicodedata.normalize("NFD", (text or "").lower())
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn")


def tokenize(text):
    return [t for t in re.split(r"[^a-z0-9]+", normalize(text or ""))
            if t and t not in _STOP]


def concept_for(identity):
    """Return the concept group for an identity, if one matches."""
    name = normalize(identity.get("name") or "")
    tokens = set(tokenize(name))
    for key, group in _CONCEPTS.items():
        key_norm = normalize(key)
        if key_norm in name:
            return group
        if tokens & group["aliases"]:
            return group
    for group in _CONCEPTS.values():
        if tokens & group["aliases"]:
            return group
    return None


def _identity_terms(identity):
    """All terms that relate to this identity: concept group + aliases + its
    own name tokens. Returns a dict term -> base weight."""
    terms = {}
    concept = concept_for(identity)
    if concept:
        for t in concept["terms"]:
            terms[t] = concept["weights"].get(t, 0.7)
        for a in concept["aliases"]:
            terms[a] = 0.9
    for tok in tokenize(identity.get("name") or ""):
        terms[tok] = max(terms.get(tok, 0), 0.8)
    return terms


def _family_match(id_tokens, habit_tokens):
    for fam in _FAMILIES:
        if id_tokens & fam and habit_tokens & fam:
            return True
    return False


def score_habit_identity(habit, identity, conn):
    """Confidence (0..1) that an identity is conceptually related to a habit."""
    name_txt = normalize(habit.get("name") or "")
    desc_txt = normalize(habit.get("description") or "")
    cue_txt = normalize(habit.get("cue") or "")
    unit_txt = normalize(habit.get("unit") or "")
    idname = normalize(identity.get("name") or "")

    score = 0.0
    matches = []

    terms = _identity_terms(identity)
    for term, w in terms.items():
        if term and term in name_txt:
            score += w
            matches.append(term)
        elif term and term in desc_txt:
            score += w * 0.6
        elif term and term in cue_txt:
            score += w * 0.45

    id_tokens = set(tokenize(idname))
    name_tokens = set(tokenize(habit.get("name") or ""))
    if _family_match(id_tokens, name_tokens):
        score += 0.75
        matches.append(next(iter(id_tokens & next(
            (f for f in _FAMILIES if id_tokens & f and name_tokens & f), id_tokens))))
    if unit_txt:
        for u in tokenize(unit_txt):
            if u in idname:
                score += 0.15
                break
    overlap = id_tokens & name_tokens
    if overlap:
        score += 0.6 * len(overlap)
        matches.extend(sorted(overlap))

    link = db.get_identity_link(conn, habit["id"], identity["id"])
    if link and link["status"] == "linked":
        score += 0.15

    confidence = min(1.0, round(score, 3))
    if confidence >= 0.7:
        level = "alta"
    elif confidence >= 0.45:
        level = "media"
    elif confidence >= 0.25:
        level = "baja"
    else:
        level = None
    return {
        "identity_id": identity["id"],
        "name": identity["name"],
        "icon": identity.get("icon"),
        "color": identity.get("color"),
        "confidence": confidence,
        "level": level,
        "matches": sorted(set(matches))[:6],
    }


def suggest_identity_for_habit(habit, identities, conn, min_confidence=0.45):
    """Candidate identities for a habit, excluding the primary identity and
    already-decided pairs (accepted or rejected)."""
    links = {l["identity_id"]: l for l in db.list_identity_links(conn, habit["id"])}
    primary = habit.get("identity_id")
    out = []
    for ident in identities:
        if ident["id"] == primary:
            continue
        link = links.get(ident["id"])
        if link and link["status"] in ("linked", "rejected"):
            continue
        s = score_habit_identity(habit, ident, conn)
        if s["level"] and s["confidence"] >= min_confidence:
            out.append(s)
    out.sort(key=lambda x: x["confidence"], reverse=True)
    return out


# ---------------------------------------------------------------------------
# Note ("Mañana") detection
# ---------------------------------------------------------------------------

def note_identity_score(text_norm, identity):
    """Confidence that a note mentions an identity, or None if too weak."""
    best = 0
    concept = concept_for(identity)
    if concept:
        for t in concept["terms"]:
            if t and t in text_norm:
                w = concept["weights"].get(t, 0.6)
                if w > best:
                    best = w
        for a in concept["aliases"]:
            if a and a in text_norm:
                best = max(best, 0.9)
    # its own name words are a weak signal (avoids "día tranquilo" triggers)
    for tok in tokenize(identity.get("name") or ""):
        if tok and tok in text_norm:
            best = max(best, 0.45)
    if best >= 0.5:
        return round(best, 3)
    return None


def note_habit_score(text_norm, habit):
    """Confidence that a free text mentions a habit (intention, not fact)."""
    name_txt = normalize(habit.get("name") or "")
    desc_txt = normalize(habit.get("description") or "")
    name_tokens = tokenize(name_txt)
    if not name_tokens:
        return {"confidence": 0.0, "level": None, "matches": []}
    matched = [t for t in name_tokens if t and t in text_norm]
    content_total = [t for t in name_tokens if not t.isdigit() and len(t) >= 3]
    content_matched = [t for t in content_total if t in text_norm]

    base = 0.0
    if content_total:
        base += 0.35 * (len(content_matched) / len(content_total))
        if content_matched:
            base += 0.2
    if matched:
        base += 0.15
    if desc_txt:
        if any(t in text_norm for t in tokenize(desc_txt) if len(t) >= 3):
            base += 0.1
    confidence = round(min(1.0, base), 3)
    if confidence >= 0.7:
        level = "alta"
    elif confidence >= 0.4:
        level = "media"
    else:
        level = None
    return {"confidence": confidence, "level": level, "matches": matched}


def detect_note(text, habits, identities, conn, min_habit=0.4, min_identity=0.5):
    """Detect habits and identities mentioned in a free note.

    Returns a list of detections. Planning never creates events; it only
    recognizes mentions and lets the user decide.
    """
    text_norm = normalize(text or "")
    if not text_norm.strip():
        return []

    id_scores = []
    for ident in identities:
        s = note_identity_score(text_norm, ident)
        if s is not None and s >= min_identity:
            id_scores.append((s, ident))
    id_scores.sort(key=lambda x: x[0], reverse=True)

    detections = []
    for habit in habits:
        s = note_habit_score(text_norm, habit)
        if s["level"] and s["confidence"] >= min_habit:
            identity = None
            if habit.get("identity_id"):
                primary = next((i for i in identities if i["id"] == habit["identity_id"]), None)
                if primary and note_identity_score(text_norm, primary) is not None:
                    identity = {"id": primary["id"], "name": primary["name"],
                                "icon": primary.get("icon"), "color": primary.get("color")}
            if identity is None and id_scores:
                top = id_scores[0][1]
                identity = {"id": top["id"], "name": top["name"],
                            "icon": top.get("icon"), "color": top.get("color")}
            min_val = habit.get("minimum_value")
            detections.append({
                "type": "habit",
                "habit_id": habit["id"],
                "habit_name": habit["name"],
                "identity": identity,
                "confidence": s["confidence"],
                "level": s["level"],
                "matches": s["matches"],
                "minimum": ({"value": min_val,
                             "unit": habit.get("minimum_unit"),
                             "description": habit.get("minimum_description")}
                            if min_val is not None else None),
            })

    for score, ident in id_scores:
        if any(d.get("identity") and d["identity"]["id"] == ident["id"]
               for d in detections):
            continue
        detections.append({
            "type": "identity",
            "identity_id": ident["id"],
            "name": ident["name"],
            "icon": ident.get("icon"),
            "color": ident.get("color"),
            "confidence": score,
            "level": "media" if score >= 0.6 else "baja",
            "matches": [],
        })
    return detections