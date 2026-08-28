/**
 * identity.js — Identity aggregation, votes, weekly review. Port of core/identity.py.
 *
 * Depends on: periods.js, stats.js, habitDB (db.js) for persistence.
 * NO dependency on Flask or SQLite.
 */

const identity = (() => {

  function _plural(n, one, many) {
    return n === 1 ? one : many;
  }

  async function identityVotes(ident, nowDt) {
    const allHabits = await habitDB.listHabits();
    const identHabits = allHabits.filter(h => h.identity_id === ident.id && h.active);
    let events = [];
    for (const h of identHabits) {
      const hEvents = await habitDB.listEvents(h.id);
      events = events.concat(hEvents);
    }
    events.sort((a, b) => (a.occurred_at || "").localeCompare(b.occurred_at || ""));
    const [ws] = periods.periodThisWeek(nowDt);
    const [ms] = periods.periodThisMonth(nowDt);
    const startDate = "1970-01-01";
    return {
      this_week: stats.countIn(events, ws, nowDt),
      this_month: stats.countIn(events, ms, nowDt),
      total: events.length,
      week_average: Math.round(stats.weeklyAverage(events, startDate, nowDt) * 10) / 10,
      week_average_last4: Math.round(stats.weeklyAverage(events, startDate, nowDt, 4) * 10) / 10,
      active_days: stats.activeDays(events),
      best_week: stats.bestWeek(events, startDate, nowDt),
      trajectory: stats.weeklyCounts(events, startDate, nowDt, 12),
      trend: stats.trend(events, startDate, nowDt),
    };
  }

  function identityEvidence(votes) {
    const out = [];
    const total = votes.total;
    if (total === 0) {
      return ["Todavía no hay acciones registradas para esta identidad. Cada pequeña acción será un voto."];
    }
    out.push("Has realizado " + total + " " + _plural(total, "acción", "acciones") + " relacionadas con esta identidad.");
    out.push("Esta semana has actuado como esta persona " + votes.this_week + " " + _plural(votes.this_week, "vez", "veces") + ".");
    if (votes.week_average_last4 > 0) {
      out.push("En las últimas 4 semanas has mantenido una media de " + votes.week_average_last4 + " acciones por semana.");
    }
    const d = votes.trend.direction;
    if (d === "up") out.push("Tu frecuencia está aumentando: estás construyendo más evidencia cada semana.");
    else if (d === "down") out.push("El ritmo ha bajado un poco. Un periodo bajo no borra la evidencia ya construida.");
    return out;
  }

  async function identitySummary(ident, nowDt) {
    const votes = await identityVotes(ident, nowDt);
    const allHabits = await habitDB.listHabits();
    const habitCount = allHabits.filter(h => h.identity_id === ident.id && h.active).length;
    return { ...ident, votes, habit_count: habitCount };
  }

  async function habitsForIdentity(identityId) {
    const all = await habitDB.listHabits();
    return all
      .filter(h => h.identity_id === identityId && h.active)
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  }

  function frictionStatus(habit, events, nowDt) {
    const { period, target } = stats.periodTarget(habit);
    if (target <= 0) return null;
    const startDate = habit.start_date || "1970-01-01";
    if (period === "day") {
      const buckets = periods.dayBuckets(startDate, nowDt, 10);
      const counts = buckets.map(b => stats.countIn(events, b.start, b.end));
      const completed = (counts.length && counts[counts.length - 1] < target) ? counts.slice(0, -1) : counts;
      const recent = completed.slice(-4);
      const below = recent.filter(c => c < target).length;
      if (recent.length >= 3 && recent[recent.length - 1] < target && below >= 3)
        return { difficult: true, reason: "several_days", missed: below };
      return null;
    }
    const buckets = period === "month"
      ? periods.monthBuckets(startDate, nowDt)
      : periods.weekBuckets(startDate, nowDt);
    const counts = buckets.map(b => stats.countIn(events, b.start, b.end));
    const completed = (counts.length && counts[counts.length - 1] < target) ? counts.slice(0, -1) : counts;
    const recent = completed.slice(-3);
    const below = recent.filter(c => c < target).length;
    if (recent.length >= 2 && recent[recent.length - 1] < target && below >= 2)
      return { difficult: true, reason: "repeated_misses", missed: below };
    return null;
  }

  const REVIEW_DAY = 7;

  async function reviewSchedule(nowDt) {
    const raw = await habitDB.getSetting("review_sunday_time");
    if (!raw) return { enabled: false, day: REVIEW_DAY, time: null, open: false, next_at: null };
    let hour, minute;
    try {
      const parts = raw.split(":").map(Number);
      hour = parts[0]; minute = parts[1];
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error();
    } catch (_) {
      return { enabled: false, day: REVIEW_DAY, time: null, open: false, next_at: null };
    }
    const isoDay = nowDt.getDay() === 0 ? 7 : nowDt.getDay();
    const isSunday = isoDay === REVIEW_DAY;
    const openNow = isSunday && (nowDt.getHours() > hour || (nowDt.getHours() === hour && nowDt.getMinutes() >= minute));
    const nextAt = periods.nextWeekdayAt(nowDt, REVIEW_DAY, hour, minute);
    const pad2 = n => String(n).padStart(2, "0");
    return {
      enabled: true,
      day: REVIEW_DAY,
      time: pad2(hour) + ":" + pad2(minute),
      open: openNow,
      next_at: nextAt.getFullYear() + "-" + pad2(nextAt.getMonth() + 1) + "-" + pad2(nextAt.getDate()) + "T" + pad2(nextAt.getHours()) + ":" + pad2(nextAt.getMinutes()) + ":" + pad2(nextAt.getSeconds()),
    };
  }

  async function weeklyReview(nowDt, habitSummaryFn) {
    const habits = (await habitDB.listHabits()).filter(h => h.active);
    habits.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    const [ws] = periods.startOfWeek(nowDt);
    const we = periods.addDays(ws, 7);
    const weekStart = ws.getFullYear() + "-" + String(ws.getMonth() + 1).padStart(2, "0") + "-" + String(ws.getDate()).padStart(2, "0");
    const wsIso = weekStart + "T00:00";

    const rows = [];
    for (const h of habits) {
      const events = (await habitDB.listEvents(h.id)).sort((a, b) => (a.occurred_at || "").localeCompare(b.occurred_at || ""));
      rows.push({ habit: h, events, summary: habitSummaryFn(h) });
    }

    const working = [];
    const difficult = [];
    for (const r of rows) {
      const g = r.summary.goal || {};
      if (g.achieved && (g.period_count || 0) > 0) {
        working.push({ ...r.summary, week_count: g.period_count });
      } else if (frictionStatus(r.habit, r.events, nowDt)) {
        difficult.push({ ...r.summary, week_count: g.this_week || 0 });
      }
    }
    working.sort((a, b) => b.week_count - a.week_count);

    const identities = (await habitDB.listIdentities()).filter(i => i.active !== false);
    identities.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const identResult = [];
    for (const ident of identities) {
      const allHabitsForIdent = (await habitDB.listHabits()).filter(h => h.identity_id === ident.id && h.active);
      let thisWeekCount = 0;
      for (const h of allHabitsForIdent) {
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
      const names = habitCues.filter(([_, c]) => c === topCue).map(([n]) => n).join(", ");
      patterns.push("La señal más frecuente esta semana ha sido \u00ab" + topCue + "\u00bb (" + topN + " registros).");
    }
    if (working.length) {
      const top = working[0];
      patterns.push("\u00ab" + top.name + "\u00bb ha sido el hábito más consistente esta semana (" + top.week_count + " acciones).");
    }
    if (difficult.length) {
      patterns.push("\u00ab" + difficult[0].name + "\u00bb parece estar costando. Puedes revisar el sistema para hacerlo más fácil.");
    }

    const reviewAnswer = await habitDB.getReviewAnswer(weekStart);
    const answer = reviewAnswer ? reviewAnswer.answer : null;

    return {
      week_start: weekStart,
      working,
      difficult,
      identities: identResult,
      patterns,
      question_answer: answer,
      total_actions: rows.reduce((sum, r) => sum + (r.summary.goal || {}).this_week || 0, 0),
    };
  }

  return {
    _plural,
    identityVotes,
    identityEvidence,
    identitySummary,
    habitsForIdentity,
    frictionStatus,
    REVIEW_DAY,
    reviewSchedule,
    weeklyReview,
  };
})();
