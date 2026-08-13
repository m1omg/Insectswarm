// Honey bee hive — Apis mellifera.
//
// Two mechanisms are on display, and they are quite unlike the ants'.
//
// The first is the waggle dance: a returning forager encodes the distance to a flower patch as the
// duration of her waggle run and its direction as the angle of that run away from vertical, where
// vertical stands for the direction of the sun. It is symbolic — the dancer is not leading anyone
// anywhere, she is describing a place. Because the reference is the sun and the sun moves, a dance
// for the same patch points somewhere different in the evening than it did in the morning, and the
// bees re-reference it continuously.
//
// The second is quieter and, for the colony's economics, more important: a forager who comes home
// does not store her own nectar. She hands it to a receiver, and how long she waits to find one
// tells her whether the colony's bottleneck is out in the field or here in the hive. Waiting a
// short time means receivers are idle and more foragers would help, so she waggle dances. Waiting
// a long time means the hive cannot keep up with what is already arriving, so she tremble dances
// instead, which recruits receivers and suppresses foraging. Nobody counts anything. The queue
// length is the signal.

import { createPool, MOTION_SCHEMA } from '../../engine/agents.js';
import { Field } from '../../engine/field.js';
import { SpatialHash } from '../../engine/spatial.js';
import { SpriteAtlas, drawPopulation, paintInsect, paintCarrying, drawWorldLabel } from '../../engine/render.js';
import { FieldOverlay, RAMPS, drawLegend } from '../../engine/overlays.js';
import { el, slider, toggle, chipGroup } from '../../engine/ui.js';
import {
  SeasonClock, Stores, SurvivalGoal, createBroodPool, advanceBrood, developmentRate, STAGE,
} from '../colony.js';
import {
  wrapAngle, angleDiff, turnToward, wanderTurn, storePrevious, distance, bearing, TAU,
} from '../behaviour.js';

export const meta = {
  id: 'honeybees',
  name: 'Bee hive',
  glyph: '🐝',
  species: 'Apis mellifera',
  blurb: 'A symbolic language and a queue. Foragers dance the distance and compass bearing of '
       + 'flowers, and decide whether to dance at all from how long they waited to be unloaded.',
  fieldBounds: { x: 0, y: 0, w: 1600, h: 1200 },     // metres of landscape
  nestBounds: { x: 0, y: 0, w: 0.44, h: 0.34 },      // one comb face, metres
  fieldLabel: 'Foraging landscape',
  nestLabel: 'Comb cutaway',
};

export const PARAMS = {
  waggleSecondsPerKm: {
    value: 1.0, unit: 's/km', label: 'Dance seconds per km', min: 0.4, max: 2.5,
    source: 'Waggle run duration rises with distance at roughly 1 s per km. The relationship is '
          + 'better fitted by two straight segments meeting near 1 km than by one line '
          + '(non-linear waggle duration functions, PMC8029670).',
  },
  danceAngleScatter: {
    value: 13, unit: '°', label: 'Dance angular scatter', min: 0, max: 40,
    source: 'Successive waggle runs vary by roughly 10-15° about their mean, so recruits arrive '
          + 'spread around the patch rather than on it. The scatter is thought to spread a colony '
          + 'across a flower patch rather than being simple error.',
  },
  danceDistanceError: {
    value: 0.11, unit: 'fraction',
    source: 'tuned — recruits overshoot and undershoot; the odometer is known to be imprecise and '
          + 'somewhat miscalibrated (arXiv 2405.12998).',
  },
  waggleDelayThreshold: {
    value: 20, unit: 's', label: 'Waggle if unloaded within', min: 5, max: 60,
    source: 'Seeley: a forager unloaded in under ~20 s treats receivers as idle and waggle dances.',
  },
  trembleDelayThreshold: {
    value: 50, unit: 's', label: 'Tremble if waiting beyond', min: 20, max: 150,
    source: 'Seeley: waiting beyond ~50 s to be unloaded triggers the tremble dance, which recruits '
          + 'more receivers and damps further foraging. Between 20 and 50 s she simply waits.',
  },
  broodNestC: {
    value: 35, unit: '°C', label: 'Brood nest target', min: 28, max: 38,
    source: 'The brood nest is held at 34.5-35.5 °C, among the most tightly regulated temperatures '
          + 'in any animal society.',
  },
  flightSpeed: {
    value: 6.5, unit: 'm/s',
    source: 'Foraging flight is around 6-7 m/s (roughly 25 km/h) in still air.',
  },
  cropCapacity: {
    value: 40, unit: 'mg',
    source: 'A honey stomach holds around 40 mg of nectar, close to half the bee’s body mass.',
  },
  eggDays: { value: 3, unit: 'd', source: 'Worker egg stage is 3 days at brood-nest temperature.' },
  larvaDays: { value: 6, unit: 'd', source: 'Worker larval stage is about 6 days before capping.' },
  pupaDays: { value: 12, unit: 'd', source: 'Capped pupal stage is about 12 days; 21 days egg to adult.' },
  forageAgeDays: {
    value: 21, unit: 'd', label: 'Age at first foraging', min: 10, max: 30,
    source: 'Age polyethism: cleaning to about day 2, nursing to day 11, receiving and comb building '
          + 'to day 17, guarding to day 20, foraging from about day 21.',
  },
  danceFollowerAgeDays: {
    value: 8, unit: 'd',
    source: 'Bees younger than about 8 days do not follow dances.',
  },
  simSecondsPerDay: {
    value: 150, unit: 's/day', label: 'Day length', min: 40, max: 600,
    source: 'tuned — display compression, as in the other colonies.',
  },
};

export const NOTES = [
  {
    text: 'The waggle run is a sentence with two words. Its duration says how far — about a second '
        + 'per kilometre — and its angle away from straight up says which way, measured from the '
        + 'sun rather than from north. Tap a dancer to read what she is currently saying.',
    source: 'von Frisch (1967); duration-distance fits from PMC8029670.',
  },
  {
    text: 'Because the reference direction is the sun, and the sun moves about 15° an hour, a dance '
        + 'for one patch rotates across the day. Watch a dancer through a simulated afternoon and '
        + 'her run angle turns while the flowers stay where they are. Bees re-reference '
        + 'continuously, which is why the instruction stays correct.',
    source: 'von Frisch (1967); sun azimuth modelled from date and latitude.',
  },
  {
    text: 'Successive waggle runs disagree with each other by 10-15°, so followers arrive spread '
        + 'around the target rather than on top of it. This looks like sloppiness and may not be: a '
        + 'flower patch is an area, and scatter spreads the colony across it.',
    source: 'Dance angular divergence; see Tanner & Visscher and later work.',
  },
  {
    text: 'The regulation loop is the part people miss. A forager cannot store her own nectar — she '
        + 'must find a receiver. Unloaded inside 20 seconds, she waggle dances and brings more '
        + 'foragers. Kept waiting beyond 50 seconds, she tremble dances instead, which recruits '
        + 'more receivers and damps foraging. The length of a queue nobody measures is what balances '
        + 'the colony’s workforce.',
    source: 'Seeley (1992, 1995), The Wisdom of the Hive.',
  },
  {
    text: 'The stop signal is the negative half of the same system: a brief vibration delivered to '
        + 'dancers advertising a place that turned out to be crowded or dangerous. Recruitment in a '
        + 'hive has a brake as well as an accelerator.',
    source: 'Nieh (2010); see also the anti-waggle dance review, Front. Ecol. Evol. 3:14.',
  },
  {
    text: 'The brood nest is held between about 34.5 and 35.5 °C. Below it, bees uncouple their '
        + 'flight muscles and shiver; above it they fan, and water foragers are recruited so that '
        + 'evaporation can carry the heat away. Chilled brood develops slowly and emerges damaged.',
    source: 'Brood nest thermoregulation; see Tautz and Seeley.',
  },
  {
    text: 'This hive is a few hundred bees rather than the twenty to fifty thousand of a real summer '
        + 'colony — enough to show the mechanisms without asking a phone to draw a stadium crowd. '
        + 'Rates per bee are real; totals are not.',
    source: 'Simulation scale note.',
  },
];

/* --------------------------------------------------------------- dance maths */

