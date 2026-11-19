import { prepare } from './canvas.js';
import { colors, hueColor, rgba } from './theme.js';
import { fmt, fmtTime } from './format.js';

// ---------------------------------------------------------------------------
// Axa timpului și fundalul fazelor
// ---------------------------------------------------------------------------

export function phaseSpans(protocol, maxTime) {
  return [
    { id: 'infancy', n: 1, label: 'Dependență', t0: 0, t1: protocol.infancyEnd },
    { id: 'autonomy', n: 2, label: 'Autonomie', t0: protocol.infancyEnd, t1: protocol.autonomyEnd },
    { id: 'trials', n: 3, label: 'Încercări', t0: protocol.autonomyEnd, t1: protocol.substanceStart },
    { id: 'substance', n: 4, label: protocol.substance ? 'Substanța' : 'Viață obișnuită', t0: protocol.substanceStart, t1: maxTime },
  ];
}

class TimeFrame {
  constructor(t0, t1, x0, x1) {
    this.t0 = t0;
    this.t1 = t1;
    this.x0 = x0;
    this.x1 = x1;
  }

  x(t) {
    return this.x0 + ((t - this.t0) / (this.t1 - this.t0)) * (this.x1 - this.x0);
  }

  t(x) {
    return this.t0 + ((x - this.x0) / (this.x1 - this.x0)) * (this.t1 - this.t0);
  }
}

// Axa vieții crește odată cu viața (altfel începutul ar fi o fâșie invizibilă).
function lifeEnd(sim, maxTime, from = 0) {
  const span = Math.max(600, (sim.time - from) * 1.1 + 30);
  return Math.min(maxTime, from + span);
}

function drawPhaseBackground(ctx, frame, protocol, maxTime, y0, y1, c) {
  for (const p of phaseSpans(protocol, maxTime)) {
    const a = Math.max(frame.x0, frame.x(p.t0));
    const b = Math.min(frame.x1, frame.x(p.t1));
    if (b <= a) continue;
    if (p.n % 2 === 0) {
      ctx.fillStyle = c.dark ? 'rgba(255,255,255,0.025)' : 'rgba(15,23,21,0.028)';
      ctx.fillRect(a, y0, b - a, y1 - y0);
    }
  }
}

function drawTimeTicks(ctx, frame, y, c, { labels = true } = {}) {
  const span = frame.t1 - frame.t0;
  const stepMin = span > 3000 ? 10 : span > 1200 ? 5 : span > 400 ? 2 : 1;
  ctx.fillStyle = c.muted;
  ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const first = Math.ceil(frame.t0 / 60 / stepMin) * stepMin;
  for (let m = first; m * 60 <= frame.t1; m += stepMin) {
    const x = frame.x(m * 60);
    if (labels) ctx.fillText(m === 0 ? '0 min' : `${m}`, Math.min(Math.max(x, 14), frame.x1 - 8), y + 3);
  }
}

// Valoarea unei serii pe coloane de pixeli (medie sau maxim), pentru linii curate.
function columnize(h, key, frame, agg = 'mean') {
  const t = h.t;
  const v = h[key];
  const cols = Math.max(2, Math.floor(frame.x1 - frame.x0));
  const out = [];
  let i = lowerBound(t, frame.t0);
  for (let cIdx = 0; cIdx < cols; cIdx++) {
    const tEnd = frame.t0 + ((cIdx + 1) / cols) * (frame.t1 - frame.t0);
    let n = 0;
    let acc = 0;
    let mx = -Infinity;
    let lastT = null;
    while (i < t.length && t[i] < tEnd) {
      acc += v[i];
      mx = Math.max(mx, v[i]);
      lastT = t[i];
      n++;
      i++;
    }
    if (n) out.push({ x: frame.x0 + cIdx + 0.5, y: agg === 'max' ? mx : acc / n, t: lastT });
    if (i >= t.length) break;
  }
  return out;
}

function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function nearestIndex(h, t) {
  const i = lowerBound(h.t, t);
  if (i <= 0) return 0;
  if (i >= h.t.length) return h.t.length - 1;
  return t - h.t[i - 1] < h.t[i] - t ? i - 1 : i;
}

