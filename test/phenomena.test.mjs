// Test de integrare (câteva vieți): fenomenele principale apar și dispar cum prezice modelul.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLife } from '../src/lab/experiment.js';

const SEEDS = [1, 2, 3];
const lives = (condition) => SEEDS.map((seed) => runLife({ condition, seed }));

test('fără substanță, organismul supraviețuiește tuturor încercărilor', () => {
  for (const r of lives('control')) assert.ok(r.survived, `seed ${r.seed} a murit (${r.deathCause})`);
});

test('cu substanța, organismul ajunge să se autodistrugă', () => {
  const rs = lives('full');
  for (const r of rs) {
    assert.ok(!r.survived, `seed ${r.seed} a supraviețuit`);
    assert.equal(r.deathPhase, 'substance');
    assert.ok(r.substance.neglect > 0.5, `neglijarea hranei: ${r.substance.neglect}`);
  }
});

test('fără sistemul de obișnuință, folosește substanța dar nu se autodistruge', () => {
  for (const r of lives('goal-only')) {
    assert.ok(r.substance.doses > 5);
    assert.ok(r.survived, `seed ${r.seed} a murit`);
  }
});

test('fără îngrijitor, nou-născutul nu supraviețuiește', () => {
  for (const r of lives('no-caregiver')) assert.equal(r.deathPhase, 'infancy');
});
