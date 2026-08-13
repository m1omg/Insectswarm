// Fixed-timestep simulation loop with interpolated rendering.
//
// The simulation advances in constant DT slices regardless of how fast the display refreshes, so a
// 144 Hz laptop and a 30 Hz phone run the identical simulation — they just draw it a different
// number of times. Rendering receives the leftover fraction of a step (`alpha`) so motion stays
// smooth between ticks, and must not mutate simulation state.

/** One simulation tick, in seconds. Every biological rate is expressed against this. */
export const DT = 1 / 60;

/** A frame delta longer than this is treated as a stall (tab switch, GC pause) and discarded. */
const MAX_FRAME_SECONDS = 0.25;

export class Loop {
  /**
   * @param {object} opts
   * @param {(dt:number)=>void} opts.step      advance the simulation by exactly dt seconds
   * @param {(alpha:number, frameSeconds:number)=>void} opts.render
   * @param {number} [opts.budgetMs]  wall-clock ceiling for the step batch in one frame
   */
  constructor({ step, render, budgetMs = 12 }) {
    this.stepFn = step;
    this.renderFn = render;
    this.budgetMs = budgetMs;

    this.speed = 1;          // simulation-time multiplier
    this.paused = false;
    this.running = false;

    this.accumulator = 0;
    this.lastTime = 0;
    this.simTime = 0;        // total simulated seconds elapsed
    this.tickCount = 0;

    // Rolling diagnostics for the HUD.
    this.fps = 0;
    this.stepsLastFrame = 0;
    this.throttled = false;  // true when the step batch hit its time budget

    this._frame = this._frame.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    document.addEventListener('visibilitychange', this._onVisibility);
    this.rafId = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  setPaused(paused) {
    // Dropping the accumulator on resume stops a paused stretch from being replayed in one lurch.
    if (!paused && this.paused) {
      this.lastTime = performance.now();
      this.accumulator = 0;
    }
    this.paused = paused;
  }

  setSpeed(multiplier) {
    this.speed = Math.max(0, multiplier);
  }

  /** Run exactly one tick while paused, for frame-by-frame inspection. */
  singleStep() {
    this.stepFn(DT);
    this.simTime += DT;
    this.tickCount++;
  }

  _onVisibility() {
    // A backgrounded tab stops firing rAF; without this the first frame back would carry a huge
    // delta. The clamp below would catch it anyway, but resetting is cheaper and clearer.
    if (!document.hidden) {
      this.lastTime = performance.now();
      this.accumulator = 0;
    }
  }

  _frame(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._frame);

    let frameSeconds = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Guard against stalls, negative deltas from clock adjustments, and the first frame.
    if (!(frameSeconds > 0)) frameSeconds = 0;
    if (frameSeconds > MAX_FRAME_SECONDS) frameSeconds = MAX_FRAME_SECONDS;

    this.fps += (1 / Math.max(frameSeconds, 1e-6) - this.fps) * 0.1;

    if (!this.paused && this.speed > 0) {
      this.accumulator += frameSeconds * this.speed;

      // At high speed multipliers we need many ticks per frame, but never so many that the frame
      // budget blows out. Whatever we cannot afford is dropped rather than deferred: falling behind
      // makes the simulation run slower than requested, which is far better than a death spiral.
      const startedAt = performance.now();
      let steps = 0;
      this.throttled = false;

      while (this.accumulator >= DT) {
        this.stepFn(DT);
        this.accumulator -= DT;
        this.simTime += DT;
        this.tickCount++;
        steps++;

        if (steps % 4 === 0 && performance.now() - startedAt > this.budgetMs) {
          this.throttled = true;
          this.accumulator = 0;
          break;
        }
      }
      this.stepsLastFrame = steps;
    } else {
      this.stepsLastFrame = 0;
    }

    // Fraction of the way into the next tick, for smoothing drawn positions between states.
    const alpha = this.paused ? 0 : this.accumulator / DT;
    this.renderFn(alpha, frameSeconds);
  }
}

/**
 * Drive a simulation deterministically without a display, for tests and headless verification.
 * Feeds `frameDeltas` (seconds) through the same accumulator arithmetic as the live loop, so a test
 * can prove that 30 Hz, 60 Hz and 144 Hz frame patterns yield an identical number of ticks.
 */
export function runHeadless(stepFn, frameDeltas) {
  let accumulator = 0;
  let ticks = 0;
  for (let raw of frameDeltas) {
    if (!(raw > 0)) raw = 0;
    if (raw > MAX_FRAME_SECONDS) raw = MAX_FRAME_SECONDS;
    accumulator += raw;
    while (accumulator >= DT) {
      stepFn(DT);
      accumulator -= DT;
      ticks++;
    }
  }
  return ticks;
}
