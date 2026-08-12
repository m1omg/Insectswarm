// Anthill — the black garden ant, Lasius niger.
//
// The mechanism on display is mass recruitment. A Lasius forager that finds food lays a trail of
// pheromone on the way home; other ants leaving the nest follow it; the ones that succeed reinforce
// it, and the ones that find nothing do not. Because the pheromone evaporates, a trail only
// persists while it keeps paying, and a shorter route gets reinforced more often per unit time than
// a longer one. Nobody compares the routes. The comparison is done by evaporation.
//
// The nest cutaway shows the other half of the animal: brood carried up and down the soil profile
// to track the temperature that develops them fastest, corpses carried out to a midden, and tunnels
// that the ants dig themselves.

import { createPool, MOTION_SCHEMA } from '../../engine/agents.js';
import { Field } from '../../engine/field.js';
import { GridMask, SOLID, OPEN, moveThroughMask } from '../../engine/gridmask.js';
import { SpatialHash } from '../../engine/spatial.js';
import { SpriteAtlas, drawPopulation, paintInsect, paintCarrying, makeGroundPattern, drawWorldLabel } from '../../engine/render.js';
import { FieldOverlay, RAMPS, drawLegend } from '../../engine/overlays.js';
import { el, slider, toggle, chipGroup } from '../../engine/ui.js';
import {
  SeasonClock, Stores, SurvivalGoal, createBroodPool, advanceBrood, developmentRate, STAGE,
} from '../colony.js';
import {
  wrapAngle, turnToward, wanderTurn, bilateralTurn, accumulateHomeVector, homeBearing,
  clearHomeVector, storePrevious, distance, bearing, TAU,
} from '../behaviour.js';

export const meta = {
  id: 'ants',
  name: 'Anthill',
  glyph: '🐜',
  species: 'Lasius niger',
  blurb: 'Mass recruitment. Foragers lay an evaporating trail; the route that pays keeps getting '
       + 'reinforced, and the colony converges on it without any ant ever comparing two routes.',
  fieldBounds: { x: 0, y: 0, w: 2.4, h: 1.6 },     // metres of ground around the nest
  nestBounds: { x: 0, y: 0, w: 0.60, h: 0.42 },    // metres of soil profile, y increasing downward
  fieldLabel: 'Foraging ground',
  nestLabel: 'Nest cutaway',
};

/**
 * Every biological constant, with the measurement it came from. Anything marked `tuned` is a
 * simulation choice rather than a number anyone measured, and is labelled as such on purpose.
 */
export const PARAMS = {
  trailHalfLife: {
    value: 45, unit: 'min', label: 'Trail half-life', min: 2, max: 120,
    source: 'Beckers, Deneubourg & Goss (1992) estimate a trail lifetime of ~47 min in Lasius niger. '
          + 'Compare Pharaoh ant at 25 min on plastic and 8 min on paper (Jeanson et al. 2003).',
  },
  deneubourgN: {
    value: 2, unit: '', label: 'Choice sharpness n', min: 1, max: 6,
    source: 'Deneubourg, Aron, Goss & Pasteels (1990), J. Insect Behavior 3:159-168.',
  },
  deneubourgK: {
    value: 0.4, unit: 'trail units', label: 'Choice threshold k', min: 0.05, max: 3,
    source: 'Deneubourg et al. (1990) fit k = 20, but in the concentration units of their assay. '
          + 'k is a unit conversion, not a dimensionless constant, so it is recalibrated here to '
          + 'this simulation\'s pheromone units — set so the "effectively random" threshold falls at '
          + 'the same place relative to a working trail (which runs 2-5 units here). The functional '
          + 'form and the exponent n are the science; k is bookkeeping.',
  },
  depositNearFood: {
    value: 20, unit: 'x', label: 'Deposit bias near food',
    source: 'Popp & Czaczkes (2024), Insectes Sociaux: L. niger deposits up to ~22x more pheromone '
          + 'within 10 cm of the food than on the final approach to the nest.',
  },
  walkSpeed: {
    value: 0.030, unit: 'm/s',
    source: 'tuned — within the few-cm/s range typical of Lasius foragers on level ground.',
  },
  colonySize: {
    value: 5500, unit: 'workers',
    source: 'Mean mature colony size for L. niger; field colonies range to 15,000-40,000 workers.',
  },
  eggDays: {
    value: 15, unit: 'd', source: 'L. niger eggs hatch in 10-20 days depending on temperature.',
  },
  larvaDays: {
    value: 19, unit: 'd', source: 'Larval period 14-24 days; egg to adult totals 6-10 weeks.',
  },
  pupaDays: {
    value: 17, unit: 'd', source: 'Pupal period 14-21 days; faster at the upper end of the range.',
  },
  broodOptimumC: {
    value: 25, unit: '°C', label: 'Brood optimum', min: 18, max: 32,
    source: 'Development is fastest around 24-25 °C, which is why colonies move brood up under warm '
          + 'stones in summer and down again at night.',
  },
  broodBaseC: {
    value: 12, unit: '°C',
    source: 'tuned — developmental zero; below this brood makes no measurable progress.',
  },
  foragerAgeDays: {
    value: 20, unit: 'd',
    source: 'tuned — Lasius shows the usual age polyethism, with older workers moving to outside work.',
  },
  antennaSpread: {
    value: 0.0015, unit: 'm',
    source: 'tuned — roughly the antennal separation of a 4 mm worker; sets trail-following precision.',
  },
  uTurnRate: {
    value: 0.35, unit: '/s', label: 'U-turn rate off-trail',
    source: 'Ants U-turn markedly less on a rewarding trail than off it (Beckers et al. 1992).',
  },
  simSecondsPerDay: {
    value: 120, unit: 's/day', label: 'Day length', min: 30, max: 600,
    source: 'tuned — display compression, see the note on the two clocks.',
  },
};

export const NOTES = [
  {
    text: 'Nothing in this simulation tells an ant which route is shorter. Each returning forager '
        + 'lays pheromone, each departing forager is biased towards stronger pheromone, and the '
        + 'pheromone evaporates. A shorter route is walked more times per hour, so it is topped up '
        + 'more often than it evaporates. The colony chooses; no ant does.',
    source: 'Goss, Aron, Deneubourg & Pasteels (1989), Self-organized shortcuts in the Argentine ant.',
  },
  {
    text: 'At a fork, the chance of taking a branch follows P = (k+C)^n / sum, with n = 2. That '
        + 'exponent is what makes the colony commit: a branch with modestly more pheromone takes '
        + 'much more than a modestly larger share of the traffic. Turn n down towards 1 and the '
        + 'colony dithers between routes forever. Here the rule is applied to the ring of '
        + 'directions an ant faces at the nest mouth, which is the same decision with more branches.',
    source: 'Deneubourg, Aron, Goss & Pasteels (1990), J. Insect Behavior 3:159-168.',
  },
  {
    text: 'One honest caveat about that formula: the published k = 20 is in the concentration units '
        + 'of the original assay, which are not the units of this pheromone grid. k is a unit '
        + 'conversion rather than a constant of nature, so it has been recalibrated here to put the '
        + '"too faint to tell apart" threshold in the same place relative to a working trail. The '
        + 'shape of the response and the exponent are the science; k is bookkeeping.',
    source: 'Simulation calibration note.',
  },
  {
    text: 'Ants do not read the gradient at a point — they sweep two antennae and turn towards '
        + 'whichever finds more. That is why trail following is visibly wobbly at low '
        + 'concentrations and crisp at high ones.',
    source: 'Modelled after bilateral trail-following in Lasius; Hangartner (1967) onwards.',
  },
  {
    text: 'Deposition is not uniform along the route. A laden ant lays far more pheromone close to '
        + 'the food than on the final approach to the nest — up to about twenty times more.',
    source: 'Popp & Czaczkes (2024), Insectes Sociaux 71.',
  },
  {
    text: 'In the cutaway, nurses carry brood up and down the soil profile chasing about 25 °C, '
        + 'where development runs fastest. Watch the brood pile rise towards the surface through '
        + 'the afternoon and sink again overnight. Real colonies do exactly this, which is why you '
        + 'find brood under a warm paving slab.',
    source: 'Standard Lasius natural history; development rate peaks near 24-25 °C.',
  },
  {
    text: 'Two clocks run at once. Ants walk in real time, but the calendar is compressed to a '
        + 'couple of minutes per day so a season is watchable. A foraging trip therefore eats a '
        + 'much larger share of the day here than it does in life. That is a display convenience '
        + 'and not biology — the day-length slider controls it.',
    source: 'Simulation design choice.',
  },
];

/* --------------------------------------------------------------------- tasks */

const TASK = {
  SEARCH: 0,      // outside, no information, correlated random walk
  TRAIL: 1,       // outside, following pheromone
  FEEDING: 2,     // at a food source, loading up
  RETURNING: 3,   // outside, homing by path integration, laying trail
  NEST_IDLE: 4,   // inside, between jobs
  NURSE: 5,       // inside, carrying or tending brood
  EXCAVATE: 6,    // inside, digging
  UNDERTAKER: 7,  // inside, carrying a corpse to the midden
  QUEEN: 8,       // inside, laying
};

