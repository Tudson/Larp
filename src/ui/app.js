import { CONDITIONS, DEFAULT_PARAMS, conditionParams } from '../core/params.js';
import { Simulation } from '../core/simulation.js';
import { Observer, STATES, ACTIVITIES } from '../observer/observer.js';
import { ArenaView } from './arena-view.js';
import { TraceStack, LineChart, StateBand, ActivityStack, HueChart, drawCircumplex, drawTimeline } from './charts.js';
import { LabView } from './lab-view.js';
import { colors, onThemeChange, hueColor } from './theme.js';
import { onResize } from './canvas.js';
import { fmt, fmtTime, CAUSE } from './format.js';

const $ = (id) => document.getElementById(id);
const STATE_COLOR = { calm: 'calm', alert: 'alert', euphoria: 'euphoria', fear: 'fear', discomfort: 'discomfort', apathy: 'apathy', frustration: 'frustration' };
const STATE_LIST = STATES.map((s) => ({ ...s, color: STATE_COLOR[s.id] }));
const KINDS = DEFAULT_PARAMS.kinds;
const DEFAULT_SEED = 2;

const app = {
  sim: null,
  observer: null,
  running: false,
  speed: 15,
  condition: 'full',
  seed: DEFAULT_SEED,
  skipTarget: null,
  lastFrame: 0,
  lastPanels: 0,
  carry: 0,
  logCount: -1,
};

// ---------------------------------------------------------------------------
// Grafice
// ---------------------------------------------------------------------------
const arena = new ArenaView($('arena'));
const hormones = new TraceStack($('hormones'), [
  { key: 'ghrelin', label: 'Grelină', sub: 'foame', color: 'h-ghrelin', min: 0, max: 1 },
  { key: 'noradrenaline', label: 'Noradrenalină', sub: 'alertă', color: 'h-ne', min: 0, max: 1.6, agg: 'max' },
  { key: 'cortisol', label: 'Cortizol', sub: 'stres', color: 'h-cortisol', min: 0, max: 1.3 },
  { key: 'dopamine', label: 'Dopamină', sub: 'tonus (1 = normal)', color: 'h-dopamine', min: 0, max: 3, baseline: 1 },
], { window: 300 });
const wantChart = new LineChart(
  $('want-chart'),
  [
    { key: 'wantSubstance', label: 'Dorință', color: 'm-want' },
    { key: 'likeSubstance', label: 'Plăcere așteptată', color: 'm-like' },
    { key: 'goalSubstance', label: 'Evaluare (scop)', color: 'm-goal' },
  ],
  { height: 190, min: -1, from: (sim) => Math.max(0, sim.protocol.substanceStart - 60), baseline: 0 },
);
const addictionChart = new LineChart(
  $('addiction-chart'),
  [
    { key: 'receptor', label: 'Receptori dopaminergici', color: 'h-dopamine' },
    { key: 'omega', label: 'Control (1 = scop)', color: 'm-goal' },
    { key: 'blood', label: 'Substanță în sânge', color: 'a-substance' },
  ],
  { height: 150, min: 0, max: 2 },
);
const activityChart = new ActivityStack($('activity-chart'), ACTIVITIES, { height: 170, bin: 60 });
const stateChart = new StateBand($('state-chart'), STATE_LIST, { height: 40 });
const hueChart = new HueChart(
  $('hue-chart'),
  [
    { key: 'energy', label: 'Energie', sub: 'ce i-ar da corpului', min: -0.02, max: 0.1 },
    { key: 'harm', label: 'Durere și rău', sub: 'ce l-ar răni', min: 0, max: 0.05 },
    { key: 'want', label: 'Dorință', sub: 'valoare de obișnuință', min: -0.3, max: 0.5 },
  ],
  [
    { hue: KINDS.thorn.hue, label: 'spini' },
    { hue: KINDS.nutrient.hue, label: 'hrană' },
    { hue: KINDS.stone.hue, label: 'pietre' },
    { hue: KINDS.substance.hue, label: 'substanță' },
  ],
);

