/* Habit Tracker — sistema de hábitos basado en identidad.
   Cada acción es un voto por la persona que quieres ser.
   La identidad nunca es una puntuación: es evidencia acumulada. */
(function () {
  "use strict";

  // --------------------------------------------------------------- helpers
  const ICONS = {
    star: "⭐", book: "📖", run: "🏃", zen: "🧘", flag: "🇬🇧", water: "💧",
    gym: "💪", sleep: "😴", write: "✍️", music: "🎸", plant: "🌱",
    heart: "❤️", brain: "🧠", sun: "☀️", brush: "🪥", food: "🍎",
    study: "🎓", code: "💻", med: "💊", walk: "🚶",
  };
  const COLORS = ["#4f7cff", "#10b981", "#f97316", "#8b5cf6", "#ef4444", "#eab308", "#14b8a6", "#ec4899"];
  const WEEKDAY_ISO = [1, 2, 3, 4, 5, 6, 7]; // Mon..Sun
  const OBSTACLE_OPTIONS = [
    { id: "time", label: "⏰ El momento no funciona" },
    { id: "hard", label: "😓 Es demasiado difícil" },
    { id: "env", label: "🏠 Mi entorno no ayuda" },
    { id: "forget", label: "🧠 Se me olvida" },
    { id: "notime", label: "⌛ No tengo tiempo" },
    { id: "energy", label: "😴 No tengo energía" },
    { id: "unclear", label: "❓ No sé exactamente qué hacer" },
    { id: "other", label: "Otro" },
  ];
  const IDENTITY_SUGGESTIONS = [
    { keys: ["leer", "lector", "libro"], actions: ["Leer 2 páginas", "Leer 20 minutos", "Abrir el libro y leer una página"] },
    { keys: ["activ", "corr", "mover", "camin", "deport"], actions: ["Caminar 10 minutos", "Hacer 10 flexiones", "Salir a correr 15 minutos"] },
    { keys: ["tranquil", "medit", "calm", "respir", "zen"], actions: ["Meditar 2 minutos", "Respirar conscientemente 1 minuto", "Hacer una pausa de 5 minutos"] },
    { keys: ["aprend", "estud", "ingles", "clase", "curso", "idiom"], actions: ["Estudiar 5 minutos", "Practicar inglés 10 minutos", "Aprender 1 cosa nueva"] },
    { keys: ["creativ", "arte", "escrib", "dibuj", "musica"], actions: ["Escribir 5 minutos", "Dibujar algo pequeño", "Practicar música 10 minutos"] },
    { keys: ["salud", "comer", "agua", "verdura", "fruta", "fuerte"], actions: ["Beber un vaso de agua", "Comer una pieza de fruta", "Preparar algo saludable"] },
    { keys: ["organiz", "orden", "productiv", "constanc"], actions: ["Ordenar una zona 5 minutos", "Escribir 3 prioridades del día", "Hacer la cama"] },
    { keys: ["presente", "familia", "gracias", "conexion"], actions: ["Llamar a un ser querido", "Escribir algo por lo que agradezco", "Escuchar a alguien 5 minutos"] },
  ];
  const GENERIC_SUGGESTIONS = ["Hazlo durante 2 minutos", "Haz una versión mínima que puedas hacer en un día difícil", "Hazlo justo después de algo que ya haces"];

  const TYPE_META = {
    boolean: { label: "Sí / No", desc: "Marcar realizado" },
    count: { label: "Contador", desc: "N veces (ej. vasos)" },
    duration: { label: "Duración", desc: "Minutos por sesión" },
    quantity: { label: "Cantidad", desc: "Ej. páginas" },
    distance: { label: "Distancia", desc: "Ej. km" },
    repetitions: { label: "Repeticiones", desc: "Ej. flexiones" },
    sessions: { label: "Sesiones", desc: "Práctica, con minutos" },
  };
  const TYPE_UNIT_PLACEHOLDER = {
    count: "ej. vasos", quantity: "ej. páginas", distance: "ej. km", repetitions: "ej. flexiones",
  };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    let lateValue;
    for (const k of Object.keys(attrs || {})) {
      const v = attrs[k];
      if (v === undefined || v === null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "on") {
        for (const ev of Object.keys(v)) node.addEventListener(ev, v[ev]);
      } else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k === "style") node.setAttribute("style", v);
      else if (k === "checked") node.checked = Boolean(v);
      else if (k === "value") lateValue = v;
      else node.setAttribute(k, v);
    }
    if (children !== undefined) {
      const append = (c) => {
        if (c == null) return;
        if (Array.isArray(c)) { c.forEach(append); return; }
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      };
      (Array.isArray(children) ? children : [children]).forEach(append);
    }
    if (lateValue !== undefined &&
        (node.tagName === "SELECT" || node.tagName === "INPUT" ||
         node.tagName === "OPTION" || node.tagName === "TEXTAREA")) {
      node.value = lateValue;
    }
    return node;
  }

  function toast(message, kind) {
    const root = document.getElementById("toast-root");
    const t = el("div", { class: "toast" + (kind ? " " + kind : ""), text: message });
    root.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transition = "opacity .3s";
      setTimeout(() => t.remove(), 300);
    }, 2600);
  }

  function voteBurst(anchor, text) {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const span = el("span", { class: "vote-burst", text: text || "+1" });
    document.body.appendChild(span);
    span.style.left = (rect.left + rect.width / 2 - 28) + "px";
    span.style.top = (rect.top - 8) + "px";
    setTimeout(() => span.remove(), 900);
  }

  function confirmDialog(title, message, okLabel, danger) {
    return new Promise((resolve) => {
      const body = el("div", {});
      if (typeof message === "string") {
        body.appendChild(el("p", { class: "muted", text: message }));
      } else {
        if (message.lead) body.appendChild(el("p", { class: "muted", text: message.lead }));
        if (message.items && message.items.length) {
          body.appendChild(el("ul", { class: "confirm-list" },
            message.items.map((m) => el("li", { text: m }))));
        }
        if (message.trail) body.appendChild(el("p", { class: "muted", text: message.trail }));
      }
      const modal = openModal({
        title,
        body,
        foot: [
          el("button", { class: "btn", text: "Cancelar", on: { click: () => { closeModal(modal); resolve(false); } } }),
          el("button", {
            class: "btn " + (danger ? "btn-danger" : "btn-primary"), text: okLabel,
            on: { click: () => { closeModal(modal); resolve(true); } },
          }),
        ],
      });
    });
  }

  function iconOf(habitOrIdentity) {
    return ICONS[habitOrIdentity.icon] || ICONS.star;
  }

  // ---------------------------------------------------------------- modal
  let activeModal = null;

  function openModal({ title, body, foot, onClose, wide }) {
    closeModal();
    const tpl = document.getElementById("tpl-modal");
    const root = document.getElementById("modal-root");
    const frag = tpl.content.cloneNode(true);
    frag.querySelector(".modal-title").textContent = title;
    frag.querySelector(".modal-body").appendChild(body);
    const footEl = frag.querySelector(".modal-foot");
    (foot || []).forEach((b) => footEl.appendChild(b));
    const backdrop = frag.querySelector(".modal-backdrop");
    const closeBtn = frag.querySelector(".modal-close");
    if (wide) frag.querySelector(".modal").classList.add("modal-wide");
    function handleClose() {
      root.innerHTML = "";
      activeModal = null;
      document.removeEventListener("keydown", onKey);
      if (onClose) onClose();
    }
    function onKey(e) {
      if (e.key === "Escape") handleClose();
    }
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) handleClose();
    });
    closeBtn.addEventListener("click", handleClose);
    document.addEventListener("keydown", onKey);
    root.appendChild(frag);
    activeModal = { backdrop, handleClose };
    const firstInput = backdrop.querySelector("input, select, textarea, button:not(.modal-close)");
    if (firstInput) setTimeout(() => firstInput.focus(), 30);
    return { backdrop, handleClose };
  }

  function closeModal() {
    if (activeModal) activeModal.handleClose();
  }

  // ---------------------------------------------------------------- router
  const app = document.getElementById("app");
  let lastRoute = null;

  function navigate(hash) {
    window.location.hash = hash;
  }

  function router() {
    const hash = window.location.hash || "#/";
    let route;
    let param = null;
    if (hash.startsWith("#/habit/")) {
      route = "habit";
      param = hash.split("/")[2];
    } else if (hash.startsWith("#/identity/")) {
      route = "identity";
      param = hash.split("/")[2];
    } else if (hash.startsWith("#/morning")) {
      route = "morning";
    } else if (hash.startsWith("#/review")) {
      route = "review";
    } else if (hash.startsWith("#/feedback")) {
      route = "feedback";
    } else if (hash.startsWith("#/stats")) {
      route = "stats";
    } else if (hash.startsWith("#/settings")) {
      route = "settings";
    } else {
      route = "dashboard";
    }
    document.querySelectorAll(".nav-link").forEach((a) => {
      a.classList.toggle("active", a.dataset.route === route || ((route === "habit" || route === "identity") && a.dataset.route === "dashboard"));
    });
    lastRoute = { route, param };
    window.scrollTo(0, 0);
    const handlers = {
      dashboard: renderDashboard,
      identity: () => renderIdentity(param),
      habit: () => renderHabit(param),
      morning: renderMorning,
      review: renderReview,
      feedback: renderFeedback,
      stats: renderStats,
      settings: renderSettings,
    };
    Promise.resolve(handlers[route]()).catch((err) => {
      console.error(err);
      renderError(err.message);
    });
  }

  function renderError(message) {
    app.innerHTML = "";
    app.appendChild(el("div", { class: "empty" }, [
      el("div", { class: "big", text: "⚠️" }),
      el("h2", { text: "No se pudo cargar la vista" }),
      el("p", { text: message }),
      el("div", { class: "actions" }, [
        el("button", { class: "btn btn-primary", text: "Volver al inicio", on: { click: () => navigate("#/") } }),
      ]),
    ]));
  }

  // ------------------------------------------------------------ dashboard
  async function renderDashboard() {
    const [state, habits, identities] = await Promise.all([api.state(), api.listHabits(), api.listIdentities()]);
    const parts = [];
    const now = new Date();

    parts.push(el("div", { class: "greeting", text: fmt.greeting() }));
    parts.push(el("div", { class: "subtle", text: "No necesitas más fuerza de voluntad. Diseña un sistema que haga más fácil ser quien quieres ser." }));

    if (habits.length === 0 && identities.length === 0) {
      parts.push(el("div", { class: "onboarding" }, [
        el("h2", { text: "Cada pequeña acción es un voto por la persona que quieres ser" }),
        el("ul", {}, [
          el("li", { text: "Decide quién quieres ser (una identidad)." }),
          el("li", { text: "Convierte esa identidad en acciones pequeñas y repetibles." }),
          el("li", { text: "Diseña tu entorno para que sea más fácil empezar." }),
          el("li", { text: "Una oportunidad perdida no borra tu progreso: ayer no salió, hoy puedes volver." }),
        ]),
        el("div", { class: "actions" }, [
          el("button", { class: "btn btn-primary", text: "Empezar a diseñar mi sistema", on: { click: () => openHabitForm() } }),
          el("button", { class: "btn", text: "Probar con datos de ejemplo", on: { click: loadDemo } }),
        ]),
      ]));
    } else {
      // ---- ¿Quién estás construyendo? ----
      parts.push(el("div", { class: "section-title", text: "¿Quién estás construyendo?" }));
      const grid = el("div", { class: "identity-grid" });
      identities.forEach((idn) => {
        grid.appendChild(el("div", { class: "identity-card", style: `--accent:${idn.color}` }, [
          el("div", { class: "ic-icon", style: `background:${idn.color}1a`, "aria-hidden": "true" }, iconOf(idn)),
          el("div", { class: "ic-main" }, [
            el("div", { class: "ic-name", text: idn.name }),
            el("div", { class: "ic-meta", text: `${idn.votes.this_week} ${idn.votes.this_week === 1 ? "acción" : "acciones"} esta semana` }),
            el("div", { class: "ic-meta", text: `${idn.habit_count} ${idn.habit_count === 1 ? "hábito" : "hábitos"}` }),
          ]),
          el("button", {
            class: "btn btn-sm", text: "Ver identidad",
            on: { click: (e) => { e.stopPropagation(); navigate(`#/identity/${idn.id}`); } },
          }),
        ]));
      });
      grid.appendChild(el("button", {
        class: "identity-card new", text: "+ Nueva identidad",
        on: { click: () => openIdentityForm() },
      }));
      parts.push(grid);

      // ---- Hoy ----
      parts.push(el("div", { class: "section-title", text: "Hoy" }));
      const todayHabits = habits.filter(isHabitDueToday);
      if (habits.length === 0) {
        parts.push(el("div", { class: "card" }, [
          el("p", { class: "muted", text: "Todavía no hay hábitos. Diseña el primero: decide quién quieres ser y qué pequeña acción lo demuestra." }),
          el("div", { class: "actions mt-8" }, [
            el("button", { class: "btn btn-primary", text: "Diseñar un hábito", on: { click: () => openHabitForm() } }),
          ]),
        ]));
      } else if (todayHabits.length === 0) {
        parts.push(el("div", { class: "card" }, [
          el("p", { class: "muted", text: "Hoy no hay hábitos programados. Los hábitos con recordatorio solo aparecen los días marcados en su plan." }),
        ]));
      } else {
        todayHabits.forEach((h) => parts.push(habitRow(h)));
      }

      // ---- Resumen de la semana ----
      const weekTotal = habits.reduce((s, h) => s + (h.goal ? h.goal.this_week : 0), 0);
      const objectivesMet = habits.filter((h) => h.goal && h.goal.achieved).length;
      parts.push(el("div", { class: "section-title", text: "Resumen de esta semana" }));
      parts.push(el("div", { class: "card summary-grid" }, [
        el("div", { class: "summary-item" }, [
          el("div", { class: "num", text: String(weekTotal) }),
          el("div", { class: "lbl", text: "acciones esta semana" }),
        ]),
        el("div", { class: "summary-item" }, [
          el("div", { class: "num", text: `${objectivesMet}/${habits.length}` }),
          el("div", { class: "lbl", text: "objetivos cumplidos" }),
        ]),
        el("div", { class: "summary-item" }, [
          el("div", { class: "num", text: String(habits.reduce((s, h) => s + h.total, 0)) }),
          el("div", { class: "lbl", text: "acciones totales" }),
        ]),
        el("div", { class: "summary-item" }, [
          el("a", { href: "#/review", class: "btn btn-primary btn-sm", text: "Revisión semanal" }),
        ]),
      ]));
    }

    app.innerHTML = "";
    app.appendChild(el("div", {}, parts));
  }

  function identityChip(h) {
    if (!h.identity) return null;
    return el("a", {
      href: `#/identity/${h.identity.id}`,
      class: "identity-chip",
      style: `color:${h.identity.color};border-color:${h.identity.color}33;background:${h.identity.color}14`,
      text: `${h.identity.icon || "⭐"} ${h.identity.name}`,
    });
  }

  function goalLabel(h) {
    const g = h.goal || {};
    if (g.period === "day") return `hoy · ${g.period_count} / ${g.target}`;
    if (g.period === "month") return `este mes · ${g.period_count} / ${g.target}`;
    return `esta semana · ${g.period_count} / ${g.target}`;
  }

  function periodWord(period) {
    if (period === "day") return "hoy";
    if (period === "month") return "este mes";
    return "esta semana";
  }

  function isHabitDueToday(h) {
    const days = h.reminder_days && h.reminder_days.length ? h.reminder_days : null;
    if (!days) return true;
    const iso = new Date().getDay();
    return days.includes(iso === 0 ? 7 : iso);
  }

  function habitRow(h) {
    const g = h.goal || {};
    const progressClass = g.achieved ? "ok" : g.period_count > 0 ? "" : "low";
    const pct = Math.min(100, g.percent || 0);
    const badge = g.achieved
      ? el("span", { class: "badge badge-green", text: "✓ Objetivo alcanzado" })
      : g.period_count > 0
        ? el("span", { class: "badge badge-orange", text: `Faltan ${g.remaining} para el objetivo` })
        : el("span", { class: "badge badge-gray", text: `Sin registros ${periodWord(g.period)}` });

    const row = el("div", { class: "habit-row", tabindex: "0" }, [
      el("div", { class: "habit-icon", style: `background:${h.color}1a`, "aria-hidden": "true" }, iconOf(h)),
      el("div", { class: "habit-main" }, [
        el("div", { class: "habit-name" }, [
          h.name,
          identityChip(h),
          badge,
        ]),
        h.cue ? el("div", { class: "habit-cue", text: `${h.cue} → ${h.name.toLowerCase()}` }) : null,
        el("div", { class: "habit-meta" }, [
          el("span", { class: "habit-count", text: `${g.period_count} / ${g.target} ${periodWord(g.period)}` }),
          el("div", { class: "progress", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": "0", "aria-valuemax": "100" }, [
            el("div", { class: "progress-fill " + progressClass, style: `width:${pct}%;background:${g.achieved ? "var(--green)" : h.color}` }),
          ]),
        ]),
      ]),
      el("button", {
        class: "btn btn-primary btn-sm quick-add",
        text: "Hacerlo",
        "aria-label": `Registrar ${h.name}`,
        on: { click: (e) => { e.stopPropagation(); quickAdd(h, e.currentTarget); } },
      }),
    ]);
    row.addEventListener("click", () => navigate(`#/habit/${h.id}`));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        navigate(`#/habit/${h.id}`);
      }
    });
    return row;
  }

  async function quickAdd(h, btn, opts) {
    try {
      const body = {};
      if (opts && opts.is_minimum) body.is_minimum = true;
      if (opts && opts.occurred_at) body.occurred_at = opts.occurred_at;
      await api.createEvent(h.id, body);
      const identity = h.identity;
      if (identity) {
        toast(`✓ Hecho · +1 voto para ${identity.name}`, "success");
        voteBurst(btn, `+1 voto`);
      } else {
        toast("✓ Hecho · acción registrada", "success");
        voteBurst(btn, "+1");
      }
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function loadDemo() {
    try {
      const res = await api.loadDemo();
      if (res.created === 0) { toast("Ya hay datos de ejemplo.", "error"); return; }
      toast(`Se cargaron ${res.created} hábitos de ejemplo.`);
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  // --------------------------------------------------------- identity page
  async function renderIdentity(id) {
    const d = await api.getIdentity(id);
    const parts = [];

    parts.push(el("div", { class: "detail-head" }, [
      el("a", { href: "#/", class: "btn btn-ghost btn-sm", text: "← Volver" }),
      el("div", { class: "detail-icon", style: `background:${d.color}1a`, "aria-hidden": "true" }, iconOf(d)),
      el("div", { class: "detail-title" }, [
        el("h1", { text: d.name }),
        d.description ? el("div", { class: "subtle", text: d.description }) : null,
        el("div", { class: "subtle", text: "La persona que estás construyendo." }),
      ]),
      el("div", { class: "flex" }, [
        el("button", { class: "btn btn-sm", text: "Editar", on: { click: () => openIdentityForm(d) } }),
        el("button", {
          class: "btn btn-sm btn-danger", text: d.active ? "Archivar" : "Reactivar",
          on: { click: () => toggleIdentityActive(d) },
        }),
        el("button", {
          class: "btn btn-sm btn-danger", text: "Eliminar",
          on: { click: () => deleteIdentity(d) },
        }),
      ]),
    ]));

    const v = d.votes;
    parts.push(el("div", { class: "stat-grid mt-16" }, [
      statCard("Esta semana", String(v.this_week), `${v.this_week === 1 ? "acción" : "acciones"}`),
      statCard("Este mes", String(v.this_month)),
      statCard("Total", String(v.total), `${v.total === 1 ? "acción" : "acciones"} que demuestran esta identidad`),
      statCard("Media semanal", String(v.week_average), `últimas 4 sem: ${v.week_average_last4}`),
    ]));

    const trendText =
      v.trend.direction === "up" ? ["Tu frecuencia está aumentando.", "trend-up"]
        : v.trend.direction === "down" ? ["El ritmo ha bajado un poco. Un periodo bajo no borra la evidencia ya construida.", "trend-down"]
          : ["Tu ritmo se mantiene estable.", "trend-stable"];
    parts.push(el("div", { class: "mt-8 " + trendText[1], text: trendText[0] }));

    parts.push(el("div", { class: "section-title", text: "Hábitos asociados" }));
    if (d.habits.length === 0) {
      parts.push(el("div", { class: "card" }, [
        el("p", { class: "muted", text: "Todavía no hay hábitos vinculados a esta identidad." }),
        el("div", { class: "actions mt-8" }, [
          el("button", { class: "btn btn-primary", text: "Añadir un hábito", on: { click: () => openHabitForm(null, d.id) } }),
        ]),
      ]));
    } else {
      d.habits.forEach((h) => parts.push(habitRow(h)));
    }

    parts.push(el("div", { class: "section-title", text: "Tu trayectoria" }));
    parts.push(el("div", { class: "card chart-card" }, [
      el("div", { class: "chart-title", text: "Acciones por semana (últimas 12)" }),
      el("div", { class: "chart", id: "identity-chart" }),
    ]));

    parts.push(el("div", { class: "section-title", text: "Evidencia" }));
    const evList = el("ul", { class: "insight-list card" });
    d.evidence.forEach((text) => {
      evList.appendChild(el("li", {}, [
        el("span", { class: "insight-bullet", text: "·" }),
        el("span", { text }),
      ]));
    });
    parts.push(evList);

    app.innerHTML = "";
    app.appendChild(el("div", {}, parts));
    charts.barChart(document.getElementById("identity-chart"),
      d.votes.trajectory.map((b) => ({ label: b.label, count: b.count })), {
        barColor: "#9dbfff", accentColor: d.color, ariaLabel: "Acciones semanales de la identidad",
      });
  }

  function openIdentityForm(identity) {
    const editing = Boolean(identity);
    const modal = openModal({
      title: editing ? "Editar identidad" : "Nueva identidad",
      body: el("div", {}, [
        field("¿Quién quieres llegar a ser?", [
          el("input", {
            type: "text", id: "i-name", value: identity ? identity.name : "",
            placeholder: "ej. Lector, Persona activa, Persona tranquila…", maxlength: "80", autocomplete: "off",
          }),
        ], "Una frase corta que represente a la persona que quieres construir."),
        el("div", { class: "form-row" }, [
          field("Icono", iconPicker(identity && identity.icon)),
          field("Color", colorPicker(identity && identity.color)),
        ]),
        field("Descripción (opcional)", [
          el("input", {
            type: "text", id: "i-desc", value: identity ? identity.description || "" : "",
            placeholder: "ej. Una persona que disfruta aprendiendo y leyendo.", maxlength: "200",
          }),
        ]),
      ]),
      foot: [],
    });
    const body = modal.backdrop.querySelector(".modal-body");
    const foot = modal.backdrop.querySelector(".modal-foot");
    foot.appendChild(el("button", { class: "btn", text: "Cancelar", on: { click: () => closeModal(modal) } }));
    foot.appendChild(el("button", {
      class: "btn btn-primary", text: editing ? "Guardar" : "Crear identidad",
      on: { click: () => submitIdentity(modal, identity, body) },
    }));
  }

  async function submitIdentity(modal, identity, body) {
    const name = body.querySelector("#i-name").value.trim();
    if (!name) { toast("Escribe un nombre para la identidad.", "error"); return; }
    const selColor = body.querySelector("#color-picker .selected");
    const selIcon = body.querySelector("#icon-picker .selected");
    const payload = {
      name,
      description: body.querySelector("#i-desc").value.trim(),
      icon: selIcon ? selIcon.dataset.icon : "star",
      color: selColor ? selColor.dataset.color : COLORS[0],
    };
    try {
      if (identity) {
        await api.updateIdentity(identity.id, payload);
        toast("Identidad actualizada.");
      } else {
        await api.createIdentity(payload);
        toast(`Identidad creada. Cada acción será un voto por «${name}».`);
      }
      closeModal(modal);
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function toggleIdentityActive(identity) {
    try {
      await api.updateIdentity(identity.id, { active: !identity.active });
      toast(identity.active ? "Identidad archivada." : "Identidad reactivada.");
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function deleteIdentity(identity) {
    const ok = await confirmDialog(
      "Eliminar identidad",
      `Se eliminará «${identity.name}». Sus hábitos se conservarán sin identidad.`,
      "Eliminar", true
    );
    if (!ok) return;
    try {
      await api.deleteIdentity(identity.id);
      toast("Identidad eliminada.");
      navigate("#/");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  // ----------------------------------------------------------- habit detail
  async function renderHabit(id) {
    const h = await api.getHabit(id);
    const g = h.goal || {};
    const parts = [];

    const pct = Math.min(100, g.percent || 0);
    const achieved = g.achieved;
    const status = achieved
      ? el("span", { class: "badge badge-green", text: "✓ Objetivo alcanzado" })
      : g.period_count > 0
        ? el("span", { class: "badge badge-orange", text: `Faltan ${g.remaining} para el objetivo` })
        : el("span", { class: "badge badge-gray", text: "Sin registros este periodo" });

    parts.push(el("div", { class: "detail-head" }, [
      el("a", { href: "#/", class: "btn btn-ghost btn-sm", text: "← Volver" }),
      el("div", { class: "detail-icon", style: `background:${h.color}1a`, "aria-hidden": "true" }, iconOf(h)),
      el("div", { class: "detail-title" }, [
        el("h1", {}, [h.name, identityChip(h)]),
        h.cue ? el("div", { class: "subtle", text: `${h.cue} → ${h.name.toLowerCase()}` }) : null,
      ]),
      el("div", { class: "flex" }, [
        el("button", { class: "btn btn-sm", text: "Rediseñar", on: { click: () => openHabitForm(h) } }),
        el("button", {
          class: "btn btn-sm btn-danger",
          text: h.active ? "Eliminar" : "Reactivar",
          on: { click: () => (h.active ? deleteHabit(h) : toggleActive(h)) },
        }),
      ]),
    ]));

    parts.push(el("div", { class: "hero" }, [
      el("div", { class: "hero-big", text: `${g.period_count} / ${g.target}` }),
      el("div", { class: "hero-sub", text: `${periodWord(g.period)} · objetivo: ${goalDescription(h)}` }),
      el("div", { class: "hero-bar" }, [
        el("div", { class: "progress-fill " + (achieved ? "ok" : ""), style: `width:${pct}%;background:${achieved ? "var(--green)" : h.color}` }),
      ]),
      el("div", { class: "hero-actions" }, [
        el("button", { class: "btn btn-primary", text: "Hacerlo", on: { click: (e) => quickAdd(h, e.currentTarget) } }),
        h.minimum_description || h.minimum_value != null
          ? el("button", {
            class: "btn", text: "Versión mínima",
            title: h.minimum_description || "Versión mínima",
            on: { click: (e) => quickAdd(h, e.currentTarget, { is_minimum: true }) },
          })
          : null,
        el("button", { class: "btn", text: "Añadir registro", on: { click: () => openEventForm(h) } }),
      ]),
      el("div", { class: "flex mt-8" }, [
        status,
        el("span", { class: "small muted", text: `Semana anterior: ${g.prev_week}` }),
        el("span", { class: "small muted", text: `Total: ${h.stats.total}` }),
        h.streak > 0 ? el("span", { class: "badge badge-blue", text: `${h.streak} ${h.streak === 1 ? "semana" : "semanas"} cumpliendo el objetivo` }) : null,
      ]),
    ]));

    // Friction: the system, not the person.
    if (h.friction && h.friction.difficult) {
      parts.push(el("div", { class: "friction-card" }, [
        el("h3", { text: "Este hábito parece estar siendo difícil." }),
        el("p", { class: "muted", text: "Ayer no salió, hoy tienes otra oportunidad. Si se repite, no se trata de tu fuerza de voluntad: el sistema necesita un ajuste." }),
        el("div", { class: "small muted", text: "¿Qué está haciendo difícil realizarlo?" }),
        el("div", { class: "chip-row mt-8" }, OBSTACLE_OPTIONS.map((opt) =>
          el("button", {
            type: "button", class: "chip", text: opt.label,
            on: { click: () => submitObstacle(h, opt) },
          })
        )),
        el("div", { class: "actions mt-8" }, [
          el("button", { class: "btn btn-primary btn-sm", text: "Rediseñar este hábito", on: { click: () => openHabitForm(h) } }),
        ]),
      ]));
    }

    // Pattern from saved obstacles: only shown once there is enough evidence.
    if (h.main_obstacle) {
      parts.push(el("div", { class: "main-obstacle" }, [
        el("span", { class: "main-obstacle-icon", text: "🔎", "aria-hidden": "true" }),
        el("span", {}, [
          `El obstáculo más frecuente de este hábito es «${h.main_obstacle.obstacle}» `,
          `(${h.main_obstacle.count} ${h.main_obstacle.count === 1 ? "vez" : "veces"}). `,
          "Rediseñar el sistema puede ayudar más que insistir.",
        ]),
      ]));
    }

    if (h.suggestion) {
      parts.push(el("div", { class: "suggestion" }, [
        el("div", { class: "s-msg", text: h.suggestion.message }),
        el("div", { class: "s-actions" }, [
          el("button", {
            class: "btn btn-primary btn-sm",
            text: "Aceptar cambio",
            on: { click: () => applySuggestion(h, h.suggestion) },
          }),
          el("button", { class: "btn btn-sm", text: "Ahora no", on: { click: (e) => { e.target.closest(".suggestion").remove(); } } }),
        ]),
      ]));
    }

    // Semantic identity suggestion: understood by CONCEPT, user decides.
    if (h.identity_links && h.identity_links.length) {
      parts.push(el("div", { class: "linked-identities" }, [
        el("span", { class: "small muted", text: "También relacionado con:" }),
        ...h.identity_links.map((l) => el("a", {
          href: `#/identity/${l.identity.id}`,
          class: "identity-chip",
          style: `color:${l.identity.color};border-color:${l.identity.color}33;background:${l.identity.color}14`,
          text: `${l.identity.icon || "⭐"} ${l.identity.name}`,
        })),
      ]));
    }

    if (h.semantic_suggestion) {
      const s = h.semantic_suggestion;
      const matches = (s.matches || []).slice(0, 3).join(", ");
      parts.push(el("div", { class: "identity-suggest" }, [
        el("div", { class: "is-main" }, [
          el("span", { class: "is-icon", style: `background:${s.color}1a` }, s.icon || "⭐"),
          el("div", {}, [
            el("div", { class: "is-title", text: `💡 Este hábito parece estar relacionado con «${s.name}»` }),
            el("div", { class: "is-meta muted", text: `Confianza ${confidenceWord(s.level)}${matches ? ` · por «${matches}»` : ""}. Tú decides.` }),
          ]),
        ]),
        el("div", { class: "is-actions" }, [
          el("button", { class: "btn btn-primary btn-sm", text: "Asociar", on: { click: () => acceptIdentityLink(h, s) } }),
          el("button", { class: "btn btn-sm", text: "No asociar", on: { click: () => rejectIdentityLink(h, s) } }),
        ]),
      ]));
    }

    // Stats
    const st = h.stats;
    const trendText =
      st.trend.direction === "up" ? ["Tu frecuencia está aumentando.", "trend-up"]
        : st.trend.direction === "down" ? ["Tu frecuencia ha bajado algo. Un periodo bajo no borra tu progreso.", "trend-down"]
          : ["Tu frecuencia se mantiene estable.", "trend-stable"];
    parts.push(el("div", { class: "section-title", text: "Progreso" }));
    parts.push(el("div", { class: "stat-grid" }, [
      statCard("Total", String(st.total), `${st.active_days} días activos`),
      statCard("Esta semana", String(st.this_week), `semana anterior: ${st.prev_week}`),
      statCard("Este mes", String(st.this_month), `mes anterior: ${st.prev_month}`),
      statCard("Este año", String(st.this_year)),
      statCard("Media semanal", String(st.week_average), `últimas 4 sem: ${st.week_average_last4}`),
      statCard("Media mensual", String(st.month_average)),
      statCard("Mejor semana", String(st.best_week)),
      statCard("Desde el inicio", `${st.weeks_since_start} semanas`),
    ]));
    parts.push(el("div", { class: "mt-8 " + trendText[1], text: trendText[0] }));

    // System design
    const systemRows = [
      h.cue ? ["Señal", h.cue] : null,
      h.location ? ["Lugar", h.location] : null,
      h.environment ? ["Entorno", h.environment] : null,
      h.minimum_description ? ["Versión mínima", h.minimum_description] : null,
      h.attraction_strategy ? ["Atractivo", h.attraction_strategy] : null,
      h.friction_strategy ? ["Hazlo fácil", h.friction_strategy] : null,
      h.reward_strategy ? ["Satisfactorio", h.reward_strategy] : null,
    ].filter(Boolean);
    if (systemRows.length > 0) {
      const list = el("ul", { class: "system-list card" });
      systemRows.forEach(([label, value]) => {
        list.appendChild(el("li", {}, [
          el("b", { text: label }),
          el("span", { text: value }),
        ]));
      });
      parts.push(el("div", { class: "section-title", text: "Tu sistema" }));
      parts.push(list);
    }

    // Charts
    parts.push(el("div", { class: "section-title", text: "Actividad" }));
    const weeklyCard = el("div", { class: "card chart-card" }, [
      el("div", { class: "chart-title", text: "Realizaciones por semana (últimas 12)" }),
      el("div", { class: "chart", id: "chart-weekly" }),
    ]);
    parts.push(weeklyCard);
    const dailyCard = el("div", { class: "card chart-card" }, [
      el("div", { class: "chart-title", text: "Actividad diaria · últimos 30 días" }),
      el("div", { class: "chart", id: "chart-daily" }),
    ]);
    parts.push(dailyCard);

    if (h.insights && h.insights.length > 0) {
      parts.push(el("div", { class: "section-title", text: "Insights" }));
      const list = el("ul", { class: "insight-list card" });
      h.insights.forEach((text) => {
        list.appendChild(el("li", {}, [
          el("span", { class: "insight-bullet", text: "·" }),
          el("span", { text }),
        ]));
      });
      parts.push(list);
    }

    parts.push(el("div", { class: "section-title", text: "Historial de registros" }));
    const histCard = el("div", { class: "card" });
    if (h.events.length === 0) {
      histCard.appendChild(el("p", { class: "empty-line", text: "Todavía no hay registros." }));
    } else {
      const today = new Date();
      h.events.slice(0, 100).forEach((ev) => {
        histCard.appendChild(eventItem(h, ev, today));
      });
      if (h.events.length > 100) {
        histCard.appendChild(el("p", { class: "small muted", text: `Mostrando los 100 registros más recientes de ${h.events.length}.` }));
      }
    }
    parts.push(histCard);

    app.innerHTML = "";
    app.appendChild(el("div", {}, parts));

    charts.barChart(document.getElementById("chart-weekly"), h.charts.weekly.map((b) => ({ label: b.label, count: b.count })), {
      barColor: "#9dbfff", accentColor: h.color, average: st.week_average, averageColor: "#f59e0b",
      ariaLabel: "Realizaciones semanales",
    });
    charts.barChart(document.getElementById("chart-daily"), h.charts.daily.map((b) => ({ label: b.label, count: b.count })), {
      barColor: "#c9d6f8", accentColor: h.color,
      ariaLabel: "Actividad diaria de los últimos 30 días",
    });
  }

  // ------------------------------------------------------- obstacle redesign
  async function submitObstacle(h, opt) {
    if (opt.id === "other") {
      openRedesignModal(h, opt, null);
      return;
    }
    let saved;
    try {
      saved = await api.createObstacle(h.id, { obstacle: opt.label, type: opt.id });
    } catch (err) {
      toast(err.message, "error");
      return;
    }
    openRedesignModal(h, opt, saved.suggestion);
  }

  function confidenceWord(level) {
    if (level === "alta") return "alta";
    if (level === "media") return "media";
    if (level === "baja") return "baja";
    return "—";
  }

  async function acceptIdentityLink(h, s) {
    try {
      await api.setIdentityLink(h.id, { identity_id: s.identity_id, decision: "accept", confidence: s.confidence });
      toast(`Asociado con «${s.name}». Se usará como evidencia futura.`, "success");
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function rejectIdentityLink(h, s) {
    try {
      await api.setIdentityLink(h.id, { identity_id: s.identity_id, decision: "reject" });
      toast("Vale, lo recordaré y no volveré a sugerirlo.", "success");
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function redesignPreview(s) {
    if (!s) return null;
    const lines = [];
    if (s.current) lines.push(el("div", { class: "redesign-line", text: s.current }));
    if (s.proposed) lines.push(el("div", { class: "redesign-line proposed", text: s.proposed }));
    if (s.minimum) lines.push(el("div", { class: "redesign-line minimum", text: s.minimum }));
    if (lines.length === 0) return null;
    return el("div", { class: "redesign-preview" }, lines);
  }

  function redesignFields(s) {
    if (!s || !s.fields || s.fields.length === 0) return null;
    const wrap = el("div", { class: "mt-16" });
    s.fields.forEach((f) => {
      const input = el("input", {
        id: "rd-" + f.key, value: f.value,
        type: f.kind === "number" ? "number" : "text",
        min: f.kind === "number" ? "0" : undefined,
        maxlength: f.kind === "text" ? "200" : undefined,
      });
      wrap.appendChild(field(f.label, [input]));
    });
    return wrap;
  }

  function openRedesignModal(h, opt, suggestion) {
    const s = suggestion || {};
    const isOther = opt.id === "other";
    const modal = openModal({
      title: isOther ? "Cuéntanos más" : "Rediseñar el sistema",
      body: el("div", {}, [
        el("div", { class: "redesign-message", text: s.message || (isOther ? "¿Quieres rediseñar el hábito?" : "Vamos a ajustar el sistema.") }),
        redesignPreview(s),
        redesignFields(s),
        isOther ? el("div", { class: "mt-16" }, [
          field("¿Qué está pasando?", [
            el("textarea", { id: "rd-note", placeholder: "ej. Tengo la cena muy tarde y no me apetece hacer nada después", maxlength: "300" }),
          ]),
        ]) : null,
        el("p", { class: "hint mt-8", text: isOther ? "Guardaremos tu explicación para detectar patrones." : "Nada se cambia sin tu aprobación." }),
      ]),
      foot: [],
    });
    const body = modal.backdrop.querySelector(".modal-body");
    const foot = modal.backdrop.querySelector(".modal-foot");

    const keepBtn = el("button", {
      class: "btn",
      text: isOther ? "Ahora no" : "Mantener como está",
    });
    keepBtn.addEventListener("click", async () => {
      if (isOther) {
        const note = body.querySelector("#rd-note").value.trim();
        if (note) {
          try { await api.createObstacle(h.id, { obstacle: opt.label, type: opt.id, note }); }
          catch (_) { /* the obstacle is secondary here */ }
        }
        toast("Entendido. Puedes rediseñarlo cuando quieras.", "success");
      } else {
        toast("Nada ha cambiado. El hábito sigue como estaba.", "success");
      }
      closeModal(modal);
      refresh();
    });

    const redesignBtn = isOther ? null : el("button", {
      class: "btn btn-ghost",
      text: "Rediseñar hábito",
      title: "Abrir el asistente y modificar el sistema a tu manera",
    });
    if (redesignBtn) {
      redesignBtn.addEventListener("click", () => {
        closeModal(modal);
        openHabitForm(h);
      });
    }

    const applyBtn = el("button", {
      class: "btn btn-primary",
      text: isOther ? "Rediseñar hábito" : "Aplicar cambio",
    });
    applyBtn.addEventListener("click", async () => {
      if (isOther) {
        const note = body.querySelector("#rd-note").value.trim();
        try {
          await api.createObstacle(h.id, { obstacle: opt.label, type: opt.id, note });
          closeModal(modal);
          openHabitForm(h);
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }
      const payload = { ...(s.apply || {}) };
      (s.fields || []).forEach((f) => {
        const input = body.querySelector("#rd-" + f.key);
        if (!input) return;
        const v = input.value;
        payload[f.key] = f.kind === "number" && v !== "" ? Number(v) : v.trim();
      });
      applyBtn.disabled = true;
      try {
        await api.updateHabit(h.id, payload);
        toast("Sistema actualizado. Pruébalo esta semana.", "success");
        closeModal(modal);
        refresh();
      } catch (err) {
        applyBtn.disabled = false;
        toast(err.message, "error");
      }
    });

    foot.appendChild(keepBtn);
    if (redesignBtn) foot.appendChild(redesignBtn);
    foot.appendChild(applyBtn);
  }

  function statCard(label, value, sub) {
    return el("div", { class: "stat-card" }, [
      el("div", { class: "lbl", text: label }),
      el("div", { class: "val", text: value }),
      sub ? el("div", { class: "sub", text: sub }) : null,
    ]);
  }

  function goalDescription(h) {
    const g = h.goal || {};
    const t = h.frequency_target || 0;
    const types = {
      day: `${t} ${t === 1 ? "vez" : "veces"} al día`,
      week: `${t} ${t === 1 ? "vez" : "veces"} por semana`,
      month: `${t} ${t === 1 ? "vez" : "veces"} por mes`,
    };
    let freq = types[g.period] || "";
    if (h.frequency_type === "specific_days") freq = "en los días marcados";
    const target = h.target_value != null
      ? `${h.target_value} ${h.target_unit || h.unit || ""}`.trim()
      : null;
    return [freq, target].filter(Boolean).join(" · ");
  }

  function eventItem(h, ev, today) {
    const dt = fmt.parseLocal(ev.occurred_at);
    const when = el("div", { class: "event-when" }, [
      el("div", { class: "d", text: fmt.relativeDay(dt, today) }),
      el("div", { class: "t", text: fmt.timeHM(dt) }),
    ]);
    const what = el("div", { class: "event-what" }, [
      el("div", { text: valueText(h, ev) }),
      ev.is_minimum ? el("div", { class: "event-notes", text: "Versión mínima" }) : null,
      ev.notes ? el("div", { class: "event-notes", text: ev.notes }) : null,
    ]);
    const actions = el("div", { class: "event-actions" }, [
      el("button", {
        class: "icon-btn", text: "✎", "aria-label": "Editar registro",
        on: { click: () => openEventForm(h, ev) },
      }),
      el("button", {
        class: "icon-btn", text: "✕", "aria-label": "Eliminar registro",
        on: { click: () => deleteEvent(h, ev) },
      }),
    ]);
    return el("div", { class: "event-item" }, [when, what, actions]);
  }

  function valueText(h, ev) {
    const t = h.type;
    if (t === "boolean") return "Realizado";
    if (t === "sessions") {
      const dur = ev.duration ? fmt.formatDuration(ev.duration) : "";
      return `1 sesión${dur ? " · " + dur : ""}`;
    }
    if (t === "duration") return fmt.formatDuration(ev.value || 0);
    if (ev.unit) return `${ev.value} ${ev.unit}`;
    return `${ev.value}`;
  }

  async function toggleActive(h) {
    try {
      await api.updateHabit(h.id, { active: !h.active });
      toast(h.active ? `${h.name} archivado.` : `${h.name} reactivado.`);
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function deleteHabit(h) {
    const ok = await confirmDialog(
      "Eliminar hábito",
      `Se eliminará «${h.name}» con todos sus registros, obstáculos y vínculos. Esta acción no se puede deshacer.`,
      "Eliminar", true
    );
    if (!ok) return;
    try {
      await api.deleteHabit(h.id);
      toast("Hábito eliminado.");
      navigate("#/");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function applySuggestion(h, suggestion) {
    try {
      await api.updateHabit(h.id, { frequency_target: suggestion.suggested_target });
      toast("Objetivo actualizado.");
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function deleteEvent(h, ev) {
    const ok = await confirmDialog(
      "Eliminar registro",
      "¿Seguro que quieres eliminar este registro?",
      "Eliminar", true
    );
    if (!ok) return;
    try {
      await api.deleteEvent(ev.id);
      toast("Registro eliminado.");
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  // -------------------------------------------------------------- weekly review
  let reviewCountdownTimer = null;

  function renderReviewCountdown(sched, data) {
    const parts = [];
    parts.push(el("h1", { class: "greeting", text: "Revisión semanal" }));
    parts.push(el("div", { class: "subtle", text: `Tu revisión se abre el domingo a las ${sched.time}. Antes, solo se muestra la cuenta atrás.` }));

    const cells = ["días", "horas", "minutos", "segundos"].map((label) =>
      el("div", { class: "cd-cell" }, [
        el("div", { class: "cd-num", text: "00" }),
        el("div", { class: "cd-label", text: label }),
      ]));
    parts.push(el("div", { class: "countdown" }, [
      el("div", { class: "countdown-nums" }, cells),
      el("div", { class: "muted small", text: `Queda poco para tu revisión del domingo.` }),
    ]));

    app.innerHTML = "";
    app.appendChild(el("div", {}, parts));

    const nums = cells.map((c) => c.querySelector(".cd-num"));
    const target = fmt.parseLocal(sched.next_at);

    function tick() {
      const ms = target - Date.now();
      if (ms <= 0) {
        clearInterval(reviewCountdownTimer);
        renderReview();
        return;
      }
      const s = Math.floor(ms / 1000);
      const vals = [
        Math.floor(s / 86400),
        Math.floor((s % 86400) / 3600),
        Math.floor((s % 3600) / 60),
        s % 60,
      ].map((v) => String(v).padStart(2, "0"));
      nums.forEach((n, i) => { n.textContent = vals[i]; });
    }
    tick();
    reviewCountdownTimer = setInterval(tick, 1000);
  }

  async function renderReview() {
    clearInterval(reviewCountdownTimer);
    const data = await api.weeklyReview();
    const sched = data.schedule || {};

    if (sched.enabled && !sched.open) {
      renderReviewCountdown(sched, data);
      return;
    }

    const parts = [];
    parts.push(el("h1", { class: "greeting", text: "Revisión semanal" }));
    parts.push(el("div", { class: "subtle", text: "Si el sistema falla repetidamente, revisa el sistema antes de culpar a la persona." }));

    parts.push(el("div", { class: "card summary-grid mt-16" }, [
      el("div", { class: "summary-item" }, [
        el("div", { class: "num", text: String(data.total_actions) }),
        el("div", { class: "lbl", text: "acciones esta semana" }),
      ]),
      el("div", { class: "summary-item" }, [
        el("div", { class: "num", text: String(data.working.length) }),
        el("div", { class: "lbl", text: "hábitos consistentes" }),
      ]),
      el("div", { class: "summary-item" }, [
        el("div", { class: "num", text: String(data.difficult.length) }),
        el("div", { class: "lbl", text: "hábitos que están costando" }),
      ]),
    ]));

    parts.push(el("div", { class: "section-title", text: "Lo que funcionó" }));
    parts.push(el("div", { class: "card" }, data.working.length === 0
      ? el("p", { class: "empty-line", text: "Todavía no hay hábitos consistentes esta semana. Empieza con una acción pequeña." })
      : el("div", {}, data.working.map((h) => reviewHabitItem(h, true)))));

    parts.push(el("div", { class: "section-title", text: "Lo que fue difícil" }));
    parts.push(el("div", { class: "card" }, data.difficult.length === 0
      ? el("p", { class: "empty-line", text: "Ningún hábito parece estar bloqueado. Buen sistema." })
      : el("div", {}, data.difficult.map((h) => reviewHabitItem(h, false)))));

    parts.push(el("div", { class: "section-title", text: "Identidades reforzadas" }));
    parts.push(el("div", { class: "card" }, data.identities.length === 0
      ? el("p", { class: "empty-line", text: "Registra acciones vinculadas a una identidad para verlas aquí." })
      : el("div", {}, data.identities.map((idn) =>
        el("div", { class: "review-identity" }, [
          el("span", { text: iconOf(idn) }),
          el("b", { text: idn.name }),
          el("span", { class: "muted", text: `${idn.this_week} ${idn.this_week === 1 ? "acción" : "acciones"} esta semana` }),
        ])
      ))));

    parts.push(el("div", { class: "section-title", text: "Patrones" }));
    parts.push(el("ul", { class: "insight-list card" }, data.patterns.length === 0
      ? el("li", { text: "Con más registros podré mostrarte patrones sobre tu sistema." })
      : data.patterns.map((p) => el("li", {}, [
        el("span", { class: "insight-bullet", text: "·" }),
        el("span", { text: p }),
      ]))));

    parts.push(el("div", { class: "section-title", text: "Una pregunta" }));
    const qCard = el("div", { class: "card" }, [
      el("p", { class: "muted", text: "¿Qué podrías cambiar esta semana para hacerlo más fácil?" }),
      el("textarea", { id: "q-answer", placeholder: "ej. Preparar el libro antes de cenar", maxlength: "300" }),
      el("div", { class: "actions mt-8" }, [
        el("button", { class: "btn btn-primary btn-sm", text: "Guardar respuesta", on: { click: () => saveReviewAnswer(data) } }),
      ]),
    ]);
    parts.push(qCard);

    app.innerHTML = "";
    app.appendChild(el("div", {}, parts));
    const q = document.getElementById("q-answer");
    if (q && data.question_answer) q.value = data.question_answer;
  }

  function reviewHabitItem(h, ok) {
    const g = h.goal || {};
    return el("div", { class: "review-habit" }, [
      el("span", { class: "rr-icon", style: `background:${h.color}1a` }, iconOf(h)),
      el("span", { class: "rr-name", text: h.name }),
      ok
        ? el("span", { class: "badge badge-green", text: `${g.this_week} acciones` })
        : el("span", { class: "badge badge-orange", text: `${g.this_week}/${g.target} ${periodWord(g.period)}` }),
      el("button", {
        class: "btn btn-sm btn-ghost", text: "Abrir",
        on: { click: () => navigate(`#/habit/${h.id}`) },
      }),
    ]);
  }

  async function saveReviewAnswer(data) {
    const q = document.getElementById("q-answer");
    if (!q) return;
    try {
      await api.saveReviewAnswer({ answer: q.value });
      toast("Respuesta guardada.");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  // -------------------------------------------------------------- global stats
  async function renderStats() {
    const data = await api.globalStats();
    const parts = [];

    parts.push(el("h1", { class: "greeting", text: "Estadísticas" }));
    parts.push(el("div", { class: "subtle", text: "Acciones, días activos, cumplimiento y consistencia. La identidad se muestra como evidencia, nunca como puntuación." }));

    if (data.total_habits === 0) {
      parts.push(el("div", { class: "empty mt-16" }, [
        el("div", { class: "big", text: "📊" }),
        el("h2", { text: "Todavía no hay datos" }),
        el("p", { text: "Diseña un hábito o carga los datos de ejemplo para ver tus estadísticas." }),
        el("div", { class: "actions" }, [
          el("button", { class: "btn btn-primary", text: "Diseñar un hábito", on: { click: () => openHabitForm() } }),
          el("button", { class: "btn", text: "Cargar datos de ejemplo", on: { click: loadDemo } }),
        ]),
      ]));
      app.innerHTML = "";
      app.appendChild(el("div", {}, parts));
      return;
    }

    parts.push(el("div", { class: "stat-grid mt-16" }, [
      statCard("Hábitos activos", String(data.active_habits), `${data.total_habits} en total`),
      statCard("Esta semana", String(data.week_realizations)),
      statCard("Este mes", String(data.month_realizations)),
      statCard("Total", String(data.total_realizations)),
      statCard("Objetivos cumplidos", `${data.objectives_met}/${data.total_habits}`),
      statCard("Tendencia positiva", String(data.positive_trend)),
      statCard("Tendencia negativa", String(data.negative_trend)),
    ]));

    if (data.identities && data.identities.length > 0) {
      parts.push(el("div", { class: "section-title", text: "Identidades reforzadas" }));
      const grid = el("div", { class: "identity-grid" });
      data.identities.forEach((idn) => {
        grid.appendChild(el("div", { class: "identity-card", style: `--accent:${idn.color}` }, [
          el("div", { class: "ic-icon", style: `background:${idn.color}1a`, "aria-hidden": "true" }, iconOf(idn)),
          el("div", { class: "ic-main" }, [
            el("div", { class: "ic-name", text: idn.name }),
            el("div", { class: "ic-meta", text: `${idn.this_week} ${idn.this_week === 1 ? "voto" : "votos"} esta semana` }),
          ]),
          el("button", {
            class: "btn btn-sm", text: "Ver",
            on: { click: () => navigate(`#/identity/${idn.id}`) },
          }),
        ]));
      });
      parts.push(grid);
    }

    parts.push(el("div", { class: "card chart-card" }, [
      el("div", { class: "chart-title", text: "Realizaciones semanales (todos los hábitos)" }),
      el("div", { class: "chart", id: "gchart-weekly" }),
    ]));

    parts.push(el("div", { class: "section-title", text: "Por hábito" }));
    data.by_habit.forEach((h) => parts.push(habitRow(h)));

    app.innerHTML = "";
    app.appendChild(el("div", {}, parts));
    charts.barChart(document.getElementById("gchart-weekly"), data.weekly_chart, {
      barColor: "#9dbfff", accentColor: "#4f7cff", ariaLabel: "Realizaciones semanales globales",
    });
  }

  // ------------------------------------------------------------- "Mañana"
  let morningDate = null;
  let morningSaveTimer = null;
  let morningLoading = false;

  function addDays(d, n) {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  }

  function morningTitle(d) {
    const rel = fmt.relativeDay(d, new Date());
    const long = fmt.longDate(d);
    return rel === "Hoy" || rel === "Mañana" ? `${rel} · ${long}` : long;
  }

  function morningPlaceholder(d) {
    const rel = fmt.relativeDay(d, new Date());
    if (rel === "Mañana") {
      return "¿Qué quieres hacer mañana?\n\nEscribe libremente. Por ejemplo:\n\n07:30 levantarme\n08:00 desayunar\n09:00 trabajar\n\n17:30 correr 20 min\n\n19:00 comprar leche y pasar por la farmacia\n\n21:30 leer 10 min";
    }
    if (rel === "Hoy") return "Escribe libremente cómo quieres afrontar el resto del día…";
    return "Escribe libremente qué quieres hacer ese día…";
  }

  async function renderMorning() {
    const target = morningDate || fmt.toISODate(addDays(new Date(), 1));
    const data = await api.getNote(target);
    morningDate = data.date;
    morningLoading = false;

    const parts = [];
    parts.push(el("h1", { class: "greeting", text: "🌙 Mañana" }));
    parts.push(el("div", { class: "subtle", text: "Prepara tu día de mañana." }));

    const dateNav = el("div", { class: "morning-nav" }, [
      el("button", { class: "btn btn-sm", text: "‹", "aria-label": "Día anterior",
        on: { click: () => gotoMorning(addDays(parseMorning(morningDate), -1)) } }),
      el("div", { class: "morning-date", text: morningTitle(parseMorning(morningDate)) }),
      el("button", { class: "btn btn-sm", text: "›", "aria-label": "Día siguiente",
        on: { click: () => gotoMorning(addDays(parseMorning(morningDate), 1)) } }),
      el("button", { class: "btn btn-sm", text: "Hoy", on: { click: () => gotoMorning(new Date()) } }),
      el("button", { class: "btn btn-sm", text: "Mañana", on: { click: () => gotoMorning(addDays(new Date(), 1)) } }),
    ]);
    parts.push(dateNav);

    const statusEl = el("div", { class: "morning-status muted",
      text: data.saved_at ? "Guardado" : "En blanco" });
    const ta = el("textarea", {
      class: "morning-note",
      placeholder: morningPlaceholder(parseMorning(morningDate)),
      rows: "18", spellcheck: "true",
    });
    ta.value = data.content;
    ta.addEventListener("input", () => scheduleMorningSave(ta, statusEl));

    const detectionsEl = el("div", { class: "morning-detections" });
    renderMorningDetections(data.detections, detectionsEl, ta);

    parts.push(el("div", { class: "card morning-card" }, [ta]));
    parts.push(el("div", { class: "morning-foot" }, [statusEl]));
    parts.push(detectionsEl);

    app.innerHTML = "";
    app.appendChild(el("div", { class: "morning", style: "max-width:760px;margin:0 auto" }, parts));
    ta.focus();
  }

  function parseMorning(dateStr) {
    return fmt.parseLocal(dateStr);
  }

  function scheduleMorningSave(ta, statusEl) {
    clearTimeout(morningSaveTimer);
    statusEl.textContent = "Guardando…";
    morningSaveTimer = setTimeout(async () => {
      try {
        const res = await api.saveNote(morningDate, { content: ta.value });
        statusEl.textContent = "Guardado ✓";
        const det = document.querySelector(".morning-detections");
        if (det) renderMorningDetections(res.detections, det, ta);
      } catch (err) {
        statusEl.textContent = "No se pudo guardar";
        toast(err.message, "error");
      }
    }, 600);
  }

  function gotoMorning(date) {
    if (morningLoading) return;
    const ds = fmt.toISODate(date);
    if (ds === morningDate) return;
    morningLoading = true;
    api.getNote(ds).then((data) => {
      morningDate = data.date;
      const ta = document.querySelector(".morning-note");
      if (ta) {
        ta.value = data.content;
        ta.placeholder = morningPlaceholder(parseMorning(ds));
      }
      const nav = document.querySelector(".morning-date");
      if (nav) nav.textContent = morningTitle(parseMorning(ds));
      const status = document.querySelector(".morning-status");
      if (status) status.textContent = data.saved_at ? "Guardado" : "En blanco";
      const det = document.querySelector(".morning-detections");
      if (det) renderMorningDetections(data.detections, det, document.querySelector(".morning-note"));
      morningLoading = false;
    }).catch((err) => {
      morningLoading = false;
      toast(err.message, "error");
    });
  }

  function renderMorningDetections(detections, container, ta) {
    container.innerHTML = "";
    if (!detections || detections.length === 0) return;
    detections.forEach((d) => {
      if (d.type === "identity") {
        container.appendChild(el("div", { class: "note-det note-det-identity" }, [
          el("span", { class: "nd-icon" }, d.icon || "⭐"),
          el("span", { class: "nd-text", text: `Parece que piensas en «${d.name}».` }),
          el("a", { class: "btn btn-sm", href: `#/identity/${d.identity_id}`, text: "Ver identidad" }),
        ]));
        return;
      }
      const idChip = d.identity
        ? el("span", { class: "identity-chip", style: `color:${d.identity.color};border-color:${d.identity.color}33;background:${d.identity.color}14`, text: `${d.identity.icon || "⭐"} ${d.identity.name}` })
        : null;
      const minHint = d.minimum
        ? el("div", { class: "small muted", text: `Si no puedes hacer la versión completa, recuerda que tu versión mínima es ${d.minimum.value} ${d.minimum.unit || ""}${d.minimum.description ? " · " + d.minimum.description : ""}.` })
        : null;
      const row = el("div", { class: "note-det" }, [
        el("span", { class: "nd-icon" }, "🏃"),
        el("div", { class: "nd-main" }, [
          el("div", { class: "nd-text" }, ["«", d.habit_name, "»", idChip]),
          minHint,
        ]),
        el("div", { class: "nd-actions" }, [
          el("button", { class: "btn btn-primary btn-sm", text: "Registrar como hecho",
            on: { click: () => noteDone(d, row) } }),
          el("button", { class: "btn btn-sm", text: "Ignorar", on: { click: () => row.remove() } }),
        ]),
      ]);
      container.appendChild(row);
    });
  }

  async function noteDone(d, row) {
    try {
      await api.noteDone(morningDate, d.habit_id);
      toast(`Registrado «${d.habit_name}» como hecho.`, "success");
      row.classList.add("nd-done");
      row.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    } catch (err) {
      toast(err.message, "error");
    }
  }

  // ------------------------------------------------------------ feedback
  const FEEDBACK_TYPES = [
    { id: "suggestion", icon: "💡", label: "Sugerencia" },
    { id: "bug", icon: "🐛", label: "He encontrado un problema" },
    { id: "like", icon: "❤️", label: "Algo que me gusta" },
    { id: "other", icon: "❓", label: "Otro" },
  ];

  function renderFeedback() {
    const parts = [];
    parts.push(el("h1", { class: "greeting", text: "Enviar feedback" }));
    parts.push(el("div", { class: "subtle", text: "Tu opinión ayuda a mejorar Habit System AI." }));

    const formCard = el("div", { class: "card feedback-form mt-16" });

    // Type selection
    const typeSection = el("div", { class: "field" });
    typeSection.appendChild(el("label", { text: "Tipo" }));
    const typeGrid = el("div", { class: "feedback-type-grid" });
    let selectedType = null;
    FEEDBACK_TYPES.forEach((t) => {
      const btn = el("button", {
        type: "button", class: "feedback-type-btn",
        dataset: { type: t.id },
      }, [
        el("span", { class: "feedback-type-icon", text: t.icon }),
        el("span", { class: "feedback-type-label", text: t.label }),
      ]);
      btn.addEventListener("click", () => {
        typeGrid.querySelectorAll(".feedback-type-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedType = t.id;
        updateSubmitState();
      });
      typeGrid.appendChild(btn);
    });
    typeSection.appendChild(typeGrid);
    formCard.appendChild(typeSection);

    // Message
    const msgField = el("div", { class: "field" });
    msgField.appendChild(el("label", { for: "fb-message", text: "Mensaje" }));
    const msgTa = el("textarea", {
      id: "fb-message", placeholder: "Cuéntanos qué piensas...", rows: "6", maxlength: "5000",
    });
    msgTa.addEventListener("input", updateSubmitState);
    msgField.appendChild(msgTa);
    formCard.appendChild(msgField);

    // Technical info toggle
    const techSection = el("div", { class: "field" });
    const techChk = el("input", { type: "checkbox", id: "fb-tech" });
    const techSwitch = el("label", { class: "switch" }, [
      techChk,
      el("span", { class: "track" }),
      el("span", { text: "Incluir información técnica para ayudarnos a diagnosticar el problema" }),
    ]);
    techSection.appendChild(techSwitch);

    const techDetail = el("div", { class: "feedback-tech-detail", style: "display:none" });
    techDetail.appendChild(el("p", { class: "small muted", text: "Se incluirá únicamente:" }));
    const techList = el("ul", { class: "small muted feedback-tech-list" });
    const techInfo = getTechnicalInfo();
    Object.keys(techInfo).forEach((k) => {
      techList.appendChild(el("li", {}, [
        el("b", { text: k + ": " }),
        el("span", { text: String(techInfo[k]) }),
      ]));
    });
    techDetail.appendChild(techList);
    techDetail.appendChild(el("p", { class: "small muted mt-8", text: "No se incluyen hábitos, registros, identidades, notas de Mañana, estadísticas ni contenido de la base de datos SQLite." }));
    techSection.appendChild(techDetail);

    techChk.addEventListener("change", () => {
      techDetail.style.display = techChk.checked ? "" : "none";
    });
    formCard.appendChild(techSection);

    // Privacy block
    const privacyCard = el("div", { class: "card feedback-privacy mt-16" }, [
      el("div", { class: "feedback-privacy-head" }, [
        el("span", { class: "feedback-privacy-icon", text: "🔒" }),
        el("h3", { text: "Privacidad" }),
      ]),
      el("p", { class: "small", text: "Este formulario no incluye automáticamente tus hábitos, registros, identidades, notas ni estadísticas." }),
      el("p", { class: "small", text: "Actualmente el feedback se almacena en el sistema local de la aplicación y no se reenvía a servicios externos." }),
    ]);
    parts.push(formCard);
    parts.push(privacyCard);

    // Consent + submit
    const consentSection = el("div", { class: "feedback-consent mt-16" });
    const consentChk = el("input", { type: "checkbox", id: "fb-consent" });
    consentChk.addEventListener("change", updateSubmitState);
    consentSection.appendChild(el("label", { class: "switch" }, [
      consentChk,
      el("span", { class: "track" }),
      el("span", { text: "Entiendo qué información se enviará y autorizo su envío." }),
    ]));

    const submitBtn = el("button", {
      class: "btn btn-primary mt-16", id: "fb-submit", text: "Enviar feedback", disabled: "true",
    });
    submitBtn.addEventListener("click", submitFeedback);

    consentSection.appendChild(submitBtn);
    parts.push(consentSection);

    app.innerHTML = "";
    app.appendChild(el("div", { class: "feedback-view", style: "max-width:640px;margin:0 auto" }, parts));

    function updateSubmitState() {
      const hasMsg = msgTa.value.trim().length > 0;
      const hasType = selectedType !== null;
      const consented = consentChk.checked;
      submitBtn.disabled = !(hasMsg && hasType && consented);
    }
  }

  function getTechnicalInfo() {
    const info = {};
    info["Navegador"] = navigator.userAgent.split(" ").pop() || navigator.userAgent;
    info["Pantalla"] = `${window.screen.width}x${window.screen.height}`;
    info["Viewport"] = `${window.innerWidth}x${window.innerHeight}`;
    return info;
  }

  async function submitFeedback() {
    const submitBtn = document.getElementById("fb-submit");
    if (!submitBtn) return;
    const typeBtn = document.querySelector(".feedback-type-btn.selected");
    const message = (document.getElementById("fb-message") || {}).value || "";
    const techEnabled = (document.getElementById("fb-tech") || {}).checked;

    if (!typeBtn || !message.trim()) {
      toast("Completa todos los campos.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando…";

    const payload = {
      type: typeBtn.dataset.type,
      message: message.trim(),
    };
    if (techEnabled) {
      payload.technical_info = getTechnicalInfo();
    }

    try {
      await api.submitFeedback(payload);
      toast("Feedback enviado. Gracias por tu opinión.", "success");
      renderFeedbackSuccess();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar feedback";
      toast(err.message, "error");
    }
  }

  function renderFeedbackSuccess() {
    const parts = [];
    parts.push(el("div", { class: "empty" }, [
      el("div", { class: "big", text: "✅" }),
      el("h2", { text: "Feedback enviado" }),
      el("p", { text: "Gracias por tu opinión. Nos ayuda a mejorar Habit System AI." }),
      el("div", { class: "actions" }, [
        el("button", { class: "btn btn-primary", text: "Volver al inicio", on: { click: () => navigate("#/") } }),
        el("button", { class: "btn", text: "Enviar otro", on: { click: () => renderFeedback() } }),
      ]),
    ]));
    app.innerHTML = "";
    app.appendChild(el("div", {}, parts));
  }

  // ---------------------------------------------------------------- settings
  let currentTheme = "light";

  function applyTheme(theme) {
    currentTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", currentTheme);
    try { localStorage.setItem("habitfy_theme", currentTheme); } catch (_) { /* ignore */ }
  }

  function setTheme(theme) {
    applyTheme(theme);
    const lb = document.getElementById("theme-light");
    const db = document.getElementById("theme-dark");
    if (lb) lb.classList.toggle("btn-primary", currentTheme === "light");
    if (db) db.classList.toggle("btn-primary", currentTheme === "dark");
    api.saveTheme({ theme: currentTheme }).then(() => {
      toast(currentTheme === "dark" ? "Tema oscuro activado" : "Tema claro activado");
    }).catch(() => toast("No se pudo guardar el tema", "error"));
  }

  function renderSettings() {
    const parts = [];
    parts.push(el("h1", { class: "greeting", text: "Ajustes" }));

    const reviewCard = el("div", { class: "card settings-card" }, [
      el("h2", { text: "Revisión semanal" }),
      el("p", { text: "Elige el momento de tu revisión: se abre cada domingo a esa hora y queda visible hasta que termina el día. Antes de esa hora, la página de Revisión solo muestra la cuenta atrás." }),
      el("div", { class: "settings-row" }, [
        el("div", { class: "field" }, [
          el("label", { text: "Día" }),
          el("input", { type: "text", value: "Domingo", disabled: "true", id: "r-set-day" }),
        ]),
        el("div", { class: "field" }, [
          el("label", { text: "Hora" }),
          el("input", { type: "time", id: "r-set-time", value: "" }),
        ]),
      ]),
      el("div", { class: "settings-actions" }, [
        el("button", { class: "btn btn-primary", text: "Guardar momento", on: { click: saveReviewSetting } }),
        el("button", { class: "btn", text: "Quitar momento", on: { click: clearReviewSetting } }),
      ]),
    ]);
    parts.push(reviewCard);

    const themeCard = el("div", { class: "card settings-card" }, [
      el("h2", { text: "Apariencia" }),
      el("p", { text: "Elige el tema de la aplicación." }),
      el("div", { class: "settings-actions" }, [
        el("button", { class: "btn", id: "theme-light", text: "☀️ Claro", on: { click: () => setTheme("light") } }),
        el("button", { class: "btn", id: "theme-dark", text: "🌙 Oscuro", on: { click: () => setTheme("dark") } }),
      ]),
    ]);
    parts.push(themeCard);

    const resetCard = el("div", { class: "card settings-card" }, [
      el("h2", { text: "Datos" }),
      el("h3", { class: "settings-danger-title", text: "Borrar todos los datos" }),
      el("p", { text: "Elimina todas tus identidades, hábitos, registros, obstáculos y revisiones. Esta acción no se puede deshacer." }),
      el("div", { class: "settings-actions" }, [
        el("button", {
          class: "btn btn-danger", text: "Borrar todos los datos",
          on: { click: resetAllData },
        }),
      ]),
    ]);
    parts.push(resetCard);

    const dataCard = el("div", { class: "card settings-card" }, [
      el("h2", { text: "Datos de ejemplo" }),
      el("p", { text: "Puedes cargar un conjunto de identidades y hábitos realistas para explorar la aplicación, y eliminarlos en un clic. Están marcados como demo." }),
      el("div", { class: "settings-actions" }, [
        el("button", { class: "btn", text: "Cargar datos de ejemplo", on: { click: loadDemo } }),
        el("button", {
          class: "btn btn-danger", text: "Eliminar datos de ejemplo",
          on: { click: deleteDemo },
        }),
      ]),
    ]);
    parts.push(dataCard);

    const reminderCard = el("div", { class: "card settings-card" }, [
      el("h2", { text: "Recordatorios" }),
      el("p", { text: "Cada hábito puede tener un recordatorio configurable (hora y días). Se muestran como notificaciones del navegador en tono de pregunta, nunca de reproche." }),
    ]);
    parts.push(reminderCard);

    const privacyCard = el("div", { class: "card settings-card" }, [
      el("h2", { text: "Tu privacidad es lo primero" }),
      el("p", { text: "Habit System AI está diseñado para funcionar localmente. Tus datos se almacenan en tu dispositivo y no se envían a servicios externos durante el uso normal de la aplicación." }),
      el("div", { class: "privacy-items" }, [
        el("div", { class: "privacy-item" }, [
          el("span", { class: "privacy-icon", text: "🔒" }),
          el("div", {}, [
            el("b", { text: "Datos locales" }),
            el("p", { class: "small muted", text: "Tus hábitos, registros, identidades, notas y estadísticas permanecen en tu dispositivo." }),
          ]),
        ]),
        el("div", { class: "privacy-item" }, [
          el("span", { class: "privacy-icon", text: "🚫" }),
          el("div", {}, [
            el("b", { text: "Sin seguimiento" }),
            el("p", { class: "small muted", text: "No utilizamos analytics, tracking ni servicios de terceros para seguir tu actividad." }),
          ]),
        ]),
        el("div", { class: "privacy-item" }, [
          el("span", { class: "privacy-icon", text: "💬" }),
          el("div", {}, [
            el("b", { text: "Feedback voluntario" }),
            el("p", { class: "small muted", text: "Cuando envías feedback, tú decides qué información compartir." }),
          ]),
        ]),
        el("div", { class: "privacy-item" }, [
          el("span", { class: "privacy-icon", text: "👤" }),
          el("div", {}, [
            el("b", { text: "Tú decides qué compartir" }),
            el("p", { class: "small muted", text: "Antes de enviarlo puedes revisar la información que contiene." }),
          ]),
        ]),
      ]),
      el("div", { class: "privacy-exception" }, [
        el("p", { class: "small", text: "Excepción: cuando envías feedback, el contenido que hayas aprobado se envía al backend local de la aplicación. Actualmente no se reenvía a ningún servicio externo." }),
      ]),
    ]);
    parts.push(privacyCard);

    const shortcutsCard = el("div", { class: "card settings-card" }, [
      el("h2", { text: "Atajos" }),
      el("p", { text: "En la pantalla principal, pulsa la tecla N para diseñar un hábito y E para abrir estadísticas." }),
    ]);
    parts.push(shortcutsCard);

    app.innerHTML = "";
    app.appendChild(el("div", {}, parts));

    api.weeklyReview().then((d) => {
      const t = document.getElementById("r-set-time");
      const s = d.schedule || {};
      if (t && s.time) t.value = s.time;
    }).catch(() => {});

    const lb = document.getElementById("theme-light");
    const db = document.getElementById("theme-dark");
    if (lb) lb.classList.toggle("btn-primary", currentTheme === "light");
    if (db) db.classList.toggle("btn-primary", currentTheme === "dark");
  }

  async function saveReviewSetting() {
    const t = document.getElementById("r-set-time");
    if (!t) return;
    try {
      await api.saveReviewSetting({ time: t.value });
      toast("Momento de revisión guardado.");
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function clearReviewSetting() {
    try {
      await api.saveReviewSetting({ time: "" });
      toast("Revisión siempre visible.");
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function deleteDemo() {
    const ok = await confirmDialog(
      "Eliminar datos de ejemplo",
      "Se eliminarán las identidades, hábitos y registros de demostración. Esta acción no afecta a tus datos propios.",
      "Eliminar", true
    );
    if (!ok) return;
    try {
      await api.deleteDemo();
      toast("Datos de ejemplo eliminados.");
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function resetAllData() {
    const ok = await confirmDialog(
      "¿Borrar todos los datos?",
      {
        lead: "Se eliminarán permanentemente:",
        items: ["identidades", "hábitos", "registros", "obstáculos", "revisiones", "estadísticas derivadas"],
        trail: "Esta acción no se puede deshacer.",
      },
      "Sí, borrar todos los datos", true
    );
    if (!ok) return;
    const ok2 = await confirmDialog(
      "¿Última confirmación?",
      "Se borrará absolutamente todo. No hay manera de recuperar estos datos.",
      "Sí, borrar todo", true
    );
    if (!ok2) return;
    try {
      await api.resetAll();
      toast("Todos los datos han sido borrados.", "success");
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  // ------------------------------------------------------------ form helpers
  function formSection(title, children) {
    return el("div", { class: "form-section" }, [
      el("h3", { text: title }),
      el("div", {}, children),
    ]);
  }

  function field(label, input, hint) {
    const inputs = Array.isArray(input) ? input : [input];
    const wrap = el("div", { class: "field" }, [
      el("label", { text: label, for: inputs[0] && inputs[0].id }),
      inputs,
    ]);
    if (hint) wrap.appendChild(el("div", { class: "hint", text: hint }));
    return wrap;
  }

  function iconPicker(current) {
    const wrap = el("div", { class: "icon-picker", id: "icon-picker" });
    Object.keys(ICONS).forEach((key) => {
      wrap.appendChild(el("button", {
        type: "button", class: "icon-opt" + (key === (current || "star") ? " selected" : ""),
        dataset: { icon: key }, "aria-label": key,
        on: { click: (e) => {
          wrap.querySelectorAll(".icon-opt").forEach((b) => b.classList.remove("selected"));
          e.currentTarget.classList.add("selected");
        } },
      }, ICONS[key]));
    });
    return wrap;
  }

  function colorPicker(current) {
    const wrap = el("div", { class: "color-row", id: "color-picker" });
    COLORS.forEach((c) => {
      wrap.appendChild(el("button", {
        type: "button", class: "swatch" + (c === (current || COLORS[0]) ? " selected" : ""),
        style: `background:${c}`, dataset: { color: c }, "aria-label": c,
        on: { click: (e) => {
          wrap.querySelectorAll(".swatch").forEach((b) => b.classList.remove("selected"));
          e.currentTarget.classList.add("selected");
        } },
      }));
    });
    return wrap;
  }

  function dayPicker(selected, id) {
    const wrap = el("div", { class: "day-picker", id });
    const sel = new Set(selected || WEEKDAY_ISO);
    ["L", "M", "X", "J", "V", "S", "D"].forEach((label, i) => {
      const iso = i + 1;
      wrap.appendChild(el("button", {
        type: "button", class: sel.has(iso) ? "active" : "",
        dataset: { day: iso }, "aria-pressed": sel.has(iso) ? "true" : "false",
        on: { click: (e) => { e.currentTarget.classList.toggle("active"); } },
      }, label));
    });
    return wrap;
  }

  function daysFromPicker(picker) {
    if (!picker) return [];
    const days = [];
    picker.querySelectorAll("button.active").forEach((b) => days.push(parseInt(b.dataset.day, 10)));
    return days.length ? days : WEEKDAY_ISO.slice();
  }

  function showFieldError(container, key, message) {
    const map = {
      name: "#a-name", frequency_type: "#f-frequency", type: "#type-cards",
      target_value: "#f-target", frequency_target: "#f-freq-target",
    };
    const input = container.querySelector(map[key] || "#a-name");
    if (!input) return;
    const fieldWrap = input.closest(".field");
    if (fieldWrap) {
      fieldWrap.classList.add("invalid");
      if (!fieldWrap.querySelector(".field-error")) {
        fieldWrap.appendChild(el("div", { class: "field-error", text: message }));
      }
    }
  }

  // ------------------------------------------------------------ habit wizard
  const WIZ_STEPS = [
    { id: "identity", title: "¿Quién quieres llegar a ser?" },
    { id: "action", title: "¿Qué pequeña acción lo demuestra?" },
    { id: "when", title: "¿Cuándo quieres hacerlo?" },
    { id: "objective", title: "¿Con qué frecuencia?" },
    { id: "system", title: "¿Quieres hacerlo más fácil?" },
    { id: "schedule", title: "Recordatorio y comienzo" },
  ];

  function openHabitForm(habit, presetIdentityId) {
    const editing = Boolean(habit);
    const modal = openModal({
      title: editing ? "Rediseñar el sistema" : "Diseñar un hábito",
      body: el("div", { id: "wizard" }),
      foot: [],
      wide: true,
    });
    const body = modal.backdrop.querySelector(".modal-body");
    const foot = modal.backdrop.querySelector(".modal-foot");
    const h = habit || {};
    const wiz = {
      step: 0,
      editing,
      habit,
      identities: [],
      data: {
        identity_id: editing ? (h.identity_id || null) : (presetIdentityId || null),
        name: h.name || "",
        description: h.description || "",
        cue: h.cue || "",
        location: h.location || "",
        environment: h.environment || "",
        attraction_strategy: h.attraction_strategy || "",
        friction_strategy: h.friction_strategy || "",
        reward_strategy: h.reward_strategy || "",
        minimum_value: h.minimum_value != null ? h.minimum_value : null,
        minimum_unit: h.minimum_unit || "",
        minimum_description: h.minimum_description || "",
        type: h.type || "boolean",
        target_value: h.target_value != null ? h.target_value : null,
        unit: h.unit || "",
        target_unit: h.target_unit || "",
        frequency_type: h.frequency_type || "weekly",
        frequency_target: h.frequency_target || 4,
        frequency_days: h.frequency_days || [],
        reminder_enabled: h.reminder_enabled || false,
        reminder_time: h.reminder_time || "20:00",
        reminder_days: h.reminder_days || [],
        start_date: h.start_date || fmt.toISODate(new Date()),
        icon: h.icon || "star",
        color: h.color || COLORS[0],
      },
    };
    const cache = { stepBody: null };
    renderWizardStep(modal, wiz, foot, cache);
  }

  async function renderWizardStep(modal, wiz, foot, cache) {
    const body = modal.backdrop.querySelector(".modal-body");
    const stepDef = WIZ_STEPS[wiz.step];
    const stepBody = el("div", { class: "wizard-body" });
    cache.stepBody = stepBody;
    const content = el("div", { class: "wizard-step" }, [
      el("div", { class: "wizard-progress" },
        WIZ_STEPS.map((s, i) => el("span", {
          class: "wdot" + (i <= wiz.step ? " on" : ""),
          title: s.title,
        }))),
      el("h3", { class: "wizard-title", text: stepDef.title }),
      stepBody,
    ]);
    body.innerHTML = "";
    body.appendChild(content);

    await renderStepContent(stepDef.id, wiz, stepBody);

    foot.innerHTML = "";
    const backBtn = el("button", { class: "btn", text: wiz.step === 0 ? "Cancelar" : "Atrás" });
    backBtn.addEventListener("click", () => {
      if (wiz.step === 0) closeModal(modal);
      else { wiz.step -= 1; renderWizardStep(modal, wiz, foot, cache); }
    });
    const isLast = wiz.step === WIZ_STEPS.length - 1;
    const nextBtn = el("button", {
      class: "btn btn-primary",
      text: isLast ? (wiz.editing ? "Guardar cambios" : "Crear hábito") : "Continuar",
    });
    nextBtn.addEventListener("click", async () => {
      if (!collectStep(stepDef.id, wiz, stepBody)) return;
      if (isLast) {
        await saveHabit(wiz, modal);
      } else {
        wiz.step += 1;
        renderWizardStep(modal, wiz, foot, cache);
      }
    });
    foot.appendChild(backBtn);
    foot.appendChild(nextBtn);
  }

  function val(container, id) {
    const n = container.querySelector(id);
    return n ? n.value.trim() : "";
  }

  function num(container, id) {
    const n = container.querySelector(id);
    if (!n || n.value === "") return null;
    const v = Number(n.value);
    return Number.isFinite(v) ? v : null;
  }

  async function renderStepContent(stepId, wiz, stepBody) {
    if (stepId === "identity") return wizardIdentityStep(wiz, stepBody);
    if (stepId === "action") return wizardActionStep(wiz, stepBody);
    if (stepId === "when") return wizardWhenStep(wiz, stepBody);
    if (stepId === "objective") return wizardObjectiveStep(wiz, stepBody);
    if (stepId === "system") return wizardSystemStep(wiz, stepBody);
    if (stepId === "schedule") return wizardScheduleStep(wiz, stepBody);
  }

  // --- identity step ---
  async function wizardIdentityStep(wiz, container) {
    const identities = await api.listIdentities();
    wiz.identities = identities;
    const list = el("div", { class: "identity-options" });
    const pick = (id) => {
      list.querySelectorAll(".identity-option").forEach((c) => {
        c.classList.toggle("selected", String(c.dataset.id) === String(id));
      });
      wiz.data.identity_id = id;
      if (id) {
        const ident = identities.find((i) => i.id === id);
        if (ident) {
          if (!wiz.editing) { wiz.data.icon = ident.icon; wiz.data.color = ident.color; }
        }
      }
    };
    const option = (data) => {
      const card = el("div", {
        class: "identity-option" + (String(data.id) === String(wiz.data.identity_id) ? " selected" : ""),
        dataset: { id: data.id == null ? "" : data.id },
        tabindex: "0", role: "radio",
      }, [
        el("span", { class: "io-icon", style: `background:${data.color}1a`, "aria-hidden": "true" }, data.icon),
        el("span", { class: "io-main" }, [
          el("b", { text: data.name }),
          el("small", { text: data.desc }),
        ]),
      ]);
      const click = () => pick(data.id);
      card.addEventListener("click", click);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); click(); }
      });
      return card;
    };
    list.appendChild(option({
      id: null, name: "Sin identidad", desc: "Solo el hábito, sin identidad",
      icon: "○", color: "#9ca3af",
    }));
    identities.forEach((idn) => {
      list.appendChild(option({
        id: idn.id, name: idn.name,
        desc: `${idn.votes.this_week} ${idn.votes.this_week === 1 ? "acción" : "acciones"} esta semana · ${idn.habit_count} hábitos`,
        icon: iconOf(idn), color: idn.color,
      }));
    });
    container.appendChild(list);
    container.appendChild(el("p", { class: "hint", text: "Puedes crear una nueva identidad debajo." }));

    const newWrap = el("div", { class: "identity-new" });
    container.appendChild(newWrap);
    const toggleBtn = el("button", { class: "btn btn-sm mt-8", text: "+ Crear nueva identidad" });
    toggleBtn.addEventListener("click", () => {
      if (newWrap.innerHTML) { newWrap.innerHTML = ""; return; }
      newWrap.appendChild(el("div", {}, [
        field("Nombre", [el("input", { type: "text", id: "wn-name", placeholder: "ej. Lector", maxlength: "80" })]),
        el("div", { class: "form-row" }, [
          field("Icono", iconPicker()),
          field("Color", colorPicker()),
        ]),
        field("Descripción (opcional)", [el("input", { type: "text", id: "wn-desc", placeholder: "ej. Alguien que disfruta leyendo", maxlength: "200" })]),
        el("div", { class: "actions" }, [
          el("button", {
            class: "btn btn-primary btn-sm", text: "Guardar identidad",
            on: { click: async () => {
              const name = newWrap.querySelector("#wn-name").value.trim();
              if (!name) { toast("Escribe un nombre para la identidad.", "error"); return; }
              const selIcon = newWrap.querySelector("#icon-picker .selected");
              const selColor = newWrap.querySelector("#color-picker .selected");
              try {
                const created = await api.createIdentity({
                  name,
                  description: newWrap.querySelector("#wn-desc").value.trim(),
                  icon: selIcon ? selIcon.dataset.icon : "star",
                  color: selColor ? selColor.dataset.color : COLORS[0],
                });
                identities.push({ ...created, votes: { this_week: 0 }, habit_count: 0 });
                list.appendChild(option({
                  id: created.id, name: created.name,
                  desc: `0 acciones esta semana · 0 hábitos`,
                  icon: iconOf(created), color: created.color,
                }));
                wiz.data.icon = created.icon;
                wiz.data.color = created.color;
                pick(created.id);
                toast(`Identidad «${name}» creada.`);
                newWrap.innerHTML = "";
              } catch (err) {
                toast(err.message, "error");
              }
            } },
          }),
        ]),
      ]));
    });
    container.appendChild(toggleBtn);
  }

  // --- action step ---
  function wizardActionStep(wiz, container) {
    const ident = (wiz.identities || []).find((i) => i.id === wiz.data.identity_id);
    const nameInput = el("input", {
      type: "text", id: "a-name", value: wiz.data.name,
      placeholder: "ej. Leer 2 páginas", autocomplete: "off", maxlength: "100",
    });
    container.appendChild(field("La acción", [nameInput],
      "Empieza pequeño: algo que puedas hacer incluso en un día difícil."));
    container.appendChild(field("Descripción (opcional)", [
      el("input", { type: "text", id: "a-desc", value: wiz.data.description, placeholder: "ej. Abrir el libro y leer dos páginas", maxlength: "200" }),
    ]));

    let actions = GENERIC_SUGGESTIONS;
    if (ident) {
      const name = ident.name.toLowerCase();
      const match = IDENTITY_SUGGESTIONS.find((s) => s.keys.some((k) => name.includes(k)));
      if (match) actions = match.actions;
    }
    container.appendChild(el("p", { class: "small muted mt-8", text: ident ? `Ideas para «${ident.name}»:` : "Algunas ideas:" }));
    const chips = el("div", { class: "chip-row" });
    actions.forEach((a) => {
      chips.appendChild(el("button", {
        type: "button", class: "chip", text: a,
        on: { click: (e) => { nameInput.value = a; chips.querySelectorAll(".chip").forEach((c) => c.classList.remove("active")); e.currentTarget.classList.add("active"); } },
      }));
    });
    container.appendChild(chips);
  }

  // --- when step ---
  function wizardWhenStep(wiz, container) {
    const h = wiz.data;
    const cueInput = el("input", {
      type: "text", id: "w-cue", value: h.cue,
      placeholder: "ej. Después de cenar", maxlength: "100",
    });
    const chips = el("div", { class: "chip-row" });
    const presets = [
      "Después de despertarme", "Después de desayunar", "Después de comer",
      "Después de cenar", "Después de lavarme los dientes", "Al llegar a casa",
      "Al llegar al trabajo", "Antes de dormir", "A una hora concreta", "En un lugar concreto",
    ];
    presets.forEach((cue) => {
      const chip = el("button", {
        type: "button", class: "chip" + (h.cue === cue ? " active" : ""), text: cue,
      });
      chip.addEventListener("click", () => {
        cueInput.value = cue;
        chips.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
      });
      chips.appendChild(chip);
    });
    api.listHabits().then((habits) => {
      habits.forEach((hab) => {
        const chip = el("button", { type: "button", class: "chip", text: `Después de ${hab.name}` });
        chip.addEventListener("click", () => {
          cueInput.value = `Después de ${hab.name}`;
          chips.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
        });
        chips.appendChild(chip);
      });
    }).catch(() => {});
    container.appendChild(field("La señal o contexto", [cueInput, chips],
      "Asócialo a algo que ya haces: «Después de X, haré Y»."));
    container.appendChild(field("Lugar (opcional)", [
      el("input", { type: "text", id: "w-location", value: h.location, placeholder: "ej. En el salón", maxlength: "100" }),
    ]));
  }

  // --- objective step ---
  function wizardObjectiveStep(wiz, container) {
    container._habit = wiz.data;
    const cards = el("div", { class: "type-cards", id: "type-cards" },
      Object.keys(TYPE_META).map((t) =>
        el("div", {
          class: "type-card" + (t === wiz.data.type ? " selected" : ""),
          tabindex: "0", role: "radio", "aria-checked": t === wiz.data.type ? "true" : "false",
          dataset: { type: t },
        }, [
          el("div", { text: TYPE_META[t].label }),
          el("small", { text: TYPE_META[t].desc }),
        ])
      )
    );
    container.appendChild(field("Cómo lo registras", [cards]));
    const targetWrap = el("div", { id: "target-fields" });
    container.appendChild(targetWrap);
    bindTypeCards(container);

    container.appendChild(field("Frecuencia", [
      el("select", { id: "f-frequency", value: wiz.data.frequency_type }, [
        el("option", { value: "daily", text: "Todos los días" }),
        el("option", { value: "weekly", text: "X veces por semana" }),
        el("option", { value: "monthly", text: "X veces por mes" }),
        el("option", { value: "specific_days", text: "Días concretos de la semana" }),
      ]),
    ]));
    const freqWrap = el("div", { id: "frequency-fields" });
    container.appendChild(freqWrap);
    bindFrequency(container, wiz.data);
  }

  function bindTypeCards(body) {
    const cards = body.querySelectorAll(".type-card");
    const targetWrap = body.querySelector("#target-fields");
    cards.forEach((c) => {
      const select = () => {
        cards.forEach((x) => { x.classList.remove("selected"); x.setAttribute("aria-checked", "false"); });
        c.classList.add("selected");
        c.setAttribute("aria-checked", "true");
        renderTargetFields(targetWrap, c.dataset.type, body);
      };
      c.addEventListener("click", select);
      c.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
      });
    });
    renderTargetFields(targetWrap, cards[0] && cards[0].dataset.type, body);
  }

  function renderTargetFields(wrap, type, body) {
    const h = (body._habit || {});
    const targetValue = h.target_value;
    const targetStr = targetValue == null ? "" : targetValue;
    const unit = h.unit || "";
    wrap.innerHTML = "";
    if (type === "boolean") {
      wrap.appendChild(el("p", { class: "hint", text: "Solo marcas si lo has realizado. Ideal para hábitos simples." }));
      return;
    }
    if (type === "duration") {
      wrap.appendChild(el("div", { class: "form-row" }, [
        field("Duración por sesión (min)", [el("input", { type: "number", id: "f-target", value: targetStr, min: "1", placeholder: "ej. 10" })]),
      ]));
      wrap.appendChild(el("p", { class: "hint", text: "Cada registro cuenta como una sesión. Puedes indicar los minutos reales al registrarla." }));
      return;
    }
    if (type === "sessions") {
      wrap.appendChild(el("div", { class: "form-row" }, [
        field("Minutos por sesión (opcional)", [el("input", { type: "number", id: "f-target", value: targetStr, min: "1", placeholder: "ej. 30" })]),
      ]));
      wrap.appendChild(el("p", { class: "hint", text: "Cada registro es una sesión. Opcionalmente registras los minutos de práctica." }));
      return;
    }
    const placeholder = TYPE_UNIT_PLACEHOLDER[type] || "";
    wrap.appendChild(el("div", { class: "form-row" }, [
      field("Cantidad por registro", [el("input", { type: "number", id: "f-target", value: targetStr, min: "0", step: "any", placeholder: type === "count" ? "ej. 1" : "ej. 5" })]),
      field("Unidad", [el("input", { type: "text", id: "f-unit", value: unit || "", placeholder, maxlength: "20" })]),
    ]));
    wrap.appendChild(el("p", { class: "hint", text: "La frecuencia decide cuántos registros necesitas; este valor describe cada registro." }));
  }

  function bindFrequency(body, habit) {
    const sel = body.querySelector("#f-frequency");
    const wrap = body.querySelector("#frequency-fields");
    const render = () => renderFrequency(wrap, sel.value, body, habit);
    sel.addEventListener("change", render);
    render();
  }

  function renderFrequency(wrap, freq, body, habit) {
    const h = habit || {};
    const target = h.frequency_target || (freq === "daily" ? 1 : 4);
    wrap.innerHTML = "";
    if (freq === "specific_days") {
      wrap.appendChild(field("Días", dayPicker(h.frequency_days, "f-freq-days")));
      wrap.appendChild(el("p", { class: "hint", text: "Realizarás el hábito una vez cada día marcado. El objetivo semanal se calcula solo." }));
      return;
    }
    const label = freq === "daily" ? "Veces al día" : freq === "monthly" ? "Veces al mes" : "Veces por semana";
    wrap.appendChild(field(label, [el("input", { type: "number", id: "f-freq-target", value: target, min: "1", max: "99" })]));
  }

  // --- system step ---
  function wizardSystemStep(wiz, container) {
    const h = wiz.data;
    container.appendChild(formSection("Hazlo obvio", [
      field("Preparación del entorno (opcional)", [
        el("input", {
          type: "text", id: "s-env", value: h.environment,
          placeholder: "ej. Dejar el libro sobre la mesa", maxlength: "200",
        }),
      ], "¿Qué puedes preparar para que sea más fácil recordarlo?"),
    ]));
    container.appendChild(formSection("Hazlo atractivo (opcional)", [
      field("Asócialo a algo que disfrutes", [
        el("input", {
          type: "text", id: "s-attr", value: h.attraction_strategy,
          placeholder: "ej. Escuchar mi podcast favorito", maxlength: "200",
        }),
      ]),
    ]));
    container.appendChild(formSection("Hazlo fácil", [
      field("Estrategia para reducir la fricción", [
        el("input", {
          type: "text", id: "s-fric", value: h.friction_strategy,
          placeholder: "ej. Preparar las cosas antes", maxlength: "200",
        }),
      ]),
      field("Versión mínima (para días difíciles)", [
        el("input", { type: "number", id: "s-min-value", value: h.minimum_value != null ? h.minimum_value : "", min: "0", step: "any", placeholder: "ej. 1" }),
        el("input", { type: "text", id: "s-min-unit", value: h.minimum_unit, placeholder: "unidad (ej. página, min)", maxlength: "20" }),
        el("input", { type: "text", id: "s-min-desc", value: h.minimum_description, placeholder: "Descripción (ej. Leer 1 página)", maxlength: "100" }),
      ], "La versión mínima debe poder hacerse incluso en un día difícil."),
    ]));
    container.appendChild(formSection("Hazlo satisfactorio (opcional)", [
      field("Cómo registrarlo o celebrarlo", [
        el("input", {
          type: "text", id: "s-reward", value: h.reward_strategy,
          placeholder: "ej. Marcar el progreso al terminar", maxlength: "200",
        }),
      ]),
    ]));
    container.appendChild(el("p", { class: "hint", text: "Todo esto es opcional. Puedes rellenar solo lo que te ayude." }));
  }

  // --- schedule step ---
  function wizardScheduleStep(wiz, container) {
    const h = wiz.data;
    const chk = el("input", { type: "checkbox", id: "r-rem", checked: h.reminder_enabled });
    container.appendChild(el("label", { class: "switch" }, [
      chk,
      el("span", { class: "track" }),
      el("span", { text: "Recordatorio (opcional)" }),
    ]));
    const fieldsWrap = el("div", { class: "mt-8", style: h.reminder_enabled ? "" : "display:none" }, [
      el("div", { class: "form-row" }, [
        field("Hora", [el("input", { type: "time", id: "r-time", value: h.reminder_time || "20:00" })]),
        field("Días", dayPicker(h.reminder_days, "r-days")),
      ]),
      el("p", { class: "hint", text: "Se muestra como notificación mientras la aplicación está abierta, preguntando si ya realizaste la acción." }),
    ]);
    chk.addEventListener("change", () => { fieldsWrap.style.display = chk.checked ? "" : "none"; });
    container.appendChild(fieldsWrap);
    container.appendChild(field("Fecha de inicio", [
      el("input", { type: "date", id: "r-start", value: h.start_date }),
    ]));
  }

  // --- collection & validation ---
  function collectStep(stepId, wiz, body) {
    if (stepId === "identity") return true;
    if (stepId === "action") {
      const name = body.querySelector("#a-name").value.trim();
      if (!name) {
        showFieldError(body, "name", "Escribe qué pequeña acción vas a hacer.");
        return false;
      }
      wiz.data.name = name;
      wiz.data.description = body.querySelector("#a-desc").value.trim();
      return true;
    }
    if (stepId === "when") {
      wiz.data.cue = body.querySelector("#w-cue").value.trim();
      wiz.data.location = body.querySelector("#w-location").value.trim();
      return true;
    }
    if (stepId === "objective") {
      wiz.data.type = currentType(body);
      const targetInput = body.querySelector("#f-target");
      wiz.data.target_value = targetInput && targetInput.value !== "" ? Number(targetInput.value) : null;
      const unitInput = body.querySelector("#f-unit");
      wiz.data.unit = unitInput && unitInput.value.trim() ? unitInput.value.trim() : "";
      wiz.data.target_unit = wiz.data.unit;
      if (wiz.data.type === "duration") { wiz.data.unit = "min"; wiz.data.target_unit = "min"; }
      const freq = body.querySelector("#f-frequency").value;
      wiz.data.frequency_type = freq;
      if (freq === "specific_days") {
        wiz.data.frequency_days = daysFromPicker(body.querySelector("#f-freq-days"));
        wiz.data.frequency_target = wiz.data.frequency_days.length || 1;
      } else {
        wiz.data.frequency_target = Math.max(1, parseInt(body.querySelector("#f-freq-target").value, 10) || 1);
      }
      return true;
    }
    if (stepId === "system") {
      wiz.data.environment = val(body, "#s-env");
      wiz.data.attraction_strategy = val(body, "#s-attr");
      wiz.data.friction_strategy = val(body, "#s-fric");
      wiz.data.minimum_value = num(body, "#s-min-value");
      wiz.data.minimum_unit = val(body, "#s-min-unit");
      wiz.data.minimum_description = val(body, "#s-min-desc");
      wiz.data.reward_strategy = val(body, "#s-reward");
      return true;
    }
    if (stepId === "schedule") {
      const chk = body.querySelector("#r-rem");
      wiz.data.reminder_enabled = chk.checked;
      if (chk.checked) {
        wiz.data.reminder_time = body.querySelector("#r-time").value || "20:00";
        wiz.data.reminder_days = daysFromPicker(body.querySelector("#r-days"));
      }
      const start = body.querySelector("#r-start").value;
      if (start) wiz.data.start_date = start;
      return true;
    }
    return true;
  }

  function currentType(body) {
    const sel = body.querySelector(".type-card.selected");
    return sel ? sel.dataset.type : "boolean";
  }

  async function saveHabit(wiz, modal) {
    const p = wiz.data;
    const payload = {
      name: p.name,
      description: p.description || undefined,
      type: p.type,
      unit: p.unit || undefined,
      target_value: p.target_value,
      target_unit: p.target_unit || undefined,
      frequency_type: p.frequency_type,
      frequency_target: p.frequency_target,
      frequency_days: p.frequency_days || [],
      cue: p.cue || undefined,
      location: p.location || undefined,
      environment: p.environment || undefined,
      attraction_strategy: p.attraction_strategy || undefined,
      friction_strategy: p.friction_strategy || undefined,
      reward_strategy: p.reward_strategy || undefined,
      minimum_value: p.minimum_value,
      minimum_unit: p.minimum_unit || undefined,
      minimum_description: p.minimum_description || undefined,
      reminder_enabled: p.reminder_enabled,
      reminder_time: p.reminder_enabled ? p.reminder_time : undefined,
      reminder_days: p.reminder_enabled ? (p.reminder_days || []) : [],
      start_date: p.start_date,
      identity_id: p.identity_id,
      icon: p.icon,
      color: p.color,
    };
    const btn = modal.backdrop.querySelector(".modal-foot .btn-primary");
    if (btn) btn.disabled = true;
    try {
      if (wiz.editing) {
        await api.updateHabit(wiz.habit.id, payload);
        toast("Sistema actualizado.");
      } else {
        await api.createHabit(payload);
        const identity = (wiz.identities || []).find((i) => i.id === p.identity_id);
        toast(identity ? `Hábito diseñado. Cada acción será un voto para ${identity.name}.` : "Hábito diseñado.");
      }
      closeModal(modal);
      refresh();
    } catch (err) {
      if (btn) btn.disabled = false;
      toast(err.message, "error");
    }
  }

  // ----------------------------------------------------------- event forms
  function openEventForm(h, ev) {
    const editing = Boolean(ev);
    const dt = editing ? fmt.parseLocal(ev.occurred_at) : new Date();
    const modal = openModal({
      title: editing ? "Editar registro" : `Registrar · ${h.name}`,
      body: el("div", {}, [
        field("Fecha y hora", [el("input", { type: "datetime-local", id: "e-when", value: fmt.toISODatetime(dt) })]),
        eventValueFields(h, ev),
        field("Notas (opcional)", [el("input", { type: "text", id: "e-notes", value: (ev && ev.notes) || "", maxlength: "200" })]),
      ]),
      foot: [],
    });
    const body = modal.backdrop.querySelector(".modal-body");
    const foot = modal.backdrop.querySelector(".modal-foot");
    foot.appendChild(el("button", { class: "btn", text: "Cancelar", on: { click: () => closeModal(modal) } }));
    foot.appendChild(el("button", {
      class: "btn btn-primary", text: editing ? "Guardar" : "Registrar",
      on: { click: () => submitEvent(modal, h, ev, body) },
    }));
  }

  function eventValueFields(h, ev) {
    const t = h.type;
    if (t === "boolean") return el("p", { class: "hint", text: "Este hábito solo se marca como realizado." });
    const row = el("div", { class: "form-row" });
    if (t === "duration") {
      row.appendChild(field("Minutos", [el("input", { type: "number", id: "e-value", value: (ev && ev.value) || h.target_value || "", min: "0", step: "1" })]));
    } else if (t === "sessions") {
      row.appendChild(field("Sesiones", [el("input", { type: "number", id: "e-value", value: 1, min: "1", step: "1" })]));
      row.appendChild(field("Minutos (opcional)", [el("input", { type: "number", id: "e-duration", value: (ev && ev.duration) || h.target_value || "", min: "0", step: "1" })]));
    } else {
      row.appendChild(field(`Cantidad${h.unit ? ` (${h.unit})` : ""}`, [el("input", { type: "number", id: "e-value", value: (ev && ev.value) || h.target_value || 1, min: "0", step: "any" })]));
    }
    return row;
  }

  async function submitEvent(modal, h, ev, body) {
    const when = body.querySelector("#e-when").value;
    if (!when) {
      toast("Indica la fecha y hora.", "error");
      return;
    }
    const payload = { occurred_at: when.replace(" ", "T") };
    const valueInput = body.querySelector("#e-value");
    if (valueInput && valueInput.value !== "") payload.value = Number(valueInput.value);
    const durInput = body.querySelector("#e-duration");
    if (durInput && durInput.value !== "") payload.duration = Number(durInput.value);
    const notes = body.querySelector("#e-notes");
    if (notes && notes.value.trim()) payload.notes = notes.value.trim();
    try {
      if (ev) {
        await api.updateEvent(ev.id, payload);
        toast("Registro actualizado.");
      } else {
        await api.createEvent(h.id, payload);
        const identity = h.identity;
        toast(identity ? `✓ Hecho · +1 voto para ${identity.name}` : "✓ Hecho · acción registrada", "success");
      }
      closeModal(modal);
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  // ------------------------------------------------------- reminders engine
  const REMINDER_CHECK_MS = 30000;
  let firedToday = new Set();

  function scheduleReminders() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission();
    setInterval(async () => {
      if (Notification.permission !== "granted") return;
      const now = new Date();
      const iso = now.toDateString();
      try {
        const habits = await api.listHabits();
        habits.forEach((h) => {
          if (!h.reminder_enabled || !h.reminder_time) return;
          const days = h.reminder_days && h.reminder_days.length ? h.reminder_days : [1, 2, 3, 4, 5, 6, 7];
          const isoDay = (now.getDay() + 6) % 7 + 1;
          if (!days.includes(isoDay)) return;
          const [hh, mm] = h.reminder_time.split(":").map(Number);
          const diffMin = now.getHours() * 60 + now.getMinutes() - (hh * 60 + mm);
          const key = `${h.id}:${iso}`;
          if (diffMin >= 0 && diffMin <= 2 && !firedToday.has(key)) {
            firedToday.add(key);
            new Notification(h.name, { body: `¿Ya has realizado "${h.name}" hoy?` });
          }
        });
      } catch (_) { /* ignore */ }
    }, REMINDER_CHECK_MS);
  }

  // ------------------------------------------------------- onboarding modal
  function showOnboardingIfNeeded(state) {
    if (state.has_habits || state.has_identities) return;
    try {
      if (localStorage.getItem("habitfy_onboarded")) return;
    } catch (_) { /* ignore */ }
    const slides = [
      { icon: "🧭", title: "No necesitas más fuerza de voluntad", text: "Diseña un sistema que haga más fácil hacer lo que quieres hacer." },
      { icon: "👤", title: "Decide quién quieres ser", text: "Tus hábitos son pequeñas acciones que refuerzan esa identidad." },
      { icon: "🌱", title: "Empieza pequeño", text: "La versión mínima debe ser fácil de comenzar incluso en un día difícil." },
      { icon: "🏠", title: "Diseña tu entorno", text: "Las señales y el contexto pueden ayudarte a recordar." },
      { icon: "✅", title: "Registra tus acciones", text: "Ver tu trayectoria hace visible el progreso." },
      { icon: "🔧", title: "Si algo no funciona, rediseña el sistema", text: "No necesitas más culpa. Necesitas descubrir qué obstáculo existe." },
    ];
    let idx = 0;
    const modal = openModal({
      title: "Bienvenido/a",
      body: el("div", { class: "onboard" }),
      foot: [],
      onClose: () => { try { localStorage.setItem("habitfy_onboarded", "1"); } catch (_) { /* ignore */ } },
    });
    const body = modal.backdrop.querySelector(".modal-body");
    const foot = modal.backdrop.querySelector(".modal-foot");
    const render = () => {
      const s = slides[idx];
      body.innerHTML = "";
      body.appendChild(el("div", { class: "onboard-slide" }, [
        el("div", { class: "big", text: s.icon }),
        el("h2", { text: s.title }),
        el("p", { text: s.text }),
        el("div", { class: "onboard-dots" }, slides.map((_, i) => el("span", { class: "odot" + (i === idx ? " on" : "") }))),
      ]));
      foot.innerHTML = "";
      foot.appendChild(el("button", {
        class: "btn", text: idx === 0 ? "Cerrar" : "Atrás",
        on: { click: () => { if (idx === 0) closeModal(modal); else { idx -= 1; render(); } } },
      }));
      foot.appendChild(el("button", {
        class: "btn btn-primary",
        text: idx === slides.length - 1 ? "Comenzar" : "Siguiente",
        on: { click: () => {
          if (idx === slides.length - 1) { closeModal(modal); openHabitForm(); }
          else { idx += 1; render(); }
        } },
      }));
    };
    render();
  }

  // -------------------------------------------------------------- keyboard
  function keyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        openHabitForm();
      } else if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        navigate("#/stats");
      }
    });
  }

  // ------------------------------------------------------------------ init
  function refresh() {
    const h = lastRoute;
    if (h && h.route === "habit") renderHabit(h.param);
    else if (h && h.route === "identity") renderIdentity(h.param);
    else router();
  }

  async function init() {
    let cached = "light";
    try { cached = localStorage.getItem("habitfy_theme") || "light"; } catch (_) { /* ignore */ }
    applyTheme(cached);
    window.addEventListener("hashchange", router);
    router();
    keyboardShortcuts();
    scheduleReminders();
    document.getElementById("btn-new-habit").addEventListener("click", () => openHabitForm());
    try {
      const theme = await api.getTheme();
      applyTheme(theme.theme || "light");
    } catch (_) { /* ignore */ }
    try {
      const state = await api.state();
      showOnboardingIfNeeded(state);
    } catch (_) { /* ignore */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
