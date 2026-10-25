/**
 * Fixed-timestep accumulator. Simulation advances in constant `step` slices
 * regardless of frame rate; rendering interpolates with `alpha`.
 */
export class FixedStepper {
  private acc = 0;
  constructor(readonly step: number, readonly maxFrame = 0.25) {}

  /** Returns how many simulation steps to run for this frame. */
  advance(frameDt: number): number {
    this.acc += Math.min(Math.max(frameDt, 0), this.maxFrame);
    const n = Math.floor(this.acc / this.step);
    this.acc -= n * this.step;
    return n;
  }

  get alpha(): number {
    return this.acc / this.step;
  }

  /** Drop leftover time, e.g. when resuming from pause, so no time jump happens. */
  reset(): void {
    this.acc = 0;
  }
}
