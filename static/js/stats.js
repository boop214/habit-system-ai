/**
 * stats.js — Statistics, trends and insights. JS port of core/stats.py.
 *
 * Pure functions: receive events/habits/now as arguments and return results.
 * Depends on periods.js for date helpers — NOT on Flask, SQLite, IndexedDB, or db.js.
 */

/* ------------------------------------------------------------------ */
/*  Counting helpers                                                  */
/* ------------------------------------------------------------------ */

function eventDt(event) {
  return periods.parseDt(event.occurred_at);
}

function countIn(events, start, end) {
  let n = 0;
  for (const e of events) {
    const d = eventDt(e);
    if (d >= start && d < end) n++;
  }
  return n;
}

function countOnDate(events, day) {
  const d = periods.toDate(day);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end   = new Date(start); end.setDate(end.getDate() + 1);
  return countIn(events, start, end);
}

function valueSumIn(events, start, end) {
  let s = 0;
  for (const e of events) {
    if (eventDt(e) >= start && eventDt(e) < end) s += (e.value || 0);
  }
  return s;
}

function countByDay(events) {
  const out = {};
  for (const e of events) {
    const d = eventDt(e);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function weeklyCounts(events, startDate, now, weeks) {
  weeks = weeks || 12;
  const buckets = periods.weekBuckets(startDate, now).slice(-weeks);
  return buckets.map(b => ({ label: b.label, start: b.start, end: b.end, count: countIn(events, b.start, b.end) }));
}

function monthlyCounts(events, startDate, now) {
  const buckets = periods.monthBuckets(startDate, now);
  return buckets.map(b => ({ label: b.label, start: b.start, end: b.end, count: countIn(events, b.start, b.end) }));
}

function dailyCounts(events, startDate, now, days) {
  days = days || 30;
  const buckets = periods.dayBuckets(startDate, now, days);
  return buckets.map(b => ({ label: b.label, start: b.start, end: b.end, count: countIn(events, b.start, b.end) }));
}

function weeklyAverage(events, startDate, now, weeks) {
  let buckets = periods.weekBuckets(startDate, now);
  if (weeks) buckets = buckets.slice(-weeks);
  if (!buckets.length) return 0.0;
  let total = 0;
  for (const b of buckets) total += countIn(events, b.start, b.end);
  return total / buckets.length;
}

function monthlyAverage(events, startDate, now) {
  const buckets = periods.monthBuckets(startDate, now);
  if (!buckets.length) return 0.0;
  let total = 0;
  for (const b of buckets) total += countIn(events, b.start, b.end);
  return total / buckets.length;
}

function activeDays(events) {
  return Object.keys(countByDay(events)).length;
}

function bestWeek(events, startDate, now) {
  const buckets = periods.weekBuckets(startDate, now);
  if (!buckets.length) return 0;
  let mx = 0;
  for (const b of buckets) {
    const c = countIn(events, b.start, b.end);
    if (c > mx) mx = c;
  }
  return mx;
}

/* ------------------------------------------------------------------ */
/*  Trend                                                             */
/* ------------------------------------------------------------------ */

function trend(events, startDate, now, window) {
  window = window || 4;
  const buckets = periods.weekBuckets(startDate, now);
  if (buckets.length < 3) return { direction: "stable", recent: 0.0, previous: 0.0 };

  const recent    = buckets.slice(-window);
  const previous  = buckets.slice(-2 * window, -window);

  if (!previous.length) return { direction: "stable", recent: 0.0, previous: 0.0 };

  let recentTotal = 0;
  for (const b of recent) recentTotal += countIn(events, b.start, b.end);
  let prevTotal = 0;
  for (const b of previous) prevTotal += countIn(events, b.start, b.end);

  const recentAvg = recentTotal / recent.length;
  const prevAvg   = prevTotal / previous.length;
  const diff      = recentAvg - prevAvg;

  let direction;
  if (diff >= 0.5)      direction = "up";
  else if (diff <= -0.5) direction = "down";
  else                    direction = "stable";

  return { direction, recent: recentAvg, previous: prevAvg, diff };
}

/* ------------------------------------------------------------------ */
/*  Goals (frequency-aware)                                           */
/* ------------------------------------------------------------------ */

function periodTarget(habit) {
  const ft      = habit.frequency_type || "weekly";
  const ftarget = habit.frequency_target || 0;
  if (ft === "daily")        return { period: "day",   target: Math.floor(ftarget) };
  if (ft === "monthly")      return { period: "month", target: Math.floor(ftarget) };
  if (ft === "specific_days") return { period: "week",  target: Math.max(1, (habit.frequency_days || []).length) };
  return { period: "week", target: Math.floor(ftarget) };
}

function weekGoalStatus(habit, events, now) {
  const { period, target } = periodTarget(habit);

  const [ws] = periods.periodThisWeek(now);
  const [ps, pe] = periods.periodPreviousWeek(now);
  const thisWeek  = countIn(events, ws, now);
  const prevWeek  = countIn(events, ps, pe);

  let periodCount;
  if (period === "day") {
    const [todayStart] = periods.periodToday(now);
    periodCount = countIn(events, todayStart, now);
  } else if (period === "month") {
    const [monthStart] = periods.periodThisMonth(now);
    periodCount = countIn(events, monthStart, now);
  } else {
    periodCount = thisWeek;
  }

  const percent = target ? Math.round((periodCount / target) * 100) : null;

  return {
    period,
    target,
    period_count: periodCount,
    period_percent: percent,
    period_achieved: target > 0 && periodCount >= target,
    period_remaining: target ? Math.max(0, target - periodCount) : 0,
    this_week: thisWeek,
    prev_week: prevWeek,
    weekly_target: period === "day" ? 7 * target : target,
    achieved: target > 0 && periodCount >= target,
    percent,
    remaining: target ? Math.max(0, target - periodCount) : 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Full habit statistics                                             */
/* ------------------------------------------------------------------ */

function habitStats(habit, events, now) {
  const startDate = habit.start_date || "1970-01-01";

  const [ws] = periods.periodThisWeek(now);
  const [ps, pe] = periods.periodPreviousWeek(now);
  const [ms] = periods.periodThisMonth(now);
  const [pms, pme] = periods.periodPreviousMonth(now);
  const [ys] = periods.periodThisYear(now);
  const [todayStart] = periods.periodToday(now);

  const total       = events.length;
  const thisWeek    = countIn(events, ws, now);
  const prevWeek    = countIn(events, ps, pe);
  const thisMonth   = countIn(events, ms, now);
  const prevMonth   = countIn(events, pms, pme);
  const thisYear    = countIn(events, ys, now);
  const todayCount  = countIn(events, todayStart, now);

  const weekAvgAll   = weeklyAverage(events, startDate, now);
  const weekAvgLast4 = weeklyAverage(events, startDate, now, 4);
  const monthAvg     = monthlyAverage(events, startDate, now);
  const active       = activeDays(events);
  const best         = bestWeek(events, startDate, now);
  const tr           = trend(events, startDate, now);
  const goal         = weekGoalStatus(habit, events, now);

  return {
    total,
    today_count: todayCount,
    this_week: thisWeek,
    prev_week: prevWeek,
    this_month: thisMonth,
    prev_month: prevMonth,
    this_year: thisYear,
    week_average:      Math.round(weekAvgAll   * 10) / 10,
    week_average_last4: Math.round(weekAvgLast4 * 10) / 10,
    month_average:     Math.round(monthAvg     * 10) / 10,
    active_days: active,
    best_week: best,
    trend: tr,
    goal,
    weeks_since_start: periods.weeksElapsed(startDate, now),
    months_since_start: periods.monthsElapsed(startDate, now),
  };
}

/* ------------------------------------------------------------------ */
/*  Streaks                                                           */
/* ------------------------------------------------------------------ */

function consistencyStreak(habit, events, now, lookback) {
  lookback = lookback || 120;
  const { period, target } = periodTarget(habit);
  if (target <= 0) return 0;

  const startDate = habit.start_date || "1970-01-01";
  let buckets;
  if (period === "day") {
    buckets = periods.dayBuckets(startDate, now, lookback);
  } else if (period === "month") {
    buckets = periods.monthBuckets(startDate, now).slice(-lookback);
  } else {
    buckets = periods.weekBuckets(startDate, now).slice(-lookback);
  }

  const counts = buckets.map(b => countIn(events, b.start, b.end));
  let streak = 0;
  let idx = counts.length - 1;
  if (counts.length && counts[counts.length - 1] < target) idx--;
  while (idx >= 0 && counts[idx] >= target) {
    streak++;
    idx--;
  }
  return streak;
}

/* ------------------------------------------------------------------ */
/*  Time / weekday profiles                                           */
/* ------------------------------------------------------------------ */

function hourProfile(events, bucket) {
  bucket = bucket || 3;
  const out = {};
  for (let h = 0; h < 24; h += bucket) out[h] = 0;
  for (const e of events) {
    const h = eventDt(e).getHours();
    const key = Math.floor(h / bucket) * bucket;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function weekdayProfile(events) {
  const out = {};
  for (let i = 1; i <= 7; i++) out[i] = 0;
  for (const e of events) {
    const d = eventDt(e);
    const iso = d.getDay() === 0 ? 7 : d.getDay();
    out[iso] = (out[iso] || 0) + 1;
  }
  return out;
}

function mostFrequentHour(events) {
  if (!events.length) return null;
  const prof = hourProfile(events);
  let topH = 0, topN = 0;
  for (const [h, n] of Object.entries(prof)) {
    if (n > topN) { topN = n; topH = +h; }
  }
  return [topH, topN, events.length];
}

/* ------------------------------------------------------------------ */
/*  Insights & suggestions                                            */
/* ------------------------------------------------------------------ */

function insights(habit, events, now) {
  const out = [];
  const target = habit.frequency_target || 0;
  const total  = events.length;
  if (total === 0) return out;

  // 1. Main time of day
  const top = mostFrequentHour(events);
  if (top && top[1] >= 4 && top[1] / total >= 0.4) {
    const h = top[0];
    out.push("Realizas este h\u00e1bito principalmente entre las "
      + String(h).padStart(2, "0") + ":00 y las "
      + String(h + 2).padStart(2, "0") + ":59.");
  }

  // 2. Weekly frequency
  const startDate = habit.start_date || "1970-01-01";
  const nWeeks = periods.weeksElapsed(startDate, now);
  if (nWeeks >= 2 && total >= 4) {
    const avg = weeklyAverage(events, startDate, now);
    out.push("Tu frecuencia media es de " + avg.toFixed(1) + " veces por semana.");
  }

  // 3. Objective beaten repeatedly
  const { period, target: pTarget } = periodTarget(habit);
  if (pTarget > 0) {
    if (period === "day") {
      const last7 = periods.dayBuckets(startDate, now, 7);
      let recentDays = last7;
      if (last7.length && countIn(events, last7[last7.length - 1].start, last7[last7.length - 1].end) < pTarget) {
        recentDays = last7.slice(0, -1);
      }
      recentDays = recentDays.filter(b => b.end <= now);
      if (recentDays.length >= 3 && recentDays.slice(-3).every(b => countIn(events, b.start, b.end) >= pTarget)) {
        out.push("Los \u00faltimos d\u00edas has superado tu objetivo diario.");
      }
    } else {
      const last3 = periods.weekBuckets(startDate, now).slice(-3);
      if (last3.length) {
        const last = last3[last3.length - 1];
        let completed = last3;
        if (countIn(events, last.start, last.end) < pTarget) completed = last3.slice(0, -1);
        if (completed.length >= 3 && completed.every(b => countIn(events, b.start, b.end) >= pTarget)) {
          out.push("Las \u00faltimas 3 semanas has superado tu objetivo.");
        }
      }
    }
  }

  // 4. Weekday pattern
  const wprof = weekdayProfile(events);
  if (total >= 8) {
    const vals = Object.values(wprof);
    const high = Math.max(...vals);
    const low  = Math.min(...vals);
    if (high >= 2 && low <= high * 0.4) {
      let lowDay = 1;
      for (const [d, v] of Object.entries(wprof)) {
        if (v === low) { lowDay = +d; break; }
      }
      const pct = Math.round((1 - low / high) * 100);
      out.push("Los " + periods.weekdayName(lowDay)
        + " realizas este h\u00e1bito un " + pct + "% menos que en tu d\u00eda m\u00e1s activo.");
    }
  }

  // 5. Inactivity (gentle nudge)
  const startWeek = periods.startOfWeek(now);
  const fiveDaysAgo = periods.addDays(now, -5);
  if (total > 0 && !events.some(e => {
    const d = eventDt(e);
    return d >= fiveDaysAgo && d < startWeek;
  })) {
    out.push("No has registrado actividad en los \u00faltimos d\u00edas. \u00bfQuieres revisar el objetivo?");
  }

  // 6. Record week
  const best = bestWeek(events, startDate, now);
  if (best >= 3) {
    const last12 = periods.weekBuckets(startDate, now).slice(-12);
    const maxLast12 = Math.max(...last12.map(b => countIn(events, b.start, b.end)));
    if (best === maxLast12) {
      out.push("Nuevo r\u00e9cord personal: " + best + " sesiones en una semana.");
    }
  }

  return out;
}

function goalSuggestion(habit, events, now) {
  const { period, target } = periodTarget(habit);
  if (target <= 0) return null;
  const startDate = habit.start_date || "1970-01-01";

  function build(kind, message, suggestedTarget) {
    return { kind, message, suggested_target: suggestedTarget };
  }

  if (period === "day") {
    const buckets = periods.dayBuckets(startDate, now, 14);
    const counts  = buckets.map(b => countIn(events, b.start, b.end));
    const recent  = counts.slice(-7);
    if (recent.length < 5) return null;
    const avg = recent.reduce((a, b) => a + b, 0) / 7;
    if (avg >= target + 1 && recent.filter(c => c >= target).length >= 4) {
      const suggested = Math.max(target + 1, Math.round(avg));
      return build("increase",
        "Tu objetivo era " + target + " " + pluralOf("vez", target) + " al d\u00eda y has conseguido una media de "
        + avg.toFixed(1) + " en los \u00faltimos 7 d\u00edas. \u00bfQuieres subirlo a " + suggested + "?",
        suggested);
    }
    if (recent.every(c => c < target) && recent.reduce((a, b) => a + b, 0) / 7 < target * 0.6) {
      const suggested = Math.max(1, Math.round(recent.reduce((a, b) => a + b, 0) / 7));
      if (suggested < target) {
        return build("decrease",
          "Los \u00faltimos d\u00edas has estado por debajo del objetivo de " + target + " al d\u00eda. "
          + "\u00bfQuieres reducirlo temporalmente a " + suggested + "?",
          suggested);
      }
    }
    return null;
  }

  if (period === "month") {
    const buckets = periods.monthBuckets(startDate, now);
    const counts  = buckets.map(b => countIn(events, b.start, b.end));
    if (counts.length < 3) return null;
    const recent3 = counts.slice(-3);
    const avg = recent3.reduce((a, b) => a + b, 0) / 3;
    if (avg >= target + 1 && recent3.filter(c => c >= target).length >= 2) {
      const suggested = Math.max(target + 1, Math.round(avg));
      return build("increase",
        "Tu objetivo era " + target + " " + pluralOf("vez", target) + " al mes y has conseguido una media de "
        + avg.toFixed(1) + " en los \u00faltimos 3 meses. \u00bfQuieres subirlo a " + suggested + "?",
        suggested);
    }
    if (recent3.every(c => c < target) && avg < target * 0.6) {
      const suggested = Math.max(1, Math.round(avg));
      if (suggested < target) {
        return build("decrease",
          "Llevas 3 meses por debajo del objetivo de " + target + " al mes. "
          + "\u00bfQuieres reducirlo temporalmente a " + suggested + "?",
          suggested);
      }
    }
    return null;
  }

  // week / specific_days
  if (periods.weeksElapsed(startDate, now) < 4) return null;

  const buckets = periods.weekBuckets(startDate, now);
  const counts  = buckets.map(b => countIn(events, b.start, b.end));
  const recent4 = counts.slice(-4);
  const avg4 = recent4.reduce((a, b) => a + b, 0) / 4;

  if (avg4 >= target + 1 && recent4.filter(c => c >= target).length >= 3) {
    const suggested = Math.max(target + 1, Math.round(avg4));
    return build("increase",
      "Tu objetivo era " + target + " " + pluralOf("vez", target) + " por semana y has conseguido una media de "
      + avg4.toFixed(1) + " en las \u00faltimas 4 semanas. \u00bfQuieres subirlo a " + suggested + "?",
      suggested);
  }

  let completed = counts;
  if (counts.length && counts[counts.length - 1] < target) completed = counts.slice(0, -1);
  const recent3 = completed.slice(-3);
  if (recent3.length >= 3 && recent3.every(c => c < target)
      && recent3.reduce((a, b) => a + b, 0) / 3 < target * 0.8) {
    const suggested = Math.max(1, Math.round(recent3.reduce((a, b) => a + b, 0) / 3));
    if (suggested < target) {
      return build("decrease",
        "Llevas 3 semanas por debajo del objetivo de " + target + " " + pluralOf("vez", target) + " por semana. "
        + "\u00bfQuieres reducirlo temporalmente a " + suggested + "?",
        suggested);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Text helpers                                                      */
/* ------------------------------------------------------------------ */

function pluralOf(word, n) {
  return n === 1 ? word : word + "es";
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                */
/* ------------------------------------------------------------------ */

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return "";
  minutes = Math.floor(minutes);
  if (minutes < 60) return minutes + " min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h + " h";
  return h + " h " + m + " min";
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

const stats = (() => ({
  // Counting
  eventDt,
  countIn,
  countOnDate,
  valueSumIn,
  countByDay,
  weeklyCounts,
  monthlyCounts,
  dailyCounts,
  weeklyAverage,
  monthlyAverage,
  activeDays,
  bestWeek,

  // Trend
  trend,

  // Goals
  periodTarget,
  weekGoalStatus,

  // Full stats
  habitStats,

  // Streaks
  consistencyStreak,

  // Profiles
  hourProfile,
  weekdayProfile,
  mostFrequentHour,

  // Insights
  insights,
  goalSuggestion,

  // Text
  pluralOf,
  formatDuration,
}))();
