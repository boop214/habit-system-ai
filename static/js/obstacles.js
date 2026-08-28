/**
 * obstacles.js — Obstacle-driven redesign. JS port of core/obstacles.py.
 *
 * Pure functions: receive a habit object and obstacle_type, return a suggestion.
 * Depends on NO storage layer — not Flask, SQLite, IndexedDB, or db.js.
 */

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const OBSTACLE_TYPES = {
  time:    "El momento no funciona",
  hard:    "Es demasiado difícil",
  env:     "Mi entorno no ayuda",
  forget:  "Se me olvida",
  notime:  "No tengo tiempo",
  energy:  "No tengo energía",
  unclear: "No sé exactamente qué hacer",
  other:   "Otro",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function obstacleLabel(obstacleType) {
  return OBSTACLE_TYPES[obstacleType] || obstacleType;
}

function _fmtNum(value) {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value === "number" && value % 1 === 0) return String(Math.floor(value));
  return String(value);
}

function formatValue(value, unit) {
  unit = (unit || "").trim();
  if (unit) return _fmtNum(value) + " " + unit;
  return _fmtNum(value);
}

function _describe(habit) {
  const name   = (habit.name || "Hacerlo").trim();
  const value  = habit.target_value;
  const unit   = habit.target_unit || habit.unit;

  if (habit.type === "boolean") {
    const freq   = habit.frequency_target || 1;
    const period = habit.frequency_type || "weekly";
    const label  = { daily: "día", weekly: "semana", monthly: "mes" }[period] || period;
    return name + " " + freq + " " + (freq === 1 ? "vez" : "veces") + " por " + label;
  }
  if (value === null || value === undefined) return name;
  return name + " " + formatValue(value, unit);
}

function _easierValue(value) {
  if (value === null || value === undefined) return null;
  if (value >= 15) return 5;
  if (value >= 8)  return 3;
  if (value > 1)   return 1;
  return value;
}

function _minimumParts(habit, target) {
  const htype = habit.type;
  const unit  = habit.target_unit || habit.unit;
  const name  = (habit.name || "Hacerlo").trim();

  if (htype === "duration") return { value: 2, unit: "min", description: "Hazlo durante 2 minutos" };
  if (htype === "sessions") return { value: 1, unit: "",    description: "Una sesión corta: " + name };
  if (htype === "boolean")  return { value: null, unit: "", description: "" };
  if (unit) return { value: 1, unit, description: "Haz solo 1 " + unit };
  return { value: 1, unit: "", description: "Una versión mínima de " + name };
}

function _frequencyReduction(habit) {
  const freq = habit.frequency_target;
  if (!freq || freq <= 1) return null;
  return Math.max(1, freq - 1);
}

/* ------------------------------------------------------------------ */
/*  Main redesign suggestion                                          */
/* ------------------------------------------------------------------ */

