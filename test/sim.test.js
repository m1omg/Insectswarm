// Unit tests for the shared simulation core: fields, neighbour queries, steering maths and the
// colony calendar. These are the pieces every scenario depends on being right.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Field, decayFromHalfLife } from '../src/engine/field.js';
import { SpatialHash } from '../src/engine/spatial.js';
import { createPool, MOTION_SCHEMA } from '../src/engine/agents.js';
import { makeRng } from '../src/engine/rng.js';
import {
  wrapAngle, angleDiff, turnToward, branchProbability, bilateralTurn,
  accumulateHomeVector, homeBearing, advance,
} from '../src/sim/behaviour.js';
import { SeasonClock, Stores, developmentRate, advanceBrood, createBroodPool, STAGE } from '../src/sim/colony.js';

const BOUNDS = { x: 0, y: 0, w: 10, h: 10 };

/* --------------------------------------------------------------------- field */

test('field decays at its stated half-life', () => {
  const field = new Field(BOUNDS, 32, { halfLifeMinutes: 45 });
  field.deposit(5, 5, 100);
  const initial = field.sample(5, 5);

  // Advance 45 simulated minutes in ticks, as the simulation would.
  for (let t = 0; t < 45 * 60 * 60; t++) field.update(1 / 60);

  const after = field.sample(5, 5);
  assert.ok(Math.abs(after / initial - 0.5) < 0.01, `expected half, got ${(after / initial).toFixed(3)}`);
});

test('an eternal field does not decay', () => {
  const field = new Field(BOUNDS, 16, { halfLifeMinutes: Infinity });
  field.deposit(5, 5, 10);
  const before = field.sample(5, 5);
  for (let t = 0; t < 6000; t++) field.update(1 / 60);
  assert.equal(field.sample(5, 5), before);
});

test('decayFromHalfLife agrees with the field', () => {
  // Two half-lives must leave a quarter.
  assert.ok(Math.abs(decayFromHalfLife(10, 20 * 60) - 0.25) < 1e-9);
  assert.equal(decayFromHalfLife(Infinity, 100), 1);
});

test('deposits are conserved and land where they were put', () => {
  const field = new Field(BOUNDS, 40, { halfLifeMinutes: Infinity });
  field.deposit(3.3, 7.1, 50);
  assert.ok(Math.abs(field.total() - 50) < 1e-3, `total ${field.total()}`);
  // The peak should be at the deposit, not somewhere else.
  assert.ok(field.sample(3.3, 7.1) > field.sample(3.3, 6.0));
  assert.ok(field.sample(3.3, 7.1) > field.sample(5.0, 7.1));
});

test('diffusion spreads without creating or destroying anything', () => {
  const field = new Field(BOUNDS, 32, { halfLifeMinutes: Infinity, diffusion: 0.3 });
  field.deposit(5, 5, 100);
  const before = field.total();
  for (let t = 0; t < 600; t++) field.update(1 / 60);
  assert.ok(Math.abs(field.total() - before) < 0.5, `total drifted to ${field.total()}`);
  // It should genuinely have spread out.
  assert.ok(field.sample(5, 5) < 100);
  assert.ok(field.sample(5.6, 5) > 0);
});

test('the gradient points uphill', () => {
  const field = new Field(BOUNDS, 40, { halfLifeMinutes: Infinity, diffusion: 0.4 });
  field.deposit(7, 5, 100);
  for (let t = 0; t < 300; t++) field.update(1 / 60);

  const out = [0, 0];
  field.gradient(5, 5, out);
  // From (5,5) the source lies in +x, so the x component should dominate and be positive.
  assert.ok(out[0] > 0, `dx ${out[0]}`);
  assert.ok(Math.abs(out[1]) < Math.abs(out[0]));
});

test('sampling outside the field clamps rather than exploding', () => {
  const field = new Field(BOUNDS, 16, { halfLifeMinutes: Infinity });
  field.deposit(0.1, 0.1, 10);
  assert.ok(Number.isFinite(field.sample(-100, -100)));
  assert.ok(Number.isFinite(field.sample(1000, 1000)));

  field.deposit(-50, -50, 10);   // off-grid deposits are dropped, not wrapped
  assert.ok(Math.abs(field.total() - 10) < 1e-6);
});

