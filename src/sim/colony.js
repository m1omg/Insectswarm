// Shared colony biology: the calendar, the weather, the brood and the larder.
//
// Everything here is common to all four societies. What each species does with it — which castes
// exist, what the brood is fed, when the colony switches to producing sexuals — belongs in the
// scenario.

import { createPool } from '../engine/agents.js';

/* ------------------------------------------------------------------ calendar */

/**
 * Two clocks, deliberately.
 *
 * An insect's locomotion happens in seconds and a colony's life happens over months, and no single
 * rate shows both. So agent movement runs in simulated real time, while the calendar advances at a
 * stated compression — by default one colony day per simulated minute. That is a display
 * convenience and not biology, which is why the figure is shown in the science panel rather than
 * hidden in the code.
 */
export class SeasonClock {
  /**
   * @param {object} opts
   * @param {number} [opts.simSecondsPerDay]  compression factor
   * @param {number} [opts.startDay]  day of year to begin on, 0 = 1 January
   * @param {number} [opts.latitude]  degrees north, for daylight length and sun position
   * @param {number} [opts.meanTempC] annual mean air temperature
   * @param {number} [opts.seasonalRangeC] peak-to-trough seasonal swing
   * @param {number} [opts.diurnalRangeC] day-to-night swing
   */
  constructor({
    simSecondsPerDay = 60,
    startDay = 90,
    latitude = 51,
    meanTempC = 10.5,
    seasonalRangeC = 13,
    diurnalRangeC = 8,
  } = {}) {
    this.simSecondsPerDay = simSecondsPerDay;
    this.latitude = latitude;
    this.meanTempC = meanTempC;
    this.seasonalRangeC = seasonalRangeC;
    this.diurnalRangeC = diurnalRangeC;

    this.day = startDay;          // fractional day of year
    this.elapsedDays = 0;         // days since the colony began
    this.frost = false;
  }

  step(dt) {
    const days = dt / this.simSecondsPerDay;
    this.day += days;
    this.elapsedDays += days;
    if (this.day >= 365) this.day -= 365;
    this.frost = this.airTemperature() < 0;
  }

  /** 0 at midnight, 0.5 at noon. */
  get timeOfDay() { return this.day % 1; }

  get dayOfYear() { return Math.floor(this.day); }

  /** Rough month name, for the readout. */
  get monthName() {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return months[Math.min(11, Math.floor((this.day / 365) * 12))];
  }

  get season() {
    const d = this.dayOfYear;
    if (d < 60 || d >= 335) return 'winter';
    if (d < 152) return 'spring';
    if (d < 244) return 'summer';
    return 'autumn';
  }

  /** Solar declination, the tilt that makes seasons. Cooper's approximation. */
  get declination() {
    return 0.4093 * Math.sin((2 * Math.PI * (this.dayOfYear + 284)) / 365);
  }

  /** Daylight length in hours, from latitude and declination. */
  get daylightHours() {
    const lat = (this.latitude * Math.PI) / 180;
    const cosH = -Math.tan(lat) * Math.tan(this.declination);
    if (cosH <= -1) return 24;
    if (cosH >= 1) return 0;
    return (2 * Math.acos(cosH) * 24) / (2 * Math.PI);
  }

  get sunriseHour() { return 12 - this.daylightHours / 2; }
  get sunsetHour() { return 12 + this.daylightHours / 2; }
  get hour() { return this.timeOfDay * 24; }
  get isDaylight() { return this.hour >= this.sunriseHour && this.hour <= this.sunsetHour; }

  /**
   * Sun azimuth in radians, measured clockwise from north: east at sunrise, south at noon, west at
   * sunset. Honey bees translate this bearing into the angle of their waggle run, so it has to
   * actually move across the day — a dance for the same flower patch points somewhere different in
   * the morning and the evening.
   */
  get sunAzimuth() {
    const day = this.daylightHours;
    if (day <= 0) return Math.PI;
    const progress = Math.min(1, Math.max(0, (this.hour - this.sunriseHour) / day));
    // 90 degrees (east) through 180 (south) to 270 (west).
    return ((90 + progress * 180) * Math.PI) / 180;
  }

  /** Height of the sun above the horizon, 0..1, used for light level and warming. */
  get solarElevation() {
    const day = this.daylightHours;
    if (day <= 0 || !this.isDaylight) return 0;
    const progress = (this.hour - this.sunriseHour) / day;
    return Math.sin(progress * Math.PI);
  }

  /**
   * Outside air temperature: an annual sinusoid peaking in late July, plus a daily cycle that is
   * coldest just before dawn and warmest in mid-afternoon.
   */
  airTemperature() {
    const seasonal = this.meanTempC
      - (this.seasonalRangeC / 2) * Math.cos((2 * Math.PI * (this.dayOfYear - 15)) / 365);
    const diurnal = -(this.diurnalRangeC / 2) * Math.cos((2 * Math.PI * (this.hour - 3)) / 24);
    return seasonal + diurnal;
  }
}

/* --------------------------------------------------------------------- brood */

export const STAGE = { EGG: 0, LARVA: 1, PUPA: 2, EMERGED: 3 };
export const STAGE_NAMES = ['egg', 'larva', 'pupa', 'emerged'];

