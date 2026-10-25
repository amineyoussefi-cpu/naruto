import * as THREE from 'three';
import { COMBAT } from '../../config/combat';
import { ENEMIES } from '../../config/enemies';
import type { AttackKind } from '../../core/types';
import type { GameEvents } from '../../core/events';
import type { HitResult } from './Fighter';
import { qteFinish } from './grab';
import type { Actor } from '../Actor';
import type { SimContext } from '../context';
import type { ProjectileState } from '../protocol';
import { PVP } from '../../config/pvp';

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
  /** Upward velocity (m/s) given to the target: launcher. */
  launch?: number;
  /** Hit stun override (s) instead of the team default. */
  stun?: number;
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

interface Hitbox { spec: HitboxSpec; age: number; hit: Set<number> }
interface Projectile { id: number; spec: ProjectileSpec; pos: THREE.Vector3; dir: THREE.Vector3; travelled: number }

/** Sphere vs actor capsule: horizontal distance ≤ r + actor.radius and vertical overlap with [feet, feet + height]. */
export function sphereHitsActor(center: THREE.Vector3, r: number, a: Actor, at: THREE.Vector3 = a.position): boolean {
  const dx = center.x - at.x, dz = center.z - at.z;
  const reach = r + a.radius;
  return dx * dx + dz * dz <= reach * reach && center.y + r >= at.y && center.y - r <= at.y + a.height;
}

/** Client-side feedback for a damage event: hit-stop and camera shake when it involves `meId`, else null. */
export function hitFeedback(e: GameEvents['damage'], meId: number): { hitStop: number; shake: { intensity: number; duration: number } } | null {
  if (e.sourceId !== meId && e.targetId !== meId) return null;
  const heavy = isHeavy(e.kind) || e.killed;
  const shake = e.blocked ? COMBAT.shake.blocked
    : e.kind === 'combo5' ? COMBAT.shake.launcher
    : heavy ? COMBAT.shake.heavy
    : e.targetId === meId ? COMBAT.shake.playerHit : COMBAT.shake.light;
  return { hitStop: heavy ? COMBAT.hitStopHeavy : COMBAT.hitStop, shake };
}

export const isHeavy = (kind: AttackKind) => kind === 'combo5' || kind === 'special' || kind === 'chidori' || kind === 'grabFinisher';

