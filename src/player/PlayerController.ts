import * as THREE from 'three';
import { MOVEMENT } from '../config/movement';
import type { Actor } from '../game/Actor';
import type { GameContext } from '../game/context';

/**
 * Camera-relative locomotion, jump, wall climbing, respawn. Owner: movement agent.
 * STUB: minimal walking so integration can run.
 */
export class PlayerController {
  private delta = new THREE.Vector3();
  constructor(private readonly ctx: GameContext, private readonly actor: Actor) {}

  update(dt: number): void {
    const a = this.actor;
    const { x, y } = this.ctx.input.moveAxes();
    const yaw = this.ctx.camera.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    a.velocity.x = (fx * y - fz * x) * MOVEMENT.runSpeed;
    a.velocity.z = (fz * y + fx * x) * MOVEMENT.runSpeed;
    a.velocity.y -= MOVEMENT.gravity * dt;
    this.delta.copy(a.velocity).multiplyScalar(dt);
    const r = this.ctx.physics.moveCharacter(a.body, this.delta, a.position);
    a.grounded = r.grounded;
    if (r.grounded) a.velocity.y = 0;
  }

  reset(feet: THREE.Vector3): void {
    this.ctx.physics.teleport(this.actor.body, feet);
    this.actor.position.copy(feet);
    this.actor.velocity.set(0, 0, 0);
  }
}
