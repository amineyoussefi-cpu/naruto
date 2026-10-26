import * as THREE from 'three';
import { ENEMIES } from '../../config/enemies';
import type { AnimState } from '../../core/types';
import type { Actor } from '../Actor';
import type { SimContext } from '../context';
import { stepCharacter } from '../physics/locomotion';

export type EnemyState = 'idle' | 'detect' | 'chase' | 'attack' | 'recover' | 'hurt' | 'dead' | 'reposition'
  /** Genjutsu (Sharingan): stumbling aimlessly, cannot target the player. */
  | 'dazed';

interface Brain {
  actor: Actor;
  state: EnemyState;
  /** Seconds in the current state. */
  t: number;
  /** Sub-phase while state === 'attack'. */
  phase: 'telegraph' | 'active';
  cooldown: number;
  /** +1 / -1: orbit / strafe direction. */
  side: number;
  strafeTimer: number;
  /** Direction of the current evasive move (reposition). */
  evadeDir: THREE.Vector3;
  evadeTime: number;
  /** Player being fought (null = none in range / dormant). */
  target: Actor | null;
}

const STEER_ANGLES = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2];
const UP = new THREE.Vector3(0, 1, 0);
const wish = new THREE.Vector3();
const toPlayer = new THREE.Vector3();
const tmp = new THREE.Vector3();
const probe = new THREE.Vector3();
const origin = new THREE.Vector3();

/**
 * Enemy brains (melee + ranged state machines) and the attack-token director
 * that limits simultaneous attackers. Owner: AI agent.
 */
export class EnemyAI {
  private brains = new Map<Actor, Brain>();
  /** Internal sim clock, used to stagger attack starts. */
  private clock = 0;
  private lastAttackStart = -Infinity;
  /** Players who started an attack this step (melee enemies nearby may dodge). */
  private swingers = new Set<number>();

  constructor(private readonly ctx: SimContext, private readonly rng: () => number = Math.random) {
    ctx.events.on('attackStart', (e) => { if (this.ctx.actors.some((a) => a.id === e.id && a.kind === 'player')) this.swingers.add(e.id); });
  }

  register(actor: Actor): void {
    this.brains.set(actor, {
      actor, state: 'idle', t: 0, phase: 'telegraph', cooldown: 0,
      side: this.rng() < 0.5 ? -1 : 1, strafeTimer: 0, evadeDir: new THREE.Vector3(), evadeTime: 0, target: null,
    });
  }

  unregister(actor: Actor): void {
    if (this.brains.delete(actor)) actor.vis.telegraph = false;
  }

  /** Current state of an enemy, for HUD/debug/tests. */
  stateOf(actor: Actor): EnemyState { return this.brains.get(actor)?.state ?? 'idle'; }

  /** True while an enemy is winding up an attack (for HUD bars). */
  isTelegraphing(actor: Actor): boolean {
    const b = this.brains.get(actor);
    return !!b && b.state === 'attack' && b.phase === 'telegraph';
  }

  /** Number of enemies currently holding an attack token. */
  get attackerCount(): number {
    let n = 0;
    for (const b of this.brains.values()) if (b.state === 'attack') n++;
    return n;
  }

  update(dt: number): void {
    this.clock += dt;
    const swingers = [...this.swingers];
    this.swingers.clear();
    for (const b of this.brains.values()) {
      if (b.actor.removed) continue;
      if (b.actor.grabbedBy !== null) {
        // Held in a grab: combat positions and animates it; the brain is fully suspended.
        if (b.state === 'attack') this.setState(b, 'recover');
        continue;
      }
      b.t += dt;
      b.cooldown = Math.max(0, b.cooldown - dt);
      wish.set(0, 0, 0);
      b.target = this.pickTarget(b);
      this.think(b, dt, !!b.target && swingers.includes(b.target.id));
      this.move(b, dt);
    }
  }

  clear(): void {
    for (const a of this.brains.keys()) a.vis.telegraph = false;
    this.brains.clear();
    this.clock = 0;
    this.lastAttackStart = -Infinity;
    this.swingers.clear();
  }

