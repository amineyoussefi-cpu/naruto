import * as THREE from 'three';
import { WAVES, WAVE_INTERMISSION, WAVE_SPAWN_JITTER, WAVE_SPAWN_STAGGER, WAVE_START_DELAY } from '../config/waves';
import type { GameContext } from '../game/context';
import type { EnemyAI } from './EnemyAI';

type Phase = 'idle' | 'intermission' | 'fighting' | 'done';

/**
 * Spawns waves with increasing difficulty, tracks remaining enemies,
 * emits waveStart / waveCleared / enemiesRemaining / victory. Owner: AI agent.
 */
export class WaveManager {
  wave = 0;
  readonly totalWaves = WAVES.length;
  /** Seconds before the next wave begins (0 while a wave is active). */
  intermission = 0;
  private phase: Phase = 'idle';
  private queue: ('melee' | 'ranged')[] = [];
  private spawnTimer = 0;
  private spawnIndex = 0;
  private lastRemaining = -1;

  constructor(private readonly ctx: GameContext, private readonly ai: EnemyAI, private readonly rng: () => number = Math.random) {}

  /** Living enemies plus those still waiting to spawn in this wave. */
  get remaining(): number { return this.ctx.enemies().length + this.queue.length; }

  start(): void {
    this.reset();
    this.phase = 'intermission';
    this.intermission = WAVE_START_DELAY;
  }

  update(dt: number): void {
    if (this.phase === 'idle' || this.phase === 'done' || !this.ctx.player.alive) return;
    if (this.phase === 'intermission') {
      this.intermission = Math.max(0, this.intermission - dt);
      if (this.intermission <= 0) this.beginWave();
      return;
    }
    if (this.queue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = WAVE_SPAWN_STAGGER;
        this.spawn(this.queue.shift()!);
      }
    }
    const left = this.remaining;
    if (left !== this.lastRemaining) {
      this.lastRemaining = left;
      this.ctx.events.emit('enemiesRemaining', { count: left });
    }
    if (left > 0) return;
    this.ctx.events.emit('waveCleared', { wave: this.wave });
    if (this.wave >= this.totalWaves) {
      this.phase = 'done';
      this.ctx.events.emit('victory', {});
    } else {
      this.phase = 'intermission';
      this.intermission = WAVE_INTERMISSION;
    }
  }

  reset(): void {
    this.wave = 0;
    this.intermission = 0;
    this.phase = 'idle';
    this.queue = [];
    this.spawnTimer = 0;
    this.spawnIndex = 0;
    this.lastRemaining = -1;
  }

  private beginWave(): void {
    const w = WAVES[this.wave];
    this.wave++;
    this.phase = 'fighting';
    this.intermission = 0;
    this.spawnTimer = 0;
    this.spawnIndex = 0;
    // Interleave kinds so ranged ninjas don't all arrive last.
    const q: ('melee' | 'ranged')[] = [];
    for (let i = 0; i < Math.max(w.melee, w.ranged); i++) {
      if (i < w.melee) q.push('melee');
      if (i < w.ranged) q.push('ranged');
    }
    this.queue = q;
    this.ctx.events.emit('waveStart', { wave: this.wave, totalWaves: this.totalWaves, enemies: q.length });
  }

  private spawn(kind: 'melee' | 'ranged'): void {
    const p = this.ctx.player.position;
    // Farthest half of the spawn points from the player, cycled.
    const pts = [...this.ctx.spawns.enemies].sort((a, b) => b.distanceToSquared(p) - a.distanceToSquared(p));
    const far = pts.slice(0, Math.max(1, Math.ceil(pts.length / 2)));
    const base = far[this.spawnIndex++ % far.length];
    const ang = this.rng() * Math.PI * 2;
    const r = this.rng() * WAVE_SPAWN_JITTER;
    const feet = new THREE.Vector3(base.x + Math.cos(ang) * r, base.y, base.z + Math.sin(ang) * r);
    const w = WAVES[this.wave - 1];
    const actor = this.ctx.spawnEnemy(kind, feet, { hpMul: w.hpMul, dmgMul: w.dmgMul });
    this.ai.register(actor);
  }
}
