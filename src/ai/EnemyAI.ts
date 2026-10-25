import type { Actor } from '../game/Actor';
import type { GameContext } from '../game/context';

export type EnemyState = 'idle' | 'detect' | 'chase' | 'attack' | 'recover' | 'hurt' | 'dead' | 'reposition';

/**
 * Enemy brains (melee + ranged state machines) and the attack-token director
 * that limits simultaneous attackers. Owner: AI agent. STUB.
 */
export class EnemyAI {
  constructor(private readonly ctx: GameContext) {}
  register(_actor: Actor): void { void this.ctx; }
  unregister(_actor: Actor): void {}
  /** Current state of an enemy, for HUD/debug/tests. */
  stateOf(_actor: Actor): EnemyState { return 'idle'; }
  /** True while an enemy is winding up an attack (for HUD bars). */
  isTelegraphing(_actor: Actor): boolean { return false; }
  update(_dt: number): void {}
  clear(): void {}
}