  /**
   * Nearest valid player (alive, not downed, hostile, within detect range). Dormant mission enemies and
   * enemies keep their current target while it stays valid so a group doesn't flicker between players.
   */
  private pickTarget(b: Brain): Actor | null {
    const a = b.actor;
    if (a.dormant) return null;
    const range = a.kind === 'ranged' ? ENEMIES.ranged.detectRange : ENEMIES.melee.detectRange;
    const valid = (p: Actor) => p.alive && !p.removed && p.downed <= 0 && p.team !== a.team && p.position.distanceTo(a.position) <= range * ENEMIES.loseTargetFactor;
    if (b.target && valid(b.target)) return b.target;
    // Mission groups fight together: join a groupmate's fight before picking a target of one's own.
    if (a.groupId) {
      for (const o of this.brains.values()) {
        if (o !== b && o.actor.groupId === a.groupId && o.target && valid(o.target)) return o.target;
      }
    }
    let best: Actor | null = null, bestD: number = range;
    for (const pl of this.ctx.players.values()) {
      const p = pl.actor, d = p.position.distanceTo(a.position);
      if (valid(p) && d <= bestD) { best = p; bestD = d; }
    }
    return best;
  }

  // --- state machine -------------------------------------------------------

  private setState(b: Brain, s: EnemyState): void {
    if (b.state === 'attack' && s !== 'attack') b.actor.vis.telegraph = false;
    b.state = s;
    b.t = 0;
  }

  private anim(b: Brain, s: AnimState, restart = false): void {
    if (b.state === 'hurt' || b.state === 'dead' || b.actor.control.animLocked) return;
    b.actor.setAnim(s, restart);
  }

  private think(b: Brain, dt: number, playerAttacked: boolean): void {
    const a = b.actor;
    if (!a.alive) {
      if (b.state !== 'dead') this.setState(b, 'dead');
      return;
    }
    if (a.fighter.stunned) {
      if (b.state !== 'hurt') this.setState(b, 'hurt');
      return;
    }
    if (a.disoriented > 0) {
      if (b.state !== 'dazed') { this.setState(b, 'dazed'); b.side = this.rng() < 0.5 ? -1 : 1; }
      this.dazed(b);
      return;
    }
    if (b.state === 'dazed') this.setState(b, 'chase'); // illusion over: back to normal behaviour
    if (b.state === 'hurt') {
      this.setState(b, 'chase');
      if (this.rng() < ENEMIES.melee.dodgeChance && a.kind === 'melee') this.evade(b, true);
    }

    const p = b.target ?? a;
    const playerAlive = b.target !== null;
    toPlayer.subVectors(p.position, a.position).setY(0);
    const dist = toPlayer.length();
    if (dist > 1e-4) toPlayer.divideScalar(dist);
    const cfg = a.kind === 'ranged' ? ENEMIES.ranged : ENEMIES.melee;

    if (!playerAlive) {
      if (b.state === 'attack' && b.phase === 'telegraph') this.setState(b, 'recover');
      else if (b.state !== 'attack' && b.state !== 'recover') this.setState(b, 'idle');
    }

    // Melee reaction to the player swinging nearby.
    if (playerAttacked && a.kind === 'melee' && dist < ENEMIES.dodgeReactRange
      && (b.state === 'chase' || b.state === 'recover') && this.rng() < ENEMIES.melee.dodgeChance) {
      this.evade(b, false);
    }

    switch (b.state) {
      case 'idle':
        this.anim(b, 'idle');
        if (playerAlive) this.setState(b, 'detect'); // pickTarget already applied the detect range (or a groupmate's fight)
        break;
      case 'detect':
        this.face(a, toPlayer, dt);
        this.anim(b, 'idle');
        if (b.t >= ENEMIES.detectTime) this.setState(b, 'chase');
        break;
      case 'chase':
        this.face(a, toPlayer, dt);
        if (a.kind === 'melee') this.chaseMelee(b, dist);
        else this.chaseRanged(b, dist, dt);
        break;
      case 'attack':
        this.face(a, toPlayer, dt);
        this.attack(b, dist);
        break;
      case 'recover':
        this.face(a, toPlayer, dt);
        this.anim(b, 'idle');
        if (b.t >= cfg.recovery) {
          this.setState(b, playerAlive ? 'chase' : 'idle');
          if (playerAlive && a.kind === 'melee' && this.rng() < ENEMIES.melee.retreatChance) this.evade(b, true);
        }
        break;
      case 'reposition':
        this.reposition(b, dist, dt);
        break;
      default:
        break;
    }
  }