/** Hitboxes, projectiles, damage resolution and fighter ticking. Owner: combat agent. */
export class CombatSystem {
  private hitboxes: Hitbox[] = [];
  private projectiles: Projectile[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  /** Last actor that landed a (non-ignored) hit on each target id (substitution destination). */
  readonly lastAttacker = new Map<number, Actor>();

  private nextProjectileId = 1;

  constructor(private readonly ctx: SimContext) {}

  /** Live hitbox; damages each target at most once over its lifetime. */
  spawnHitbox(spec: HitboxSpec): void {
    this.hitboxes.push({ spec, age: 0, hit: new Set() });
  }

  spawnProjectile(spec: ProjectileSpec): void {
    const dir = spec.direction.clone().normalize();
    this.projectiles.push({ id: this.nextProjectileId++, spec, pos: spec.origin.clone(), dir, travelled: 0 });
  }

  /** Live projectiles for snapshots (the client draws them). */
  projectileStates(): ProjectileState[] {
    return this.projectiles.map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, dx: p.dir.x, dy: p.dir.y, dz: p.dir.z, visual: p.spec.visual }));
  }

  /** Number of live hitboxes / projectiles (tests, debug). */
  get counts(): { hitboxes: number; projectiles: number } {
    return { hitboxes: this.hitboxes.length, projectiles: this.projectiles.length };
  }

  /** Applies a hit from `source` to `target` (guard, invulnerability, knockback, stun, events). */
  dealDamage(
    source: Actor, target: Actor, damage: number, knockback: number, kind: AttackKind, hitPoint: THREE.Vector3,
    launch = 0, stun?: number,
  ): HitResult {
    // PvP: every technique hits players softer so fights last longer.
    if (source.kind === 'player' && target.kind === 'player') damage *= PVP.damageScale;
    const res = target.fighter.applyHit({ damage });
    if (res.ignored) return res;
    this.lastAttacker.set(target.id, source);
    const ev = this.ctx.events;
    const position = { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z };
    ev.emit('damage', { targetId: target.id, sourceId: source.id, amount: res.applied, blocked: res.blocked, killed: res.killed, kind, position });

    const push = this.tmp2.set(target.position.x - source.position.x, 0, target.position.z - source.position.z);
    if (push.lengthSq() < 1e-6) source.forward(push);
    push.normalize().multiplyScalar(res.blocked ? knockback * COMBAT.guardKnockbackFactor : knockback);
    target.knockback.add(push);

    if (res.killed) {
      target.setAnim('dead', true);
      ev.emit('death', { id: target.id, team: target.team });
    } else if (!res.blocked) {
      target.fighter.setStun(stun ?? (target.kind === 'player' ? COMBAT.hitStun : ENEMIES.hitStun));
      target.setAnim(launch > 0 ? 'launched' : 'hit', true);
    }
    if (launch > 0 && !res.blocked) {
      target.velocity.y = launch;
      target.grounded = false;
    }
    return res;
  }

  /** Removes every live hitbox of `owner` (attack interrupted: genjutsu, grabbed). */
  cancelHitboxes(owner: Actor): void {
    this.hitboxes = this.hitboxes.filter((h) => h.spec.owner !== owner);
  }

  /** Ticks every fighter, hitboxes and projectiles. */
  update(dt: number): void {
    for (const a of this.ctx.actors) {
      a.fighter.tick(dt);
      // Launched: stay stunned while airborne, then a short 'hit' stun on landing.
      if (a.anim !== 'launched' || !a.alive || !a.fighter.stunned) continue;
      if (!a.grounded) a.fighter.setStun(COMBAT.launchLandStun);
      else a.setAnim('hit', true);
    }
    this.updateHitboxes(dt);
    this.updateProjectiles(dt);
  }

  private targets(team: Actor['team']): Actor[] {
    return this.ctx.actors.filter((a) => a.team !== team && a.alive && !a.removed);
  }

  private updateHitboxes(dt: number): void {
    this.hitboxes = this.hitboxes.filter((h) => {
      const { owner } = h.spec;
      // Cancelled attack: the hitbox dies with its owner's stun/death.
      if (!owner.alive || owner.removed || owner.fighter.stunned || h.age >= h.spec.duration) return false;
      const c = owner.forward(this.tmp).multiplyScalar(h.spec.forwardOffset).add(owner.position);
      c.y += h.spec.heightOffset;
      for (const t of this.targets(owner.team)) {
        if (h.hit.has(t.id) || !sphereHitsActor(c, h.spec.radius, t, this.ctx.rewound(t, owner))) continue;
        h.hit.add(t.id);
        this.dealDamage(owner, t, h.spec.damage, h.spec.knockback, h.spec.kind, t.chest(), h.spec.launch, h.spec.stun);
      }
      h.age += dt;
      return true;
    });
  }

  private updateProjectiles(dt: number): void {
    const physics = this.ctx.physics;
    this.projectiles = this.projectiles.filter((p) => {
      const { spec } = p;
      let step = Math.min(spec.speed * dt, spec.maxRange - p.travelled);
      const wall = physics.raycast(p.pos, p.dir, step, { worldOnly: true });
      if (wall) step = wall.distance;
      // Sweep the segment in sub-steps no longer than the projectile radius.
      const n = Math.max(1, Math.ceil(step / Math.max(spec.radius, 0.05)));
      const targets = this.targets(spec.owner.team);
      for (let i = 1; i <= n; i++) {
        const c = this.tmp.copy(p.dir).multiplyScalar((step * i) / n).add(p.pos);
        const t = targets.find((a) => sphereHitsActor(c, spec.radius, a, this.ctx.rewound(a, spec.owner)));
        if (!t) continue;
        this.dealDamage(spec.owner, t, spec.damage, spec.knockback, spec.kind, c);
        this.ctx.events.emit('projectileHit', { position: { x: c.x, y: c.y, z: c.z }, hitActor: true });
        return false;
      }
      p.pos.addScaledVector(p.dir, step);
      p.travelled += step;
      if (wall) this.ctx.events.emit('projectileHit', { position: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, hitActor: false });
      if (wall || p.travelled >= spec.maxRange - 1e-6) return false;
      return true;
    });
  }

  /** Removes every hitbox and projectile (restart) and interrupts a grab sequence (victims released). */
  clear(): void {
    for (const p of this.ctx.players.values()) {
      const q = p.qte;
      if (q && !q.done) {
        qteFinish(q, 'interrupted');
        this.ctx.events.emit('grabEnd', { id: p.actor.id, targetId: q.targetId, result: 'interrupted', hits: q.index });
      }
      p.qte = null;
    }
    for (const a of this.ctx.actors) a.grabbedBy = null;
    this.projectiles = [];
    this.hitboxes = [];
    this.lastAttacker.clear();
  }

  dispose(): void {
    this.clear();
  }
}
