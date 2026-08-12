// Bootstrap: wires the engine to the DOM and swaps between colonies.
//
// This is the only module besides engine/ui.js allowed to touch the document. Everything under
// sim/ is pure simulation and knows nothing about the page it happens to be drawn on.

import { Loop, DT } from './engine/loop.js';
import { Viewport, resizeCanvas, layoutViewports } from './engine/camera.js';
import { PointerInput, bindKeys } from './engine/input.js';
import { QualityManager } from './engine/perf.js';
import { makeRng } from './engine/rng.js';
import { el, section, readout, note, bindSheet, chipGroup } from './engine/ui.js';

/** The four colonies, in the order they appear as tabs. */
const REGISTRY = [
  { id: 'ants',      name: 'Anthill',      glyph: '🐜', module: () => import('./sim/scenarios/ants.js') },
  { id: 'honeybees', name: 'Bee hive',     glyph: '🐝', module: () => import('./sim/scenarios/honeybees.js') },
  { id: 'wasps',     name: 'Wasp nest',    glyph: '🐝', module: () => import('./sim/scenarios/wasps.js') },
  { id: 'termites',  name: 'Termite mound', glyph: '🪳', module: () => import('./sim/scenarios/termites.js') },
];

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d', { alpha: false });
const hudEl = document.getElementById('hud');
const panelEl = document.getElementById('panel');
const panelContent = document.getElementById('panel-content');
const badgeField = document.getElementById('badge-field');
const badgeNest = document.getElementById('badge-nest');

const sheet = bindSheet(panelEl, document.getElementById('sheet-handle'));

const app = {
  scenario: null,
  scenarioId: null,
  seed: 'insectswarm',
  dpr: 1,
  cssWidth: 1,
  cssHeight: 1,
  landscape: true,
  inspected: null,
  fieldVp: null,
  nestVp: null,
};

const quality = new QualityManager((budget, tier) => {
  // A tier change resizes grids and agent pools, so the scenario is rebuilt from the same seed —
  // the colony you were watching continues to exist, it is just simulated at a different fidelity.
  if (app.scenario) buildScenario(app.scenarioId, { keepCamera: true });
  console.info(`[perf] quality → ${tier}`, budget);
});

// ---------------------------------------------------------------- viewports

function makeViewports(meta) {
  const keepField = app.fieldVp;
  const keepNest = app.nestVp;

  app.fieldVp = new Viewport('field', { worldBounds: meta.fieldBounds, label: 'Foraging field' });
  app.nestVp = new Viewport('nest', { worldBounds: meta.nestBounds, label: 'Nest cutaway' });

  // Preserve the camera across a quality rebuild of the same scenario.
  if (keepField && keepField.worldBounds.w === meta.fieldBounds.w) {
    Object.assign(app.fieldVp, { cx: keepField.cx, cy: keepField.cy, zoom: keepField.zoom, _fitPending: false });
  }
  if (keepNest && keepNest.worldBounds.w === meta.nestBounds.w) {
    Object.assign(app.nestVp, { cx: keepNest.cx, cy: keepNest.cy, zoom: keepNest.zoom, _fitPending: false });
  }

  relayout();
}

function relayout() {
  const { dpr, cssWidth, cssHeight } = resizeCanvas(canvas);
  app.dpr = dpr;
  app.cssWidth = cssWidth;
  app.cssHeight = cssHeight;
  if (app.fieldVp && app.nestVp) {
    const { landscape } = layoutViewports(app.fieldVp, app.nestVp, cssWidth, cssHeight);
    app.landscape = landscape;
    positionBadges();
  }
}

function positionBadges() {
  // Badges label each pane; in portrait the nest pane is below, so its badge moves with it.
  const nest = app.nestVp.rect;
  badgeField.textContent = app.fieldVp.label;
  badgeNest.textContent = app.nestVp.label;
  badgeNest.style.position = 'absolute';
  badgeNest.style.left = `${nest.x + 8}px`;
  badgeNest.style.top = `${nest.y + 8}px`;
  badgeNest.style.right = 'auto';
}

function viewportAt(sx, sy) {
  if (app.fieldVp?.contains(sx, sy)) return app.fieldVp;
  if (app.nestVp?.contains(sx, sy)) return app.nestVp;
  return null;
}

// --------------------------------------------------------------- scenarios