  private chaseMelee(b: Brain, dist: number): void {
    const m = ENEMIES.melee;
    if (dist <= m.attackRange && b.cooldown <= 0 && this.tryToken()) {
      this.beginAttack(b);
      return;
    }
    if (dist <= m.attackRange * 0.8) {
      this.anim(b, 'idle');
    } else if (this.attackerCount >= ENEMIES.maxSimultaneousAttackers || b.cooldown > 0) {
      this.orbit(b, dist, m.speed * m.orbitSpeedFactor);
    } else {
      wish.copy(toPlayer).multiplyScalar(m.speed);
      this.anim(b, 'run');
    }
  }

  private chaseRanged(b: Brain, dist: number, dt: number): void {
    const r = ENEMIES.ranged;
    if (dist < r.minRange) {
      b.evadeDir.copy(toPlayer).negate();
      b.evadeTime = ENEMIES.repositionMaxTime;
      this.setState(b, 'reposition');
      return;
    }
    if (dist <= r.detectRange && b.cooldown <= 0 && this.tryToken()) {
      this.beginAttack(b);
      return;
    }
    if (dist > r.preferredRange + r.rangeBand) {
      wish.copy(toPlayer).multiplyScalar(r.speed);
      this.anim(b, 'run');
      return;
    }
    b.strafeTimer -= dt;
    if (b.strafeTimer <= 0) {
      b.strafeTimer = r.strafeSwitch;
      if (this.rng() < 0.5) b.side = -b.side;
    }
    this.orbit(b, dist, r.speed * r.strafeSpeedFactor, r.preferredRange);
  }

  /** Circle the player at `radius`, correcting radially. */
  private orbit(b: Brain, dist: number, speed: number, radius: number = ENEMIES.orbitRange): void {
    tmp.crossVectors(UP, toPlayer).multiplyScalar(b.side); // tangent
    const radial = THREE.MathUtils.clamp((dist - radius) / radius, -1, 1) * ENEMIES.orbitRadialGain;
    wish.copy(tmp).addScaledVector(toPlayer, radial).normalize().multiplyScalar(speed);
    this.anim(b, 'run');
  }

  private tryToken(): boolean {
    return this.attackerCount < ENEMIES.maxSimultaneousAttackers
      && this.clock - this.lastAttackStart >= ENEMIES.attackStagger;
  }

  private beginAttack(b: Brain): void {
    const a = b.actor;
    const cfg = a.kind === 'ranged' ? ENEMIES.ranged : ENEMIES.melee;
    this.setState(b, 'attack');
    b.phase = 'telegraph';
    this.lastAttackStart = this.clock;
    a.vis.telegraph = true;
    this.anim(b, 'telegraph', true);
    this.ctx.events.emit('telegraph', { id: a.id, duration: cfg.telegraph });
  }

  private attack(b: Brain, dist: number): void {
    const a = b.actor;
    const ranged = a.kind === 'ranged';
    const cfg = ranged ? ENEMIES.ranged : ENEMIES.melee;
    const dmgMul = this.ctx.modifiers(a).dmgMul;
    if (b.phase === 'telegraph') {
      if (b.t < cfg.telegraph) return;
      b.phase = 'active';
      b.t = 0;
      a.vis.telegraph = false;
      this.ctx.events.emit('attackStart', { id: a.id, kind: ranged ? 'enemyRanged' : 'enemyMelee', position: a.position });
      if (ranged) {
        if (b.target) this.throwAt(a, b.target, dist, ENEMIES.ranged.damage * dmgMul);
        this.anim(b, 'throw', true);
      } else {
        const m = ENEMIES.melee;
        this.ctx.combat.spawnHitbox({
          owner: a, kind: 'enemyMelee', forwardOffset: m.hitboxForward, heightOffset: m.hitboxHeight,
          radius: m.hitboxRadius, duration: m.active, damage: m.damage * dmgMul, knockback: m.knockback,
        });
        this.anim(b, 'attack1', true);
      }
    } else if (b.t >= cfg.active) {
      b.cooldown = cfg.cooldown;
      this.setState(b, 'recover');
    }
  }

  private throwAt(a: Actor, p: Actor, dist: number, damage: number): void {
    const r = ENEMIES.ranged;
    const target = p.chest(tmp).addScaledVector(p.velocity, (dist / r.projectileSpeed) * r.leadFactor);
    a.chest(origin).addScaledVector(a.forward(probe), r.muzzleForward);
    const dir = target.sub(origin).normalize();
    this.ctx.combat.spawnProjectile({
      owner: a, kind: 'enemyRanged', origin: origin.clone(), direction: dir.clone(), speed: r.projectileSpeed,
      damage, radius: r.projectileRadius, maxRange: r.projectileMaxRange, knockback: r.knockback, visual: 'shuriken',
    });
  }