/**
 * Brood as its own pool. Individuals are visible in the nest cutaway, so they are real entities
 * rather than a counter — but they do not move, so they are much cheaper than adults.
 *
 * `fate` lets a scenario mark a cell as destined to become a worker, a gyne or a male, which is the
 * decision that ends every annual colony's year.
 */
export function createBroodPool(capacity) {
  return createPool(capacity, {
    x: 'f32',
    y: 'f32',
    stage: 'u8',
    /** Days spent in the current stage. */
    stageAge: 'f32',
    /** Days since the egg was laid. */
    age: 'f32',
    /** How well fed: 0 starving, 1 fully provisioned. Drives development and survival. */
    nutrition: 'f32',
    /** 0 worker, 1 gyne/queen, 2 male. */
    fate: 'u8',
    /** Scenario-specific: comb cell index, chamber id, and so on. */
    cell: 'i32',
  });
}

/**
 * Temperature response of development, as a scaling factor on rate.
 *
 * Insect development is roughly linear in temperature above a species-specific threshold, then
 * falls away sharply past the optimum. Brood held below the threshold does not develop at all,
 * which is exactly why honey bees work so hard to keep their brood nest at 35 C and why ants carry
 * their brood up and down the nest as the sun moves.
 *
 * @param {number} tempC        current brood temperature
 * @param {number} baseC        developmental zero: no progress at or below this
 * @param {number} optimumC     temperature at which development runs at rate 1
 * @param {number} ceilingC     above this, development stops again (and damage begins)
 */
export function developmentRate(tempC, baseC, optimumC, ceilingC) {
  if (tempC <= baseC) return 0;
  if (tempC >= ceilingC) return 0;
  if (tempC <= optimumC) return (tempC - baseC) / (optimumC - baseC);
  // Past the optimum the fall-off is steeper than the rise.
  return Math.max(0, (ceilingC - tempC) / (ceilingC - optimumC));
}

/**
 * Advance one brood item by `days`. Stage durations are in days at the optimum temperature and come
 * from the scenario's PARAMS table.
 *
 * @param {object} brood  the pool
 * @param {number} i
 * @param {number} days   already scaled by temperature and nutrition by the caller
 * @param {number[]} stageDays  [egg, larva, pupa] durations
 * @returns {'developing'|'emerged'} whether this item completed metamorphosis this step
 */
export function advanceBrood(brood, i, days, stageDays) {
  brood.age[i] += days;
  brood.stageAge[i] += days;

  const stage = brood.stage[i];
  if (stage >= STAGE.EMERGED) return 'emerged';

  if (brood.stageAge[i] >= stageDays[stage]) {
    brood.stageAge[i] -= stageDays[stage];
    brood.stage[i] = stage + 1;
    if (brood.stage[i] === STAGE.EMERGED) return 'emerged';
  }
  return 'developing';
}

/* -------------------------------------------------------------------- larder */

/**
 * The colony's food stores, in grams. Named resources differ per species — nectar and pollen for
 * bees, prey protein and sugar for wasps — so the ledger is generic.
 */
export class Stores {
  constructor(initial = {}) {
    this.amounts = { ...initial };
    this.capacity = {};
    /** Running totals over the colony's life, for the end-of-season summary. */
    this.collected = {};
  }

  get(name) { return this.amounts[name] || 0; }

  setCapacity(name, grams) { this.capacity[name] = grams; }

  /** Add food, returning how much actually fitted. */
  add(name, grams) {
    if (grams <= 0) return 0;
    const cap = this.capacity[name] ?? Infinity;
    const current = this.amounts[name] || 0;
    const accepted = Math.min(grams, cap - current);
    if (accepted <= 0) return 0;
    this.amounts[name] = current + accepted;
    this.collected[name] = (this.collected[name] || 0) + accepted;
    return accepted;
  }

  /** Take food, returning how much was actually available. */
  consume(name, grams) {
    if (grams <= 0) return 0;
    const current = this.amounts[name] || 0;
    const taken = Math.min(grams, current);
    this.amounts[name] = current - taken;
    return taken;
  }

  /** Fraction of capacity used, for the storage readouts. */
  fullness(name) {
    const cap = this.capacity[name];
    if (!cap) return 0;
    return Math.min(1, (this.amounts[name] || 0) / cap);
  }
}

/* ------------------------------------------------------------------ survival */

/**
 * Shared scoring for the survival goal. Each annual colony is playing the same game: convert a
 * season of foraging into reproductives, or into enough stores to overwinter. Scenarios supply the
 * target and the current figure; this just tracks the outcome.
 */
export class SurvivalGoal {
  /**
   * @param {object} opts
   * @param {string} opts.label     what is being counted, e.g. 'gynes produced'
   * @param {number} opts.target    the figure that counts as success
   * @param {string} opts.deadline  human description of when it is judged
   */
  constructor({ label, target, deadline }) {
    this.label = label;
    this.target = target;
    this.deadline = deadline;
    this.value = 0;
    this.outcome = null;     // null while running, then 'success' | 'failure'
    this.reason = '';
  }

  get progress() { return this.target > 0 ? Math.min(1, this.value / this.target) : 0; }

  succeed(reason) {
    if (this.outcome) return;
    this.outcome = 'success';
    this.reason = reason;
  }

  fail(reason) {
    if (this.outcome) return;
    this.outcome = 'failure';
    this.reason = reason;
  }
}