/** A stand-in used until a colony's module exists, so the tab bar is never broken. */
function comingSoon(id, name) {
  const bounds = { x: 0, y: 0, w: 10, h: 6 };
  return {
    meta: { id, name, fieldBounds: bounds, nestBounds: { x: 0, y: 0, w: 1, h: 0.6 }, species: '' },
    PARAMS: {},
    NOTES: [{ text: `${name} is not implemented yet.`, source: '' }],
    step() {},
    renderField(c, vp) { drawPlaceholder(c, vp, `${name} — coming soon`); },
    renderNest(c, vp) { drawPlaceholder(c, vp, ''); },
    stats: () => [],
    describe: () => null,
  };
}

function drawPlaceholder(c, vp, text) {
  if (!text) return;
  c.save();
  c.resetTransform();
  c.fillStyle = '#6f6455';
  c.font = `${13 * app.dpr}px ui-sans-serif, system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, (vp.rect.x + vp.rect.w / 2) * app.dpr, (vp.rect.y + vp.rect.h / 2) * app.dpr);
  c.restore();
}

async function buildScenario(id, { keepCamera = false } = {}) {
  const entry = REGISTRY.find((r) => r.id === id) || REGISTRY[0];
  app.scenarioId = entry.id;
  app.inspected = null;

  let scenario;
  try {
    const mod = await entry.module();
    const rng = makeRng(app.seed);
    scenario = mod.create({ budget: quality.budget, dt: DT, seed: app.seed }, rng);
    scenario.meta = scenario.meta || mod.meta;
    scenario.PARAMS = scenario.PARAMS || mod.PARAMS;
    scenario.NOTES = scenario.NOTES || mod.NOTES;
  } catch (err) {
    // A missing module is the expected case during the build-out; anything else is worth seeing.
    if (!(err instanceof TypeError) && err?.name !== 'TypeError') console.warn(`[scenario] ${id}:`, err);
    scenario = comingSoon(entry.id, entry.name);
  }

  app.scenario = scenario;
  if (!keepCamera) makeViewports(scenario.meta);
  else makeViewports(scenario.meta);

  app.fieldVp.label = scenario.meta.fieldLabel || 'Foraging field';
  app.nestVp.label = scenario.meta.nestLabel || 'Nest cutaway';
  positionBadges();

  buildPanel();
  syncTabs();
}

// ------------------------------------------------------------------- panel

let statsReadout = null;
let inspectorBox = null;

function buildPanel() {
  const s = app.scenario;
  panelContent.replaceChildren();

  panelContent.append(
    section(null,
      el('div.card', null,
        el('div', { style: { fontWeight: '650', marginBottom: '2px' }, text: s.meta.name }),
        s.meta.species && el('div', { style: { fontStyle: 'italic', color: 'var(--ink-dim)', fontSize: '12px' }, text: s.meta.species }),
        s.meta.blurb && el('p.note', { text: s.meta.blurb, style: { marginBottom: '0' } }),
      ),
    ),
  );

  statsReadout = readout(() => (app.scenario?.stats?.() ?? []));
  panelContent.append(section('Colony', el('div.card', null, statsReadout)));

  if (s.controls) {
    const nodes = s.controls();
    if (nodes?.length) panelContent.append(section('Controls', el('div.card', null, ...nodes)));
  }

  inspectorBox = el('div.card', null, el('div.empty', { text: 'Tap an individual to inspect it.' }));
  panelContent.append(section('Inspector', inspectorBox));

  const notes = (s.NOTES || []).map((n) => note(n.text, n.source));
  panelContent.append(section('Science notes', el('div.card', null, ...(notes.length ? notes : [el('div.empty', { text: 'No notes yet.' })]))));

  panelContent.append(
    section('Display',
      el('div.card', null,
        el('div', { style: { fontSize: '12px', color: 'var(--ink-dim)', marginBottom: '7px' }, text: 'Detail' }),
        chipGroup(
          [{ id: 'auto', label: 'Auto' }, { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }],
          {
            value: quality.locked ? quality.tier : 'auto',
            onChange: (v) => (v === 'auto' ? quality.setAuto() : quality.setTier(v)),
          },
        ),
        el('div.row', { style: { marginTop: '9px' } },
          el('button.grow', { type: 'button', text: 'Reset view', onclick: () => { app.fieldVp.fit(); app.nestVp.fit(); } }),
          el('button.grow', { type: 'button', text: 'Restart', onclick: () => buildScenario(app.scenarioId) }),
        ),
      ),
    ),
  );
}

function showInspection(info) {
  if (!inspectorBox) return;
  if (!info) {
    inspectorBox.replaceChildren(el('div.empty', { text: 'Tap an individual to inspect it.' }));
    return;
  }
  inspectorBox.replaceChildren(
    el('div', { style: { fontWeight: '650', marginBottom: '5px' }, text: info.title }),
    readout(() => info.rows),
  );
}

// -------------------------------------------------------------------- tabs

const tabsEl = document.getElementById('scenario-tabs');
const tabButtons = new Map();

for (const entry of REGISTRY) {
  const btn = el('button.tab', {
    type: 'button', role: 'tab', 'aria-selected': 'false',
    onclick: () => buildScenario(entry.id),
  },
    el('span.glyph', { text: entry.glyph, 'aria-hidden': 'true' }),
    entry.name,
  );
  tabButtons.set(entry.id, btn);
  tabsEl.append(btn);
}

function syncTabs() {
  for (const [id, btn] of tabButtons) btn.setAttribute('aria-selected', id === app.scenarioId ? 'true' : 'false');
}

// --------------------------------------------------------------- transport

const playBtn = document.getElementById('btn-play');
const speedSel = document.getElementById('speed');

const loop = new Loop({
  step: (dt) => app.scenario?.step(dt),
  render: (alpha, frameSeconds) => {
    quality.sample(frameSeconds);
    draw(alpha);
  },
});

playBtn.addEventListener('click', () => setPaused(!loop.paused));
speedSel.addEventListener('change', () => loop.setSpeed(Number(speedSel.value)));

function setPaused(paused) {
  loop.setPaused(paused);
  playBtn.textContent = paused ? '▶' : '❙❙';
  playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
}

// ------------------------------------------------------------------ render

let hudTimer = 0;

function draw(alpha) {
  const { dpr } = app;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#14100c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const s = app.scenario;
  if (!s) return;

  drawPane(app.fieldVp, (c, vp) => s.renderField(c, vp, alpha));
  drawPane(app.nestVp, (c, vp) => s.renderNest(c, vp, alpha));

  // Divider between the panes.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#4a3f31';
  if (app.landscape) {
    const x = (app.fieldVp.rect.x + app.fieldVp.rect.w + 2) * dpr;
    ctx.fillRect(x, 0, Math.max(1, dpr), canvas.height);
  } else {
    const y = (app.fieldVp.rect.y + app.fieldVp.rect.h + 2) * dpr;
    ctx.fillRect(0, y, canvas.width, Math.max(1, dpr));
  }

  hudTimer++;
  if (hudTimer % 15 === 0) updateHud();
  if (hudTimer % 10 === 0) statsReadout?.refresh();
}

function drawPane(vp, fn) {
  const { dpr } = app;
  vp.applyTransform(ctx, dpr);
  fn(ctx, vp);
  ctx.restore();
}

function updateHud() {
  const b = quality.budget;
  hudEl.textContent =
    `${loop.fps.toFixed(0)} fps · ${loop.stepsLastFrame} tick${loop.stepsLastFrame === 1 ? '' : 's'}/frame`
    + `${loop.throttled ? ' · throttled' : ''}\n`
    + `${quality.tier} · ≤${b.agents} agents · ${(loop.simTime / 60).toFixed(1)} sim-min`;
}

// ------------------------------------------------------------------- input

new PointerInput(canvas, {
  viewportAt,
  onTap: (vp, wx, wy) => {
    const info = app.scenario?.describe?.(wx, wy, vp.id) ?? null;
    app.inspected = info;
    showInspection(info);
    if (info && !app.landscape) sheet.setOpen(true);
  },
  onLongPress: (vp, wx, wy) => {
    app.scenario?.applyTool?.(wx, wy, vp.id);
  },
  onDragTool: (vp, wx, wy, phase) => {
    app.scenario?.applyTool?.(wx, wy, vp.id, phase);
  },
  toolIsDragging: () => Boolean(app.scenario?.toolIsDragging?.()),
});

bindKeys({
  ' ': () => setPaused(!loop.paused),
  '.': () => { if (loop.paused) { loop.singleStep(); draw(0); } },
  'r': () => buildScenario(app.scenarioId),
  'f': () => { app.fieldVp.fit(); app.nestVp.fit(); },
  '1': () => buildScenario(REGISTRY[0].id),
  '2': () => buildScenario(REGISTRY[1].id),
  '3': () => buildScenario(REGISTRY[2].id),
  '4': () => buildScenario(REGISTRY[3].id),
});

// ------------------------------------------------------------------ startup

const resizeObserver = new ResizeObserver(() => relayout());
resizeObserver.observe(canvas);
window.addEventListener('orientationchange', () => setTimeout(relayout, 120));

await buildScenario(REGISTRY[0].id);
setPaused(false);
loop.setSpeed(Number(speedSel.value));
loop.start();

// Exposed for headless verification and console poking.
window.insectswarm = { app, loop, quality, buildScenario };
