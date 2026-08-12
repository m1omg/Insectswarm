// Scalar fields on a regular grid.
//
// Pheromone concentration, temperature, humidity and CO2 are all the same data structure: a
// Float32Array over the world rectangle that agents deposit into and read gradients from. Fields
// decay and diffuse on their own sub-clock rather than every tick, because a 192x128 grid does not
// need updating 60 times a second to look right, and the blur is the most expensive thing here.

/** How often fields decay and diffuse, in seconds of simulated time. */
const UPDATE_INTERVAL = 0.1;

export class Field {
  /**
   * @param {{x:number,y:number,w:number,h:number}} bounds  world rectangle covered, in metres
   * @param {number} cols  grid columns; rows follow from the aspect ratio
   * @param {object} opts
   * @param {number} [opts.halfLifeMinutes]  time for a deposit to fall to half strength. This is
   *   the number the literature reports, so it is the number the UI exposes. Infinity means the
   *   field does not evaporate (soil temperature, say).
   * @param {number} [opts.diffusion]  0..1 share of a cell spread to its neighbours per update
   * @param {number} [opts.ambient]  value the field relaxes towards, for temperature-like fields
   * @param {number} [opts.relaxPerMinute]  fraction of the gap to ambient closed each minute
   */
  constructor(bounds, cols, { halfLifeMinutes = Infinity, diffusion = 0, ambient = 0, relaxPerMinute = 0 } = {}) {
    this.bounds = { ...bounds };
    this.cols = Math.max(4, Math.round(cols));
    this.rows = Math.max(4, Math.round((this.cols * bounds.h) / bounds.w));
    this.cellSize = bounds.w / this.cols;

    this.data = new Float32Array(this.cols * this.rows);
    this.scratch = new Float32Array(this.cols * this.rows);

    this.halfLifeMinutes = halfLifeMinutes;
    this.diffusion = diffusion;
    this.ambient = ambient;
    this.relaxPerMinute = relaxPerMinute;

    this.maxValue = 0;
    this._accumulator = 0;

    if (ambient !== 0) this.data.fill(ambient);
  }

  /** Grid column for a world x, unclamped. */
  colAt(wx) { return (wx - this.bounds.x) / this.cellSize; }
  rowAt(wy) { return (wy - this.bounds.y) / this.cellSize; }

  inBounds(wx, wy) {
    const b = this.bounds;
    return wx >= b.x && wx < b.x + b.w && wy >= b.y && wy < b.y + b.h;
  }

