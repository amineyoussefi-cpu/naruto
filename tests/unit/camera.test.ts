import { describe, expect, it } from 'vitest';
import { bestTarget, cycleTarget, screenAngle, type LockCandidate } from '../../src/camera/targeting';

const view = { x: 0, y: 0, z: 0, yaw: 0 }; // looking toward +Z, screen-right is -X
const c = (id: number, x: number, z: number, alive = true, visible = true): LockCandidate => ({ id, x, y: 0, z, alive, visible });

describe('lock-on targeting', () => {
  it('screen angle is positive to the right', () => {
    expect(screenAngle(view, c(1, -5, 5))).toBeGreaterThan(0);
    expect(screenAngle(view, c(1, 5, 5))).toBeLessThan(0);
  });

  it('picks the centre-most target', () => {
    expect(bestTarget(view, [c(1, 6, 6), c(2, 0.5, 10), c(3, -6, 4)], 25)).toBe(2);
  });

  it('ignores dead targets and prefers visible ones', () => {
    expect(bestTarget(view, [c(1, 0, 5, false), c(2, 4, 8)], 25)).toBe(2);
    expect(bestTarget(view, [c(1, 0, 5, true, false), c(2, 2, 8)], 25)).toBe(2);
  });

  it('ignores out-of-range targets', () => {
    expect(bestTarget(view, [c(1, 0, 30)], 25)).toBeNull();
    expect(bestTarget(view, [], 25)).toBeNull();
  });

  it('cycles left to right and wraps', () => {
    const list = [c(1, 5, 5), c(2, 0, 8), c(3, -5, 5), c(4, 0, 40)];
    expect(cycleTarget(view, list, 1, 25)).toBe(2);
    expect(cycleTarget(view, list, 2, 25)).toBe(3);
    expect(cycleTarget(view, list, 3, 25)).toBe(1);
    expect(cycleTarget(view, list, 99, 25)).toBe(2);
  });

  it('excludes the given id when re-acquiring', () => {
    expect(bestTarget(view, [c(1, 0, 5), c(2, 3, 9)], 25, 1)).toBe(2);
  });
});
