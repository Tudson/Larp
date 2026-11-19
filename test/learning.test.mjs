import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionParams, DEFAULT_PARAMS } from '../src/core/params.js';
import { Simulation } from '../src/core/simulation.js';
import { HueCode, HueMap, ExtinguishableMap } from '../src/core/math.js';

const hueOf = (kind) => DEFAULT_PARAMS.kinds[kind].hue;

test('la naștere, organismul nu știe nimic: toate asocierile sunt zero', () => {
  const sim = new Simulation({ seed: 3, params: conditionParams('control') });
  const b = sim.organism.brain;
  for (const map of [b.expectEnergy, b.expectPain, b.expectMalaise, b.expectHedonic, b.habit]) {
    assert.ok(map.w.every((w) => w === 0));
  }
});

test('după copilărie, a învățat singur ce hrănește și ce doare', () => {
  for (const seed of [1, 2, 3]) {
    const sim = new Simulation({ seed, params: conditionParams('control') });
    sim.runUntil(DEFAULT_PARAMS.protocol.infancyEnd);
    const b = sim.organism.brain;
    const food = b.code.encode(hueOf('nutrient'));
    const thorn = b.code.encode(hueOf('thorn'));
    const stone = b.code.encode(hueOf('stone'));
    assert.ok(b.expectEnergy.predict(food) > 0.1, `seed ${seed}: hrana nu a fost învățată`);
    assert.ok(b.expectPain.predict(thorn) > 0.02, `seed ${seed}: durerea nu a fost învățată`);
    assert.ok(Math.abs(b.expectEnergy.predict(stone)) < 0.05, `seed ${seed}: pietrele nu ar trebui să hrănească`);
  }
});

test('regula delta mută predicția exact cu rata × eroarea', () => {
  const code = new HueCode(24, 8);
  const map = new HueMap(code);
  const phi = code.encode(100);
  map.update(phi, 1, 0.3);
  assert.ok(Math.abs(map.predict(phi) - 0.3) < 1e-12);
});

test('stingerea nu șterge: asocierea revine spontan după o pauză', () => {
  const code = new HueCode(24, 8);
  const map = new ExtinguishableMap(code, 150);
  const phi = code.encode(125);
  for (let i = 0; i < 20; i++) map.update(phi, 0.2 - map.predict(phi), 0.3); // achiziție
  const learned = map.predict(phi);
  for (let i = 0; i < 20; i++) map.update(phi, 0 - map.predict(phi), 0.3); // stingere
  const extinguished = map.predict(phi);
  for (let t = 0; t < 600; t += 1) map.relax(1); // 10 minute fără experiență
  const recovered = map.predict(phi);
  assert.ok(extinguished < 0.05 * learned + 1e-3);
  assert.ok(recovered > 0.9 * learned);
});
