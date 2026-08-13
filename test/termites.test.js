// Behavioural tests for the termite mound.
//
// The claim this scenario exists to demonstrate is that the mound is built without anybody
// designing it — so the tests are about the cues. Building must depend on them, different cues must
// give different structures, and switching them all off must stop construction dead.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DT } from '../src/engine/loop.js';
import { makeRng } from '../src/engine/rng.js';
import { SOLID } from '../src/engine/gridmask.js';
import { create, meta, PARAMS, NOTES } from '../src/sim/scenarios/termites.js';

const WORLD = { budget: { agents: 500, fieldWidth: 160 }, dt: DT, seed: 'termites' };

function runMound(seconds, seed = 'termites', configure = null) {
  const colony = create(WORLD, makeRng(seed));
  if (configure) configure(colony._internals);
  for (let t = 0; t < Math.round(seconds / DT); t++) colony.step(DT);
  return colony;
}

/** Count solid cells above the ground line — that is the mound proper. */
function moundMass(colony) {
  const { mound, GROUND_Y } = colony._internals;
  let n = 0;
  for (let row = 0; row < mound.rows; row++) {
    const y = mound.bounds.y + (row + 0.5) * mound.cellSize;
    if (y >= GROUND_Y) break;
    for (let col = 0; col < mound.cols; col++) {
      if (mound.cells[row * mound.cols + col] === SOLID) n++;
    }
  }
  return n;
}

test('every parameter carries a source', () => {
  for (const [name, param] of Object.entries(PARAMS)) {
    assert.ok(param.source, `PARAMS.${name} has no source`);
    assert.ok('unit' in param, `PARAMS.${name} has no unit`);
  }
  assert.ok(NOTES.length >= 5);
  for (const note of NOTES) assert.ok(note.text && note.source);
});

test('the science panel says the cement pheromone is unidentified', () => {
  // The project rule about not laundering a hypothesis into a fact. If this note ever quietly
  // disappears, the scenario is misrepresenting a live scientific question.
  const text = NOTES.map((n) => n.text).join(' ').toLowerCase();
  assert.ok(text.includes('never been chemically identified'),
    'the uncertainty about the cement pheromone must be stated in the notes');
  assert.ok(PARAMS.cementPheromoneWeight.source.toLowerCase().includes('never chemically identified'),
    'and in the parameter that implements it');
});

test('termites quarry soil and build with it', () => {
  const colony = runMound(900);
  const { runtime } = colony._internals;
  assert.ok(runtime.pelletsQuarried > 0, 'nobody dug anything out');
  assert.ok(runtime.pelletsPlaced > 0, 'nobody put anything down');
});

test('the mound grows', () => {
  const colony = create(WORLD, makeRng('growth'));
  const before = moundMass(colony);
  for (let t = 0; t < 1200 / DT; t++) colony.step(DT);
  const after = moundMass(colony);
  assert.ok(after > before, `mound did not grow: ${before} then ${after} cells`);
});

test('with every cue switched off, nothing gets built', () => {
  // The load-bearing test. If the mound still rises with no cues, then construction is being driven
  // by something hard-coded and the whole demonstration is a sham.
  const colony = create(WORLD, makeRng('nocues'));
  const p = colony._internals.params;
  p.cementPheromoneWeight = 0;
  p.curvatureWeight = 0;
  p.evaporationWeight = 0;

  const before = moundMass(colony);
  for (let t = 0; t < 1200 / DT; t++) colony.step(DT);
  const after = moundMass(colony);

  assert.ok(colony._internals.runtime.pelletsPlaced === 0,
    `${colony._internals.runtime.pelletsPlaced} pellets were placed with no cue to place them by`);
  assert.ok(after <= before, 'the mound grew with no building cue at all');
});

test('each cue on its own can build, and they do not build the same thing', () => {
  const only = (cue) => (internals) => {
    internals.params.cementPheromoneWeight = cue === 'cement' ? 1 : 0;
    internals.params.curvatureWeight = cue === 'curvature' ? 1 : 0;
    internals.params.evaporationWeight = cue === 'evaporation' ? 1 : 0;
  };

  const profile = (colony) => {
    // Height of the solid column in each grid row, which is the mound's silhouette.
    const { mound, GROUND_Y } = colony._internals;
    const heights = [];
    for (let col = 0; col < mound.cols; col++) {
      let top = 0;
      for (let row = 0; row < mound.rows; row++) {
        const y = mound.bounds.y + (row + 0.5) * mound.cellSize;
        if (y >= GROUND_Y) break;
        if (mound.cells[row * mound.cols + col] === SOLID) { top = GROUND_Y - y; break; }
      }
      heights.push(top);
    }
    return heights;
  };

  const cement = runMound(1200, 'shape', only('cement'));
  const curvature = runMound(1200, 'shape', only('curvature'));
  const evaporation = runMound(1200, 'shape', only('evaporation'));

  for (const [name, colony] of [['cement', cement], ['curvature', curvature], ['evaporation', evaporation]]) {
    assert.ok(colony._internals.runtime.pelletsPlaced > 0, `${name} alone built nothing`);
  }

  // Roughness of the silhouette: pillars give a jagged profile, smooth accretion an even one.
  const roughness = (h) => {
    let sum = 0;
    for (let i = 1; i < h.length; i++) sum += Math.abs(h[i] - h[i - 1]);
    return sum;
  };

  const shapes = [profile(cement), profile(curvature), profile(evaporation)].map(roughness);
  const allSame = shapes.every((s) => Math.abs(s - shapes[0]) < 1e-9);
  assert.ok(!allSame, `the three cues produced identical silhouettes: ${shapes.join(', ')}`);
});

