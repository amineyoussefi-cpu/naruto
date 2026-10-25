import type { Actor } from '../game/Actor';
import type { GameContext } from '../game/context';

/**
 * Turns player input into combat actions: combo, kunai, special, guard, dodge, concentrate.
 * Runs before PlayerController each step and writes actor.control. Owner: combat agent.
 * STUB.
 */
export class PlayerCombat {
  constructor(private readonly ctx: GameContext, private readonly actor: Actor) {}
  update(_dt: number): void {
    this.actor.resetControl();
    void this.ctx;
  }
  /** True while the player is climbing a wall is decided by movement; combat reads actor.climbing. */
  reset(): void {}
}
