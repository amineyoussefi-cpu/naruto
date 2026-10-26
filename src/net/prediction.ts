/** Client-side prediction helpers: input history + reconciliation, and visual correction smoothing. */
import { NET } from '../config/net';
import type { Vec3Like } from '../core/types';
import type { PlayerInput } from '../sim/protocol';

/**
 * Inputs sent but not yet acknowledged by the server, each with the state predicted after applying it.
 * `S` is whatever the caller predicts (e.g. position + velocity); `distance` measures the prediction error.
 */
export class InputHistory<S> {
  private entries: { input: PlayerInput; state: S }[] = [];

  constructor(private readonly distance: (a: S, b: S) => number, private readonly epsilon: number = NET.reconcileEpsilon) {}

  /** Records an input once applied locally, with the predicted state after it. */
  record(input: PlayerInput, predicted: S): void { this.entries.push({ input, state: predicted }); }

  /** Inputs not acknowledged yet, oldest first. */
  get pending(): readonly PlayerInput[] { return this.entries.map((e) => e.input); }

  /**
   * On a snapshot: drops inputs up to `ackSeq`. If the state predicted for `ackSeq` is further than epsilon from
   * `serverState` (or unknown), calls `reset(serverState)` then `replay(input)` for each pending input, oldest first,
   * storing the state `replay` returns. Returns true when it corrected.
   */
  reconcile(ackSeq: number, serverState: S, replay: (input: PlayerInput) => S, reset: (state: S) => void): boolean {
    const acked = this.entries.find((e) => e.input.seq === ackSeq);
    this.entries = this.entries.filter((e) => e.input.seq > ackSeq);
    if (acked && this.distance(acked.state, serverState) <= this.epsilon) return false;
    reset(serverState);
    for (const e of this.entries) e.state = replay(e.input);
    return true;
  }

  clear(): void { this.entries = []; }
}

/**
 * Hides a reconciliation jump: render at `predicted + offset`, where the offset starts at (old − new) and
 * decays linearly to 0 over `smoothMs`; jumps longer than `snapDistance` snap (offset 0). Render-time only.
 */
export class CorrectionSmoother {
  readonly offset: Vec3Like = { x: 0, y: 0, z: 0 };
  private remainingMs = 0;

  constructor(private readonly smoothMs: number = NET.smoothMs, private readonly snapDistance: number = NET.snapDistance) {}

  /** Adds a correction: `from` = position shown before, `to` = new predicted position. */
  correct(from: Vec3Like, to: Vec3Like): void {
    const o = this.offset;
    o.x += from.x - to.x; o.y += from.y - to.y; o.z += from.z - to.z;
    if (Math.hypot(o.x, o.y, o.z) > this.snapDistance) { o.x = o.y = o.z = 0; this.remainingMs = 0; return; }
    this.remainingMs = this.smoothMs;
  }

  /** Advances by a render frame and returns the offset to add to the predicted position. */
  update(frameDtMs: number): Vec3Like {
    const o = this.offset;
    if (this.remainingMs <= 0) { o.x = o.y = o.z = 0; return o; }
    const k = Math.max(0, this.remainingMs - frameDtMs) / this.remainingMs;
    o.x *= k; o.y *= k; o.z *= k;
    this.remainingMs -= frameDtMs;
    return o;
  }
}
