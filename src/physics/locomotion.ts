import * as THREE from 'three';
import { MOVEMENT } from '../config/movement';
import { approachXZ } from '../player/movementMath';
import type { Actor } from '../game/Actor';
import type { PhysicsWorld } from './PhysicsWorld';

const tmp = new THREE.Vector3();

/** Optional tuning for `stepCharacter`. Omitted fields use MOVEMENT defaults. */
export interface StepOptions {
  /** Speeding up toward `wish` (m/s²). */
  accel?: number;
  /** Slowing down / braking (m/s²). */
  decel?: number;
  /** Fraction of accel/decel available while airborne. */
  airControl?: number;
}

/**
 * Shared character integration used by the player AND enemies:
 * horizontal velocity eases toward `wish` (or `actor.control.forcedVelocity`),
 * knockback is added and decays, gravity applies, then the capsule is moved with collisions.
 * Updates actor.position / velocity / grounded. Owner: movement agent.
 * `accel` may be a number (legacy: same rate for accel and braking) or a StepOptions object.
 */
export function stepCharacter(
  physics: PhysicsWorld,
  actor: Actor,
  wish: THREE.Vector3,
  dt: number,
  accel: number | StepOptions = MOVEMENT.acceleration,
): { landed: boolean; impact: number } {
  const o: StepOptions = typeof accel === 'number' ? { accel, decel: accel } : accel;
  const v = actor.velocity;
  const forced = actor.control.forcedVelocity;
  if (forced) {
    v.x = forced.x;
    v.z = forced.z;
  } else {
    const braking = wish.x * wish.x + wish.z * wish.z < v.x * v.x + v.z * v.z;
    const rate = braking ? (o.decel ?? MOVEMENT.deceleration) : (o.accel ?? MOVEMENT.acceleration);
    const air = actor.grounded ? 1 : (o.airControl ?? MOVEMENT.airControl);
    approachXZ(v, wish, rate * air * dt);
  }
  v.y = Math.max(v.y - MOVEMENT.gravity * dt, -MOVEMENT.maxFallSpeed);
  tmp.set(v.x + actor.knockback.x, v.y, v.z + actor.knockback.z).multiplyScalar(dt);
  actor.knockback.multiplyScalar(Math.max(0, 1 - MOVEMENT.knockbackDecay * dt));
  const wasGrounded = actor.grounded;
  const fallSpeed = -v.y;
  const r = physics.moveCharacter(actor.body, tmp, actor.position);
  actor.grounded = r.grounded && v.y <= 0;
  if (actor.grounded) v.y = 0;
  if (r.hitCeiling && v.y > 0) v.y = 0;
  const landed = actor.grounded && !wasGrounded;
  return { landed, impact: landed ? fallSpeed : 0 };
}