function redesignSuggestion(habit, obstacleType) {
  const htype = habit.type;
  const unit  = habit.target_unit || habit.unit;
  const name  = (habit.name || "").trim();
  const cue   = (habit.cue || "").trim();
  const value = habit.target_value;
  const freq  = habit.frequency_target;

  const current = _describe(habit);

  /* ---- time ---- */
  if (obstacleType === "time") {
    const newCue = cue || "Después de cenar";
    return {
      type: "time",
      message: "Probemos otro momento.",
      current: cue ? "Ahora: «" + cue + "»" : "Ahora: sin señal definida",
      proposed: "Encadénalo después de algo que ya haces sin pensar. Ejemplo: «Después de lavarme los dientes».",
      minimum: "",
      apply: { cue: "Después de lavarme los dientes" },
      fields: [
        { key: "cue",      label: "Señal",              kind: "text",   value: cue || "Después de lavarme los dientes" },
        { key: "location", label: "Lugar (opcional)",    kind: "text",   value: habit.location || "" },
      ],
    };
  }

  /* ---- forget ---- */
  if (obstacleType === "forget") {
    return {
      type: "forget",
      message: "Necesitamos una señal más clara.",
      current: cue ? "Ahora: «" + cue + "»" : "Ahora: sin señal definida",
      proposed: "Después de lavarme los dientes → " + (name || "la acción") + ".",
      minimum: "",
      apply: { cue: "Después de lavarme los dientes" },
      fields: [
        { key: "cue", label: "Señal", kind: "text", value: cue || "Después de lavarme los dientes" },
      ],
    };
  }

  /* ---- env ---- */
  if (obstacleType === "env") {
    const place = (habit.location || "").trim() || "a la vista";
    const item  = name || "lo necesario";
    const proposal = "Dejar " + item + " preparado " + place + ".";
    return {
      type: "env",
      message: "¿Qué puedes cambiar en tu entorno?",
      current: "Ahora: " + ((habit.environment || "").trim() || "no hay preparación definida"),
      proposed: "Preparación: «" + proposal + "»",
      minimum: "",
      apply: { environment: proposal },
      fields: [
        { key: "environment", label: "Preparación del entorno", kind: "text", value: proposal },
        { key: "location",    label: "Lugar",                   kind: "text", value: habit.location || "" },
      ],
    };
  }

  /* ---- hard / notime ---- */
  if (obstacleType === "hard" || obstacleType === "notime") {
    const message = obstacleType === "hard"
      ? "Podemos hacerlo más fácil."
      : "Reduzcamos la fricción temporal.";

    let reduced = _easierValue(value);
    let apply   = {};
    let fields  = [];
    let proposed, minimum;

    if (htype === "duration") {
      const mp = _minimumParts(habit, reduced);
      apply = {
        target_value: reduced || value,
        minimum_value: mp.value,
        minimum_unit: mp.unit,
        minimum_description: mp.description,
      };
      fields = [
        { key: "target_value",  label: "Duración por sesión (min)", kind: "number", value: reduced || value },
        { key: "minimum_value", label: "Versión mínima (min)",      kind: "number", value: mp.value },
      ];
      proposed = formatValue(reduced || value, "min");
      minimum  = "Versión mínima: " + mp.description;

    } else if (htype === "sessions") {
      const mp = _minimumParts(habit, null);
      apply = { minimum_value: 1, minimum_description: mp.description };
      if (value && value > 15) apply.target_value = _easierValue(value);
      fields = [
        { key: "target_value", label: "Minutos por sesión", kind: "number", value: apply.target_value || value },
      ];
      proposed = apply.target_value
        ? apply.target_value + " min por sesión"
        : "una sesión corta";
      minimum = "Versión mínima: " + mp.description;

    } else if (htype === "boolean") {
      const fr = _frequencyReduction(habit);
      if (fr) {
        apply = { frequency_target: fr };
        fields = [{ key: "frequency_target", label: "Veces por semana", kind: "number", value: fr }];
      }
      proposed = fr
        ? "Reducir la frecuencia a " + fr + " " + (fr === 1 ? "vez" : "veces") + " por semana"
        : "Mantener la frecuencia actual";
      minimum = "";

    } else if (value !== null && value !== undefined) {
      reduced = _easierValue(value);
      const mp = _minimumParts(habit, reduced);
      apply = {
        target_value: reduced,
        minimum_value: mp.value,
        minimum_unit: mp.unit,
        minimum_description: mp.description,
      };
      fields = [
        { key: "target_value",  label: "Cantidad por registro", kind: "number", value: reduced },
        { key: "minimum_value", label: "Versión mínima",        kind: "number", value: mp.value },
      ];
      proposed = formatValue(reduced, unit);
      minimum  = "Versión mínima: " + mp.description;

    } else {
      proposed = current;
      minimum  = "";
    }

    return {
      type: obstacleType,
      message,
      current: "Ahora: " + current,
      proposed: "Podríamos probar: " + proposed,
      minimum,
      apply: Object.keys(apply).length ? apply : null,
      fields,
    };
  }

  /* ---- energy ---- */
  if (obstacleType === "energy") {
    const mp = _minimumParts(habit, null);
    return {
      type: "energy",
      message: "Quizá este hábito está colocado en un momento poco adecuado.",
      current: cue ? "Ahora: «" + cue + "»" : "Ahora: sin momento definido",
      proposed: "Hazlo en un momento con más energía, por ejemplo a primera hora de la mañana.",
      minimum: mp.description ? "Versión mínima: " + mp.description : "",
      apply: { cue: "A primera hora de la mañana" },
      fields: [
        { key: "cue", label: "Señal", kind: "text", value: cue || "A primera hora de la mañana" },
      ],
    };
  }

  /* ---- unclear ---- */
  if (obstacleType === "unclear") {
    const concreteName = name || "Hacer algo concreto";
    return {
      type: "unclear",
      message: "Vamos a convertirlo en una acción concreta.",
      current: "Ahora: «" + (name || "sin nombre claro") + "»",
      proposed: "Una acción concreta describe QUÉ haces exactamente. Ejemplo: «Hacer 10 minutos del curso X» en vez de «Aprender programación».",
      minimum: "",
      apply: {
        name: concreteName,
        description: habit.description || "Qué hacer exactamente: " + concreteName,
      },
      fields: [
        { key: "name",        label: "Acción concreta",                      kind: "text", value: concreteName },
        { key: "description", label: "Descripción (qué haces exactamente)",   kind: "text", value: habit.description || "" },
      ],
    };
  }

  /* ---- other ---- */
  return {
    type: "other",
    message: "¿Quieres rediseñar el hábito?",
    current: "Ahora: " + current,
    proposed: "",
    minimum: "",
    apply: null,
    fields: [],
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

const obstacles = (() => ({
  OBSTACLE_TYPES,
  obstacleLabel,
  formatValue,
  redesignSuggestion,
}))();
