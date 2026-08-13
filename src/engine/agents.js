// Struct-of-arrays agent storage.
//
// A colony is thousands of individuals stepped 60 times a second, so each attribute lives in its
// own typed array rather than each individual living in its own object. Slots are recycled through
// a free list and never move, which keeps the inspector's reference to "that ant" valid and lets
// other structures hold plain integer indices.

const TYPES = {
  f32: Float32Array,
  u8: Uint8Array,
  u16: Uint16Array,
  i16: Int16Array,
  i32: Int32Array,
};

/**
 * @param {number} capacity
 * @param {Record<string, keyof TYPES>} schema  e.g. { x:'f32', y:'f32', caste:'u8' }
 */
export function createPool(capacity, schema) {
  const cap = Math.max(1, Math.floor(capacity));

  const pool = {
    capacity: cap,
    /** Number of live agents. */
    count: 0,
    /** One past the highest slot ever used, so iteration can stop early on a young colony. */
    highWater: 0,
    alive: new Uint8Array(cap),
    /** Monotonic identity, so a recycled slot is never mistaken for the individual that died in it. */
    id: new Int32Array(cap),
    _free: new Int32Array(cap),
    _freeCount: 0,
    _nextId: 1,
    _names: Object.keys(schema),
  };

  for (const [name, type] of Object.entries(schema)) {
    if (!TYPES[type]) throw new Error(`Unknown field type "${type}" for "${name}"`);
    if (name in pool) throw new Error(`Field name "${name}" collides with a pool property`);
    pool[name] = new TYPES[type](cap);
  }

  /** Claim a slot, or -1 when the colony is at its ceiling. Fields are zeroed. */
  pool.spawn = function spawn() {
    let i;
    if (this._freeCount > 0) {
      i = this._free[--this._freeCount];
    } else if (this.highWater < this.capacity) {
      i = this.highWater++;
    } else {
      return -1;
    }
    this.alive[i] = 1;
    this.id[i] = this._nextId++;
    this.count++;
    for (const name of this._names) this[name][i] = 0;
    return i;
  };

  pool.kill = function kill(i) {
    if (!this.alive[i]) return false;
    this.alive[i] = 0;
    this.id[i] = 0;
    this.count--;
    this._free[this._freeCount++] = i;
    return true;
  };

  /** fn(i) over live agents. Returning false stops the walk. */
  pool.forEach = function forEach(fn) {
    for (let i = 0; i < this.highWater; i++) {
      if (this.alive[i] && fn(i) === false) return;
    }
  };

  /** How many live agents satisfy a predicate — used constantly for caste readouts. */
  pool.countWhere = function countWhere(fn) {
    let n = 0;
    for (let i = 0; i < this.highWater; i++) if (this.alive[i] && fn(i)) n++;
    return n;
  };

  /** Nearest live agent to a point within a radius, by brute force over the pool. */
  pool.nearestTo = function nearestTo(wx, wy, radius, accept = null) {
    let best = -1;
    let bestD = radius * radius;
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      if (accept && !accept(i)) continue;
      const dx = this.x[i] - wx;
      const dy = this.y[i] - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  pool.reset = function reset() {
    this.alive.fill(0);
    this.id.fill(0);
    this.count = 0;
    this.highWater = 0;
    this._freeCount = 0;
    this._nextId = 1;
    for (const name of this._names) this[name].fill(0);
  };

  return pool;
}

/**
 * The movement fields every scenario's adults need. Scenarios spread this into their own schema and
 * add what is specific to them — nectar load, wax reserves, days since eclosion.
 *
 * `px`/`py` hold the previous tick's position purely so the renderer can interpolate between ticks;
 * the simulation never reads them.
 */
export const MOTION_SCHEMA = {
  x: 'f32',
  y: 'f32',
  px: 'f32',
  py: 'f32',
  heading: 'f32',
  speed: 'f32',
  task: 'u8',
  /** Seconds spent in the current task, for timeouts and give-up rules. */
  taskTime: 'f32',
  /** Age in colony days; drives age polyethism where the species has it. */
  age: 'f32',
};
