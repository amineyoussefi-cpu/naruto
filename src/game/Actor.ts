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

const UP = new THREE.Vector3(0, 1, 0);
const tmpX = new THREE.Vector3();
const tmpZ = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
/** How fast the model turns onto / off a wall when wall-walking starts or ends (1/s). */
const WALL_BLEND_RATE = 12;

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
  /** Standing on a water surface (walking on it with chakra). Updated by Game each step. */
  onWater = false;
  /** Genjutsu: seconds of disorientation left (cannot target the player). Decremented each step by Game. */
  disoriented = 0;
  /** Id of the actor holding this one in a grab, or null. AI and movement leave a grabbed actor alone. */
  grabbedBy: number | null = null;
  /** Horizontal normal of the wall being walked on (valid while climbing, kept afterwards for blending out). */
  readonly wallNormal = new THREE.Vector3(0, 0, 1);
  /** Render-only: 0 = upright, 1 = standing on the wall. */
  private wallBlend = 0;
  /** Render-only: direction the feet run along the wall. */
  private readonly wallForward = new THREE.Vector3(0, 1, 0);
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
    public model: NinjaModel, // swapped when the player picks another character
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
    root.rotation.set(0, this.prevYaw + dy * alpha, 0);
    const speed = this.climbing ? this.velocity.length() : Math.hypot(this.velocity.x, this.velocity.z);
    this.orientOnWall(frameDt);
    this.model.setFootChakra(this.climbing || this.onWater);
    this.model.setDazed(this.disoriented > 0 && this.alive);
    this.model.update(frameDt, this.anim, this.animTime, speed);
  }

  /**
   * Wall-walking: the model stands perpendicular to the wall with its soles on the surface (model up =
   * wall normal, model forward = direction of travel along the wall), blended in/out from the upright pose.
   * The physics capsule stays upright; this is render-only.
   */
  private orientOnWall(frameDt: number): void {
    const target = this.climbing ? 1 : 0;
    this.wallBlend += (target - this.wallBlend) * (1 - Math.exp(-WALL_BLEND_RATE * frameDt));
    if (this.wallBlend < 0.001) return;
    const n = this.wallNormal;
    if (this.climbing && this.velocity.lengthSq() > 0.25) this.wallForward.copy(this.velocity).addScaledVector(n, -this.velocity.dot(n)).normalize();
    else if (!this.climbing || this.wallForward.lengthSq() < 0.5) this.wallForward.copy(UP);
    tmpZ.copy(this.wallForward);
    tmpX.crossVectors(n, tmpZ).normalize();
    tmpM.makeBasis(tmpX, n, tmpZ);
    tmpQ.setFromRotationMatrix(tmpM);
    const root = this.model.root;
    const k = this.wallBlend * this.wallBlend * (3 - 2 * this.wallBlend);
    root.quaternion.slerp(tmpQ, k);
    // Feet on the wall at mid-capsule height, one radius in from the capsule centre.
    tmpP.copy(root.position).setY(root.position.y + this.height * 0.5).addScaledVector(n, -this.radius);
    root.position.lerp(tmpP, k);
  }
}
