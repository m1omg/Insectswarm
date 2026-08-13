// Occupancy grid: what is solid and what an insect can walk through.
//
// One structure covers several jobs. In the foraging field it holds the barriers of the double
// bridge apparatus. In the nest cutaway it holds the soil, so chambers and tunnels are simply the
// cells that have been dug out — which means excavation is a grid edit and the nest can grow. The
// termite mound is the same idea run in reverse, with deposition filling cells in.

export const SOLID = 0;
export const OPEN = 1;

export class GridMask {
  /**
   * @param {{x:number,y:number,w:number,h:number}} bounds
   * @param {number} cols
   * @param {number} [fill]  SOLID to start with everything blocked, OPEN for open ground
   */
  constructor(bounds, cols, fill = OPEN) {
    this.bounds = { ...bounds };
    this.cols = Math.max(4, Math.round(cols));
    this.rows = Math.max(4, Math.round((this.cols * bounds.h) / bounds.w));
    this.cellSize = bounds.w / this.cols;
    this.cells = new Uint8Array(this.cols * this.rows).fill(fill);
    /** Bumped on every edit so renderers know to rebake their cached image. */
    this.version = 0;
  }

  colAt(wx) { return Math.floor((wx - this.bounds.x) / this.cellSize); }
  rowAt(wy) { return Math.floor((wy - this.bounds.y) / this.cellSize); }
  centreX(cx) { return this.bounds.x + (cx + 0.5) * this.cellSize; }
  centreY(cy) { return this.bounds.y + (cy + 0.5) * this.cellSize; }

  inGrid(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows; }

  /** Cell state at a world point. Outside the grid counts as solid, so nothing escapes. */
  at(wx, wy) {
    const cx = this.colAt(wx);
    const cy = this.rowAt(wy);
    if (!this.inGrid(cx, cy)) return SOLID;
    return this.cells[cy * this.cols + cx];
  }

  isOpen(wx, wy) { return this.at(wx, wy) === OPEN; }
  isSolid(wx, wy) { return this.at(wx, wy) === SOLID; }

  set(cx, cy, value) {
    if (!this.inGrid(cx, cy)) return false;
    const i = cy * this.cols + cx;
    if (this.cells[i] === value) return false;
    this.cells[i] = value;
    this.version++;
    return true;
  }

  setAtWorld(wx, wy, value) {
    return this.set(this.colAt(wx), this.rowAt(wy), value);
  }

  /** Carve or fill a disc — a chamber, a food patch clearing, a collapsed tunnel. */
  disc(wx, wy, radius, value) {
    const r = Math.ceil(radius / this.cellSize);
    const cx0 = this.colAt(wx);
    const cy0 = this.rowAt(wy);
    let changed = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const wxx = this.centreX(cx0 + dx);
        const wyy = this.centreY(cy0 + dy);
        if ((wxx - wx) ** 2 + (wyy - wy) ** 2 <= radius * radius) {
          if (this.set(cx0 + dx, cy0 + dy, value)) changed++;
        }
      }
    }
    return changed;
  }

  /** Carve or fill a thick line — a tunnel, a wall of the bridge apparatus. */
  line(x0, y0, x1, y1, thickness, value) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(length / (this.cellSize * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thickness / 2, value);
    }
  }

  rect(x, y, w, h, value) {
    const cx0 = Math.max(0, this.colAt(x));
    const cy0 = Math.max(0, this.rowAt(y));
    const cx1 = Math.min(this.cols - 1, this.colAt(x + w));
    const cy1 = Math.min(this.rows - 1, this.rowAt(y + h));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) this.set(cx, cy, value);
    }
  }

  /**
   * How many of the eight neighbours are solid. Termites use this as a curvature proxy when
   * deciding where to deposit; ants use it to keep tunnel walls from crumbling.
   */
  solidNeighbours(cx, cy) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.inGrid(x, y) || this.cells[y * this.cols + x] === SOLID) n++;
      }
    }
    return n;
  }

  count(value) {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === value) n++;
    return n;
  }
}

/**
 * Move a point through the grid, sliding along walls instead of stopping dead at them.
 *
 * Axes are resolved separately so an insect walking at a shallow angle into a tunnel wall keeps
 * going along it, which is what they visibly do. Returns the distance actually covered and whether
 * a wall was hit, so callers can decide to turn, dig, or give up.
 */
export function moveThroughMask(mask, x, y, dx, dy, radius = 0) {
  let nx = x + dx;
  let ny = y + dy;
  let blocked = false;

  // Probe slightly ahead of the body so agents do not end up embedded in a wall.
  const probe = (px, py) => {
    if (radius <= 0) return mask.isSolid(px, py);
    return mask.isSolid(px, py)
      || mask.isSolid(px + radius, py) || mask.isSolid(px - radius, py)
      || mask.isSolid(px, py + radius) || mask.isSolid(px, py - radius);
  };

  if (probe(nx, y)) { nx = x; blocked = true; }
  if (probe(nx, ny)) { ny = y; blocked = true; }

  return { x: nx, y: ny, blocked, moved: Math.hypot(nx - x, ny - y) };
}
