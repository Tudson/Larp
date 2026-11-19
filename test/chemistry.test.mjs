import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeParams } from '../src/core/params.js';
import { Endocrine } from '../src/core/endocrine.js';
import { Body } from '../src/core/body.js';

function exposedBody(params, level) {
  const body = new Body(params.body);
  body.energy = 0.8;
  body.blood = level;
  body.bloodAgonism = params.kinds.substance.agonism;
  body.bloodClearance = 1e9;
  return body;
}

test('expunerea susținută produce toleranță; oprirea ei produce sevraj', () => {
  const params = makeParams();
  const endo = new Endocrine(params.endocrine);
  const body = exposedBody(params, 1);
  const step = () => endo.step(0.1, { body, painRate: 0, threat: 0, drive: 0.05, buffered: false });
  step();
  const high = endo.daNorm; // efectul primei expuneri
  for (let i = 0; i < 8000; i++) step(); // ~13 minute
  assert.ok(endo.receptor < 0.6, `receptor ${endo.receptor}`);
  assert.ok(endo.daNorm < high, 'același nivel în sânge produce mai puțin efect');
  body.blood = 0;
  for (let i = 0; i < 300; i++) step(); // 30 s fără substanță
  assert.ok(endo.daNorm < 0.7, `dopamina în sevraj: ${endo.daNorm}`);
});

test('fără expunere, receptorii rămân aproape de normal', () => {
  const params = makeParams();
  const endo = new Endocrine(params.endocrine);
  const body = exposedBody(params, 0);
  for (let i = 0; i < 8000; i++) endo.step(0.1, { body, painRate: 0, threat: 0, drive: 0.05, buffered: false });
  assert.ok(endo.receptor > 0.85 && endo.receptor < 1.15, `receptor ${endo.receptor}`);
});

test('durerea ridică noradrenalina rapid și cortizolul lent, iar cortizolul persistă', () => {
  const params = makeParams();
  const endo = new Endocrine(params.endocrine);
  const body = exposedBody(params, 0);
  const step = (pain) => endo.step(0.1, { body, painRate: pain, threat: 0, drive: 0.05, buffered: false });
  for (let i = 0; i < 20; i++) step(0.5);
  const ne = endo.noradrenaline;
  const cort = endo.cortisol;
  for (let i = 0; i < 300; i++) step(0); // 30 s după
  assert.ok(endo.noradrenaline < 0.5 * ne, 'noradrenalina revine repede');
  assert.ok(endo.cortisol > 0.6 * cort, 'cortizolul rămâne ridicat');
});
