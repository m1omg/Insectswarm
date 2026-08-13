// Rendering helpers.
//
// Thousands of insects at 60 Hz cannot each be a sequence of path operations, so bodies are drawn
// once into a sprite sheet of pre-rotated frames and then blitted. Agents are drawn in screen space
// with the transform reset — computing two multiplications per insect is cheaper than asking the
// canvas to save, translate, rotate and restore for each one.

/**
 * A sheet of one body drawn at N evenly spaced headings.
 *
 * Insects are small on screen; 24 rotations is more angular resolution than anyone can see, and it
 * turns a per-agent rotation into an array lookup.
 */
export class SpriteAtlas {
  /**
   * @param {number} sizePx        cell size in device pixels, must fit the body plus legs
   * @param {number} rotations
   * @param {(ctx:CanvasRenderingContext2D, size:number)=>void} paint
   *   draws one body centred at the origin, pointing along +x, in a `size` box
   */
  constructor(sizePx, rotations, paint) {
    this.size = Math.max(4, Math.ceil(sizePx));
    this.rotations = rotations;
    this.half = this.size / 2;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size * rotations;
    this.canvas.height = this.size;
    const ctx = this.canvas.getContext('2d');

    for (let r = 0; r < rotations; r++) {
      ctx.save();
      ctx.translate(r * this.size + this.half, this.half);
      ctx.rotate((r / rotations) * Math.PI * 2);
      paint(ctx, this.size);
      ctx.restore();
    }
  }

  /** Frame index for a heading in radians. */
  frameFor(heading) {
    let t = heading / (Math.PI * 2);
    t -= Math.floor(t);
    const f = Math.round(t * this.rotations);
    return f >= this.rotations ? 0 : f;
  }
}

/**
 * Blit one sprite at a screen position. Call with the transform reset; `sx`/`sy` are device pixels.
 */
export function drawSprite(ctx, atlas, sx, sy, heading, scale = 1) {
  const f = atlas.frameFor(heading);
  const s = atlas.size * scale;
  ctx.drawImage(
    atlas.canvas,
    f * atlas.size, 0, atlas.size, atlas.size,
    sx - s / 2, sy - s / 2, s, s,
  );
}

/**
 * Draw a whole population in one pass. Positions are interpolated between the previous and current
 * tick so motion stays smooth when the display refreshes faster than the simulation ticks.
 *
 * @param {object} opts
 * @param {(i:number)=>SpriteAtlas|null} opts.atlasFor  per-agent sprite choice, null to skip
 * @param {number} [opts.cull]  world-space margin outside the view before an agent is skipped
 */
export function drawPopulation(ctx, vp, dpr, pool, alpha, { atlasFor, scale = 1, cull = 0.2 }) {
  ctx.save();
  ctx.resetTransform();
  ctx.beginPath();
  ctx.rect(vp.rect.x * dpr, vp.rect.y * dpr, vp.rect.w * dpr, vp.rect.h * dpr);
  ctx.clip();

  const view = vp.visibleWorldRect(cull);
  const minX = view.x;
  const maxX = view.x + view.w;
  const minY = view.y;
  const maxY = view.y + view.h;

  const offX = (vp.rect.x + vp.rect.w / 2) * dpr;
  const offY = (vp.rect.y + vp.rect.h / 2) * dpr;
  const zoom = vp.zoom * dpr;

  for (let i = 0; i < pool.highWater; i++) {
    if (!pool.alive[i]) continue;

    const x = pool.px[i] + (pool.x[i] - pool.px[i]) * alpha;
    const y = pool.py[i] + (pool.y[i] - pool.py[i]) * alpha;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;

    const atlas = atlasFor(i);
    if (!atlas) continue;

    drawSprite(ctx, atlas, offX + (x - vp.cx) * zoom, offY + (y - vp.cy) * zoom, pool.heading[i], scale);
  }

  ctx.restore();
}

/* --------------------------------------------------------------- body shapes */

/**
 * A generic three-tagma insect: head, thorax, abdomen, six legs. Proportions are passed in so the
 * same routine draws a slender ant and a fat bumblebee.
 *
 * Drawn pointing along +x, centred on the thorax, in a box of `size` device pixels.
 */
