import { describe, expect, it } from 'vitest';
import { EnemyAI } from '../../src/ai/EnemyAI';
import { WaveManager } from '../../src/ai/WaveManager';
import { WAVES } from '../../src/config/waves';
import { makeCtx, seeded } from './aiHelpers';

const DT = 1 / 60;

describe('WaveManager', () => {
  it('progresses through every wave to victory', () => {
    const { ctx, player } = makeCtx();
    player.position.set(0, 0, 0);
    const ai = new EnemyAI(ctx, seeded(3));
    const wm = new WaveManager(ctx, ai, seeded(7));
    const log: string[] = [];
    ctx.events.on('waveStart', (e) => log.push(`start${e.wave}:${e.enemies}`));
    ctx.events.on('waveCleared', (e) => log.push(`clear${e.wave}`));
    ctx.events.on('victory', () => log.push('victory'));
    wm.start();
    expect(wm.wave).toBe(0);
    expect(wm.intermission).toBeGreaterThan(0);
    for (let step = 0; step < 60 * 120 && !log.includes('victory'); step++) {
      wm.update(DT);
      // Kill everything once the wave is fully spawned.
      if (wm.intermission === 0 && wm.remaining === ctx.enemies().length) {
        for (const e of ctx.enemies()) {
          expect(e.position.distanceTo(player.position)).toBeGreaterThan(15); // far spawn points only
          e.fighter.hp = 0;
        }
      }
    }
    const expected = WAVES.flatMap((w, i) => [`start${i + 1}:${w.melee + w.ranged}`, `clear${i + 1}`]);
    expect(log).toEqual([...expected, 'victory']);
    expect(wm.wave).toBe(WAVES.length);
  });

  it('emits enemiesRemaining on changes and reset() returns to a clean state', () => {
    const { ctx } = makeCtx();
    const wm = new WaveManager(ctx, new EnemyAI(ctx), seeded(1));
    const counts: number[] = [];
    ctx.events.on('enemiesRemaining', (e) => counts.push(e.count));
    wm.start();
    for (let i = 0; i < 60 * 5; i++) wm.update(DT);
    expect(ctx.enemies().length).toBe(WAVES[0].melee + WAVES[0].ranged);
    ctx.enemies()[0].fighter.hp = 0;
    wm.update(DT);
    expect(counts.at(-1)).toBe(ctx.enemies().length);
    wm.reset();
    expect(wm.wave).toBe(0);
    expect(wm.intermission).toBe(0);
    for (let i = 0; i < 60 * 10; i++) wm.update(DT);
    expect(wm.wave).toBe(0);
  });
});
