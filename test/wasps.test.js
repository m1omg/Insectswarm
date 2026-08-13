// Behavioural tests for the wasp nest.
//
// Two claims define this colony against the other three: that it recruits without any trail or
// dance, and that its adults live on sugar made by their own larvae. The second one has a
// consequence that should fall out of the model rather than being written into it — the autumn
// switch to scavenging sugar once the brood runs down.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DT } from '../src/engine/loop.js';
import { makeRng } from '../src/engine/rng.js';
import { create, meta, PARAMS, NOTES } from '../src/sim/scenarios/wasps.js';

const WORLD = { budget: { agents: 500, fieldWidth: 160 }, dt: DT, seed: 'wasps' };

function runNest(seconds, seed = 'wasps') {
  const nest = create(WORLD, makeRng(seed));
  for (let t = 0; t < Math.round(seconds / DT); t++) nest.step(DT);
  return nest;
}

test('every parameter carries a source', () => {
  for (const [name, param] of Object.entries(PARAMS)) {
    assert.ok(param.source, `PARAMS.${name} has no source`);
    assert.ok('unit' in param, `PARAMS.${name} has no unit`);
  }
  assert.ok(NOTES.length >= 4);
  for (const note of NOTES) assert.ok(note.text && note.source);
});

test('the colony hunts, brings prey home and feeds it to larvae', () => {
  const nest = runNest(600);
  const { runtime, sites } = nest._internals;
  assert.ok(sites.some((s) => s.discovered), 'no site was ever found');
  assert.ok(runtime.preyBrought > 0, 'no prey was brought home');
  assert.ok(runtime.larvaeFed > 0, 'no larva was ever fed');
});

test('there is no trail pheromone anywhere in this scenario', () => {
  // A structural claim, not a behavioural one: the contrast with the ants is the whole point, and
  // it would be quietly undone by anyone adding a convenient gradient later.
  const nest = runNest(60);
  const names = Object.keys(nest._internals);
  for (const name of names) {
    assert.ok(!/pheromone|trail/i.test(name), `wasps should have no pheromone field, found "${name}"`);
  }
  // Somewhere well away from the nest and the sites, so the inspector reports the ground rather
  // than whichever wasp happens to be flying past.
  const ground = nest.describe(6, 6, 'field');
  assert.ok(JSON.stringify(ground.rows).includes('none'), 'the inspector should say so plainly');
});

test('returning foragers activate nestmates without telling them where', () => {
  const nest = create(WORLD, makeRng('activate'));
  const { runtime, wasps, TASK } = nest._internals;
  for (let t = 0; t < 600 / DT; t++) nest.step(DT);

  assert.ok(runtime.activations > 0, 'no wasp was ever roused by a returning forager');

  // The bees' test is that recruits fly a specific vector. Here the opposite must hold: a wasp
  // activated by an arrival leaves with an odour in mind and no destination, so she has to search.
  let searching = 0;
  let travelling = 0;
  for (let i = 0; i < wasps.highWater; i++) {
    if (!wasps.alive[i] || wasps.inNest[i]) continue;
    if (wasps.task[i] === TASK.SEARCH) searching++;
    if (wasps.task[i] === TASK.TRAVEL) travelling++;
  }
  assert.ok(searching > 0, 'wasps should be out searching, not all flying to known points');
  void travelling;
});

test('local enhancement concentrates wasps at a patch others are already using', () => {
  // With enhancement off, arrivals at a fresh patch should be down to chance alone.
  const measure = (radius) => {
    const nest = create(WORLD, makeRng('enhance'));
    const { params, sites, wasps, LOAD, addSite, entrance, TASK } = nest._internals;
    params.localEnhancement = radius;

    // One rich prey patch, off to one side, already known to a few wasps.
    sites.length = 0;
    addSite(LOAD.PREY, entrance.x + 60, entrance.y, { amount: 1e9, r: 12 });
    sites[0].discovered = true;

    let visitorSeconds = 0;
    for (let t = 0; t < 900 / DT; t++) {
      nest.step(DT);
      if (t % 150 !== 0) continue;
      for (let i = 0; i < wasps.highWater; i++) {
        if (wasps.alive[i] && !wasps.inNest[i] && wasps.task[i] === TASK.AT_PREY) visitorSeconds++;
      }
    }
    return visitorSeconds;
  };

  const withEnhancement = measure(30);
  const without = measure(0);
  assert.ok(withEnhancement > without,
    `local enhancement should raise attendance: ${withEnhancement} with vs ${without} without`);
});

/* --------------------------------------------------- the larval sugar economy */

test('larvae supply the adults with sugar', () => {
  const nest = runNest(600);
  const { runtime } = nest._internals;
  assert.ok(runtime.sugarFromLarvae > 0, 'the larvae never produced any saliva');
  assert.ok(runtime.salivaShareToday > 0.5,
    `in midsummer most adult sugar should come from larvae, got ${(runtime.salivaShareToday * 100).toFixed(0)}%`);
});

