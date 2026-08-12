// Movement primitives shared by every colony.
//
// These are the building blocks the scenarios compose: how an animal walks when it knows nothing,
// how it turns towards something, how it tracks a chemical gradient with two antennae, and how it
// keeps a running vector back to the nest. The species-specific decisions live in the scenarios;
// only the mechanics live here.

export const TAU = Math.PI * 2;

/** Fold an angle into [-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Signed shortest rotation from `from` to `to`. */
export function angleDiff(from, to) {
  return wrapAngle(to - from);
}

/** Rotate `heading` towards `target`, by at most `maxTurn` radians. */
export function turnToward(heading, target, maxTurn) {
  const diff = angleDiff(heading, target);
  if (diff > maxTurn) return wrapAngle(heading + maxTurn);
  if (diff < -maxTurn) return wrapAngle(heading - maxTurn);
  return wrapAngle(target);
}

/**
 * The turn component of a correlated random walk: heading changes by a Gaussian increment whose
 * spread grows with the square root of elapsed time, which makes the path's tortuosity a property
 * of the animal rather than of the tick rate.
 *
 * This is the standard description of an insect searching with no information to go on, and it is
 * what every scenario falls back to when an individual has nothing better to do.
 *
 * @param {number} sinuosity  radians per sqrt(second); larger means a tighter, more local search
 */
export function wanderTurn(rng, sinuosity, dt) {
  return rng.normal(0, sinuosity * Math.sqrt(dt));
}

/**
 * Bilateral gradient following — the mechanism ants actually use to stay on a trail.
 *
 * An ant does not read a gradient at a point; it sweeps two antennae and compares what each one
 * finds, turning towards the side with more. That difference is why trail following is noisy at low
 * concentrations and crisp at high ones, and why ants oscillate slightly as they walk a trail.
 *
 * @returns {number} signed turn preference in radians, positive meaning turn left
 */
export function bilateralTurn(field, x, y, heading, { spread = 0.0015, reach = 0.004, gain = 1 } = {}) {
  // Antennal tips: forward by `reach`, splayed either side of the midline by `spread`.
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);

  const leftX = x + cos * reach - sin * spread;
  const leftY = y + sin * reach + cos * spread;
  const rightX = x + cos * reach + sin * spread;
  const rightY = y + sin * reach - cos * spread;

  const left = field.sample(leftX, leftY);
  const right = field.sample(rightX, rightY);
  const sum = left + right;
  if (sum <= 0) return 0;

  // Normalising by the total makes the response saturate: doubling the concentration of an already
  // strong trail does not double the turn. Ants behave this way too.
  return ((left - right) / sum) * gain;
}

/**
 * Probability of choosing branch A over branch B given the pheromone on each.
 *
 * This is the choice function Deneubourg and colleagues fitted to Argentine ants at a Y junction:
 *
 *     P(A) = (k + C_A)^n / ((k + C_A)^n + (k + C_B)^n)
 *
 * `n` sets how sharply the colony commits to the better branch — at n = 2 a modest concentration
 * difference produces a large difference in traffic, which is what lets a colony converge on one
 * path rather than splitting. `k` is the concentration below which ants effectively choose at
 * random, so a fresh unmarked arena gives a coin flip.
 *
 * Deneubourg, Aron, Goss & Pasteels (1990), The self-organizing exploratory pattern of the
 * Argentine ant, Journal of Insect Behavior 3:159-168.
 */
export function branchProbability(concentrationA, concentrationB, n = 2, k = 20) {
  const a = Math.pow(k + concentrationA, n);
  const b = Math.pow(k + concentrationB, n);
  return a / (a + b);
}

/**
 * Path integration: maintain a vector pointing home.
 *
 * Foraging insects dead-reckon. Desert ants are the famous case, but honey bees, wasps and Lasius
 * all run some version of it, which is why a forager that has wandered a crooked path still heads
 * more or less straight back. Accumulating the displacement each tick is the idealised form; real
 * animals accumulate error, which `driftPerMetre` reintroduces.
 *
 * @param {{hx:Float32Array, hy:Float32Array}} store  home vector components per agent
 */
export function accumulateHomeVector(store, i, dx, dy, rng = null, driftPerMetre = 0) {
  store.hx[i] -= dx;
  store.hy[i] -= dy;
  if (driftPerMetre > 0 && rng) {
    const stepLength = Math.hypot(dx, dy);
    const error = driftPerMetre * stepLength;
    store.hx[i] += rng.normal(0, error);
    store.hy[i] += rng.normal(0, error);
  }
}

/** Bearing of the accumulated home vector, or null once the animal believes it has arrived. */
export function homeBearing(store, i, arrivalRadius = 0.02) {
  const hx = store.hx[i];
  const hy = store.hy[i];
  if (hx * hx + hy * hy < arrivalRadius * arrivalRadius) return null;
  return Math.atan2(hy, hx);
}

export function clearHomeVector(store, i) {
  store.hx[i] = 0;
  store.hy[i] = 0;
}

/**
 * Advance a position along its heading, reflecting off the world edge.
 * Returns the distance actually travelled, which callers use for pheromone deposition per unit
 * length and for path integration.
 */
export function advance(pool, i, dt, bounds, margin = 0) {
  const step = pool.speed[i] * dt;
  if (step === 0) return 0;

  let nx = pool.x[i] + Math.cos(pool.heading[i]) * step;
  let ny = pool.y[i] + Math.sin(pool.heading[i]) * step;

  const minX = bounds.x + margin;
  const maxX = bounds.x + bounds.w - margin;
  const minY = bounds.y + margin;
  const maxY = bounds.y + bounds.h - margin;

  if (nx < minX) { nx = minX; pool.heading[i] = wrapAngle(Math.PI - pool.heading[i]); }
  else if (nx > maxX) { nx = maxX; pool.heading[i] = wrapAngle(Math.PI - pool.heading[i]); }

  if (ny < minY) { ny = minY; pool.heading[i] = wrapAngle(-pool.heading[i]); }
  else if (ny > maxY) { ny = maxY; pool.heading[i] = wrapAngle(-pool.heading[i]); }

  const dx = nx - pool.x[i];
  const dy = ny - pool.y[i];
  pool.x[i] = nx;
  pool.y[i] = ny;
  return Math.hypot(dx, dy);
}

/** Record the pre-step position so the renderer can interpolate. Call before moving. */
export function storePrevious(pool, i) {
  pool.px[i] = pool.x[i];
  pool.py[i] = pool.y[i];
}

export function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

export function bearing(fromX, fromY, toX, toY) {
  return Math.atan2(toY - fromY, toX - fromX);
}

/** Smooth, frame-rate independent approach of `current` towards `target`. */
export function approach(current, target, ratePerSecond, dt) {
  return current + (target - current) * (1 - Math.exp(-ratePerSecond * dt));
}
