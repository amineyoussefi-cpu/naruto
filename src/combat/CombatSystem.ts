import type * as THREE from 'three';
import type { AttackKind } from '../core/types';
import type { Actor } from '../game/Actor';
import type { GameContext } from '../game/context';

export interface HitboxSpec {
  owner: Actor;
  kind: AttackKind;
  /** Sphere centre = owner position + forward * forwardOffset + up * heightOffset (follows the owner). */
  forwardOffset: number;
  heightOffset: number;
  radius: number;
  duration: number;
  damage: number;
  knockback: number;
}

export interface ProjectileSpec {
  owner: Actor;
  kind: AttackKind;
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  damage: number;
  radius: number;
  maxRange: number;
  knockback: number;
  visual: 'kunai' | 'shuriken' | 'chakra';
}

/**
 * Hitboxes, projectiles, damage resolution and fighter ticking. Owner: combat agent.
 * STUB: public API only.
 */
export class CombatSystem {
  constructor(private readonly ctx: GameContext) {}
  /** Live hitbox; damages each target at most once over its lifetime. */
  spawnHitbox(_spec: HitboxSpec): void {}
  spawnProjectile(_spec: ProjectileSpec): void {}
  /** Applies a hit from `source` to `target` (guard, invulnerability, knockback, stun, events). */
  dealDamage(_source: Actor, _target: Actor, _damage: number, _knockback: number, _kind: AttackKind, _hitPoint: THREE.Vector3): void {}
  /** Ticks every fighter, hitboxes and projectiles. */
  update(dt: number): void {
    for (const a of this.ctx.actors) a.fighter.tick(dt);
  }
  /** Removes every hitbox and projectile (restart). */
  clear(): void {}
  dispose(): void {}
}
