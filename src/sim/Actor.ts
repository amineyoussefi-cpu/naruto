import * as THREE from 'three';
import type { ActorKind, AnimState, Team } from '../core/types';
import type { Fighter } from './combat/Fighter';
import type { CharacterBody } from './physics/PhysicsWorld';

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
  /** Collide with the world only this step (pass through other ninjas, e.g. Chidori). */
  passThroughActors: boolean;
}

let nextId = 1;

/** Visual state written by combat/AI for the renderer (sent in snapshots as flags). */
export interface ActorVisuals {
  guard: boolean;
  aura: boolean;
  sharingan: boolean;
  telegraph: boolean;
  /** Hand orb: 0 none, 1 Rasengan, 2 Chidori (see protocol ORB_*), with its size/charge 0..1. */
  orb: number;
  orbLevel: number;
}

/** A ninja in the simulation: shared state for players and enemies (no rendering). Owner: integration. */
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
  /** Standing on a water surface (walking on it with chakra). Updated by Game each step. */
  onWater = false;
  /** Genjutsu: seconds of disorientation left (cannot target the player). Decremented each step by Game. */
  disoriented = 0;
  /** Id of the actor holding this one in a grab, or null. AI and movement leave a grabbed actor alone. */
  grabbedBy: number | null = null;
  /** Horizontal normal of the wall being walked on (valid while climbing, kept afterwards for blending out). */
  readonly wallNormal = new THREE.Vector3(0, 0, 1);
  anim: AnimState = 'idle';
  animTime = 0;
  /** Set true when the actor should be removed from the world. */
  removed = false;
  /** Seconds since death. */
  deadTime = 0;
  /** Mission enemy group (0 = none) and dormancy: a dormant enemy idles until its group is aggroed. Missions own both. */
  groupId = 0;
  dormant = false;
  /** Co-op: seconds of bleed-out left while downed (0 = not downed). Missions own it. */
  downed = 0;
  readonly vis: ActorVisuals = { guard: false, aura: false, sharingan: false, telegraph: false, orb: 0, orbLevel: 0 };
  readonly control: ActorControl = { allowMove: true, moveFactor: 1, forcedVelocity: null, animLocked: false, allowJump: true, passThroughActors: false };

  constructor(
    readonly kind: ActorKind,
    public team: Team, // PvP squares move players between red and blue
    readonly name: string,
    readonly fighter: Fighter,
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
    c.passThroughActors = false;
  }
}
