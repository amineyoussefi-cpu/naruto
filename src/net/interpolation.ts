/** Snapshot interpolation buffer for remote actors (render-side, wall-clock ms in, no DOM). */
import { SIM_DT } from '../config';
import { NET } from '../config/net';
import type { Snapshot } from '../sim/protocol';

export interface InterpSample {
  /** Snapshots bracketing the render time (a === b when outside the buffer). */
  a: Snapshot;
  b: Snapshot;
  /** Blend factor 0..1 from a to b. */
  t: number;
}

export class SnapshotBuffer {
  private snaps: Snapshot[] = [];
  /** Smoothed (arrival ms − server ms); null until the first snapshot. */
  private offset: number | null = null;

  constructor(private readonly delayMs: number = NET.interpDelayMs) {}

  /** Adds a snapshot (in tick order) with its local arrival time. */
  push(snap: Snapshot, arrivalMs: number): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && snap.tick <= last.tick) return;
    this.snaps.push(snap);
    if (this.snaps.length > NET.interpBufferMax) this.snaps.shift();
    const sample = arrivalMs - snap.tick * SIM_DT * 1000;
    if (this.offset === null || Math.abs(sample - this.offset) > NET.clockResetMs) this.offset = sample;
    else this.offset += (sample - this.offset) * NET.clockSmoothing;
  }

  /** Newest snapshot received, or null. */
  get latest(): Snapshot | null { return this.snaps[this.snaps.length - 1] ?? null; }

  /** Server time (s) rendered at `nowMs` = now − offset − delay. */
  renderTime(nowMs: number): number {
    return ((nowMs - (this.offset ?? nowMs)) - this.delayMs) / 1000;
  }

  /** Snapshots bracketing `nowMs − delay` in server time, or null when empty. Drops snapshots no longer needed. */
  sample(nowMs: number): InterpSample | null {
    const s = this.snaps;
    if (!s.length) return null;
    const target = this.renderTime(nowMs);
    const time = (x: Snapshot): number => x.tick * SIM_DT;
    if (target <= time(s[0])) return { a: s[0], b: s[0], t: 0 };
    let i = 0;
    while (i < s.length - 1 && time(s[i + 1]) < target) i++;
    if (i > 0) { s.splice(0, i); i = 0; }
    if (s.length === 1) return { a: s[0], b: s[0], t: 1 };
    const a = s[0], b = s[1];
    return { a, b, t: Math.min(1, (target - time(a)) / (time(b) - time(a))) };
  }

  clear(): void { this.snaps = []; this.offset = null; }
}
