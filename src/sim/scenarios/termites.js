// Termite mound — Macrotermes.
//
// The odd one out, and deliberately so. These are not wasps, bees or ants — they are cockroaches
// that took up farming. The workers are blind and sterile, the colony grows a fungus it cannot live
// without, and the thing it is famous for is a building.
//
// The mechanism on display is stigmergy: the word Grassé coined for exactly this animal. No termite
// has a plan of the mound and none is directing the others. Each one responds to what the mound
// already is — where soil has recently been put, how sharply the surface curves, how fast water is
// evaporating from it — and puts its own pellet accordingly. The structure is the message. Pillars
// rise, lean towards their neighbours and meet as arches, and nobody ever decided that they should.
//
// A caveat worth stating plainly, because the textbooks usually do not: the "cement pheromone" that
// is supposed to drive this has never been chemically identified. It has been the standard
// explanation since the 1950s and it may well be right, but it is a hypothesis. Two other
// mechanisms have good recent evidence — that termites prefer to build where the surface curves
// sharply, and that evaporation from damp soil is what actually guides them. All three are
// implemented here as separate, switchable cues, because pretending the question is settled would
// be worse science than showing you the argument.

import { createPool, MOTION_SCHEMA } from '../../engine/agents.js';
import { Field } from '../../engine/field.js';
import { GridMask, SOLID, OPEN } from '../../engine/gridmask.js';
import { SpriteAtlas, drawPopulation, paintInsect, paintCarrying, drawWorldLabel } from '../../engine/render.js';
import { FieldOverlay, RAMPS, drawLegend } from '../../engine/overlays.js';
import { el, slider, toggle, chipGroup } from '../../engine/ui.js';
import {
  SeasonClock, Stores, SurvivalGoal, createBroodPool, advanceBrood, STAGE,
} from '../colony.js';
import {
  wrapAngle, turnToward, wanderTurn, storePrevious, distance, bearing, TAU,
} from '../behaviour.js';

export const meta = {
  id: 'termites',
  name: 'Termite mound',
  glyph: '🪳',
  species: 'Macrotermes',
  blurb: 'Blind builders and a fungus farm. Nobody has a plan: each termite responds to what the '
       + 'mound already is, and pillars become arches become walls.',
  fieldBounds: { x: 0, y: 0, w: 44, h: 30 },        // savanna around the mound, metres
  nestBounds: { x: 0, y: 0, w: 2.6, h: 2.2 },       // mound cross-section, metres
  fieldLabel: 'Savanna',
  nestLabel: 'Mound cross-section',
};

export const PARAMS = {
  cementPheromoneWeight: {
    value: 1, unit: 'weight', label: 'Cue: recent deposits', min: 0, max: 2,
    source: 'The classical "cement pheromone" hypothesis: soil already deposited carries a marker '
          + 'that stimulates further deposition, giving positive feedback. Never chemically '
          + 'identified — see the note on uncertainty.',
  },
  curvatureWeight: {
    value: 1, unit: 'weight', label: 'Cue: surface curvature', min: 0, max: 2,
    source: 'Calovi et al. (2019), Proc. R. Soc. B 286:20182588 — surface curvature guides early '
          + 'construction activity in mound-building termites; deposition favours convex points.',
  },
  evaporationWeight: {
    value: 1, unit: 'weight', label: 'Cue: evaporation', min: 0, max: 2,
    source: 'Facchini et al. (2023), eLife 12:e86843 — substrate evaporation drives collective '
          + 'construction in termites.',
  },
  cueHalfLife: {
    value: 12, unit: 'min', label: 'Deposit cue half-life', min: 1, max: 90,
    source: 'tuned — how long a fresh deposit keeps attracting more. Short half-lives give scattered '
          + 'lumps, long ones give a few tall pillars.',
  },
  soldierFraction: {
    value: 0.14, unit: 'fraction', label: 'Soldiers',
    source: 'Macrotermes gilvus censuses give roughly 42% workers, 43% larvae and 14% soldiers '
          + '(Ann. Entomol. Soc. Am. 105:427).',
  },
  larvaFraction: {
    value: 0.43, unit: 'fraction',
    source: 'As above — larvae are the largest single class in the colony.',
  },
  colonySize: {
    value: 33500, unit: 'individuals',
    source: 'Medium Macrotermes gilvus mounds held 33,500 +/- 2,400 individuals; large ones over '
          + '61,000 (Ann. Entomol. Soc. Am. 105:427).',
  },
  nestCO2Percent: {
    value: 3, unit: '%', label: 'CO2 the colony tolerates', min: 0.5, max: 8,
    source: 'Nest air runs about 2% lower in oxygen than outside, with CO2 reaching up to ~6% — far '
          + 'beyond what would kill most insects.',
  },
  mediumMoundAirPerDay: {
    value: 1200, unit: 'L/day',
    source: 'A large colony of roughly 2 million termites needs on the order of 1,200 L of air a '
          + 'day; big Macrotermes jeanneli mounds vent 800-1,500 L of CO2 daily.',
  },
  fungusOptimumC: {
    value: 30, unit: '°C', label: 'Fungus comb optimum', min: 24, max: 36,
    source: 'Termitomyces combs are held close to 30 °C; mound architecture correlates with the '
          + 'temperature the symbiont needs (PMC6339472).',
  },
  workerSpeed: {
    value: 0.02, unit: 'm/s',
    source: 'tuned — a Macrotermes worker is a slow walker, and blind.',
  },
  simSecondsPerDay: {
    value: 120, unit: 's/day', label: 'Day length', min: 30, max: 600,
    source: 'tuned — display compression.',
  },
};

export const NOTES = [
  {
    text: 'Grassé invented the word stigmergy for these animals. It means coordination through the '
        + 'work itself: a termite does not take instructions, it reacts to the state of the '
        + 'building, and its reaction changes that state for whoever comes next. Watch pillars '
        + 'appear at random, then lean and meet. No termite ever intended an arch.',
    source: 'Grassé (1959); Insectes Sociaux 6:41-80.',
  },
  {
    text: 'Here is the honest part. The "cement pheromone" that supposedly drives all this has never '
        + 'been chemically identified. It has been the textbook explanation since the 1950s, and it '
        + 'may be right, but it remains a hypothesis with no isolated compound behind it. This '
        + 'simulation therefore does not treat it as fact: it is one of three switchable cues, and '
        + 'you can turn it off and watch the mound still get built.',
    source: 'Reviewed in Excavation and aggregation as organizing factors in de novo construction, '
          + 'Proc. R. Soc. B 284:20162730.',
  },
  {
    text: 'The second cue is geometric. Termites deposit preferentially where the surface curves '
        + 'sharply — on the tips of things — which turns any accidental bump into a pillar without '
        + 'needing a chemical at all.',
    source: 'Calovi et al. (2019), Proc. R. Soc. B 286:20182588.',
  },
  {
    text: 'The third is about water. Fresh soil pellets are wet, and where evaporation is fastest is '
        + 'where termites build. On this account the "pheromone" may largely have been humidity all '
        + 'along. Turn the three cues on and off in any combination and compare the mounds you get.',
    source: 'Facchini et al. (2023), eLife 12:e86843.',
  },
  {
    text: 'The mound is not a nest — the colony lives below it. It is a lung. Metabolism from the '
        + 'termites and their fungus pushes warm, CO2-rich air up through the middle, and it cools '
        + 'and sinks through the porous outer walls. A big colony shifts on the order of a thousand '
        + 'litres of air a day this way, and holds CO2 at a few per cent, which would kill most '
        + 'insects outright.',
    source: 'Thermoregulation and ventilation of termite mounds, Naturwissenschaften 89:232.',
  },
  {
    text: 'These termites cannot digest wood on their own. They farm a fungus, Termitomyces, on '
        + 'combs built from their own faeces, and eat its nodules. The queen and the youngest larvae '
        + 'live almost entirely on fungal material. Foragers bringing in grass and litter are '
        + 'feeding the fungus, not themselves.',
    source: 'Caste-specific nutritional differences in African termite mounds, Sci. Rep. 9:17383.',
  },
];

