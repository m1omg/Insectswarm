// Scientific overlays: drawing a scalar field as a heatmap over the scene.
//
// The naturalistic view is the default, but the interesting quantities in this simulation are
// invisible in real life — pheromone concentration, nest temperature, CO2. Each overlay renders its
// field into a small offscreen canvas at grid resolution and lets the GPU scale it up, which costs
// the same regardless of how far you have zoomed in.

/**
 * Colour ramps, as functions from 0..1 to [r, g, b]. Chosen to stay distinguishable on the dark
 * soil background and to read correctly for the quantity: warm for chemistry, a cold-to-hot
 * divergence for temperature.
 */
export const RAMPS = {
  /** Trail pheromone: transparent soil through amber to near-white at saturation. */
  pheromone: (t) => [40 + 215 * t, 30 + 150 * t * t, 20 + 60 * t * t * t],

  /** A second pheromone that must be told apart from the first at a glance. */
  pheromoneAlt: (t) => [30 + 90 * t * t, 60 + 170 * t, 90 + 130 * t],

  /** Temperature: blue cold, through neutral, to red hot. */
  temperature: (t) => {
    const c = Math.min(1, Math.max(0, t));
    if (c < 0.5) {
      const u = c * 2;
      return [40 + 150 * u, 90 + 110 * u, 200 - 30 * u];
    }
    const u = (c - 0.5) * 2;
    return [190 + 60 * u, 200 - 140 * u, 170 - 150 * u];
  },

  /** CO2 and other stale-air measures: clean green to alarming violet. */
  co2: (t) => [60 + 150 * t * t, 150 - 90 * t, 70 + 160 * t],

  /** Humidity / moisture. */
  moisture: (t) => [40 + 40 * t, 90 + 90 * t, 110 + 130 * t],
};

export class FieldOverlay {
  /**
   * @param {import('./field.js').Field} field
   * @param {(t:number)=>number[]} ramp
   * @param {object} opts
   * @param {number} [opts.min] @param {number} [opts.max]  fixed scale; omit to auto-normalise
   * @param {number} [opts.gamma]  <1 lifts faint values into view, which matters for pheromone
   *   where the interesting structure lives far below the peak concentration
   */
  constructor(field, ramp, { min = null, max = null, gamma = 0.55, opacity = 0.75 } = {}) {
    this.field = field;
    this.ramp = ramp;
    this.min = min;
    this.max = max;
    this.gamma = gamma;
    this.opacity = opacity;

    this.canvas = document.createElement('canvas');
    this.canvas.width = field.cols;
    this.canvas.height = field.rows;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(field.cols, field.rows);

    // Cache the ramp so we are not calling it once per cell per frame.
    this.lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = ramp(i / 255);
      this.lut[i * 3] = r;
      this.lut[i * 3 + 1] = g;
      this.lut[i * 3 + 2] = b;
    }

    this.dirty = true;
  }

  /** Rebuild the offscreen image from the current field values. */
  refresh() {
    const { field, image, lut } = this;
    const data = image.data;
    const src = field.data;

    const lo = this.min ?? 0;
    const hi = this.max ?? Math.max(field.maxValue, 1e-6);
    const span = hi - lo || 1;
    const invGamma = this.gamma;

    for (let i = 0, p = 0; i < src.length; i++, p += 4) {
      let t = (src[i] - lo) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      // Alpha carries the intensity so the scene shows through where there is nothing.
      const alpha = Math.pow(t, invGamma);
      const idx = (Math.min(255, Math.round(alpha * 255)) | 0) * 3;
      data[p] = lut[idx];
      data[p + 1] = lut[idx + 1];
      data[p + 2] = lut[idx + 2];
      data[p + 3] = alpha * 255;
    }

    this.ctx.putImageData(image, 0, 0);
    this.dirty = false;
  }

  /**
   * Draw into a viewport that already has its world transform applied. Smoothing is left on: the
   * grid is a discretisation of something continuous, so interpolating between cells is honest.
   */
  draw(ctx, viewport) {
    if (this.dirty) this.refresh();
    const b = this.field.bounds;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * this.opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(this.canvas, b.x, b.y, b.w, b.h);
    ctx.globalAlpha = prev;
    void viewport;
  }
}

/**
 * A colour key for whichever overlay is showing, drawn in screen space in the corner of a pane.
 * Without one, a heatmap is decoration rather than data.
 */
export function drawLegend(ctx, dpr, rect, { title, ramp, minLabel, maxLabel }) {
  const w = 108 * dpr;
  const h = 8 * dpr;
  const x = (rect.x + rect.w) * dpr - w - 10 * dpr;
  const y = (rect.y + rect.h) * dpr - 26 * dpr;

  ctx.save();
  ctx.resetTransform();

  ctx.font = `${10 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#a89b86';
  ctx.fillText(title, x, y - 3 * dpr);

  const gradient = ctx.createLinearGradient(x, 0, x + w, 0);
  for (let i = 0; i <= 8; i++) {
    const [r, g, b] = ramp(i / 8);
    gradient.addColorStop(i / 8, `rgb(${r | 0},${g | 0},${b | 0})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#4a3f31';
  ctx.lineWidth = dpr;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = '#6f6455';
  ctx.textBaseline = 'top';
  ctx.fillText(minLabel, x, y + h + 2 * dpr);
  ctx.textAlign = 'right';
  ctx.fillText(maxLabel, x + w, y + h + 2 * dpr);

  ctx.restore();
}