// ---------------------------------------------------------------------------
// Legende și instrumente statice
// ---------------------------------------------------------------------------
function legendIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '-7 -7 14 14');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', kind === 'organism' || kind === 'nutrient' || kind === 'husk' ? 'circle' : 'path');
  const hue = KINDS[kind]?.hue;
  switch (kind) {
    case 'organism':
      shape.setAttribute('r', '5.5');
      shape.style.fill = 'var(--organism)';
      break;
    case 'nutrient':
      shape.setAttribute('r', '5.5');
      shape.style.fill = hueColor(hue, { sat: 58, light: 44 });
      break;
    case 'husk':
      shape.setAttribute('r', '5.5');
      shape.style.fill = 'none';
      shape.style.stroke = hueColor(hue, { sat: 58, light: 44 });
      shape.style.strokeWidth = '3';
      break;
    case 'thorn':
      shape.setAttribute('d', 'M0,-6.5L1.6,-2.3L6,-2.6L2.7,0.6L4.6,5.2L0,2.6L-4.6,5.2L-2.7,0.6L-6,-2.6L-1.6,-2.3Z');
      shape.style.fill = hueColor(hue, { sat: 68, light: 48 });
      break;
    case 'stone':
      shape.setAttribute('d', 'M-5,-2L-2,-5.5L3.5,-5L6,0L3,5L-3.5,5Z');
      shape.style.fill = hueColor(hue, { sat: 16, light: 58 });
      break;
    case 'substance':
      shape.setAttribute('d', 'M0,-6.5L5,0L0,6.5L-5,0Z');
      shape.style.fill = hueColor(hue, { sat: 62, light: 52 });
      break;
    case 'predator':
      shape.setAttribute('d', 'M6.5,0L-5,5L-2.5,0L-5,-5Z');
      shape.style.fill = hueColor(hue, { sat: 76, light: 48 });
      break;
    default:
      break;
  }
  svg.append(shape);
  return svg;
}

function buildLegends() {
  const legend = $('arena-legend');
  legend.replaceChildren();
  const items = [
    ['organism', 'Organismul'],
    ['nutrient', 'Hrană'],
    ['husk', 'Momeală goală (identică pentru el)'],
    ['thorn', 'Spini'],
    ['stone', 'Pietre (neutre)'],
    ['substance', 'Substanța'],
    ['predator', 'Prădător'],
  ];
  for (const [kind, label] of items) {
    const k = document.createElement('span');
    k.className = 'key';
    k.append(legendIcon(kind), document.createTextNode(label));
    legend.append(k);
  }
  const note = document.createElement('span');
  note.className = 'key muted';
  note.textContent = 'Linii: ce are în atenție. Cerc: raza percepției.';
  legend.append(note);

  const keyRow = (root, items2) => {
    root.replaceChildren();
    for (const [color, label] of items2) {
      const k = document.createElement('span');
      k.className = 'k';
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = `var(--${color})`;
      k.append(sw, document.createTextNode(label));
      root.append(k);
    }
  };
  keyRow($('activity-key'), ACTIVITIES.map((a) => [`a-${a.id}`, a.label]));
  keyRow($('state-key'), STATE_LIST.map((s) => [`s-${s.color}`, s.label]));

  if ($('addiction-key')) return;
  const addKey = document.createElement('div');
  addKey.id = 'addiction-key';
  addKey.className = 'key-row';
  addKey.style.marginTop = '10px';
  for (const [color, label] of [['h-dopamine', 'Receptori dopaminergici'], ['m-goal', 'Control (1 = scop)'], ['a-substance', 'Substanță în sânge']]) {
    const k = document.createElement('span');
    k.className = 'k';
    const lk = document.createElement('span');
    lk.className = 'linekey';
    lk.style.background = `var(--${color})`;
    k.append(lk, document.createTextNode(label));
    addKey.append(k);
  }
  $('addiction-chart').before(addKey);
}

