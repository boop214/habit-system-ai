/**
 * seed.js — Deterministic demo data generator. Port of core/seed.py.
 *
 * Uses habitDB for persistence. Generates ~6 weeks of realistic events.
 * All demo rows are tagged with is_demo=true so they can be removed in one click.
 */

const seed = (() => {
  /* ------------------------------------------------------------------ */
  /*  Constants                                                         */
  /* ------------------------------------------------------------------ */

  const HABIT_TEMPLATES = [
    {
      name: "Leer",
      description: "Leer al menos 10 minutos",
      type: "duration",
      unit: "min",
      target_value: 10,
      target_unit: "min",
      frequency_type: "weekly",
      frequency_target: 4,
      cue: "Después de cenar",
      color: "#3b82f6",
      icon: "book",
      identity: "Lector",
      hours: [20, 22],
      value_range: [10, 30],
      minimum_value: 1,
      minimum_unit: "min",
      minimum_description: "Leer 1 página",
      environment: "Dejar el libro sobre la mesa antes de cenar.",
      location: "Salón",
      attraction_strategy: "Tomar el café mientras leo.",
      friction_strategy: "Tener el libro abierto en la página siguiente.",
      reward_strategy: "Marcar el progreso al terminar.",
    },
    {
      name: "Correr",
      description: "Salir a correr 5 km",
      type: "distance",
      unit: "km",
      target_value: 5,
      target_unit: "km",
      frequency_type: "weekly",
      frequency_target: 3,
      cue: "Al despertar",
      color: "#f97316",
      icon: "run",
      identity: "Persona activa",
      hours: [7, 9],
      value_range: [4, 8],
      minimum_value: 1,
      minimum_unit: "km",
      minimum_description: "Caminar 10 minutos",
      environment: "Dejar las zapatillas junto a la puerta.",
      location: "Parque",
      attraction_strategy: "Escuchar el podcast favorito mientras corro.",
      friction_strategy: "Tener la ropa deportiva preparada la noche anterior.",
      reward_strategy: "Registrar el km recorrido al volver.",
    },
    {
      name: "Meditar",
      description: "Meditar 10 minutos",
      type: "duration",
      unit: "min",
      target_value: 10,
      target_unit: "min",
      frequency_type: "weekly",
      frequency_target: 5,
      cue: "Después de desayunar",
      color: "#8b5cf6",
      icon: "zen",
      identity: "Persona tranquila",
      hours: [8, 10],
      value_range: [8, 15],
      minimum_value: 1,
      minimum_unit: "min",
      minimum_description: "Respirar conscientemente 1 minuto",
      environment: "Un cojín de meditación visible en el salón.",
      location: "Salón",
      attraction_strategy: "Encender una vela que me guste.",
      friction_strategy: "Empezar con 1 minuto si el día es difícil.",
      reward_strategy: "Tomar un sorbo de té al terminar.",
    },
    {
      name: "Inglés",
      description: "Practicar inglés 30 minutos",
      type: "sessions",
      unit: "sesiones",
      target_value: 30,
      target_unit: "min",
      frequency_type: "weekly",
      frequency_target: 4,
      cue: "Antes de dormir",
      color: "#10b981",
      icon: "flag",
      identity: "Persona que aprende",
      hours: [21, 23],
      value_range: [15, 45],
      minimum_value: 5,
      minimum_unit: "min",
      minimum_description: "Escuchar 5 minutos en inglés",
      environment: "Tener la app de idiomas en la pantalla de inicio.",
      location: "Habitación",
      attraction_strategy: "Ver una serie que me gusta en versión original.",
      friction_strategy: "Empezar solo con 5 minutos.",
      reward_strategy: "Añadir palabras nuevas a la lista personal.",
    },
  ];

  const IDENTITY_TEMPLATES = {
    Lector: { icon: "book", color: "#3b82f6", description: "Una persona que disfruta aprendiendo y leyendo con frecuencia." },
    "Persona activa": { icon: "run", color: "#f97316", description: "Alguien que se mueve con regularidad y cuida su energía." },
    "Persona tranquila": { icon: "zen", color: "#8b5cf6", description: "Alguien que cultiva calma y presencia cada día." },
    "Persona que aprende": { icon: "flag", color: "#10b981", description: "Alguien que dedica tiempo a aprender algo nuevo." },
  };

  const WEEK_COUNTS = {
    Leer:      [2, 3, 4, 4, 3, 3],
    Correr:    [1, 2, 3, 2, 3, 2],
    Meditar:   [3, 4, 4, 5, 5, 5],
    "Inglés":  [2, 3, 3, 4, 4, 4],
  };

  /* ------------------------------------------------------------------ */
  /*  Seeded PRNG (Mulberry32)                                          */
  /* ------------------------------------------------------------------ */

  function mulberry32(seed) {
    let s = seed | 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  function choice(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  /* ------------------------------------------------------------------ */
  /*  Date helpers                                                      */
  /* ------------------------------------------------------------------ */

  function daysAgo(now, n) {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d;
  }

  function fmtDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function fmtDatetime(d) {
    return fmtDate(d) + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  /* ------------------------------------------------------------------ */
  /*  Main generator                                                    */
  /* ------------------------------------------------------------------ */

  async function createDemoData(now) {
    now = now || new Date();
    const rng = mulberry32(42);

    // Check if demo data already exists
    const existing = await habitDB.hasAnyHabit();
    const allHabits = await habitDB.listHabits();
    if (allHabits.some(h => h.is_demo)) return [];

    const created = [];

    // Create identities
    const identities = {};
    for (const [name, meta] of Object.entries(IDENTITY_TEMPLATES)) {
      identities[name] = await habitDB.createIdentity({
        name,
        description: meta.description,
        icon: meta.icon,
        color: meta.color,
        is_demo: true,
      });
    }

    // Create habits and events
    for (const tpl of HABIT_TEMPLATES) {
      const startDate = fmtDate(daysAgo(now, 42));
      const habit = await habitDB.createHabit({
        name: tpl.name,
        description: tpl.description,
        type: tpl.type,
        unit: tpl.unit,
        target_value: tpl.target_value,
        target_unit: tpl.target_unit,
        frequency_type: tpl.frequency_type,
        frequency_target: tpl.frequency_target,
        cue: tpl.cue,
        color: tpl.color,
        icon: tpl.icon,
        start_date: startDate,
        is_demo: true,
        identity_id: identities[tpl.identity].id,
        minimum_value: tpl.minimum_value,
        minimum_unit: tpl.minimum_unit,
        minimum_description: tpl.minimum_description,
        environment: tpl.environment,
        location: tpl.location,
        attraction_strategy: tpl.attraction_strategy,
        friction_strategy: tpl.friction_strategy,
        reward_strategy: tpl.reward_strategy,
      });
      created.push(habit);

      // Generate events
      const counts = WEEK_COUNTS[tpl.name];
      const thisMonday = periods.startOfWeek(now);
      const weekStart = new Date(thisMonday);
      weekStart.setDate(weekStart.getDate() - 7 * (counts.length - 1));

      for (let wIdx = 0; wIdx < counts.length; wIdx++) {
        const count = counts[wIdx];
        const weekBegin = new Date(weekStart);
        weekBegin.setDate(weekBegin.getDate() + 7 * wIdx);

        // Available days in this week (not in the future)
        const available = [];
        for (let d = 0; d < 7; d++) {
          const day = new Date(weekBegin);
          day.setDate(day.getDate() + d);
          if (day <= now) available.push(day);
        }
        shuffle(available, rng);
        const chosen = available.slice(0, count);

        for (const day of chosen) {
          const hour = randInt(rng, tpl.hours[0], tpl.hours[1]);
          const minute = choice(rng, [0, 5, 10, 15, 20, 25, 30]);
          const occurred = new Date(day);
          occurred.setHours(hour, minute, 0, 0);

          let finalOccurred = occurred;
          if (occurred > now) {
            finalOccurred = new Date(now);
            finalOccurred.setMinutes(finalOccurred.getMinutes() - 5);
          }

          let value = randInt(rng, tpl.value_range[0], tpl.value_range[1]);
          const duration = (tpl.type === "duration" || tpl.type === "sessions") ? value : null;
          if (tpl.type === "sessions") value = 1;

          await habitDB.createEvent(habit.id, fmtDatetime(finalOccurred), {
            value,
            unit: tpl.unit,
            duration,
            isDemo: true,
          });
        }
      }
    }
    return created;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  return {
    HABIT_TEMPLATES,
    IDENTITY_TEMPLATES,
    WEEK_COUNTS,
    createDemoData,
  };
})();
