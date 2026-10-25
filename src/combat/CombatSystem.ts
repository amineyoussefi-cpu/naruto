import * as THREE from 'three';
import { COMBAT } from '../config/combat';
import { ENEMIES } from '../config/enemies';
import type { AttackKind } from '../core/types';
import type { Actor } from '../game/Actor';
import type { GameContext } from '../game/context';
import { createProjectileMesh, disposeObject } from '../render/meshes';

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
interface Projectile { spec: ProjectileSpec; pos: THREE.Vector3; dir: THREE.Vector3; travelled: number; mesh: THREE.Object3D }

/** Sphere vs actor capsule: horizontal distance ≤ r + actor.radius and vertical overlap with [feet, feet + height]. */
export function sphereHitsActor(center: THREE.Vector3, r: number, a: Actor): boolean {
  const dx = center.x - a.position.x, dz = center.z - a.position.z;
  const reach = r + a.radius;
  return dx * dx + dz * dz <= reach * reach && center.y + r >= a.position.y && center.y - r <= a.position.y + a.height;
}

const isHeavy = (kind: AttackKind) => kind === 'combo5' || kind === 'special';

/** Hitboxes, projectiles, damage resolution and fighter ticking. Owner: combat agent. */
export class CombatSystem {
  private hitboxes: Hitbox[] = [];
  private projectiles: Projectile[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  /** Last actor that landed a (non-ignored) hit on each target id (substitution destination). */
  readonly lastAttacker = new Map<number, Actor>();

  constructor(private readonly ctx: GameContext) {}

  /** Live hitbox; damages each target at most once over its lifetime. */
  spawnHitbox(spec: HitboxSpec): void {
    this.hitboxes.push({ spec, age: 0, hit: new Set() });
  }

  spawnProjectile(spec: ProjectileSpec): void {
    const dir = spec.direction.clone().normalize();
    const pos = spec.origin.clone();
    const mesh = createProjectileMesh(spec.visual);
    mesh.position.copy(pos);
    mesh.lookAt(this.tmp.copy(pos).add(dir));
    this.ctx.scene.add(mesh);
    this.projectiles.push({ spec, pos, dir, travelled: 0, mesh });
  }

  /** Number of live hitboxes / projectiles (tests, debug). */
  get counts(): { hitboxes: number; projectiles: number } {
    return { hitboxes: this.hitboxes.length, projectiles: this.projectiles.length };
  }

  /** Applies a hit from `source` to `target` (guard, invulnerability, knockback, stun, events). */
  dealDamage(
    source: Actor, target: Actor, damage: number, knockback: number, kind: AttackKind, hitPoint: THREE.Vector3,
    launch = 0, stun?: number,
  ): void {
    const res = target.fighter.applyHit({ damage });
    if (res.ignored) return;
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
      target.fighter.setStun(stun ?? (target.team === 'player' ? COMBAT.hitStun : ENEMIES.hitStun));
      target.setAnim(launch > 0 ? 'launched' : 'hit', true);
    }
    if (launch > 0 && !res.blocked) {
      target.velocity.y = launch;
      target.grounded = false;
    }
    if (!res.blocked) target.model.flash(COMBAT.hitFlash);

    if (source.team === 'player' || target.team === 'player') {
      const heavy = isHeavy(kind) || res.killed;
      ev.emit('hitStop', { duration: heavy ? COMBAT.hitStopHeavy : COMBAT.hitStop });
      const s = res.blocked ? COMBAT.shake.blocked
        : kind === 'combo5' ? COMBAT.shake.launcher
        : heavy ? COMBAT.shake.heavy
        : target.team === 'player' ? COMBAT.shake.playerHit : COMBAT.shake.light;
      ev.emit('cameraShake', { intensity: s.intensity, duration: s.duration });
    }
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
        if (h.hit.has(t.id) || !sphereHitsActor(c, h.spec.radius, t)) continue;
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
        const t = targets.find((a) => sphereHitsActor(c, spec.radius, a));
        if (!t) continue;
        this.dealDamage(spec.owner, t, spec.damage, spec.knockback, spec.kind, c);
        this.ctx.events.emit('projectileHit', { position: { x: c.x, y: c.y, z: c.z }, hitActor: true });
        disposeObject(p.mesh);
        return false;
      }
      p.pos.addScaledVector(p.dir, step);
      p.travelled += step;
      p.mesh.position.copy(p.pos);
      if (wall) this.ctx.events.emit('projectileHit', { position: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, hitActor: false });
      if (wall || p.travelled >= spec.maxRange - 1e-6) {
        disposeObject(p.mesh);
        return false;
      }
      return true;
    });
  }

  /** Removes every hitbox and projectile (restart). */
  clear(): void {
    for (const p of this.projectiles) disposeObject(p.mesh);
    this.projectiles = [];
    this.hitboxes = [];
    this.lastAttacker.clear();
  }

  dispose(): void {
    this.clear();
  }
}
