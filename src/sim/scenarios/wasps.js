// Wasp nest — the common wasp, Vespula vulgaris.
//
// This colony is here as the counter-example. Ants recruit by laying a chemical line on the ground
// and bees recruit by describing a place symbolically; a common wasp does neither. There is no
// trail pheromone to follow and no dance to read. A forager finds something, remembers where it is
// by landmarks, and goes back on her own. What passes for recruitment is far cruder: other wasps
// notice her arriving with food and are provoked into going out to look for the same smell, without
// being told where. Traffic to a good patch still builds up — but it builds by activation and by
// wasps noticing each other at the flowers, not by anybody being given directions.
//
// The other half of the colony is its economy, which is stranger than either of the others. Adult
// wasps cannot digest protein: they have no proteases of their own. They hunt caterpillars and
// flies, chew them up and hand them to the larvae, and the larvae hand back a sugary saliva that
// the adults live on. The brood is not just the colony's future, it is the colony's stomach. When
// the queen stops laying in autumn and the larvae run out, that supply fails — and the workers go
// looking for sugar anywhere they can find it. Which is why wasps only bother you in September.

import { createPool, MOTION_SCHEMA } from '../../engine/agents.js';
import { SpatialHash } from '../../engine/spatial.js';
import { SpriteAtlas, drawPopulation, paintInsect, paintCarrying, drawWorldLabel } from '../../engine/render.js';
import { el, slider, toggle, chipGroup } from '../../engine/ui.js';
import {
  SeasonClock, Stores, SurvivalGoal, createBroodPool, advanceBrood, developmentRate, STAGE,
} from '../colony.js';
import {
  turnToward, wanderTurn, storePrevious, distance, bearing, TAU,
} from '../behaviour.js';

export const meta = {
  id: 'wasps',
  name: 'Wasp nest',
  glyph: '🐝',
  species: 'Vespula vulgaris',
  blurb: 'No trails and no dances. Wasps forage alone and recruit only by provoking each other, '
       + 'and the adults live on sugar secreted by their own larvae.',
  fieldBounds: { x: 0, y: 0, w: 260, h: 180 },
  nestBounds: { x: 0, y: 0, w: 0.34, h: 0.42 },
  fieldLabel: 'Hunting ground',
  nestLabel: 'Paper nest cutaway',
};

export const PARAMS = {
  colonyTotal: {
    value: 5500, unit: 'individuals', label: 'Season total',
    source: 'A successful Vespula vulgaris nest produces roughly 3,000-8,000 individuals across the '
          + 'whole annual cycle (Richards 1971, Biol. Rev. 46).',
  },
  activationRate: {
    value: 0.35, unit: '/arrival', label: 'Nest activation strength', min: 0, max: 1,
    source: 'Returning foragers activate nestmates to search for the same food odour, without '
          + 'transferring any location information (Insectes Sociaux 62, 2015: nest-based '
          + 'information transfer and foraging activation in Vespula vulgaris).',
  },
  localEnhancement: {
    value: 18, unit: 'm', label: 'Local enhancement radius', min: 0, max: 60,
    source: 'Wasps are drawn to conspecifics already feeding, which concentrates arrivals at a good '
          + 'patch without any signal passing between them.',
  },
  flightSpeed: {
    value: 5.0, unit: 'm/s',
    source: 'tuned — Vespula cruising flight is a few metres per second.',
  },
  larvalSalivaPerLarva: {
    value: 2, unit: 'mg/day', label: 'Saliva per larva per day', min: 0, max: 6,
    source: 'Larvae secrete a sugar- and amino-acid-rich saliva which adults consume during '
          + 'trophallaxis; this is a principal carbohydrate source for adult wasps. Rate is tuned, '
          + 'the dependency is not (Hunt et al.; hornet larval saliva, J. Insect Physiol. 1991).',
  },
  adultsLackProteases: {
    value: 1, unit: 'true/false',
    source: 'Adult vespines cannot digest solid protein themselves — the larvae do it for them, '
          + 'which is what makes the exchange obligatory rather than merely convenient.',
  },
  preyPerLarvaDay: {
    value: 2.4, unit: 'mg/day',
    source: 'tuned — a growing larva needs a steady supply of masticated insect prey.',
  },
  eggDays: { value: 6, unit: 'd', source: 'Vespula eggs hatch in about 5-8 days.' },
  larvaDays: { value: 14, unit: 'd', source: 'Larval development takes roughly 12-20 days.' },
  pupaDays: { value: 13, unit: 'd', source: 'The pupal stage lasts about 12-14 days.' },
  gyneSwitchDay: {
    value: 228, unit: 'day of year', label: 'Switch to sexuals', min: 190, max: 280,
    source: 'From mid-August the colony stops rearing workers and rears gynes and males instead; '
          + 'this decision ends the colony’s year.',
  },
  simSecondsPerDay: {
    value: 90, unit: 's/day', label: 'Day length', min: 30, max: 400,
    source: 'tuned — display compression. Shorter here than the other colonies because the whole '
          + 'point of this nest is its annual arc.',
  },
};

export const NOTES = [
  {
    text: 'Watch this colony next to the ants. There is no pheromone overlay to switch on here, '
        + 'because there is nothing to show: Vespula lays no recruitment trail. Foragers find prey '
        + 'individually and return to it from memory. The traffic that builds at a good patch is '
        + 'made of wasps who were provoked into searching and then spotted each other, not wasps '
        + 'who were told where to go.',
    source: 'Nest-based information transfer and foraging activation in Vespula vulgaris, Insectes '
          + 'Sociaux 62 (2015).',
  },
  {
    text: 'Adult wasps cannot digest protein. They have no proteases, so the caterpillars they hunt '
        + 'are of no direct use to them — the prey goes to the larvae, and the larvae secrete a '
        + 'sugary saliva that the adults drink. The brood is the colony’s digestive system, and the '
        + 'adults are entirely dependent on it.',
    source: 'Vespine trophallaxis; hornet larval saliva composition, J. Insect Physiol. 37 (1991).',
  },
  {
    text: 'That dependency is what makes autumn wasps a nuisance. Once the queen switches to rearing '
        + 'gynes and stops laying worker eggs, the larvae dwindle and the saliva supply fails. '
        + 'Thousands of adults still need sugar and now have no source at home, so they go looking '
        + 'for it — at ivy, windfall fruit, and your drink. Nothing in this simulation scripts that: '
        + 'set the season running and watch the sugar column switch over.',
    source: 'Emergent from the modelled larval-saliva economy.',
  },
  {
    text: 'The nest itself is chewed wood. Foragers rasp fibre from fence posts and dead timber, mix '
        + 'it with saliva and add it to the comb and to the layered paper envelope, so the nest you '
        + 'see grows only as fast as pulp is brought home.',
    source: 'Standard vespine nest construction.',
  },
  {
    text: 'A colony that reaches autumn in good order produces new queens, and only they survive the '
        + 'winter — the workers, the males and the old queen all die. Rearing gynes is the only '
        + 'thing the year was for.',
    source: 'Vespula annual cycle; Richards (1971).',
  },
];

