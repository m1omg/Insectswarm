// Behavioural tests for the hive.
//
// The two claims worth checking are the ones the scenario exists to demonstrate: that the dance is
// a working code which survives a round trip through a moving sun, and that the length of the
// unloading queue is what decides between recruiting foragers and recruiting receivers.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DT } from '../src/engine/loop.js';
import { makeRng } from '../src/engine/rng.js';
import {
  create, meta, PARAMS, NOTES, waggleDuration, waggleDistance, danceAngleFor, bearingFromDance,
} from '../src/sim/scenarios/honeybees.js';

const WORLD = { budget: { agents: 600, fieldWidth: 160 }, dt: DT, seed: 'bees' };

function runHive(seconds, seed = 'bees') {
  const hive = create(WORLD, makeRng(seed));
  for (let t = 0; t < Math.round(seconds / DT); t++) hive.step(DT);
  return hive;
}

test('every parameter carries a source', () => {
  for (const [name, param] of Object.entries(PARAMS)) {
    assert.ok(param.source, `PARAMS.${name} has no source`);
    assert.equal(typeof param.value, 'number', `PARAMS.${name}.value must be a number`);
    assert.ok('unit' in param, `PARAMS.${name} has no unit`);
  }
  assert.ok(NOTES.length >= 5);
  for (const note of NOTES) assert.ok(note.text && note.source);
});

/* ---------------------------------------------------------------- the code */

test('waggle duration tracks distance at about a second per kilometre', () => {
  // The headline figure from the literature.
  const atOneKm = waggleDuration(1000) - waggleDuration(0);
  assert.ok(Math.abs(atOneKm - 1.0) < 0.15, `1 km encoded as ${atOneKm.toFixed(2)} s of waggle`);

  // Monotonic, or the code would be ambiguous.
  let previous = -1;
  for (let d = 0; d <= 3000; d += 50) {
    const t = waggleDuration(d);
    assert.ok(t > previous, `duration should always increase: ${d} m gave ${t}`);
    previous = t;
  }

  // The slope is shallower beyond a kilometre, which is the documented two-segment shape.
  const nearSlope = (waggleDuration(1000) - waggleDuration(500)) / 500;
  const farSlope = (waggleDuration(2500) - waggleDuration(2000)) / 500;
  assert.ok(farSlope < nearSlope, `far slope ${farSlope} should be shallower than near ${nearSlope}`);
});

test('distance survives the round trip through the dance', () => {
  for (const metres of [50, 120, 400, 900, 1000, 1600, 2800]) {
    const decoded = waggleDistance(waggleDuration(metres), 1.0);
    assert.ok(Math.abs(decoded - metres) < 1, `${metres} m came back as ${decoded.toFixed(1)} m`);
  }
});

test('the dance is measured against the sun, not against north', () => {
  const bearingToFood = Math.PI / 2;          // due east in world terms

  // With the sun due east, food due east is danced straight up the comb.
  let angle = danceAngleFor(bearingToFood, Math.PI / 2);
  assert.ok(Math.abs(angle) < 1e-9, `expected straight up, got ${angle}`);

  // Six hours later the sun has moved; the same food must be danced at a different angle.
  const laterSun = Math.PI;                   // due south
  const laterAngle = danceAngleFor(bearingToFood, laterSun);
  assert.ok(Math.abs(laterAngle) > 1, 'the run angle must change as the sun moves');

  // But a follower decoding against the same sun recovers the same bearing, which is the point.
  assert.ok(Math.abs(bearingFromDance(laterAngle, laterSun) - bearingToFood) < 1e-9);
  assert.ok(Math.abs(bearingFromDance(angle, Math.PI / 2) - bearingToFood) < 1e-9);
});

test('a dancer re-references her dance as the sun moves across the day', () => {
  const hive = runHive(30);
  const { clock, danceContent, bees, TASK } = hive._internals;

  // Plant a dancer with a fixed memory of a patch due east.
  let i = -1;
  for (let k = 0; k < bees.highWater; k++) {
    if (bees.alive[k] && bees.inHive[k] && bees.caste[k] === 0) { i = k; break; }
  }
  assert.ok(i >= 0);
  bees.task[i] = TASK.WAGGLE;
  bees.memBearing[i] = 0;                  // due east in world coordinates
  bees.memDistance[i] = 800;
  bees.waggleRun[i] = waggleDuration(800);

  const morning = danceContent(i).angle;
  clock.day += 0.25;                       // six hours later
  const afternoon = danceContent(i).angle;

  assert.ok(Math.abs(afternoon - morning) > 0.3,
    `the run angle should rotate with the sun: ${morning.toFixed(2)} then ${afternoon.toFixed(2)}`);

  // The flowers have not moved, and neither has what she means.
  assert.equal(bees.memBearing[i], 0);
});

