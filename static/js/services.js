/**
 * services.js — Application service layer.
 *
 * Sits between app.js (UI) and db.js (persistence).
 * Handles business logic orchestration: computes stats, builds responses,
 * manages complex operations that span multiple data stores.
 *
 * Depends on: db.js, periods.js, stats.js, obstacles.js, identity.js, seed.js, semantics.js
 * NO dependency on Flask or SQLite.
 */

const services = (() => {
  const NOW = () => new Date();

  function _today() {
    const d = NOW();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function _habitSummary(habit, events, nowDt) {
    const goal = stats.weekGoalStatus(habit, events, nowDt);
    const start = habit.start_date || "1970-01-01";
    const [todayStart] = periods.periodToday(nowDt);
    return {
      ...habit,
      goal,
      today_count: stats.countIn(events, todayStart, nowDt),
      total: events.length,
      friction: identity.frictionStatus(habit, events, nowDt),
    };
  }

  function _habitSummaryLimited(habit, events, nowDt) {
    const s = _habitSummary(habit, events, nowDt);
    const st = stats.habitStats(habit, events, nowDt);
    return {
      ...s,
      stats: {
        this_week: st.this_week,
        prev_week: st.prev_week,
        this_month: st.this_month,
        total: st.total,
        week_average: st.week_average,
        week_average_last4: st.week_average_last4,
        best_week: st.best_week,
        active_days: st.active_days,
      },
    };
  }

  /* ---- State ---- */

  async function state() {
    const habits = await habitDB.listHabits();
    const identities = await habitDB.listIdentities();
    return {
      has_habits: habits.length > 0,
      has_demo: habits.some(h => h.is_demo),
      has_identities: identities.length > 0,
    };
  }

  /* ---- Habits CRUD ---- */

  async function listHabits() {
    const habits = await habitDB.listHabits();
    const nowDt = NOW();
    const active = habits.filter(h => h.active);
    const results = [];
    for (const h of active) {
      const events = await habitDB.listEvents(h.id);
      results.push(_habitSummary(h, events, nowDt));
    }
    return results;
  }

  async function getHabit(id) {
    const habit = await habitDB.getHabit(id);
    if (!habit) throw new Error("Hábito no encontrado.");
    const nowDt = NOW();
    const events = (await habitDB.listEvents(id)).sort((a, b) => (b.occurred_at || "").localeCompare(a.occurred_at || ""));
    const allEvents = events.slice().reverse();
    const startDate = habit.start_date || "1970-01-01";
    const identities = await habitDB.listIdentities();
    const links = await habitDB.listIdentityLinks(id);
    const linkedIds = new Set(links.filter(l => l.status === "linked").map(l => l.identity_id));
    const obstacleCounts = await habitDB.obstacleCounts(id);
    const mainObstacle = await habitDB.mainObstacle(id);

    let semanticSuggestion = null;
    const topSuggestions = semantics.suggestIdentityForHabit(habit, identities, links, 0.45);
    if (topSuggestions.length) semanticSuggestion = topSuggestions[0];

    const identityLinks = links.filter(l => l.status === "linked").map(l => {
      const ident = identities.find(i => i.id === l.identity_id);
      return { ...l, identity: ident ? { id: ident.id, name: ident.name, icon: ident.icon, color: ident.color } : null };
    });

    return {
      ..._habitSummary(habit, allEvents, nowDt),
      stats: stats.habitStats(habit, allEvents, nowDt),
      streak: stats.consistencyStreak(habit, allEvents, nowDt),
      events,
      insights: stats.insights(habit, allEvents, nowDt),
      suggestion: stats.goalSuggestion(habit, allEvents, nowDt),
      obstacle_counts: obstacleCounts,
      main_obstacle: mainObstacle,
      identity_links: identityLinks,
      semantic_suggestion: semanticSuggestion,
      charts: {
        weekly: stats.weeklyCounts(allEvents, startDate, nowDt),
        monthly: stats.monthlyCounts(allEvents, startDate, nowDt),
        daily: stats.dailyCounts(allEvents, startDate, nowDt),
        year_days: periods.calendarYearDays(nowDt).map(d => {
          const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
          return { date: key, count: stats.countOnDate(allEvents, d) };
        }),
      },
    };
  }

  async function createHabit(body) {
    return habitDB.createHabit(body);
  }

  async function updateHabit(id, body) {
    return habitDB.updateHabit(id, body);
  }

  async function deleteHabit(id) {
    return habitDB.deleteHabit(id);
  }

  /* ---- Events CRUD ---- */

  async function createEvent(habitId, body) {
    const { occurred_at, value, unit, duration, notes, is_demo, is_minimum } = body || {};
    return habitDB.createEvent(habitId, occurred_at, {
      value, unit, duration, notes, isDemo: is_demo, isMinimum: is_minimum,
    });
  }

  async function updateEvent(eventId, body) {
    return habitDB.updateEvent(eventId, body);
  }

  async function deleteEvent(eventId) {
    return habitDB.deleteEvent(eventId);
  }

  /* ---- Identities CRUD ---- */

  async function listIdentities() {
    return habitDB.listIdentities();
  }

  async function getIdentity(id) {
    const ident = await habitDB.getIdentity(id);
    if (!ident) throw new Error("Identidad no encontrada.");
    const nowDt = NOW();
    const votes = await identity.identityVotes(ident, nowDt);
    const allHabits = await habitDB.listHabits();
    const habitCount = allHabits.filter(h => h.identity_id === id && h.active).length;
    return { ...ident, votes, habit_count: habitCount };
  }

  async function createIdentity(body) {
    return habitDB.createIdentity(body);
  }

  async function updateIdentity(id, body) {
    return habitDB.updateIdentity(id, body);
  }

  async function deleteIdentity(id) {
    return habitDB.deleteIdentity(id);
  }

  /* ---- Obstacles ---- */

  async function createObstacle(habitId, body) {
    const habit = await habitDB.getHabit(habitId);
    if (!habit) throw new Error("Hábito no encontrado.");
    const obstacle = await habitDB.createObstacle(habitId, body.obstacle, body.note || null, body.type);
    const suggestion = obstacles.redesignSuggestion(habit, body.type);
    return { ...obstacle, suggestion };
  }

  /* ---- Identity Links ---- */

  async function setIdentityLink(habitId, body) {
    const existing = await habitDB.getIdentityLink(habitId, body.identity_id);
    if (existing) {
      return habitDB.updateIdentityLink(existing.id, { status: body.decision === "accept" ? "linked" : "rejected" });
    }
    return habitDB.createIdentityLink(habitId, body.identity_id, body.decision === "accept" ? "linked" : "rejected", body.source || "semantic", body.confidence || null);
  }

  async function removeIdentityLink(habitId, identityId) {
    const deleted = await habitDB.deleteIdentityLink(habitId, identityId);
    if (!deleted) throw new Error("Vínculo no encontrado.");
    return { ok: true };
  }

  /* ---- Notes ---- */

  async function getNote(date) {
    const note = await habitDB.getDailyNote(date);
    return { date, content: note ? note.content : "" };
  }

  async function saveNote(date, body) {
    await habitDB.saveDailyNote(date, body.content || "");
    return { ok: true };
  }

  async function noteDone(date, habitId) {
    const habit = await habitDB.getHabit(habitId);
    if (!habit) throw new Error("Hábito no encontrado.");
    const today = _today();
    const occurredAt = date === today
      ? NOW().getFullYear() + "-" + String(NOW().getMonth() + 1).padStart(2, "0") + "-" + String(NOW().getDate()).padStart(2, "0") + "T" + String(NOW().getHours()).padStart(2, "0") + ":" + String(NOW().getMinutes()).padStart(2, "0")
      : date + "T20:00";
    let value = 1, duration = null, unit = habit.unit || null;
    if (habit.type === "duration") { value = habit.target_value || 1; duration = value; }
    else if (habit.type === "sessions") { value = 1; duration = habit.target_value || null; }
    else if (habit.type === "boolean") { value = 1; }
    else { value = habit.target_value || 1; }
    return habitDB.createEvent(habitId, occurredAt, { value, unit, duration, isMinimum: false });
  }

  /* ---- Global Stats ---- */

  async function globalStats() {
    const nowDt = NOW();
    const habits = (await habitDB.listHabits()).filter(h => h.active);
    const identities = await habitDB.listIdentities();
    if (!habits.length) {
      return {
        total_habits: 0, active_habits: 0, week_realizations: 0,
        month_realizations: 0, total_realizations: 0, objectives_met: 0,
        positive_trend: 0, negative_trend: 0, weekly_chart: [],
        monthly_chart: [], by_habit: [], identities: [],
      };
    }

    // Pre-load all events once
    const eventsByHabit = {};
    for (const h of habits) {
      eventsByHabit[h.id] = await habitDB.listEvents(h.id);
    }

    let wTotal = 0, mTotal = 0, aTotal = 0;
    let objectivesMet = 0, positive = 0, negative = 0;
    const byHabit = [];

    for (const h of habits) {
      const events = eventsByHabit[h.id];
      const s = _habitSummaryLimited(h, events, nowDt);
      byHabit.push(s);
      const goal = stats.weekGoalStatus(h, events, nowDt);
      const st = stats.habitStats(h, events, nowDt);
      wTotal += goal.this_week;
      mTotal += st.this_month;
      aTotal += st.total;
      if (goal.achieved) objectivesMet++;
      if (s.stats && s.stats.trend) {
        if (s.stats.trend.direction === "up") positive++;
        else if (s.stats.trend.direction === "down") negative++;
      }
      // Update by_habit with proper stats
      s.stats.this_week = st.this_week;
      s.stats.prev_week = st.prev_week;
      s.stats.this_month = st.this_month;
      s.stats.total = st.total;
      s.stats.week_average = st.week_average;
      s.stats.week_average_last4 = st.week_average_last4;
      s.stats.best_week = st.best_week;
      s.stats.active_days = st.active_days;
    }

    // Weekly chart
    const firstHabitStart = habits.reduce((min, h) => {
      const sd = h.start_date || "1970-01-01";
      return sd < min ? sd : min;
    }, "9999-12-31");
    const weeklyBuckets = periods.weekBuckets(firstHabitStart, nowDt).slice(-12);
    const weeklyChart = [];
    for (const b of weeklyBuckets) {
      let count = 0;
      for (const h of habits) count += stats.countIn(eventsByHabit[h.id], b.start, b.end);
      weeklyChart.push({ label: b.label, count });
    }

    // Monthly chart
    const monthlyBuckets = periods.monthBuckets(firstHabitStart, nowDt);
    const monthlyChart = [];
    for (const b of monthlyBuckets) {
      let count = 0;
      for (const h of habits) count += stats.countIn(eventsByHabit[h.id], b.start, b.end);
      monthlyChart.push({ label: b.label, count });
    }

    // Identity summaries
    const identSummaries = [];
    const [ws] = periods.periodThisWeek(nowDt);
    for (const ident of identities) {
      let thisWeek = 0, total = 0;
      for (const h of habits) {
        if (h.identity_id !== ident.id) continue;
        const events = eventsByHabit[h.id];
        thisWeek += stats.countIn(events, ws, nowDt);
        total += events.length;
      }
      if (thisWeek > 0 || total > 0) identSummaries.push({ id: ident.id, name: ident.name, icon: ident.icon, color: ident.color, this_week: thisWeek, total });
    }

    return {
      total_habits: habits.length,
      active_habits: habits.length,
      week_realizations: wTotal,
      month_realizations: mTotal,
      total_realizations: aTotal,
      objectives_met: objectivesMet,
      positive_trend: positive,
      negative_trend: negative,
      weekly_chart: weeklyChart,
      monthly_chart: monthlyChart,
      by_habit: byHabit,
      identities: identSummaries,
    };
  }

  /* ---- Weekly Review ---- */

  async function weeklyReview() {
    const nowDt = NOW();
    const habits = (await habitDB.listHabits()).filter(h => h.active);
    habits.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    const [ws] = periods.startOfWeek(nowDt);
    const we = periods.addDays(ws, 7);
    const weekStart = ws.getFullYear() + "-" + String(ws.getMonth() + 1).padStart(2, "0") + "-" + String(ws.getDate()).padStart(2, "0");

    const rows = [];
    for (const h of habits) {
      const events = (await habitDB.listEvents(h.id)).sort((a, b) => (a.occurred_at || "").localeCompare(b.occurred_at || ""));
      rows.push({ habit: h, events, summary: _habitSummary(h, events, nowDt) });
    }

    const working = [];
    const difficult = [];
    for (const r of rows) {
      const g = r.summary.goal || {};
      if (g.achieved && (g.period_count || 0) > 0) working.push({ ...r.summary, week_count: g.period_count });
      else if (identity.frictionStatus(r.habit, r.events, nowDt)) difficult.push({ ...r.summary, week_count: g.this_week || 0 });
    }
    working.sort((a, b) => b.week_count - a.week_count);

    const allIdentities = await habitDB.listIdentities();
    const identResult = [];
    for (const ident of allIdentities) {
      const identHabits = (await habitDB.listHabits()).filter(h => h.identity_id === ident.id && h.active);
      let thisWeekCount = 0;
      for (const h of identHabits) {
        const evts = await habitDB.listEvents(h.id);
        thisWeekCount += stats.countIn(evts, ws, nowDt);
      }
      if (thisWeekCount > 0) identResult.push({ ...ident, this_week: thisWeekCount });
    }
    identResult.sort((a, b) => b.this_week - a.this_week);

    const cueCounts = {};
    const habitCues = [];
    for (const r of rows) {
      const cue = (r.habit.cue || "").trim();
      const weekCount = stats.countIn(r.events, ws, nowDt);
      if (cue && weekCount > 0) {
        cueCounts[cue] = (cueCounts[cue] || 0) + weekCount;
        habitCues.push([r.habit.name, cue, weekCount]);
      }
    }
    const patterns = [];
    if (Object.keys(cueCounts).length) {
      let topCue = "", topN = 0;
      for (const [cue, n] of Object.entries(cueCounts)) { if (n > topN) { topN = n; topCue = cue; } }
      patterns.push("La señal más frecuente esta semana ha sido \u00ab" + topCue + "\u00bb (" + topN + " registros).");
    }
    if (working.length) patterns.push("\u00ab" + working[0].name + "\u00bb ha sido el hábito más consistente esta semana (" + working[0].week_count + " acciones).");
    if (difficult.length) patterns.push("\u00ab" + difficult[0].name + "\u00bb parece estar costando. Puedes revisar el sistema para hacerlo más fácil.");

    const reviewAnswer = await habitDB.getReviewAnswer(weekStart);
    const schedule = await identity.reviewSchedule(nowDt);

    return {
      week_start: weekStart,
      working,
      difficult,
      identities: identResult,
      patterns,
      question_answer: reviewAnswer ? reviewAnswer.answer : null,
      total_actions: rows.reduce((sum, r) => sum + ((r.summary.goal || {}).this_week || 0), 0),
      schedule,
    };
  }

  /* ---- Settings ---- */

  async function saveReviewAnswer(body) {
    const nowDt = NOW();
    const [ws] = periods.startOfWeek(nowDt);
    const weekStart = ws.getFullYear() + "-" + String(ws.getMonth() + 1).padStart(2, "0") + "-" + String(ws.getDate()).padStart(2, "0");
    await habitDB.saveReviewAnswer(weekStart, body.answer);
    return { ok: true };
  }

  async function saveReviewSetting(body) {
    await habitDB.setSetting("review_sunday_time", body.time || "");
    return { ok: true };
  }

  async function getTheme() {
    const theme = await habitDB.getSetting("theme");
    return { theme: theme || "light" };
  }

  async function saveTheme(body) {
    const theme = String(body.theme || "light").trim().toLowerCase();
    if (!["light", "dark"].includes(theme)) throw new Error("Tema no válido.");
    await habitDB.setSetting("theme", theme);
    return { ok: true, theme };
  }

  /* ---- Demo / Reset ---- */

  async function loadDemo() {
    const created = await seed.createDemoData();
    return { created: created.length };
  }

  async function deleteDemo() {
    return habitDB.deleteDemoData();
  }

  async function resetAll() {
    await habitDB.resetAllData();
    return { reset: true };
  }

  /* ---- Feedback ---- */

  async function submitFeedback(body) {
    return habitDB.createFeedback(body);
  }

  return {
    state,
    listHabits,
    getHabit,
    createHabit,
    updateHabit,
    deleteHabit,
    createEvent,
    updateEvent,
    deleteEvent,
    listIdentities,
    getIdentity,
    createIdentity,
    updateIdentity,
    deleteIdentity,
    createObstacle,
    setIdentityLink,
    removeIdentityLink,
    getNote,
    saveNote,
    noteDone,
    globalStats,
    weeklyReview,
    saveReviewAnswer,
    saveReviewSetting,
    getTheme,
    saveTheme,
    loadDemo,
    deleteDemo,
    resetAll,
    submitFeedback,
  };
})();
