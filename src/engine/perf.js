// Device capability probing and adaptive quality.
//
// A colony is thousands of individuals at 60 Hz. A desktop can draw all of them; a mid-range phone
// cannot. Rather than shipping one compromise, we guess a tier up front from what the browser will
// tell us, then adapt: if frames are consistently slow we shed agents and coarsen the pheromone
// grid, and if there is headroom to spare we give some back.

/** Static guess from device hints, before we have measured anything. */
export function probeDevice() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;          // GiB, Chromium only
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const smallScreen = Math.min(window.screen?.width || 1024, window.screen?.height || 768) < 500;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  let tier = 'medium';
  if (cores >= 8 && memory >= 8 && !coarsePointer) tier = 'high';
  else if (cores <= 4 || memory <= 3 || (coarsePointer && smallScreen)) tier = 'low';

  return { tier, cores, memory, coarsePointer, smallScreen, reducedMotion };
}

/** Budgets per tier. `agents` is the population ceiling; `field` is the pheromone grid width. */
export const TIERS = {
  low:    { agents: 700,  fieldWidth: 128, trails: false, shadows: false },
  medium: { agents: 1800, fieldWidth: 192, trails: true,  shadows: false },
  high:   { agents: 4000, fieldWidth: 256, trails: true,  shadows: true  },
};

const ORDER = ['low', 'medium', 'high'];

export class QualityManager {
  /** @param {(budget:object, tier:string)=>void} [onChange] */
  constructor(onChange) {
    this.device = probeDevice();
    this.tier = this.device.tier;
    this.scale = 1;                 // fine-grained multiplier on top of the tier
    this.onChange = onChange;
    this.frameMs = 16.7;
    this.slowFrames = 0;
    this.fastFrames = 0;
    this.locked = false;            // set true when the user picks a tier by hand
    this.samples = 0;
  }

  get budget() {
    const base = TIERS[this.tier];
    return {
      ...base,
      agents: Math.round(base.agents * this.scale),
      fieldWidth: Math.round(base.fieldWidth * Math.sqrt(this.scale) / 8) * 8,
    };
  }

  setTier(tier) {
    if (!TIERS[tier]) return;
    this.tier = tier;
    this.scale = 1;
    this.locked = true;
    this.onChange?.(this.budget, this.tier);
  }

  setAuto() {
    this.locked = false;
    this.slowFrames = this.fastFrames = 0;
  }

  /**
   * Feed one frame's wall-clock duration. Adaptation is deliberately sluggish — a couple of seconds
   * of consistently bad frames, not one hitch — so the quality does not oscillate visibly.
   */
  sample(frameSeconds) {
    this.samples++;
    const ms = frameSeconds * 1000;
    this.frameMs += (ms - this.frameMs) * 0.05;

    // Ignore the first second: startup, font loading and layer baking are not representative.
    if (this.locked || this.samples < 60) return;

    if (this.frameMs > 26) {          // below roughly 38 fps
      this.slowFrames++;
      this.fastFrames = 0;
    } else if (this.frameMs < 15) {   // comfortable headroom
      this.fastFrames++;
      this.slowFrames = 0;
    } else {
      this.slowFrames = this.fastFrames = 0;
    }

    if (this.slowFrames > 120) {
      this._adjust(-1);
      this.slowFrames = 0;
    } else if (this.fastFrames > 600) {
      this._adjust(+1);
      this.fastFrames = 0;
    }
  }

  _adjust(direction) {
    const before = this.scale;
    const beforeTier = this.tier;

    if (direction < 0) {
      if (this.scale > 0.55) this.scale = Math.max(0.5, this.scale - 0.25);
      else {
        const i = ORDER.indexOf(this.tier);
        if (i > 0) { this.tier = ORDER[i - 1]; this.scale = 1; }
      }
    } else {
      if (this.scale < 1) this.scale = Math.min(1, this.scale + 0.25);
      else {
        const i = ORDER.indexOf(this.tier);
        if (i < ORDER.length - 1 && i < ORDER.indexOf(this.device.tier)) {
          this.tier = ORDER[i + 1];
          this.scale = 1;
        }
      }
    }

    if (this.scale !== before || this.tier !== beforeTier) this.onChange?.(this.budget, this.tier);
  }
}