test('followers scatter around the target rather than landing on it', () => {
  const hive = runHive(30);
  const { bees, readDance, params, TASK } = hive._internals;

  let dancer = -1;
  for (let k = 0; k < bees.highWater; k++) {
    if (bees.alive[k] && bees.inHive[k] && bees.caste[k] === 0) { dancer = k; break; }
  }
  bees.task[dancer] = TASK.WAGGLE;
  bees.memBearing[dancer] = 0;
  bees.memDistance[dancer] = 600;
  bees.waggleRun[dancer] = waggleDuration(600);

  const bearings = [];
  const distances = [];
  for (let n = 0; n < 800; n++) {
    const read = readDance(dancer);
    bearings.push(read.bearingOut);
    distances.push(read.metres);
  }

  const meanBearing = bearings.reduce((a, b) => a + b, 0) / bearings.length;
  const sd = Math.sqrt(bearings.reduce((a, b) => a + (b - meanBearing) ** 2, 0) / bearings.length);
  const sdDegrees = (sd * 180) / Math.PI;

  // Unbiased on average, but genuinely scattered — which is what the measurements show.
  assert.ok(Math.abs(meanBearing) < 0.08, `followers should not be biased: mean ${meanBearing}`);
  assert.ok(Math.abs(sdDegrees - params.danceAngleScatter) < 4,
    `scatter should be about ${params.danceAngleScatter}°, measured ${sdDegrees.toFixed(1)}°`);

  const meanDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  assert.ok(Math.abs(meanDistance - 600) < 60, `mean decoded distance ${meanDistance.toFixed(0)} m`);
});

/* --------------------------------------------------- Seeley's regulation loop */

test('the hive forages, unloads and stores honey', () => {
  const hive = runHive(900);
  const { runtime, stores, patches } = hive._internals;

  assert.ok(patches.some((p) => p.discovered), 'no flower patch was ever found');
  assert.ok(runtime.tripsHome > 0, 'no forager came home');
  assert.ok(runtime.nectarCollected > 0, 'no nectar was collected');
  assert.ok(stores.get('honey') > 2200, `honey did not increase: ${stores.get('honey').toFixed(0)}`);
});

test('foragers waggle dance when unloading is quick', () => {
  const hive = runHive(900);
  const { runtime } = hive._internals;
  assert.ok(runtime.waggleDances > 0, 'nobody ever waggle danced');
  assert.ok(runtime.recruited > 0, 'no bee was ever recruited by a dance');
});

test('a longer unloading wait shifts foragers from waggle dancing to tremble dancing', () => {
  // Seeley's finding is about a probability shifting, not about one dance vanishing: the longer a
  // forager waits to be unloaded, the more likely she is to tremble rather than waggle. So the test
  // compares an unimpeded hive against one whose food storers keep being pulled off the job.
  //
  // Note that the starved hive cannot be driven to zero waggle dances, and should not be: tremble
  // dancers recruit new receivers, some foragers are then unloaded quickly, and those correctly
  // waggle. That negative feedback closing the loop is the mechanism working, not noise.
  const measure = (starve) => {
    const hive = create(WORLD, makeRng('tremble'));
    const { bees, runtime, TASK } = hive._internals;

    for (let t = 0; t < 600 / DT; t++) hive.step(DT);
    const waggleBefore = runtime.waggleDances;
    const trembleBefore = runtime.trembleDances;

    for (let t = 0; t < 900 / DT; t++) {
      if (starve) {
        for (let i = 0; i < bees.highWater; i++) {
          if (bees.alive[i] && bees.inHive[i] && bees.task[i] === TASK.RECEIVE) {
            bees.task[i] = TASK.NURSE;
            bees.taskTime[i] = 0;
          }
        }
      }
      hive.step(DT);
    }

    const waggle = runtime.waggleDances - waggleBefore;
    const tremble = runtime.trembleDances - trembleBefore;
    return {
      waggle,
      tremble,
      trembleShare: tremble / Math.max(1, waggle + tremble),
      meanWait: runtime.meanSearchTime,
    };
  };

  const normal = measure(false);
  const starved = measure(true);

  assert.ok(starved.tremble > 0, 'a hive that cannot unload should tremble dance');
  assert.ok(starved.meanWait > normal.meanWait,
    `starving receivers should lengthen the unload wait: ${normal.meanWait.toFixed(1)} s then ${starved.meanWait.toFixed(1)} s`);
  assert.ok(starved.trembleShare > normal.trembleShare * 2,
    `tremble share should rise sharply: ${(normal.trembleShare * 100).toFixed(1)}% normally vs `
    + `${(starved.trembleShare * 100).toFixed(1)}% when starved`);
});

