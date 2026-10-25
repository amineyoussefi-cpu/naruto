import * as THREE from 'three';
import type { ActorKind, AnimState, Team } from '../core/types';
import type { Fighter } from '../combat/Fighter';
import type { NinjaModel } from '../render/NinjaModel';
import type { CharacterBody } from '../physics/PhysicsWorld';

/**
 * Per-step locomotion permissions written by the combat layer and read by movement/AI.
 * Reset to defaults at the start of every simulation step by the combat layer.
 */
export interface ActorControl {
  /** Input locomotion allowed (false during attacks, stun, concentration, death). */
  allowMove: boolean;
  /** Multiplier on locomotion speed (e.g. guarding). */
  moveFactor: number;
  /** When set, horizontal velocity is forced to this (dodge, lunge, dash). */
  forcedVelocity: THREE.Vector3 | null;
  /** Combat owns the animation this step; locomotion must not overwrite actor.anim. */
  animLocked: boolean;
  /** Jumping / climbing allowed. */
  allowJump: boolean;
}

let nextId = 1;

/** A ninja in the world: shared state for the player and enemies. Owner: integration. */
export class Actor {
  readonly id = nextId++;
  readonly position = new THREE.Vector3(); // feet, simulation space
  readonly prevPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Horizontal push applied by hits; decays in movement code. */
  readonly knockback = new THREE.Vector3();
  yaw = 0;
  prevYaw = 0;
  grounded = false;
  climbing = false;
  anim: AnimState = 'idle';
  animTime = 0;
  /** Set true when the actor should be removed from the world. */
  removed = false;
  /** Seconds since death. */
  deadTime = 0;
  readonly control: ActorControl = { allowMove: true, moveFactor: 1, forcedVelocity: null, animLocked: false, allowJump: true };

  constructor(
    readonly kind: ActorKind,
    readonly team: Team,
    readonly name: string,
    readonly fighter: Fighter,
    readonly model: NinjaModel,
    readonly body: CharacterBody,
    readonly radius: number,
    readonly height: number,
  ) {}

  get alive(): boolean {
    return this.fighter.alive;
  }

  setAnim(state: AnimState, restart = false): void {
    if (this.anim !== state || restart) {
      this.anim = state;
      this.animTime = 0;
    }
  }

  /** Point at chest height, used for hits, projectiles and lock-on. */
  chest(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + this.height * 0.6);
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Call at the start of each simulation step for render interpolation. */
  beginStep(): void {
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;
  }

  resetControl(): void {
    const c = this.control;
    c.allowMove = true;
    c.moveFactor = 1;
    c.forcedVelocity = null;
    c.animLocked = false;
    c.allowJump = true;
  }

  /** Places the model between the previous and current simulation states. */
  syncModel(alpha: number, frameDt: number): void {
    const root = this.model.root;
    root.position.lerpVectors(this.prevPosition, this.position, alpha);
    let dy = this.yaw - this.prevYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    root.rotation.y = this.prevYaw + dy * alpha;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.model.update(frameDt, this.anim, this.animTime, speed);
  }
}
