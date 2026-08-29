/* Date / number formatting helpers (Spanish locale). */
const fmt = (() => {
  const dayNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const shortDays = ["D", "L", "M", "X", "J", "V", "S"];
  const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function parseLocal(value) {
    // value: "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD" (local, no timezone conversion)
    if (value instanceof Date) return value;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value || "");
    if (!m) return new Date(NaN);
    return new Date(
      +m[1], +m[2] - 1, +m[3],
      m[4] ? +m[4] : 0,
      m[5] ? +m[5] : 0,
      m[6] ? +m[6] : 0
    );
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 6) return "Buenas noches";
    if (h < 13) return "Buenos días";
    if (h < 21) return "Buenas tardes";
    return "Buenas noches";
  }

  function longDate(d) {
    return `${dayNames[d.getDay()]}, ${d.getDate()} de ${monthNames[d.getMonth()]}`;
  }

  function weekdayLabel(d) {
    return shortDays[d.getDay()];
  }

  function dayShort(d) {
    return `${d.getDate()} ${monthNames[d.getMonth()].slice(0, 3)}`;
  }

  function timeHM(d) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function relativeDay(d, today) {
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.round((a - b) / 86400000);
    if (diff === 0) return "Hoy";
    if (diff === -1) return "Ayer";
    if (diff === 1) return "Mañana";
    return `${a.getDate()} ${monthNames[a.getMonth()].slice(0, 3)}`;
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  function percent(n) {
    return `${Math.round(n)}%`;
  }

  function toISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function toISODatetime(d) {
    return `${toISODate(d)}T${timeHM(d)}`;
  }

  function startOfWeek(d) {
    const out = new Date(d);
    const day = (out.getDay() + 6) % 7; // 0 = Monday
    out.setDate(out.getDate() - day);
    out.setHours(0, 0, 0, 0);
    return out;
  }

  function isToday(d) {
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  function isSameDate(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function formatDuration(minutes) {
    if (minutes == null) return "";
    minutes = Math.round(minutes);
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }

  function formatValue(value, unit, type) {
    const n = Number(value);
    if (type === "duration") return formatDuration(n);
    if (type === "boolean") return "1";
    if (unit) return `${n} ${unit}`;
    return `${n}`;
  }

  return {
    parseLocal, greeting, longDate, weekdayLabel, dayShort, timeHM,
    relativeDay, plural, percent, toISODate, toISODatetime, startOfWeek,
    isToday, isSameDate, formatDuration, formatValue, monthNames,
  };
})();