/**
 * Distance in metres to waggle-run duration in seconds.
 *
 * Two straight segments meeting at 1 km fit the published data better than a single line: the
 * slope is shallower beyond a kilometre, so the dance compresses long distances.
 */
export function waggleDuration(metres, secondsPerKm = 1.0) {
  const perMetre = secondsPerKm / 1000;
  const base = 0.15;                       // the run has a floor even for very near food
  if (metres <= 1000) return base + metres * perMetre;
  return base + 1000 * perMetre + (metres - 1000) * perMetre * 0.75;
}

/** The inverse, which is what a follower has to do. */
export function waggleDistance(seconds, secondsPerKm = 1.0) {
  const perMetre = secondsPerKm / 1000;
  const base = 0.15;
  const atOneKm = base + 1000 * perMetre;
  if (seconds <= atOneKm) return Math.max(0, (seconds - base) / perMetre);
  return 1000 + (seconds - atOneKm) / (perMetre * 0.75);
}

/**
 * The angle a dancer walks on the vertical comb, measured clockwise from straight up.
 *
 * Straight up means "fly towards the sun". So the run angle is the bearing to the food minus the
 * sun's azimuth — and since the azimuth changes through the day, the same patch is danced at a
 * different angle each hour.
 */
export function danceAngleFor(bearingToPatch, sunAzimuth) {
  return wrapAngle(bearingToPatch - sunAzimuth);
}

/** What a follower makes of it: the reverse translation, done against the sun as it is now. */
export function bearingFromDance(danceAngle, sunAzimuth) {
  return wrapAngle(danceAngle + sunAzimuth);
}

/* --------------------------------------------------------------------- tasks */

const TASK = {
  CLEAN: 0,
  NURSE: 1,
  RECEIVE: 2,        // food storer, waiting to take nectar from a forager
  BUILD: 3,
  GUARD: 4,
  IDLE: 5,
  UNLOAD_WAIT: 6,    // home with a full crop, looking for a receiver
  WAGGLE: 7,
  TREMBLE: 8,
  FOLLOW: 9,         // on the dance floor, reading a dance
  OUTBOUND: 10,
  AT_FLOWERS: 11,
  HOMEBOUND: 12,
  FAN: 13,
  SHIVER: 14,
  TAKING_NECTAR: 15, // a receiver in the act of accepting a load
};

const TASK_NAMES = [
  'cleaning cells', 'feeding larvae', 'waiting to take nectar', 'building comb', 'guarding',
  'idle', 'looking for a receiver', 'waggle dancing', 'tremble dancing', 'following a dance',
  'flying to flowers', 'at the flowers', 'flying home', 'fanning', 'shivering to warm the brood',
  'taking a load of nectar',
];

