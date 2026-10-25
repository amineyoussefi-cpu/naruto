import { describe, expect, it } from 'vitest';
import { EnemyAI, type EnemyState } from '../../src/ai/EnemyAI';
import { ENEMIES } from '../../src/config/enemies';
import { makeActor, makeCtx } from './aiHelpers';

const DT = 1 / 60;
const never = () => 0.99; // never dodge / retreat

function run(ai: EnemyAI, seconds: number, each?: () => void) {
  for (let i = 0; i < Math.round(seconds / DT); i++) { ai.update(DT); each?.(); }
}

describe('EnemyAI melee', () => {
  it('chases, telegraphs, attacks with scaled damage, then recovers', () => {
    const { ctx, hitboxes, actors } = makeCtx();
    const e = makeActor('melee', 0, 10);
    actors.push(e);
    const ai = new EnemyAI(ctx, never);
    ai.register(e);
    const seen = new Set<EnemyState>();
    const telegraphs: number[] = [];
    ctx.events.on('telegraph', (t) => telegraphs.push(t.id));
    run(ai, 5, () => seen.add(ai.stateOf(e)));
    for (const s of ['detect', 'chase', 'attack', 'recover'] as const) expect(seen.has(s)).toBe(true);
    expect(e.position.distanceTo(ctx.player.position)).toBeLessThan(ENEMIES.melee.attackRange + 0.5);
    expect(hitboxes.length).toBeGreaterThan(0);
    expect(hitboxes[0]).toMatchObject({ kind: 'enemyMelee', damage: ENEMIES.melee.damage * 2, owner: e });
    expect(telegraphs[0]).toBe(e.id);
  });

  it('goes hurt while stunned and stops attacking when the player is dead', () => {
    const { ctx, player, hitboxes, actors } = makeCtx();
    const e = makeActor('melee', 0, 1.5);
    actors.push(e);
    const ai = new EnemyAI(ctx, never);
    ai.register(e);
    run(ai, 0.5);
    e.fighter.setStun(1);
    ai.update(DT);
    expect(ai.stateOf(e)).toBe('hurt');
    expect(ai.isTelegraphing(e)).toBe(false);
    player.fighter.hp = 0;
    e.fighter.setStun(0); e.fighter.tick(2);
    hitboxes.length = 0;
    run(ai, 3);
    expect(hitboxes.length).toBe(0);
    expect(ai.stateOf(e)).toBe('idle');
    e.fighter.hp = 0;
    ai.update(DT);
    expect(ai.stateOf(e)).toBe('dead');
  });
});

describe('EnemyAI ranged', () => {
  it('keeps its distance and throws shuriken', () => {
    const { ctx, projectiles, actors } = makeCtx();
    const e = makeActor('ranged', 0, 3); // too close
    actors.push(e);
    const ai = new EnemyAI(ctx, never);
    ai.register(e);
    const seen = new Set<EnemyState>();
    run(ai, 8, () => seen.add(ai.stateOf(e)));
    const d = e.position.length();
    expect(d).toBeGreaterThanOrEqual(ENEMIES.ranged.minRange);
    expect(d).toBeLessThan(ENEMIES.ranged.preferredRange + ENEMIES.ranged.rangeBand + 1);
    expect(seen.has('reposition')).toBe(true);
    expect(projectiles.length).toBeGreaterThan(0);
    expect(projectiles[0]).toMatchObject({ kind: 'enemyRanged', visual: 'shuriken', damage: ENEMIES.ranged.damage * 2 });
  });
});

describe('attack token director', () => {
  it('never lets more than maxSimultaneousAttackers attack at once', () => {
    const { ctx, actors } = makeCtx();
    const ai = new EnemyAI(ctx, never);
    const es = [0, 1, 2, 3, 4, 5].map((i) => makeActor('melee', Math.cos(i) * 1.2, Math.sin(i) * 1.2));
    for (const e of es) { actors.push(e); ai.register(e); }
    let peak = 0;
    run(ai, 6, () => {
      const n = es.filter((e) => ai.stateOf(e) === 'attack').length;
      expect(n).toBeLessThanOrEqual(ENEMIES.maxSimultaneousAttackers);
      peak = Math.max(peak, n);
    });
    expect(peak).toBe(ENEMIES.maxSimultaneousAttackers);
  });
});