const TASK_NAMES = [
  'searching', 'following a trail', 'feeding', 'returning with food',
  'idle in nest', 'tending brood', 'excavating', 'carrying a corpse', 'laying eggs',
];

export function create(world, rng) {
  const params = Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, v.value]));

  const clock = new SeasonClock({
    simSecondsPerDay: params.simSecondsPerDay,
    // Early May, mid-morning: the colony is awake, the soil has warmed enough for brood to
    // develop, and there is most of a season left to play out.
    startDay: 125.42,
    latitude: 51,
  });

  const fb = meta.fieldBounds;
  const nb = meta.nestBounds;

  /* ------------------------------------------------------------- structures */

  // The single recruitment trail. Ants find their own way home by dead reckoning, so there is no
  // second "home" field — that would be a convenience the animal does not have.
  const trail = new Field(fb, world.budget.fieldWidth, {
    halfLifeMinutes: params.trailHalfLife,
    diffusion: 0.06,        // slight lateral spread; a trail is a band, not a line of points
  });

  // Barriers on the foraging ground. Empty by default; the double-bridge preset fills it in.
  const barriers = new GridMask(fb, Math.round(world.budget.fieldWidth * 0.75), OPEN);

  // The soil profile. Everything starts solid and the ants dig it out.
  const soil = new GridMask(nb, 150, SOLID);

  // Soil temperature. Warmed at the surface by the sun, damped and lagged with depth — which is
  // the gradient the nurses are exploiting when they move brood.
  const soilTemp = new Field(nb, 60, {
    halfLifeMinutes: Infinity,
    // Weak diffusion keeps the daily wave near the surface instead of smearing it evenly through
    // the profile, which is what makes depth a meaningful choice.
    diffusion: 0.16,
    ambient: 10,
    relaxPerMinute: 0.02,
  });

  const NEST_SURFACE_Y = 0.035;
  const ENTRANCE_X = nb.w * 0.5;
  const entrance = { x: fb.w * 0.5, y: fb.h * 0.5 };     // where the nest opens onto the field

  // How far a forager will go before turning for home. Set beyond the corners of the ground so the
  // whole foraging area is genuinely reachable.
  const FORAGING_RANGE = Math.hypot(fb.w / 2, fb.h / 2) * 1.02;

  /** How long a returning forager stays in before it will consider another trip. */
  const REST_SECONDS = 12;

  /**
   * Chambers, deepest last. Ants dig these out at the start; excavators enlarge them later.
   *
   * The upper brood chamber sits just a couple of centimetres down, because that is where the
   * daily temperature wave still has amplitude — a colony that wants to use the sun has to put its
   * brood near the surface, which is why you find it directly under a warm paving slab. The lower
   * chamber is deep enough to stay cool and steady, so the nurses have a real choice to make.
   */
  const chambers = [
    { name: 'upper brood', x: 0.17, y: 0.062, r: 0.034 },
    { name: 'lower brood', x: 0.43, y: 0.150, r: 0.050 },
    { name: 'queen chamber', x: 0.30, y: 0.245, r: 0.056 },
    { name: 'granary', x: 0.49, y: 0.310, r: 0.042 },
    { name: 'midden', x: 0.10, y: 0.330, r: 0.036 },
  ];

  function excavateInitialNest() {
    soil.rect(0, 0, nb.w, NEST_SURFACE_Y, OPEN);          // open air above the ground
    soil.line(ENTRANCE_X, NEST_SURFACE_Y, ENTRANCE_X, 0.10, 0.016, OPEN);   // entrance shaft
    for (const c of chambers) soil.disc(c.x, c.y, c.r, OPEN);
    // Galleries linking the chambers to the shaft.
    soil.line(ENTRANCE_X, 0.09, chambers[0].x, chambers[0].y, 0.013, OPEN);
    soil.line(ENTRANCE_X, 0.09, chambers[1].x, chambers[1].y, 0.013, OPEN);
    soil.line(chambers[0].x, chambers[0].y, chambers[2].x, chambers[2].y, 0.013, OPEN);
    soil.line(chambers[1].x, chambers[1].y, chambers[2].x, chambers[2].y, 0.013, OPEN);
    soil.line(chambers[2].x, chambers[2].y, chambers[3].x, chambers[3].y, 0.012, OPEN);
    soil.line(chambers[2].x, chambers[2].y, chambers[4].x, chambers[4].y, 0.012, OPEN);
  }
  excavateInitialNest();

  const broodChambers = [chambers[0], chambers[1]];
  const queenChamber = chambers[2];
  const granary = chambers[3];
  const midden = chambers[4];

  /* ------------------------------------------------------ getting around the nest */

  // Chambers linked by galleries make a small maze, and an ant that simply walks towards where it
  // wants to be gets stuck against a wall. Real ants know their nest, so rather than have them
  // blunder about, they navigate a graph of the galleries they dug.
  const JUNCTION = { name: 'junction', x: ENTRANCE_X, y: 0.092 };
  const nodes = [JUNCTION, ...chambers];
  const NODE = { JUNCTION: 0, UPPER_BROOD: 1, LOWER_BROOD: 2, QUEEN: 3, GRANARY: 4, MIDDEN: 5 };
  const edges = [
    [NODE.JUNCTION, NODE.UPPER_BROOD], [NODE.JUNCTION, NODE.LOWER_BROOD],
    [NODE.UPPER_BROOD, NODE.QUEEN], [NODE.LOWER_BROOD, NODE.QUEEN],
    [NODE.QUEEN, NODE.GRANARY], [NODE.QUEEN, NODE.MIDDEN],
  ];

  /** next[a][b] = the node to head for when standing at a and wanting to reach b. */
  const nextHop = (() => {
    const n = nodes.length;
    const adjacency = Array.from({ length: n }, () => []);
    for (const [a, b] of edges) {
      adjacency[a].push(b);
      adjacency[b].push(a);
    }
    const table = Array.from({ length: n }, () => new Int8Array(n).fill(-1));
    for (let start = 0; start < n; start++) {
      const previous = new Int8Array(n).fill(-1);
      const seen = new Uint8Array(n);
      const queue = [start];
      seen[start] = 1;
      while (queue.length) {
        const at = queue.shift();
        for (const to of adjacency[at]) {
          if (seen[to]) continue;
          seen[to] = 1;
          previous[to] = at;
          queue.push(to);
        }
      }
      // Walk each destination back to the start to find the first step.
      for (let goal = 0; goal < n; goal++) {
        if (goal === start) { table[start][goal] = start; continue; }
        let step = goal;
        while (previous[step] !== start && previous[step] !== -1) step = previous[step];
        table[start][goal] = previous[step] === -1 ? goal : step;
      }
    }
    return table;
  })();

  /** Which node an ant is standing in, or the nearest one if it is in a gallery. */
  function nodeAt(x, y) {
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < nodes.length; k++) {
      const d = distance(x, y, nodes[k].x, nodes[k].y);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  /* ----------------------------------------------------------------- agents */

  const capacity = Math.max(120, world.budget.agents);
  const ants = createPool(capacity, {
    ...MOTION_SCHEMA,
    inNest: 'u8',
    caste: 'u8',          // 0 worker, 1 queen, 2 alate gyne, 3 alate male
    load: 'f32',          // crop contents, mg
    loadQuality: 'f32',   // sugar concentration of the source it came from, 0..1
    hx: 'f32',            // home vector, accumulated by dead reckoning
    hy: 'f32',
    carrying: 'i32',      // brood index being carried, or -1
    trailMemory: 'f32',   // how strong the trail was when last sensed; drives U-turns
    patch: 'i32',         // index of the food patch being exploited, or -1
    restTime: 'f32',      // seconds since coming home; separate from taskTime, which resets often
    energy: 'f32',
    lifespanDays: 'f32',
  });

  const brood = createBroodPool(Math.max(200, Math.round(capacity * 0.8)));
  const corpses = createPool(64, { x: 'f32', y: 'f32', age: 'f32' });

  const hash = new SpatialHash(fb, 0.12, capacity);

  const stores = new Stores({ sugar: 40, protein: 10 });
  stores.setCapacity('sugar', 900);
  stores.setCapacity('protein', 400);

  const goal = new SurvivalGoal({
    label: 'winged queens reared',
    target: 12,
    deadline: 'before the first frost',
  });

  /* ------------------------------------------------------------ food patches */

  /** Aphid colonies on plant stems: the honeydew that a Lasius colony actually runs on. */
  const patches = [];
  function addPatch(x, y, { quality = rng.range(0.45, 0.95), amount = rng.range(120, 320) } = {}) {
    if (patches.length >= 12) patches.shift();
    patches.push({ x, y, r: 0.055, quality, amount, initial: amount, discovered: false });
  }
  addPatch(fb.w * 0.82, fb.h * 0.24);
  addPatch(fb.w * 0.17, fb.h * 0.75);

  /* ----------------------------------------------------- population founding */

  const startingWorkers = Math.min(Math.round(capacity * 0.5), 260);

  function spawnWorker(inNest, age) {
    const i = ants.spawn();
    if (i < 0) return -1;
    ants.caste[i] = 0;
    ants.inNest[i] = inNest;
    ants.age[i] = age;
    ants.speed[i] = params.walkSpeed * rng.range(0.82, 1.18);
    ants.heading[i] = rng.angle();
    ants.carrying[i] = -1;
    ants.patch[i] = -1;
    ants.energy[i] = rng.range(0.6, 1);
    // Workers live months, but a season is what matters here.
    ants.lifespanDays[i] = rng.normal(220, 45);

    if (inNest) {
      const c = rng.pick(chambers);
      ants.x[i] = c.x + rng.range(-c.r * 0.6, c.r * 0.6);
      ants.y[i] = c.y + rng.range(-c.r * 0.6, c.r * 0.6);
      ants.task[i] = TASK.NEST_IDLE;
    } else {
      ants.x[i] = entrance.x + rng.range(-0.05, 0.05);
      ants.y[i] = entrance.y + rng.range(-0.05, 0.05);
      ants.task[i] = TASK.SEARCH;
    }
    ants.px[i] = ants.x[i];
    ants.py[i] = ants.y[i];
    return i;
  }

  // Most of the colony is indoors; a minority is out on the ground at any one time. Ages are
  // skewed young, as a growing colony's are — a flat spread would leave it almost all foragers.
  for (let n = 0; n < startingWorkers; n++) {
    spawnWorker(rng.chance(0.88) ? 1 : 0, Math.pow(rng(), 1.8) * 190 + 1);
  }

  // The queen. One per colony, and the colony ends with her.
  const queenIndex = ants.spawn();
  ants.caste[queenIndex] = 1;
  ants.inNest[queenIndex] = 1;
  ants.task[queenIndex] = TASK.QUEEN;
  ants.x[queenIndex] = queenChamber.x;
  ants.y[queenIndex] = queenChamber.y;
  ants.px[queenIndex] = ants.x[queenIndex];
  ants.py[queenIndex] = ants.y[queenIndex];
  ants.speed[queenIndex] = params.walkSpeed * 0.35;
  ants.carrying[queenIndex] = -1;
  ants.patch[queenIndex] = -1;
  ants.lifespanDays[queenIndex] = 99999;   // Lasius queens live 15-30 years
  ants.age[queenIndex] = 900;

  for (let n = 0; n < 40; n++) {
    const b = brood.spawn();
    if (b < 0) break;
    const c = rng.pick(broodChambers);
    brood.x[b] = c.x + rng.range(-c.r * 0.5, c.r * 0.5);
    brood.y[b] = c.y + rng.range(-c.r * 0.5, c.r * 0.5);
    brood.stage[b] = rng.int(0, 2);
    brood.stageAge[b] = rng.range(0, 5);
    brood.nutrition[b] = 1;
  }

  /* ------------------------------------------------------------ live figures */

  const runtime = {
    alatesReared: 0,
    deaths: 0,
    tripsCompleted: 0,
    broodMoved: 0,
    lastDayCounted: -1,
    foodDeliveredToday: 0,
    foodDeliveredYesterday: 0,
    raining: false,
    rainTimer: 0,
  };

  const view = {
    overlay: 'pheromone',    // 'none' | 'pheromone' | 'temperature'
    tool: 'food',
    showHomeVectors: false,
  };

  /* -------------------------------------------------------------- behaviour */

  /**
   * How long a laden ant goes on laying trail before its pheromone reservoir runs dry. The gland is
   * finite and is replenished in the nest, so an ant that cannot find its way home stops marking
   * long before it stops walking. Without this a single lost forager circles for simulated hours
   * laying pheromone the whole way, and the colony ends up with a trail to nowhere that outlasts
   * the food that started it.
   */
  const GLAND_SECONDS = 90;

  /** After this long trying to get home, an ant abandons dead reckoning and searches for the nest. */
  const GIVE_UP_SECONDS = 200;

  /** Trail deposition, weighted so most of it is laid near the food. */
  function depositTrail(i, metresMoved) {
    const quality = ants.loadQuality[i];
    if (quality <= 0 || metresMoved <= 0) return;

    const reservoir = Math.exp(-ants.taskTime[i] / GLAND_SECONDS);
    if (reservoir < 0.02) return;

    // Distance from the nest as a fraction of the world, used as a proxy for "how close to the
    // food am I". Laden ants lay heavily just after leaving the source and taper off near home.
    const fromNest = distance(ants.x[i], ants.y[i], entrance.x, entrance.y);
    const span = Math.hypot(fb.w, fb.h) * 0.5;
    const nearFood = Math.min(1, fromNest / span);
    const bias = 1 + (params.depositNearFood - 1) * nearFood;

    trail.deposit(ants.x[i], ants.y[i], quality * bias * metresMoved * 26 * reservoir);
  }

  /** Try to pick up food at whatever patch the ant is standing on. */
  function patchAt(x, y) {
    for (let p = 0; p < patches.length; p++) {
      const patch = patches[p];
      if (patch.amount <= 0) continue;
      if (distance(x, y, patch.x, patch.y) <= patch.r) return p;
    }
    return -1;
  }

  function stepForager(i, dt) {
    const task = ants.task[i];
    ants.taskTime[i] += dt;

    if (task === TASK.FEEDING) {
      const p = ants.patch[i];
      const patch = patches[p];
      if (!patch || patch.amount <= 0) {
        ants.task[i] = TASK.SEARCH;
        ants.patch[i] = -1;
        return;
      }
      // Filling the crop takes a few seconds of drinking.
      const drawn = Math.min(patch.amount, 0.55 * dt);
      patch.amount -= drawn;
      ants.load[i] += drawn;
      ants.loadQuality[i] = patch.quality;
      if (ants.load[i] >= 1.4 || patch.amount <= 0) {
        ants.task[i] = TASK.RETURNING;
        ants.taskTime[i] = 0;
      }
      return;
    }

    // --- steering ------------------------------------------------------------

    let heading = ants.heading[i];

    if (task === TASK.RETURNING) {
      // Dead reckoning: steer down the accumulated home vector, with a little noise so the return
      // is not a laser-straight line.
      const home = homeBearing({ hx: ants.hx, hy: ants.hy }, i, 0.03);
      if (home === null || ants.taskTime[i] > GIVE_UP_SECONDS) {
        // Either the path integrator says we have arrived, or it has been wrong for long enough
        // that the ant stops trusting it. Both cases end the same way in life: a local search for
        // the nest entrance using landmarks rather than dead reckoning.
        heading = turnToward(heading, bearing(ants.x[i], ants.y[i], entrance.x, entrance.y), 6 * dt);
        heading += wanderTurn(rng, 0.8, dt);
      } else {
        heading = turnToward(heading, home, 5 * dt);
        heading += wanderTurn(rng, 0.35, dt);
      }
    } else {
      // Outbound. Sample the trail with both antennae and turn towards the stronger side.
      const concentration = trail.sample(ants.x[i], ants.y[i]);
      const turn = bilateralTurn(trail, ants.x[i], ants.y[i], heading, {
        spread: params.antennaSpread * 8,
        reach: params.antennaSpread * 18,
        gain: 4.5,
      });

      if (concentration > 1) {
        ants.task[i] = TASK.TRAIL;
        heading += turn * dt * 14;
        heading += wanderTurn(rng, 0.9, dt);
        ants.trailMemory[i] = concentration;
      } else {
        // Off the trail. An ant that has just lost a trail turns back to look for it far more
        // readily than one that never had one.
        ants.task[i] = TASK.SEARCH;
        // A searching ant keeps a fair amount of directional persistence — that is what makes it a
        // search rather than a shuffle on the doorstep, and it is why a scout gets metres from home.
        heading += wanderTurn(rng, 1.3, dt);
        if (ants.trailMemory[i] > 1 && rng.eventAtRate(params.uTurnRate, dt)) {
          heading = wrapAngle(heading + Math.PI + rng.normal(0, 0.4));
          ants.trailMemory[i] *= 0.5;
        }
        ants.trailMemory[i] *= Math.exp(-dt * 0.15);
      }

      // Foragers know roughly how far from home they are and turn back near the limit of their
      // range. The leash has to sit outside the far corners of the ground, or it quietly prevents
      // the colony from ever reaching food placed towards the edge.
      const fromNest = distance(ants.x[i], ants.y[i], entrance.x, entrance.y);
      if (fromNest > FORAGING_RANGE) {
        heading = turnToward(heading, bearing(ants.x[i], ants.y[i], entrance.x, entrance.y), 1.6 * dt);
      }
    }

    ants.heading[i] = wrapAngle(heading);

    // --- movement ------------------------------------------------------------

    const step = ants.speed[i] * dt;
    const dx = Math.cos(ants.heading[i]) * step;
    const dy = Math.sin(ants.heading[i]) * step;
    const moved = moveThroughMask(barriers, ants.x[i], ants.y[i], dx, dy, 0.004);

    if (moved.blocked) {
      // Walls of the apparatus: follow them rather than bouncing off at random.
      ants.heading[i] = wrapAngle(ants.heading[i] + (rng.chance(0.5) ? 1 : -1) * rng.range(0.5, 1.4));
    }

    // Stay on the ground.
    ants.x[i] = Math.min(fb.x + fb.w - 0.005, Math.max(fb.x + 0.005, moved.x));
    ants.y[i] = Math.min(fb.y + fb.h - 0.005, Math.max(fb.y + 0.005, moved.y));

    const trueDx = ants.x[i] - ants.px[i];
    const trueDy = ants.y[i] - ants.py[i];
    const metres = Math.hypot(trueDx, trueDy);

    // Dead reckoning accumulates a little error per metre walked, as real path integration does.
    accumulateHomeVector({ hx: ants.hx, hy: ants.hy }, i, trueDx, trueDy, rng, 0.02);

    // --- what did we find ----------------------------------------------------

    if (ants.task[i] === TASK.RETURNING) {
      depositTrail(i, metres);
      if (distance(ants.x[i], ants.y[i], entrance.x, entrance.y) < 0.035) enterNest(i);
    } else {
      const p = patchAt(ants.x[i], ants.y[i]);
      if (p >= 0) {
        patches[p].discovered = true;
        ants.patch[i] = p;
        ants.task[i] = TASK.FEEDING;
        ants.taskTime[i] = 0;
        ants.load[i] = 0;
        // Arriving at food resets the home vector's destination memory, not the vector itself.
        ants.trailMemory[i] = trail.sample(ants.x[i], ants.y[i]);
      }
    }
  }

  function enterNest(i) {
    ants.inNest[i] = 1;
    ants.x[i] = ENTRANCE_X + rng.range(-0.006, 0.006);
    ants.y[i] = NEST_SURFACE_Y + 0.012;
    ants.px[i] = ants.x[i];
    ants.py[i] = ants.y[i];
    ants.heading[i] = Math.PI / 2;    // heading down into the nest
    clearHomeVector({ hx: ants.hx, hy: ants.hy }, i);

    if (ants.load[i] > 0) {
      // Honeydew goes into the communal crop; a share of it is protein-poor, so prey matters too.
      stores.add('sugar', ants.load[i] * ants.loadQuality[i]);
      runtime.foodDeliveredToday += ants.load[i] * ants.loadQuality[i];
      runtime.tripsCompleted++;
      ants.load[i] = 0;
      ants.loadQuality[i] = 0;
    }
    ants.task[i] = TASK.NEST_IDLE;
    ants.taskTime[i] = 0;
    ants.restTime[i] = 0;
  }

  const DEPARTURE_DIRECTIONS = 12;
  const departureWeights = new Float64Array(DEPARTURE_DIRECTIONS);

  /**
   * Which way to set off from the nest entrance.
   *
   * This is where Deneubourg's choice function actually bites. He wrote it for an ant at a fork
   * with two branches, weighting each by (k + C)^n; an ant standing at the nest mouth faces the
   * same decision with more options, so the same rule is applied across a ring of directions.
   *
   * The exponent n is what makes recruitment work. At n = 1 the colony spreads its traffic in
   * proportion to the pheromone and never commits to anything; at n = 2 a modest lead becomes a
   * large majority, the trail is reinforced faster than it evaporates, and a column forms. Drag the
   * sharpness slider down and you can watch a working trail dissolve into aimless search.
   */
  function chooseDepartureHeading() {
    const n = params.deneubourgN;
    const k = params.deneubourgK;
    // Sampled a little way out from the mouth. Right at the entrance every route overlaps and the
    // concentrations are nearly equal; a few centimetres out the trails have separated.
    const radius = 0.15;

    let total = 0;
    for (let d = 0; d < DEPARTURE_DIRECTIONS; d++) {
      const angle = (d / DEPARTURE_DIRECTIONS) * TAU;
      const concentration = trail.sample(
        entrance.x + Math.cos(angle) * radius,
        entrance.y + Math.sin(angle) * radius,
      );
      const weight = Math.pow(k + concentration, n);
      departureWeights[d] = weight;
      total += weight;
    }

    let pick = rng() * total;
    for (let d = 0; d < DEPARTURE_DIRECTIONS; d++) {
      pick -= departureWeights[d];
      if (pick <= 0) {
        // Jitter within the sector, so departures fan out rather than leaving along twelve spokes.
        return wrapAngle((d / DEPARTURE_DIRECTIONS) * TAU + rng.range(-1, 1) * (Math.PI / DEPARTURE_DIRECTIONS));
      }
    }
    return rng.angle();
  }

  function leaveNest(i) {
    ants.inNest[i] = 0;
    ants.x[i] = entrance.x + rng.range(-0.012, 0.012);
    ants.y[i] = entrance.y + rng.range(-0.012, 0.012);
    ants.px[i] = ants.x[i];
    ants.py[i] = ants.y[i];
    ants.heading[i] = chooseDepartureHeading();
    clearHomeVector({ hx: ants.hx, hy: ants.hy }, i);
    ants.task[i] = TASK.SEARCH;
    ants.taskTime[i] = 0;
    ants.trailMemory[i] = 0;
    ants.patch[i] = -1;
  }

  /**
   * Move an ant inside the nest towards a target, digging only if that is its job.
   *
   * When `viaNode` is given, the ant routes along the gallery graph instead of walking straight at
   * the destination through solid earth.
   */
  function walkInNest(i, dt, tx, ty, { dig = false, viaNode = -1 } = {}) {
    let aimX = tx;
    let aimY = ty;

    if (viaNode >= 0) {
      const here = nodeAt(ants.x[i], ants.y[i]);
      if (here !== viaNode) {
        const hop = nextHop[here][viaNode];
        aimX = nodes[hop].x;
        aimY = nodes[hop].y;
      }
    }

    const want = bearing(ants.x[i], ants.y[i], aimX, aimY);
    ants.heading[i] = turnToward(ants.heading[i], want, 7 * dt);
    ants.heading[i] += wanderTurn(rng, 0.5, dt);

    const step = ants.speed[i] * 0.8 * dt;
    const dx = Math.cos(ants.heading[i]) * step;
    const dy = Math.sin(ants.heading[i]) * step;
    const moved = moveThroughMask(soil, ants.x[i], ants.y[i], dx, dy, 0.002);

    if (moved.blocked) {
      if (dig) {
        // Excavation: remove the cell ahead. This is how the nest actually grows.
        const ax = ants.x[i] + Math.cos(ants.heading[i]) * 0.006;
        const ay = ants.y[i] + Math.sin(ants.heading[i]) * 0.006;
        if (ay > NEST_SURFACE_Y + 0.004 && soil.isSolid(ax, ay)) soil.setAtWorld(ax, ay, OPEN);
      } else {
        ants.heading[i] = wrapAngle(ants.heading[i] + rng.range(-1.6, 1.6));
      }
    }
    ants.x[i] = moved.x;
    ants.y[i] = moved.y;
    return distance(ants.x[i], ants.y[i], tx, ty);
  }

  /** The temperature a brood item is currently sitting at. */
  function broodTemperature(b) {
    return soilTemp.sample(brood.x[b], brood.y[b]);
  }

  /**
   * Where a nurse wants to put brood: the point in the brood chambers closest to the optimum.
   * Sampling the two chambers rather than the whole grid keeps this cheap and matches what the
   * animal is doing — it knows its nest, and it is choosing a chamber.
   */
  const BROOD_SPOT_SAMPLES = [-0.7, -0.35, 0, 0.35, 0.7];
  let cachedSpot = null;
  let spotAge = 0;

  /**
   * The best place in the nest to put brood right now.
   *
   * Sampled over a grid of each brood chamber rather than a handful of points down the middle: too
   * coarse a search reports the chamber as worse than where the brood already is, and then no nurse
   * ever sees a reason to pick anything up.
   *
   * Recomputed a few times a second and shared between nurses — the answer is a property of the
   * nest, not of the individual, and every ant asking it separately is wasted work.
   */
  function bestBroodSpot() {
    if (cachedSpot) return cachedSpot;
    let best = null;
    let bestError = Infinity;
    for (let ci = 0; ci < broodChambers.length; ci++) {
      const c = broodChambers[ci];
      for (const fy of BROOD_SPOT_SAMPLES) {
        for (const fx of BROOD_SPOT_SAMPLES) {
          if (fx * fx + fy * fy > 1) continue;
          const x = c.x + fx * c.r;
          const y = c.y + fy * c.r;
          const error = Math.abs(soilTemp.sample(x, y) - params.broodOptimumC);
          if (error < bestError) {
            bestError = error;
            best = { x, y, node: ci === 0 ? NODE.UPPER_BROOD : NODE.LOWER_BROOD, error };
          }
        }
      }
    }
    cachedSpot = best;
    return best;
  }

  /** Put down whatever brood this ant was carrying and go back on the job market. */
  function releaseBrood(i) {
    const b = ants.carrying[i];
    if (b >= 0 && brood.alive[b]) brood.cell[b] = 0;
    ants.carrying[i] = -1;
    ants.task[i] = TASK.NEST_IDLE;
    ants.taskTime[i] = 0;
  }

  function stepNestAnt(i, dt) {
    ants.taskTime[i] += dt;
    ants.restTime[i] += dt;

    if (ants.caste[i] === 1) {
      // The queen shuffles about her chamber and lays.
      walkInNest(i, dt, queenChamber.x + rng.range(-0.01, 0.01), queenChamber.y + rng.range(-0.01, 0.01));
      return;
    }

    switch (ants.task[i]) {
      case TASK.NURSE: {
        const b = ants.carrying[i];
        if (b < 0 || !brood.alive[b]) {
          releaseBrood(i);
          return;
        }
        const spot = bestBroodSpot();
        const d = walkInNest(i, dt, spot.x, spot.y, { viaNode: spot.node });
        brood.x[b] = ants.x[i];
        brood.y[b] = ants.y[i];
        if (d < 0.012) {
          // Set down in the right place, jittered so brood forms a pile rather than a stack.
          brood.x[b] = spot.x + rng.range(-0.008, 0.008);
          brood.y[b] = spot.y + rng.range(-0.006, 0.006);
          releaseBrood(i);
        } else if (ants.taskTime[i] > 60) {
          // Gave up. Put it back in a brood chamber rather than abandoning it in a gallery.
          const c = rng.pick(broodChambers);
          brood.x[b] = c.x + rng.range(-c.r * 0.5, c.r * 0.5);
          brood.y[b] = c.y + rng.range(-c.r * 0.5, c.r * 0.5);
          releaseBrood(i);
        }
        break;
      }

      case TASK.UNDERTAKER: {
        const c = ants.carrying[i];
        if (c < 0 || !corpses.alive[c]) {
          ants.carrying[i] = -1;
          ants.task[i] = TASK.NEST_IDLE;
          return;
        }
        const d = walkInNest(i, dt, midden.x, midden.y, { viaNode: NODE.MIDDEN });
        corpses.x[c] = ants.x[i];
        corpses.y[c] = ants.y[i];
        if (d < 0.02) {
          // Dropped on the refuse pile, where it stays.
          corpses.x[c] = midden.x + rng.range(-midden.r * 0.7, midden.r * 0.7);
          corpses.y[c] = midden.y + rng.range(-midden.r * 0.7, midden.r * 0.7);
          ants.carrying[i] = -1;
          ants.task[i] = TASK.NEST_IDLE;
        }
        break;
      }

      case TASK.EXCAVATE: {
        // Dig outward from the deepest chamber; ants enlarge the nest as the colony grows.
        walkInNest(i, dt, granary.x + rng.range(-0.05, 0.05), granary.y + rng.range(-0.02, 0.05),
          { dig: true, viaNode: NODE.GRANARY });
        if (ants.taskTime[i] > 25) {
          ants.task[i] = TASK.NEST_IDLE;
          ants.taskTime[i] = 0;
        }
        break;
      }

      default: {
        // Idle: wander the galleries, then pick up a job.
        walkInNest(i, dt, ants.x[i] + Math.cos(ants.heading[i]) * 0.05, ants.y[i] + Math.sin(ants.heading[i]) * 0.05);
        if (ants.taskTime[i] < 1.5) break;
        chooseNestTask(i);
        break;
      }
    }
  }

  /**
   * Task choice. Age polyethism does the heavy lifting: young workers stay in and nurse, older
   * ones go out. Foraging effort also tracks how well the trail is doing, which is what turns a
   * discovery by one ant into a column of hundreds.
   */
  function chooseNestTask(i) {
    ants.taskTime[i] = 0;
    const age = ants.age[i];

    // Undertaking first: a corpse in a gallery is a disease risk and gets dealt with quickly.
    for (let c = 0; c < corpses.highWater; c++) {
      if (!corpses.alive[c]) continue;
      if (distance(corpses.x[c], corpses.y[c], midden.x, midden.y) < midden.r) continue;
      if (distance(ants.x[i], ants.y[i], corpses.x[c], corpses.y[c]) < 0.06 && rng.chance(0.5)) {
        ants.carrying[i] = c;
        ants.task[i] = TASK.UNDERTAKER;
        return;
      }
    }

    // Most of a colony is indoors at any moment, and a forager that has just come home rests before
    // going out again. Departure is therefore a slow rate rather than a coin flip per decision —
    // get that wrong and the entire colony empties onto the lawn within a minute.
    if (age >= params.foragerAgeDays && clock.isDaylight && clock.airTemperature() > 8
        && ants.restTime[i] > REST_SECONDS) {
      // A strong trail at the entrance pulls ants out. This is the amplification step of mass
      // recruitment: one scout's success becomes a column of hundreds.
      const atEntrance = trail.sample(entrance.x, entrance.y);
      const hunger = 1 - stores.fullness('sugar');
      const ratePerSecond = 0.004 + Math.min(0.055, atEntrance / 900) + hunger * 0.006;
      if (rng.eventAtRate(ratePerSecond, 1.5)) {
        leaveNest(i);
        return;
      }
    }

    // Brood that would develop faster somewhere else needs carrying there. What matters is not how
    // far the brood is from the optimum — in cool soil everything is — but how much better off it
    // would be in the best spot available, which is the judgement the nurse is actually making.
    //
    // Age polyethism is a tendency, not a rota. Young workers nurse by preference, but older ones
    // revert to brood care when it needs doing — which matters here, because a hard age cutoff
    // leaves the colony with no nurses at all once the founding cohort grows up.
    const nurseInclination = age < params.foragerAgeDays ? 1
      : age < params.foragerAgeDays * 3 ? 0.4
        : 0.15;
    if (rng.chance(nurseInclination)) {
      const spot = bestBroodSpot();
      let worst = -1;
      let bestGain = 0.5;      // °C of improvement worth the trip
      for (let b = 0; b < brood.highWater; b++) {
        if (!brood.alive[b] || brood.cell[b] !== 0) continue;   // cell != 0 means already being carried
        const gain = Math.abs(broodTemperature(b) - params.broodOptimumC) - spot.error;
        if (gain > bestGain && distance(ants.x[i], ants.y[i], brood.x[b], brood.y[b]) < 0.16) {
          bestGain = gain;
          worst = b;
        }
      }
      if (worst >= 0) {
        brood.cell[worst] = 1;               // claimed, so a second nurse does not pick it up too
        ants.carrying[i] = worst;
        ants.task[i] = TASK.NURSE;
        runtime.broodMoved++;
        return;
      }
    }

    if (rng.chance(0.06)) {
      ants.task[i] = TASK.EXCAVATE;
      return;
    }

    ants.task[i] = TASK.NEST_IDLE;
  }

  /* ------------------------------------------------------------- demography */

  function stepBrood(days) {
    const stageDays = [params.eggDays, params.larvaDays, params.pupaDays];
    const larvaeCount = brood.countWhere((b) => brood.stage[b] === STAGE.LARVA);

    // Larvae are the colony's protein sink. If the larder is empty they develop slowly and die.
    const demand = larvaeCount * 0.0016 * days * 60;
    const fed = stores.consume('sugar', demand * 0.6) + stores.consume('protein', demand * 0.4);
    const satisfaction = demand > 0 ? Math.min(1, fed / demand) : 1;

    for (let b = 0; b < brood.highWater; b++) {
      if (!brood.alive[b]) continue;

      const temp = broodTemperature(b);
      const rate = developmentRate(temp, params.broodBaseC, params.broodOptimumC, 36);

      brood.nutrition[b] += (satisfaction - brood.nutrition[b]) * Math.min(1, days * 0.5);
      const nutritionFactor = 0.35 + 0.65 * brood.nutrition[b];

      if (advanceBrood(brood, b, days * rate * nutritionFactor, stageDays) === 'emerged') {
        emerge(b);
        continue;
      }

      // Starvation and chilling both kill brood.
      if (brood.nutrition[b] < 0.12 && rng.chance(days * 0.3)) {
        brood.kill(b);
      }
    }
  }

  function emerge(b) {
    const fate = brood.fate[b];
    brood.kill(b);

    if (fate === 1 || fate === 2) {
      // A winged reproductive. In life she leaves on the nuptial flight; here she counts towards
      // the colony's season and then departs.
      runtime.alatesReared += fate === 1 ? 1 : 0;
      goal.value = runtime.alatesReared;
      return;
    }

    const i = spawnWorker(1, 0);
    if (i >= 0) {
      ants.x[i] = brood.x[b];
      ants.y[i] = brood.y[b];
      ants.px[i] = ants.x[i];
      ants.py[i] = ants.y[i];
    }
  }

  function stepQueen(days) {
    if (!ants.alive[queenIndex]) return;

    // Laying tracks temperature and the larder, and shuts down for winter. Rate is per day.
    const warmth = developmentRate(soilTemp.sample(queenChamber.x, queenChamber.y), 10, 25, 34);
    const wellFed = Math.min(1, stores.get('sugar') / 120);
    const seasonal = clock.dayOfYear > 60 && clock.dayOfYear < 260 ? 1 : 0.05;
    const eggsPerDay = 26 * warmth * wellFed * seasonal;

    // Once the colony is big and the season is right, some eggs are raised as reproductives —
    // the whole point of the year.
    const rearingSexuals = clock.dayOfYear > 130 && clock.dayOfYear < 200 && ants.count > startingWorkers * 0.85;

    let expected = eggsPerDay * days;
    while (expected > 0) {
      if (expected < 1 && !rng.chance(expected)) break;
      expected -= 1;

      const b = brood.spawn();
      if (b < 0) break;
      brood.stage[b] = STAGE.EGG;
      brood.nutrition[b] = 1;
      brood.fate[b] = rearingSexuals && rng.chance(0.18) ? (rng.chance(0.45) ? 1 : 2) : 0;
      const c = rng.pick(broodChambers);
      brood.x[b] = c.x + rng.range(-c.r * 0.5, c.r * 0.5);
      brood.y[b] = c.y + rng.range(-c.r * 0.5, c.r * 0.5);
    }
  }

  function stepMortality(days, dt) {
    for (let i = 0; i < ants.highWater; i++) {
      if (!ants.alive[i] || ants.caste[i] === 1) continue;
      ants.age[i] += days;

      // Foraging is dangerous; the nest is not. Outside mortality is the dominant term for ants.
      const outsideRisk = ants.inNest[i] ? 0 : 0.0016;
      const oldAge = ants.age[i] > ants.lifespanDays[i] ? 0.25 : 0;
      const chilled = !ants.inNest[i] && clock.airTemperature() < 4 ? 0.02 : 0;

      if (rng.chance((outsideRisk + oldAge + chilled) * days * 24)) {
        die(i);
        continue;
      }
      void dt;
    }
  }

  function die(i) {
    // A corpse inside the nest has to be carried out; one outside is simply gone.
    if (ants.inNest[i] && corpses.count < 40) {
      const c = corpses.spawn();
      if (c >= 0) {
        corpses.x[c] = ants.x[i];
        corpses.y[c] = ants.y[i];
      }
    }
    // Anything she was carrying is dropped where she fell, and another worker will find it.
    const held = ants.carrying[i];
    if (held >= 0 && brood.alive[held]) brood.cell[held] = 0;
    ants.kill(i);
    runtime.deaths++;
  }

  /* ------------------------------------------------------------ environment */

  function stepSoilTemperature(dt) {
    // The surface follows the air, warmed further by direct sun. Depth lags and damps, which the
    // diffusion in the field reproduces on its own.
    const air = clock.airTemperature();
    // Bare soil and stone in full sun run well above shade air temperature, which is exactly why a
    // colony nests under a paving slab and hauls its brood up towards it on a sunny afternoon.
    const surface = air + clock.solarElevation * 20;
    const deep = clock.meanTempC - 2 * Math.cos((2 * Math.PI * (clock.dayOfYear - 45)) / 365);
    soilTemp.ambient = deep;

    for (let cx = 0; cx < soilTemp.cols; cx++) {
      const wx = soilTemp.bounds.x + (cx + 0.5) * soilTemp.cellSize;
      soilTemp.setAt(wx, NEST_SURFACE_Y + 0.002, surface);
    }
    soilTemp.update(dt);
  }

  function stepWeather(dt, days) {
    if (runtime.raining) {
      runtime.rainTimer -= dt;
      // Rain washes trails off the ground: the classic reset that forces the colony to search again.
      const wash = Math.exp(-dt * 1.4);
      for (let k = 0; k < trail.data.length; k++) trail.data[k] *= wash;
      if (runtime.rainTimer <= 0) runtime.raining = false;
    }

    const day = Math.floor(clock.elapsedDays);
    if (day !== runtime.lastDayCounted) {
      runtime.lastDayCounted = day;
      runtime.foodDeliveredYesterday = runtime.foodDeliveredToday;
      runtime.foodDeliveredToday = 0;
    }
    void days;
  }

  function checkGoal() {
    if (goal.outcome) return;
    if (!ants.alive[queenIndex]) {
      goal.fail('The queen died — the colony cannot replace her.');
    } else if (ants.count <= 2) {
      goal.fail('The colony died out.');
    } else if (runtime.alatesReared >= goal.target) {
      goal.succeed(`${runtime.alatesReared} winged queens left on the nuptial flight.`);
    } else if (clock.dayOfYear > 300) {
      goal.fail(`Winter closed in with ${runtime.alatesReared} winged queens reared.`);
    }
  }

  /* --------------------------------------------------------------- stepping */

  let broodAccumulator = 0;

  function step(dt) {
    clock.step(dt);
    const days = dt / clock.simSecondsPerDay;

    stepSoilTemperature(dt);
    trail.update(dt);
    stepWeather(dt, days);

    // The nest's best brood spot moves as the soil warms; recompute it a few times a second rather
    // than once per nurse per tick.
    spotAge += dt;
    if (spotAge > 0.3) {
      cachedSpot = null;
      spotAge = 0;
    }

    hash.rebuild(ants.x, ants.y, ants.highWater, ants.alive);

    for (let i = 0; i < ants.highWater; i++) {
      if (!ants.alive[i]) continue;
      storePrevious(ants, i);
      if (ants.inNest[i]) stepNestAnt(i, dt);
      else stepForager(i, dt);
    }

    // Demography is slow; running it a few times a second is ample and keeps the tick cheap.
    broodAccumulator += dt;
    if (broodAccumulator >= 0.25) {
      const slice = broodAccumulator / clock.simSecondsPerDay;
      stepBrood(slice);
      stepQueen(slice);
      stepMortality(slice, broodAccumulator);
      broodAccumulator = 0;
      checkGoal();
    }
  }

  /* --------------------------------------------------------------- rendering */

  const dprScale = () => Math.min(window.devicePixelRatio || 1, 2);

  // Rendering assets are built on first draw, not at construction, so the colony can be simulated
  // headlessly in tests where there is no document to make a canvas from.
  let atlases = null;
  let trailOverlay = null;
  let tempOverlay = null;

  function ensureRenderAssets() {
    if (atlases) return;
    const dpr = dprScale();

    // A real Lasius worker is very dark brown, which against dark soil would be invisible at four
    // pixels across. These are lifted towards the colour a worker takes in direct sun, so the ant
    // reads as an ant rather than as a hole in the ground.
    const BODY = '#8a6039';
    const LIMB = '#5d4026';

    atlases = {
      worker: new SpriteAtlas(15 * dpr, 24, (c, s) => paintInsect(c, s, { body: BODY, legColour: LIMB, width: 0.26 })),
      laden: new SpriteAtlas(15 * dpr, 24, (c, s) => {
        paintInsect(c, s, { body: BODY, legColour: LIMB, width: 0.26 });
        paintCarrying(c, s, '#f0c063', 0.11);
      }),
      carrier: new SpriteAtlas(15 * dpr, 24, (c, s) => {
        paintInsect(c, s, { body: BODY, legColour: LIMB, width: 0.26 });
        paintCarrying(c, s, '#f2e8d2', 0.12);
      }),
      queen: new SpriteAtlas(30 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: '#a06a3a', legColour: LIMB, width: 0.34, abdomenLen: 0.48,
      })),
    };

    trailOverlay = new FieldOverlay(trail, RAMPS.pheromone, { gamma: 0.5, opacity: 0.8 });
    tempOverlay = new FieldOverlay(soilTemp, RAMPS.temperature, {
      min: 2, max: 34, gamma: 1, opacity: 0.55,
    });
  }

  let groundPattern = null;
  let soilCanvas = null;
  let soilVersion = -1;

  /** The soil profile is only redrawn when the ants have actually dug something. */
  function bakeSoil() {
    if (soilCanvas && soilVersion === soil.version) return soilCanvas;
    if (!soilCanvas) {
      soilCanvas = document.createElement('canvas');
      soilCanvas.width = soil.cols;
      soilCanvas.height = soil.rows;
    }
    const c = soilCanvas.getContext('2d');
    const img = c.createImageData(soil.cols, soil.rows);
    for (let i = 0, p = 0; i < soil.cells.length; i++, p += 4) {
      if (soil.cells[i] === SOLID) {
        // Mottled earth, deterministic so it does not shimmer between frames.
        const y = (i / soil.cols) | 0;
        const n = ((i * 2654435761) >>> 16) % 24;
        const depth = Math.min(1, y / soil.rows);
        img.data[p] = 62 + n - depth * 18;
        img.data[p + 1] = 46 + n * 0.7 - depth * 14;
        img.data[p + 2] = 32 + n * 0.4 - depth * 10;
        img.data[p + 3] = 255;
      } else {
        img.data[p + 3] = 0;
      }
    }
    c.putImageData(img, 0, 0);
    soilVersion = soil.version;
    return soilCanvas;
  }

  function renderField(ctx, vp, alpha) {
    ensureRenderAssets();
    const b = meta.fieldBounds;

    if (!groundPattern) groundPattern = makeGroundPattern(ctx, '#3a2e21', '#4a3a29', 64, 0.06);
    ctx.save();
    ctx.scale(0.004, 0.004);              // the pattern is in pixels; bring it into metres
    ctx.fillStyle = groundPattern;
    ctx.fillRect(b.x / 0.004, b.y / 0.004, b.w / 0.004, b.h / 0.004);
    ctx.restore();

    if (view.overlay === 'pheromone') {
      trailOverlay.dirty = true;
      trailOverlay.draw(ctx, vp);
    }

    // Barriers of the apparatus.
    ctx.fillStyle = '#0f0c09';
    for (let cy = 0; cy < barriers.rows; cy++) {
      for (let cx = 0; cx < barriers.cols; cx++) {
        if (barriers.cells[cy * barriers.cols + cx] === SOLID) {
          ctx.fillRect(
            barriers.bounds.x + cx * barriers.cellSize,
            barriers.bounds.y + cy * barriers.cellSize,
            barriers.cellSize * 1.02, barriers.cellSize * 1.02,
          );
        }
      }
    }

    // Aphid colonies.
    for (const patch of patches) {
      if (patch.amount <= 0) continue;
      const strength = patch.amount / patch.initial;
      ctx.fillStyle = `rgba(94, 124, 58, ${0.35 + 0.4 * strength})`;
      ctx.beginPath();
      ctx.arc(patch.x, patch.y, patch.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#9fbc5e';
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU + patch.x;
        ctx.beginPath();
        ctx.arc(patch.x + Math.cos(a) * patch.r * 0.55, patch.y + Math.sin(a) * patch.r * 0.55,
          patch.r * 0.13 * (0.5 + strength), 0, TAU);
        ctx.fill();
      }
    }

    // The nest entrance, with its spoil crater.
    ctx.fillStyle = '#3b2d1e';
    ctx.beginPath();
    ctx.arc(entrance.x, entrance.y, 0.045, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#100c08';
    ctx.beginPath();
    ctx.arc(entrance.x, entrance.y, 0.016, 0, TAU);
    ctx.fill();

    const dpr = dprScale();
    drawPopulation(ctx, vp, dpr, ants, alpha, {
      atlasFor: (i) => {
        if (ants.inNest[i]) return null;
        if (ants.caste[i] === 1) return atlases.queen;
        return ants.load[i] > 0 ? atlases.laden : atlases.worker;
      },
      scale: 1,
    });

    if (view.overlay === 'pheromone') {
      drawLegend(ctx, dpr, vp.rect, {
        title: 'trail pheromone',
        ramp: RAMPS.pheromone,
        minLabel: '0',
        maxLabel: trail.maxValue > 0 ? trail.maxValue.toFixed(0) : '0',
      });
    }

    if (runtime.raining) {
      ctx.strokeStyle = 'rgba(150, 180, 210, 0.35)';
      ctx.lineWidth = 0.002;
      ctx.beginPath();
      for (let k = 0; k < 60; k++) {
        const x = ((k * 37) % 100) / 100 * b.w;
        const y = ((k * 61) % 100) / 100 * b.h;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.01, y + 0.02);
      }
      ctx.stroke();
    }
  }

  function renderNest(ctx, vp, alpha) {
    ensureRenderAssets();
    const nbnds = meta.nestBounds;

    // Sky above the ground line, then the soil block with the galleries knocked out of it.
    ctx.fillStyle = '#1b2530';
    ctx.fillRect(nbnds.x, nbnds.y, nbnds.w, NEST_SURFACE_Y);
    ctx.fillStyle = '#15100b';
    ctx.fillRect(nbnds.x, NEST_SURFACE_Y, nbnds.w, nbnds.h - NEST_SURFACE_Y);

    if (view.overlay === 'temperature') {
      tempOverlay.dirty = true;
      tempOverlay.draw(ctx, vp);
    }

    const baked = bakeSoil();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(baked, nbnds.x, nbnds.y, nbnds.w, nbnds.h);
    ctx.imageSmoothingEnabled = true;

    // Stored honeydew in the granary, drawn as a level that rises and falls.
    const fullness = stores.fullness('sugar');
    if (fullness > 0.02) {
      ctx.fillStyle = 'rgba(214, 160, 58, 0.75)';
      ctx.beginPath();
      ctx.arc(granary.x, granary.y, granary.r * 0.85 * Math.sqrt(fullness), 0, TAU);
      ctx.fill();
    }

    // Brood, coloured by stage: eggs pale, larvae fatter and creamier, pupae darker.
    for (let b = 0; b < brood.highWater; b++) {
      if (!brood.alive[b]) continue;
      const stage = brood.stage[b];
      const r = stage === STAGE.EGG ? 0.0022 : stage === STAGE.LARVA ? 0.0038 : 0.0044;
      ctx.fillStyle = stage === STAGE.EGG ? '#efe8d4' : stage === STAGE.LARVA ? '#e6d4a8' : '#c2a578';
      if (brood.fate[b] > 0) ctx.fillStyle = '#d8c0e0';   // a reproductive in the making
      ctx.beginPath();
      ctx.ellipse(brood.x[b], brood.y[b], r * 1.4, r, 0, 0, TAU);
      ctx.fill();
    }

    // The midden.
    for (let c = 0; c < corpses.highWater; c++) {
      if (!corpses.alive[c]) continue;
      ctx.fillStyle = '#4a3f31';
      ctx.beginPath();
      ctx.arc(corpses.x[c], corpses.y[c], 0.003, 0, TAU);
      ctx.fill();
    }

    const dpr = dprScale();
    drawPopulation(ctx, vp, dpr, ants, alpha, {
      atlasFor: (i) => {
        if (!ants.inNest[i]) return null;
        if (ants.caste[i] === 1) return atlases.queen;
        if (ants.carrying[i] >= 0) return atlases.carrier;
        return atlases.worker;
      },
      // A 4 mm worker at this zoom is barely two pixels, so nest ants are drawn somewhat larger
      // than scale — the cutaway is a diagram, and an invisible ant explains nothing.
      scale: 0.30,
    });

    // Chamber labels, only once you have zoomed in far enough to want them.
    if (vp.zoom > 700) {
      for (const c of chambers) {
        drawWorldLabel(ctx, vp, dpr, c.x, c.y - c.r - 0.006, c.name, { size: 9 });
      }
    }

    if (view.overlay === 'temperature') {
      drawLegend(ctx, dpr, vp.rect, {
        title: 'soil temperature',
        ramp: RAMPS.temperature,
        minLabel: '2°C',
        maxLabel: '34°C',
      });
    }
  }

  /* ----------------------------------------------------------------- panel */

  function stats() {
    let foragingOut = 0;
    let laden = 0;
    let nursing = 0;
    for (let i = 0; i < ants.highWater; i++) {
      if (!ants.alive[i]) continue;
      if (!ants.inNest[i]) foragingOut++;
      if (ants.load[i] > 0) laden++;
      if (ants.task[i] === TASK.NURSE) nursing++;
    }

    const eggs = brood.countWhere((b) => brood.stage[b] === STAGE.EGG);
    const larvae = brood.countWhere((b) => brood.stage[b] === STAGE.LARVA);
    const pupae = brood.countWhere((b) => brood.stage[b] === STAGE.PUPA);

    const rows = [
      ['Date', `${clock.monthName} ${1 + Math.floor((clock.day % 30.4))}`],
      ['Air', `${clock.airTemperature().toFixed(1)} °C`],
      ['Brood temp', `${soilTemp.sample(broodChambers[0].x, broodChambers[0].y).toFixed(1)} °C`],
      ['Workers', ants.countWhere((i) => ants.caste[i] === 0)],
      ['Outside', foragingOut],
      ['Carrying food', laden],
      ['Tending brood', nursing],
      ['Brood', `${eggs} / ${larvae} / ${pupae}`],
      ['Honeydew', `${stores.get('sugar').toFixed(0)} mg`],
      ['Trail total', trail.total().toFixed(0)],
      ['Trips home', runtime.tripsCompleted],
      ['Winged queens', `${runtime.alatesReared} / ${goal.target}`],
    ];
    if (goal.outcome) rows.push([goal.outcome === 'success' ? 'Outcome' : 'Colony lost', goal.reason]);
    return rows;
  }

  function describe(wx, wy, which) {
    const inNest = which === 'nest' ? 1 : 0;
    const radius = inNest ? 0.012 : 0.05;
    const i = ants.nearestTo(wx, wy, radius, (k) => ants.inNest[k] === inNest);
    if (i < 0) {
      // Nothing there — report the environment instead, which is often what you wanted.
      if (inNest) {
        return {
          title: 'Soil',
          rows: [
            ['Depth', `${((wy - NEST_SURFACE_Y) * 100).toFixed(1)} cm`],
            ['Temperature', `${soilTemp.sample(wx, wy).toFixed(1)} °C`],
            ['Brood optimum', `${params.broodOptimumC} °C`],
          ],
        };
      }
      return {
        title: 'Ground',
        rows: [
          ['Trail pheromone', trail.sample(wx, wy).toFixed(1)],
          ['Distance to nest', `${(distance(wx, wy, entrance.x, entrance.y) * 100).toFixed(0)} cm`],
        ],
      };
    }

    const isQueen = ants.caste[i] === 1;
    const rows = [
      ['Caste', isQueen ? 'queen' : 'worker'],
      ['Age', `${ants.age[i].toFixed(0)} days`],
      ['Doing', TASK_NAMES[ants.task[i]]],
    ];
    if (!isQueen) {
      rows.push(['Role', ants.age[i] >= params.foragerAgeDays ? 'forager' : 'nest worker']);
      if (ants.load[i] > 0) {
        rows.push(['Crop', `${ants.load[i].toFixed(2)} mg`]);
        rows.push(['Source quality', `${(ants.loadQuality[i] * 100).toFixed(0)}% sugar`]);
      }
      if (!ants.inNest[i]) {
        rows.push(['Trail here', trail.sample(ants.x[i], ants.y[i]).toFixed(1)]);
        const home = Math.hypot(ants.hx[i], ants.hy[i]);
        rows.push(['Reckons home is', `${(home * 100).toFixed(0)} cm away`]);
      }
    }
    return { title: isQueen ? 'Queen' : `Worker #${ants.id[i]}`, rows };
  }

  /* ------------------------------------------------------------ interaction */

  function applyTool(wx, wy, which) {
    if (which !== 'field') return;
    if (view.tool === 'food') addPatch(wx, wy);
    else if (view.tool === 'barrier') barriers.disc(wx, wy, 0.035, SOLID);
    else if (view.tool === 'clear') barriers.disc(wx, wy, 0.06, OPEN);
  }

  const toolIsDragging = () => view.tool === 'barrier' || view.tool === 'clear';

  /**
   * The Deneubourg apparatus: two routes from the nest to one food source, one of them longer.
   * No ant can see both. The colony still ends up on the short one.
   */
  function doubleBridgePreset() {
    barriers.rect(0, 0, fb.w, fb.h, OPEN);
    patches.length = 0;
    trail.clear();

    const wall = (x0, y0, x1, y1) => barriers.line(x0, y0, x1, y1, 0.02, SOLID);
    const midY = fb.h * 0.5;

    // A corridor from the nest to the fork.
    wall(entrance.x + 0.06, midY - 0.07, entrance.x + 0.30, midY - 0.07);
    wall(entrance.x + 0.06, midY + 0.07, entrance.x + 0.30, midY + 0.07);

    // The short branch runs straight; the long one detours.
    wall(entrance.x + 0.30, midY - 0.07, fb.w * 0.86, midY - 0.07);
    wall(entrance.x + 0.30, midY + 0.07, entrance.x + 0.42, midY + 0.34);
    wall(entrance.x + 0.42, midY + 0.34, fb.w * 0.86, midY + 0.34);
    wall(fb.w * 0.86, midY + 0.34, fb.w * 0.86, midY - 0.07);

    // A dividing wall so the two branches are genuinely separate routes.
    wall(entrance.x + 0.34, midY - 0.02, fb.w * 0.80, midY - 0.02);
    wall(entrance.x + 0.34, midY - 0.02, entrance.x + 0.46, midY + 0.28);
    wall(entrance.x + 0.46, midY + 0.28, fb.w * 0.80, midY + 0.28);

    addPatch(fb.w * 0.90, midY + 0.13, { quality: 0.95, amount: 4000 });
  }

  function controls() {
    return [
      el('div', { style: { fontSize: '12px', color: 'var(--ink-dim)', marginBottom: '6px' }, text: 'Overlay' }),
      chipGroup(
        [{ id: 'none', label: 'Natural' }, { id: 'pheromone', label: 'Pheromone' }, { id: 'temperature', label: 'Soil temp' }],
        { value: view.overlay, onChange: (v) => { view.overlay = v; } },
      ),

      el('div', { style: { fontSize: '12px', color: 'var(--ink-dim)', margin: '11px 0 6px' }, text: 'Long-press the ground to' }),
      chipGroup(
        [{ id: 'food', label: 'Add aphids' }, { id: 'barrier', label: 'Draw wall' }, { id: 'clear', label: 'Erase wall' }],
        { value: view.tool, onChange: (v) => { view.tool = v; } },
      ),

      el('div.row', { style: { marginTop: '11px' } },
        el('button.grow', {
          type: 'button', text: 'Double bridge', title: 'Recreate the Deneubourg apparatus',
          onclick: doubleBridgePreset,
        }),
        el('button.grow', {
          type: 'button', text: 'Rain', title: 'Wash the trails off the ground',
          onclick: () => { runtime.raining = true; runtime.rainTimer = 6; },
        }),
      ),

      slider('Trail half-life (min)', {
        min: 2, max: 120, step: 1, value: params.trailHalfLife,
        format: (v) => `${v}`,
        onInput: (v) => { params.trailHalfLife = v; trail.halfLifeMinutes = v; },
      }),
      slider('Choice sharpness n', {
        min: 1, max: 6, step: 0.1, value: params.deneubourgN,
        format: (v) => v.toFixed(1),
        onInput: (v) => { params.deneubourgN = v; },
      }),
      slider('Choice threshold k', {
        min: 0.05, max: 3, step: 0.05, value: params.deneubourgK,
        format: (v) => v.toFixed(2),
        onInput: (v) => { params.deneubourgK = v; },
      }),
      slider('Brood optimum (°C)', {
        min: 18, max: 32, step: 0.5, value: params.broodOptimumC,
        format: (v) => v.toFixed(1),
        onInput: (v) => { params.broodOptimumC = v; },
      }),
      slider('Day length (s)', {
        min: 30, max: 600, step: 10, value: params.simSecondsPerDay,
        format: (v) => `${v}`,
        onInput: (v) => { params.simSecondsPerDay = v; clock.simSecondsPerDay = v; },
      }),
      toggle('Show what ants believe', {
        value: view.showHomeVectors,
        title: 'Draw each forager’s dead-reckoned vector home',
        onChange: (v) => { view.showHomeVectors = v; },
      }),
    ];
  }

  // Spin the soil profile up to equilibrium before the first tick. Without this the colony starts
  // inside a uniform block of cold earth and the brood sits below its developmental threshold for
  // the first simulated day for no reason other than how the field was initialised.
  for (let k = 0; k < 240; k++) stepSoilTemperature(0.5);

  /**
   * A colony in May has been foraging for weeks, so it starts with one trail already running to
   * one aphid colony — and with the second still undiscovered, so recruitment to it can be watched
   * happening from nothing.
   */
  (function establishFirstTrail() {
    const patch = patches[0];
    const steps = 90;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = entrance.x + (patch.x - entrance.x) * t;
      const y = entrance.y + (patch.y - entrance.y) * t;
      // Laid the way a returning forager lays it: heaviest at the food end.
      trail.deposit(x + rng.range(-0.01, 0.01), y + rng.range(-0.01, 0.01), 6 + 34 * t);
    }
    patch.discovered = true;

    // Put some of the workforce on it, spread along its length and already carrying.
    let placed = 0;
    for (let i = 0; i < ants.highWater && placed < 22; i++) {
      if (!ants.alive[i] || ants.caste[i] !== 0 || ants.age[i] < params.foragerAgeDays) continue;
      const t = rng();
      leaveNest(i);
      ants.x[i] = entrance.x + (patch.x - entrance.x) * t + rng.range(-0.03, 0.03);
      ants.y[i] = entrance.y + (patch.y - entrance.y) * t + rng.range(-0.03, 0.03);
      ants.px[i] = ants.x[i];
      ants.py[i] = ants.y[i];
      if (rng.chance(0.5)) {
        // Heading home with a crop full of honeydew, laying as she goes.
        ants.task[i] = TASK.RETURNING;
        ants.load[i] = rng.range(0.6, 1.4);
        ants.loadQuality[i] = patch.quality;
        ants.hx[i] = entrance.x - ants.x[i];
        ants.hy[i] = entrance.y - ants.y[i];
        ants.heading[i] = bearing(ants.x[i], ants.y[i], entrance.x, entrance.y);
      } else {
        ants.task[i] = TASK.TRAIL;
        ants.heading[i] = bearing(ants.x[i], ants.y[i], patch.x, patch.y);
      }
      placed++;
    }
  }());

  return {
    meta, PARAMS, NOTES,
    step, renderField, renderNest, stats, describe, controls, applyTool, toolIsDragging,
    // Exposed for tests and for the headless verification harness.
    _internals: {
      ants, brood, trail, soil, soilTemp, clock, stores, goal, patches, runtime, params, entrance,
      chambers, broodChambers, corpses,
      // Exposed so tests can measure the recruitment decision itself rather than inferring it from
      // where ants happen to be standing.
      chooseDepartureHeading,
    },
  };
}