test('a deposit in the corner keeps all of its material', () => {
  // An ant walking the edge of the world must lay the same strength of trail as one in the middle;
  // anything else is the grid leaking pheromone at the boundary.
  const middle = new Field(BOUNDS, 16, { halfLifeMinutes: Infinity });
  middle.deposit(5, 5, 10);

  const corner = new Field(BOUNDS, 16, { halfLifeMinutes: Infinity });
  corner.deposit(0.01, 0.01, 10);

  assert.ok(Math.abs(middle.total() - 10) < 1e-5, `middle ${middle.total()}`);
  assert.ok(Math.abs(corner.total() - 10) < 1e-5, `corner ${corner.total()}`);
  assert.ok(corner.sample(0.01, 0.01) > 0);
});

/* -------------------------------------------------------------- spatial hash */

test('the spatial hash agrees with brute force', () => {
  const rng = makeRng('hash');
  const n = 500;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = rng.range(0, 10);
    ys[i] = rng.range(0, 10);
  }

  const hash = new SpatialHash(BOUNDS, 1.0, n);
  hash.rebuild(xs, ys, n);
  assert.equal(hash.size, n);

  const radius = 0.8;
  for (const [qx, qy] of [[5, 5], [0.2, 9.8], [9.9, 0.1], [3.3, 7.7]]) {
    let expected = 0;
    for (let i = 0; i < n; i++) {
      if ((xs[i] - qx) ** 2 + (ys[i] - qy) ** 2 <= radius * radius) expected++;
    }
    assert.equal(hash.countNear(xs, ys, qx, qy, radius), expected, `at ${qx},${qy}`);
  }
});

test('the spatial hash finds the true nearest and honours the filter', () => {
  const xs = Float32Array.from([1, 2, 3, 4]);
  const ys = Float32Array.from([1, 1, 1, 1]);
  const hash = new SpatialHash(BOUNDS, 1.0, 4);
  hash.rebuild(xs, ys, 4);

  assert.equal(hash.nearest(xs, ys, 2.2, 1, 5), 1);
  assert.equal(hash.nearest(xs, ys, 2.2, 1, 5, (i) => i !== 1), 2);
  assert.equal(hash.nearest(xs, ys, 8, 8, 0.5), -1);
});

test('the spatial hash skips dead slots', () => {
  const xs = Float32Array.from([1, 1, 1]);
  const ys = Float32Array.from([1, 1, 1]);
  const alive = Uint8Array.from([1, 0, 1]);
  const hash = new SpatialHash(BOUNDS, 1.0, 3);
  hash.rebuild(xs, ys, 3, alive);
  assert.equal(hash.size, 2);
});

/* --------------------------------------------------------------- agent pools */

test('agent slots are recycled and identities are not reused', () => {
  const pool = createPool(4, MOTION_SCHEMA);
  const a = pool.spawn();
  const b = pool.spawn();
  assert.equal(pool.count, 2);

  pool.x[a] = 5;
  const idA = pool.id[a];
  pool.kill(a);
  assert.equal(pool.count, 1);

  const c = pool.spawn();
  assert.equal(c, a, 'the freed slot should be reused');
  assert.notEqual(pool.id[c], idA, 'but it must be a different individual');
  assert.equal(pool.x[c], 0, 'and its fields must be cleared');

  void b;
});

test('a full pool refuses to spawn rather than overflowing', () => {
  const pool = createPool(2, MOTION_SCHEMA);
  assert.ok(pool.spawn() >= 0);
  assert.ok(pool.spawn() >= 0);
  assert.equal(pool.spawn(), -1);
  assert.equal(pool.count, 2);
});

/* ------------------------------------------------------------------ steering */

test('angle helpers stay in range', () => {
  assert.ok(Math.abs(wrapAngle(3 * Math.PI)) - Math.PI < 1e-9);
  assert.ok(Math.abs(angleDiff(0.1, 0.2) - 0.1) < 1e-9);
  // Across the wrap point, the short way round is negative, not nearly 2*PI.
  assert.ok(angleDiff(3.1, -3.1) > 0 && angleDiff(3.1, -3.1) < 0.2);
  assert.ok(Math.abs(turnToward(0, 1, 0.1) - 0.1) < 1e-9);
  assert.ok(Math.abs(turnToward(0, 0.05, 0.1) - 0.05) < 1e-9);
  assert.ok(Math.abs(turnToward(0, -1, 0.1) + 0.1) < 1e-9);
});

