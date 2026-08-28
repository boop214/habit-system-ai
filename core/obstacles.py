"""Obstacle-driven redesign.

Philosophy: "No has fallado. Hemos encontrado información sobre el sistema."

Selecting an obstacle is the FIRST step of a redesign process, not the last:

    PROBLEMA -> DIAGNÓSTICO -> SUGERENCIA -> EL USUARIO DECIDE -> NUEVO SISTEMA

This module only proposes changes. Nothing is persisted and nothing is applied
automatically: the frontend shows the proposal and the user decides.
"""
from . import db

OBSTACLE_TYPES = {
    "time": "El momento no funciona",
    "hard": "Es demasiado difícil",
    "env": "Mi entorno no ayuda",
    "forget": "Se me olvida",
    "notime": "No tengo tiempo",
    "energy": "No tengo energía",
    "unclear": "No sé exactamente qué hacer",
    "other": "Otro",
}


def obstacle_label(obstacle_type):
    return OBSTACLE_TYPES.get(obstacle_type, obstacle_type)


def _fmt_num(value):
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def format_value(value, unit):
    unit = (unit or "").strip()
    if unit:
        return f"{_fmt_num(value)} {unit}"
    return _fmt_num(value)


def _describe(habit):
    """Short human-readable description of the current target, e.g. 'Leer 20 min'."""
    name = (habit.get("name") or "Hacerlo").strip()
    value = habit.get("target_value")
    unit = habit.get("target_unit") or habit.get("unit")
    if habit.get("type") == "boolean":
        freq = habit.get("frequency_target") or 1
        period = habit.get("frequency_type") or "weekly"
        label = {"daily": "día", "weekly": "semana", "monthly": "mes"}.get(period, period)
        return f"{name} {freq} {freq == 1 and 'vez' or 'veces'} por {label}"
    if value is None:
        return name
    return f"{name} {format_value(value, unit)}"


def _easier_value(value):
    """A smaller but still meaningful value (never 0, never increasing)."""
    if value is None:
        return None
    if value >= 15:
        return 5
    if value >= 8:
        return 3
    if value > 1:
        return 1
    return value


def _minimum_parts(habit, target):
    """Build (minimum_value, minimum_unit, minimum_description) for the 'hazlo
    fácil' field based on the habit type and the reduced target."""
    htype = habit.get("type")
    unit = habit.get("target_unit") or habit.get("unit")
    name = (habit.get("name") or "Hacerlo").strip()
    if htype == "duration":
        return 2, "min", f"Hazlo durante 2 minutos"
    if htype == "sessions":
        return 1, "", f"Una sesión corta: {name}"
    if htype == "boolean":
        return None, "", ""
    if unit:
        return 1, unit, f"Haz solo 1 {unit}"
    return 1, "", f"Una versión mínima de {name}"


def _frequency_reduction(habit):
    freq = habit.get("frequency_target")
    if not freq or freq <= 1:
        return None
    return max(1, freq - 1)


