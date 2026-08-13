// Seeded pseudo-random number generation.
//
// The simulation must be reproducible: the same seed and the same number of fixed steps must
// produce the same colony, whatever the display refresh rate. So nothing below engine/ may call
// Math.random() — everything draws from one of these streams.

/** Turn an arbitrary string into a 32-bit seed. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Mulberry32 — small, fast, and good enough for agent decisions. Returns a callable that yields
 * floats in [0, 1), with helper methods hung off it for readability at the call sites.
 */
export function makeRng(seed = 1) {
  let a = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;

  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Uniform float in [min, max). */
  rng.range = (min, max) => min + rng() * (max - min);

  /** Uniform integer in [min, max]. */
  rng.int = (min, max) => Math.floor(min + rng() * (max - min + 1));

  /** True with probability p. */
  rng.chance = (p) => rng() < p;

  /** Uniform angle in radians. */
  rng.angle = () => rng() * Math.PI * 2;

  /** Pick one element of an array. */
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];

  /**
   * Standard normal via Box-Muller. Used for things that really are Gaussian in the literature —
   * the angular scatter of waggle dances, variation in body size and development time.
   */
  rng.normal = (mean = 0, sd = 1) => {
    // Reject exactly 0 so the log is finite.
    let u = 0;
    while (u === 0) u = rng();
    const v = rng();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
  };

  /**
   * Poisson-ish event test for a rate expressed per second, sampled over dt seconds. Used for
   * things the literature reports as a rate: eggs laid per day, U-turns per centimetre of trail.
   */
  rng.eventAtRate = (ratePerSecond, dt) => rng() < 1 - Math.exp(-ratePerSecond * dt);

  /** Snapshot / restore, so a run can be saved or a test can rewind. */
  rng.getState = () => a >>> 0;
  rng.setState = (s) => { a = s >>> 0; };

  return rng;
}
