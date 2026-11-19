import { CONDITIONS, conditionParams } from '../core/params.js';
import { Simulation } from '../core/simulation.js';
import { Observer } from '../observer/observer.js';
import { summarize } from '../observer/metrics.js';

/**
 * Laboratorul: aceleași vieți (aceleași semințe) trecute prin condiții diferite.
 * Folosit atât de pagina vizuală, cât și de `experiments/run.mjs` (Node).
 */

export function runLife({ condition, seed, extra = {} }) {
  const params = conditionParams(condition, extra);
  const sim = new Simulation({ seed, params });
  const observer = new Observer(sim);
  while (!sim.finished) {
    sim.step();
    observer.observe();
  }
  return summarize(sim, observer);
}

// Generator: cedează controlul după fiecare viață, ca interfața să rămână fluidă.
export function* runExperiment({ conditions = CONDITIONS.map((c) => c.id), seeds, extra = {} }) {
  for (const condition of conditions) {
    for (const seed of seeds) {
      yield { condition, seed, summary: runLife({ condition, seed, extra }) };
    }
  }
}

export function quantile(values, q) {
  const xs = values.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

const pick = (rows, path) => rows.map((r) => path.split('.').reduce((o, k) => (o == null ? null : o[k]), r));

// Sumar pe condiții: supraviețuire, cauze de moarte, mediane (cu intervalul intercuartilic).
export function aggregate(results, maxTime) {
  const byCondition = new Map();
  for (const r of results) {
    if (!byCondition.has(r.condition)) byCondition.set(r.condition, []);
    byCondition.get(r.condition).push(r.summary);
  }
  const out = [];
  for (const c of CONDITIONS) {
    const rows = byCondition.get(c.id);
    if (!rows) continue;
    const stat = (path) => {
      const v = pick(rows, path);
      return { median: quantile(v, 0.5), q1: quantile(v, 0.25), q3: quantile(v, 0.75) };
    };
    const causes = {};
    for (const r of rows) if (!r.survived) causes[`${r.deathPhase}:${r.deathCause}`] = (causes[`${r.deathPhase}:${r.deathCause}`] ?? 0) + 1;
    // Curba de supraviețuire (fracția încă în viață la fiecare moment).
    const steps = 120;
    const curve = [];
    for (let i = 0; i <= steps; i++) {
      const t = (maxTime * i) / steps;
      curve.push({ t, alive: rows.filter((r) => r.survived || r.deathTime > t).length / rows.length });
    }
    out.push({
      id: c.id,
      label: c.label,
      short: c.short,
      description: c.description,
      n: rows.length,
      survived: rows.filter((r) => r.survived).length,
      causes,
      curve,
      deathTime: stat('deathTime'),
      doses: stat('substance.doses'),
      neglect: stat('substance.neglect'),
      mealsBefore: stat('substance.mealsPerMinuteBefore'),
      mealsAfter: stat('substance.mealsPerMinuteAfter'),
      injuriesBefore: stat('substance.injuriesPerMinuteBefore'),
      injuriesAfter: stat('substance.injuriesPerMinuteAfter'),
      want: stat('substance.wantFinal'),
      like: stat('substance.likeFinal'),
      receptor: stat('substance.receptorFinal'),
      organLoad: stat('substance.organLoadFinal'),
      interventions: stat('infancy.interventions'),
      stressDuration: stat('shock.stressDuration'),
      exploreBefore: stat('shock.exploreBefore'),
      exploreAfter: stat('shock.exploreAfter'),
      attentionBefore: stat('shock.attentionBefore'),
      attentionAfter: stat('shock.attentionAfter'),
      attemptsEarly: stat('famine.attemptsEarly'),
      attemptsLate: stat('famine.attemptsLate'),
      famineDopamine: stat('famine.dopamineMin'),
    });
  }
  return out;
}