  /** Value at a world point, bilinearly interpolated so gradients are smooth. */
  sample(wx, wy) {
    const fx = this.colAt(wx) - 0.5;
    const fy = this.rowAt(wy) - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;

    const c00 = this._at(x0, y0);
    const c10 = this._at(x0 + 1, y0);
    const c01 = this._at(x0, y0 + 1);
    const c11 = this._at(x0 + 1, y0 + 1);

    return (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty;
  }

  /** Clamped cell read — sampling off the edge returns the edge value rather than zero. */
  _at(cx, cy) {
    const x = cx < 0 ? 0 : cx >= this.cols ? this.cols - 1 : cx;
    const y = cy < 0 ? 0 : cy >= this.rows ? this.rows - 1 : cy;
    return this.data[y * this.cols + x];
  }

  /**
   * Add to the field at a world point, spread bilinearly across the four surrounding cells so a
   * walking insect lays a continuous line rather than a dotted one.
   *
   * Deposits outside the world are dropped entirely, but a deposit *inside* it near an edge has its
   * overhanging share folded back onto the edge cells. Without that, an ant walking along the
   * boundary would lay a trail up to four times weaker than one walking down the middle — an
   * artefact of the grid rather than anything the animal is doing. Sampling clamps the same way, so
   * the two stay consistent.
   */
  deposit(wx, wy, amount) {
    if (amount === 0 || !this.inBounds(wx, wy)) return;
    const fx = this.colAt(wx) - 0.5;
    const fy = this.rowAt(wy) - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;

    this._add(x0, y0, amount * (1 - tx) * (1 - ty));
    this._add(x0 + 1, y0, amount * tx * (1 - ty));
    this._add(x0, y0 + 1, amount * (1 - tx) * ty);
    this._add(x0 + 1, y0 + 1, amount * tx * ty);
  }

  _add(cx, cy, amount) {
    if (amount === 0) return;
    const x = cx < 0 ? 0 : cx >= this.cols ? this.cols - 1 : cx;
    const y = cy < 0 ? 0 : cy >= this.rows ? this.rows - 1 : cy;
    const i = y * this.cols + x;
    const v = this.data[i] + amount;
    this.data[i] = v;
    if (v > this.maxValue) this.maxValue = v;
  }

  setAt(wx, wy, value) {
    const cx = Math.floor(this.colAt(wx));
    const cy = Math.floor(this.rowAt(wy));
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return;
    this.data[cy * this.cols + cx] = value;
  }

  /**
   * Local slope in world units, written into `out` as [dx, dy]. Central differences over one cell.
   * Used where an animal follows a gradient it can perceive over its whole body — a termite
   * sensing humidity. Ants compare two antennae instead; see bilateralTurn in sim/behaviour.js.
   */
  gradient(wx, wy, out) {
    const d = this.cellSize;
    out[0] = (this.sample(wx + d, wy) - this.sample(wx - d, wy)) / (2 * d);
    out[1] = (this.sample(wx, wy + d) - this.sample(wx, wy - d)) / (2 * d);
    return out;
  }

  /**
   * Advance decay and diffusion. Safe to call every tick: the work happens on a fixed sub-clock,
   * driven by the simulation's own dt so it stays deterministic.
   */
  update(dt) {
    this._accumulator += dt;
    if (this._accumulator < UPDATE_INTERVAL) return false;

    let steps = 0;
    while (this._accumulator >= UPDATE_INTERVAL && steps < 8) {
      this._step(UPDATE_INTERVAL);
      this._accumulator -= UPDATE_INTERVAL;
      steps++;
    }
    // At very high speed multipliers, stop trying to catch up cell-by-cell.
    if (this._accumulator >= UPDATE_INTERVAL) this._accumulator = 0;
    return true;
  }

  _step(dt) {
    const { data, cols, rows } = this;
    const n = data.length;

    // Exponential decay expressed from the published half-life, not an arbitrary per-tick factor.
    let keep = 1;
    if (this.halfLifeMinutes !== Infinity && this.halfLifeMinutes > 0) {
      keep = Math.pow(0.5, dt / 60 / this.halfLifeMinutes);
    }

    const relax = this.relaxPerMinute > 0 ? 1 - Math.pow(1 - this.relaxPerMinute, dt / 60) : 0;
    const ambient = this.ambient;

    if (keep !== 1 || relax > 0) {
      for (let i = 0; i < n; i++) {
        let v = data[i] * keep;
        if (relax > 0) v += (ambient - v) * relax;
        // Flush denormals to zero: they are invisible and they poison the overlay's normalisation.
        data[i] = v < 1e-6 && v > -1e-6 ? 0 : v;
      }
    }

    if (this.diffusion > 0) this._diffuse(this.diffusion);

    let max = 0;
    for (let i = 0; i < n; i++) if (data[i] > max) max = data[i];
    this.maxValue = max;

    void cols; void rows;
  }

  /** Separable 3-tap blur, edge-clamped. Two passes through the grid, no allocation. */
  _diffuse(amount) {
    const { data, scratch, cols, rows } = this;
    const side = amount / 2;
    const centre = 1 - amount;

    for (let y = 0; y < rows; y++) {
      const row = y * cols;
      for (let x = 0; x < cols; x++) {
        const l = data[row + (x > 0 ? x - 1 : 0)];
        const c = data[row + x];
        const r = data[row + (x < cols - 1 ? x + 1 : cols - 1)];
        scratch[row + x] = l * side + c * centre + r * side;
      }
    }

    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const u = scratch[(y > 0 ? y - 1 : 0) * cols + x];
        const c = scratch[y * cols + x];
        const d = scratch[(y < rows - 1 ? y + 1 : rows - 1) * cols + x];
        data[y * cols + x] = u * side + c * centre + d * side;
      }
    }
  }

  clear(value = 0) {
    this.data.fill(value);
    this.maxValue = value;
  }

  /** Total quantity in the field — useful for conservation checks and readouts. */
  total() {
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) sum += this.data[i];
    return sum;
  }
}

/**
 * Half-life to per-second retention. Exposed separately because scenarios sometimes need to decay a
 * scalar that is not a whole field — an individual's memory of a food odour, for instance.
 */
export function decayFromHalfLife(halfLifeMinutes, dtSeconds) {
  if (!(halfLifeMinutes > 0) || halfLifeMinutes === Infinity) return 1;
  return Math.pow(0.5, dtSeconds / 60 / halfLifeMinutes);
}
