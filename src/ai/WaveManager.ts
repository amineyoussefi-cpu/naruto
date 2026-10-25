import { WAVES } from '../config/waves';
import type { GameContext } from '../game/context';
import type { EnemyAI } from './EnemyAI';

/**
 * Spawns waves with increasing difficulty, tracks remaining enemies,
 * emits waveStart / waveCleared / enemiesRemaining / victory. Owner: AI agent. STUB.
 */
export class WaveManager {
  wave = 0;
  readonly totalWaves = WAVES.length;
  /** Seconds before the next wave begins (0 while a wave is active). */
  intermission = 0;
  constructor(private readonly ctx: GameContext, private readonly ai: EnemyAI) {}
  get remaining(): number { return this.ctx.enemies().length; }
  start(): void { void this.ai; }
  update(_dt: number): void {}
  reset(): void { this.wave = 0; this.intermission = 0; }
}
