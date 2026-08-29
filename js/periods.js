/**
 * periods.js — Pure date helpers, JS port of core/periods.py.
 *
 * All functions work on native Date objects or ISO strings.
 * NO dependencies on Flask, SQLite, IndexedDB or any other module.
 *
 * Conventions:
 * - "Esta semana" = ISO week starting MONDAY.
 * - Day boundaries are local midnight.
 * - All comparisons happen on naive local datetimes.
 */

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const WEEKDAY_ISO = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
const ISO_NAMES   = { 1: "L", 2: "M", 3: "X", 4: "J", 5: "V", 6: "S", 7: "D" };

/* ------------------------------------------------------------------ */
/*  Basic building blocks                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse a local ISO datetime string into a Date.
 * Accepted formats:
 *   "YYYY-MM-DDTHH:MM:SS"
 *   "YYYY-MM-DD HH:MM:SS"
 *   "YYYY-MM-DDTHH:MM"
 *   "YYYY-MM-DD HH:MM"
 *   "YYYY-MM-DD"
 * A Date object is returned as-is (stripped of timezone).
 */
function parseDt(value) {
  if (value instanceof Date) {
    const d = new Date(value);
    d.setHours(d.getHours() - d.getTimezoneOffset() / 60, 0, 0, 0); // normalise to local
    return d;
  }

  const text = String(value).trim();
  const formats = [
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/,       // full
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,       // full space
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,               // no seconds
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/,               // no seconds space
    /^(\d{4})-(\d{2})-(\d{2})$/,                                // date only
  ];

  for (const re of formats) {
    const m = text.match(re);
    if (m) {
      const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
      const dt = new Date(+y, +mo - 1, +d, +h, +mi, +s);
      if (isNaN(dt.getTime())) throw new Error("Invalid datetime: " + value);
      return dt;
    }
  }

  // Fallback: try first 10 chars as date-only
  const fallback = text.slice(0, 10);
  const m = fallback.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const dt = new Date(+m[1], +m[2] - 1, +m[3]);
    if (!isNaN(dt.getTime())) return dt;
  }
  throw new Error("Invalid datetime: " + JSON.stringify(value));
}

/**
 * Convert value to a Date at local midnight (00:00:00).
 */
function toDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const text = String(value).trim().slice(0, 10);
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error("Invalid date: " + JSON.stringify(value));
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

/**
 * Monday 00:00 for the week containing day d.
 */
function startOfWeek(d) {
  const dt = toDate(d);
  // Python weekday(): Mon=0 … Sun=6
  // JS getDay():     Sun=0 … Sat=6
  const pyWeekday = (dt.getDay() + 6) % 7; // Mon=0, Sun=6
  dt.setDate(dt.getDate() - pyWeekday);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/**
 * Add whole days to a Date.
 */
function addDays(dt, days) {
  const result = new Date(dt);
  result.setDate(result.getDate() + days);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Named periods                                                     */
/* ------------------------------------------------------------------ */

function periodToday(now) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return [start, new Date(now)];
}

function periodThisWeek(now) {
  return [startOfWeek(now), new Date(now)];
}

function periodPreviousWeek(now) {
  const end   = startOfWeek(now);
  const start = addDays(end, -7);
  return [start, end];
}

function periodThisMonth(now) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return [start, new Date(now)];
}

function periodPreviousMonth(now) {
  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastPrev  = addDays(firstThis, -1);
  const start     = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
  return [start, firstThis];
}

function periodThisYear(now) {
  const start = new Date(now.getFullYear(), 0, 1);
  return [start, new Date(now)];
}

function periodLastDays(now, days) {
  const start = addDays(now, -days);
  return [start, new Date(now)];
}

function periodAll(now) {
  return [new Date(1970, 0, 1), new Date(now)];
}

function periodCustom(now, startDate, endDate) {
  const start   = toDate(startDate);
  const endBase = toDate(endDate);
  // Set to 23:59:59.999 of end date
  const end = new Date(
    endBase.getFullYear(), endBase.getMonth(), endBase.getDate(),
    23, 59, 59, 999
  );
  if (end > now) end.setTime(now.getTime());
  return [start, end];
}

/**
 * Return [start, end] for a named period.
 * Valid names: today, this_week, prev_week, this_month, prev_month,
 *              this_year, last7, last30, last90, all, custom.
 */
function getPeriod(name, now, startDate, endDate) {
  const dispatch = {
    today:      () => periodToday(now),
    this_week:  () => periodThisWeek(now),
    prev_week:  () => periodPreviousWeek(now),
    this_month: () => periodThisMonth(now),
    prev_month: () => periodPreviousMonth(now),
    this_year:  () => periodThisYear(now),
    last7:      () => periodLastDays(now, 7),
    last30:     () => periodLastDays(now, 30),
    last90:     () => periodLastDays(now, 90),
    all:        () => periodAll(now),
    custom:     () => periodCustom(now, startDate, endDate),
  };
  const fn = dispatch[name];
  if (!fn) throw new Error("Unknown period: " + name);
  return fn();
}

/* ------------------------------------------------------------------ */
/*  Week / month arithmetic for charts                                 */
/* ------------------------------------------------------------------ */

/**
 * Number of ISO weeks spanned between start_date and now (>= 1).
 */
