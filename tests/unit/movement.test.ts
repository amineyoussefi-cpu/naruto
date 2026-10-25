import { describe, expect, it } from 'vitest';
import { FootstepTimer, JumpAssist, approachXZ, drainClimbChakra, jumpVelocity, turnToward } from '../../src/player/movementMath';
import { MOVEMENT } from '../../src/config/movement';

const DT = 1 / 60;

describe('jumpVelocity', () => {
  it('reaches the requested apex height', () => {
    const v = jumpVelocity(MOVEMENT.jumpHeight, MOVEMENT.gravity);
    expect((v * v) / (2 * MOVEMENT.gravity)).toBeCloseTo(MOVEMENT.jumpHeight, 6);
  });
});

describe('JumpAssist', () => {
  it('allows a jump shortly after leaving the ground (coyote time)', () => {
    const j = new JumpAssist(0.12, 0.12);
    j.update(DT, true, false);
    for (let i = 0; i < 5; i++) expect(j.update(DT, false, false)).toBe(false);
    expect(j.update(DT, false, true)).toBe(true);
  });
  it('rejects a jump after coyote time expires', () => {
    const j = new JumpAssist(0.12, 0.12);
    j.update(DT, true, false);
    for (let i = 0; i < 10; i++) j.update(DT, false, false);
    expect(j.update(DT, false, true)).toBe(false);
  });
  it('buffers a press made just before landing, once', () => {
    const j = new JumpAssist(0.12, 0.12);
    expect(j.update(DT, false, true)).toBe(false);
    for (let i = 0; i < 4; i++) j.update(DT, false, false);
    expect(j.update(DT, true, false)).toBe(true);
    expect(j.update(DT, true, false)).toBe(false);
  });
  it('drops a press made too early', () => {
    const j = new JumpAssist(0.12, 0.12);
    j.update(DT, false, true);
    for (let i = 0; i < 10; i++) j.update(DT, false, false);
    expect(j.update(DT, true, false)).toBe(false);
  });
});

describe('approachXZ', () => {
  it('reaches top speed in v/a seconds without overshoot', () => {
    const v = { x: 0, z: 0 };
    const target = { x: MOVEMENT.runSpeed, z: 0 };
    let t = 0;
    while (v.x < target.x) { approachXZ(v, target, MOVEMENT.acceleration * DT); t += DT; }
    expect(v.x).toBe(target.x);
    expect(t).toBeCloseTo(MOVEMENT.runSpeed / MOVEMENT.acceleration, 1);
  });
  it('gives the same velocity at the same time for one 60 Hz step vs two 120 Hz steps', () => {
    const a = { x: 0, z: 0 }, b = { x: 0, z: 0 }, target = { x: 3, z: 4 };
    approachXZ(a, target, MOVEMENT.acceleration * DT);
    approachXZ(b, target, MOVEMENT.acceleration * DT / 2);
    approachXZ(b, target, MOVEMENT.acceleration * DT / 2);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
  });
});

describe('turnToward', () => {
  it('takes the short way across ±π and clamps the step', () => {
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1, 6);
    expect(turnToward(0, 0.05, 0.1)).toBe(0.05);
  });
});

describe('climb chakra drain', () => {
  it('drains per second and stops when chakra runs out', () => {
    const fighter = { chakra: 10, trySpendChakra(n: number) { if (this.chakra < n) return false; this.chakra -= n; return true; } };
    let steps = 0;
    while (drainClimbChakra(fighter, MOVEMENT.climbChakraPerSecond, DT)) steps++;
    expect(steps * DT).toBeCloseTo(10 / MOVEMENT.climbChakraPerSecond, 1);
    expect(fighter.chakra).toBeGreaterThanOrEqual(0);
  });
});

describe('FootstepTimer', () => {
  it('emits once per stride', () => {
    const f = new FootstepTimer();
    let n = 0;
    for (let i = 0; i < 60; i++) if (f.update(MOVEMENT.runSpeed, DT, MOVEMENT.runStride)) n++;
    expect(n).toBe(Math.floor(MOVEMENT.runSpeed / MOVEMENT.runStride));
  });
});
