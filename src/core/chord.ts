/**
 * Detects two buttons pressed "together" (within a window). Presses of either button are held back
 * for the window; if the other button arrives in time it is a chord and both presses are swallowed
 * (and stay suppressed until released). Otherwise the press is delivered late (or on release for
 * a quick click). Pure: callers pass timestamps (ms).
 */
export class ChordDetector {
  private pending = new Map<string, number>();
  private chordHeld = new Set<string>();

  constructor(private readonly a: string, private readonly b: string, private readonly windowMs: number) {}

  handles(code: string): boolean {
    return code === this.a || code === this.b;
  }

  /** Returns true when this press completes a chord. */
  press(code: string, now: number): boolean {
    const other = code === this.a ? this.b : this.a;
    const t = this.pending.get(other);
    if (t !== undefined && now - t <= this.windowMs) {
      this.pending.delete(other);
      this.chordHeld.add(this.a).add(this.b);
      return true;
    }
    this.pending.set(code, now);
    return false;
  }

  /** Returns true when a still-pending press must be delivered now (quick click released inside the window). */
  release(code: string): boolean {
    this.chordHeld.delete(code);
    return this.pending.delete(code);
  }

  /** Presses whose window expired without a chord: deliver them as normal presses. */
  flush(now: number): string[] {
    const out: string[] = [];
    for (const [code, t] of this.pending) if (now - t > this.windowMs) { out.push(code); this.pending.delete(code); }
    return out;
  }

  /** While pending or part of a chord, the button must not count as held for its normal action. */
  suppressed(code: string): boolean {
    return this.pending.has(code) || this.chordHeld.has(code);
  }

  reset(): void {
    this.pending.clear();
    this.chordHeld.clear();
  }
}