test('a breach draws soldiers and gets sealed', () => {
  const colony = create(WORLD, makeRng('breach'));
  const { openBreach, breaches, termites, TASK, GROUND_Y, mound } = colony._internals;

  for (let t = 0; t < 300 / DT; t++) colony.step(DT);

  openBreach(mound.bounds.w * 0.5, GROUND_Y - 0.10, 0.10);
  assert.equal(breaches.length, 1);

  let maxDefending = 0;
  for (let t = 0; t < 1500 / DT; t++) {
    colony.step(DT);
    maxDefending = Math.max(maxDefending, termites.countWhere((i) => termites.task[i] === TASK.DEFEND));
  }

  assert.ok(maxDefending > 0, 'no soldier ever went to the breach');
  assert.ok(breaches[0].sealed > 0, 'no repair work was done on the breach at all');
});

test('the mound is a lung: breaching it flushes the nest, and the colony closes it again', () => {
  const colony = create(WORLD, makeRng('vent'));
  const { openBreach, nestState, GROUND_Y, mound, breaches } = colony._internals;

  for (let t = 0; t < 900 / DT; t++) colony.step(DT);
  const intactCO2 = nestState().co2;
  assert.ok(intactCO2 > 0.5, `an intact mound should hold CO2 well above outside air, got ${intactCO2.toFixed(2)}%`);

  openBreach(mound.bounds.w * 0.5, GROUND_Y - 0.06, 0.16);

  // Measure while the hole is still open. Wait too long and the answer changes, because the
  // termites will have repaired it — which is worth asserting separately rather than tripping over.
  for (let t = 0; t < 12 / DT; t++) colony.step(DT);
  const ventedCO2 = nestState().co2;
  assert.ok(ventedCO2 < intactCO2 * 0.6,
    `CO2 should fall sharply when the mound is opened: ${intactCO2.toFixed(2)}% then ${ventedCO2.toFixed(2)}%`);

  // And then the colony should shut it, which is the other half of what the wall is for.
  for (let t = 0; t < 400 / DT; t++) colony.step(DT);
  assert.equal(breaches[0].sealed, 1, 'the colony failed to close the breach');
  assert.ok(nestState().co2 > ventedCO2,
    'once sealed, the nest should be holding its atmosphere again');
});

test('nest air stays in the range termites actually tolerate', () => {
  const colony = runMound(1800);
  const { co2, temp } = colony._internals.nestState();
  // Nest CO2 runs at a few per cent — lethal to most insects, ordinary for these.
  assert.ok(co2 > 0.2 && co2 < 9, `nest CO2 was ${co2.toFixed(2)}%`);
  assert.ok(temp > 15 && temp < 45, `nest temperature was ${temp.toFixed(1)}°C`);
});

test('the fungus comb feeds the colony and needs litter', () => {
  const colony = runMound(1200);
  const { stores, runtime } = colony._internals;
  assert.ok(runtime.litterBrought > 0, 'no plant litter was ever collected');
  assert.ok(stores.get('fungus') > 0, 'the fungus comb vanished entirely');
});

test('the caste ratio is roughly the published one', () => {
  const colony = runMound(600);
  const { termites, CASTE, params } = colony._internals;
  const soldiers = termites.countWhere((i) => termites.caste[i] === CASTE.SOLDIER);
  const share = soldiers / termites.count;
  assert.ok(Math.abs(share - params.soldierFraction) < 0.08,
    `soldiers were ${(share * 100).toFixed(1)}% of the colony, expected about ${(params.soldierFraction * 100).toFixed(0)}%`);
});

test('the mound is deterministic for a seed', () => {
  const fingerprint = (colony) => {
    const { termites, runtime, mound } = colony._internals;
    let sum = 0;
    for (let i = 0; i < termites.highWater; i++) {
      if (!termites.alive[i]) continue;
      sum += termites.x[i] * 7 + termites.y[i] * 3 + termites.task[i];
    }
    return `${sum.toFixed(3)}|${runtime.pelletsPlaced}|${mound.version}`;
  };
  assert.equal(fingerprint(runMound(300, 'same')), fingerprint(runMound(300, 'same')));
  assert.notEqual(fingerprint(runMound(300, 'same')), fingerprint(runMound(300, 'other')));
});

test('termites stay inside their worlds and out of solid soil', () => {
  const colony = runMound(900);
  const { termites, mound } = colony._internals;
  let embedded = 0;
  for (let i = 0; i < termites.highWater; i++) {
    if (!termites.alive[i]) continue;
    const b = termites.inMound[i] ? meta.nestBounds : meta.fieldBounds;
    assert.ok(termites.x[i] >= b.x - 1e-3 && termites.x[i] <= b.x + b.w + 1e-3, `termite ${i} x=${termites.x[i]}`);
    assert.ok(termites.y[i] >= b.y - 1e-3 && termites.y[i] <= b.y + b.h + 1e-3, `termite ${i} y=${termites.y[i]}`);
    if (termites.inMound[i] && mound.isSolid(termites.x[i], termites.y[i])) embedded++;
  }
  // A few can be caught by a pellet landing on them; a lot means movement is broken.
  assert.ok(embedded < termites.count * 0.1, `${embedded} of ${termites.count} termites are inside solid soil`);
});