/* --------------------------------------------------------------------- tasks */

const TASK = {
  QUARRY: 0,      // digging out a soil pellet
  CARRY: 1,       // carrying a pellet, looking for somewhere to put it
  FORAGE: 2,      // out on the savanna cutting grass and litter
  RETURN: 3,
  TEND_FUNGUS: 4,
  NURSE: 5,
  IDLE: 6,
  DEFEND: 7,      // soldier heading for a breach
  PATROL: 8,
  QUEEN: 9,
};

const TASK_NAMES = [
  'quarrying soil', 'carrying a soil pellet', 'cutting grass', 'carrying litter home',
  'tending the fungus comb', 'tending brood', 'idle', 'rushing a breach', 'patrolling', 'laying eggs',
];

const CASTE = { WORKER: 0, SOLDIER: 1, QUEEN: 2 };

export function create(world, rng) {
  const params = Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, v.value]));

  const clock = new SeasonClock({
    simSecondsPerDay: params.simSecondsPerDay,
    startDay: 330.4,        // late November: the wet season in southern Africa, when mounds grow
    latitude: -20,          // southern hemisphere savanna
    meanTempC: 22,
    seasonalRangeC: 9,
    diurnalRangeC: 14,      // savanna days are hot and nights are cold
  });

  const fb = meta.fieldBounds;
  const nb = meta.nestBounds;

  const GROUND_Y = nb.h * 0.62;         // where the savanna surface cuts the cross-section
  const entrance = { x: fb.w * 0.5, y: fb.h * 0.5 };

  /* ----------------------------------------------------------- the mound */

  // Soil occupancy. Everything below ground starts solid; the mound above it is what the termites
  // build. Resolution is deliberately fine, because the shapes are the point.
  const mound = new GridMask(nb, 170, OPEN);
  const cellSize = mound.cellSize;

  function excavateStartingNest() {
    mound.rect(0, GROUND_Y, nb.w, nb.h - GROUND_Y, SOLID);

    // The hive: a habitable void under the mound, with the royal cell at its heart.
    mound.disc(nb.w * 0.5, GROUND_Y + 0.30, 0.34, OPEN);

    // Fungus comb chambers around the edge of the void.
    for (const [fx, fy] of FUNGUS_CHAMBERS) mound.disc(fx, fy, 0.075, OPEN);

    // Galleries from the nest void up to the surface, spread across the width.
    //
    // The mound starts as bare ground rather than a ready-made cone, and the builders come up at
    // many points rather than one. That is deliberate: the studies this scenario cites — Calovi on
    // curvature, Facchini on evaporation — both watch termites build on an open surface, and it is
    // on an open surface that the classic result appears. Pillars come up at random spots, the ones
    // that get going draw more soil, and neighbouring pillars lean together into arches. Give them
    // a finished cone and a single chimney and there is nothing to see.
    for (const sx of SHAFTS) {
      mound.line(sx, GROUND_Y + 0.16, sx, GROUND_Y - 0.03, 0.030, OPEN);
    }
  }

  const FUNGUS_CHAMBERS = [
    [nb.w * 0.30, GROUND_Y + 0.22], [nb.w * 0.70, GROUND_Y + 0.22],
    [nb.w * 0.32, GROUND_Y + 0.44], [nb.w * 0.68, GROUND_Y + 0.44],
  ];
  const royalCell = { x: nb.w * 0.5, y: GROUND_Y + 0.30 };

  /** Galleries to the surface, spread across the width so builders emerge all over it. */
  const SHAFTS = [0.18, 0.30, 0.40, 0.50, 0.60, 0.70, 0.82].map((f) => nb.w * f);
  const SURFACE_Y = GROUND_Y - 0.02;

  function nearestShaft(x) {
    let best = SHAFTS[0];
    let bestD = Infinity;
    for (const sx of SHAFTS) {
      const d = Math.abs(sx - x);
      if (d < bestD) { bestD = d; best = sx; }
    }
    return best;
  }

  excavateStartingNest();

  /* --------------------------------------------------------------- fields */

  // The deposition cue: whatever it is that makes a termite build where others just built. Decays,
  // which is what stops the whole mound becoming one lump.
  const cue = new Field(nb, 120, { halfLifeMinutes: params.cueHalfLife, diffusion: 0.10 });

  // Humidity, and therefore evaporation. Fresh pellets are wet; the mound is damp inside and dry
  // outside, and the gradient across the wall is what the evaporation hypothesis says guides them.
  const humidity = new Field(nb, 90, { halfLifeMinutes: Infinity, diffusion: 0.30, ambient: 0.25, relaxPerMinute: 0.25 });

  // Nest air. Both are lumped scalars painted onto fields for display, for the same reason the bee
  // hive's temperature is: they are bulk properties of a well-mixed volume, not substances that
  // diffuse pellet by pellet.
  const co2Field = new Field(nb, 60, { halfLifeMinutes: Infinity });
  const tempField = new Field(nb, 60, { halfLifeMinutes: Infinity });

  let nestCO2 = 2.0;        // per cent
  let nestTemp = 29;        // °C
  let fieldAccumulator = 0;

  /* --------------------------------------------------------------- agents */

  const capacity = Math.max(200, Math.min(world.budget.agents, 1500));
  const termites = createPool(capacity, {
    ...MOTION_SCHEMA,
    inMound: 'u8',
    caste: 'u8',
    carrying: 'u8',       // 0 nothing, 1 soil pellet, 2 plant litter
    site: 'i32',
    restTime: 'f32',
  });

  const brood = createBroodPool(Math.max(200, Math.round(capacity * 0.8)));

  const stores = new Stores({ litter: 120, fungus: 240 });
  stores.setCapacity('litter', 900);
  stores.setCapacity('fungus', 1400);

  const goal = new SurvivalGoal({
    label: 'mound raised and kept breathable',
    target: 22,
    deadline: 'through the wet season',
  });

  const runtime = {
    pelletsPlaced: 0,
    pelletsQuarried: 0,
    litterBrought: 0,
    breaches: 0,
    breachSealed: 0,
    peakHeight: 0,
    co2Peak: 0,
    alates: 0,
  };

  const view = { overlay: 'none', tool: 'breach', showCues: true };

  /* ------------------------------------------------------------- foraging */

  const litterSites = [];
  function addLitter(x, y, amount = 4000) {
    if (litterSites.length >= 8) litterSites.shift();
    litterSites.push({ x, y, r: 2.2, amount });
  }
  addLitter(fb.w * 0.22, fb.h * 0.28);
  addLitter(fb.w * 0.78, fb.h * 0.66);

  /* ----------------------------------------------------------- population */

  function spawnTermite(caste, inMound = 1) {
    const i = termites.spawn();
    if (i < 0) return -1;
    termites.caste[i] = caste;
    termites.inMound[i] = inMound;
    termites.speed[i] = params.workerSpeed * (caste === CASTE.SOLDIER ? 0.85 : 1) * rng.range(0.85, 1.15);
    termites.heading[i] = rng.angle();
    termites.task[i] = caste === CASTE.SOLDIER ? TASK.PATROL : TASK.IDLE;
    termites.site[i] = -1;

    if (inMound) {
      const spot = rng.chance(0.5) ? royalCell : { x: nb.w * 0.5, y: GROUND_Y + 0.22 };
      termites.x[i] = spot.x + rng.range(-0.22, 0.22);
      termites.y[i] = spot.y + rng.range(-0.14, 0.14);
      if (mound.isSolid(termites.x[i], termites.y[i])) {
        termites.x[i] = royalCell.x;
        termites.y[i] = royalCell.y;
      }
    } else {
      termites.x[i] = entrance.x;
      termites.y[i] = entrance.y;
    }
    termites.px[i] = termites.x[i];
    termites.py[i] = termites.y[i];
    return i;
  }

  const startingCount = Math.min(Math.round(capacity * 0.7), 620);
  for (let n = 0; n < startingCount; n++) {
    spawnTermite(rng.chance(params.soldierFraction) ? CASTE.SOLDIER : CASTE.WORKER);
  }

  const queenIndex = spawnTermite(CASTE.QUEEN);
  termites.task[queenIndex] = TASK.QUEEN;
  termites.x[queenIndex] = royalCell.x;
  termites.y[queenIndex] = royalCell.y;
  termites.speed[queenIndex] = 0;

  for (let n = 0; n < 120; n++) {
    const b = brood.spawn();
    if (b < 0) break;
    const a = rng.angle();
    const r = Math.sqrt(rng()) * 0.2;
    brood.x[b] = royalCell.x + Math.cos(a) * r;
    brood.y[b] = royalCell.y + Math.sin(a) * r * 0.6;
    brood.stage[b] = rng.int(0, 1);
    brood.nutrition[b] = 1;
  }

  /* ------------------------------------------------------- the breach */

  /** An aardvark, or a raiding column of ants. Either way, a hole in the wall. */
  const breaches = [];
  function openBreach(wx, wy, radius = 0.10) {
    mound.disc(wx, wy, radius, OPEN);
    breaches.push({ x: wx, y: wy, r: radius, sealed: 0, opened: clock.elapsedDays });
    runtime.breaches++;
  }

  function nearestBreach(x, y) {
    let best = -1;
    let bestD = 1.2;
    for (let b = 0; b < breaches.length; b++) {
      if (breaches[b].sealed >= 1) continue;
      const d = distance(x, y, breaches[b].x, breaches[b].y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /* --------------------------------------------------------- construction */

  /**
   * How strongly this spot invites a pellet.
   *
   * Three cues, weighted independently so they can be switched off one at a time. That is the whole
   * point of the scenario: the classical account, the geometric one and the hydric one all produce
   * mounds, and they do not produce the same mound.
   */
  function depositionScore(wx, wy) {
    const cx = mound.colAt(wx);
    const cy = mound.rowAt(wy);
    if (!mound.inGrid(cx, cy)) return 0;

    let score = 0;

    // 1. The classical cement-pheromone feedback: build where building has just happened.
    //
    // Pure feedback cannot start from nothing — with no deposits anywhere, the cue is zero and so
    // is the urge to deposit, and a bare floor stays bare for ever. Grassé's account has always
    // included an initial phase of scattered, undirected dropping which the feedback then amplifies
    // into pillars, so that baseline belongs inside this hypothesis rather than bolted on outside
    // it. Keeping it here means switching every cue off still leaves nothing being built.
    if (params.cementPheromoneWeight > 0) {
      const c = cue.sample(wx, wy);
      score += params.cementPheromoneWeight * (0.07 + 0.93 * (c / (c + 1.5)));
    }

    // 2. Curvature. Counting solid neighbours approximates it: a protruding tip has few, a flat
    //    wall has about half, a pit has many. Termites favour the tips.
    if (params.curvatureWeight > 0) {
      const solid = mound.solidNeighbours(cx, cy);
      // Peaks at 2-3 solid neighbours, which is what a convex tip looks like on this grid.
      const convexity = Math.max(0, 1 - Math.abs(solid - 2.5) / 3);
      score += params.curvatureWeight * convexity;
    }

    // 3. Evaporation: the difference between the damp soil and the dry air above it. Strongest on
    //    exposed surfaces, which is where the recent work says building actually happens.
    if (params.evaporationWeight > 0) {
      const local = humidity.sample(wx, wy);
      const above = humidity.sample(wx, wy - cellSize * 2);
      score += params.evaporationWeight * Math.max(0, local - above) * 3;
    }

    return score;
  }

  /** Is this open cell touching the structure, so a pellet placed here would stick? */
  function touchesStructure(wx, wy) {
    const cx = mound.colAt(wx);
    const cy = mound.rowAt(wy);
    if (!mound.inGrid(cx, cy)) return false;
    if (mound.cells[cy * mound.cols + cx] === SOLID) return false;
    return mound.solidNeighbours(cx, cy) > 0;
  }

  /** Termites keep their own galleries clear; nobody bricks up the way out. */
  function inChimney(wx, wy) {
    if (wy > GROUND_Y + 0.14) return false;
    for (const sx of SHAFTS) if (Math.abs(wx - sx) < 0.022) return true;
    return false;
  }

  function placePellet(i) {
    const wx = termites.x[i];
    const wy = termites.y[i];
    if (!touchesStructure(wx, wy) || inChimney(wx, wy)) return false;

    mound.setAtWorld(wx, wy, SOLID);
    // A fresh pellet is wet and marked, whatever the marker turns out to be.
    cue.deposit(wx, wy, 6);
    humidity.deposit(wx, wy, 0.8);
    termites.carrying[i] = 0;
    termites.task[i] = TASK.IDLE;
    termites.taskTime[i] = 0;
    runtime.pelletsPlaced++;

    // Nudge the termite out of the cell it has just filled.
    termites.y[i] -= cellSize;
    return true;
  }

  /* -------------------------------------------------------------- movement */

  /**
   * If a termite has ended up inside solid soil — almost always because somebody deposited a pellet
   * on the cell it was standing in — put it back into the nearest open space. A real termite would
   * simply push through; leaving them entombed slowly turns a growing mound into a graveyard of
   * stuck workers.
   */
  function extractIfBuried(i) {
    if (!mound.isSolid(termites.x[i], termites.y[i])) return;
    const step = cellSize * 1.05;
    for (let ring = 1; ring <= 4; ring++) {
      for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const nx = termites.x[i] + ox * step * ring;
        const ny = termites.y[i] + oy * step * ring;
        if (!mound.isSolid(nx, ny)) {
          termites.x[i] = nx;
          termites.y[i] = ny;
          termites.px[i] = nx;
          termites.py[i] = ny;
          return;
        }
      }
    }
  }

  /** Walk inside the mound, refusing to enter solid soil. */
  function crawlInMound(i, dt, tx, ty, wander = 1.0) {
    extractIfBuried(i);
    termites.heading[i] = turnToward(termites.heading[i], bearing(termites.x[i], termites.y[i], tx, ty), 5 * dt);
    termites.heading[i] += wanderTurn(rng, wander, dt);

    const step = termites.speed[i] * dt;
    const nx = termites.x[i] + Math.cos(termites.heading[i]) * step;
    const ny = termites.y[i] + Math.sin(termites.heading[i]) * step;

    let moved = false;
    if (!mound.isSolid(nx, termites.y[i])) { termites.x[i] = nx; moved = true; }
    if (!mound.isSolid(termites.x[i], ny)) { termites.y[i] = ny; moved = true; }
    if (!moved) termites.heading[i] = wrapAngle(termites.heading[i] + rng.range(-2, 2));

    termites.x[i] = Math.min(nb.w - 0.004, Math.max(0.004, termites.x[i]));
    termites.y[i] = Math.min(nb.h - 0.004, Math.max(0.004, termites.y[i]));
    return distance(termites.x[i], termites.y[i], tx, ty);
  }

  function stepMoundTermite(i, dt) {
    termites.taskTime[i] += dt;

    if (termites.caste[i] === CASTE.QUEEN) return;

    if (termites.caste[i] === CASTE.SOLDIER) {
      const breach = nearestBreach(termites.x[i], termites.y[i]);
      if (breach >= 0) {
        termites.task[i] = TASK.DEFEND;
        crawlInMound(i, dt, breaches[breach].x, breaches[breach].y, 0.4);
      } else {
        termites.task[i] = TASK.PATROL;
        crawlInMound(i, dt, nb.w * 0.5 + rng.range(-0.4, 0.4), GROUND_Y + rng.range(-0.1, 0.4), 1.6);
      }
      return;
    }

    switch (termites.task[i]) {
      case TASK.CARRY: {
        // Carrying a pellet, on the way to the growing surface.
        //
        // A termite deep in the nest cannot see the top of the mound and cannot walk to it in a
        // straight line — the shaft is in the way. Real Macrotermes climb the central chimney, so
        // that is what these do: down here they head for the shaft and go up it, and only once
        // they are out on the surface do they start looking for somewhere to put the pellet.
        const breach = nearestBreach(termites.x[i], termites.y[i]);

        if (breach >= 0) {
          crawlInMound(i, dt, breaches[breach].x, breaches[breach].y, 0.5);
        } else if (termites.y[i] > SURFACE_Y) {
          // Still underground: make for the nearest gallery and climb it.
          const shaft = nearestShaft(termites.x[i]);
          const atShaft = Math.abs(termites.x[i] - shaft) < 0.02;
          crawlInMound(i, dt, shaft, atShaft ? SURFACE_Y - 0.03 : GROUND_Y + 0.10, 0.4);
        } else {
          // Out on the mound. Wander the surface and let the cues decide.
          crawlInMound(i, dt, termites.x[i] + rng.range(-0.25, 0.25), SURFACE_Y - rng.range(0, 0.06), 2.0);
        }

        // Decide, at this spot, whether to deposit. This is the whole mechanism, and it is the only
        // route by which a pellet ever becomes part of the mound.
        //
        // She only builds once she is out on the surface, or at a hole that needs plugging. Letting
        // her deposit on the way up means the colony spends its labour backfilling its own galleries
        // and the mound never rises at all — hundreds of pellets placed and nothing to show for it.
        const onBuildingGround = breach >= 0 || termites.y[i] <= GROUND_Y + 0.02;
        const score = onBuildingGround ? depositionScore(termites.x[i], termites.y[i]) : 0;
        const urgency = breach >= 0 ? 3 : 1;
        if (score > 0 && touchesStructure(termites.x[i], termites.y[i])
            && rng.eventAtRate(score * urgency * 1.4, dt)) {
          if (placePellet(i) && breach >= 0) sealBreachProgress(breach);
        } else if (termites.taskTime[i] > 120) {
          // She has carried it around long enough and found nowhere the cues approve of, so she
          // simply puts it back. Building anyway would mean the mound rises even with every cue
          // switched off, which would make the whole demonstration meaningless.
          termites.carrying[i] = 0;
          termites.task[i] = TASK.IDLE;
          termites.taskTime[i] = 0;
        }
        break;
      }

      case TASK.QUARRY: {
        // Dig a pellet out of the floor of the nest, well below the living space.
        // Mine the walls and floor of the nest void. Insisting on one particular depth meant that
        // once the soil immediately there had been dug out, the face receded beyond reach and the
        // whole colony quietly stopped building.
        // Head straight down onto the digging face. Wandering about the void hoping to brush
        // against soil leaves most of the workforce milling in mid-air with nothing to show for it.
        crawlInMound(i, dt, termites.x[i], nb.h, 0.25);

        let quarried = false;
        if (termites.y[i] > GROUND_Y + 0.18) {
          const r = 0.014;
          for (const [ox, oy] of [[0, r], [r, 0], [-r, 0], [0, -r]]) {
            const ax = termites.x[i] + ox;
            const ay = termites.y[i] + oy;
            if (ay > GROUND_Y + 0.16 && mound.isSolid(ax, ay)) {
              mound.setAtWorld(ax, ay, OPEN);
              termites.carrying[i] = 1;
              termites.task[i] = TASK.CARRY;
              termites.taskTime[i] = 0;
              runtime.pelletsQuarried++;
              quarried = true;
              break;
            }
          }
        }
        if (!quarried && termites.taskTime[i] > 60) {
          termites.task[i] = TASK.IDLE;
          termites.taskTime[i] = 0;
        }
        break;
      }

      case TASK.TEND_FUNGUS: {
        const chamber = FUNGUS_CHAMBERS[termites.site[i]] || FUNGUS_CHAMBERS[0];
        const d = crawlInMound(i, dt, chamber[0], chamber[1], 0.8);
        if (d < 0.05) {
          // Litter and faecal pellets go onto the comb; the fungus grows on it.
          const used = stores.consume('litter', 0.5 * dt);
          stores.add('fungus', used * 1.2);
          if (termites.taskTime[i] > 20) { termites.task[i] = TASK.IDLE; termites.taskTime[i] = 0; }
        }
        break;
      }

      case TASK.NURSE: {
        crawlInMound(i, dt, royalCell.x + rng.range(-0.18, 0.18), royalCell.y + rng.range(-0.10, 0.10), 1.0);
        if (termites.taskTime[i] > 15) { termites.task[i] = TASK.IDLE; termites.taskTime[i] = 0; }
        break;
      }

      default: {
        crawlInMound(i, dt, termites.x[i] + Math.cos(termites.heading[i]) * 0.2,
          termites.y[i] + Math.sin(termites.heading[i]) * 0.2, 1.6);
        termites.restTime[i] += dt;
        if (termites.taskTime[i] > 2) chooseMoundTask(i);
        break;
      }
    }
  }

  function chooseMoundTask(i) {
    termites.taskTime[i] = 0;

    // A hole in the wall outranks everything else.
    if (nearestBreach(termites.x[i], termites.y[i]) >= 0) {
      termites.task[i] = TASK.QUARRY;
      return;
    }

    const roll = rng();
    if (roll < 0.30) {
      termites.task[i] = TASK.QUARRY;                 // building is the colony's main occupation
    } else if (roll < 0.45 && stores.get('litter') > 5) {
      termites.task[i] = TASK.TEND_FUNGUS;
      termites.site[i] = rng.int(0, FUNGUS_CHAMBERS.length - 1);
    } else if (roll < 0.60) {
      termites.task[i] = TASK.NURSE;
    } else if (roll < 0.72 && clock.isDaylight === false && termites.restTime[i] > 8) {
      // Macrotermes forages mostly under cover of darkness or under soil sheeting.
      leaveMound(i);
    } else {
      termites.task[i] = TASK.IDLE;
    }
  }

  function sealBreachProgress(b) {
    const breach = breaches[b];
    breach.sealed = Math.min(1, breach.sealed + 0.10);
    if (breach.sealed >= 1) runtime.breachSealed++;
  }

  function leaveMound(i) {
    termites.inMound[i] = 0;
    termites.x[i] = entrance.x + rng.range(-0.4, 0.4);
    termites.y[i] = entrance.y + rng.range(-0.4, 0.4);
    termites.px[i] = termites.x[i];
    termites.py[i] = termites.y[i];
    termites.task[i] = TASK.FORAGE;
    termites.taskTime[i] = 0;
    termites.restTime[i] = 0;
    termites.speed[i] = params.workerSpeed * 3;    // covering ground, not crawling a gallery
  }

  function enterMound(i) {
    termites.inMound[i] = 1;
    termites.x[i] = nb.w * 0.5 + rng.range(-0.04, 0.04);
    termites.y[i] = GROUND_Y + 0.08;
    termites.px[i] = termites.x[i];
    termites.py[i] = termites.y[i];
    termites.speed[i] = params.workerSpeed;
    if (termites.carrying[i] === 2) {
      stores.add('litter', 4);
      runtime.litterBrought += 4;
      termites.carrying[i] = 0;
    }
    termites.task[i] = TASK.IDLE;
    termites.taskTime[i] = 0;
  }

  function stepFieldTermite(i, dt) {
    termites.taskTime[i] += dt;

    if (termites.task[i] === TASK.RETURN) {
      termites.heading[i] = turnToward(termites.heading[i], bearing(termites.x[i], termites.y[i], entrance.x, entrance.y), 3 * dt);
      flyOrWalk(i, dt);
      if (distance(termites.x[i], termites.y[i], entrance.x, entrance.y) < 0.6) enterMound(i);
      return;
    }

    // Foraging: head for litter, cut it, carry it home.
    let target = null;
    let best = Infinity;
    for (const site of litterSites) {
      if (site.amount <= 0) continue;
      const d = distance(termites.x[i], termites.y[i], site.x, site.y);
      if (d < best) { best = d; target = site; }
    }

    if (target) {
      termites.heading[i] = turnToward(termites.heading[i], bearing(termites.x[i], termites.y[i], target.x, target.y), 3 * dt);
      if (best < target.r) {
        target.amount -= 3 * dt;
        termites.carrying[i] = 2;
        if (termites.taskTime[i] > 6) { termites.task[i] = TASK.RETURN; termites.taskTime[i] = 0; }
      }
    } else {
      termites.heading[i] += wanderTurn(rng, 1.2, dt);
    }
    flyOrWalk(i, dt);

    if (termites.taskTime[i] > 200) { termites.task[i] = TASK.RETURN; termites.taskTime[i] = 0; }
  }

  function flyOrWalk(i, dt) {
    const step = termites.speed[i] * dt;
    termites.x[i] = Math.min(fb.w - 0.2, Math.max(0.2, termites.x[i] + Math.cos(termites.heading[i]) * step));
    termites.y[i] = Math.min(fb.h - 0.2, Math.max(0.2, termites.y[i] + Math.sin(termites.heading[i]) * step));
  }

  /* ------------------------------------------------------- the mound as a lung */

  /**
   * Ventilation, as a lumped balance.
   *
   * The colony and its fungus produce heat and CO2; both leave through the mound wall, and how fast
   * depends on how much wall there is and how porous it is. Breaches vent enormously — which is why
   * a hole matters to the colony for reasons beyond the aardvark that made it.
   */
  function stepAtmosphere(dt) {
    const air = clock.airTemperature();

    // Metabolic load: termites plus the fungus they farm, which respires hard.
    const load = termites.count * 0.00016 + stores.get('fungus') * 0.00002;

    // Exchange scales with exposed surface. Count open cells above ground that touch soil — the
    // porous wall — plus anything currently torn open.
    let openBreachArea = 0;
    for (const b of breaches) if (b.sealed < 1) openBreachArea += (1 - b.sealed) * b.r * 40;

    const wallExchange = 0.10 + openBreachArea;

    // Buoyancy: the hotter the nest is relative to outside, the harder the chimney draws.
    const buoyancy = Math.max(0, nestTemp - air) * 0.02;

    nestCO2 += (load * 6 - nestCO2 * (wallExchange + buoyancy)) * dt;
    nestCO2 = Math.max(0.04, Math.min(12, nestCO2));

    // Temperature: metabolism heats, the wall and the draught cool towards the outside air. The two
    // have to be balanced against each other or the nest simply runs away to the clamp — the point
    // of a mound is that a big colony sits a few degrees above the plain, not fifty.
    nestTemp += ((air - nestTemp) * (0.05 + openBreachArea * 0.05) + load * 0.6) * dt;
    nestTemp = Math.max(-5, Math.min(50, nestTemp));

    runtime.co2Peak = Math.max(runtime.co2Peak, nestCO2);

    humidity.update(dt);
    cue.update(dt);

    // Drying the exposed soil and repainting the air fields both sweep whole grids, which is far
    // too much work to do sixty times a second for something nobody can see change that fast. They
    // run on the same 10 Hz sub-clock the fields themselves use, driven by the simulation's own dt
    // so it stays deterministic.
    fieldAccumulator += dt;
    if (fieldAccumulator >= 0.1) {
      const slice = Math.min(fieldAccumulator, 0.5);
      const dryRate = Math.min(0.5, (0.05 + clock.solarElevation * 0.25) * slice);
      for (let row = 0; row < humidity.rows; row++) {
        const y = humidity.bounds.y + (row + 0.5) * humidity.cellSize;
        if (y > GROUND_Y) continue;
        const base = row * humidity.cols;
        for (let col = 0; col < humidity.cols; col++) humidity.data[base + col] *= 1 - dryRate;
      }
      paintAtmosphere(air);
      fieldAccumulator = 0;
    }
  }

  function paintAtmosphere(air) {
    for (let row = 0; row < co2Field.rows; row++) {
      const y = co2Field.bounds.y + (row + 0.5) * co2Field.cellSize;
      const inside = y > GROUND_Y - 0.15;
      for (let col = 0; col < co2Field.cols; col++) {
        const i = row * co2Field.cols + col;
        co2Field.data[i] = inside ? nestCO2 : 0.04;
        tempField.data[i] = inside ? nestTemp : air;
      }
    }
    co2Field.maxValue = nestCO2;
    tempField.maxValue = Math.max(air, nestTemp);
  }

  /* ------------------------------------------------------------- demography */

  function stepColony(days) {
    // The fungus feeds the colony; without litter it dwindles.
    stores.consume('fungus', termites.count * 0.004 * days);

    const stageDays = [30, 45, 25];
    for (let b = 0; b < brood.highWater; b++) {
      if (!brood.alive[b]) continue;
      const fed = Math.min(1, stores.get('fungus') / 120);
      brood.nutrition[b] = fed;
      if (advanceBrood(brood, b, days * fed, stageDays) === 'emerged') {
        brood.kill(b);
        spawnTermite(rng.chance(params.soldierFraction) ? CASTE.SOLDIER : CASTE.WORKER);
      }
    }

    // The queen is a physogastric egg factory; her output dwarfs any other social insect's.
    if (termites.alive[queenIndex]) {
      const comfort = Math.min(1, stores.get('fungus') / 200) * (nestCO2 < 6 ? 1 : 0.3);
      let expected = 140 * comfort * days;
      while (expected > 0) {
        if (expected < 1 && !rng.chance(expected)) break;
        expected -= 1;
        const b = brood.spawn();
        if (b < 0) break;
        brood.stage[b] = STAGE.EGG;
        brood.nutrition[b] = 1;
        const a = rng.angle();
        const r = Math.sqrt(rng()) * 0.2;
        brood.x[b] = royalCell.x + Math.cos(a) * r;
        brood.y[b] = royalCell.y + Math.sin(a) * r * 0.6;
      }
    }

    for (let i = 0; i < termites.highWater; i++) {
      if (!termites.alive[i] || termites.caste[i] === CASTE.QUEEN) continue;
      termites.age[i] += days;
      // Termite workers are long-lived by insect standards, but CO2 and starvation both bite.
      const stress = (nestCO2 > 7 ? 0.05 : 0) + (stores.get('fungus') < 20 ? 0.06 : 0);
      const outside = termites.inMound[i] ? 0 : 0.03;
      if (rng.chance((0.004 + stress + outside) * days)) termites.kill(i);
    }
  }

  function moundHeight() {
    // Height of the highest solid cell above the ground line, in centimetres.
    for (let row = 0; row < mound.rows; row++) {
      const y = mound.bounds.y + (row + 0.5) * mound.cellSize;
      if (y >= GROUND_Y) break;
      for (let col = 0; col < mound.cols; col++) {
        if (mound.cells[row * mound.cols + col] === SOLID) return (GROUND_Y - y) * 100;
      }
    }
    return 0;
  }

  function checkGoal() {
    if (goal.outcome) return;
    const height = moundHeight();
    runtime.peakHeight = Math.max(runtime.peakHeight, height);
    goal.value = height;

    if (!termites.alive[queenIndex]) goal.fail('The queen is dead; the colony cannot replace her.');
    else if (termites.count < 20) goal.fail('The colony died out.');
    else if (nestCO2 > 10) goal.fail('The nest suffocated — CO2 ran away with the ventilation.');
    else if (height >= goal.target) goal.succeed(`The mound stands ${height.toFixed(0)} cm above the plain.`);
  }

  /* --------------------------------------------------------------- stepping */

  let slowAccumulator = 0;

  function step(dt) {
    clock.step(dt);
    stepAtmosphere(dt);

    for (let i = 0; i < termites.highWater; i++) {
      if (!termites.alive[i]) continue;
      storePrevious(termites, i);
      if (termites.inMound[i]) stepMoundTermite(i, dt);
      else stepFieldTermite(i, dt);
    }

    slowAccumulator += dt;
    if (slowAccumulator >= 0.25) {
      stepColony(slowAccumulator / clock.simSecondsPerDay);
      checkGoal();
      slowAccumulator = 0;
    }
  }

  /* --------------------------------------------------------------- rendering */

  const dprScale = () => Math.min(window.devicePixelRatio || 1, 2);
  let atlases = null;
  let overlays = null;
  let moundCanvas = null;
  let moundVersion = -1;

  function ensureRenderAssets() {
    if (atlases) return;
    const dpr = dprScale();
    const PALE = '#d8c9ac';
    const DARK = '#8a7a5c';

    atlases = {
      worker: new SpriteAtlas(13 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: PALE, legColour: DARK, width: 0.30, headLen: 0.18, abdomenLen: 0.40,
      })),
      carrier: new SpriteAtlas(13 * dpr, 24, (c, s) => {
        paintInsect(c, s, { body: PALE, legColour: DARK, width: 0.30, abdomenLen: 0.40 });
        paintCarrying(c, s, '#7a5f3c', 0.13);
      }),
      litter: new SpriteAtlas(13 * dpr, 24, (c, s) => {
        paintInsect(c, s, { body: PALE, legColour: DARK, width: 0.30, abdomenLen: 0.40 });
        paintCarrying(c, s, '#9aa04c', 0.13);
      }),
      soldier: new SpriteAtlas(15 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: '#c8ab74', accent: '#6b4a22', legColour: DARK, width: 0.32, headLen: 0.30,
      })),
      queen: new SpriteAtlas(40 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: '#efe4cd', legColour: DARK, width: 0.44, abdomenLen: 0.72, headLen: 0.12, legs: false,
      })),
    };

    overlays = {
      cue: new FieldOverlay(cue, RAMPS.pheromone, { gamma: 0.5, opacity: 0.8 }),
      humidity: new FieldOverlay(humidity, RAMPS.moisture, { min: 0, max: 1.4, gamma: 0.8, opacity: 0.6 }),
      co2: new FieldOverlay(co2Field, RAMPS.co2, { min: 0, max: 8, gamma: 1, opacity: 0.55 }),
      temperature: new FieldOverlay(tempField, RAMPS.temperature, { min: 10, max: 45, gamma: 1, opacity: 0.55 }),
    };
  }

  /** Repaint the soil bitmap only when the termites have actually changed it. */
  function bakeMound() {
    if (moundCanvas && moundVersion === mound.version) return moundCanvas;
    if (!moundCanvas) {
      moundCanvas = document.createElement('canvas');
      moundCanvas.width = mound.cols;
      moundCanvas.height = mound.rows;
    }
    const c = moundCanvas.getContext('2d');
    const img = c.createImageData(mound.cols, mound.rows);
    for (let i = 0, p = 0; i < mound.cells.length; i++, p += 4) {
      if (mound.cells[i] === SOLID) {
        const row = (i / mound.cols) | 0;
        const y = mound.bounds.y + row * mound.cellSize;
        const n = ((i * 2654435761) >>> 16) % 26;
        // Above ground the mound is sun-baked and pale; below it the soil is darker and damper.
        const aboveGround = y < GROUND_Y;
        img.data[p] = (aboveGround ? 132 : 74) + n;
        img.data[p + 1] = (aboveGround ? 104 : 56) + n * 0.8;
        img.data[p + 2] = (aboveGround ? 72 : 38) + n * 0.5;
        img.data[p + 3] = 255;
      } else {
        img.data[p + 3] = 0;
      }
    }
    c.putImageData(img, 0, 0);
    moundVersion = mound.version;
    return moundCanvas;
  }

  function renderField(ctx, vp, alpha) {
    ensureRenderAssets();
    const light = 0.35 + 0.65 * clock.solarElevation;
    ctx.fillStyle = `rgb(${Math.round(96 * light + 18)}, ${Math.round(84 * light + 16)}, ${Math.round(48 * light + 12)})`;
    ctx.fillRect(0, 0, fb.w, fb.h);

    for (const site of litterSites) {
      if (site.amount <= 0) continue;
      ctx.fillStyle = 'rgba(150, 160, 76, 0.35)';
      ctx.beginPath();
      ctx.arc(site.x, site.y, site.r, 0, TAU);
      ctx.fill();
    }

    // The mound seen from above.
    ctx.fillStyle = '#7a5f3c';
    ctx.beginPath();
    ctx.arc(entrance.x, entrance.y, 1.9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#4a3823';
    ctx.beginPath();
    ctx.arc(entrance.x, entrance.y, 0.8, 0, TAU);
    ctx.fill();

    const dpr = dprScale();
    drawPopulation(ctx, vp, dpr, termites, alpha, {
      atlasFor: (i) => {
        if (termites.inMound[i]) return null;
        if (termites.caste[i] === CASTE.SOLDIER) return atlases.soldier;
        return termites.carrying[i] === 2 ? atlases.litter : atlases.worker;
      },
      scale: 1,
      cull: 1,
    });

    drawWorldLabel(ctx, vp, dpr, entrance.x, entrance.y - 2.6, 'mound', { size: 10 });
    if (!clock.isDaylight) {
      ctx.fillStyle = 'rgba(10, 14, 30, 0.35)';
      ctx.fillRect(0, 0, fb.w, fb.h);
    }
  }

  function renderNest(ctx, vp, alpha) {
    ensureRenderAssets();

    // Sky and subsoil.
    const light = 0.3 + 0.7 * clock.solarElevation;
    ctx.fillStyle = `rgb(${Math.round(60 * light + 18)}, ${Math.round(78 * light + 22)}, ${Math.round(110 * light + 26)})`;
    ctx.fillRect(0, 0, nb.w, GROUND_Y);
    ctx.fillStyle = '#20180f';
    ctx.fillRect(0, GROUND_Y, nb.w, nb.h - GROUND_Y);

    const baked = bakeMound();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(baked, nb.x, nb.y, nb.w, nb.h);
    ctx.imageSmoothingEnabled = true;

    if (view.overlay !== 'none' && overlays[view.overlay]) {
      overlays[view.overlay].dirty = true;
      overlays[view.overlay].draw(ctx, vp);
    }

    // Fungus combs.
    for (const [fx, fy] of FUNGUS_CHAMBERS) {
      const fullness = Math.min(1, stores.get('fungus') / 600);
      ctx.fillStyle = `rgba(190, 170, 110, ${0.30 + 0.5 * fullness})`;
      ctx.beginPath();
      ctx.arc(fx, fy, 0.055 * (0.5 + fullness), 0, TAU);
      ctx.fill();
    }

    // Brood around the royal cell.
    for (let b = 0; b < brood.highWater; b++) {
      if (!brood.alive[b]) continue;
      ctx.fillStyle = brood.stage[b] === STAGE.EGG ? '#efe8d4' : '#e2d3ae';
      ctx.beginPath();
      ctx.arc(brood.x[b], brood.y[b], 0.006, 0, TAU);
      ctx.fill();
    }

    // Open breaches, drawn so you can see what the soldiers are running at.
    for (const b of breaches) {
      if (b.sealed >= 1) continue;
      ctx.strokeStyle = `rgba(200, 80, 63, ${0.8 - b.sealed * 0.6})`;
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.4, 0, TAU);
      ctx.stroke();
    }

    const dpr = dprScale();
    drawPopulation(ctx, vp, dpr, termites, alpha, {
      atlasFor: (i) => {
        if (!termites.inMound[i]) return null;
        if (termites.caste[i] === CASTE.QUEEN) return atlases.queen;
        if (termites.caste[i] === CASTE.SOLDIER) return atlases.soldier;
        return termites.carrying[i] === 1 ? atlases.carrier : atlases.worker;
      },
      scale: 0.5,
    });

    if (view.showCues) {
      const active = [];
      if (params.cementPheromoneWeight > 0) active.push('deposits');
      if (params.curvatureWeight > 0) active.push('curvature');
      if (params.evaporationWeight > 0) active.push('evaporation');
      const text = active.length ? `building on: ${active.join(' + ')}` : 'no building cue — nothing will be built';

      ctx.save();
      ctx.resetTransform();
      ctx.font = `${10 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      const w = ctx.measureText(text).width + 12 * dpr;
      const lx = (vp.rect.x + vp.rect.w / 2) * dpr;
      const ly = (vp.rect.y + 48) * dpr;
      ctx.fillStyle = '#0b0906cc';
      ctx.fillRect(lx - w / 2, ly - 9 * dpr, w, 18 * dpr);
      ctx.fillStyle = active.length ? '#d8c9ac' : '#c8503f';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, lx, ly);
      ctx.restore();
    }

    if (view.overlay !== 'none' && overlays[view.overlay]) {
      const legends = {
        cue: ['deposition cue', RAMPS.pheromone, '0', 'high'],
        humidity: ['moisture', RAMPS.moisture, 'dry', 'wet'],
        co2: ['CO₂', RAMPS.co2, '0%', '8%'],
        temperature: ['temperature', RAMPS.temperature, '10°C', '45°C'],
      };
      const [title, ramp, lo, hi] = legends[view.overlay];
      drawLegend(ctx, dpr, vp.rect, { title, ramp, minLabel: lo, maxLabel: hi });
    }
  }

  /* ------------------------------------------------------------------ panel */

  function stats() {
    let carrying = 0;
    let quarrying = 0;
    let defending = 0;
    let outside = 0;
    for (let i = 0; i < termites.highWater; i++) {
      if (!termites.alive[i]) continue;
      if (!termites.inMound[i]) outside++;
      if (termites.task[i] === TASK.CARRY) carrying++;
      if (termites.task[i] === TASK.QUARRY) quarrying++;
      if (termites.task[i] === TASK.DEFEND) defending++;
    }
    const openBreaches = breaches.filter((b) => b.sealed < 1).length;

    const rows = [
      ['Date', `${clock.monthName} ${1 + Math.floor(clock.day % 30.4)}`],
      ['Outside air', `${clock.airTemperature().toFixed(1)} °C`],
      ['Nest air', `${nestTemp.toFixed(1)} °C`],
      ['Nest CO₂', `${nestCO2.toFixed(2)} %`],
      ['Termites', termites.count],
      ['Soldiers', termites.countWhere((i) => termites.caste[i] === CASTE.SOLDIER)],
      ['Foraging outside', outside],
      ['Quarrying', quarrying],
      ['Carrying pellets', carrying],
      ['Pellets placed', runtime.pelletsPlaced],
      ['Mound height', `${moundHeight().toFixed(0)} cm`],
      ['Fungus comb', `${stores.get('fungus').toFixed(0)} g`],
      ['Brood', brood.count],
      ['Breaches open', openBreaches],
      ['Rushing a breach', defending],
    ];
    if (goal.outcome) rows.push([goal.outcome === 'success' ? 'Outcome' : 'Colony lost', goal.reason]);
    return rows;
  }

  function describe(wx, wy, which) {
    const inMound = which === 'nest' ? 1 : 0;
    const radius = inMound ? 0.05 : 1.2;
    const i = termites.nearestTo(wx, wy, radius, (k) => termites.inMound[k] === inMound);

    if (i < 0) {
      if (inMound) {
        return {
          title: mound.isSolid(wx, wy) ? 'Mound wall' : 'Nest air',
          rows: [
            ['Height', `${((GROUND_Y - wy) * 100).toFixed(0)} cm above ground`],
            ['Deposition cue', cue.sample(wx, wy).toFixed(2)],
            ['Moisture', humidity.sample(wx, wy).toFixed(2)],
            ['Would build here', depositionScore(wx, wy).toFixed(2)],
            ['CO₂', `${(wy > GROUND_Y - 0.15 ? nestCO2 : 0.04).toFixed(2)} %`],
          ],
        };
      }
      return { title: 'Savanna', rows: [['From mound', `${distance(wx, wy, entrance.x, entrance.y).toFixed(1)} m`]] };
    }

    const caste = termites.caste[i];
    if (caste === CASTE.QUEEN) {
      return {
        title: 'Queen',
        rows: [
          ['Caste', 'physogastric queen'],
          ['Doing', 'laying, continuously'],
          ['Brood in nest', brood.count],
        ],
      };
    }

    return {
      title: caste === CASTE.SOLDIER ? `Soldier #${termites.id[i]}` : `Worker #${termites.id[i]}`,
      rows: [
        ['Caste', caste === CASTE.SOLDIER ? 'soldier' : 'worker'],
        ['Sight', 'blind'],
        ['Doing', TASK_NAMES[termites.task[i]]],
        ['Carrying', ['nothing', 'a soil pellet', 'plant litter'][termites.carrying[i]]],
        ['Age', `${termites.age[i].toFixed(0)} days`],
      ],
    };
  }

  /* ------------------------------------------------------------ interaction */

  function applyTool(wx, wy, which) {
    if (which === 'nest' && view.tool === 'breach') openBreach(wx, wy, 0.09);
    else if (which === 'nest' && view.tool === 'wet') humidity.deposit(wx, wy, 3);
    else if (which === 'field' && view.tool === 'litter') addLitter(wx, wy);
  }

  function controls() {
    const cueToggle = (label, key, title) => toggle(label, {
      value: params[key] > 0,
      title,
      onChange: (v) => { params[key] = v ? 1 : 0; },
    });

    return [
      el('p.note', {
        style: { marginTop: '0' },
        text: 'Three competing explanations for how termites decide where to build. Switch them on '
            + 'and off and compare the mounds — this is a live scientific argument, not a settled one.',
      }),
      el('div.chips', null,
        cueToggle('Cement pheromone', 'cementPheromoneWeight', 'The classical hypothesis — never chemically identified'),
        cueToggle('Curvature', 'curvatureWeight', 'Calovi et al. 2019'),
        cueToggle('Evaporation', 'evaporationWeight', 'Facchini et al. 2023'),
      ),

      el('div', { style: { fontSize: '12px', color: 'var(--ink-dim)', margin: '11px 0 6px' }, text: 'Overlay' }),
      chipGroup(
        [{ id: 'none', label: 'Natural' }, { id: 'cue', label: 'Cue' }, { id: 'humidity', label: 'Moisture' },
          { id: 'co2', label: 'CO₂' }, { id: 'temperature', label: 'Temp' }],
        { value: view.overlay, onChange: (v) => { view.overlay = v; } },
      ),

      el('div', { style: { fontSize: '12px', color: 'var(--ink-dim)', margin: '11px 0 6px' }, text: 'Long-press to' }),
      chipGroup(
        [{ id: 'breach', label: 'Break the wall' }, { id: 'wet', label: 'Wet the soil' }, { id: 'litter', label: 'Drop litter' }],
        { value: view.tool, onChange: (v) => { view.tool = v; } },
      ),

      el('div.row', { style: { marginTop: '11px' } },
        el('button.grow', {
          type: 'button', text: 'Aardvark',
          title: 'Tear a large hole in the mound and watch the soldiers and builders respond',
          onclick: () => openBreach(nb.w * (0.3 + rng() * 0.4), GROUND_Y - 0.08 - rng() * 0.12, 0.14),
        }),
        el('button.grow', {
          type: 'button', text: 'Level it',
          title: 'Remove everything above ground and let the colony rebuild from scratch',
          onclick: () => {
            mound.rect(0, 0, nb.w, GROUND_Y, OPEN);
            cue.clear();
            runtime.pelletsPlaced = 0;
          },
        }),
      ),

      slider('Deposit cue half-life (min)', {
        min: 1, max: 90, step: 1, value: params.cueHalfLife,
        format: (v) => `${v}`,
        onInput: (v) => { params.cueHalfLife = v; cue.halfLifeMinutes = v; },
      }),
      slider('Day length (s)', {
        min: 30, max: 600, step: 10, value: params.simSecondsPerDay,
        format: (v) => `${v}`,
        onInput: (v) => { params.simSecondsPerDay = v; clock.simSecondsPerDay = v; },
      }),
      toggle('Name the active cues', {
        value: view.showCues,
        onChange: (v) => { view.showCues = v; },
      }),
    ];
  }

  return {
    meta, PARAMS, NOTES,
    step, renderField, renderNest, stats, describe, controls, applyTool,
    toolIsDragging: () => view.tool === 'wet',
    _internals: {
      termites, brood, mound, cue, humidity, clock, stores, goal, runtime, params,
      TASK, CASTE, GROUND_Y, royalCell, breaches, openBreach, moundHeight, depositionScore,
      nestState: () => ({ co2: nestCO2, temp: nestTemp }),
      litterSites,
    },
  };
}