/* --------------------------------------------------------------------- tasks */

const TASK = {
  SEARCH: 0,        // out looking, with nothing in mind but an odour to look for
  TRAVEL: 1,        // flying to a remembered site
  AT_PREY: 2,
  AT_SUGAR: 3,
  AT_WOOD: 4,
  RETURN: 5,
  NEST_IDLE: 6,
  FEED_LARVAE: 7,   // handing masticated prey to a larva
  SOLICIT: 8,       // begging saliva from a larva
  BUILD: 9,         // adding pulp to the nest
  GUARD: 10,
  QUEEN: 11,
};

const TASK_NAMES = [
  'searching', 'flying to a known site', 'taking prey', 'at a sugar source', 'rasping wood pulp',
  'flying home', 'in the nest', 'feeding a larva', 'begging saliva from a larva', 'building comb',
  'guarding the entrance', 'laying eggs',
];

/** What a forager is carrying, which is also the odour she brings home. */
const LOAD = { NONE: 0, PREY: 1, SUGAR: 2, PULP: 3 };
const LOAD_NAMES = ['nothing', 'insect prey', 'sugar', 'wood pulp'];

export function create(world, rng) {
  const params = Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, v.value]));

  const clock = new SeasonClock({
    simSecondsPerDay: params.simSecondsPerDay,
    startDay: 196.4,         // mid-July, mid-morning: the colony is near its peak
    latitude: 51,
  });

  const fb = meta.fieldBounds;
  const nb = meta.nestBounds;
  const entrance = { x: fb.w * 0.5, y: fb.h * 0.62 };

  const NEST = {
    entranceX: nb.w * 0.5,
    entranceY: nb.h - 0.02,
    centreX: nb.w * 0.5,
    centreY: nb.h * 0.5,
    envelopeRx: nb.w * 0.44,
    envelopeRy: nb.h * 0.45,
  };

  /* ------------------------------------------------------------------ comb */

  // Comb tiers hang one below another, each a row of hexagonal cells. The nest grows downwards and
  // outwards as pulp comes in, which is exactly how a real nest is built.
  // Eight tiers of small cells. The comb has to hold appreciably more brood than there are adults:
  // a worker lives two or three weeks and takes five to six to develop, so a colony only holds its
  // numbers if there is always far more brood in the comb than there are wasps on the wing.
  const TIER_Y = [0.085, 0.126, 0.167, 0.208, 0.249, 0.290, 0.331, 0.372];
  const CELL_W = 0.0062;
  const cellsPerTier = new Array(TIER_Y.length).fill(0);
  const CELLS_PER_TIER_MAX = Math.floor((nb.w * 0.82) / CELL_W);
  const combCells = [];      // {x, y, tier}

  function addCell() {
    // Fill the top tier outwards from the middle, then start the next one down.
    for (let t = 0; t < TIER_Y.length; t++) {
      if (cellsPerTier[t] < CELLS_PER_TIER_MAX) {
        const n = cellsPerTier[t];
        // Alternate left and right of centre so the comb grows symmetrically, as it does.
        const offset = (n % 2 === 0 ? 1 : -1) * Math.ceil(n / 2) * CELL_W;
        combCells.push({ x: NEST.centreX + offset, y: TIER_Y[t], tier: t });
        cellsPerTier[t] = n + 1;
        return true;
      }
    }
    return false;
  }
  // A mid-season nest already has a substantial comb. Starting with only a few dozen cells caps
  // the brood far below what the adult population needs, and since the adults live on larval
  // saliva, the colony then starves itself for reasons of bookkeeping rather than biology.
  for (let n = 0; n < 300; n++) addCell();

  /* ----------------------------------------------------------------- sites */

  // Three kinds of place worth flying to. Wasps treat them quite differently: prey is for the
  // larvae, sugar is for the adults, pulp is for the building.
  const sites = [];
  function addSite(kind, x, y, opts = {}) {
    sites.push({
      kind, x, y,
      r: opts.r ?? 11,
      amount: opts.amount ?? rng.range(900, 2600),
      quality: opts.quality ?? rng.range(0.5, 1),
      visitors: 0,
      discovered: false,
      // Windfall fruit and ivy are not there in July. Autumn sugar ripening just as the larval
      // supply fails is why the colony's foragers have somewhere to go at all — and why the
      // switch is a change of diet rather than simply a starvation.
      availableFrom: opts.availableFrom ?? 0,
      label: opts.label ?? null,
    });
  }
  addSite(LOAD.PREY, fb.w * 0.24, fb.h * 0.28, { amount: 9000 });
  addSite(LOAD.PREY, fb.w * 0.79, fb.h * 0.34, { amount: 7000 });
  addSite(LOAD.SUGAR, fb.w * 0.70, fb.h * 0.80, { amount: 6000 });
  addSite(LOAD.PULP, fb.w * 0.30, fb.h * 0.80, { amount: 1e9 });   // a fence post does not run out
  // Ripening in late summer, when the colony will need them.
  addSite(LOAD.SUGAR, fb.w * 0.16, fb.h * 0.44, { amount: 1e9, r: 16, quality: 1, availableFrom: 226, label: 'windfall apples' });
  addSite(LOAD.SUGAR, fb.w * 0.86, fb.h * 0.16, { amount: 1e9, r: 14, quality: 1, availableFrom: 232, label: 'ivy in flower' });

  /* ---------------------------------------------------------------- agents */

  const capacity = Math.max(160, Math.min(world.budget.agents, 1200));
  const wasps = createPool(capacity, {
    ...MOTION_SCHEMA,
    inNest: 'u8',
    caste: 'u8',        // 0 worker, 1 queen, 2 gyne, 3 male
    load: 'f32',
    loadType: 'u8',
    site: 'i32',        // remembered site index, or -1
    seeking: 'u8',      // which LOAD kind she is currently out for
    sugar: 'f32',       // her own fuel, drunk from larvae or foraged
    restTime: 'f32',
    partner: 'i32',     // larva being fed or begged from
  });

  const brood = createBroodPool(Math.max(400, Math.round(capacity * 1.4)));
  const nestHash = new SpatialHash(nb, 0.03, capacity);

  const stores = new Stores({ protein: 60, sugar: 40, pulp: 20, larvalSaliva: 10 });
  stores.setCapacity('protein', 800);
  stores.setCapacity('sugar', 800);
  stores.setCapacity('pulp', 400);
  // Saliva is not a larder. It is produced by larvae on demand and drunk more or less at once, so
  // it is capped low and goes off quickly — a colony cannot bank its way through the autumn on it.
  stores.setCapacity('larvalSaliva', 120);

  const goal = new SurvivalGoal({
    label: 'new queens reared',
    target: 40,
    deadline: 'before the first frost',
  });

  const runtime = {
    gynes: 0,
    males: 0,
    preyBrought: 0,
    // Where the adults' carbohydrate actually came from — what they drank, not what was made or
    // carried in. That distinction is the whole claim about this colony's economy.
    sugarFromLarvae: 0,
    sugarForaged: 0,
    salivaProduced: 0,
    sugarCollected: 0,
    // Decaying counterparts of the two figures above, for the "where is sugar coming from now"
    // readout that makes the autumn switch visible.
    recentLarval: 0,
    recentForaged: 0,
    activations: 0,
    cellsBuilt: 300,
    larvaeFed: 0,
    // A rolling picture of where the adults' sugar is coming from, which is the story of the year.
    salivaShareToday: 1,
    switched: false,
  };

  const view = { tool: 'prey', showActivation: true, overlay: 'none' };

  /* ------------------------------------------------------------ population */

  function spawnWasp(age, inNest = 1, caste = 0) {
    const i = wasps.spawn();
    if (i < 0) return -1;
    wasps.caste[i] = caste;
    wasps.age[i] = age;
    wasps.inNest[i] = inNest;
    wasps.speed[i] = params.flightSpeed * rng.range(0.9, 1.1);
    wasps.heading[i] = rng.angle();
    wasps.site[i] = -1;
    wasps.partner[i] = -1;
    wasps.sugar[i] = rng.range(0.4, 1);
    wasps.task[i] = inNest ? TASK.NEST_IDLE : TASK.SEARCH;

    if (inNest) {
      wasps.x[i] = NEST.centreX + rng.range(-0.10, 0.10);
      wasps.y[i] = rng.range(0.09, 0.36);
    } else {
      wasps.x[i] = entrance.x;
      wasps.y[i] = entrance.y;
    }
    wasps.px[i] = wasps.x[i];
    wasps.py[i] = wasps.y[i];
    return i;
  }

  const startingWorkers = Math.min(Math.round(capacity * 0.40), 230);
  for (let n = 0; n < startingWorkers; n++) spawnWasp(Math.pow(rng(), 1.3) * 26, rng.chance(0.78) ? 1 : 0);

  const queenIndex = spawnWasp(300, 1, 1);
  wasps.task[queenIndex] = TASK.QUEEN;
  wasps.x[queenIndex] = NEST.centreX;
  wasps.y[queenIndex] = TIER_Y[0];
  wasps.speed[queenIndex] = 0.004;

  for (let n = 0; n < 260; n++) {
    const b = brood.spawn();
    if (b < 0) break;
    const cell = combCells[n % combCells.length];
    brood.x[b] = cell.x;
    brood.y[b] = cell.y;
    brood.cell[b] = n % combCells.length;
    brood.stage[b] = rng.int(0, 2);
    brood.stageAge[b] = rng.range(0, 4);
    brood.nutrition[b] = 1;
  }

  /* -------------------------------------------------------------- foraging */

  /** A site only counts if it exists yet and still has something in it. */
  function siteAvailable(site) {
    return site.amount > 0 && clock.dayOfYear >= site.availableFrom;
  }

  function siteNear(x, y, kind, radius) {
    for (let s = 0; s < sites.length; s++) {
      const site = sites[s];
      if (site.kind !== kind || !siteAvailable(site)) continue;
      if (distance(x, y, site.x, site.y) < site.r + radius) return s;
    }
    return -1;
  }

  /**
   * Local enhancement: a searching wasp who sees others feeding goes to join them. This is the only
   * thing in this scenario that concentrates wasps in one place, and it works purely by sight.
   */
  function nearestBusySite(x, y) {
    let best = -1;
    let bestD = params.localEnhancement * 4;
    for (let s = 0; s < sites.length; s++) {
      const site = sites[s];
      if (!siteAvailable(site) || site.visitors < 2) continue;
      const d = distance(x, y, site.x, site.y);
      if (d < bestD && d < params.localEnhancement * 4) { bestD = d; best = s; }
    }
    return best;
  }

  function stepFieldWasp(i, dt) {
    wasps.taskTime[i] += dt;

    switch (wasps.task[i]) {
      case TASK.TRAVEL: {
        const site = sites[wasps.site[i]];
        if (!site || !siteAvailable(site)) {
          wasps.site[i] = -1;
          wasps.task[i] = TASK.SEARCH;
          break;
        }
        wasps.heading[i] = turnToward(wasps.heading[i], bearing(wasps.x[i], wasps.y[i], site.x, site.y), 4 * dt);
        fly(i, dt);
        if (distance(wasps.x[i], wasps.y[i], site.x, site.y) < site.r) {
          wasps.task[i] = site.kind === LOAD.PREY ? TASK.AT_PREY : site.kind === LOAD.SUGAR ? TASK.AT_SUGAR : TASK.AT_WOOD;
          wasps.taskTime[i] = 0;
        }
        break;
      }

      case TASK.AT_PREY:
      case TASK.AT_SUGAR:
      case TASK.AT_WOOD: {
        const site = sites[wasps.site[i]];
        if (!site || !siteAvailable(site)) { headHome(i); break; }

        // Hover over the site while loading.
        wasps.speed[i] = params.flightSpeed * 0.15;
        wasps.heading[i] = turnToward(wasps.heading[i], bearing(wasps.x[i], wasps.y[i], site.x, site.y), 3 * dt);
        fly(i, dt);

        const taken = Math.min(site.amount, 5 * dt);
        site.amount -= taken;
        wasps.load[i] += taken;
        wasps.loadType[i] = site.kind;

        if (wasps.load[i] >= 6) {
          site.discovered = true;
          headHome(i);
        }
        break;
      }

      case TASK.RETURN: {
        wasps.speed[i] = params.flightSpeed;
        wasps.heading[i] = turnToward(wasps.heading[i], bearing(wasps.x[i], wasps.y[i], entrance.x, entrance.y), 4 * dt);
        fly(i, dt);
        if (distance(wasps.x[i], wasps.y[i], entrance.x, entrance.y) < 5) enterNest(i);
        break;
      }

      default: {
        // Searching. No trail to follow and nothing to read: she quarters the ground on her own,
        // and only the sight of other wasps at a patch will pull her in.
        wasps.speed[i] = params.flightSpeed * 0.8;
        wasps.heading[i] += wanderTurn(rng, 1.1, dt);

        const busy = nearestBusySite(wasps.x[i], wasps.y[i]);
        if (busy >= 0 && rng.eventAtRate(0.6, dt)) {
          wasps.site[i] = busy;
          wasps.task[i] = TASK.TRAVEL;
          wasps.taskTime[i] = 0;
          break;
        }

        // Keep her within range of home.
        const out = distance(wasps.x[i], wasps.y[i], entrance.x, entrance.y);
        if (out > Math.min(fb.w, fb.h) * 0.46) {
          wasps.heading[i] = turnToward(wasps.heading[i], bearing(wasps.x[i], wasps.y[i], entrance.x, entrance.y), 2 * dt);
        }
        fly(i, dt);

        // Did she blunder into something? She is biased towards whatever odour activated her, but
        // she will take anything useful she happens to find.
        const found = siteNear(wasps.x[i], wasps.y[i], wasps.seeking[i], 6);
        const anything = found >= 0 ? found
          : siteNear(wasps.x[i], wasps.y[i], LOAD.PREY, 4) >= 0 ? siteNear(wasps.x[i], wasps.y[i], LOAD.PREY, 4)
            : siteNear(wasps.x[i], wasps.y[i], LOAD.SUGAR, 4);

        if (anything >= 0) {
          wasps.site[i] = anything;
          sites[anything].discovered = true;
          wasps.task[i] = TASK.TRAVEL;
          wasps.taskTime[i] = 0;
        } else if (wasps.taskTime[i] > 220) {
          headHome(i);
        }
        break;
      }
    }
  }

  function fly(i, dt) {
    const step = wasps.speed[i] * dt;
    wasps.x[i] = Math.min(fb.w - 1, Math.max(1, wasps.x[i] + Math.cos(wasps.heading[i]) * step));
    wasps.y[i] = Math.min(fb.h - 1, Math.max(1, wasps.y[i] + Math.sin(wasps.heading[i]) * step));
  }

  function headHome(i) {
    wasps.task[i] = TASK.RETURN;
    wasps.speed[i] = params.flightSpeed;
    wasps.taskTime[i] = 0;
  }

  function enterNest(i) {
    wasps.inNest[i] = 1;
    wasps.x[i] = NEST.entranceX + rng.range(-0.01, 0.01);
    wasps.y[i] = NEST.entranceY - 0.01;
    wasps.px[i] = wasps.x[i];
    wasps.py[i] = wasps.y[i];
    wasps.speed[i] = 0.012;
    wasps.restTime[i] = 0;
    wasps.taskTime[i] = 0;

    if (wasps.load[i] > 0) {
      const kind = wasps.loadType[i];
      if (kind === LOAD.PREY) {
        stores.add('protein', wasps.load[i]);
        runtime.preyBrought += wasps.load[i];
      } else if (kind === LOAD.SUGAR) {
        stores.add('sugar', wasps.load[i]);
        runtime.sugarCollected += wasps.load[i];
      } else if (kind === LOAD.PULP) {
        stores.add('pulp', wasps.load[i]);
      }

      // Nest-based activation: her arrival, and the smell of what she is carrying, provokes other
      // wasps into going out to look for the same thing. Crucially she tells them nothing about
      // where she has been — they have to find it themselves.
      activateNestmates(i, kind);

      wasps.load[i] = 0;
      wasps.loadType[i] = LOAD.NONE;
    }
    wasps.task[i] = TASK.NEST_IDLE;
  }

  function activateNestmates(i, kind) {
    nestHash.forEachNear(wasps.x[i], wasps.y[i], 0.05, (k) => {
      if (k === i || !wasps.alive[k] || !wasps.inNest[k]) return;
      if (wasps.caste[k] !== 0 || wasps.task[k] !== TASK.NEST_IDLE) return;
      if (!rng.chance(params.activationRate * 0.25)) return;
      wasps.seeking[k] = kind;
      // She is roused, and she leaves — but with only an odour, not a destination.
      wasps.site[k] = -1;
      leaveNest(k);
      runtime.activations++;
    });
  }

  function leaveNest(i) {
    wasps.inNest[i] = 0;
    wasps.x[i] = entrance.x + rng.range(-2, 2);
    wasps.y[i] = entrance.y + rng.range(-2, 2);
    wasps.px[i] = wasps.x[i];
    wasps.py[i] = wasps.y[i];
    wasps.speed[i] = params.flightSpeed;
    wasps.heading[i] = rng.angle();
    wasps.load[i] = 0;
    wasps.taskTime[i] = 0;

    // A wasp who already knows a site of the kind she wants goes straight back to it. Site fidelity
    // is what a wasp has instead of a trail.
    if (wasps.site[i] >= 0 && sites[wasps.site[i]] && sites[wasps.site[i]].amount > 0
        && sites[wasps.site[i]].kind === wasps.seeking[i]) {
      wasps.task[i] = TASK.TRAVEL;
    } else {
      wasps.task[i] = TASK.SEARCH;
    }
  }

  /* ---------------------------------------------------------- in the nest */

  function crawl(i, dt, tx, ty, wander = 0.9) {
    wasps.heading[i] = turnToward(wasps.heading[i], bearing(wasps.x[i], wasps.y[i], tx, ty), 6 * dt);
    wasps.heading[i] += wanderTurn(rng, wander, dt);
    const step = wasps.speed[i] * dt;
    let nx = wasps.x[i] + Math.cos(wasps.heading[i]) * step;
    let ny = wasps.y[i] + Math.sin(wasps.heading[i]) * step;

    // Keep her inside the paper envelope. Clamping to the pane instead lets wasps drift into the
    // empty margins outside the nest, which looks like the nest is leaking.
    const ex = (nx - NEST.centreX) / (NEST.envelopeRx * 0.94);
    const ey = (ny - NEST.centreY) / (NEST.envelopeRy * 0.94);
    const outside = ex * ex + ey * ey;
    if (outside > 1) {
      const scale = 1 / Math.sqrt(outside);
      nx = NEST.centreX + (nx - NEST.centreX) * scale;
      ny = NEST.centreY + (ny - NEST.centreY) * scale;
      wasps.heading[i] = bearing(nx, ny, NEST.centreX, NEST.centreY) + rng.range(-0.8, 0.8);
    }

    wasps.x[i] = Math.min(nb.w - 0.004, Math.max(0.004, nx));
    wasps.y[i] = Math.min(nb.h - 0.004, Math.max(0.004, ny));
    return distance(wasps.x[i], wasps.y[i], tx, ty);
  }

  function stepNestWasp(i, dt) {
    wasps.taskTime[i] += dt;
    wasps.restTime[i] += dt;

    if (wasps.caste[i] === 1) {
      crawl(i, dt, NEST.centreX + rng.range(-0.05, 0.05), TIER_Y[0] + rng.range(-0.01, 0.02), 0.5);
      return;
    }

    switch (wasps.task[i]) {
      case TASK.FEED_LARVAE: {
        const b = wasps.partner[i];
        if (b < 0 || !brood.alive[b] || brood.stage[b] !== STAGE.LARVA) {
          wasps.partner[i] = -1;
          wasps.task[i] = TASK.NEST_IDLE;
          break;
        }
        const d = crawl(i, dt, brood.x[b], brood.y[b], 0.5);
        if (d < 0.008) {
          // Masticated prey goes in; the larva is fed.
          const given = stores.consume('protein', 0.6);
          brood.nutrition[b] = Math.min(1, brood.nutrition[b] + given * 0.5);
          runtime.larvaeFed++;
          wasps.partner[i] = -1;
          wasps.task[i] = TASK.SOLICIT;      // and while she is here, she begs for saliva
          wasps.taskTime[i] = 0;
        }
        break;
      }

      case TASK.SOLICIT: {
        // Trophallaxis in the other direction: the larva gives up sugary saliva, which is what the
        // adult actually lives on. She cannot digest the prey she just delivered.
        if (wasps.taskTime[i] > 2) {
          const drunk = stores.consume('larvalSaliva', 0.35);
          wasps.sugar[i] = Math.min(1.4, wasps.sugar[i] + drunk);
          runtime.sugarFromLarvae += drunk;
          runtime.recentLarval += drunk;
          wasps.task[i] = TASK.NEST_IDLE;
          wasps.taskTime[i] = 0;
        }
        break;
      }

      case TASK.BUILD: {
        // Work anywhere along the growing edge rather than all converging on the single newest
        // cell, which otherwise produces a scrum of wasps jostling over one spot.
        const edge = combCells.length > 0
          ? combCells[Math.max(0, combCells.length - 1 - Math.floor(rng() * 24))]
          : { x: NEST.centreX, y: TIER_Y[0] };
        const d = crawl(i, dt, edge.x, edge.y + 0.008, 0.6);
        if (d < 0.02 && stores.get('pulp') > 1) {
          stores.consume('pulp', 1);
          if (addCell()) runtime.cellsBuilt++;
          wasps.task[i] = TASK.NEST_IDLE;
          wasps.taskTime[i] = 0;
        } else if (wasps.taskTime[i] > 25) {
          wasps.task[i] = TASK.NEST_IDLE;
        }
        break;
      }

      case TASK.GUARD: {
        crawl(i, dt, NEST.entranceX + rng.range(-0.02, 0.02), NEST.entranceY - 0.015, 0.5);
        if (wasps.taskTime[i] > 30) wasps.task[i] = TASK.NEST_IDLE;
        break;
      }

      default: {
        crawl(i, dt, NEST.centreX + rng.range(-0.10, 0.10), rng.range(0.09, 0.36), 1.4);
        if (wasps.taskTime[i] > 1.5) chooseNestTask(i);
        break;
      }
    }
  }

  function chooseNestTask(i) {
    wasps.taskTime[i] = 0;

    // A hungry adult begs from a larva before doing anything else. If there are no larvae left she
    // has to go and find sugar in the world instead — which is the whole autumn story.
    if (wasps.sugar[i] < 0.5) {
      const larva = nearestHungryLarva(wasps.x[i], wasps.y[i], true);
      if (larva >= 0 && stores.get('larvalSaliva') > 0.1) {
        wasps.partner[i] = larva;
        wasps.task[i] = TASK.SOLICIT;
        return;
      }
      // Nothing at home. Go out for sugar.
      if (clock.isDaylight && wasps.restTime[i] > 3) {
        wasps.seeking[i] = LOAD.SUGAR;
        wasps.site[i] = knownSiteOfKind(LOAD.SUGAR);
        leaveNest(i);
        return;
      }
    }

    // Larvae that need feeding are the colony's first call on labour.
    if (stores.get('protein') > 1) {
      const larva = nearestHungryLarva(wasps.x[i], wasps.y[i], false);
      if (larva >= 0) {
        wasps.partner[i] = larva;
        wasps.task[i] = TASK.FEED_LARVAE;
        return;
      }
    }

    if (stores.get('pulp') > 2 && rng.chance(0.03)) {
      wasps.task[i] = TASK.BUILD;
      return;
    }

    if (rng.chance(0.04)) {
      wasps.task[i] = TASK.GUARD;
      return;
    }

    // Otherwise, go out. What she goes out for depends on what the colony is short of.
    if (clock.isDaylight && wasps.restTime[i] > 8 && rng.eventAtRate(0.05, 1.5)) {
      wasps.seeking[i] = chooseWhatToSeek();
      wasps.site[i] = knownSiteOfKind(wasps.seeking[i]);
      leaveNest(i);
    }
  }

  /** What the colony most needs right now. */
  function chooseWhatToSeek() {
    const larvae = brood.countWhere((b) => brood.stage[b] === STAGE.LARVA);
    const needsProtein = larvae > 0 && stores.get('protein') < larvae * 0.6;
    const needsPulp = stores.get('pulp') < 12;
    const needsSugar = stores.get('sugar') < 40;

    const roll = rng();
    if (needsProtein && roll < 0.55) return LOAD.PREY;
    if (needsPulp && roll < 0.72) return LOAD.PULP;
    if (needsSugar || larvae === 0) return LOAD.SUGAR;
    return roll < 0.6 ? LOAD.PREY : LOAD.SUGAR;
  }

  function knownSiteOfKind(kind) {
    for (let s = 0; s < sites.length; s++) {
      if (sites[s].kind === kind && sites[s].discovered && siteAvailable(sites[s])) return s;
    }
    return -1;
  }

  function nearestHungryLarva(x, y, anyLarva) {
    let best = -1;
    let bestD = 0.10;
    for (let b = 0; b < brood.highWater; b++) {
      if (!brood.alive[b] || brood.stage[b] !== STAGE.LARVA) continue;
      if (!anyLarva && brood.nutrition[b] > 0.85) continue;
      const d = distance(x, y, brood.x[b], brood.y[b]);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /* -------------------------------------------------------------- the year */

  function stepBrood(days) {
    const stageDays = [params.eggDays, params.larvaDays, params.pupaDays];
    const air = clock.airTemperature();
    // A paper nest is insulated and the adults warm it, but it is not a bee hive: brood tracks the
    // weather far more than a honey bee's does.
    const nestTemp = Math.max(air, air * 0.45 + 30 * 0.55);

    let larvae = 0;
    for (let b = 0; b < brood.highWater; b++) {
      if (!brood.alive[b]) continue;
      if (brood.stage[b] === STAGE.LARVA) larvae++;

      const rate = developmentRate(nestTemp, 10, 30, 38);

      // Only larvae eat. An egg has its yolk and a pupa is sealed in, so neither can be hungry —
      // letting them lose condition starves the entire brood before any of it can hatch, and the
      // colony then dies out for want of replacements while the comb looks perfectly full.
      const isLarva = brood.stage[b] === STAGE.LARVA;
      if (isLarva) {
        brood.nutrition[b] = Math.max(0, Math.min(1, brood.nutrition[b] - days * 0.55));
      }

      if (advanceBrood(brood, b, days * rate * (isLarva ? 0.3 + 0.7 * brood.nutrition[b] : 1), stageDays) === 'emerged') {
        emerge(b);
      } else if (isLarva && brood.nutrition[b] <= 0 && rng.chance(days * 0.6)) {
        brood.kill(b);
      }
    }

    // The larvae's side of the bargain: saliva, in proportion to how many well-fed larvae there are.
    const wellFed = brood.countWhere((b) => brood.stage[b] === STAGE.LARVA && brood.nutrition[b] > 0.3);
    const produced = wellFed * params.larvalSalivaPerLarva * days;
    stores.add('larvalSaliva', produced);
    runtime.salivaProduced += produced;

    // Unclaimed saliva does not keep. Without this the colony could coast through autumn on a
    // stockpile, and the failure of the larval supply — the thing this nest exists to show — would
    // never actually bite.
    stores.consume('larvalSaliva', stores.get('larvalSaliva') * Math.min(1, days * 6));
    void larvae;
  }

  function emerge(b) {
    const fate = brood.fate[b];
    const cell = brood.cell[b];
    brood.kill(b);

    if (fate === 1) {
      runtime.gynes++;
      goal.value = runtime.gynes;
      return;               // she leaves to mate and overwinter
    }
    if (fate === 2) {
      runtime.males++;
      return;
    }
    const i = spawnWasp(0, 1);
    if (i >= 0 && combCells[cell]) {
      wasps.x[i] = combCells[cell].x;
      wasps.y[i] = combCells[cell].y;
    }
  }

  function stepQueen(days) {
    if (!wasps.alive[queenIndex]) return;

    const rearingSexuals = clock.dayOfYear >= params.gyneSwitchDay;
    if (rearingSexuals && !runtime.switched) runtime.switched = true;

    const air = clock.airTemperature();
    const seasonal = air > 8 && clock.dayOfYear < 300 ? 1 : 0.05;
    // Laying tails off through the autumn and then stops, which is what starves the colony of
    // larvae and so of its own carbohydrate supply. Colonies peak in late summer and are visibly
    // running down within a month, so the taper is weeks rather than the whole season.
    const decline = rearingSexuals ? Math.max(0, 1 - (clock.dayOfYear - params.gyneSwitchDay) / 26) : 1;
    let expected = 55 * seasonal * decline * days;

    while (expected > 0) {
      if (expected < 1 && !rng.chance(expected)) break;
      expected -= 1;
      if (brood.count >= combCells.length) break;      // no cell to lay in

      const b = brood.spawn();
      if (b < 0) break;
      brood.stage[b] = STAGE.EGG;
      brood.nutrition[b] = 1;
      brood.fate[b] = rearingSexuals ? (rng.chance(0.5) ? 1 : 2) : 0;

      // Find a free cell.
      const cellIndex = rng.int(0, combCells.length - 1);
      brood.cell[b] = cellIndex;
      brood.x[b] = combCells[cellIndex].x;
      brood.y[b] = combCells[cellIndex].y;
    }
  }

  function stepAdults(days, dt) {
    for (let i = 0; i < wasps.highWater; i++) {
      if (!wasps.alive[i]) continue;
      wasps.age[i] += days;

      // The queen is not a worker. She founded the nest in spring and outlives every wasp in it;
      // running her through the worker mortality table kills her within days of the start and takes
      // the colony's whole year with her.
      if (wasps.caste[i] === 1) continue;

      // Adults burn sugar continuously; flying costs more than sitting.
      const burn = (wasps.inNest[i] ? 0.010 : 0.05) * days * 24;
      wasps.sugar[i] -= burn;

      if (wasps.sugar[i] <= 0) {
        // Starved of carbohydrate. She can also draw on the colony's foraged sugar if there is any.
        const rescued = stores.consume('sugar', 0.25);
        wasps.sugar[i] += rescued;
        runtime.sugarForaged += rescued;
        runtime.recentForaged += rescued;
        // Running out of carbohydrate kills a wasp over hours, not instantly. Killing her the
        // moment her reserve hits zero means she never gets the chance to fly out and find sugar,
        // and the autumn colony quietly dies instead of going looking for your jam.
        if (wasps.sugar[i] <= 0 && rng.chance(days * 2.5)) { wasps.kill(i); continue; }
      }

      const risk = wasps.inNest[i] ? 0.01 : 0.05;
      // Workers live two to three weeks, and wear out gradually rather than all dropping dead on
      // the same day. A step change in hazard makes the whole founding cohort vanish at once.
      const old = Math.max(0, (wasps.age[i] - 16) / 14) ** 2 * 0.10;
      if (rng.chance((risk + old) * days)) { wasps.kill(i); continue; }

      // Frost kills the workers outright, which is how the colony ends.
      if (clock.airTemperature() < -1 && rng.chance(days * 3)) wasps.kill(i);
    }
    void dt;
  }

  /**
   * Where the adults' sugar is coming from *lately*.
   *
   * A lifetime total is no use here: by the time autumn arrives, months of summer saliva dominate
   * the sum and the switch to scavenging — the thing worth seeing — never shows up in the number.
   * So both figures decay, giving a couple of simulated days of memory.
   */
  function updateSugarShare(days) {
    const keep = Math.exp(-days / 2);
    runtime.recentLarval *= keep;
    runtime.recentForaged *= keep;
    const total = runtime.recentLarval + runtime.recentForaged;
    runtime.salivaShareToday = total > 1e-6 ? runtime.recentLarval / total : 0;
  }

  function checkGoal() {
    if (goal.outcome) return;
    if (runtime.gynes >= goal.target) {
      goal.succeed(`${runtime.gynes} new queens left to overwinter.`);
    } else if (!wasps.alive[queenIndex] && brood.count === 0 && runtime.gynes < goal.target) {
      goal.fail(`The queen died with only ${runtime.gynes} new queens reared.`);
    } else if (wasps.count <= 3) {
      goal.fail(`The nest died out having produced ${runtime.gynes} new queens.`);
    } else if (clock.dayOfYear > 330) {
      goal.fail(`Winter ended the colony with ${runtime.gynes} new queens.`);
    }
  }

  /* -------------------------------------------------------------- stepping */

  let slowAccumulator = 0;

  function step(dt) {
    clock.step(dt);
    nestHash.rebuild(wasps.x, wasps.y, wasps.highWater, wasps.alive);

    for (let i = 0; i < wasps.highWater; i++) {
      if (!wasps.alive[i]) continue;
      storePrevious(wasps, i);
      if (wasps.inNest[i]) stepNestWasp(i, dt);
      else stepFieldWasp(i, dt);
    }

    slowAccumulator += dt;
    if (slowAccumulator >= 0.25) {
      const days = slowAccumulator / clock.simSecondsPerDay;
      stepBrood(days);
      stepQueen(days);
      stepAdults(days, slowAccumulator);
      updateSugarShare(days);
      checkGoal();

      for (const s of sites) s.visitors = 0;
      for (let i = 0; i < wasps.highWater; i++) {
        if (!wasps.alive[i] || wasps.inNest[i] || wasps.site[i] < 0) continue;
        const t = wasps.task[i];
        if (t === TASK.AT_PREY || t === TASK.AT_SUGAR || t === TASK.AT_WOOD) sites[wasps.site[i]].visitors++;
      }
      slowAccumulator = 0;
    }
  }

  /* -------------------------------------------------------------- rendering */

  const dprScale = () => Math.min(window.devicePixelRatio || 1, 2);
  let atlases = null;

  function ensureRenderAssets() {
    if (atlases) return;
    const dpr = dprScale();
    const YELLOW = '#e3c341';
    const BLACK = '#241c10';

    atlases = {
      worker: new SpriteAtlas(15 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: YELLOW, accent: BLACK, legColour: BLACK, width: 0.30, wings: true,
      })),
      prey: new SpriteAtlas(15 * dpr, 24, (c, s) => {
        paintInsect(c, s, { body: YELLOW, accent: BLACK, legColour: BLACK, width: 0.30, wings: true });
        paintCarrying(c, s, '#8fae5a', 0.12);
      }),
      sugar: new SpriteAtlas(15 * dpr, 24, (c, s) => {
        paintInsect(c, s, { body: YELLOW, accent: BLACK, legColour: BLACK, width: 0.30, wings: true });
        paintCarrying(c, s, '#e08a3c', 0.10);
      }),
      pulp: new SpriteAtlas(15 * dpr, 24, (c, s) => {
        paintInsect(c, s, { body: YELLOW, accent: BLACK, legColour: BLACK, width: 0.30, wings: true });
        paintCarrying(c, s, '#c8bda6', 0.11);
      }),
      queen: new SpriteAtlas(26 * dpr, 24, (c, s) => paintInsect(c, s, {
        body: '#eccd50', accent: BLACK, legColour: BLACK, width: 0.34, abdomenLen: 0.48, wings: true,
      })),
    };
  }

  function atlasForLoad(kind) {
    if (kind === LOAD.PREY) return atlases.prey;
    if (kind === LOAD.SUGAR) return atlases.sugar;
    if (kind === LOAD.PULP) return atlases.pulp;
    return atlases.worker;
  }

  function renderField(ctx, vp, alpha) {
    ensureRenderAssets();
    const light = 0.4 + 0.6 * clock.solarElevation;
    const autumn = Math.min(1, Math.max(0, (clock.dayOfYear - 235) / 60));
    // The ground turns as the season does, which is the clearest cue that the year is running out.
    const g = Math.round((54 - autumn * 18) * light + 12);
    ctx.fillStyle = `rgb(${Math.round((40 + autumn * 26) * light + 12)}, ${g}, ${Math.round(28 * light + 10)})`;
    ctx.fillRect(0, 0, fb.w, fb.h);

    for (const site of sites) {
      if (!siteAvailable(site)) continue;
      const colour = site.kind === LOAD.PREY ? '#8fae5a' : site.kind === LOAD.SUGAR ? '#e08a3c' : '#9d8f76';
      ctx.fillStyle = `${colour}44`;
      ctx.beginPath();
      ctx.arc(site.x, site.y, site.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(site.x, site.y, site.r * 0.34, 0, TAU);
      ctx.fill();
    }

    // The nest, in a bank.
    ctx.fillStyle = '#6a5c46';
    ctx.beginPath();
    ctx.arc(entrance.x, entrance.y, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#181209';
    ctx.beginPath();
    ctx.arc(entrance.x, entrance.y, 2.6, 0, TAU);
    ctx.fill();

    const dpr = dprScale();
    drawPopulation(ctx, vp, dpr, wasps, alpha, {
      atlasFor: (i) => (wasps.inNest[i] ? null : atlasForLoad(wasps.loadType[i])),
      scale: 1,
      cull: 8,
    });

    if (view.showActivation) {
      drawWorldLabel(ctx, vp, dpr, entrance.x, entrance.y - 14, 'nest', { size: 10 });
      for (const site of sites) {
        if (!site.discovered || !siteAvailable(site)) continue;
        const label = site.label
          || (site.kind === LOAD.PREY ? 'prey' : site.kind === LOAD.SUGAR ? 'sugar' : 'wood pulp');
        drawWorldLabel(ctx, vp, dpr, site.x, site.y - site.r - 6, label, { size: 9 });
      }
    }
  }

  function renderNest(ctx, vp, alpha) {
    ensureRenderAssets();

    // The paper envelope: layered grey shells, which is what a vespine nest is made of.
    for (let layer = 3; layer >= 0; layer--) {
      const t = layer / 3;
      ctx.fillStyle = `rgba(${168 - layer * 14}, ${158 - layer * 14}, ${142 - layer * 12}, ${0.30 + 0.14 * (1 - t)})`;
      ctx.beginPath();
      ctx.ellipse(NEST.centreX, NEST.centreY, NEST.envelopeRx * (0.80 + 0.07 * layer),
        NEST.envelopeRy * (0.80 + 0.07 * layer), 0, 0, TAU);
      ctx.fill();
    }

    // Comb cells.
    for (const cell of combCells) {
      ctx.fillStyle = '#8c7f68';
      ctx.fillRect(cell.x - CELL_W * 0.45, cell.y - CELL_W * 0.55, CELL_W * 0.9, CELL_W * 1.1);
    }

    // Brood in their cells, and how well fed they are.
    for (let b = 0; b < brood.highWater; b++) {
      if (!brood.alive[b]) continue;
      const stage = brood.stage[b];
      if (stage === STAGE.PUPA) {
        ctx.fillStyle = '#d8cdb4';        // capped with a paper lid
        ctx.fillRect(brood.x[b] - CELL_W * 0.42, brood.y[b] - CELL_W * 0.5, CELL_W * 0.84, CELL_W * 1.0);
      } else {
        const fed = brood.nutrition[b];
        ctx.fillStyle = stage === STAGE.EGG
          ? '#efe8d4'
          : `rgb(${Math.round(180 + 60 * fed)}, ${Math.round(150 + 70 * fed)}, ${Math.round(110 + 40 * fed)})`;
        ctx.beginPath();
        ctx.arc(brood.x[b], brood.y[b], stage === STAGE.EGG ? 0.0014 : 0.0026 + fed * 0.0012, 0, TAU);
        ctx.fill();
      }
    }

    const dpr = dprScale();
    drawPopulation(ctx, vp, dpr, wasps, alpha, {
      atlasFor: (i) => {
        if (!wasps.inNest[i]) return null;
        if (wasps.caste[i] === 1) return atlases.queen;
        return atlases.worker;
      },
      scale: 0.42,
    });

    if (view.showActivation) {
      // The economy, stated plainly, because it is the point of this nest.
      const share = runtime.salivaShareToday;
      ctx.save();
      ctx.resetTransform();
      const text = share > 0.5
        ? `adult sugar: ${(share * 100).toFixed(0)}% from larvae`
        : `larvae failing — ${(100 - share * 100).toFixed(0)}% of sugar now foraged`;
      ctx.font = `${10 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      const w = ctx.measureText(text).width + 12 * dpr;
      const lx = (vp.rect.x + vp.rect.w / 2) * dpr;
      const ly = (vp.rect.y + 48) * dpr;
      ctx.fillStyle = '#0b0906cc';
      ctx.fillRect(lx - w / 2, ly - 9 * dpr, w, 18 * dpr);
      ctx.fillStyle = share > 0.5 ? '#9fbc5e' : '#e08a3c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, lx, ly);
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ panel */

  function stats() {
    let out = 0;
    let feeding = 0;
    let building = 0;
    let hunting = 0;
    let sugarSeeking = 0;
    for (let i = 0; i < wasps.highWater; i++) {
      if (!wasps.alive[i]) continue;
      if (!wasps.inNest[i]) {
        out++;
        if (wasps.seeking[i] === LOAD.PREY) hunting++;
        if (wasps.seeking[i] === LOAD.SUGAR) sugarSeeking++;
      }
      if (wasps.task[i] === TASK.FEED_LARVAE) feeding++;
      if (wasps.task[i] === TASK.BUILD) building++;
    }

    const larvae = brood.countWhere((b) => brood.stage[b] === STAGE.LARVA);
    const rows = [
      ['Date', `${clock.monthName} ${1 + Math.floor(clock.day % 30.4)}`],
      ['Air', `${clock.airTemperature().toFixed(1)} °C`],
      ['Adults', wasps.count],
      ['Out foraging', out],
      ['— for prey', hunting],
      ['— for sugar', sugarSeeking],
      ['Feeding larvae', feeding],
      ['Building', building],
      ['Larvae', larvae],
      ['Brood total', brood.count],
      ['Comb cells', combCells.length],
      ['Larval saliva', `${stores.get('larvalSaliva').toFixed(0)} mg`],
      ['Sugar from larvae', `${(runtime.salivaShareToday * 100).toFixed(0)}%`],
      ['Rearing', runtime.switched ? 'gynes and males' : 'workers'],
      ['New queens', `${runtime.gynes} / ${goal.target}`],
    ];
    if (goal.outcome) rows.push([goal.outcome === 'success' ? 'Outcome' : 'Colony lost', goal.reason]);
    return rows;
  }

  function describe(wx, wy, which) {
    const inNest = which === 'nest' ? 1 : 0;
    const radius = inNest ? 0.012 : 8;
    const i = wasps.nearestTo(wx, wy, radius, (k) => wasps.inNest[k] === inNest);

    if (i < 0) {
      if (inNest) {
        let best = -1;
        let bestD = 0.01;
        for (let b = 0; b < brood.highWater; b++) {
          if (!brood.alive[b]) continue;
          const d = distance(wx, wy, brood.x[b], brood.y[b]);
          if (d < bestD) { bestD = d; best = b; }
        }
        if (best >= 0) {
          return {
            title: `${['Egg', 'Larva', 'Pupa'][brood.stage[best]]} in cell ${brood.cell[best]}`,
            rows: [
              ['Age', `${brood.age[best].toFixed(1)} days`],
              ['Fed', `${(brood.nutrition[best] * 100).toFixed(0)}%`],
              ['Destined to be', ['a worker', 'a new queen', 'a male'][brood.fate[best]]],
              brood.stage[best] === STAGE.LARVA ? ['Gives back', 'sugary saliva'] : ['', ''],
            ].filter((r) => r[0]),
          };
        }
        return { title: 'Paper nest', rows: [['Comb cells', combCells.length], ['Pulp in store', `${stores.get('pulp').toFixed(0)} mg`]] };
      }
      return {
        title: 'Ground',
        rows: [
          ['From nest', `${distance(wx, wy, entrance.x, entrance.y).toFixed(0)} m`],
          ['Trail pheromone', 'none — wasps lay none'],
        ],
      };
    }

    if (wasps.caste[i] === 1) {
      return {
        title: 'Queen',
        rows: [['Age', `${wasps.age[i].toFixed(0)} days`], ['Rearing', runtime.switched ? 'gynes and males' : 'workers']],
      };
    }

    const rows = [
      ['Age', `${wasps.age[i].toFixed(1)} days`],
      ['Doing', TASK_NAMES[wasps.task[i]]],
      ['Own sugar', `${(wasps.sugar[i] * 100).toFixed(0)}%`],
    ];
    if (wasps.load[i] > 0) rows.push(['Carrying', `${wasps.load[i].toFixed(1)} mg of ${LOAD_NAMES[wasps.loadType[i]]}`]);
    if (!wasps.inNest[i]) {
      rows.push(['Looking for', LOAD_NAMES[wasps.seeking[i]] || 'anything']);
      rows.push(['Knows a site', wasps.site[i] >= 0 ? 'yes, going back to it' : 'no, searching']);
    }
    return { title: `Worker #${wasps.id[i]}`, rows };
  }

  /* ------------------------------------------------------------ interaction */

  function applyTool(wx, wy, which) {
    if (which !== 'field') return;
    if (view.tool === 'prey') addSite(LOAD.PREY, wx, wy, { amount: 5000 });
    else if (view.tool === 'sugar') addSite(LOAD.SUGAR, wx, wy, { amount: 6000, quality: 1 });
    else if (view.tool === 'wood') addSite(LOAD.PULP, wx, wy, { amount: 1e9 });
  }

  function controls() {
    return [
      el('p.note', {
        style: { marginTop: '0' },
        text: 'There is no pheromone overlay here. That is the point — Vespula lays no recruitment '
            + 'trail, so there is nothing on the ground to draw.',
      }),

      el('div', { style: { fontSize: '12px', color: 'var(--ink-dim)', margin: '4px 0 6px' }, text: 'Long-press the ground to put out' }),
      chipGroup(
        [{ id: 'prey', label: 'Caterpillars' }, { id: 'sugar', label: 'Windfall fruit' }, { id: 'wood', label: 'Dead wood' }],
        { value: view.tool, onChange: (v) => { view.tool = v; } },
      ),

      el('div.row', { style: { marginTop: '11px' } },
        el('button.grow', {
          type: 'button', text: 'Jump to autumn',
          title: 'Skip to the switch to rearing gynes, when the larval sugar supply starts to fail',
          onclick: () => { clock.day = params.gyneSwitchDay + 0.35; },
        }),
        el('button.grow', {
          type: 'button', text: 'Kill the brood',
          title: 'Remove every larva, cutting off the adults’ carbohydrate at a stroke',
          onclick: () => {
            for (let b = 0; b < brood.highWater; b++) if (brood.alive[b]) brood.kill(b);
            stores.consume('larvalSaliva', stores.get('larvalSaliva'));
          },
        }),
      ),

      slider('Nest activation strength', {
        min: 0, max: 1, step: 0.05, value: params.activationRate,
        format: (v) => v.toFixed(2),
        onInput: (v) => { params.activationRate = v; },
      }),
      slider('Local enhancement (m)', {
        min: 0, max: 60, step: 1, value: params.localEnhancement,
        format: (v) => `${v}`,
        onInput: (v) => { params.localEnhancement = v; },
      }),
      slider('Saliva per larva (mg/day)', {
        min: 0, max: 6, step: 0.05, value: params.larvalSalivaPerLarva,
        format: (v) => v.toFixed(2),
        onInput: (v) => { params.larvalSalivaPerLarva = v; },
      }),
      slider('Switch to sexuals (day)', {
        min: 190, max: 280, step: 1, value: params.gyneSwitchDay,
        format: (v) => `${v}`,
        onInput: (v) => { params.gyneSwitchDay = v; },
      }),
      slider('Day length (s)', {
        min: 30, max: 400, step: 5, value: params.simSecondsPerDay,
        format: (v) => `${v}`,
        onInput: (v) => { params.simSecondsPerDay = v; clock.simSecondsPerDay = v; },
      }),
      toggle('Label sites and the economy', {
        value: view.showActivation,
        onChange: (v) => { view.showActivation = v; },
      }),
    ];
  }

  return {
    meta, PARAMS, NOTES,
    step, renderField, renderNest, stats, describe, controls, applyTool, goal,
    toolIsDragging: () => false,
    _internals: {
      wasps, brood, clock, stores, goal, sites, runtime, params, entrance,
      TASK, LOAD, combCells, NEST, addSite,
    },
  };
}
