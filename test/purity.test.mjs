// Organismul nu are cunoștințe preexistente și nici etichete emoționale în cod.
// Testul citește sursa modulelor organismului și caută orice urmă de semantică.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeParams } from '../src/core/params.js';
import { World } from '../src/core/world.js';
import { createRng } from '../src/core/rng.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');
const ORGANISM_FILES = ['organism.js', 'brain.js', 'body.js', 'endocrine.js', 'math.js'];

// Elimină comentariile: explicațiile pot numi concepte, codul nu.
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const FORBIDDEN = [
  // obiectele lumii
  'food', 'hran', 'nutrient', 'husk', 'thorn', 'spin', 'danger', 'pericol', 'hazard', 'predator', 'prădăt',
  'drug', 'drog', 'substan', 'stone', 'piatr', 'kind',
  // etichete emoționale
  'fear', 'frica', 'frică', 'frustr', 'apat', 'calm', 'euphor', 'eufor', 'emotion', 'emoți', 'anger', 'furie',
  'happy', 'sad', 'anxi',
];

for (const file of ORGANISM_FILES) {
  test(`${file} nu conține cunoștințe despre lume sau etichete emoționale`, () => {
    const code = codeOnly(readFileSync(join(root, file), 'utf8')).toLowerCase();
    for (const word of FORBIDDEN) {
      assert.ok(!code.includes(word), `${file} conține "${word}"`);
    }
  });

  test(`${file} nu importă mediul, protocolul sau observatorul`, () => {
    const code = codeOnly(readFileSync(join(root, file), 'utf8'));
    for (const forbidden of ['world.js', 'simulation.js', 'params.js', 'observer']) {
      assert.ok(!code.includes(forbidden), `${file} importă ${forbidden}`);
    }
  });
}

test('percepția nu transmite tipul obiectelor, doar nuanța și poziția', () => {
  const world = new World(makeParams(), createRng(1));
  world.populate({ x: 50, y: 35 });
  const seen = world.sense(50, 35, 200);
  assert.ok(seen.length > 0);
  for (const s of seen) assert.deepEqual(Object.keys(s).sort(), ['hue', 'id', 'r', 'x', 'y']);
});
