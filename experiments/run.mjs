#!/usr/bin/env node
// Rulează toate condițiile experimentale pe aceleași semințe și salvează rezultatele.
//   node experiments/run.mjs            (24 de vieți pe condiție)
//   node experiments/run.mjs --seeds 8  (mai rapid)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONDITIONS, DEFAULT_PARAMS } from '../src/core/params.js';
import { runExperiment, aggregate } from '../src/lab/experiment.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const nSeeds = Number(flag('--seeds', 24));
const only = flag('--only', null);
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'results');

const seeds = Array.from({ length: nSeeds }, (_, i) => i + 1);
const conditions = only ? only.split(',') : CONDITIONS.map((c) => c.id);
const results = [];
const t0 = Date.now();
for (const r of runExperiment({ conditions, seeds })) {
  results.push(r);
  process.stdout.write(`\r${results.length}/${conditions.length * seeds.length} vieți`);
}
process.stdout.write(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);

const maxTime = DEFAULT_PARAMS.protocol.maxTime;
const summary = aggregate(results, maxTime);
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'summary.json'),
  JSON.stringify({ generated: new Date().toISOString(), seeds, maxTime, substanceStart: DEFAULT_PARAMS.protocol.substanceStart, conditions: summary }, null, 1),
);
writeFileSync(join(outDir, 'lives.json'), JSON.stringify(results.map((r) => ({ condition: r.condition, ...r.summary }))));

// Raport text
const fmt = (s, d = 2) => (s.median === null ? '—' : `${s.median.toFixed(d)} (${s.q1.toFixed(d)}–${s.q3.toFixed(d)})`);
const causeRo = { starvation: 'inaniție', toxicity: 'intoxicație', trauma: 'leziuni' };
const phaseRo = { infancy: 'copilărie', autonomy: 'autonomie', trials: 'încercări', substance: 'faza 4' };
const lines = [
  `# Rezultate experimentale`,
  ``,
  `${nSeeds} vieți pe condiție (semințele 1–${nSeeds}), orizont ${maxTime} s. Valori: mediana (quartila 1–quartila 3).`,
  ``,
  `| Condiție | Supraviețuiesc | Decese (faza: cauza) | Moarte la (s) | Doze | Neglijarea hranei | Leziuni/min înainte → după |`,
  `|---|---|---|---|---|---|---|`,
];
for (const c of summary) {
  const causes = Object.entries(c.causes)
    .map(([k, v]) => {
      const [ph, ca] = k.split(':');
      return `${v}× ${phaseRo[ph] ?? ph}: ${causeRo[ca] ?? ca}`;
    })
    .join(', ') || '—';
  lines.push(
    `| ${c.label} | ${c.survived}/${c.n} | ${causes} | ${fmt(c.deathTime, 0)} | ${fmt(c.doses, 0)} | ${fmt(c.neglect)} | ${fmt(c.injuriesBefore, 3)} → ${fmt(c.injuriesAfter, 3)} |`,
  );
}
const full = summary.find((c) => c.id === 'full');
if (full) {
  lines.push(
    ``,
    `## Model complet: semnături`,
    ``,
    `- Intervenții ale îngrijitorului: ${fmt(full.interventions, 0)}`,
    `- Cortizol peste prag după plecarea prădătorului: ${fmt(full.stressDuration, 0)} s`,
    `- Sloturi de atenție înainte → după șoc: ${fmt(full.attentionBefore, 1)} → ${fmt(full.attentionAfter, 1)}`,
    `- Încercări de a mânca momelile goale (pe minut), prima → a doua jumătate: ${fmt(full.attemptsEarly)} → ${fmt(full.attemptsLate)}`,
    `- Dopamina minimă în foamete: ${fmt(full.famineDopamine)} (1 = normal)`,
    `- La final: dorință ${fmt(full.want)} vs plăcere așteptată ${fmt(full.like)}; receptori ${fmt(full.receptor)}; leziune de organ ${fmt(full.organLoad)}`,
  );
}
writeFileSync(join(outDir, 'RESULTS.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
