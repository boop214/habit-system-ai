/* Lightweight SVG chart builders — no external dependencies. */
const charts = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const LEVEL_COLORS = ["#eef0f6", "#dbe7ff", "#9dbfff", "#4f7cff"];

  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function measureWidth(container) {
    const w = container.clientWidth;
    return w > 0 ? w : 600;
  }

  /* Vertical bar chart.
     items: [{label, count}]
     opts: { barColor, accentColor, average, valueFormatter }
  */
  function barChart(container, items, opts = {}) {
    clear(container);
    if (!items || items.length === 0) {
      container.appendChild(el("p", { class: "empty-line" }, "Sin datos suficientes."));
      return;
    }
    const W = measureWidth(container);
    const H = Math.max(170, Math.round(W * 0.42));
    const padL = 34, padR = 10, padT = 22, padB = 26;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const max = Math.max(1, ...items.map((d) => d.count));
    const n = items.length;
    const slot = chartW / n;
    const barW = Math.min(44, slot * 0.6);
    const color = opts.barColor || "#4f7cff";
    const accent = opts.accentColor || "#1d4ed8";

    const svg = svgEl("svg", {
      width: W, height: H, viewBox: `0 0 ${W} ${H}`,
      role: "img", "aria-label": opts.ariaLabel || "Gráfico de barras",
    }, container);

    // Grid lines + Y labels (integers)
    const steps = Math.min(4, max);
    for (let i = 0; i <= steps; i++) {
      const val = Math.round((max * i) / steps);
      const y = padT + chartH - (chartH * val) / max;
      svgEl("line", { x1: padL, y1: y, x2: W - padR, y2: y, stroke: "#e9ecf4", "stroke-width": 1 }, svg);
      svgEl("text", {
        x: padL - 6, y: y + 4, "text-anchor": "end", "font-size": 10, fill: "#9ca3af",
      }, svg).textContent = val;
    }

    // Average reference line
    if (opts.average != null && opts.average > 0) {
      const y = padT + chartH - (chartH * opts.average) / max;
      svgEl("line", {
        x1: padL, y1: y, x2: W - padR, y2: y,
        stroke: opts.averageColor || "#f59e0b", "stroke-width": 1.5,
        "stroke-dasharray": "5 4",
      }, svg);
      svgEl("text", {
        x: W - padR, y: y - 5, "text-anchor": "end", "font-size": 10,
        fill: opts.averageColor || "#b45309", "font-weight": 600,
      }, svg).textContent = `media ${opts.average}`;
    }

    // Bars
    items.forEach((d, i) => {
      const x = padL + slot * i + (slot - barW) / 2;
      const h = (chartH * d.count) / max;
      const y = padT + chartH - h;
      const last = i === n - 1;
      svgEl("rect", {
        x, y: h > 0 ? y : padT + chartH - 1, width: barW,
        height: Math.max(h, 1), rx: 4,
        fill: last ? accent : color, opacity: last ? 1 : 0.85,
      }, svg);
      if (d.count > 0) {
        svgEl("text", {
          x: x + barW / 2, y: y - 4, "text-anchor": "middle",
          "font-size": 10, fill: "#4b5563", "font-weight": 600,
        }, svg).textContent = d.count;
      }
      // X label (sample every few)
      const step = Math.max(1, Math.ceil(n / 12));
      if (i % step === 0 || i === n - 1) {
        svgEl("text", {
          x: x + barW / 2, y: H - 8, "text-anchor": "middle",
          "font-size": 9, fill: "#9ca3af",
        }, svg).textContent = d.label;
      }
    });
  }

  /* GitHub-style year heatmap.
     days: [{date: "YYYY-MM-DD", count}]
     Builds week columns starting Monday on/before Jan 1.
  */
  function heatmapYear(container, days, opts = {}) {
    clear(container);
    const countMap = new Map(days.map((d) => [d.date, d.count]));
    const now = new Date();
    const year = now.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const offset = (jan1.getDay() + 6) % 7; // days back to Monday
    const start = new Date(jan1);
    start.setDate(jan1.getDate() - offset);

    const cell = 13, gap = 3;
    const dayLabels = ["L", "M", "X", "J", "V", "S", "D"];
    const weeks = 53;
    const W = weeks * (cell + gap) + 24;
    const H = 7 * (cell + gap) + 24;
    const svg = svgEl("svg", {
      width: "100%", height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMinYMid meet",
      role: "img", "aria-label": opts.ariaLabel || "Mapa de calor anual",
    }, container);

    // Month labels
    for (let m = 0; m < 12; m++) {
      const first = new Date(year, m, 1);
      const weekIdx = Math.floor((first - start) / 86400000 / 7);
      const label = fmt.monthNames[m].slice(0, 3);
      svgEl("text", { x: 24 + weekIdx * (cell + gap), y: 11, "font-size": 9, fill: "#9ca3af" }, svg).textContent = label;
    }
    // Day labels
    dayLabels.forEach((l, i) => {
      svgEl("text", { x: 6, y: 24 + i * (cell + gap) + 9, "text-anchor": "end", "font-size": 8, fill: "#9ca3af" }, svg).textContent = l;
    });

    const values = days.filter((d) => d.count > 0).map((d) => d.count);
    const maxC = values.length ? Math.max(...values) : 0;

    for (let i = 0; i < weeks; i++) {
      for (let j = 0; j < 7; j++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i * 7 + j);
        if (d.getFullYear() !== year) continue;
        const key = fmt.toISODate(d);
        const count = countMap.get(key) || 0;
        const isFuture = d > new Date();
        const level = count === 0 ? 0 : count >= maxC ? 3 : count >= maxC / 2 ? 2 : 1;
        const rect = svgEl("rect", {
          x: 24 + i * (cell + gap),
          y: 18 + j * (cell + gap),
          width: cell, height: cell, rx: 3,
          fill: LEVEL_COLORS[level],
          opacity: isFuture ? 0.35 : 1,
        }, svg);
        if (count > 0) {
          rect.setAttribute("title", `${fmt.dayShort(d)}: ${count} ${count === 1 ? "realización" : "realizaciones"}`);
          rect.style.cursor = "help";
        }
      }
    }
  }

  /* Month calendar grid (HTML). Returns a DOM element.
     days: [{date: "YYYY-MM-DD", count}]
     month: Date object for the month to render.
  */
  function monthCalendar(month, days, opts = {}) {
    const countMap = new Map(days.map((d) => [d.date, d.count]));
    const year = month.getFullYear();
    const mon = month.getMonth();
    const first = new Date(year, mon, 1);
    const last = new Date(year, mon + 1, 0);
    const lead = (first.getDay() + 6) % 7;
    const grid = el("div", { class: "cal-grid" });

    ["L", "M", "X", "J", "V", "S", "D"].forEach((l) => {
      grid.appendChild(el("div", { class: "cal-head" }, l));
    });
    for (let i = 0; i < lead; i++) {
      grid.appendChild(el("div", { class: "cal-day l0" }, ""));
    }
    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(year, mon, d);
      const key = fmt.toISODate(date);
      const count = countMap.get(key) || 0;
      const isFuture = date > new Date();
      const level = count === 0 ? 0 : count >= 3 ? 3 : count;
      const cell = el("div", {
        class: `cal-day l${level}` + (isFuture ? " future" : ""),
        title: count > 0 ? `${count} ${count === 1 ? "realización" : "realizaciones"}` : "",
      }, String(d));
      grid.appendChild(cell);
    }
    return grid;
  }

  /* Generic element builder (escaped text). */
  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) node.setAttribute(k, attrs[k]);
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  return { barChart, heatmapYear, monthCalendar, el, clear };
})();