export function paintInsect(ctx, size, {
  body = '#2b1d12',
  accent = null,
  headLen = 0.20,
  thoraxLen = 0.22,
  abdomenLen = 0.34,
  width = 0.30,
  legs = true,
  legColour = null,
  wings = false,
} = {}) {
  const s = size;
  const w = (width * s) / 2;

  if (legs) {
    ctx.strokeStyle = legColour || body;
    ctx.lineWidth = Math.max(0.6, s * 0.035);
    ctx.lineCap = 'round';
    ctx.beginPath();
    // Three pairs, splayed forward, out and back — the usual insect stance.
    for (const [ox, angle, len] of [[-0.02, -0.9, 0.42], [0.02, -0.1, 0.46], [0.06, 0.75, 0.42]]) {
      const bx = ox * s;
      for (const side of [-1, 1]) {
        const ex = bx + Math.cos(angle) * len * s * 0.5;
        const ey = side * Math.sin(Math.abs(angle) + 0.9) * len * s * 0.5;
        ctx.moveTo(bx, 0);
        ctx.lineTo(ex, ey);
      }
    }
    ctx.stroke();
  }

  if (wings) {
    ctx.fillStyle = 'rgba(220, 232, 240, 0.30)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(-0.04 * s, side * w * 0.7, s * 0.26, s * 0.10, side * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = body;

  // Abdomen, behind the thorax.
  ctx.beginPath();
  ctx.ellipse(-(thoraxLen / 2 + abdomenLen / 2) * s * 0.9, 0, (abdomenLen / 2) * s, w * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Thorax.
  ctx.beginPath();
  ctx.ellipse(0, 0, (thoraxLen / 2) * s, w * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head, plus antennae.
  const headX = (thoraxLen / 2 + headLen / 2) * s * 0.92;
  ctx.beginPath();
  ctx.ellipse(headX, 0, (headLen / 2) * s, w * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = body;
  ctx.lineWidth = Math.max(0.5, s * 0.028);
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(headX, side * w * 0.4);
    ctx.quadraticCurveTo(headX + s * 0.14, side * w * 1.1, headX + s * 0.22, side * w * 1.5);
  }
  ctx.stroke();

  // Banding or a coloured gaster: what makes a wasp a wasp at four pixels across.
  if (accent) {
    ctx.fillStyle = accent;
    const ax = -(thoraxLen / 2 + abdomenLen / 2) * s * 0.9;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.ellipse(ax - i * s * 0.09 + s * 0.05, 0, s * 0.03, w * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** A carried load — a seed, a prey item, a soil pellet — held in front of the head. */
export function paintCarrying(ctx, size, colour, radius = 0.13) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(size * 0.32, 0, size * radius, 0, Math.PI * 2);
  ctx.fill();
}

/* -------------------------------------------------------------- scene dressing */

/** Deterministic value noise, so ground texture is stable between frames without storing it. */
export function hashNoise(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Speckled ground, baked once into a tile and repeated. Called with the world transform applied.
 */
export function makeGroundPattern(ctx, baseColour, speckleColour, tilePx = 64, density = 0.04) {
  const c = document.createElement('canvas');
  c.width = c.height = tilePx;
  const g = c.getContext('2d');
  g.fillStyle = baseColour;
  g.fillRect(0, 0, tilePx, tilePx);
  g.fillStyle = speckleColour;
  for (let y = 0; y < tilePx; y++) {
    for (let x = 0; x < tilePx; x++) {
      if (hashNoise(x, y, 7) < density) g.fillRect(x, y, 1, 1);
    }
  }
  return ctx.createPattern(c, 'repeat');
}

/** Text drawn in screen space at a world anchor — labels for chambers, patches and structures. */
export function drawWorldLabel(ctx, vp, dpr, wx, wy, text, { colour = '#a89b86', size = 11, offsetY = 0 } = {}) {
  ctx.save();
  ctx.resetTransform();
  ctx.font = `${size * dpr}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, vp.worldToScreenX(wx) * dpr, (vp.worldToScreenY(wy) + offsetY) * dpr);
  ctx.restore();
}