const GAUGES = [
  { id: 'attention', label: 'Atenție', unit: (v) => `${v} obiecte`, min: 1, max: 5, ends: ['îngustă', 'largă'] },
  { id: 'reaction', label: 'Timp de reacție', unit: (v) => `${fmt(v, 2)} s`, min: 0.2, max: 2, ends: ['rapid', 'lent'] },
  { id: 'beta', label: 'Rigiditatea alegerilor', unit: (v) => fmt(v, 0), min: 4, max: 45, ends: ['explorează', 'rigid'] },
  { id: 'omega', label: 'Cine decide', unit: (v) => `${fmt(v * 100, 0)}% scop`, min: 0, max: 1, ends: ['obișnuință', 'scop'] },
  { id: 'vigor', label: 'Vigoare', unit: (v) => fmt(v, 2), min: 0.15, max: 1.2, ends: ['lentă', 'mare'] },
  { id: 'curiosity', label: 'Curiozitate', unit: (v) => fmt(v, 2), min: 0, max: 1.3, ends: ['absentă', 'mare'] },
];

function buildGauges() {
  const root = $('gauges');
  root.replaceChildren();
  for (const g of GAUGES) {
    const box = document.createElement('div');
    box.className = 'gauge';
    box.innerHTML = '<div class="row"><span></span><b>—</b></div><div class="track"><div class="pip"></div></div><div class="ends"><span></span><span></span></div>';
    box.querySelector('.row span').textContent = g.label;
    const [a, b] = box.querySelectorAll('.ends span');
    a.textContent = g.ends[0];
    b.textContent = g.ends[1];
    g.value = box.querySelector('.row b');
    g.pip = box.querySelector('.pip');
    root.append(box);
  }
}

// ---------------------------------------------------------------------------
// Viața curentă
// ---------------------------------------------------------------------------
function newLife() {
  const params = conditionParams(app.condition);
  app.sim = new Simulation({ seed: app.seed, params });
  app.observer = new Observer(app.sim);
  app.skipTarget = null;
  app.carry = 0;
  app.logCount = -1;
  app.maxTime = params.protocol.maxTime;
  updatePanels(true);
}

function stepMany(n) {
  const { sim, observer } = app;
  for (let i = 0; i < n && !sim.finished; i++) {
    sim.step();
    observer.observe();
  }
}

function boundaries() {
  const p = app.sim.protocol;
  const list = [p.infancyEnd, p.autonomyEnd, p.shockStart, p.shockEnd + 30, p.famineStart, p.famineDecoys, p.famineEnd, p.substanceStart];
  if (p.substance) list.push(p.substanceStart + 300, p.substanceStart + 600, p.substanceStart + 900);
  return list.filter((t) => t < p.maxTime).sort((a, b) => a - b);
}

function frame(now) {
  const realDt = app.lastFrame ? Math.min(0.1, (now - app.lastFrame) / 1000) : 0.016;
  app.lastFrame = now;
  const sim = app.sim;
  if (!sim.finished) {
    if (app.skipTarget !== null) {
      const budget = performance.now() + 26;
      while (performance.now() < budget && sim.time < app.skipTarget && !sim.finished) stepMany(200);
      if (sim.time >= app.skipTarget || sim.finished) app.skipTarget = null;
    } else if (app.running) {
      app.carry += (realDt * app.speed) / sim.dt;
      const steps = Math.min(4000, Math.floor(app.carry));
      app.carry -= steps;
      stepMany(steps);
    }
  } else if (app.running) {
    setRunning(false);
  }
  arena.draw(sim, app.observer, realDt);
  if (now - app.lastPanels > 110 || app.skipTarget !== null) {
    app.lastPanels = now;
    updatePanels(false);
  }
  requestAnimationFrame(frame);
}

function setMeter(id, valueId, value, invert = false) {
  const v = Math.max(0, Math.min(1, value));
  const fill = $(id);
  fill.style.width = `${(v * 100).toFixed(1)}%`;
  const level = invert ? 1 - v : v;
  const c = level > 0.5 ? 'var(--good)' : level > 0.25 ? 'var(--warn)' : level > 0.12 ? 'var(--serious)' : 'var(--critical)';
  fill.style.background = c;
  $(valueId).textContent = `${Math.round(v * 100)}%`;
}