test('the Deneubourg branch function behaves as published', () => {
  // Equal trails: a coin flip, which is what gives an unmarked arena its 50/50 split.
  assert.equal(branchProbability(0, 0), 0.5);
  assert.equal(branchProbability(50, 50), 0.5);

  // More pheromone means more traffic, and the response is non-linear: with n = 2 a branch with
  // twice the pheromone takes appreciably more than twice the share of the difference.
  const p = branchProbability(80, 20);
  assert.ok(p > 0.5 && p < 1);
  assert.ok(p > 0.66, `expected sharp preference, got ${p.toFixed(3)}`);

  // Below k the choice stays near random, which is why trails need a threshold to take hold.
  assert.ok(Math.abs(branchProbability(2, 0, 2, 20) - 0.5) < 0.06);

  // Raising n sharpens commitment.
  assert.ok(branchProbability(80, 20, 4) > branchProbability(80, 20, 2));

  // Symmetry.
  assert.ok(Math.abs(branchProbability(30, 70) + branchProbability(70, 30) - 1) < 1e-12);
});

test('bilateral sampling turns towards the stronger antenna', () => {
  const field = new Field(BOUNDS, 64, { halfLifeMinutes: Infinity, diffusion: 0.5 });
  field.deposit(5, 5.5, 100);         // source off to one side
  for (let t = 0; t < 300; t++) field.update(1 / 60);

  // Facing +x at (5,5) with the source at +y, the left antenna (+y side) reads more, so the turn
  // should be positive — towards the trail.
  const opts = { spread: 0.05, reach: 0.05, gain: 1 };
  const offToTheSide = bilateralTurn(field, 5, 5, 0, opts);
  assert.ok(offToTheSide > 0, `expected a left turn, got ${offToTheSide}`);

  // Mirroring the animal to the other side of the source must mirror the turn.
  const otherSide = bilateralTurn(field, 5, 6, 0, opts);
  assert.ok(otherSide < 0, `expected a right turn, got ${otherSide}`);

  // Straddling the source there is little to choose between the antennae. It is not exactly zero:
  // the source does not sit on a cell centre, so the discretised blob is not perfectly symmetric.
  // What matters is that the signal collapses relative to being off to one side.
  const balanced = Math.abs(bilateralTurn(field, 5, 5.5, 0, opts));
  assert.ok(balanced < offToTheSide / 10, `balanced ${balanced} vs off-centre ${offToTheSide}`);

  // Genuinely bare ground gives no signal at all rather than a divide by zero.
  const clean = new Field(BOUNDS, 64, { halfLifeMinutes: Infinity });
  assert.equal(bilateralTurn(clean, 0.2, 0.2, 0), 0);
});

test('path integration produces a homeward bearing', () => {
  const store = { hx: new Float32Array(1), hy: new Float32Array(1) };
  // Walk east then north; home should lie to the south-west.
  accumulateHomeVector(store, 0, 3, 0);
  accumulateHomeVector(store, 0, 0, 4);
  const b = homeBearing(store, 0);
  assert.ok(Math.abs(b - Math.atan2(-4, -3)) < 1e-6);
  // Retracing the path exactly should say "you are home".
  accumulateHomeVector(store, 0, -3, -4);
  assert.equal(homeBearing(store, 0), null);
});

test('movement reflects off the world edge and reports distance travelled', () => {
  const pool = createPool(1, MOTION_SCHEMA);
  const i = pool.spawn();
  pool.x[i] = 9.99;
  pool.y[i] = 5;
  pool.heading[i] = 0;         // straight at the east wall
  pool.speed[i] = 1;

  const moved = advance(pool, i, 0.1, BOUNDS);
  assert.ok(pool.x[i] <= 10);
  assert.ok(Math.abs(Math.abs(pool.heading[i]) - Math.PI) < 1e-6, 'should have turned around');
  assert.ok(moved >= 0);
});

/* ------------------------------------------------------------------ calendar */

