import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionParams } from '../src/core/params.js';
import { Simulation } from '../src/core/simulation.js';
import { Observer } from '../src/observer/observer.js';

function trajectory(withObserver, seed, until) {
  const sim = new Simulation({ seed, params: conditionParams('full') });
  const obs = withObserver ? new Observer(sim) : null;
  const out = [];
  while (!sim.finished && sim.time < until) {
    sim.step();
    if (obs) obs.observe();
    if (sim.steps % 50 === 0) {
      const o = sim.organism;
      out.push([o.x, o.y, o.body.energy, o.body.integrity, o.endocrine.cortisol, o.endocrine.daNorm]);
    }
  }
  return out;
}

test('observatorul e pasiv: aceeași viață cu sau fără el', () => {
  const a = trajectory(false, 5, 1600);
  const b = trajectory(true, 5, 1600);
  assert.deepEqual(a, b);
});

test('determinism: aceeași sămânță dă aceeași viață, alta dă alta', () => {
  assert.deepEqual(trajectory(false, 7, 600), trajectory(false, 7, 600));
  assert.notDeepEqual(trajectory(false, 7, 600), trajectory(false, 8, 600));
});
