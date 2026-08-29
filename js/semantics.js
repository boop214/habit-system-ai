/**
 * semantics.js — Lightweight semantic matching. Port of core/semantics.py.
 *
 * Pure logic: NO dependency on Flask, SQLite, IndexedDB, or db.js.
 * The two scoring functions that previously required DB now accept
 * pre-fetched link data as parameters.
 */

const semantics = (() => {
  /* ------------------------------------------------------------------ */
  /*  Constants                                                         */
  /* ------------------------------------------------------------------ */

  const _STOP = new Set([
    "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "al", "del",
    "y", "o", "a", "que", "con", "por", "para", "en", "es", "mi", "mis", "tu",
    "su", "se", "me", "te", "no", "si", "lo", "ya", "muy", "mas",
    "tengo", "quiero", "hacer", "ser", "the", "an", "of", "to", "and", "or",
    "i", "you", "my", "your", "at", "on", "in", "for", "with", "is",
    "persona", "alguien", "dia", "dias", "vida", "cosas", "vez", "veces",
    "hoy", "manana", "momento", "poco", "mucho", "mucha",
  ]);

  const _FAMILIES = [
    new Set(["correr", "corriendo", "corre", "corro", "corria", "corrio", "corredor",
      "corredora", "corredores", "runner", "runners", "running", "jogging",
      "jog", "trotar", "trotando", "carrera", "carreras", "maraton",
      "maratones", "trail"]),
    new Set(["caminar", "camino", "caminando", "caminata", "paseo", "paseos", "andar",
      "andando", "senderismo", "sendero", "hiking", "walk"]),
    new Set(["leer", "leyendo", "lee", "leido", "leida", "lectura", "lector",
      "lectora", "lectores", "libro", "libros", "pagina", "paginas",
      "novela", "novelas", "capitulo", "capitulos", "kindle", "biblioteca",
      "read", "reading", "reader"]),
    new Set(["meditar", "meditacion", "meditando", "medito", "medita", "mindfulness",
      "respirar", "respiracion", "silencio", "calma", "presente"]),
    new Set(["aprender", "aprendo", "aprendiendo", "estudiar", "estudio",
      "estudiando", "practicar", "practico", "practicando", "practica",
      "idioma", "idiomas", "ingles", "curso", "cursos", "clase", "clases",
      "estudiante", "aprendiz", "learn", "learner"]),
    new Set(["entrenar", "entrenamiento", "entreno", "entrenando", "gimnasio", "gym",
      "pesas", "fuerza", "cardio", "ejercicio", "ejercicios", "ejercitar",
      "entrenador", "train", "workout"]),
    new Set(["nadar", "natacion", "nado", "nadando", "piscina", "swim", "swimming"]),
    new Set(["bicicleta", "bici", "ciclista", "ciclismo", "pedalear", "bike",
      "cycling"]),
    new Set(["cocinar", "cocinando", "cocina", "cocinero", "cocinera", "receta",
      "recetas", "cook", "cooking"]),
    new Set(["escribir", "escritor", "escritora", "escritores", "escribiendo",
      "escribe", "escritura", "journaling", "diario", "bitacora", "write",
      "writing"]),
    new Set(["musica", "musico", "guitarra", "piano", "cantar", "cantando", "cantante",
      "music", "singing"]),
    new Set(["viajar", "viajando", "viajero", "viajera", "viajes", "viaje", "travel",
      "travelling"]),
    new Set(["vegetariano", "vegetariana", "vegano", "vegana", "verdura", "verduras",
      "fruta", "frutas", "saludable", "healthy", "plantas"]),
    new Set(["madrugar", "madrugador", "madrugadora", "temprano", "amanecer",
      "despertar", "despertarme", "levantar", "levantarme", "desayunar",
      "desayuno", "mornings"]),
    new Set(["ahorrar", "ahorro", "ahorros", "ahorrando", "ahorrador", "invertir",
      "inversion", "finanzas", "ahorra"]),
    new Set(["organizar", "organizado", "organizada", "ordenado", "ordenada",
      "planificar", "planificacion", "lista", "listas", "rutina", "rutinas",
      "agenda", "calendario", "organise", "organize"]),
    new Set(["moverse", "mover", "movimiento", "movilidad", "estiramientos",
      "estirar", "stretching", "flexibilidad", "yoga", "pilates", "activo",
      "activa", "stretch"]),
    new Set(["tranquilo", "tranquila", "calmado", "sereno", "relajado", "relajada",
      "relajarse", "relax", "tranquilidad"]),
    new Set(["creativo", "creativa", "crear", "creando", "dibujar", "pintar",
      "fotografia", "artes", "arte", "manualidades", "creative", "create",
      "drawing"]),
    new Set(["deporte", "deportes", "deportivo", "deportista", "sport", "sports",
      "jugar", "jugando", "partido", "partidos"]),
  ];

  const _CONCEPTS = {
    runner: {
      terms: new Set(["correr", "corriendo", "runner", "running", "jogging", "jog",
        "trotar", "carrera", "carreras", "5k", "10k", "km", "maraton",
        "media maraton", "trail", "series", "velocidad", "zapatillas",
        "salir a correr", "corredor", "corredora"]),
      weights: { zapatillas: 0.6, km: 0.55, series: 0.55,
        velocidad: 0.5, maraton: 0.8, trail: 0.8 },
      aliases: new Set(["runner", "runners", "corredor", "corredora", "corredores"]),
    },
    "persona activa": {
      terms: new Set(["correr", "caminar", "senderismo", "gimnasio", "gym", "pesas",
        "fuerza", "cardio", "bicicleta", "bici", "ciclismo", "nadar",
        "natacion", "deporte", "deportes", "ejercicio", "ejercicios",
        "movilidad", "estiramientos", "entrenamiento", "activo", "activa",
        "actividad fisica", "yoga", "pilates", "salir a caminar",
        "entrenar", "moverme", "paseo"]),
      weights: { movilidad: 0.5, estiramientos: 0.5, yoga: 0.5,
        pilates: 0.5, paseo: 0.5, "actividad fisica": 0.7 },
      aliases: new Set(["persona activa", "activo", "activa", "active person", "sporty"]),
    },
    lector: {
      terms: new Set(["leer", "leyendo", "lee", "libro", "libros", "lectura", "pagina",
        "paginas", "novela", "novelas", "capitulo", "capitulos", "kindle",
        "biblioteca", "leido", "leida"]),
      weights: { pagina: 0.5, paginas: 0.5, capitulo: 0.5,
        capitulos: 0.5, novela: 0.6, novelas: 0.6 },
      aliases: new Set(["lector", "lectora", "lectores", "reader", "readers", "bookworm"]),
    },
    "persona tranquila": {
      terms: new Set(["meditar", "meditacion", "mindfulness", "respirar", "respiracion",
        "silencio", "calma", "calmado", "relajarse", "relax", "yoga",
        "presente", "tranquilidad"]),
      weights: { yoga: 0.5, presente: 0.5, tranquilidad: 0.5 },
      aliases: new Set(["tranquilo", "tranquila", "calmado", "calmada", "zen"]),
    },
    "persona que aprende": {
      terms: new Set(["aprender", "estudiar", "estudio", "estudiando", "practicar",
        "practicando", "idioma", "idiomas", "ingles", "curso", "cursos",
        "clase", "clases", "duolingo", "libros", "leer", "escuchar",
        "nuevo", "nueva", "curso online", "aprendizaje", "estudiante"]),
      weights: { leer: 0.5, libros: 0.5, nuevo: 0.4, nueva: 0.4,
        escuchar: 0.5, nuevas: 0.4 },
      aliases: new Set(["aprendiz", "estudiante", "learner", "student",
        "persona que aprende"]),
    },
    cocinero: {
      terms: new Set(["cocinar", "cocina", "cocinando", "receta", "recetas",
        "plato", "platos", "ingredientes", "hornear", "cook", "cooking"]),
      weights: { plato: 0.5, platos: 0.5, ingredientes: 0.5 },
      aliases: new Set(["cocinero", "cocinera", "chef"]),
    },
    musico: {
      terms: new Set(["musica", "musico", "guitarra", "piano", "cantar",
        "cantando", "cantante", "cancion", "canciones", "ritmo", "music"]),
      weights: { cancion: 0.5, canciones: 0.5, ritmo: 0.5 },
      aliases: new Set(["musico", "musica", "musician", "singer"]),
    },
    viajero: {
      terms: new Set(["viajar", "viajando", "viaje", "viajes", "mochila", "vuelo",
        "vuelos", "hotel", "explorar", "travel", "destino", "destinos"]),
      weights: { hotel: 0.5, vuelo: 0.5, vuelos: 0.5, destino: 0.5, destinos: 0.5 },
      aliases: new Set(["viajero", "viajera", "traveller", "traveler"]),
    },
    escritor: {
      terms: new Set(["escribir", "escritor", "escritora", "escribiendo",
        "escritura", "journaling", "diario", "diarios", "bitacora",
        "texto", "textos", "blog", "historia", "historias"]),
      weights: { texto: 0.5, textos: 0.5, blog: 0.5, diario: 0.5, diarios: 0.5 },
      aliases: new Set(["escritor", "escritora", "writer"]),
    },
  };

  /* ------------------------------------------------------------------ */
  /*  Text processing                                                   */
  /* ------------------------------------------------------------------ */

  /** Strip accents / diacritical marks (replaces unicodedata NFD). */
  function stripDiacritics(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function normalize(text) {
    return stripDiacritics((text || "").toLowerCase());
  }

  function tokenize(text) {
    return normalize(text || "")
      .split(/[^a-z0-9]+/)
      .filter(t => t && !_STOP.has(t));
  }

  /* ------------------------------------------------------------------ */
  /*  Concept matching                                                  */
  /* ------------------------------------------------------------------ */

  function conceptFor(identity) {
    const name  = normalize(identity.name || "");
    const tokens = new Set(tokenize(name));
    for (const [key, group] of Object.entries(_CONCEPTS)) {
      const keyNorm = normalize(key);
      if (name.includes(keyNorm)) return group;
      for (const a of group.aliases) {
        if (tokens.has(a)) return group;
      }
    }
    for (const group of Object.values(_CONCEPTS)) {
      for (const a of group.aliases) {
        if (tokens.has(a)) return group;
      }
    }
    return null;
  }

  function _identityTerms(identity) {
    const terms = {};
    const concept = conceptFor(identity);
    if (concept) {
      for (const t of concept.terms) terms[t] = concept.weights[t] || 0.7;
      for (const a of concept.aliases) terms[a] = 0.9;
    }
    for (const tok of tokenize(identity.name || "")) {
      terms[tok] = Math.max(terms[tok] || 0, 0.8);
    }
    return terms;
  }

  function _familyMatch(idTokens, habitTokens) {
    for (const fam of _FAMILIES) {
      let idHas = false, habHas = false;
      for (const t of idTokens)  { if (fam.has(t)) { idHas = true; break; } }
      for (const t of habitTokens) { if (fam.has(t)) { habHas = true; break; } }
      if (idHas && habHas) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /*  Scoring (pure — no DB)                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Score how well an identity matches a habit.
   * @param {Object} habit       - habit object
   * @param {Object} identity    - identity object
   * @param {Set}    linkedIds   - Set of identity IDs already linked to habit
   * @returns {Object} {identity_id, name, icon, color, confidence, level, matches}
   */
  function scoreHabitIdentity(habit, identity, linkedIds) {
    const nameTxt  = normalize(habit.name || "");
    const descTxt  = normalize(habit.description || "");
    const cueTxt   = normalize(habit.cue || "");
    const unitTxt  = normalize(habit.unit || "");
    const idname   = normalize(identity.name || "");

    let score = 0;
    const matches = [];

    const terms = _identityTerms(identity);
    for (const [term, w] of Object.entries(terms)) {
      if (term && nameTxt.includes(term)) {
        score += w;
        matches.push(term);
      } else if (term && descTxt.includes(term)) {
        score += w * 0.6;
      } else if (term && cueTxt.includes(term)) {
        score += w * 0.45;
      }
    }

    const idTokens    = new Set(tokenize(idname));
    const nameTokens  = new Set(tokenize(habit.name || ""));
    if (_familyMatch(idTokens, nameTokens)) {
      score += 0.75;
      for (const fam of _FAMILIES) {
        const intersection = new Set([...idTokens].filter(t => fam.has(t) && nameTokens.has(t)));
        if (intersection.size > 0) {
          matches.push([...intersection][0]);
          break;
        }
      }
    }

    if (unitTxt) {
      for (const u of tokenize(unitTxt)) {
        if (idname.includes(u)) { score += 0.15; break; }
      }
    }

    const overlap = new Set([...idTokens].filter(t => nameTokens.has(t)));
    if (overlap.size > 0) {
      score += 0.6 * overlap.size;
      for (const t of overlap) matches.push(t);
    }

    if (linkedIds && linkedIds.has(identity.id)) {
      score += 0.15;
    }

    const confidence = Math.min(1.0, Math.round(score * 1000) / 1000);
    let level;
    if (confidence >= 0.7)      level = "alta";
    else if (confidence >= 0.45) level = "media";
    else if (confidence >= 0.25) level = "baja";
    else                         level = null;

    return {
      identity_id: identity.id,
      name: identity.name,
      icon: identity.icon,
      color: identity.color,
      confidence,
      level,
      matches: [...new Set(matches)].sort().slice(0, 6),
    };
  }

  /**
   * Suggest identities for a habit, excluding decided pairs.
   * @param {Object}   habit          - habit object
   * @param {Array}    identities     - all identities
   * @param {Array}    links          - identity links for this habit (from db.js)
   * @param {number}   minConfidence  - default 0.45
   * @returns {Array} sorted suggestions
   */
  function suggestIdentityForHabit(habit, identities, links, minConfidence) {
    minConfidence = minConfidence || 0.45;
    const linksById = {};
    for (const l of links) linksById[l.identity_id] = l;
    const primary = habit.identity_id;
    const out = [];
    for (const ident of identities) {
      if (ident.id === primary) continue;
      const link = linksById[ident.id];
      if (link && (link.status === "linked" || link.status === "rejected")) continue;
      const s = scoreHabitIdentity(habit, ident, null);
      if (s.level && s.confidence >= minConfidence) out.push(s);
    }
    out.sort((a, b) => b.confidence - a.confidence);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  Note detection (pure)                                             */
  /* ------------------------------------------------------------------ */

  function noteIdentityScore(textNorm, identity) {
    let best = 0;
    const concept = conceptFor(identity);
    if (concept) {
      for (const t of concept.terms) {
        if (t && textNorm.includes(t)) {
          const w = concept.weights[t] || 0.6;
          if (w > best) best = w;
        }
      }
      for (const a of concept.aliases) {
        if (a && textNorm.includes(a)) best = Math.max(best, 0.9);
      }
    }
    for (const tok of tokenize(identity.name || "")) {
      if (tok && textNorm.includes(tok)) best = Math.max(best, 0.45);
    }
    return best >= 0.5 ? Math.round(best * 1000) / 1000 : null;
  }

  function noteHabitScore(textNorm, habit) {
    const nameTxt = normalize(habit.name || "");
    const descTxt = normalize(habit.description || "");
    const nameTokens = tokenize(nameTxt);
    if (!nameTokens.length) return { confidence: 0.0, level: null, matches: [] };

    const matched = nameTokens.filter(t => t && textNorm.includes(t));
    const contentTotal  = nameTokens.filter(t => !/^\d+$/.test(t) && t.length >= 3);
    const contentMatched = contentTotal.filter(t => textNorm.includes(t));

    let base = 0.0;
    if (contentTotal.length) {
      base += 0.35 * (contentMatched.length / contentTotal.length);
      if (contentMatched.length) base += 0.2;
    }
    if (matched.length) base += 0.15;
    if (descTxt) {
      const descTokens = tokenize(descTxt).filter(t => t.length >= 3);
      if (descTokens.some(t => textNorm.includes(t))) base += 0.1;
    }

    const confidence = Math.round(Math.min(1.0, base) * 1000) / 1000;
    let level;
    if (confidence >= 0.7)      level = "alta";
    else if (confidence >= 0.4) level = "media";
    else                         level = null;
    return { confidence, level, matches: matched };
  }

  /**
   * Detect habits and identities mentioned in a free note.
   * @param {string} text
   * @param {Array}  habits
   * @param {Array}  identities
   * @param {number} minHabit     - default 0.4
   * @param {number} minIdentity  - default 0.5
   * @returns {Array} detections
   */
  function detectNote(text, habits, identities, minHabit, minIdentity) {
    minHabit    = minHabit    || 0.4;
    minIdentity = minIdentity || 0.5;
    const textNorm = normalize(text || "");
    if (!textNorm.trim()) return [];

    const idScores = [];
    for (const ident of identities) {
      const s = noteIdentityScore(textNorm, ident);
      if (s !== null && s >= minIdentity) idScores.push([s, ident]);
    }
    idScores.sort((a, b) => b[0] - a[0]);

    const detections = [];
    for (const habit of habits) {
      const s = noteHabitScore(textNorm, habit);
      if (s.level && s.confidence >= minHabit) {
        let identity = null;
        if (habit.identity_id) {
          const primary = identities.find(i => i.id === habit.identity_id);
          if (primary && noteIdentityScore(textNorm, primary) !== null) {
            identity = { id: primary.id, name: primary.name, icon: primary.icon, color: primary.color };
          }
        }
        if (identity === null && idScores.length) {
          const top = idScores[0][1];
          identity = { id: top.id, name: top.name, icon: top.icon, color: top.color };
        }
        detections.push({
          type: "habit",
          habit_id: habit.id,
          habit_name: habit.name,
          identity,
          confidence: s.confidence,
          level: s.level,
          matches: s.matches,
          minimum: habit.minimum_value != null
            ? { value: habit.minimum_value, unit: habit.minimum_unit, description: habit.minimum_description }
            : null,
        });
      }
    }

    for (const [score, ident] of idScores) {
      if (detections.some(d => d.identity && d.identity.id === ident.id)) continue;
      detections.push({
        type: "identity",
        identity_id: ident.id,
        name: ident.name,
        icon: ident.icon,
        color: ident.color,
        confidence: score,
        level: score >= 0.6 ? "media" : "baja",
        matches: [],
      });
    }
    return detections;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  return {
    normalize,
    tokenize,
    conceptFor,
    scoreHabitIdentity,
    suggestIdentityForHabit,
    noteIdentityScore,
    noteHabitScore,
    detectNote,
  };
})();
