// Engine invariants: determinism and refresh-rate independence.
//
// Run with: node --test test/

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRng, hashSeed } from '../src/engine/rng.js';
import { DT, runHeadless } from '../src/engine/loop.js';
import { create as createDiagnostic, meta as diagMeta } from '../src/sim/scenarios/diagnostic.js';

const WORLD = { budget: { agents: 400, fieldWidth: 192 }, dt: DT, seed: 'test' };

/** Cheap order-sensitive hash of a scenario's visible state, for comparing two runs. */
function hashScenario(scenario) {
  let h = 2166136261 >>> 0;
  const buf = new Float64Array(1);
  const view = new Uint32Array(buf.buffer);
  const feed = (value) => {
    buf[0] = value;
    h = Math.imul(h ^ view[0], 16777619) >>> 0;
    h = Math.imul(h ^ view[1], 16777619) >>> 0;
  };
  for (const [, v] of scenario.stats()) feed(Number(v));
  // Sample the population through describe() at a grid of points: it reaches the agent arrays
  // without the scenario having to expose them.
  const b = diagMeta.fieldBounds;
  for (let i = 0; i < 24; i++) {
    const info = scenario.describe(b.x + (b.w * i) / 24, b.y + (b.h * (i % 7)) / 7, 'field');
    feed(info ? Number(info.title.replace(/\D/g, '')) : -1);
    if (info) for (const [, value] of info.rows) feed(parseFloat(value) || 0);
  }
  return h >>> 0;
}

function runTicks(ticks, seed = 'determinism') {
  const rng = makeRng(seed);
  const scenario = createDiagnostic(WORLD, rng);
  for (let i = 0; i < ticks; i++) scenario.step(DT);
  return scenario;
}

test('rng is deterministic for a given seed', () => {
  const a = makeRng('colony');
  const b = makeRng('colony');
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test('rng seeds differ between different strings', () => {
  assert.notEqual(hashSeed('ants'), hashSeed('bees'));
  assert.notEqual(makeRng('ants')(), makeRng('bees')());
});

test('rng state can be snapshotted and restored', () => {
  const rng = makeRng(42);
  for (let i = 0; i < 50; i++) rng();
  const state = rng.getState();
  const expected = [rng(), rng(), rng()];
  rng.setState(state);
  assert.deepEqual([rng(), rng(), rng()], expected);
});

test('rng.normal has approximately the requested mean and spread', () => {
  const rng = makeRng('normal');
  const n = 20000;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = rng.normal(5, 2);
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const sd = Math.sqrt(sumSq / n - mean * mean);
  assert.ok(Math.abs(mean - 5) < 0.06, `mean ${mean}`);
  assert.ok(Math.abs(sd - 2) < 0.06, `sd ${sd}`);
});

test('rng.eventAtRate converges on the expected rate', () => {
  // A 0.5/s rate sampled over 1 s should fire on about 39% of trials: 1 - e^-0.5.
  const rng = makeRng('rate');
  let hits = 0;
  const trials = 40000;
  for (let i = 0; i < trials; i++) if (rng.eventAtRate(0.5, 1)) hits++;
  assert.ok(Math.abs(hits / trials - (1 - Math.exp(-0.5))) < 0.01);
});

test('identical seeds produce identical simulations', () => {
  assert.equal(hashScenario(runTicks(600)), hashScenario(runTicks(600)));
});

test('different seeds produce different simulations', () => {
  assert.notEqual(hashScenario(runTicks(600, 'a')), hashScenario(runTicks(600, 'b')));
});

/** A frame train of irregular deltas summing to exactly `totalSeconds` — a real device under load. */
function jitteryFrames(totalSeconds, rng) {
  const out = [];
  let t = 0;
  while (t < totalSeconds - 1e-9) {
    // Between 144 Hz and 24 Hz: fast frames with occasional hitches, never long enough to be
    // treated as a stall.
    let d = rng.range(1 / 144, 1 / 24);
    if (t + d > totalSeconds) d = totalSeconds - t;
    out.push(d);
    t += d;
  }
  return out;
}

test('the loop is refresh-rate independent', () => {
  // The same elapsed span delivered as 30, 60 and 144 Hz frames must run the same number of fixed
  // ticks, and therefore produce the same colony. This is the whole point of the accumulator.
  const seconds = 10;

  // Every pattern gets the same short final frame. Ten seconds is exactly 600 ticks, which parks
  // the accumulator precisely on a tick boundary where floating-point noise of 1e-14 would decide
  // between 599 and 600 ticks. Nudging past the boundary tests the real invariant instead of the
  // arithmetic knife-edge.
  const TAIL = 0.005;

  const patterns = {
    '30hz': [...Array(30 * seconds).fill(1 / 30), TAIL],
    '60hz': [...Array(60 * seconds).fill(1 / 60), TAIL],
    '144hz': [...Array(144 * seconds).fill(1 / 144), TAIL],
    jittery: [...jitteryFrames(seconds, makeRng('frames')), TAIL],
  };

  const results = {};
  for (const [name, deltas] of Object.entries(patterns)) {
    const total = deltas.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - (seconds + TAIL)) < 1e-9, `${name} frame train sums to ${total}`);

    const rng = makeRng('refresh');
    const scenario = createDiagnostic(WORLD, rng);
    const ticks = runHeadless(() => scenario.step(DT), deltas);
    results[name] = { ticks, hash: hashScenario(scenario) };
  }

  const expectedTicks = Math.floor((seconds + TAIL) / DT);
  for (const [name, r] of Object.entries(results)) {
    assert.equal(r.ticks, expectedTicks, `${name}: ${r.ticks} ticks, expected ${expectedTicks}`);
  }
  assert.equal(results['30hz'].hash, results['60hz'].hash, '30 Hz and 60 Hz diverged');
  assert.equal(results['60hz'].hash, results['144hz'].hash, '60 Hz and 144 Hz diverged');
  assert.equal(results['60hz'].hash, results.jittery.hash, 'jittery frames diverged');
});

test('a long stall does not replay as a burst of ticks', () => {
  // Tab switches and GC pauses must be discarded, not simulated: MAX_FRAME_SECONDS clamps them.
  let ticks = 0;
  ticks = runHeadless(() => {}, [5.0]);
  assert.ok(ticks <= Math.ceil(0.25 / DT), `a 5 s stall ran ${ticks} ticks`);
});
