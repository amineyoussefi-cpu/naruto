import { describe, expect, it } from 'vitest';
import { Fighter } from '../../src/sim/combat/Fighter';
import { CHAKRA } from '../../src/config/chakra';
import { COMBAT } from '../../src/config/combat';

const DT = 1 / 60;
const run = (f: Fighter, seconds: number) => { for (let t = 0; t < seconds - 1e-9; t += DT) f.tick(DT); };
const make = () => new Fighter({ maxHp: 100, maxChakra: 100 }, 0.25);

describe('Fighter chakra', () => {
  it('spends chakra only when enough is available', () => {
    const f = make();
    expect(f.trySpendChakra(60)).toBe(true);
    expect(f.chakra).toBe(40);
    expect(f.trySpendChakra(60)).toBe(false);
    expect(f.chakra).toBe(40);
  });

  it('waits regenDelay before passive regen', () => {
    const f = make();
    f.trySpendChakra(50);
    run(f, CHAKRA.regenDelay - 0.1);
    expect(f.chakra).toBe(50);
    run(f, 1.1);
    expect(f.chakra).toBeGreaterThan(50);
    expect(f.chakra).toBeLessThanOrEqual(50 + CHAKRA.regenPerSecond * 1.01);
  });

  it('concentration regens at its rate after startup, ignoring the regen delay', () => {
    const f = make();
    f.trySpendChakra(90);
    f.concentrating = true;
    run(f, CHAKRA.concentrateStartup - DT);
    expect(f.chakra).toBe(10);
    run(f, 1 + DT);
    expect(f.chakra).toBeCloseTo(10 + CHAKRA.concentrateRegenPerSecond, 0);
  });

  it('a landed hit cancels concentration; an ignored one does not', () => {
    const f = make();
    f.concentrating = true;
    f.setInvulnerable(1);
    expect(f.applyHit({ damage: 5 }).ignored).toBe(true);
    expect(f.concentrating).toBe(true);
    run(f, 1.1);
    f.concentrating = true;
    expect(f.applyHit({ damage: 5 }).ignored).toBe(false);
    expect(f.concentrating).toBe(false);
  });

  it('caps chakra at max', () => {
    const f = make();
    f.concentrating = true;
    run(f, 5);
    expect(f.chakra).toBe(100);
  });
});

describe('Fighter hits', () => {
  it('guard applies the guard factor', () => {
    const f = make();
    f.guarding = true;
    const r = f.applyHit({ damage: 40 });
    expect(r).toMatchObject({ applied: 10, blocked: true, ignored: false });
    expect(f.hp).toBe(90);
    expect(f.applyHit({ damage: 40, unblockable: true }).applied).toBe(40);
  });

  it('invulnerability ignores hits until it expires', () => {
    const f = make();
    f.setInvulnerable(0.25);
    expect(f.applyHit({ damage: 10 }).ignored).toBe(true);
    expect(f.hp).toBe(100);
    run(f, 0.3);
    expect(f.applyHit({ damage: 10 }).applied).toBe(10);
  });

  it('dies at 0 HP and nothing changes afterwards', () => {
    const f = make();
    f.trySpendChakra(50);
    f.startCooldown('dodge', 1);
    const r = f.applyHit({ damage: 150 });
    expect(r).toMatchObject({ applied: 100, killed: true });
    expect(f.alive).toBe(false);
    expect(f.applyHit({ damage: 10 }).ignored).toBe(true);
    f.concentrating = true;
    run(f, 10);
    f.addChakra(20);
    expect(f.hp).toBe(0);
    expect(f.chakra).toBe(50);
    expect(f.cooldownRemaining('dodge')).toBe(1);
    expect(f.trySpendChakra(1)).toBe(false);
  });

  it('stun expires with ticks', () => {
    const f = make();
    f.setStun(0.35);
    expect(f.stunned).toBe(true);
    run(f, 0.4);
    expect(f.stunned).toBe(false);
  });
});

describe('Fighter substitution gauge', () => {
  it('spends a cost, refuses when low and regenerates while alive', () => {
    const f = make();
    const s = COMBAT.substitution;
    expect(f.substitution).toBe(s.max);
    while (f.trySpendSubstitution());
    expect(f.substitution).toBeLessThan(s.cost);
    const before = f.substitution;
    run(f, 1);
    expect(f.substitution).toBeCloseTo(before + s.regenPerSecond, 1);
    f.applyHit({ damage: 1000 });
    const dead = f.substitution;
    run(f, 1);
    expect(f.substitution).toBe(dead);
  });

  it('clearStun ends stun immediately', () => {
    const f = make();
    f.setStun(1);
    f.clearStun();
    expect(f.stunned).toBe(false);
  });
});

describe('Fighter cooldowns and pause', () => {
  it('cooldowns count down and become ready', () => {
    const f = make();
    expect(f.cooldownReady('kunai')).toBe(true);
    f.startCooldown('kunai', 0.45);
    expect(f.cooldownReady('kunai')).toBe(false);
    run(f, 0.3);
    expect(f.cooldownRemaining('kunai')).toBeCloseTo(0.15, 2);
    run(f, 0.2);
    expect(f.cooldownReady('kunai')).toBe(true);
  });

  it('no tick (paused) means no state change', () => {
    const f = make();
    f.trySpendChakra(50);
    f.startCooldown('special', 6);
    f.setStun(1);
    f.setInvulnerable(1);
    f.concentrating = true;
    const snap = JSON.stringify([f.hp, f.chakra, f.cooldownRemaining('special'), f.stunRemaining, f.invulnerable]);
    // Simulated pause: arbitrary wall time passes, no tick() calls.
    expect(JSON.stringify([f.hp, f.chakra, f.cooldownRemaining('special'), f.stunRemaining, f.invulnerable])).toBe(snap);
  });

  it('reset restores everything', () => {
    const f = make();
    f.applyHit({ damage: 200 });
    f.reset();
    expect(f.alive).toBe(true);
    expect(f.hp).toBe(100);
    expect(f.chakra).toBe(100);
  });
});

describe('chakra v4', () => {
  it('pool is tripled and a passive refill takes about as long as before (100 / 4 per s)', () => {
    expect(COMBAT.player.maxChakra).toBe(300);
    expect(COMBAT.player.maxChakra / CHAKRA.regenPerSecond).toBeCloseTo(100 / 4, 0);
    expect(COMBAT.player.maxChakra / CHAKRA.concentrateRegenPerSecond).toBeCloseTo(100 / 30, 0);
    // several techniques per full bar
    expect(COMBAT.player.maxChakra / COMBAT.sharingan.chakraCost).toBeGreaterThanOrEqual(3);
    expect(COMBAT.player.maxChakra / COMBAT.special.chakraCost).toBeGreaterThanOrEqual(6);
  });
});