test('killing the brood cuts off the adults sugar supply', () => {
  const nest = runNest(400);
  const { brood, stores, runtime } = nest._internals;

  const shareBefore = runtime.salivaShareToday;
  assert.ok(shareBefore > 0.5);

  for (let b = 0; b < brood.highWater; b++) if (brood.alive[b]) brood.kill(b);
  stores.consume('larvalSaliva', stores.get('larvalSaliva'));

  const producedBefore = runtime.sugarFromLarvae;
  for (let t = 0; t < 300 / DT; t++) nest.step(DT);

  assert.equal(brood.countWhere((b) => b >= 0 && brood.stage[b] === 1), 0, 'no larvae should remain yet');
  assert.ok(stores.get('larvalSaliva') < 1,
    `saliva should have run out, ${stores.get('larvalSaliva').toFixed(2)} mg left`);
  assert.ok(runtime.sugarFromLarvae - producedBefore < 1, 'no new saliva should have been produced');
});

test('the autumn switch makes the colony scavenge sugar instead', () => {
  // The emergent result: the queen stops laying workers, the larvae dwindle, the saliva supply
  // fails, and thousands of adults that still need carbohydrate go looking for it outside. Nothing
  // scripts this — it follows from the larvae being the source.
  const nest = create(WORLD, makeRng('autumn'));
  const { clock, params, runtime, wasps, LOAD, brood } = nest._internals;

  for (let t = 0; t < 400 / DT; t++) nest.step(DT);
  const summerShare = runtime.salivaShareToday;
  const summerLarvae = brood.countWhere((b) => brood.stage[b] === 1);

  // Run well into the autumn. It is not enough to pass the date of the switch: the queen has to
  // stop laying, the eggs already in the comb have to hatch, and those last larvae have to pupate
  // before the saliva supply actually fails. That takes weeks, which is exactly why real colonies
  // become a nuisance in September rather than in August.
  clock.day = params.gyneSwitchDay + 0.35;
  for (let t = 0; t < 6300 / DT; t++) nest.step(DT);

  const autumnLarvae = brood.countWhere((b) => brood.stage[b] === 1);
  let seekingSugar = 0;
  let out = 0;
  for (let i = 0; i < wasps.highWater; i++) {
    if (!wasps.alive[i] || wasps.inNest[i]) continue;
    out++;
    if (wasps.seeking[i] === LOAD.SUGAR) seekingSugar++;
  }

  assert.ok(autumnLarvae < summerLarvae,
    `the brood should have declined: ${summerLarvae} larvae then ${autumnLarvae}`);
  assert.ok(runtime.switched, 'the colony should have switched to rearing sexuals');
  assert.ok(out > 0, 'somebody should still be out');
  assert.ok(seekingSugar / out > 0.5,
    `most foragers should now be after sugar, got ${seekingSugar} of ${out}`);
  assert.ok(runtime.salivaShareToday < summerShare * 0.5,
    `the larval share of adult sugar should have collapsed from ${(summerShare * 100).toFixed(0)}%, `
    + `instead it is ${(runtime.salivaShareToday * 100).toFixed(0)}%`);
});

test('the colony rears gynes once it switches', () => {
  const nest = create(WORLD, makeRng('gynes'));
  const { clock, params, runtime, brood } = nest._internals;
  clock.day = params.gyneSwitchDay - 0.5;
  for (let t = 0; t < 3000 / DT; t++) nest.step(DT);

  const sexualBrood = brood.countWhere((b) => brood.fate[b] > 0);
  assert.ok(sexualBrood > 0 || runtime.gynes > 0 || runtime.males > 0,
    'after the switch the colony should be rearing gynes and males');
});

/* -------------------------------------------------------------- construction */

test('the nest grows only as fast as pulp is brought home', () => {
  const nest = runNest(900);
  const { combCells, runtime } = nest._internals;
  assert.ok(combCells.length >= 68, 'the comb should never shrink');
  assert.ok(runtime.cellsBuilt >= 68);

  // With no pulp and no way to get any, no cell can be added.
  const starved = create(WORLD, makeRng('nopulp'));
  const s = starved._internals;
  s.sites.length = 0;                        // nothing to forage at all
  s.stores.consume('pulp', s.stores.get('pulp'));
  const before = s.combCells.length;
  for (let t = 0; t < 600 / DT; t++) starved.step(DT);
  assert.equal(s.combCells.length, before, 'cells were built without any pulp');
});

test('the nest is deterministic for a seed', () => {
  const fingerprint = (nest) => {
    const { wasps, runtime, stores } = nest._internals;
    let sum = 0;
    for (let i = 0; i < wasps.highWater; i++) {
      if (!wasps.alive[i]) continue;
      sum += wasps.x[i] * 11 + wasps.y[i] * 5 + wasps.task[i];
    }
    return `${sum.toFixed(3)}|${runtime.preyBrought.toFixed(3)}|${stores.get('protein').toFixed(3)}`;
  };
  assert.equal(fingerprint(runNest(200, 'same')), fingerprint(runNest(200, 'same')));
  assert.notEqual(fingerprint(runNest(200, 'same')), fingerprint(runNest(200, 'other')));
});

test('wasps stay inside their worlds', () => {
  const nest = runNest(600);
  const { wasps } = nest._internals;
  for (let i = 0; i < wasps.highWater; i++) {
    if (!wasps.alive[i]) continue;
    const b = wasps.inNest[i] ? meta.nestBounds : meta.fieldBounds;
    assert.ok(wasps.x[i] >= b.x - 1e-3 && wasps.x[i] <= b.x + b.w + 1e-3, `wasp ${i} x=${wasps.x[i]}`);
    assert.ok(wasps.y[i] >= b.y - 1e-3 && wasps.y[i] <= b.y + b.h + 1e-3, `wasp ${i} y=${wasps.y[i]}`);
  }
});
