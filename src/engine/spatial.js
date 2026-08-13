// Uniform grid hash for neighbour queries.
//
// Insects interact locally: a wasp joining others at a food patch, a bee finding a dancer on the
// dance floor, a soldier termite converging on a breach. All of those are "who is near this point",
// which is O(n^2) done naively and O(1)-ish on a grid. Rebuilt by counting sort into flat typed
// arrays, so a rebuild allocates nothing.

export class SpatialHash {
  /**
   * @param {{x:number,y:number,w:number,h:number}} bounds
   * @param {number} cellSize  world units; pick roughly the largest query radius
   * @param {number} capacity  maximum number of items
   */
  constructor(bounds, cellSize, capacity) {
    this.bounds = { ...bounds };
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(bounds.w / cellSize));
    this.rows = Math.max(1, Math.ceil(bounds.h / cellSize));
    this.cellCount = this.cols * this.rows;

    this.cellStart = new Int32Array(this.cellCount + 1);
    this.counts = new Int32Array(this.cellCount);
    this.items = new Int32Array(capacity);
    this.capacity = capacity;
    this.size = 0;
  }

  _cellIndex(wx, wy) {
    let cx = Math.floor((wx - this.bounds.x) / this.cellSize);
    let cy = Math.floor((wy - this.bounds.y) / this.cellSize);
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /**
   * Rebuild from struct-of-arrays positions.
   * @param {Float32Array} xs @param {Float32Array} ys
   * @param {number} count  how many slots to consider
   * @param {Uint8Array} [alive]  optional liveness mask; dead slots are skipped
   */
  rebuild(xs, ys, count, alive = null) {
    const { counts, cellStart, items } = this;
    counts.fill(0);

    // Pass 1: how many items land in each cell.
    for (let i = 0; i < count; i++) {
      if (alive && !alive[i]) continue;
      counts[this._cellIndex(xs[i], ys[i])]++;
    }

    // Pass 2: prefix sum gives each cell its slice of the items array.
    let running = 0;
    for (let c = 0; c < this.cellCount; c++) {
      cellStart[c] = running;
      running += counts[c];
    }
    cellStart[this.cellCount] = running;
    this.size = running;

    // Pass 3: scatter, using counts as a per-cell write cursor.
    counts.fill(0);
    for (let i = 0; i < count; i++) {
      if (alive && !alive[i]) continue;
      const c = this._cellIndex(xs[i], ys[i]);
      items[cellStart[c] + counts[c]++] = i;
    }
  }

  /**
   * Call `fn(index)` for every item in the cells overlapping a circle. Candidates are cell-level,
   * so the callback must do its own precise distance test — that keeps this allocation-free.
   */
  forEachNear(wx, wy, radius, fn) {
    const minCx = Math.max(0, Math.floor((wx - radius - this.bounds.x) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((wx + radius - this.bounds.x) / this.cellSize));
    const minCy = Math.max(0, Math.floor((wy - radius - this.bounds.y) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((wy + radius - this.bounds.y) / this.cellSize));

    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowBase = cy * this.cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const c = rowBase + cx;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) {
          if (fn(this.items[k]) === false) return;
        }
      }
    }
  }

  /**
   * Nearest item within `radius`, or -1. `accept` filters candidates — "the nearest bee that is
   * currently free to unload nectar", say.
   */
  nearest(xs, ys, wx, wy, radius, accept = null) {
    let best = -1;
    let bestD = radius * radius;
    this.forEachNear(wx, wy, radius, (i) => {
      if (accept && !accept(i)) return;
      const dx = xs[i] - wx;
      const dy = ys[i] - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  /** How many items lie within `radius` — local crowding, which several species respond to. */
  countNear(xs, ys, wx, wy, radius, accept = null) {
    let n = 0;
    const r2 = radius * radius;
    this.forEachNear(wx, wy, radius, (i) => {
      if (accept && !accept(i)) return;
      const dx = xs[i] - wx;
      const dy = ys[i] - wy;
      if (dx * dx + dy * dy <= r2) n++;
    });
    return n;
  }
}