def redesign_suggestion(habit, obstacle_type):
    """Compute a concrete redesign proposal for a habit given an obstacle.

    Returns a dict (never mutates anything):
      type, message, current, proposed, minimum, apply (partial habit update),
      fields (editable inputs the user can adjust before applying).
    `apply` may be None when there is nothing safe to change automatically.
    """
    htype = habit.get("type")
    unit = habit.get("target_unit") or habit.get("unit")
    name = (habit.get("name") or "").strip()
    cue = (habit.get("cue") or "").strip()
    value = habit.get("target_value")
    freq = habit.get("frequency_target")

    current = _describe(habit)

    if obstacle_type == "time":
        new_cue = cue or "Después de cenar"
        return {
            "type": "time",
            "message": "Probemos otro momento.",
            "current": f"Ahora: «{new_cue}»" if cue else "Ahora: sin señal definida",
            "proposed": "Encadénalo después de algo que ya haces sin pensar. Ejemplo: «Después de lavarme los dientes».",
            "minimum": "",
            "apply": {"cue": "Después de lavarme los dientes"},
            "fields": [
                {"key": "cue", "label": "Señal", "kind": "text", "value": cue or "Después de lavarme los dientes"},
                {"key": "location", "label": "Lugar (opcional)", "kind": "text", "value": habit.get("location") or ""},
            ],
        }

    if obstacle_type == "forget":
        return {
            "type": "forget",
            "message": "Necesitamos una señal más clara.",
            "current": f"Ahora: «{cue}»" if cue else "Ahora: sin señal definida",
            "proposed": "Después de lavarme los dientes → " + (name or "la acción") + ".",
            "minimum": "",
            "apply": {"cue": "Después de lavarme los dientes"},
            "fields": [
                {"key": "cue", "label": "Señal", "kind": "text", "value": cue or "Después de lavarme los dientes"},
            ],
        }

    if obstacle_type == "env":
        place = (habit.get("location") or "").strip() or "a la vista"
        item = (name or "lo necesario")
        proposal = f"Dejar {item} preparado {place}."
        return {
            "type": "env",
            "message": "¿Qué puedes cambiar en tu entorno?",
            "current": "Ahora: " + ((habit.get("environment") or "").strip() or "no hay preparación definida"),
            "proposed": f"Preparación: «{proposal}»",
            "minimum": "",
            "apply": {"environment": proposal},
            "fields": [
                {"key": "environment", "label": "Preparación del entorno", "kind": "text", "value": proposal},
                {"key": "location", "label": "Lugar", "kind": "text", "value": habit.get("location") or ""},
            ],
        }

    if obstacle_type in ("hard", "notime"):
        message = "Podemos hacerlo más fácil." if obstacle_type == "hard" else "Reduzcamos la fricción temporal."
        reduced = _easier_value(value)
        apply = {}
        fields = []
        if htype == "duration":
            min_v, min_u, min_d = _minimum_parts(habit, reduced)
            apply = {
                "target_value": reduced if reduced else value,
                "minimum_value": min_v,
                "minimum_unit": min_u,
                "minimum_description": min_d,
            }
            fields = [
                {"key": "target_value", "label": "Duración por sesión (min)", "kind": "number", "value": reduced or value},
                {"key": "minimum_value", "label": "Versión mínima (min)", "kind": "number", "value": min_v},
            ]
            proposed = format_value(reduced or value, "min")
            minimum = f"Versión mínima: {min_d}"
        elif htype == "sessions":
            apply = {"minimum_value": 1, "minimum_description": _minimum_parts(habit, None)[2]}
            if value and value > 15:
                apply["target_value"] = _easier_value(value)
            fields = [
                {"key": "target_value", "label": "Minutos por sesión", "kind": "number", "value": apply.get("target_value", value)},
            ]
            proposed = (f"{apply.get('target_value', value)} min por sesión" if apply.get("target_value") else "una sesión corta")
            minimum = f"Versión mínima: {_minimum_parts(habit, None)[2]}"
        elif htype == "boolean":
            fr = _frequency_reduction(habit)
            if fr:
                apply = {"frequency_target": fr}
                fields = [{"key": "frequency_target", "label": "Veces por semana", "kind": "number", "value": fr}]
            proposed = f"Reducir la frecuencia a {fr} {fr == 1 and 'vez' or 'veces'} por semana" if fr else "Mantener la frecuencia actual"
            minimum = ""
        elif value is not None:
            reduced = _easier_value(value)
            min_v, min_u, min_d = _minimum_parts(habit, reduced)
            apply = {
                "target_value": reduced,
                "minimum_value": min_v,
                "minimum_unit": min_u,
                "minimum_description": min_d,
            }
            fields = [
                {"key": "target_value", "label": "Cantidad por registro", "kind": "number", "value": reduced},
                {"key": "minimum_value", "label": "Versión mínima", "kind": "number", "value": min_v},
            ]
            proposed = format_value(reduced, unit)
            minimum = f"Versión mínima: {min_d}"
        else:
            proposed = current
            minimum = ""
        return {
            "type": obstacle_type,
            "message": message,
            "current": f"Ahora: {current}",
            "proposed": f"Podríamos probar: {proposed}",
            "minimum": minimum,
            "apply": apply or None,
            "fields": fields,
        }

    if obstacle_type == "energy":
        return {
            "type": "energy",
            "message": "Quizá este hábito está colocado en un momento poco adecuado.",
            "current": f"Ahora: «{cue}»" if cue else "Ahora: sin momento definido",
            "proposed": "Hazlo en un momento con más energía, por ejemplo a primera hora de la mañana.",
            "minimum": "Versión mínima: " + _minimum_parts(habit, None)[2] if _minimum_parts(habit, None)[2] else "",
            "apply": {"cue": "A primera hora de la mañana"},
            "fields": [
                {"key": "cue", "label": "Señal", "kind": "text", "value": cue or "A primera hora de la mañana"},
            ],
        }

    if obstacle_type == "unclear":
        concrete_name = name or "Hacer algo concreto"
        return {
            "type": "unclear",
            "message": "Vamos a convertirlo en una acción concreta.",
            "current": f"Ahora: «{name or 'sin nombre claro'}»",
            "proposed": "Una acción concreta describe QUÉ haces exactamente. Ejemplo: «Hacer 10 minutos del curso X» en vez de «Aprender programación».",
            "minimum": "",
            "apply": {
                "name": concrete_name,
                "description": habit.get("description") or f"Qué hacer exactamente: {concrete_name}",
            },
            "fields": [
                {"key": "name", "label": "Acción concreta", "kind": "text", "value": concrete_name},
                {"key": "description", "label": "Descripción (qué haces exactamente)", "kind": "text", "value": habit.get("description") or ""},
            ],
        }

    # "other": nothing safe to propose automatically. The user explains and
    # decides whether to open the full redesign wizard.
    return {
        "type": "other",
        "message": "¿Quieres rediseñar el hábito?",
        "current": f"Ahora: {current}",
        "proposed": "",
        "minimum": "",
        "apply": None,
        "fields": [],
    }