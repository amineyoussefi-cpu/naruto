import * as THREE from 'three';
import { COMBAT } from '../config/combat';
import type { AttackKind } from '../core/types';
import type { Actor } from '../game/Actor';
import type { GameContext } from '../game/context';

export type Move = 'none' | 'attack' | 'throw' | 'special' | 'dodge';
const COMBO_KINDS: AttackKind[] = ['combo1', 'combo2', 'combo3'];
const COMBO_ANIMS = ['attack1', 'attack2', 'attack3'] as const;

/**
 * Turns player input into combat actions: combo, kunai, special, guard, dodge, concentrate.
 * Runs before PlayerController each step and writes actor.control. Owner: combat agent.
 */
export class PlayerCombat {
  private move: Move = 'none';
  private t = 0;
  private fired = false;
  /** Index of the combo hit currently playing / next to play. */
  private comboIndex = 0;
  private comboTimer = 0;
  private attackBuffer = 0;
  /** Special/kunai presses made during another move fire when it ends (or cancel combo recovery). */
  private specialBuffer = 0;
  private kunaiBuffer = 0;
  private concentrating = false;
  /** Concentration state of the previous step (for the one-shot start event). */
  private prevConcentrating = false;
  /** Set when concentration is interrupted by a hit; cleared once the key is released. */
  private concentrateLocked = false;
  private visuals = { guard: false, aura: false, orb: false };
  private readonly forced = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly ctx: GameContext, private readonly actor: Actor) {}

  /** Current combat move (debug/tests). */
  get currentMove(): Move { return this.move; }

  update(dt: number): void {
    const a = this.actor, f = a.fighter, c = a.control, input = this.ctx.input;
    a.resetControl();
    this.prevConcentrating = this.concentrating;
    if (this.concentrating && !f.concentrating) this.concentrateLocked = true; // a hit cleared it
    if (!input.isHeld('concentrate')) this.concentrateLocked = false;
    f.guarding = false;
    f.concentrating = false;
    this.concentrating = false;
    if (this.ctx.pressed.has('attack')) this.attackBuffer = COMBAT.inputBuffer;
    else this.attackBuffer = Math.max(0, this.attackBuffer - dt);
    this.specialBuffer = this.ctx.pressed.has('special') ? COMBAT.inputBuffer : Math.max(0, this.specialBuffer - dt);
    this.kunaiBuffer = this.ctx.pressed.has('kunai') ? COMBAT.inputBuffer : Math.max(0, this.kunaiBuffer - dt);

    if (!a.alive || f.stunned) {
      this.cancel();
      c.allowMove = c.allowJump = false;
      c.animLocked = true;
      if (!a.alive) a.setAnim('dead');
      else if (a.anim !== 'hit') a.setAnim('hit', true);
      return;
    }
    if (a.climbing) {
      this.cancel();
      return;
    }

    if (this.move === 'none') {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.comboIndex = 0;
    }
    this.t += dt;
    // Attack recovery can be cancelled by the next combo hit or a dodge.
    if (this.move === 'attack') {
      const hit = COMBAT.combo[this.comboIndex];
      const inRecovery = this.t >= hit.windup + hit.active;
      const wantsTechnique = this.specialBuffer > 0 || (this.kunaiBuffer > 0 && f.cooldownReady('kunai'));
      if (inRecovery && ((this.ctx.pressed.has('dodge') && f.cooldownReady('dodge')) || wantsTechnique)) {
        this.endMove();
        this.comboIndex = 0;
      }
      else if (inRecovery && this.attackBuffer > 0 && this.comboIndex < COMBAT.combo.length - 1) {
        this.startAttack(this.comboIndex + 1);
      }
    }
    if (this.move === 'none') this.startFromInput();
    this.runMove();
    this.setVisuals(f.guarding, f.concentrating, this.move === 'special');
  }

  /** True while the player is climbing a wall is decided by movement; combat reads actor.climbing. */
  reset(): void {
    this.move = 'none';
    this.t = 0;
    this.fired = false;
    this.comboIndex = 0;
    this.comboTimer = 0;
    this.attackBuffer = this.specialBuffer = this.kunaiBuffer = 0;
    this.concentrating = false;
    this.concentrateLocked = false;
    this.setVisuals(false, false, false);
  }

  private startFromInput(): void {
    const a = this.actor, f = a.fighter, pressed = this.ctx.pressed, input = this.ctx.input;
    if (pressed.has('dodge') && f.cooldownReady('dodge')) return this.startDodge();
    if (this.specialBuffer > 0) {
      this.specialBuffer = 0;
      if (!f.cooldownReady('special')) return;
      if (!f.trySpendChakra(COMBAT.special.chakraCost)) {
        this.ctx.events.emit('chakraFail', { id: a.id, action: 'special' });
        return;
      }
      f.startCooldown('special', COMBAT.special.cooldown);
      this.begin('special', 'special');
      this.faceTarget();
      this.ctx.events.emit('attackStart', { id: a.id, kind: 'special', position: this.pos() });
      return;
    }
    if (this.kunaiBuffer > 0 && f.cooldownReady('kunai')) {
      this.kunaiBuffer = 0;
      f.startCooldown('kunai', COMBAT.kunai.cooldown);
      this.begin('throw', 'throw');
      this.ctx.events.emit('attackStart', { id: a.id, kind: 'kunai', position: this.pos() });
      return;
    }
    if (this.attackBuffer > 0) {
      this.startAttack(this.comboTimer > 0 && this.comboIndex < COMBAT.combo.length ? this.comboIndex : 0);
      return;
    }
    if (!a.grounded) return;
    if (input.isHeld('guard')) {
      f.guarding = true;
      a.setAnim('guard');
      a.control.moveFactor = COMBAT.guardMoveFactor;
      a.control.animLocked = true;
    } else if (input.isHeld('concentrate') && !this.concentrateLocked) {
      if (!this.prevConcentrating) this.ctx.events.emit('concentrateStart', { id: a.id });
      f.concentrating = this.concentrating = true;
      a.setAnim('concentrate');
      a.control.allowMove = a.control.allowJump = false;
      a.control.animLocked = true;
    }
  }

  private runMove(): void {
    const a = this.actor, c = a.control;
    if (this.move === 'none') return;
    c.allowMove = c.allowJump = false;
    c.animLocked = true;
    const fwd = a.forward(this.tmp);
    if (this.move === 'attack') {
      const hit = COMBAT.combo[this.comboIndex];
      if (this.t < hit.windup + hit.active) c.forcedVelocity = this.forced.copy(fwd).multiplyScalar(hit.lunge);
      if (!this.fired && this.t >= hit.windup) {
        this.fired = true;
        this.ctx.combat.spawnHitbox({
          owner: a, kind: COMBO_KINDS[this.comboIndex], forwardOffset: hit.range, heightOffset: COMBAT.hitboxHeight,
          radius: hit.radius, duration: hit.active, damage: hit.damage, knockback: hit.knockback,
        });
      }
      if (this.t >= hit.windup + hit.active + hit.recovery) {
        this.comboTimer = COMBAT.comboResetTime;
        this.comboIndex = this.comboIndex + 1 >= COMBAT.combo.length ? 0 : this.comboIndex + 1;
        if (this.comboIndex === 0) this.comboTimer = 0;
        this.endMove();
      }
    } else if (this.move === 'throw') {
      const k = COMBAT.kunai;
      if (!this.fired && this.t >= k.windup) {
        this.fired = true;
        this.throwKunai();
      }
      if (this.t >= k.windup + k.recovery) this.endMove();
    } else if (this.move === 'special') {
      const s = COMBAT.special;
      if (this.t < s.windup) {
        this.faceTarget();
        c.forcedVelocity = this.forced.set(0, 0, 0);
      } else {
        if (!this.fired) {
          this.fired = true;
          this.ctx.combat.spawnHitbox({
            owner: a, kind: 'special', forwardOffset: s.forwardOffset, heightOffset: COMBAT.hitboxHeight,
            radius: s.radius, duration: s.dashTime, damage: s.damage, knockback: s.knockback,
          });
          this.ctx.events.emit('technique', { id: a.id, name: 'special', position: this.pos() });
        }
        c.forcedVelocity = this.forced.copy(fwd).multiplyScalar(s.dashSpeed);
        if (this.t >= s.windup + s.dashTime) this.endMove();
      }
    } else if (this.move === 'dodge') {
      c.forcedVelocity = this.forced;
      if (this.t >= COMBAT.dodge.duration) this.endMove();
    }
  }

  private startAttack(index: number): void {
    this.comboIndex = index;
    this.begin('attack', COMBO_ANIMS[index]);
    this.attackBuffer = 0;
    this.faceTarget();
    this.ctx.events.emit('attackStart', { id: this.actor.id, kind: COMBO_KINDS[index], position: this.pos() });
  }

  private startDodge(): void {
    const a = this.actor, d = COMBAT.dodge;
    const { x, y } = this.ctx.input.moveAxes();
    if (x === 0 && y === 0) a.forward(this.forced).multiplyScalar(-1);
    else {
      const yaw = this.ctx.camera.yaw, sx = Math.sin(yaw), cz = Math.cos(yaw);
      this.forced.set(sx * y - cz * x, 0, cz * y + sx * x).normalize(); // camera forward*y + right*x
    }
    this.forced.multiplyScalar(d.speed);
    a.fighter.startCooldown('dodge', d.cooldown);
    a.fighter.setInvulnerable(d.invulnerable);
    this.begin('dodge', 'dodge');
    this.ctx.events.emit('dodge', { id: a.id });
  }

  private throwKunai(): void {
    const a = this.actor, k = COMBAT.kunai;
    const lock = this.lockTarget();
    if (lock) this.faceActor(lock);
    else a.yaw = this.ctx.camera.yaw;
    const origin = a.chest().addScaledVector(a.forward(this.tmp), k.spawnForward);
    const dir = lock ? lock.chest().sub(origin) : a.forward();
    this.ctx.combat.spawnProjectile({
      owner: a, kind: 'kunai', origin, direction: dir.normalize(), speed: k.speed, damage: k.damage,
      radius: k.radius, maxRange: k.maxRange, knockback: k.knockback, visual: 'kunai',
    });
  }

  private begin(move: Move, anim: (typeof COMBO_ANIMS)[number] | 'throw' | 'special' | 'dodge'): void {
    this.move = move;
    this.t = 0;
    this.fired = false;
    this.actor.setAnim(anim, true);
  }

  private endMove(): void {
    this.move = 'none';
    this.t = 0;
    this.fired = false;
  }

  /** Stun, death or climbing: drop the current action. Its hitbox dies in CombatSystem. */
  private cancel(): void {
    if (this.move === 'attack') this.comboIndex = 0;
    this.endMove();
    this.attackBuffer = 0;
    this.setVisuals(false, false, false);
  }

  /** Lock target, else the nearest living enemy within `COMBAT.autoFaceRange`. */
  private faceTarget(): void {
    const lock = this.lockTarget();
    if (lock) return this.faceActor(lock);
    let best: Actor | null = null;
    let bestD: number = COMBAT.autoFaceRange;
    for (const e of this.ctx.enemies()) {
      const d = e.position.distanceTo(this.actor.position);
      if (d <= bestD) { best = e; bestD = d; }
    }
    if (best) this.faceActor(best);
  }

  private lockTarget(): Actor | null {
    const t = this.ctx.camera.lockTarget;
    return t && t.alive && !t.removed ? t : null;
  }

  private faceActor(t: Actor): void {
    const dx = t.position.x - this.actor.position.x, dz = t.position.z - this.actor.position.z;
    if (dx * dx + dz * dz > 1e-6) this.actor.yaw = Math.atan2(dx, dz);
  }

  private pos() {
    const p = this.actor.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  private setVisuals(guard: boolean, aura: boolean, orb: boolean): void {
    const v = this.visuals, m = this.actor.model;
    if (v.guard !== guard) m.setGuard((v.guard = guard));
    if (v.aura !== aura) m.setAura((v.aura = aura));
    if (v.orb !== orb) m.setHandOrb((v.orb = orb));
  }
}
