import * as THREE from 'three';
import type { ActorKind, AnimState, CharacterId, Team } from '../core/types';
import { ACTOR_FLAGS, ORB_CHIDORI, ORB_NONE, type ActorInfo, type ActorState } from '../sim/protocol';
import { MOVEMENT } from '../config/movement';
import { NinjaModel } from '../render/NinjaModel';
import { CHARACTER_LOOKS, pickEnemyLook } from '../render/looks';

const UP = new THREE.Vector3(0, 1, 0);
const tmpX = new THREE.Vector3();
const tmpZ = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
/** How fast the model turns onto / off a wall when wall-walking starts or ends (1/s). */
const WALL_BLEND_RATE = 12;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Builds the model for an actor's look key (character id, or `kind:variant` for enemies). */
export function modelFor(info: ActorInfo): NinjaModel {
  if (info.kind === 'player') return new NinjaModel(CHARACTER_LOOKS[info.look as CharacterId] ?? CHARACTER_LOOKS.naruto);
  const variant = Number(info.look.split(':')[1] ?? 0);
  return new NinjaModel(pickEnemyLook(info.kind, () => (variant + 0.5) / 3));
}

/**
 * Client-side picture of one actor: the latest server (or predicted) state, interpolated, and its model.
 * Same field names as the simulation Actor where the camera, effects and HUD read them. Owner: integration.
 */
export class ActorView {
  readonly id: number;
  readonly kind: ActorKind;
  name: string;
  look: string;
  readonly playerId?: number;
  model: NinjaModel;
  team: Team = 'enemy';
  /** Interpolated feet position / velocity / yaw (render time). */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  anim: AnimState = 'idle';
  animTime = 0;
  hp = 1; maxHp = 1; chakra = 0; maxChakra = 0;
  flags = 0;
  readonly wallNormal = new THREE.Vector3(0, 0, 1);
  readonly radius = MOVEMENT.capsuleRadius;
  readonly height = 2 * (MOVEMENT.capsuleHalfHeight + MOVEMENT.capsuleRadius);
  removed = false;
  /** Render-only offset added to the model (prediction correction smoothing). */
  readonly offset = new THREE.Vector3();
  private wallBlend = 0;
  private readonly wallForward = new THREE.Vector3(0, 1, 0);
  private orb = ORB_NONE;
  private orbLevel = 0;
  private shown = { guard: false, aura: false, sharingan: false, telegraph: false, dazed: false, orb: false };

  constructor(info: ActorInfo) {
    this.id = info.id;
    this.kind = info.kind;
    this.name = info.name;
    this.look = info.look;
    this.playerId = info.playerId;
    this.model = modelFor(info);
  }

  get alive(): boolean { return this.hp > 0; }
  has(flag: keyof typeof ACTOR_FLAGS): boolean { return (this.flags & ACTOR_FLAGS[flag]) !== 0; }
  get climbing(): boolean { return this.has('climbing'); }
  get onWater(): boolean { return this.has('onWater'); }
  get concentrating(): boolean { return this.has('concentrating'); }
  get downed(): boolean { return this.has('downed'); }

  chest(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + this.height * 0.6);
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Sets the view between two states of this actor (`t` in 0..1). */
  apply(from: ActorState, to: ActorState, t: number): void {
    this.position.set(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t);
    this.velocity.set(to.vx, to.vy, to.vz);
    this.yaw = from.yaw + wrap(to.yaw - from.yaw) * t;
    this.anim = to.anim;
    this.animTime = from.anim === to.anim ? from.animTime + (to.animTime - from.animTime) * t : to.animTime;
    this.hp = to.hp; this.maxHp = to.maxHp; this.chakra = to.chakra; this.maxChakra = to.maxChakra;
    this.flags = to.flags;
    this.team = to.team;
    this.orb = to.orb;
    this.orbLevel = to.orbLevel;
    this.wallNormal.set(to.wallNx, 0, to.wallNz);
  }

  /** Places and animates the model for this frame. */
  syncModel(frameDt: number): void {
    const root = this.model.root;
    root.position.copy(this.position).add(this.offset);
    root.rotation.set(0, this.yaw, 0);
    const speed = this.climbing ? this.velocity.length() : Math.hypot(this.velocity.x, this.velocity.z);
    this.orientOnWall(frameDt);
    this.syncVisuals();
    this.model.update(frameDt, this.anim, this.animTime, speed);
  }

  private syncVisuals(): void {
    const m = this.model, s = this.shown;
    const set = (k: keyof typeof s, on: boolean, fn: (on: boolean) => void) => { if (s[k] !== on) { s[k] = on; fn(on); } };
    set('guard', this.has('guard'), (on) => m.setGuard(on));
    set('aura', this.has('aura'), (on) => m.setAura(on));
    set('sharingan', this.has('sharingan'), (on) => m.setSharingan(on));
    set('telegraph', this.has('telegraph'), (on) => m.setTelegraph(on));
    set('dazed', this.has('dazed'), (on) => m.setDazed(on));
    m.setFootChakra(this.climbing || this.onWater);
    if (this.orb !== ORB_NONE) m.setHandOrb(true, this.orbLevel, this.orb === ORB_CHIDORI ? 'chidori' : 'rasengan');
    else if (s.orb) m.setHandOrb(false);
    s.orb = this.orb !== ORB_NONE;
  }

  /** Replaces the model (character change); visual toggles are re-applied next frame. */
  setModel(m: NinjaModel): void {
    this.model.dispose();
    this.model = m;
    this.shown = { guard: false, aura: false, sharingan: false, telegraph: false, dazed: false, orb: false };
  }

  dispose(): void {
    this.removed = true;
    this.model.dispose();
  }

  /**
   * Wall-walking: the model stands perpendicular to the wall with its soles on the surface (model up =
   * wall normal, model forward = direction of travel along the wall), blended in/out from the upright pose.
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