function weeksSince(startDate, now) {
  const start = startOfWeek(startDate);
  const diffMs = now.getTime() - start.getTime();
  const days = Math.floor(diffMs / 86400000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

/**
 * Number of complete or partial weeks elapsed since start (>= 1).
 */
function weeksElapsed(startDate, now) {
  const start = toDate(startDate);
  const today = toDate(now);
  const diffMs = today.getTime() - start.getTime();
  const days = Math.floor(diffMs / 86400000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

/**
 * Number of complete or partial months elapsed since start (>= 1).
 */
function monthsElapsed(startDate, now) {
  const start = toDate(startDate);
  const today = toDate(now);
  const months = (today.getFullYear() - start.getFullYear()) * 12
               + (today.getMonth() - start.getMonth());
  return Math.max(1, months + 1);
}

/**
 * Return [{label, start, end}] for each week bucket since start.
 * Labels are "DD/MM".
 */
function weekBuckets(startDate, now) {
  const firstMonday = startOfWeek(startDate);
  const lastMonday  = startOfWeek(now);
  const buckets = [];
  const cursor = new Date(firstMonday);
  while (cursor <= lastMonday) {
    const end   = addDays(cursor, 7);
    const label = pad(cursor.getDate()) + "/" + pad(cursor.getMonth() + 1);
    buckets.push({ label, start: new Date(cursor), end });
    cursor.setTime(end.getTime());
  }
  return buckets;
}

/**
 * Return [{label, start, end}] for each month bucket since start.
 * Labels are "YYYY-MM".
 */
function monthBuckets(startDate, now) {
  const start = toDate(startDate);
  const today = toDate(now);
  let y = start.getFullYear();
  let m = start.getMonth() + 1; // 1-based
  const buckets = [];
  while (y < today.getFullYear() || (y === today.getFullYear() && m <= today.getMonth() + 1)) {
    const begin = new Date(y, m - 1, 1);
    const end   = m === 12 ? new Date(y + 1, 0, 1) : new Date(y, m, 1);
    buckets.push({
      label: y + "-" + pad(m),
      start: begin,
      end,
    });
    m++;
    if (m === 13) { m = 1; y++; }
  }
  return buckets;
}

/**
 * Return [{label, start, end}] for each of the last N days.
 * Labels are "DD/MM".
 */
function dayBuckets(startDate, now, days) {
  days = days || 30;
  const today = toDate(now);
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d     = addDays(today, -i);
    const begin = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end   = addDays(begin, 1);
    buckets.push({
      label: pad(d.getDate()) + "/" + pad(d.getMonth() + 1),
      start: begin,
      end,
    });
  }
  return buckets;
}

/**
 * Days of the current year as list of Dates, grouped by ISO week.
 * Grid starts from the Monday on/before Jan 1.
 */
function calendarYearDays(now) {
  const year      = now.getFullYear();
  const first     = new Date(year, 0, 1);
  const last      = new Date(year, 11, 31);
  const firstIsoDow = first.getDay() === 0 ? 7 : first.getDay(); // 1..7
  const gridStart = addDays(first, -(firstIsoDow - 1));
  const days = [];
  const d = new Date(gridStart);
  while (d <= last) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/**
 * All dates of a month (0 = current month, 1 = previous, …).
 * Returns { days: Date[], start: Date, end: Date }.
 */
function previousMonthDays(now, monthsBack) {
  monthsBack = monthsBack || 0;
  let year  = now.getFullYear();
  let month = now.getMonth() + 1; // 1-based
  for (let i = 0; i < monthsBack; i++) {
    month--;
    if (month === 0) { month = 12; year--; }
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  const start = new Date(year, month - 1, 1);
  const end   = month === 12
    ? new Date(year + 1, 0, 0)   // last day of Dec = Dec 31
    : new Date(year, month, 0);  // last day of month
  const days = [];
  for (let i = 0; i < daysInMonth; i++) {
    days.push(addDays(start, i));
  }
  return { days, start, end };
}

/* ------------------------------------------------------------------ */
/*  Weekday helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * ISO weekday number to short name (1="L" … 7="D").
 */
function weekdayName(iso) {
  return ISO_NAMES[iso] || "?";
}

/**
 * ISO weekday of a Date (1=Monday … 7=Sunday).
 */
function isoWeekday(dt) {
  const d = toDate(dt);
  return d.getDay() === 0 ? 7 : d.getDay();
}

/**
 * Next occurrence of a weekday at hour:minute, strictly after now_dt.
 * If now_dt is that weekday and already at/past the time, result is +7 days.
 */
function nextWeekdayAt(nowDt, isoWd, hour, minute) {
  const jsDay = isoWd === 7 ? 0 : isoWd; // ISO 7 (Sun) → JS 0
  let daysAhead = (jsDay - nowDt.getDay() + 7) % 7;
  if (daysAhead === 0) {
    const curTime = [nowDt.getHours(), nowDt.getMinutes(), nowDt.getSeconds()];
    if (curTime[0] > hour || (curTime[0] === hour && (curTime[1] > minute || (curTime[1] === minute && curTime[2] > 0)))) {
      daysAhead = 7;
    }
  }
  const target = new Date(nowDt);
  target.setDate(target.getDate() + daysAhead);
  target.setHours(hour, minute, 0, 0);
  return target;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                  */
/* ------------------------------------------------------------------ */

/** Zero-pad a number to 2 digits. */
function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

// Export as an IIFE to avoid polluting global scope
const periods = (() => {
  return {
    // Constants
    WEEKDAY_ISO,
    ISO_NAMES,

    // Building blocks
    parseDt,
    toDate,
    startOfWeek,
    addDays,

    // Named periods
    periodToday,
    periodThisWeek,
    periodPreviousWeek,
    periodThisMonth,
    periodPreviousMonth,
    periodThisYear,
    periodLastDays,
    periodAll,
    periodCustom,
    getPeriod,

    // Arithmetic
    weeksSince,
    weeksElapsed,
    monthsElapsed,

    // Buckets
    weekBuckets,
    monthBuckets,
    dayBuckets,

    // Calendar
    calendarYearDays,
    previousMonthDays,

    // Weekday helpers
    weekdayName,
    isoWeekday,
    nextWeekdayAt,
  };
})();
