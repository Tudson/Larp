import { CONDITIONS } from '../core/params.js';
import { runExperiment, aggregate } from '../lab/experiment.js';
import { fmt, fmtPercent, CAUSE, PHASE } from './format.js';

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, text = null) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== null) node.textContent = text;
  return node;
}

function svgEl(tag, attrs = {}, style = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  Object.assign(node.style, style);
  return node;
}

// Curba de supraviețuire: fracția încă în viață, cu fazele vieții în fundal.
function survivalSvg(cond, data) {
  const W = 260;
  const H = 96;
  const x0 = 4;
  const x1 = W - 4;
  const y0 = 8;
  const y1 = H - 18;
  const X = (t) => x0 + (t / data.maxTime) * (x1 - x0);
  const Y = (a) => y1 - a * (y1 - y0);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Supraviețuire: ${cond.label}` });
  const p = data.protocol;
  const bands = [
    [0, p.infancyEnd],
    [p.infancyEnd, p.autonomyEnd],
    [p.autonomyEnd, p.substanceStart],
    [p.substanceStart, data.maxTime],
  ];
  bands.forEach(([a, b], k) => {
    if (k % 2 === 1) svg.append(svgEl('rect', { x: X(a), y: y0, width: X(b) - X(a), height: y1 - y0 }, { fill: 'var(--surface-2)' }));
  });
  svg.append(svgEl('line', { x1: x0, x2: x1, y1: Y(0) + 0.5, y2: Y(0) + 0.5 }, { stroke: 'var(--line)', strokeWidth: 1 }));
  if (cond.usesSubstance) {
    svg.append(svgEl('line', { x1: X(p.substanceStart), x2: X(p.substanceStart), y1: y0, y2: y1 }, { stroke: 'var(--a-substance)', strokeWidth: 1 }));
    const label = svgEl('text', { x: X(p.substanceStart) + 4, y: y0 + 9 }, { fill: 'var(--muted)', fontSize: '9px', fontFamily: 'var(--font-body)' });
    label.textContent = 'substanța';
    svg.append(label);
  }
  let d = '';
  cond.curve.forEach((pt, i) => {
    const x = X(pt.t);
    const y = Y(pt.alive);
    if (i === 0) d += `M${x.toFixed(1)},${y.toFixed(1)}`;
    else d += `H${x.toFixed(1)}V${y.toFixed(1)}`;
  });
  const color = cond.survived === cond.n ? 'var(--good)' : cond.survived === 0 ? 'var(--critical)' : 'var(--serious)';
  svg.append(svgEl('path', { d }, { fill: 'none', stroke: color, strokeWidth: 2, strokeLinejoin: 'round' }));
  const axis = svgEl('text', { x: x0, y: H - 4 }, { fill: 'var(--muted)', fontSize: '9px', fontFamily: 'var(--font-mono)' });
  axis.textContent = '0';
  const axisEnd = svgEl('text', { x: x1, y: H - 4, 'text-anchor': 'end' }, { fill: 'var(--muted)', fontSize: '9px', fontFamily: 'var(--font-mono)' });
  axisEnd.textContent = `${Math.round(data.maxTime / 60)} min`;
  svg.append(axis, axisEnd);
  return svg;
}

function verdictText(cond, data) {
  const dead = cond.n - cond.survived;
  const phases = {};
  for (const [k, v] of Object.entries(cond.causes)) {
    const ph = k.split(':')[0];
    phases[ph] = (phases[ph] ?? 0) + v;
  }
  const mainPhase = Object.entries(phases).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (cond.survived >= cond.n / 2) {
    const losses = dead === 0 ? '' : ` (${dead === 1 ? 'un deces' : `${dead} decese`} din ${cond.n})`;
    if (cond.doses.median > 0) {
      return `Folosește substanța (mediana ${fmt(cond.doses.median, 0)} doze), dar supraviețuiește${losses}. Când e flămând și vede hrană, urmărește substanța doar în ${fmtPercent(cond.neglect.median)} din timp.`;
    }
    return `Trece prin toate încercările și supraviețuiește${losses}.`;
  }
  if (mainPhase === 'infancy') return `Moare în primele ${fmt(cond.deathTime.median, 0)} s de viață, înainte să învețe ceva.`;
  if (mainPhase === 'autonomy') return `Supraviețuiește cât timp e hrănit, apoi moare după plecarea îngrijitorului (min ${fmt(cond.deathTime.median / 60, 0)}).`;
  if (mainPhase === 'substance') {
    const after = (cond.deathTime.median - data.protocol.substanceStart) / 60;
    return `Moare la mediana de ${fmt(after, 0)} min după apariția substanței. Flămând și cu hrană în atenție, urmărește substanța în ${fmtPercent(cond.neglect.median)} din timp.`;
  }
  return `${dead} din ${cond.n} mor.`;
}

export class LabView {
  constructor(root) {
    this.grid = root.querySelector('#cond-grid');
    this.table = root.querySelector('#results-table');
    this.source = root.querySelector('#lab-source');
    this.runButton = root.querySelector('#lab-run');
    this.seedsSelect = root.querySelector('#lab-seeds');
    this.progress = root.querySelector('#lab-progress');
    this.status = root.querySelector('#lab-status');
    this.running = false;
    this.runButton.addEventListener('click', () => (this.running ? this.cancel() : this.run()));
  }

  show(data, sourceLabel) {
    this.data = data;
    this.source.textContent = sourceLabel;
    this.grid.replaceChildren();
    for (const cond of data.conditions) {
      const meta = CONDITIONS.find((c) => c.id === cond.id);
      cond.usesSubstance = !(meta?.overrides?.protocol?.substance === false);
      const card = el('article', { class: `card cond${cond.id === 'full' ? ' reference' : ''}` });
      card.append(el('h3', {}, cond.label));
      const verdict = el('div', { class: 'verdict' });
      verdict.append(el('span', { class: 'big' }, `${cond.survived}/${cond.n}`), el('span', { class: 'of' }, 'supraviețuiesc'));
      card.append(verdict, survivalSvg(cond, data));
      card.append(el('p', {}, verdictText(cond, data)));
      card.append(el('p', { class: 'muted' }, cond.description));
      this.grid.append(card);
    }
    this.renderTable(data);
  }

  renderTable(data) {
    const t = this.table;
    t.replaceChildren();
    const head = el('thead');
    const hr = el('tr');
    for (const h of ['Condiție', 'Supraviețuiesc', 'Decese', 'Moarte (min)', 'Doze', 'Neglijarea hranei', 'Mese / min, înainte → după', 'Leziuni / min, înainte → după', 'Dorință / plăcere (final)']) {
      hr.append(el('th', { scope: 'col' }, h));
    }
    head.append(hr);
    const body = el('tbody');
    const cell = (s, digits, scale = 1) => {
      const td = el('td');
      if (s.median === null) {
        td.textContent = '—';
        return td;
      }
      td.append(document.createTextNode(fmt(s.median * scale, digits)));
      td.append(el('span', { class: 'q' }, `${fmt(s.q1 * scale, digits)}–${fmt(s.q3 * scale, digits)}`));
      return td;
    };
    for (const c of data.conditions) {
      const tr = el('tr');
      tr.append(el('td', {}, c.label));
      tr.append(el('td', {}, `${c.survived}/${c.n}`));
      const causes = Object.entries(c.causes)
        .map(([k, v]) => {
          const [ph, ca] = k.split(':');
          return `${v}× ${CAUSE[ca] ?? ca} (${PHASE[ph] ?? ph})`;
        })
        .join('; ');
      tr.append(el('td', {}, causes || '—'));
      tr.append(cell(c.deathTime, 0, 1 / 60));
      tr.append(cell(c.doses, 0));
      tr.append(cell(c.neglect, 2));
      tr.append(el('td', {}, `${fmt(c.mealsBefore.median, 2)} → ${fmt(c.mealsAfter.median, 2)}`));
      tr.append(el('td', {}, `${fmt(c.injuriesBefore.median, 2)} → ${fmt(c.injuriesAfter.median, 2)}`));
      tr.append(el('td', {}, c.doses.median > 0 ? `${fmt(c.want.median, 1)} / ${fmt(c.like.median, 2)}` : '—'));
      body.append(tr);
    }
    t.append(head, body);
  }

  run() {
    const n = Number(this.seedsSelect.value);
    const seeds = Array.from({ length: n }, (_, i) => i + 1);
    const conditions = CONDITIONS.map((c) => c.id);
    const total = n * conditions.length;
    const gen = runExperiment({ conditions, seeds });
    const results = [];
    this.running = true;
    this.runButton.textContent = 'Oprește';
    this.status.textContent = `0 / ${total} vieți`;
    const started = performance.now();
    const tick = () => {
      if (!this.running) return;
      const budget = performance.now() + 40;
      while (performance.now() < budget) {
        const next = gen.next();
        if (next.done) {
          this.finish(results, n, started);
          return;
        }
        results.push(next.value);
      }
      this.progress.style.width = `${(100 * results.length) / total}%`;
      this.status.textContent = `${results.length} / ${total} vieți`;
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }

  cancel() {
    this.running = false;
    this.runButton.textContent = 'Rulează în browser';
    this.status.textContent = 'Oprit.';
    this.progress.style.width = '0%';
  }

  finish(results, n, started) {
    this.running = false;
    this.runButton.textContent = 'Rulează în browser';
    this.progress.style.width = '100%';
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    this.status.textContent = `Gata în ${seconds.replace('.', ',')} s.`;
    const base = this.data;
    const data = {
      maxTime: base.maxTime,
      protocol: base.protocol,
      conditions: aggregate(results, base.maxTime),
    };
    this.show(data, `Rezultate rulate acum în browser · ${n} vieți pe condiție (semințele 1–${n})`);
  }
}