  /** Genjutsu wander: slow stumbling in a drifting direction, no targeting, no attacks. */
  private dazed(b: Brain): void {
    const a = b.actor;
    if (b.t >= ENEMIES.dazedTurnTime * (0.6 + 0.8 * this.rng()) || b.evadeDir.lengthSq() < 0.5) {
      const ang = this.rng() * Math.PI * 2;
      b.evadeDir.set(Math.cos(ang), 0, Math.sin(ang));
      b.t = 0;
    }
    const cfg = a.kind === 'ranged' ? ENEMIES.ranged : ENEMIES.melee;
    wish.copy(b.evadeDir).multiplyScalar(cfg.speed * ENEMIES.dazedSpeedFactor);
    const d = Math.atan2(b.evadeDir.x, b.evadeDir.z) - a.yaw;
    a.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * 0.05;
    this.anim(b, 'dazed');
  }

  /** Back off (or side-step) for a short time. */
  private evade(b: Brain, backOff: boolean): void {
    if (backOff) b.evadeDir.copy(toPlayer).negate();
    else b.evadeDir.crossVectors(UP, toPlayer).multiplyScalar(this.rng() < 0.5 ? -1 : 1);
    b.evadeTime = ENEMIES.evadeTime;
    this.setState(b, 'reposition');
  }

  private reposition(b: Brain, dist: number, dt: number): void {
    const a = b.actor;
    const cfg = a.kind === 'ranged' ? ENEMIES.ranged : ENEMIES.melee;
    this.face(a, toPlayer, dt);
    b.evadeTime -= dt;
    // Ranged retreats until back between min and preferred range.
    const doneRanged = a.kind === 'ranged' && dist >= (ENEMIES.ranged.minRange + ENEMIES.ranged.preferredRange) / 2;
    if (b.evadeTime <= 0 || doneRanged) {
      this.setState(b, 'chase');
      return;
    }
    const speed = a.kind === 'ranged' ? cfg.speed : cfg.speed * ENEMIES.evadeSpeedFactor;
    if (a.kind === 'ranged') b.evadeDir.copy(toPlayer).negate();
    wish.copy(b.evadeDir).multiplyScalar(speed);
    this.anim(b, 'run');
  }

  // --- movement ------------------------------------------------------------

  private face(a: Actor, dir: THREE.Vector3, dt: number): void {
    if (dir.lengthSq() < 1e-6) return;
    const target = Math.atan2(dir.x, dir.z);
    const d = Math.atan2(Math.sin(target - a.yaw), Math.cos(target - a.yaw));
    const max = ENEMIES.turnRate * dt;
    a.yaw += THREE.MathUtils.clamp(d, -max, max);
  }

  private move(b: Brain, dt: number): void {
    const a = b.actor;
    if (b.state === 'hurt' || b.state === 'dead' || !a.control.allowMove) wish.set(0, 0, 0);
    if (wish.lengthSq() > 1e-6) {
      const speed = wish.length() * a.control.moveFactor;
      wish.normalize();
      this.separate(a);
      this.steer(a);
      wish.multiplyScalar(speed);
    }
    stepCharacter(this.ctx.physics, a, wish, dt);
  }

  /** Adds a push away from nearby enemies to the (unit) wish direction. */
  private separate(a: Actor): void {
    const r = ENEMIES.separationRadius;
    for (const o of this.brains.keys()) {
      if (o === a || !o.alive || o.removed) continue;
      tmp.subVectors(a.position, o.position).setY(0);
      const d = tmp.length();
      if (d >= r || d < 1e-4) continue;
      wish.addScaledVector(tmp, (ENEMIES.separationWeight * (1 - d / r)) / d);
    }
    wish.setY(0);
    if (wish.lengthSq() > 1e-6) wish.normalize();
  }

  /** If an obstacle is close ahead, rotate the (unit) wish to the first clear alternative. */
  private steer(a: Actor): void {
    const phys = this.ctx.physics;
    origin.copy(a.position).setY(a.position.y + ENEMIES.steerProbeHeight);
    if (!phys.raycast(origin, wish, ENEMIES.steerProbe, { worldOnly: true })) return;
    for (const ang of STEER_ANGLES) {
      probe.copy(wish).applyAxisAngle(UP, ang);
      if (!phys.raycast(origin, probe, ENEMIES.steerProbe, { worldOnly: true })) {
        wish.copy(probe);
        return;
      }
    }
  }
}