test('the sun crosses the sky from east to west', () => {
  const clock = new SeasonClock({ startDay: 172, simSecondsPerDay: 60 });   // midsummer

  const at = (hour) => {
    clock.day = 172 + hour / 24;
    return (clock.sunAzimuth * 180) / Math.PI;
  };

  const morning = at(clock.sunriseHour + 0.01);
  const noon = at(12);
  const evening = at(clock.sunsetHour - 0.01);

  assert.ok(Math.abs(morning - 90) < 2, `sunrise azimuth ${morning}`);   // east
  assert.ok(Math.abs(noon - 180) < 2, `noon azimuth ${noon}`);           // south
  assert.ok(Math.abs(evening - 270) < 2, `sunset azimuth ${evening}`);   // west
});

test('days are longer in summer than in winter', () => {
  const summer = new SeasonClock({ startDay: 172 });
  const winter = new SeasonClock({ startDay: 355 });
  assert.ok(summer.daylightHours > 15, `${summer.daylightHours}`);
  assert.ok(winter.daylightHours < 9, `${winter.daylightHours}`);
});

test('air temperature peaks in summer and in the afternoon', () => {
  const clock = new SeasonClock({ startDay: 15, meanTempC: 10.5, seasonalRangeC: 13 });
  const januaryNight = clock.airTemperature();

  clock.day = 196.6;   // mid-July, mid-afternoon
  const julyAfternoon = clock.airTemperature();
  assert.ok(julyAfternoon > januaryNight + 10, `Jan ${januaryNight}, Jul ${julyAfternoon}`);

  clock.day = 196.15;  // same day, just before dawn
  assert.ok(clock.airTemperature() < julyAfternoon);
});

test('the calendar advances at the stated compression and wraps at year end', () => {
  const clock = new SeasonClock({ simSecondsPerDay: 60, startDay: 364.9 });
  for (let t = 0; t < 60 * 60; t++) clock.step(1 / 60);   // one simulated minute = one day
  assert.ok(Math.abs(clock.elapsedDays - 1) < 1e-6);
  assert.ok(clock.day < 1, `should have wrapped, got ${clock.day}`);
});

/* -------------------------------------------------------------------- brood */

test('development stops below the threshold and peaks at the optimum', () => {
  assert.equal(developmentRate(10, 12, 35, 40), 0, 'no development when too cold');
  assert.equal(developmentRate(42, 12, 35, 40), 0, 'no development when too hot');
  assert.equal(developmentRate(35, 12, 35, 40), 1, 'full rate at the optimum');
  const warm = developmentRate(30, 12, 35, 40);
  const cool = developmentRate(20, 12, 35, 40);
  assert.ok(warm > cool && cool > 0);
});

test('brood progresses egg to larva to pupa to adult', () => {
  const brood = createBroodPool(4);
  const i = brood.spawn();
  brood.stage[i] = STAGE.EGG;

  const stageDays = [3, 6, 12];   // honey bee worker at 35 C
  let emerged = false;
  for (let d = 0; d < 25 && !emerged; d++) {
    emerged = advanceBrood(brood, i, 1, stageDays) === 'emerged';
    if (d === 2) assert.equal(brood.stage[i], STAGE.LARVA, 'egg should hatch on day 3');
    if (d === 8) assert.equal(brood.stage[i], STAGE.PUPA, 'should pupate on day 9');
  }
  assert.ok(emerged, 'should have emerged');
  assert.ok(Math.abs(brood.age[i] - 21) < 1.01, `emerged at ${brood.age[i]} days`);
});

/* ------------------------------------------------------------------- stores */

test('stores respect capacity and never go negative', () => {
  const stores = new Stores({ honey: 0 });
  stores.setCapacity('honey', 100);

  assert.equal(stores.add('honey', 60), 60);
  assert.equal(stores.add('honey', 60), 40, 'only what fits is accepted');
  assert.equal(stores.get('honey'), 100);
  assert.equal(stores.fullness('honey'), 1);

  assert.equal(stores.consume('honey', 30), 30);
  assert.equal(stores.consume('honey', 999), 70, 'cannot take more than is there');
  assert.equal(stores.get('honey'), 0);

  // The lifetime total is not reduced by consumption.
  assert.equal(stores.collected.honey, 100);
});