function updatePanels(force) {
  const { sim, observer } = app;
  const org = sim.organism;
  const h = observer.history;
  const c = colors();

  // ceas și etape
  $('clock-t').textContent = fmtTime(sim.time);
  $('clock-phase').textContent = `${sim.phase.index + 1} · ${sim.phase.label}`;
  const ep = { shock: 'atacul prădătorului', aftermath: 'după atac', famine: 'foamete', recovery: 'refacere' }[sim.episode] ?? '';
  $('clock-episode').textContent = ep;

  // corp
  setMeter('m-energy', 'v-energy', org.body.energy);
  setMeter('m-integrity', 'v-integrity', Math.max(0, org.body.integrity));
  setMeter('m-organ', 'v-organ', org.body.organLoad, true);

  // starea citită de observator
  const st = observer.state;
  const stColor = c[`s-${STATE_COLOR[st.id]}`];
  $('state-name').textContent = st.label;
  $('state-dot').style.background = stColor;
  const motive = observer.motive > 0.15 ? 'se apropie / caută' : observer.motive < -0.15 ? 'evită' : 'nemișcat sau ezitant';
  $('state-why').textContent = `Valență ${fmt(observer.valence, 2)} · activare ${fmt(observer.arousal, 2)} · ${motive}`;
  let since = sim.time;
  for (let i = h.state.length - 1; i >= 0; i--) {
    if (STATES[h.state[i]].id !== st.id) break;
    since = h.t[i];
  }
  $('state-since').textContent = `în această stare de ${Math.max(0, Math.round(sim.time - since))} s`;
  drawCircumplex($('circumplex'), h, stColor);

  // creierul acum
  const mod = org.brain.mod;
  if (mod) {
    const vals = {
      attention: mod.attentionSlots,
      reaction: mod.decisionInterval,
      beta: mod.beta,
      omega: mod.omega,
      vigor: mod.vigor,
      curiosity: mod.curiosity,
    };
    for (const g of GAUGES) {
      const v = vals[g.id];
      g.value.textContent = g.unit(v);
      const pos = Math.max(0, Math.min(1, (v - g.min) / (g.max - g.min)));
      g.pip.style.left = `${(pos * 100).toFixed(1)}%`;
    }
  }

  // grafice
  const maxTime = app.maxTime;
  hormones.draw(sim, h, maxTime);
  activityChart.draw(sim, h, maxTime);
  stateChart.draw(sim, h, maxTime);
  addictionChart.draw(sim, h, maxTime);
  wantChart.draw(sim, h, maxTime);
  if (!sim.protocol.substance || sim.time < sim.protocol.substanceStart) {
    const cv = $('want-chart');
    const ctx = cv.getContext('2d');
    ctx.fillStyle = c.muted;
    ctx.font = '400 13px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const msg = sim.protocol.substance
      ? `Substanța apare la ${fmtTime(sim.protocol.substanceStart)}`
      : 'În această condiție substanța nu apare.';
    ctx.fillText(msg, cv.clientWidth / 2, 80);
  }
  const prof = org.brain.knowledgeProfile(90);
  hueChart.draw({
    energy: prof.energy,
    harm: prof.pain.map((v, i) => Math.max(0, v) + Math.max(0, prof.malaise[i])),
    want: prof.habit,
  });
  drawTimeline($('timeline'), sim, observer, maxTime);

  // jurnal
  if (observer.narrative.length !== app.logCount || force) {
    app.logCount = observer.narrative.length;
    const log = $('log');
    log.replaceChildren();
    for (const e of [...observer.narrative].reverse()) {
      const li = document.createElement('li');
      li.className = `tone-${e.tone}`;
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = fmtTime(e.time).replace(' min', '');
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = e.text;
      li.append(when, what);
      log.append(li);
    }
    if (!observer.narrative.length) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="when">0:00</span><span class="what">Se naște. Nu știe nimic despre lume.</span>';
      log.append(li);
    }
  }

  // stări -> comportament
  const tbody = $('state-table').querySelector('tbody');
  tbody.replaceChildren();
  for (const s of STATE_LIST) {
    const b = observer.stats.byState[s.id];
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = `var(--s-${s.color})`;
    sw.style.marginRight = '6px';
    sw.style.verticalAlign = '-1px';
    name.append(sw, document.createTextNode(s.label));
    tr.append(name);
    const cells = b.n
      ? [
          fmtTime(observer.stats.stateTime[s.id]).replace(' min', ''),
          `${Math.round((100 * b.explore) / b.n)}%`,
          `${Math.round((100 * b.rest) / b.n)}%`,
          fmt(b.reaction / b.n, 2),
          fmt(b.attention / b.n, 1),
        ]
      : ['—', '—', '—', '—', '—'];
    for (const v of cells) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    tbody.append(tr);
  }

  // suprapunerea din arenă
  const overlay = $('overlay');
  if (sim.death) {
    overlay.hidden = false;
    $('overlay-title').textContent = 'Colaps';
    $('overlay-text').textContent = `La ${fmtTime(sim.death.time)}, prin ${CAUSE[sim.death.cause] ?? sim.death.cause}. Leziune de organ: ${Math.round(sim.death.organLoad * 100)}%.`;
  } else if (sim.finished) {
    overlay.hidden = false;
    $('overlay-title').textContent = 'Încă trăiește';
    $('overlay-text').textContent = `Simularea s-a oprit la orizontul de ${Math.round(app.maxTime / 60)} de minute.`;
  } else if (sim.time === 0 && !app.running) {
    overlay.hidden = false;
    $('overlay-title').textContent = 'Nou-născut';
    $('overlay-text').textContent = 'Apasă Pornește. Nu știe încă nimic despre lume.';
  } else {
    overlay.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Comenzi
// ---------------------------------------------------------------------------
function setRunning(on) {
  app.running = on && !app.sim.finished;
  $('play').textContent = app.running ? 'Pauză' : app.sim.finished ? 'Gata' : app.sim.time > 0 ? 'Continuă' : 'Pornește';
}

function bindControls() {
  $('play').addEventListener('click', () => {
    if (app.sim.finished) {
      newLife();
      setRunning(true);
      return;
    }
    setRunning(!app.running);
  });
  for (const b of $('hormone-window').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      hormones.window = Number(b.dataset.window) || null;
      for (const o of $('hormone-window').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
      updatePanels(true);
    });
  }
  for (const b of $('speed').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      app.speed = Number(b.dataset.speed);
      for (const o of $('speed').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
    });
  }
  $('skip').addEventListener('click', () => {
    const next = boundaries().find((t) => t > app.sim.time + 0.5);
    if (next !== undefined) app.skipTarget = next;
  });
  $('restart').addEventListener('click', () => {
    newLife();
    setRunning(true);
  });
  const select = $('condition');
  for (const c of CONDITIONS) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.label;
    select.append(o);
  }
  select.value = app.condition;
  select.addEventListener('change', () => {
    app.condition = select.value;
    newLife();
    setRunning(true);
  });
  const seed = $('seed');
  seed.value = String(app.seed);
  seed.addEventListener('change', () => {
    const v = Math.max(1, Math.min(99999, Math.round(Number(seed.value) || 1)));
    seed.value = String(v);
    app.seed = v;
    newLife();
    setRunning(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      $('play').click();
    }
  });
}

// ---------------------------------------------------------------------------
// Rezultatele precalculate ale laboratorului
// ---------------------------------------------------------------------------
async function loadPrecomputed(lab) {
  let data = null;
  const inline = document.getElementById('precomputed');
  if (inline) {
    data = JSON.parse(inline.textContent);
  } else {
    try {
      const res = await fetch('./experiments/results/summary.json');
      if (res.ok) data = await res.json();
    } catch {
      data = null;
    }
  }
  if (!data) {
    $('lab-source').textContent = 'Încă nu există rezultate. Apasă „Rulează în browser”.';
    return;
  }
  data.protocol = DEFAULT_PARAMS.protocol;
  const n = data.seeds.length;
  lab.show(data, `Rezultate precalculate · ${n} vieți pe condiție (semințele 1–${n})`);
}

// ---------------------------------------------------------------------------
buildLegends();
buildGauges();
bindControls();
newLife();
const lab = new LabView(document);
loadPrecomputed(lab);
onThemeChange(() => {
  buildLegends();
  updatePanels(true);
  if (lab.data) lab.show(lab.data, lab.source.textContent);
});
onResize([$('arena'), $('hormones')], () => updatePanels(true));
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
setRunning(!reduced);
requestAnimationFrame(frame);