function strokeSeries(ctx, pts, yOf, color, width = 2) {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((p, k) => (k ? ctx.lineTo(p.x, yOf(p.y)) : ctx.moveTo(p.x, yOf(p.y))));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function endDot(ctx, x, y, color, c) {
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = c.surface;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Tooltip comun
// ---------------------------------------------------------------------------

export function attachHover(canvas, content) {
  const tip = document.getElementById('tooltip');
  const show = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const data = content(ev.clientX - rect.left, ev.clientY - rect.top, rect);
    if (!data) {
      tip.hidden = true;
      canvas._hoverX = null;
      return;
    }
    canvas._hoverX = data.x ?? null;
    tip.replaceChildren();
    const title = document.createElement('div');
    title.className = 'tt-title';
    title.textContent = data.title;
    tip.append(title);
    for (const row of data.rows) {
      const r = document.createElement('div');
      r.className = 'tt-row';
      const key = document.createElement('span');
      key.className = 'linekey';
      key.style.background = row.color;
      const name = document.createElement('span');
      name.textContent = row.label;
      const val = document.createElement('b');
      val.textContent = row.value;
      r.append(key, name, val);
      tip.append(r);
    }
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = ev.clientX + 14;
    let y = ev.clientY + 14;
    if (x + tw > window.innerWidth - 8) x = ev.clientX - tw - 14;
    if (y + th > window.innerHeight - 8) y = ev.clientY - th - 14;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  canvas.addEventListener('pointermove', show);
  canvas.addEventListener('pointerdown', show);
  canvas.addEventListener('pointerleave', () => {
    tip.hidden = true;
    canvas._hoverX = null;
  });
}

function drawCrosshair(ctx, canvas, y0, y1, c) {
  if (canvas._hoverX == null) return;
  ctx.beginPath();
  ctx.moveTo(Math.round(canvas._hoverX) + 0.5, y0);
  ctx.lineTo(Math.round(canvas._hoverX) + 0.5, y1);
  ctx.strokeStyle = c['ink-2'];
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Mai multe trasee, fiecare pe rândul lui (hormonii)
// ---------------------------------------------------------------------------

export class TraceStack {
  constructor(canvas, rows, { rowHeight = 46, window = null } = {}) {
    this.canvas = canvas;
    this.rows = rows;
    this.rowHeight = rowHeight;
    this.window = window; // null = toată viața; altfel secunde
    this.state = null;
    attachHover(canvas, (x, y) => this.hover(x, y));
  }

  frame(w) {
    const { sim, maxTime } = this.state;
    const left = 112;
    const right = w - 46;
    if (this.window) {
      const t1 = Math.max(this.window, sim.time);
      return new TimeFrame(t1 - this.window, t1, left, right);
    }
    return new TimeFrame(0, lifeEnd(sim, maxTime), left, right);
  }

  draw(sim, h, maxTime) {
    this.state = { sim, h, maxTime };
    const height = this.rows.length * this.rowHeight + 20;
    const { ctx, w } = prepare(this.canvas, height);
    const c = colors();
    ctx.clearRect(0, 0, w, height);
    const frame = this.frame(w);
    this.lastFrame = frame;
    drawPhaseBackground(ctx, frame, sim.protocol, maxTime, 0, height - 20, c);

    this.rows.forEach((row, k) => {
      const top = k * this.rowHeight + 6;
      const bottom = top + this.rowHeight - 12;
      const yOf = (v) => bottom - ((v - row.min) / (row.max - row.min)) * (bottom - top);
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(frame.x0, Math.round(bottom) + 0.5);
      ctx.lineTo(frame.x1, Math.round(bottom) + 0.5);
      if (row.baseline !== undefined) {
        ctx.moveTo(frame.x0, Math.round(yOf(row.baseline)) + 0.5);
        ctx.lineTo(frame.x1, Math.round(yOf(row.baseline)) + 0.5);
      }
      ctx.stroke();
      const color = c[row.color];
      const pts = columnize(h, row.key, frame, row.agg).map((p) => ({ ...p, y: Math.min(row.max, Math.max(row.min, p.y)) }));
      strokeSeries(ctx, pts, yOf, color, 2);
      ctx.fillStyle = c.ink;
      ctx.font = '500 12px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.label, 0, top + 9);
      ctx.fillStyle = c.muted;
      ctx.font = '400 11px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(row.sub, 0, top + 24);
      if (pts.length) {
        const last = pts[pts.length - 1];
        endDot(ctx, last.x, yOf(last.y), color, c);
        const value = h[row.key][h[row.key].length - 1];
        ctx.fillStyle = c.ink;
        ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(fmt(value, 2), frame.x1 + 8, yOf(Math.min(row.max, Math.max(row.min, last.y))));
      }
    });
    drawTimeTicks(ctx, frame, height - 20, c);
    drawCrosshair(ctx, this.canvas, 0, height - 20, c);
  }

  hover(x) {
    if (!this.state || !this.lastFrame || x < this.lastFrame.x0 || x > this.lastFrame.x1) return null;
    const { h } = this.state;
    if (!h.t.length) return null;
    const t = this.lastFrame.t(x);
    if (t > h.t[h.t.length - 1]) return null;
    const i = nearestIndex(h, t);
    const c = colors();
    return {
      x,
      title: fmtTime(h.t[i]),
      rows: this.rows.map((r) => ({ label: r.label, value: fmt(h[r.key][i], 2), color: c[r.color] })),
    };
  }
}

// ---------------------------------------------------------------------------
// Grafic cu mai multe linii pe aceeași axă
// ---------------------------------------------------------------------------

export class LineChart {
  constructor(canvas, series, { height = 170, min = 0, max = null, from = 0, format = 2, baseline = null } = {}) {
    this.canvas = canvas;
    this.series = series;
    this.height = height;
    this.min = min;
    this.max = max;
    this.from = from;
    this.format = format;
    this.baseline = baseline;
    attachHover(canvas, (x) => this.hover(x));
  }

  draw(sim, h, maxTime) {
    this.state = { sim, h, maxTime };
    const { ctx, w } = prepare(this.canvas, this.height);
    const c = colors();
    const H = this.height;
    ctx.clearRect(0, 0, w, H);
    const from = typeof this.from === 'function' ? this.from(sim) : this.from;
    const frame = new TimeFrame(from, lifeEnd(sim, maxTime, from), 36, w - 40);
    this.lastFrame = frame;
    const top = 8;
    const bottom = H - 22;
    let max = this.max;
    if (max === null) {
      max = 1;
      for (const s of this.series) for (const v of h[s.key]) if (v > max) max = v;
      max = Math.ceil(max);
    }
    const min = this.min;
    const yOf = (v) => bottom - ((v - min) / (max - min)) * (bottom - top);
    this.yOf = yOf;
    drawPhaseBackground(ctx, frame, sim.protocol, maxTime, top, bottom, c);

    // grilă
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = c.muted;
    ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const ticks = niceTicks(min, max, 4);
    const fractional = ticks.some((v) => Math.abs(v - Math.round(v)) > 1e-6);
    for (const v of ticks) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(frame.x0, y);
      ctx.lineTo(frame.x1, y);
      ctx.stroke();
      ctx.fillText(fmt(v, fractional ? 1 : 0), frame.x0 - 6, y);
    }
    if (this.baseline !== null) {
      ctx.strokeStyle = c.muted;
      ctx.beginPath();
      ctx.moveTo(frame.x0, Math.round(yOf(this.baseline)) + 0.5);
      ctx.lineTo(frame.x1, Math.round(yOf(this.baseline)) + 0.5);
      ctx.stroke();
    }

    for (const s of this.series) {
      const pts = columnize(h, s.key, frame).map((p) => ({ ...p, y: Math.max(min, Math.min(max, p.y)) }));
      strokeSeries(ctx, pts, yOf, c[s.color], 2);
      if (pts.length) endDot(ctx, pts[pts.length - 1].x, yOf(pts[pts.length - 1].y), c[s.color], c);
    }
    drawTimeTicks(ctx, frame, bottom + 2, c);
    drawCrosshair(ctx, this.canvas, top, bottom, c);
  }

  hover(x) {
    const st = this.state;
    if (!st || !this.lastFrame || x < this.lastFrame.x0 || x > this.lastFrame.x1 || !st.h.t.length) return null;
    const t = this.lastFrame.t(x);
    if (t > st.h.t[st.h.t.length - 1] || t < this.lastFrame.t0) return null;
    const i = nearestIndex(st.h, t);
    const c = colors();
    return {
      x,
      title: fmtTime(st.h.t[i]),
      rows: this.series.map((s) => ({ label: s.label, value: fmt(st.h[s.key][i], this.format), color: c[s.color] })),
    };
  }
}

function niceTicks(min, max, count) {
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

// ---------------------------------------------------------------------------
// Banda stărilor (o culoare per stare, în timp)
// ---------------------------------------------------------------------------

export class StateBand {
  constructor(canvas, states, { height = 34 } = {}) {
    this.canvas = canvas;
    this.states = states;
    this.height = height;
    attachHover(canvas, (x) => this.hover(x));
  }

  draw(sim, h, maxTime) {
    this.state = { sim, h, maxTime };
    const H = this.height;
    const { ctx, w } = prepare(this.canvas, H);
    const c = colors();
    ctx.clearRect(0, 0, w, H);
    const frame = new TimeFrame(0, lifeEnd(sim, maxTime), 36, w - 40);
    this.lastFrame = frame;
    const top = 4;
    const bottom = H - 14;
    ctx.fillStyle = c['surface-2'];
    ctx.fillRect(frame.x0, top, frame.x1 - frame.x0, bottom - top);
    const t = h.t;
    let i = 0;
    const cols = Math.floor(frame.x1 - frame.x0);
    for (let col = 0; col < cols; col++) {
      const tEnd = frame.t0 + ((col + 1) / cols) * (frame.t1 - frame.t0);
      const counts = new Array(this.states.length).fill(0);
      let n = 0;
      while (i < t.length && t[i] < tEnd) {
        counts[h.state[i]]++;
        n++;
        i++;
      }
      if (!n) {
        if (i >= t.length) break;
        continue;
      }
      let best = 0;
      for (let k = 1; k < counts.length; k++) if (counts[k] > counts[best]) best = k;
      ctx.fillStyle = c[`s-${this.states[best].color}`];
      ctx.fillRect(frame.x0 + col, top, 1.02, bottom - top);
    }
    // limitele fazelor
    ctx.strokeStyle = c.surface;
    ctx.lineWidth = 2;
    for (const p of phaseSpans(sim.protocol, maxTime).slice(1)) {
      if (p.t0 >= frame.t1) continue;
      const x = Math.round(frame.x(p.t0));
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    drawTimeTicks(ctx, frame, bottom, c);
    drawCrosshair(ctx, this.canvas, top, bottom, c);
  }

  hover(x) {
    const st = this.state;
    if (!st || !this.lastFrame || x < this.lastFrame.x0 || x > this.lastFrame.x1 || !st.h.t.length) return null;
    const t = this.lastFrame.t(x);
    if (t > st.h.t[st.h.t.length - 1]) return null;
    const i = nearestIndex(st.h, t);
    const s = this.states[st.h.state[i]];
    const c = colors();
    return {
      x,
      title: fmtTime(st.h.t[i]),
      rows: [
        { label: s.label, value: '', color: c[`s-${s.color}`] },
        { label: 'Valență', value: fmt(st.h.valence[i], 2), color: 'transparent' },
        { label: 'Activare', value: fmt(st.h.arousal[i], 2), color: 'transparent' },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Arie stivuită: cum își împarte timpul
// ---------------------------------------------------------------------------

export class ActivityStack {
  constructor(canvas, activities, { height = 170, bin = 30 } = {}) {
    this.canvas = canvas;
    this.activities = activities;
    this.height = height;
    this.bin = bin;
    attachHover(canvas, (x) => this.hover(x));
  }

  bins(h, maxTime) {
    const nBins = Math.ceil(maxTime / this.bin);
    const out = [];
    let i = 0;
    for (let b = 0; b < nBins; b++) {
      const tEnd = (b + 1) * this.bin;
      const counts = new Array(this.activities.length).fill(0);
      let n = 0;
      while (i < h.t.length && h.t[i] < tEnd) {
        counts[h.activity[i]]++;
        n++;
        i++;
      }
      if (!n) break;
      out.push({ t0: b * this.bin, t1: tEnd, shares: counts.map((k) => k / n) });
    }
    return out;
  }

  draw(sim, h, maxTime) {
    this.state = { sim, h, maxTime };
    const H = this.height;
    const { ctx, w } = prepare(this.canvas, H);
    const c = colors();
    ctx.clearRect(0, 0, w, H);
    const frame = new TimeFrame(0, lifeEnd(sim, maxTime), 36, w - 40);
    this.lastFrame = frame;
    const top = 6;
    const bottom = H - 22;
    const bins = this.bins(h, maxTime);
    this.lastBins = bins;
    const yOf = (v) => bottom - v * (bottom - top);
    // straturi de jos în sus, în ordinea paletei
    const cum = bins.map(() => 0);
    this.activities.forEach((a, k) => {
      if (!bins.length) return;
      ctx.beginPath();
      bins.forEach((b, j) => {
        const x0 = frame.x(b.t0);
        const x1 = frame.x(b.t1);
        const y = yOf(cum[j] + b.shares[k]);
        if (j === 0) ctx.moveTo(x0, y);
        else ctx.lineTo(x0, y);
        ctx.lineTo(x1, y);
      });
      for (let j = bins.length - 1; j >= 0; j--) {
        const b = bins[j];
        const y = yOf(cum[j]);
        ctx.lineTo(frame.x(b.t1), y);
        ctx.lineTo(frame.x(b.t0), y);
      }
      ctx.closePath();
      ctx.fillStyle = c[`a-${a.id}`];
      ctx.fill();
      bins.forEach((b, j) => (cum[j] += b.shares[k]));
    });
    // separatoare de fază
    ctx.strokeStyle = c.surface;
    ctx.lineWidth = 2;
    for (const p of phaseSpans(sim.protocol, maxTime).slice(1)) {
      if (p.t0 >= frame.t1) continue;
      const x = Math.round(frame.x(p.t0));
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    ctx.fillStyle = c.muted;
    ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('100%', frame.x0 - 4, top + 4);
    ctx.fillText('0', frame.x0 - 4, bottom);
    drawTimeTicks(ctx, frame, bottom + 2, c);
    drawCrosshair(ctx, this.canvas, top, bottom, c);
  }

  hover(x) {
    const bins = this.lastBins;
    if (!bins || !bins.length || !this.lastFrame || x < this.lastFrame.x0 || x > this.lastFrame.x1) return null;
    const t = this.lastFrame.t(x);
    const b = bins.find((bb) => t >= bb.t0 && t < bb.t1);
    if (!b) return null;
    const c = colors();
    return {
      x,
      title: `${fmtTime(b.t0)} – ${fmtTime(b.t1)}`,
      rows: this.activities
        .map((a, k) => ({ label: a.label, value: `${Math.round(b.shares[k] * 100)}%`, color: c[`a-${a.id}`], share: b.shares[k] }))
        .filter((r) => r.share > 0),
    };
  }
}

// ---------------------------------------------------------------------------
// Ce așteaptă de la fiecare nuanță (profilurile învățate)
// ---------------------------------------------------------------------------

export class HueChart {
  constructor(canvas, rows, marks, { rowHeight = 64 } = {}) {
    this.canvas = canvas;
    this.rows = rows;
    this.marks = marks;
    this.rowHeight = rowHeight;
    attachHover(canvas, (x) => this.hover(x));
  }

  draw(profiles) {
    this.profiles = profiles;
    const H = this.rows.length * this.rowHeight + 34;
    const { ctx, w } = prepare(this.canvas, H);
    const c = colors();
    ctx.clearRect(0, 0, w, H);
    const x0 = 112;
    const x1 = w - 10;
    this.x0 = x0;
    this.x1 = x1;
    const xOf = (hue) => x0 + (hue / 360) * (x1 - x0);
    this.rows.forEach((row, k) => {
      const values = profiles[row.key];
      const top = k * this.rowHeight + 6;
      const bottom = top + this.rowHeight - 10;
      let max = row.max;
      let min = row.min;
      for (const v of values) {
        if (v > max) max = v;
        if (v < min) min = v;
      }
      const yOf = (v) => bottom - ((v - min) / (max - min)) * (bottom - top);
      const zero = yOf(0);
      const n = values.length;
      for (let i = 0; i < n; i++) {
        const xa = xOf((360 * i) / n);
        const xb = xOf((360 * (i + 1)) / n);
        const y = yOf(values[i]);
        ctx.fillStyle = hueColor((360 * (i + 0.5)) / n, { sat: 60, light: 52, alpha: 0.75 });
        ctx.fillRect(xa, Math.min(y, zero), xb - xa + 0.5, Math.abs(zero - y));
      }
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(zero) + 0.5);
      ctx.lineTo(x1, Math.round(zero) + 0.5);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const v = values[i % n];
        const x = xOf((360 * i) / n);
        if (i === 0) ctx.moveTo(x, yOf(v));
        else ctx.lineTo(x, yOf(v));
      }
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = c.ink;
      ctx.font = '500 12px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.label, 0, top + 10);
      ctx.fillStyle = c.muted;
      ctx.font = '400 11px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(row.sub, 0, top + 25);
    });
    // spectrul și reperele observatorului
    const yb = this.rows.length * this.rowHeight + 2;
    for (let hue = 0; hue < 360; hue += 2) {
      ctx.fillStyle = hueColor(hue, { sat: 62, light: 52 });
      ctx.fillRect(xOf(hue), yb, xOf(hue + 2) - xOf(hue) + 0.5, 6);
    }
    ctx.font = '400 10.5px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (const m of this.marks) {
      const x = xOf(m.hue);
      ctx.strokeStyle = c['ink-2'];
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yb + 6);
      ctx.lineTo(Math.round(x) + 0.5, yb + 11);
      ctx.stroke();
      ctx.fillStyle = c['ink-2'];
      ctx.textAlign = x < x0 + 30 ? 'left' : x > x1 - 30 ? 'right' : 'center';
      ctx.fillText(m.label, x, yb + 13);
    }
    drawCrosshair(ctx, this.canvas, 0, this.rows.length * this.rowHeight, c);
  }

  hover(x) {
    if (!this.profiles || x < this.x0 || x > this.x1) return null;
    const hue = ((x - this.x0) / (this.x1 - this.x0)) * 360;
    const n = this.profiles[this.rows[0].key].length;
    const i = Math.min(n - 1, Math.max(0, Math.round((hue / 360) * n)));
    return {
      x,
      title: `nuanța ${Math.round(hue)}°`,
      rows: this.rows.map((r) => ({ label: r.label, value: fmt(this.profiles[r.key][i], 3), color: hueColor(hue) })),
    };
  }
}

// ---------------------------------------------------------------------------
// Spațiul afectiv (valență × activare) cu urma ultimului minut
// ---------------------------------------------------------------------------

export function drawCircumplex(canvas, h, stateColor) {
  const size = canvas.clientWidth || 132;
  const { ctx } = prepare(canvas, size);
  const c = colors();
  const pad = 14;
  const x0 = pad;
  const x1 = size - 6;
  const y0 = 6;
  const y1 = size - pad;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = c['surface-2'];
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  ctx.beginPath();
  ctx.moveTo(Math.round(xm) + 0.5, y0);
  ctx.lineTo(Math.round(xm) + 0.5, y1);
  ctx.moveTo(x0, Math.round(ym) + 0.5);
  ctx.lineTo(x1, Math.round(ym) + 0.5);
  ctx.stroke();
  ctx.fillStyle = c.muted;
  ctx.font = '400 9.5px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('neplăcut · plăcut', xm, y1 + 2);
  ctx.save();
  ctx.translate(9, ym);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.fillText('liniștit · agitat', 0, 0);
  ctx.restore();
  const X = (v) => x0 + ((v + 1) / 2) * (x1 - x0);
  const Y = (a) => y1 - a * (y1 - y0);
  const n = h.t.length;
  const from = Math.max(0, n - 120);
  for (let i = from; i < n; i++) {
    const age = (n - i) / 120;
    ctx.beginPath();
    ctx.arc(X(h.valence[i]), Y(h.arousal[i]), 1.6, 0, Math.PI * 2);
    ctx.fillStyle = rgba(c.ink.startsWith('#') ? c.ink : '#0f1715', 0.5 * (1 - age));
    ctx.fill();
  }
  if (n) {
    ctx.beginPath();
    ctx.arc(X(h.valence[n - 1]), Y(h.arousal[n - 1]), 5, 0, Math.PI * 2);
    ctx.fillStyle = stateColor;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.surface;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Calendarul vieții (sub arenă)
// ---------------------------------------------------------------------------

export function drawTimeline(canvas, sim, observer, maxTime) {
  const H = 58;
  const { ctx, w } = prepare(canvas, H);
  const c = colors();
  ctx.clearRect(0, 0, w, H);
  const frame = new TimeFrame(0, maxTime, 2, w - 2);
  const pr = sim.protocol;
  const top = 16;
  const bottom = 34;
  for (const p of phaseSpans(pr, maxTime)) {
    const a = frame.x(p.t0);
    const b = frame.x(p.t1);
    ctx.fillStyle = sim.phase.id === p.id ? c['surface-2'] : c.bg;
    ctx.fillRect(a + 1, top, b - a - 2, bottom - top);
    ctx.fillStyle = sim.phase.id === p.id ? c.ink : c.muted;
    ctx.font = `${sim.phase.id === p.id ? 600 : 400} 11px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const label = b - a > 120 ? `${p.n} · ${p.label}` : `${p.n}`;
    ctx.fillText(label, a + 4, top - 2);
  }
  // episoade
  const marks = [];
  if (pr.shock) marks.push({ t0: pr.shockStart, t1: pr.shockEnd, label: 'atac' });
  if (pr.famine) marks.push({ t0: pr.famineStart, t1: pr.famineEnd, label: 'foamete' });
  ctx.font = '400 10px "IBM Plex Sans", system-ui, sans-serif';
  let lastRight = -Infinity;
  for (const m of marks) {
    const a = frame.x(m.t0);
    const b = Math.max(a + 2, frame.x(m.t1));
    ctx.fillStyle = c.muted;
    ctx.fillRect(a, bottom - 4, b - a, 4);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const x = Math.max(a, lastRight + 6);
    const width = ctx.measureText(m.label).width;
    if (x + width < w - 40) {
      ctx.fillText(m.label, x, bottom + 2);
      lastRight = x + width;
    }
  }
  // îngrijitorul și dozele
  for (const iv of sim.caregiver.interventions) {
    const x = Math.round(frame.x(iv.time)) + 0.5;
    ctx.strokeStyle = hueColor(40, { sat: 80, light: 50 });
    ctx.beginPath();
    ctx.moveTo(x, top + 2);
    ctx.lineTo(x, top + 9);
    ctx.stroke();
  }
  for (const t of observer.doseLog) {
    const x = Math.round(frame.x(t)) + 0.5;
    ctx.strokeStyle = c['a-substance'];
    ctx.beginPath();
    ctx.moveTo(x, top + 2);
    ctx.lineTo(x, top + 9);
    ctx.stroke();
  }
  // acum
  const xn = frame.x(Math.min(sim.time, maxTime));
  ctx.fillStyle = sim.alive ? c.accent : c.critical;
  ctx.fillRect(Math.round(xn) - 1, top - 4, 2, bottom - top + 8);
  ctx.fillStyle = c.muted;
  ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`${Math.round(maxTime / 60)} min`, w - 2, bottom + 2);
}