export function create(world, rng) {
  const params = Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, v.value]));

  const clock = new SeasonClock({
    simSecondsPerDay: params.simSecondsPerDay,
    startDay: 165.35,       // mid-June, mid-morning: peak forage, long days
    latitude: 51,
  });

  const fb = meta.fieldBounds;
  const nb = meta.nestBounds;

  const entrance = { x: fb.w * 0.5, y: fb.h * 0.82 };   // the hive, out in the landscape

  // Inside the comb: the entrance is at the bottom, the dance floor just inside it, brood in the
  // middle, honey stored above. This is the real vertical organisation of a comb.
  const COMB = {
    entranceX: nb.w * 0.5,
    entranceY: nb.h - 0.012,
    danceFloor: { x: nb.w * 0.5, y: nb.h * 0.80, r: 0.075 },
    broodNest: { x: nb.w * 0.5, y: nb.h * 0.48, r: 0.105 },
    honeyBand: nb.h * 0.18,
  };

  /* ------------------------------------------------------------------ comb */

  // Cell contents, on a coarse grid standing in for the comb face.
  const CELL = { EMPTY: 0, HONEY: 1, POLLEN: 2, BROOD: 3 };
  const combCols = 46;
  const combRows = Math.round((combCols * nb.h) / nb.w);
  const cells = new Uint8Array(combCols * combRows);
  const cellW = nb.w / combCols;
  const cellH = nb.h / combRows;

  const cellX = (c) => (c % combCols + 0.5) * cellW;
  const cellY = (c) => (Math.floor(c / combCols) + 0.5) * cellH;

  function seedComb() {
    for (let c = 0; c < cells.length; c++) {
      const x = cellX(c);
      const y = cellY(c);
      const inBrood = distance(x, y, COMB.broodNest.x, COMB.broodNest.y) < COMB.broodNest.r;
      if (y < COMB.honeyBand) cells[c] = rng.chance(0.7) ? CELL.HONEY : CELL.EMPTY;
      else if (inBrood && distance(x, y, COMB.broodNest.x, COMB.broodNest.y) > COMB.broodNest.r * 0.72) {
        // Pollen is stored as a ring around the brood, between it and the honey.
        cells[c] = rng.chance(0.55) ? CELL.POLLEN : CELL.EMPTY;
      } else if (inBrood) cells[c] = rng.chance(0.85) ? CELL.BROOD : CELL.EMPTY;
      else cells[c] = CELL.EMPTY;
    }
  }
  seedComb();

  /** Store nectar by filling the topmost empty cell — honey really is stored above the brood. */
  function storeHoney(grams) {
    stores.add('honey', grams);
    if (rng.chance(0.4)) {
      for (let c = 0; c < cells.length; c++) {
        if (cells[c] === CELL.EMPTY && cellY(c) < COMB.broodNest.y - COMB.broodNest.r * 0.4) {
          cells[c] = CELL.HONEY;
          break;
        }
      }
    }
  }

  /* ------------------------------------------------------------ temperature */

  // Comb temperature. Relaxes towards the outside air; the bees put the heat in themselves.
  const combTemp = new Field(nb, 44, {
    halfLifeMinutes: Infinity,
    diffusion: 0.30,
    ambient: 20,
    relaxPerMinute: 0.9,
  });

  /* ---------------------------------------------------------------- flowers */

  const patches = [];
  function addPatch(x, y, opts = {}) {
    if (patches.length >= 10) patches.shift();
    patches.push({
      x, y,
      r: opts.r ?? 45,
      // Sugar concentration drives profitability, which is what a bee is actually judging.
      quality: opts.quality ?? rng.range(0.35, 1),
      nectar: opts.nectar ?? rng.range(3000, 9000),
      dangerous: opts.dangerous ?? false,
      discovered: false,
      visitors: 0,
    });
  }
  addPatch(fb.w * 0.30, fb.h * 0.30, { quality: 0.9, nectar: 20000 });
  addPatch(fb.w * 0.78, fb.h * 0.62, { quality: 0.55, nectar: 12000 });

  /* ----------------------------------------------------------------- agents */

  const capacity = Math.max(180, Math.min(world.budget.agents, 1400));
  const bees = createPool(capacity, {
    ...MOTION_SCHEMA,
    inHive: 'u8',
    caste: 'u8',           // 0 worker, 1 queen
    crop: 'f32',           // nectar aboard, mg
    cropQuality: 'f32',
    patch: 'i32',          // which flower patch she is committed to, or -1
    // Her memory of that patch, which is what she dances about.
    memDistance: 'f32',
    memBearing: 'f32',
    searchTime: 'f32',     // how long she spent looking for a receiver last trip
    danceTimer: 'f32',     // seconds of dancing left to perform
    waggleRun: 'f32',      // duration of one waggle run, i.e. the distance she is reporting
    partner: 'i32',        // receiver/forager she is currently transacting with
    stopSignals: 'f32',    // stop signals received recently; suppresses dancing
    homeTime: 'f32',
  });

  const brood = createBroodPool(Math.max(150, Math.round(capacity * 0.6)));
  const hiveHash = new SpatialHash(nb, 0.03, capacity);

  const stores = new Stores({ honey: 2200, pollen: 400, water: 60 });
  stores.setCapacity('honey', 16000);
  stores.setCapacity('pollen', 2500);
  stores.setCapacity('water', 400);

  const goal = new SurvivalGoal({
    label: 'honey stored for winter',
    target: 12000,
    deadline: 'by the end of the season',
  });

  const runtime = {
    waggleDances: 0,
    trembleDances: 0,
    stopSignals: 0,
    tripsHome: 0,
    recruited: 0,
    nectarCollected: 0,
    meanSearchTime: 0,
    broodReared: 0,
  };

  const view = { overlay: 'none', tool: 'flowers', showDanceReadout: true };

  /* ------------------------------------------------------------- population */

  function spawnBee(age, inHive = 1) {
    const i = bees.spawn();
    if (i < 0) return -1;
    bees.caste[i] = 0;
    bees.age[i] = age;
    bees.inHive[i] = inHive;
    bees.speed[i] = params.flightSpeed * rng.range(0.9, 1.1);
    bees.heading[i] = rng.angle();
    bees.patch[i] = -1;
    bees.partner[i] = -1;
    bees.task[i] = TASK.IDLE;

    if (inHive) {
      const spot = rng.chance(0.5) ? COMB.broodNest : COMB.danceFloor;
      bees.x[i] = spot.x + rng.range(-spot.r, spot.r) * 0.8;
      bees.y[i] = spot.y + rng.range(-spot.r, spot.r) * 0.8;
    } else {
      bees.x[i] = entrance.x;
      bees.y[i] = entrance.y;
    }
    bees.px[i] = bees.x[i];
    bees.py[i] = bees.y[i];
    return i;
  }

  const startingBees = Math.min(Math.round(capacity * 0.62), 520);
  for (let n = 0; n < startingBees; n++) {
    // A working colony's age structure: plenty of young bees, a foraging tail.
    spawnBee(Math.pow(rng(), 0.85) * 34);
  }

  const queenIndex = spawnBee(400, 1);
  bees.caste[queenIndex] = 1;
  bees.x[queenIndex] = COMB.broodNest.x;
  bees.y[queenIndex] = COMB.broodNest.y;
  bees.speed[queenIndex] = 0.004;

  for (let n = 0; n < 90; n++) {
    const b = brood.spawn();
    if (b < 0) break;
    const a = rng.angle();
    const r = Math.sqrt(rng()) * COMB.broodNest.r * 0.7;
    brood.x[b] = COMB.broodNest.x + Math.cos(a) * r;
    brood.y[b] = COMB.broodNest.y + Math.sin(a) * r;
    brood.stage[b] = rng.int(0, 2);
    brood.stageAge[b] = rng.range(0, 3);
    brood.nutrition[b] = 1;
  }

  /* ---------------------------------------------------- age polyethism roles */

  /**
   * What a bee of this age would normally be doing. Real polyethism is a tendency modulated by
   * colony need, not a timetable, so this sets a default that demand can override — a colony short
   * of receivers will press younger and older bees into the job.
   */
  function roleForAge(age) {
    if (age < 2) return TASK.CLEAN;
    if (age < 12) return TASK.NURSE;
    if (age < 18) return TASK.RECEIVE;
    if (age < params.forageAgeDays) return TASK.GUARD;
    return TASK.IDLE;            // forager: idle in the hive until she has somewhere to go
  }

  const isForagerAge = (i) => bees.age[i] >= params.forageAgeDays;

  /* ------------------------------------------------------------- the dance */

  /** Everything needed to read a dancer, for the inspector and for followers. */
  function danceContent(i) {
    const runSeconds = bees.waggleRun[i];
    const metres = waggleDistance(runSeconds, params.waggleSecondsPerKm);
    const angle = danceAngleFor(bees.memBearing[i], clock.sunAzimuth);
    return { runSeconds, metres, angle };
  }

  /** A follower's reading of a dance, complete with the error a real bee makes. */
  function readDance(dancer) {
    const { runSeconds, angle } = danceContent(dancer);

    const perceivedSeconds = runSeconds * (1 + rng.normal(0, params.danceDistanceError));
    const metres = Math.max(20, waggleDistance(perceivedSeconds, params.waggleSecondsPerKm));

    const scatter = (params.danceAngleScatter * Math.PI) / 180;
    const perceivedAngle = angle + rng.normal(0, scatter);

    // She translates back against the sun as it is at the moment she leaves.
    const bearingOut = bearingFromDance(perceivedAngle, clock.sunAzimuth);
    return { metres, bearingOut };
  }

  function startWaggleDance(i, seconds) {
    bees.task[i] = TASK.WAGGLE;
    bees.danceTimer[i] = seconds;
    bees.waggleRun[i] = waggleDuration(bees.memDistance[i], params.waggleSecondsPerKm);
    runtime.waggleDances++;
  }

  function startTrembleDance(i, seconds) {
    bees.task[i] = TASK.TREMBLE;
    bees.danceTimer[i] = seconds;
    runtime.trembleDances++;
  }

  /* ------------------------------------------------------------- behaviour */

  function stepFieldBee(i, dt) {
    bees.taskTime[i] += dt;

    switch (bees.task[i]) {
      case TASK.OUTBOUND: {
        const targetX = bees.x[i] + Math.cos(bees.memBearing[i]);
        const targetY = bees.y[i] + Math.sin(bees.memBearing[i]);
        bees.heading[i] = turnToward(bees.heading[i], bearing(bees.x[i], bees.y[i], targetX, targetY), 3 * dt);
        flyForward(i, dt);

        // Has she flown the distance the dance told her? Then look around for flowers.
        const flown = distance(bees.x[i], bees.y[i], entrance.x, entrance.y);
        if (flown >= bees.memDistance[i] * 0.92) {
          const p = patchNear(bees.x[i], bees.y[i], 70);
          if (p >= 0) {
            bees.patch[i] = p;
            patches[p].discovered = true;
            bees.task[i] = TASK.AT_FLOWERS;
            bees.taskTime[i] = 0;
          } else {
            // Nothing here. Cast about locally, then give up and go home empty.
            bees.heading[i] += wanderTurn(rng, 1.4, dt);
            if (bees.taskTime[i] > 90) headHome(i);
          }
        }
        if (bees.taskTime[i] > 240) headHome(i);
        break;
      }

      case TASK.AT_FLOWERS: {
        const p = bees.patch[i];
        const patch = patches[p];
        if (!patch || patch.nectar <= 0) { headHome(i); break; }

        // Stay over the patch while loading.
        bees.heading[i] = turnToward(bees.heading[i], bearing(bees.x[i], bees.y[i], patch.x, patch.y), 4 * dt);
        bees.speed[i] = params.flightSpeed * 0.18;
        flyForward(i, dt);

        const drawn = Math.min(patch.nectar, 9 * dt);
        patch.nectar -= drawn;
        bees.crop[i] += drawn;
        bees.cropQuality[i] = patch.quality;

        if (bees.crop[i] >= params.cropCapacity || patch.nectar <= 0) {
          bees.memDistance[i] = distance(patch.x, patch.y, entrance.x, entrance.y);
          bees.memBearing[i] = bearing(entrance.x, entrance.y, patch.x, patch.y);
          headHome(i);
        }
        break;
      }

      case TASK.HOMEBOUND:
      default: {
        bees.speed[i] = params.flightSpeed;
        bees.heading[i] = turnToward(bees.heading[i], bearing(bees.x[i], bees.y[i], entrance.x, entrance.y), 4 * dt);
        flyForward(i, dt);
        if (distance(bees.x[i], bees.y[i], entrance.x, entrance.y) < 12) enterHive(i);
        break;
      }
    }
  }

  function flyForward(i, dt) {
    const step = bees.speed[i] * dt;
    bees.x[i] = Math.min(fb.w - 1, Math.max(1, bees.x[i] + Math.cos(bees.heading[i]) * step));
    bees.y[i] = Math.min(fb.h - 1, Math.max(1, bees.y[i] + Math.sin(bees.heading[i]) * step));
  }

  function headHome(i) {
    bees.task[i] = TASK.HOMEBOUND;
    bees.speed[i] = params.flightSpeed;
    bees.taskTime[i] = 0;
  }

  function patchNear(x, y, radius) {
    for (let p = 0; p < patches.length; p++) {
      const patch = patches[p];
      if (patch.nectar <= 0) continue;
      if (distance(x, y, patch.x, patch.y) < patch.r + radius) return p;
    }
    return -1;
  }

  function enterHive(i) {
    bees.inHive[i] = 1;
    bees.x[i] = COMB.entranceX + rng.range(-0.01, 0.01);
    bees.y[i] = COMB.entranceY;
    bees.px[i] = bees.x[i];
    bees.py[i] = bees.y[i];
    bees.speed[i] = 0.012;
    bees.homeTime[i] = 0;
    runtime.tripsHome++;

    if (bees.crop[i] > 0) {
      // She cannot store it herself. She has to find someone to give it to, and the wait is the
      // signal that decides what she does next.
      bees.task[i] = TASK.UNLOAD_WAIT;
      bees.searchTime[i] = 0;
      bees.taskTime[i] = 0;
    } else {
      bees.task[i] = TASK.IDLE;
    }
  }

  function leaveHive(i) {
    bees.inHive[i] = 0;
    bees.x[i] = entrance.x;
    bees.y[i] = entrance.y;
    bees.px[i] = bees.x[i];
    bees.py[i] = bees.y[i];
    bees.speed[i] = params.flightSpeed;
    bees.heading[i] = bees.memBearing[i];
    bees.task[i] = TASK.OUTBOUND;
    bees.taskTime[i] = 0;
    bees.crop[i] = 0;
  }

  /** Move about inside the hive, staying on the comb. */
  function crawl(i, dt, tx, ty, wander = 0.9) {
    bees.heading[i] = turnToward(bees.heading[i], bearing(bees.x[i], bees.y[i], tx, ty), 6 * dt);
    bees.heading[i] += wanderTurn(rng, wander, dt);
    const step = bees.speed[i] * dt;
    bees.x[i] = Math.min(nb.w - 0.004, Math.max(0.004, bees.x[i] + Math.cos(bees.heading[i]) * step));
    bees.y[i] = Math.min(nb.h - 0.004, Math.max(0.004, bees.y[i] + Math.sin(bees.heading[i]) * step));
    return distance(bees.x[i], bees.y[i], tx, ty);
  }

  function stepHiveBee(i, dt) {
    bees.taskTime[i] += dt;
    bees.homeTime[i] += dt;
    bees.stopSignals[i] *= Math.exp(-dt * 0.05);

    if (bees.caste[i] === 1) {
      crawl(i, dt, COMB.broodNest.x + rng.range(-0.03, 0.03), COMB.broodNest.y + rng.range(-0.03, 0.03), 0.4);
      return;
    }

    switch (bees.task[i]) {
      case TASK.UNLOAD_WAIT: {
        bees.searchTime[i] += dt;
        crawl(i, dt, COMB.danceFloor.x + rng.range(-0.03, 0.03), COMB.danceFloor.y, 1.4);

        // Look for a food storer who is free to take the load.
        const receiver = hiveHash.nearest(bees.x, bees.y, bees.x[i], bees.y[i], 0.022,
          (k) => bees.alive[k] && bees.inHive[k] && bees.task[k] === TASK.RECEIVE && bees.partner[k] < 0 && k !== i);

        if (receiver >= 0) {
          bees.partner[i] = receiver;
          bees.partner[receiver] = i;
          bees.task[receiver] = TASK.TAKING_NECTAR;
          bees.taskTime[receiver] = 0;
          finishUnloading(i);
          break;
        }

        // The decision to tremble is made while still searching, not afterwards. A forager who has
        // spent this long looking has learned what she needs to know — the hive cannot keep up —
        // and she starts recruiting receivers there and then, crop still full. Waiting to be
        // unloaded first would mean a colony that has entirely run out of receivers could never
        // call for more, which is the opposite of what the signal is for.
        if (bees.searchTime[i] > params.trembleDelayThreshold) {
          runtime.meanSearchTime += (bees.searchTime[i] - runtime.meanSearchTime) * 0.05;
          startTrembleDance(i, 25 + rng.range(0, 30));
        }
        break;
      }

      case TASK.TAKING_NECTAR: {
        // Trophallaxis takes a few seconds; then the receiver goes off to store it.
        if (bees.taskTime[i] > 4) {
          bees.partner[i] = -1;
          bees.task[i] = TASK.RECEIVE;
          bees.taskTime[i] = 0;
        }
        crawl(i, dt, COMB.danceFloor.x, COMB.danceFloor.y - 0.02, 0.8);
        break;
      }

      case TASK.WAGGLE: {
        bees.danceTimer[i] -= dt;
        // She walks the figure of eight on the dance floor.
        crawl(i, dt, COMB.danceFloor.x, COMB.danceFloor.y, 2.2);
        if (bees.danceTimer[i] <= 0 || bees.stopSignals[i] > 3) {
          bees.task[i] = TASK.IDLE;
          bees.taskTime[i] = 0;
          if (bees.stopSignals[i] > 3) bees.patch[i] = -1;   // talked out of it
        }
        break;
      }

      case TASK.TREMBLE: {
        bees.danceTimer[i] -= dt;
        // The tremble dancer walks all over the comb rather than staying on the dance floor, which
        // is how she reaches bees who could become receivers.
        crawl(i, dt, rng.range(0.05, nb.w - 0.05), rng.range(0.15, nb.h - 0.05), 2.6);
        recruitReceivers(i, dt);
        if (bees.danceTimer[i] <= 0) {
          // She still has the load that started all this, so she goes back to looking for someone
          // to take it — hopefully one of the bees she has just talked into the job.
          bees.task[i] = bees.crop[i] > 0 ? TASK.UNLOAD_WAIT : TASK.IDLE;
          bees.searchTime[i] = 0;
          bees.taskTime[i] = 0;
        }
        break;
      }

      case TASK.FOLLOW: {
        const dancer = bees.partner[i];
        if (dancer < 0 || !bees.alive[dancer] || bees.task[dancer] !== TASK.WAGGLE) {
          bees.partner[i] = -1;
          bees.task[i] = TASK.IDLE;
          break;
        }
        crawl(i, dt, bees.x[dancer], bees.y[dancer], 1.2);
        // A few seconds of following is enough to take the message.
        if (bees.taskTime[i] > 5) {
          const { metres, bearingOut } = readDance(dancer);
          bees.memDistance[i] = metres;
          bees.memBearing[i] = bearingOut;
          bees.partner[i] = -1;
          runtime.recruited++;
          leaveHive(i);
        }
        break;
      }

      case TASK.RECEIVE: {
        // Waiting near the dance floor for an incoming forager.
        crawl(i, dt, COMB.danceFloor.x + rng.range(-0.05, 0.05), COMB.danceFloor.y + rng.range(-0.03, 0.02), 1.0);
        if (bees.taskTime[i] > 25 && rng.chance(0.02)) revertToAgeRole(i);
        break;
      }

      case TASK.NURSE: {
        crawl(i, dt, COMB.broodNest.x + rng.range(-0.06, 0.06), COMB.broodNest.y + rng.range(-0.06, 0.06), 1.1);
        if (bees.taskTime[i] > 20) considerThermoregulation(i);
        break;
      }

      case TASK.FAN: {
        crawl(i, dt, COMB.entranceX + rng.range(-0.05, 0.05), nb.h - 0.03, 0.6);
        // She stops the moment the brood nest is back in band. Committing her to a fixed stint
        // instead makes the colony overshoot wildly in both directions.
        if (broodNestTemperature() <= params.broodNestC + 0.1) revertToAgeRole(i);
        break;
      }

      case TASK.SHIVER: {
        // Uncoupled flight muscles run as a heater; a bee can hold her thorax well above air
        // temperature this way. The heat itself is accounted for in the nest's heat balance.
        crawl(i, dt, COMB.broodNest.x + rng.range(-0.05, 0.05), COMB.broodNest.y + rng.range(-0.05, 0.05), 0.5);
        if (broodNestTemperature() >= params.broodNestC - 0.1) revertToAgeRole(i);
        break;
      }

      default: {
        // Idle. Foraging-age bees look for a dance to follow or go back to a known patch.
        crawl(i, dt, COMB.danceFloor.x + rng.range(-0.08, 0.08), COMB.danceFloor.y + rng.range(-0.06, 0.06), 1.6);

        if (bees.taskTime[i] > 2) {
          bees.taskTime[i] = 0;
          if (!considerThermoregulation(i)) chooseHiveTask(i);
        }
        break;
      }
    }
  }

  /** Hand the load over, then decide what the wait means. */
  function finishUnloading(i) {
    const grams = bees.crop[i];
    storeHoney(grams * bees.cropQuality[i]);
    runtime.nectarCollected += grams;
    bees.crop[i] = 0;

    const waited = bees.searchTime[i];
    runtime.meanSearchTime += (waited - runtime.meanSearchTime) * 0.05;
    bees.partner[i] = -1;

    const patch = patches[bees.patch[i]];
    const profitability = patch ? patch.quality : 0.4;

    if (waited < params.waggleDelayThreshold) {
      // Receivers were idle: the colony can absorb more nectar. Advertise, in proportion to how
      // good the flowers were — a poor patch is not worth dancing about at all.
      if (rng.chance(profitability) && bees.memDistance[i] > 30) {
        startWaggleDance(i, 8 + profitability * 40);
      } else {
        bees.task[i] = TASK.IDLE;
      }
    } else if (waited > params.trembleDelayThreshold) {
      // The hive is the bottleneck, not the field. Recruit storers and stop advertising.
      startTrembleDance(i, 25 + rng.range(0, 30));
    } else {
      // In between she simply gets on with it.
      bees.task[i] = TASK.IDLE;
    }
    bees.taskTime[i] = 0;
  }

  /** A tremble dancer converts nearby bees into receivers. */
  function recruitReceivers(i, dt) {
    if (!rng.eventAtRate(1.5, dt)) return;
    hiveHash.forEachNear(bees.x[i], bees.y[i], 0.03, (k) => {
      if (k === i || !bees.alive[k] || !bees.inHive[k]) return;
      if (bees.task[k] !== TASK.IDLE && bees.task[k] !== TASK.NURSE) return;
      if (bees.age[k] < 8) return;
      bees.task[k] = TASK.RECEIVE;
      bees.taskTime[k] = 0;
      return false;      // one per signal
    });
  }

  /** The stop signal: a returning bee tells dancers that her patch is not worth advertising. */
  function deliverStopSignals(i) {
    hiveHash.forEachNear(bees.x[i], bees.y[i], 0.03, (k) => {
      if (k === i || !bees.alive[k] || bees.task[k] !== TASK.WAGGLE) return;
      if (bees.patch[k] !== bees.patch[i]) return;      // aimed at that place, not at dancing itself
      bees.stopSignals[k] += 1;
      runtime.stopSignals++;
    });
  }

  function revertToAgeRole(i) {
    bees.task[i] = roleForAge(bees.age[i]);
    bees.taskTime[i] = 0;
  }

  const THERMAL_DEADBAND = 0.4;

  const broodNestTemperature = () => broodTemp;

  /**
   * Heating and cooling. Below the target the bee shivers; above it she fans, and if it is really
   * hot the colony wants water rather than nectar so evaporation can do the work.
   *
   * How likely she is to join in scales with how far out of band the brood nest is. That gradation
   * matters: if every idle bee responds to every small deviation, the colony swings between 32 and
   * 46 °C instead of holding 35. A few bees answer a small error and most of the hive answers a
   * large one, which is what makes the regulation stable and is what real colonies do.
   */
  function considerThermoregulation(i) {
    const error = broodNestTemperature() - params.broodNestC;
    if (Math.abs(error) < THERMAL_DEADBAND) return false;

    const willing = Math.min(0.85, Math.abs(error) * 0.3);
    if (!rng.chance(willing)) return false;

    bees.task[i] = error < 0 ? TASK.SHIVER : TASK.FAN;
    bees.taskTime[i] = 0;
    return true;
  }

  function chooseHiveTask(i) {
    if (!isForagerAge(i)) {
      revertToAgeRole(i);
      return;
    }

    // A forager with a patch in mind and no reason to doubt it just goes.
    if (bees.patch[i] >= 0 && patches[bees.patch[i]] && patches[bees.patch[i]].nectar > 0
        && clock.isDaylight && bees.homeTime[i] > 8 && rng.chance(0.35)) {
      leaveHive(i);
      return;
    }

    // Otherwise look for a dance to follow. Bees under about 8 days do not do this.
    if (bees.age[i] >= params.danceFollowerAgeDays && clock.isDaylight) {
      const dancer = hiveHash.nearest(bees.x, bees.y, bees.x[i], bees.y[i], 0.05,
        (k) => bees.alive[k] && bees.inHive[k] && bees.task[k] === TASK.WAGGLE && k !== i);
      if (dancer >= 0 && rng.chance(0.4)) {
        bees.partner[i] = dancer;
        bees.patch[i] = bees.patch[dancer];
        bees.task[i] = TASK.FOLLOW;
        bees.taskTime[i] = 0;
        return;
      }
    }

    // A small trickle scouts on its own; without it a colony could never find anything new.
    if (clock.isDaylight && rng.chance(0.02) && bees.homeTime[i] > 20) {
      bees.memBearing[i] = rng.angle();
      bees.memDistance[i] = rng.range(120, 700);
      bees.patch[i] = -1;
      leaveHive(i);
    }
  }

  /* ------------------------------------------------------------ environment */

  /**
   * Brood nest temperature, as a lumped heat balance rather than a diffusing field.
   *
   * Temperature is not a substance you can pour into a cell. Treating it like pheromone — each bee
   * depositing heat at her own position — produced isolated spikes of several hundred degrees at
   * individual bees while the space between them sat at ambient, because diffusion cannot move heat
   * around anywhere near as fast as a cluster of bees actually does. A cluster is closer to one
   * well-mixed thermal mass, so that is what is modelled: a single temperature with gains and
   * losses, which is the standard lumped-capacitance approximation.
   *
   * The field is then painted from that scalar purely so the overlay has something to draw.
   */
  const THERMAL_LOSS_PER_SECOND = 0.0067;   // bare comb falls towards air with a ~2.5 min time constant
  const HEAT_PER_BEE = 0.004;               // °C/s added by one shivering bee
  const COOL_PER_FANNER_DRY = 0.0016;       // moving air alone is a weak cooler
  const COOL_PER_FANNER_WET = 0.0055;       // evaporating water is a far better one

  let broodTemp = 34;

  /** Shove the nest temperature, for the heat-wave tool and for tests. */
  function perturbTemperature(delta) {
    broodTemp += delta;
  }

  function stepCombTemperature(dt) {
    const air = clock.airTemperature();

    let fanners = 0;
    let shiverers = 0;
    for (let i = 0; i < bees.highWater; i++) {
      if (!bees.alive[i]) continue;
      if (bees.task[i] === TASK.FAN) fanners++;
      else if (bees.task[i] === TASK.SHIVER) shiverers++;
    }

    let cooling = 0;
    if (fanners > 0) {
      const wanted = fanners * 0.0006 * dt;
      const evaporated = stores.consume('water', wanted);
      const wet = evaporated >= wanted * 0.5;
      cooling = fanners * (wet ? COOL_PER_FANNER_WET : COOL_PER_FANNER_DRY);
    }

    // Metabolism warms the nest even when nobody is deliberately heating it.
    const metabolic = bees.count * 0.00012;
    const heating = shiverers * HEAT_PER_BEE + metabolic;

    broodTemp += ((air - broodTemp) * THERMAL_LOSS_PER_SECOND + heating - cooling) * dt;
    broodTemp = Math.min(55, Math.max(-10, broodTemp));

    paintTemperatureField(air);
  }

  /** Write a smooth profile into the field so the overlay shows the nest as bees keep it. */
  function paintTemperatureField(air) {
    const cx = COMB.broodNest.x;
    const cy = COMB.broodNest.y;
    const reach = COMB.broodNest.r * 2.1;
    for (let row = 0; row < combTemp.rows; row++) {
      for (let col = 0; col < combTemp.cols; col++) {
        const x = combTemp.bounds.x + (col + 0.5) * combTemp.cellSize;
        const y = combTemp.bounds.y + (row + 0.5) * combTemp.cellSize;
        const d = Math.hypot(x - cx, y - cy);
        // Warm core, falling away towards the edges of the comb where the air gets in.
        const share = Math.exp(-(d / reach) * (d / reach) * 1.6);
        combTemp.data[row * combTemp.cols + col] = air + (broodTemp - air) * share;
      }
    }
    combTemp.maxValue = Math.max(air, broodTemp);
  }

  function stepBrood(days) {
    const stageDays = [params.eggDays, params.larvaDays, params.pupaDays];
    const larvae = brood.countWhere((b) => brood.stage[b] === STAGE.LARVA);

    const demand = larvae * 0.02 * days;
    const fed = stores.consume('pollen', demand * 0.6) + stores.consume('honey', demand * 0.4);
    const satisfaction = demand > 0 ? Math.min(1, fed / demand) : 1;

    for (let b = 0; b < brood.highWater; b++) {
      if (!brood.alive[b]) continue;
      const t = combTemp.sample(brood.x[b], brood.y[b]);
      const rate = developmentRate(t, 20, params.broodNestC, 40);
      brood.nutrition[b] += (satisfaction - brood.nutrition[b]) * Math.min(1, days * 2);

      if (advanceBrood(brood, b, days * rate * (0.4 + 0.6 * brood.nutrition[b]), stageDays) === 'emerged') {
        brood.kill(b);
        runtime.broodReared++;
        spawnBee(0, 1);
      } else if (brood.nutrition[b] < 0.1 && rng.chance(days * 0.4)) {
        brood.kill(b);
      }
    }
  }

  function stepQueen(days) {
    if (!bees.alive[queenIndex]) return;
    // A good queen lays up to 1500-2000 eggs a day in midsummer; this colony is far smaller, and
    // laying is capped by the comb and the pollen coming in.
    const seasonal = clock.dayOfYear > 75 && clock.dayOfYear < 260 ? 1 : 0.1;
    const wellFed = Math.min(1, stores.get('pollen') / 200);
    let expected = 90 * seasonal * wellFed * days;
    while (expected > 0) {
      if (expected < 1 && !rng.chance(expected)) break;
      expected -= 1;
      const b = brood.spawn();
      if (b < 0) break;
      brood.stage[b] = STAGE.EGG;
      brood.nutrition[b] = 1;
      const a = rng.angle();
      const r = Math.sqrt(rng()) * COMB.broodNest.r * 0.75;
      brood.x[b] = COMB.broodNest.x + Math.cos(a) * r;
      brood.y[b] = COMB.broodNest.y + Math.sin(a) * r;
    }
  }

  function stepMortality(days) {
    for (let i = 0; i < bees.highWater; i++) {
      if (!bees.alive[i] || bees.caste[i] === 1) continue;
      bees.age[i] += days;
      // Summer workers live about six weeks, and foraging is what wears them out.
      const risk = bees.inHive[i] ? 0.004 : 0.02;
      const old = bees.age[i] > 42 ? 0.25 : 0;
      if (rng.chance((risk + old) * days)) bees.kill(i);
    }

    // Bees eat what they store.
    stores.consume('honey', bees.count * 0.012 * days);
  }

  function checkGoal() {
    if (goal.outcome) return;
    goal.value = stores.get('honey');
    if (!bees.alive[queenIndex]) goal.fail('The queen is dead and there is no brood to replace her.');
    else if (bees.count < 12) goal.fail('The colony dwindled away.');
    else if (stores.get('honey') >= goal.target) goal.succeed('Enough honey stored to see the colony through winter.');
    else if (clock.dayOfYear > 300) goal.fail(`Winter arrived with only ${stores.get('honey').toFixed(0)} g of honey.`);
  }

  /* --------------------------------------------------------------- stepping */

  let slowAccumulator = 0;

  function step(dt) {
    clock.step(dt);
    stepCombTemperature(dt);

    hiveHash.rebuild(bees.x, bees.y, bees.highWater, bees.alive);

    for (let i = 0; i < bees.highWater; i++) {
      if (!bees.alive[i]) continue;
      storePrevious(bees, i);
      if (bees.inHive[i]) stepHiveBee(i, dt);
      else stepFieldBee(i, dt);
    }

    // Foragers coming back from a patch that is crowded or dangerous try to talk the dancers down.
    for (let i = 0; i < bees.highWater; i++) {
      if (!bees.alive[i] || !bees.inHive[i] || bees.patch[i] < 0) continue;
      if (bees.task[i] !== TASK.IDLE && bees.task[i] !== TASK.UNLOAD_WAIT) continue;
      const patch = patches[bees.patch[i]];
      if (!patch) continue;
      const crowded = patch.visitors > 12;
      if ((patch.dangerous || crowded) && rng.eventAtRate(0.35, dt)) deliverStopSignals(i);
    }

    slowAccumulator += dt;
    if (slowAccumulator >= 0.25) {
      const days = slowAccumulator / clock.simSecondsPerDay;
      stepBrood(days);
      stepQueen(days);
      stepMortality(days);
      checkGoal();

      // Recount patch crowding for the stop-signal rule.
      for (const p of patches) p.visitors = 0;
      for (let i = 0; i < bees.highWater; i++) {
        if (bees.alive[i] && !bees.inHive[i] && bees.task[i] === TASK.AT_FLOWERS && bees.patch[i] >= 0) {
          const p = patches[bees.patch[i]];
          if (p) p.visitors++;
        }
      }
      slowAccumulator = 0;
    }
  }

  /* --------------------------------------------------------------- rendering */

  const dprScale = () => Math.min(window.devicePixelRatio || 1, 2);
  let atlases = null;
  let tempOverlay = null;

  function ensureRenderAssets() {
    if (atlases) return;
    const dpr = dprScale();
    const BODY = '#c9922f';
    const DARK = '#4a3517';

    atlases = {
      worker: new SpriteAtlas(15 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: BODY, accent: DARK, legColour: DARK, width: 0.34, wings: true,
      })),
      laden: new SpriteAtlas(15 * dpr, 24, (c, s) => {
        paintInsect(c, s, { body: BODY, accent: DARK, legColour: DARK, width: 0.34, wings: true });
        paintCarrying(c, s, '#ffd977', 0.10);
      }),
      dancer: new SpriteAtlas(16 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: '#ffd25e', accent: '#5a3f18', legColour: DARK, width: 0.36, wings: true,
      })),
      trembler: new SpriteAtlas(16 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: '#8fd0e0', accent: '#2d5766', legColour: '#2d5766', width: 0.36, wings: true,
      })),
      receiver: new SpriteAtlas(15 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: '#a8874a', accent: DARK, legColour: DARK, width: 0.34,
      })),
      queen: new SpriteAtlas(26 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: '#e0b45c', accent: '#4a3517', legColour: DARK, width: 0.34, abdomenLen: 0.52, wings: true,
      })),
    };

    tempOverlay = new FieldOverlay(combTemp, RAMPS.temperature, {
      min: 20, max: 40, gamma: 1, opacity: 0.6,
    });
  }

  function renderField(ctx, vp, alpha) {
    ensureRenderAssets();
    const b = meta.fieldBounds;

    // Summer meadow, lit by the sun's elevation.
    const light = 0.35 + 0.65 * clock.solarElevation;
    ctx.fillStyle = `rgb(${Math.round(38 * light + 12)}, ${Math.round(52 * light + 14)}, ${Math.round(30 * light + 10)})`;
    ctx.fillRect(b.x, b.y, b.w, b.h);

    // Flower patches.
    for (const patch of patches) {
      if (patch.nectar <= 0) continue;
      const strength = Math.min(1, patch.nectar / 6000);
      ctx.fillStyle = patch.dangerous ? 'rgba(180, 70, 60, 0.30)' : `rgba(150, 140, 60, ${0.15 + 0.2 * strength})`;
      ctx.beginPath();
      ctx.arc(patch.x, patch.y, patch.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = patch.dangerous ? '#c8503f' : '#e8dc82';
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU + patch.x;
        const rr = patch.r * 0.62;
        ctx.beginPath();
        ctx.arc(patch.x + Math.cos(a) * rr, patch.y + Math.sin(a) * rr, patch.r * 0.10, 0, TAU);
        ctx.fill();
      }
    }

    // The hive. Drawn well over life size: a real hive is under a metre across in a landscape
    // 1.6 km wide, which at this zoom is less than a pixel.
    ctx.fillStyle = '#7d6236';
    ctx.fillRect(entrance.x - 46, entrance.y - 36, 92, 72);
    ctx.fillStyle = '#54401f';
    ctx.fillRect(entrance.x - 46, entrance.y - 36, 92, 14);
    ctx.fillStyle = '#1a1309';
    ctx.fillRect(entrance.x - 22, entrance.y + 24, 44, 12);

    const dpr = dprScale();
    drawPopulation(ctx, vp, dpr, bees, alpha, {
      atlasFor: (i) => {
        if (bees.inHive[i]) return null;
        return bees.crop[i] > 0 ? atlases.laden : atlases.worker;
      },
      scale: 1,
      cull: 40,
    });

    // A compass rose showing where the sun is, since every dance is measured against it.
    drawSunCompass(ctx, vp, dpr);
  }

  function drawSunCompass(ctx, vp, dpr) {
    ctx.save();
    ctx.resetTransform();
    const cx = (vp.rect.x + vp.rect.w - 42) * dpr;
    const cy = (vp.rect.y + 44) * dpr;
    const r = 22 * dpr;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = '#0b0906cc';
    ctx.fill();
    ctx.strokeStyle = '#4a3f31';
    ctx.lineWidth = dpr;
    ctx.stroke();

    // Screen y grows downward and the azimuth is measured clockwise from north, which is up.
    const a = clock.sunAzimuth - Math.PI / 2;
    const sunX = cx + Math.cos(a) * r * 0.66;
    const sunY = cy + Math.sin(a) * r * 0.66;
    ctx.fillStyle = clock.isDaylight ? '#ffd25e' : '#5a6472';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 4.5 * dpr, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#6f6455';
    ctx.font = `${9 * dpr}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, cy - r + 8 * dpr);
    ctx.restore();
  }

  function renderNest(ctx, vp, alpha) {
    ensureRenderAssets();

    // The comb: wax cells, coloured by what is in them.
    for (let c = 0; c < cells.length; c++) {
      const x = cellX(c) - cellW / 2;
      const y = cellY(c) - cellH / 2;
      const content = cells[c];
      ctx.fillStyle = content === CELL.HONEY ? '#c8952f'
        : content === CELL.POLLEN ? '#b7842a'
          : content === CELL.BROOD ? '#9a7d55'
            : '#5a4a30';
      ctx.fillRect(x, y, cellW * 0.94, cellH * 0.94);
    }

    if (view.overlay === 'temperature') {
      tempOverlay.dirty = true;
      tempOverlay.draw(ctx, vp);
    }

    // Brood, drawn on top of their cells.
    for (let b = 0; b < brood.highWater; b++) {
      if (!brood.alive[b]) continue;
      const stage = brood.stage[b];
      // Kept small and muted: the brood is the backdrop the bees work against, and bright dots at
      // this density bury the bees entirely.
      ctx.fillStyle = stage === STAGE.EGG ? '#cdc3ab' : stage === STAGE.LARVA ? '#d8c896' : '#7a5c34';
      ctx.beginPath();
      ctx.arc(brood.x[b], brood.y[b], stage === STAGE.EGG ? 0.0011 : 0.0019, 0, TAU);
      ctx.fill();
    }

    // The dance floor, marked because it is where the interesting behaviour happens.
    ctx.strokeStyle = 'rgba(224, 163, 60, 0.28)';
    ctx.lineWidth = 0.0012;
    ctx.beginPath();
    ctx.arc(COMB.danceFloor.x, COMB.danceFloor.y, COMB.danceFloor.r, 0, TAU);
    ctx.stroke();

    const dpr = dprScale();
    drawPopulation(ctx, vp, dpr, bees, alpha, {
      atlasFor: (i) => {
        if (!bees.inHive[i]) return null;
        if (bees.caste[i] === 1) return atlases.queen;
        if (bees.task[i] === TASK.WAGGLE) return atlases.dancer;
        if (bees.task[i] === TASK.TREMBLE) return atlases.trembler;
        if (bees.task[i] === TASK.RECEIVE || bees.task[i] === TASK.TAKING_NECTAR) return atlases.receiver;
        return bees.crop[i] > 0 ? atlases.laden : atlases.worker;
      },
      scale: 0.44,
    });

    // Draw the waggle run of every dancer as a line on the comb: the actual message.
    if (view.showDanceReadout) {
      ctx.lineWidth = 0.0016;
      for (let i = 0; i < bees.highWater; i++) {
        if (!bees.alive[i] || !bees.inHive[i] || bees.task[i] !== TASK.WAGGLE) continue;
        const { angle, runSeconds } = danceContent(i);
        // Straight up the comb is the direction of the sun; the run leans away from it by `angle`.
        const len = Math.min(0.05, 0.012 + runSeconds * 0.014);
        const dx = Math.sin(angle) * len;
        const dy = -Math.cos(angle) * len;
        ctx.strokeStyle = 'rgba(255, 210, 94, 0.75)';
        ctx.beginPath();
        ctx.moveTo(bees.x[i] - dx / 2, bees.y[i] - dy / 2);
        ctx.lineTo(bees.x[i] + dx / 2, bees.y[i] + dy / 2);
        ctx.stroke();
      }
      // "Up the comb means towards the sun" needs saying, or the run angles mean nothing. Drawn in
      // screen space at the top of the pane so it never disappears behind the comb.
      ctx.save();
      ctx.resetTransform();
      const label = '↑ up the comb = towards the sun';
      ctx.font = `${10 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      const width = ctx.measureText(label).width + 12 * dpr;
      const lx = (vp.rect.x + vp.rect.w / 2) * dpr;
      const ly = (vp.rect.y + 48) * dpr;    // clear of the pane's own badge
      ctx.fillStyle = '#0b0906cc';
      ctx.fillRect(lx - width / 2, ly - 9 * dpr, width, 18 * dpr);
      ctx.fillStyle = '#e0a33c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly);
      ctx.restore();
    }

    if (view.overlay === 'temperature') {
      drawLegend(ctx, dpr, vp.rect, {
        title: 'comb temperature',
        ramp: RAMPS.temperature,
        minLabel: '20°C',
        maxLabel: '40°C',
      });
    }
  }

  /* ------------------------------------------------------------------ panel */

  function stats() {
    let foraging = 0;
    let dancing = 0;
    let trembling = 0;
    let receivers = 0;
    let waiting = 0;
    for (let i = 0; i < bees.highWater; i++) {
      if (!bees.alive[i]) continue;
      if (!bees.inHive[i]) foraging++;
      switch (bees.task[i]) {
        case TASK.WAGGLE: dancing++; break;
        case TASK.TREMBLE: trembling++; break;
        case TASK.RECEIVE: case TASK.TAKING_NECTAR: receivers++; break;
        case TASK.UNLOAD_WAIT: waiting++; break;
        default: break;
      }
    }

    const rows = [
      ['Date', `${clock.monthName} ${1 + Math.floor(clock.day % 30.4)}`],
      ['Time', `${String(Math.floor(clock.hour)).padStart(2, '0')}:${String(Math.floor((clock.hour % 1) * 60)).padStart(2, '0')}`],
      ['Air', `${clock.airTemperature().toFixed(1)} °C`],
      ['Brood nest', `${combTemp.sample(COMB.broodNest.x, COMB.broodNest.y).toFixed(1)} °C`],
      ['Bees', bees.count],
      ['Out foraging', foraging],
      ['Waggle dancing', dancing],
      ['Tremble dancing', trembling],
      ['Receivers', receivers],
      ['Queueing to unload', waiting],
      ['Mean unload wait', `${runtime.meanSearchTime.toFixed(1)} s`],
      ['Brood', brood.count],
      ['Honey', `${stores.get('honey').toFixed(0)} g`],
      ['Dances / stop signals', `${runtime.waggleDances} / ${runtime.stopSignals}`],
      ['Recruited', runtime.recruited],
    ];
    if (goal.outcome) rows.push([goal.outcome === 'success' ? 'Outcome' : 'Colony lost', goal.reason]);
    return rows;
  }

  function describe(wx, wy, which) {
    const inHive = which === 'nest' ? 1 : 0;
    const radius = inHive ? 0.012 : 40;
    const i = bees.nearestTo(wx, wy, radius, (k) => bees.inHive[k] === inHive);

    if (i < 0) {
      if (inHive) {
        return {
          title: 'Comb',
          rows: [
            ['Temperature', `${combTemp.sample(wx, wy).toFixed(1)} °C`],
            ['Brood target', `${params.broodNestC} °C`],
          ],
        };
      }
      return {
        title: 'Landscape',
        rows: [
          ['From hive', `${distance(wx, wy, entrance.x, entrance.y).toFixed(0)} m`],
          ['Bearing', `${((bearing(entrance.x, entrance.y, wx, wy) * 180 / Math.PI + 360) % 360).toFixed(0)}°`],
          ['Sun azimuth', `${((clock.sunAzimuth * 180 / Math.PI) % 360).toFixed(0)}°`],
        ],
      };
    }

    if (bees.caste[i] === 1) {
      return { title: 'Queen', rows: [['Age', `${bees.age[i].toFixed(0)} days`], ['Doing', 'laying eggs']] };
    }

    const rows = [
      ['Age', `${bees.age[i].toFixed(1)} days`],
      ['Normally', TASK_NAMES[roleForAge(bees.age[i])]],
      ['Doing', TASK_NAMES[bees.task[i]]],
    ];

    if (bees.crop[i] > 0) rows.push(['Crop', `${bees.crop[i].toFixed(1)} mg`]);
    if (bees.task[i] === TASK.UNLOAD_WAIT) {
      rows.push(['Waiting', `${bees.searchTime[i].toFixed(1)} s`]);
      rows.push(['Will', bees.searchTime[i] < params.waggleDelayThreshold ? 'waggle dance'
        : bees.searchTime[i] > params.trembleDelayThreshold ? 'tremble dance' : 'just carry on']);
    }

    if (bees.task[i] === TASK.WAGGLE) {
      const d = danceContent(i);
      rows.push(['Waggle run', `${d.runSeconds.toFixed(2)} s`]);
      rows.push(['Means', `${d.metres.toFixed(0)} m away`]);
      rows.push(['Run angle', `${(d.angle * 180 / Math.PI).toFixed(0)}° from vertical`]);
      rows.push(['Which is', `${((bees.memBearing[i] * 180 / Math.PI + 360) % 360).toFixed(0)}° true`]);
      rows.push(['Stop signals', bees.stopSignals[i].toFixed(1)]);
    }

    if (bees.memDistance[i] > 0 && bees.task[i] !== TASK.WAGGLE) {
      rows.push(['Knows a patch', `${bees.memDistance[i].toFixed(0)} m away`]);
    }

    return { title: `Worker #${bees.id[i]}`, rows };
  }

  /* ------------------------------------------------------------ interaction */

  function applyTool(wx, wy, which) {
    if (which !== 'field') return;
    if (view.tool === 'flowers') addPatch(wx, wy, { quality: rng.range(0.5, 1), nectar: 9000 });
    else if (view.tool === 'rich') addPatch(wx, wy, { quality: 1, nectar: 26000, r: 55 });
    else if (view.tool === 'danger') {
      const p = patchNear(wx, wy, 80);
      if (p >= 0) patches[p].dangerous = !patches[p].dangerous;
    }
  }

  function controls() {
    return [
      el('div', { style: { fontSize: '12px', color: 'var(--ink-dim)', marginBottom: '6px' }, text: 'Overlay' }),
      chipGroup(
        [{ id: 'none', label: 'Natural' }, { id: 'temperature', label: 'Comb temp' }],
        { value: view.overlay, onChange: (v) => { view.overlay = v; } },
      ),

      el('div', { style: { fontSize: '12px', color: 'var(--ink-dim)', margin: '11px 0 6px' }, text: 'Long-press the landscape to' }),
      chipGroup(
        [{ id: 'flowers', label: 'Add flowers' }, { id: 'rich', label: 'Rich patch' }, { id: 'danger', label: 'Mark dangerous' }],
        { value: view.tool, onChange: (v) => { view.tool = v; } },
      ),

      el('div.row', { style: { marginTop: '11px' } },
        el('button.grow', {
          type: 'button', text: 'Choke the receivers',
          title: 'Send most food storers off duty, so foragers start queueing and tremble dancing',
          onclick: () => {
            for (let i = 0; i < bees.highWater; i++) {
              if (bees.alive[i] && bees.task[i] === TASK.RECEIVE && rng.chance(0.9)) {
                bees.task[i] = TASK.NURSE;
                bees.taskTime[i] = 0;
              }
            }
          },
        }),
        el('button.grow', {
          type: 'button', text: 'Heat wave',
          title: 'Push the comb well above the brood nest target',
          onclick: () => perturbTemperature(8),
        }),
      ),

      slider('Dance seconds per km', {
        min: 0.4, max: 2.5, step: 0.05, value: params.waggleSecondsPerKm,
        format: (v) => v.toFixed(2),
        onInput: (v) => { params.waggleSecondsPerKm = v; },
      }),
      slider('Dance angular scatter (°)', {
        min: 0, max: 40, step: 1, value: params.danceAngleScatter,
        format: (v) => `${v}`,
        onInput: (v) => { params.danceAngleScatter = v; },
      }),
      slider('Tremble threshold (s)', {
        min: 20, max: 150, step: 1, value: params.trembleDelayThreshold,
        format: (v) => `${v}`,
        onInput: (v) => { params.trembleDelayThreshold = v; },
      }),
      slider('Day length (s)', {
        min: 40, max: 600, step: 10, value: params.simSecondsPerDay,
        format: (v) => `${v}`,
        onInput: (v) => { params.simSecondsPerDay = v; clock.simSecondsPerDay = v; },
      }),
      toggle('Show what dancers are saying', {
        value: view.showDanceReadout,
        onChange: (v) => { view.showDanceReadout = v; },
      }),
    ];
  }

  /**
   * A hive in June is already working a patch it found days ago. Starting every run with the whole
   * colony ignorant means several minutes of nothing before the first scout stumbles on flowers
   * half a kilometre away — so the colony begins where a real one would: with foragers who know a
   * patch, some of them in the air, and dancers on the floor advertising it. The second patch is
   * left undiscovered so recruitment to it can still be watched happening from scratch.
   */
  (function establishForaging() {
    const patch = patches[0];
    patch.discovered = true;
    const patchDistance = distance(patch.x, patch.y, entrance.x, entrance.y);
    const patchBearing = bearing(entrance.x, entrance.y, patch.x, patch.y);

    let placed = 0;
    for (let i = 0; i < bees.highWater && placed < 46; i++) {
      if (!bees.alive[i] || bees.caste[i] !== 0 || !isForagerAge(i)) continue;

      bees.patch[i] = 0;
      bees.memDistance[i] = patchDistance;
      bees.memBearing[i] = patchBearing;

      const roll = rng();
      if (roll < 0.45) {
        // In the air, somewhere along the route, coming or going.
        const t = rng();
        bees.inHive[i] = 0;
        bees.x[i] = entrance.x + (patch.x - entrance.x) * t + rng.range(-30, 30);
        bees.y[i] = entrance.y + (patch.y - entrance.y) * t + rng.range(-30, 30);
        bees.speed[i] = params.flightSpeed;
        if (rng.chance(0.5)) {
          bees.task[i] = TASK.OUTBOUND;
          bees.heading[i] = patchBearing;
        } else {
          bees.task[i] = TASK.HOMEBOUND;
          bees.crop[i] = rng.range(20, params.cropCapacity);
          bees.cropQuality[i] = patch.quality;
          bees.heading[i] = bearing(bees.x[i], bees.y[i], entrance.x, entrance.y);
        }
      } else if (roll < 0.55) {
        // On the dance floor, advertising it.
        bees.inHive[i] = 1;
        bees.x[i] = COMB.danceFloor.x + rng.range(-0.02, 0.02);
        bees.y[i] = COMB.danceFloor.y + rng.range(-0.02, 0.02);
        startWaggleDance(i, rng.range(10, 40));
      }
      bees.px[i] = bees.x[i];
      bees.py[i] = bees.y[i];
      placed++;
    }
  }());

  return {
    meta, PARAMS, NOTES,
    step, renderField, renderNest, stats, describe, controls, applyTool, goal,
    toolIsDragging: () => false,
    _internals: {
      bees, brood, combTemp, clock, stores, goal, patches, runtime, params, entrance,
      COMB, TASK, cells, CELL, danceContent, readDance, roleForAge,
      perturbTemperature, broodNestTemperature,
    },
  };
}