test('tremble dancing recruits more receivers', () => {
  const hive = create(WORLD, makeRng('recruit'));
  const { bees, TASK } = hive._internals;

  for (let t = 0; t < 400 / DT; t++) hive.step(DT);

  const countReceivers = () => bees.countWhere((i) => bees.task[i] === TASK.RECEIVE);

  // Strip the receivers once, then let the colony respond on its own.
  for (let i = 0; i < bees.highWater; i++) {
    if (bees.alive[i] && bees.task[i] === TASK.RECEIVE) bees.task[i] = TASK.NURSE;
  }
  const stripped = countReceivers();

  for (let t = 0; t < 600 / DT; t++) hive.step(DT);
  const recovered = countReceivers();

  assert.ok(recovered > stripped,
    `the colony should put bees back on unloading duty: ${stripped} then ${recovered}`);
});

/* ------------------------------------------------------------ the rest of it */

test('the brood nest is held near 35 C through a day and a night', () => {
  const hive = create(WORLD, makeRng('thermo'));
  const { broodNestTemperature, params, clock } = hive._internals;

  for (let t = 0; t < 200 / DT; t++) hive.step(DT);

  // Regulation has to hold while the outside air swings, which is the whole point of it.
  let worst = 0;
  let coldestAir = Infinity;
  let hottestAir = -Infinity;
  for (let t = 0; t < clock.simSecondsPerDay / DT; t++) {
    hive.step(DT);
    worst = Math.max(worst, Math.abs(broodNestTemperature() - params.broodNestC));
    coldestAir = Math.min(coldestAir, clock.airTemperature());
    hottestAir = Math.max(hottestAir, clock.airTemperature());
  }

  assert.ok(hottestAir - coldestAir > 5, 'the air should have swung meaningfully over the day');
  assert.ok(worst < 2.5,
    `brood nest strayed ${worst.toFixed(2)}°C from target while air ranged `
    + `${coldestAir.toFixed(1)}-${hottestAir.toFixed(1)}°C`);
});

test('a heat wave provokes fanning and is brought back under control', () => {
  const hive = create(WORLD, makeRng('heat'));
  const { bees, TASK, perturbTemperature, broodNestTemperature, params } = hive._internals;
  for (let t = 0; t < 300 / DT; t++) hive.step(DT);

  perturbTemperature(8);
  assert.ok(broodNestTemperature() > params.broodNestC + 4, 'the perturbation should have landed');

  let fanned = 0;
  for (let t = 0; t < 400 / DT; t++) {
    hive.step(DT);
    fanned = Math.max(fanned, bees.countWhere((i) => bees.task[i] === TASK.FAN));
  }
  assert.ok(fanned > 0, 'nobody fanned when the comb overheated');
  assert.ok(broodNestTemperature() < params.broodNestC + 1.5,
    `the colony failed to cool the nest back down: ${broodNestTemperature().toFixed(1)}°C`);
});

test('age polyethism assigns the documented sequence', () => {
  const hive = runHive(20);
  const { roleForAge, TASK } = hive._internals;
  assert.equal(roleForAge(1), TASK.CLEAN);
  assert.equal(roleForAge(6), TASK.NURSE);
  assert.equal(roleForAge(14), TASK.RECEIVE);
  assert.equal(roleForAge(19), TASK.GUARD);
  assert.equal(roleForAge(25), TASK.IDLE);      // foraging age: available to follow a dance
});

test('the hive is deterministic for a seed', () => {
  const fingerprint = (hive) => {
    const { bees, stores, runtime } = hive._internals;
    let sum = 0;
    for (let i = 0; i < bees.highWater; i++) {
      if (!bees.alive[i]) continue;
      sum += bees.x[i] * 13 + bees.y[i] * 7 + bees.task[i];
    }
    return `${sum.toFixed(3)}|${stores.get('honey').toFixed(3)}|${runtime.tripsHome}`;
  };
  assert.equal(fingerprint(runHive(200, 'same')), fingerprint(runHive(200, 'same')));
  assert.notEqual(fingerprint(runHive(200, 'same')), fingerprint(runHive(200, 'other')));
});

test('bees stay inside their worlds', () => {
  const hive = runHive(600);
  const { bees } = hive._internals;
  for (let i = 0; i < bees.highWater; i++) {
    if (!bees.alive[i]) continue;
    const b = bees.inHive[i] ? meta.nestBounds : meta.fieldBounds;
    assert.ok(bees.x[i] >= b.x - 1e-3 && bees.x[i] <= b.x + b.w + 1e-3, `bee ${i} x=${bees.x[i]}`);
    assert.ok(bees.y[i] >= b.y - 1e-3 && bees.y[i] <= b.y + b.h + 1e-3, `bee ${i} y=${bees.y[i]}`);
  }
});
