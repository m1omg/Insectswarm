// Diagnostic scenario — not a colony.
//
// A seeded swarm of correlated random walkers used to verify the engine: that the fixed-timestep
// loop is refresh-rate independent, that both viewports draw and interpolate, that input works, and
// that the perf budget holds. It implements the same interface as the real scenarios, so it also
// keeps that interface honest. Tests import it as a deterministic fixture.

export const meta = {
  id: 'diagnostic',
  name: 'Diagnostic',
  glyph: '⌗',
  species: 'engine test pattern',
  blurb: 'Seeded random walkers for verifying the loop, the cameras and the frame budget.',
  fieldBounds: { x: 0, y: 0, w: 12, h: 8 },     // metres
  nestBounds: { x: 0, y: 0, w: 0.6, h: 0.4 },
  hidden: true,
};

export const PARAMS = {
  speed: { value: 0.05, unit: 'm/s', source: 'tuned', label: 'Walker speed' },
  sinuosity: { value: 2.2, unit: 'rad/s', source: 'tuned', label: 'Turn rate' },
};

export const NOTES = [
  {
    text: 'This pane is an engine test pattern rather than a colony. The walkers follow a correlated '
        + 'random walk — the same movement primitive the real scenarios build on, since insects '
        + 'searching without information do approximately this.',
    source: 'Engine diagnostic',
  },
];

export function create(world, rng) {
  const count = Math.min(400, world.budget.agents);
  const n = count;

  // Struct-of-arrays, as every scenario must be: no per-agent objects in the hot path.
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const px = new Float32Array(n);   // previous tick, for render interpolation
  const py = new Float32Array(n);
  const heading = new Float32Array(n);
  const inNest = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    inNest[i] = i % 3 === 0 ? 1 : 0;
    const b = inNest[i] ? meta.nestBounds : meta.fieldBounds;
    x[i] = px[i] = b.x + rng() * b.w;
    y[i] = py[i] = b.y + rng() * b.h;
    heading[i] = rng.angle();
  }

  const speed = PARAMS.speed.value;
  const sinuosity = PARAMS.sinuosity.value;

  return {
    meta,
    PARAMS,
    NOTES,

    step(dt) {
      for (let i = 0; i < n; i++) {
        px[i] = x[i];
        py[i] = y[i];

        heading[i] += rng.normal(0, sinuosity * Math.sqrt(dt));

        const b = inNest[i] ? meta.nestBounds : meta.fieldBounds;
        const scale = inNest[i] ? 0.25 : 1;   // the nest cutaway is a much smaller world
        let nx = x[i] + Math.cos(heading[i]) * speed * scale * dt;
        let ny = y[i] + Math.sin(heading[i]) * speed * scale * dt;

        // Reflect off the world edge rather than wrapping, so walkers stay in frame.
        if (nx < b.x || nx > b.x + b.w) { heading[i] = Math.PI - heading[i]; nx = x[i]; }
        if (ny < b.y || ny > b.y + b.h) { heading[i] = -heading[i]; ny = y[i]; }

        x[i] = nx;
        y[i] = ny;
      }
    },

    renderField(ctx, vp, alpha) { drawWalkers(ctx, vp, alpha, 0); },
    renderNest(ctx, vp, alpha) { drawWalkers(ctx, vp, alpha, 1); },

    stats() {
      return [['Walkers', n], ['In nest', inNest.reduce((a, v) => a + v, 0)]];
    },

    describe(wx, wy, which) {
      // Nearest walker in the tapped pane, if the tap landed near one.
      const want = which === 'nest' ? 1 : 0;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (inNest[i] !== want) continue;
        const d = (x[i] - wx) ** 2 + (y[i] - wy) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      const radius = want ? 0.02 : 0.3;
      if (best < 0 || bestD > radius * radius) return null;
      return {
        title: `Walker #${best}`,
        rows: [
          ['Position', `${x[best].toFixed(2)}, ${y[best].toFixed(2)} m`],
          ['Heading', `${((heading[best] * 180 / Math.PI) % 360).toFixed(0)}°`],
        ],
      };
    },
  };

  function drawWalkers(ctx, vp, alpha, want) {
    const r = 0.9 / vp.zoom;   // constant apparent size regardless of zoom
    ctx.fillStyle = want ? '#e0a33c' : '#c9bda6';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (inNest[i] !== want) continue;
      const ix = px[i] + (x[i] - px[i]) * alpha;
      const iy = py[i] + (y[i] - py[i]) * alpha;
      ctx.moveTo(ix + r, iy);
      ctx.arc(ix, iy, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}
