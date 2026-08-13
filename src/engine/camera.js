// Viewports and cameras.
//
// The stage is one canvas holding two viewports: the foraging field (top-down) and the nest cutaway
// (side-on). Each owns an independent camera so you can zoom right into the brood comb while the
// landscape stays wide. World units are metres; zoom is CSS pixels per metre.

export class Viewport {
  /**
   * @param {string} id
   * @param {object} opts
   * @param {{x:number,y:number,w:number,h:number}} opts.worldBounds  extent of the simulated world
   * @param {number} [opts.minZoom] @param {number} [opts.maxZoom]
   */
  constructor(id, { worldBounds, minZoom = 0.5, maxZoom = 200, label = '' }) {
    this.id = id;
    this.label = label;
    this.worldBounds = { ...worldBounds };
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;

    // Screen rect in CSS pixels, assigned by the layout each resize.
    this.rect = { x: 0, y: 0, w: 1, h: 1 };

    this.cx = worldBounds.x + worldBounds.w / 2;
    this.cy = worldBounds.y + worldBounds.h / 2;
    this.zoom = 1;
    this._fitPending = true;
  }

  setRect(x, y, w, h) {
    this.rect.x = x;
    this.rect.y = y;
    this.rect.w = Math.max(1, w);
    this.rect.h = Math.max(1, h);
    if (this._fitPending) {
      this.fit();
      this._fitPending = false;
    } else {
      this.clamp();
    }
  }

  /** Frame the whole world, with a little breathing room. */
  fit(padding = 0.98) {
    const b = this.worldBounds;
    this.zoom = Math.min(this.rect.w / b.w, this.rect.h / b.h) * padding;
    this.minZoom = this.zoom * 0.6;
    this.cx = b.x + b.w / 2;
    this.cy = b.y + b.h / 2;
    this.clamp();
  }

  contains(sx, sy) {
    const r = this.rect;
    return sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h;
  }

  worldToScreenX(wx) { return this.rect.x + this.rect.w / 2 + (wx - this.cx) * this.zoom; }
  worldToScreenY(wy) { return this.rect.y + this.rect.h / 2 + (wy - this.cy) * this.zoom; }
  screenToWorldX(sx) { return this.cx + (sx - this.rect.x - this.rect.w / 2) / this.zoom; }
  screenToWorldY(sy) { return this.cy + (sy - this.rect.y - this.rect.h / 2) / this.zoom; }

  panByScreen(dxPx, dyPx) {
    this.cx -= dxPx / this.zoom;
    this.cy -= dyPx / this.zoom;
    this.clamp();
  }

  /** Zoom about a screen point, so pinch and wheel keep the touched world point under the finger. */
  zoomAt(sx, sy, factor) {
    const wx = this.screenToWorldX(sx);
    const wy = this.screenToWorldY(sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    // Re-centre so (wx, wy) lands back under (sx, sy).
    this.cx = wx - (sx - this.rect.x - this.rect.w / 2) / this.zoom;
    this.cy = wy - (sy - this.rect.y - this.rect.h / 2) / this.zoom;
    this.clamp();
  }

  /** Keep the world in view: centre the axis when zoomed out past it, otherwise bound the edges. */
  clamp() {
    const b = this.worldBounds;
    const halfW = this.rect.w / 2 / this.zoom;
    const halfH = this.rect.h / 2 / this.zoom;

    if (halfW * 2 >= b.w) this.cx = b.x + b.w / 2;
    else this.cx = Math.min(b.x + b.w - halfW, Math.max(b.x + halfW, this.cx));

    if (halfH * 2 >= b.h) this.cy = b.y + b.h / 2;
    else this.cy = Math.min(b.y + b.h - halfH, Math.max(b.y + halfH, this.cy));
  }

  /** World-space rectangle currently visible, for culling. */
  visibleWorldRect(margin = 0) {
    const halfW = this.rect.w / 2 / this.zoom + margin;
    const halfH = this.rect.h / 2 / this.zoom + margin;
    return { x: this.cx - halfW, y: this.cy - halfH, w: halfW * 2, h: halfH * 2 };
  }

  /** Apply this viewport's transform to a 2D context, clipped to its rect. Caller must restore(). */
  applyTransform(ctx, dpr) {
    const r = this.rect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr);
    ctx.clip();
    ctx.translate((r.x + r.w / 2) * dpr, (r.y + r.h / 2) * dpr);
    ctx.scale(this.zoom * dpr, this.zoom * dpr);
    ctx.translate(-this.cx, -this.cy);
  }
}

/**
 * Size a canvas to its CSS box at device pixel ratio. Returns true when the backing store changed,
 * so callers can invalidate cached layers. DPR is capped: a 3x phone screen triples the fill cost
 * for a difference nobody can see on an insect two pixels wide.
 */
export function resizeCanvas(canvas, maxDpr = 2) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width === w && canvas.height === h) return { changed: false, dpr, cssWidth: rect.width, cssHeight: rect.height };
  canvas.width = w;
  canvas.height = h;
  return { changed: true, dpr, cssWidth: rect.width, cssHeight: rect.height };
}

/**
 * Split the stage between the two viewports. Landscape puts them side by side, portrait stacks
 * them, which is what a phone held upright actually wants.
 */
export function layoutViewports(field, nest, cssWidth, cssHeight, { fieldShare = 0.58, gap = 6 } = {}) {
  const landscape = cssWidth >= cssHeight * 1.15;
  if (landscape) {
    const fw = Math.round((cssWidth - gap) * fieldShare);
    field.setRect(0, 0, fw, cssHeight);
    nest.setRect(fw + gap, 0, cssWidth - fw - gap, cssHeight);
  } else {
    const fh = Math.round((cssHeight - gap) * fieldShare);
    field.setRect(0, 0, cssWidth, fh);
    nest.setRect(0, fh + gap, cssWidth, cssHeight - fh - gap);
  }
  return { landscape, gap };
}
