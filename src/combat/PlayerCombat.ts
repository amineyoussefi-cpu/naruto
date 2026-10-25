import * as THREE from 'three';
import { COMBAT } from '../config/combat';
import { CHARACTERS } from '../config/characters';
import type { AnimState, AttackKind, ChargeTechnique, QteDir, QteState } from '../core/types';
import type { Actor } from '../game/Actor';
import type { GameContext } from '../game/context';
import { pickAimTarget } from './aimAssist';
import { createQte, qteApply, qteFinish, qteTick, randomArrows } from './grab';

export type Move = 'none' | 'attack' | 'throw' | 'special' | 'dodge' | 'dash' | 'substitution' | 'charge' | 'chidori' | 'sharingan' | 'grab';
const COMBO_KINDS: AttackKind[] = ['combo1', 'combo2', 'combo3', 'combo4', 'combo5'];
const COMBO_ANIMS: AnimState[] = ['attack1', 'attack2', 'attack3', 'attack4', 'attack5'];
const STRIKE_ANIMS: Record<QteDir, AnimState> = { up: 'strikeUp', down: 'strikeDown', left: 'strikeLeft', right: 'strikeRight' };
const chargeCfg = (t: ChargeTechnique) => (t === 'rasengan' ? COMBAT.special : COMBAT.chidori);

/**
 * Turns player input into combat actions: homing 5-hit combo, chakra dash, substitution, kunai, special,
 * guard, dodge, concentrate.
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
  /** Set when a technique starts from the E key; cleared on release so one hold fires exactly one technique. */
  private specialLatch = false;
  private kunaiBuffer = 0;
  private concentrating = false;
  /** Concentration state of the previous step (for the one-shot start event). */
  private prevConcentrating = false;
  /** Set when concentration is interrupted by a hit; cleared once the key is released. */
  private concentrateLocked = false;
  private visuals = { guard: false, aura: false, orb: false, sharingan: false };
  /** Technique being charged (move 'charge'). */
  private chargeTech: ChargeTechnique = 'rasengan';
  /** Power (minPower..1) of the released Rasengan / Chidori. */
  private power = 1;
  /** Chidori dash: unit direction, metres left, enemies already hit this activation. */
  private readonly dashDir = new THREE.Vector3();
  private dashLeft = 0;
  private readonly dashHit = new Set<number>();
  /** Seconds left on the Sharingan eye effect (cast + genjutsu duration). */
  private sharinganTime = 0;
  /** Grab: held victim, its sequence, outro timer before ctx.qte is cleared, player lock after the grab ends. */
  private grabTarget: Actor | null = null;
  private qte: QteState | null = null;
  private qteOutro = 0;
  private recovery = 0;
  /** Homing target of the current combo hit / chakra dash (null = straight lunge / burst). */
  private target: Actor | null = null;
  /** Seconds spent closing in on the homing target before the windup clock starts. */
  private approach = 0;
  private readonly forced = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(private readonly ctx: GameContext, private readonly actor: Actor) {}

  /** Active Rasengan/Chidori charge for the HUD (level 0..1 = progress to full power), null when not charging. */
  get charge(): { technique: ChargeTechnique; level: number } | null {
    return this.move === 'charge' ? { technique: this.chargeTech, level: this.chargeLevel() } : null;
  }

  private chargeLevel(): number {
    return Math.min(1, this.t / chargeCfg(this.chargeTech).fullChargeTime);
  }

  /** Current combat move (debug/tests). */
  get currentMove(): Move { return this.move; }

  update(dt: number): void {
    const a = this.actor, f = a.fighter, c = a.control, input = this.ctx.input;
    const qteInputs = this.ctx.qteInputs.splice(0); // consumed every step, even when no grab is running
    if (this.qteOutro > 0 && (this.qteOutro -= dt) <= 0 && this.ctx.qte === this.qte) this.ctx.qte = this.qte = null;
    if (this.sharinganTime > 0 && (this.sharinganTime -= dt) <= 0) this.setSharingan(false);
    if (this.grabTarget && this.ctx.qte !== this.qte) this.dropGrab(); // cleared by CombatSystem.clear()
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
    if (!input.isHeld('special') && !this.ctx.pressed.has('special')) this.specialLatch = false;
    this.kunaiBuffer = this.ctx.pressed.has('kunai') ? COMBAT.inputBuffer : Math.max(0, this.kunaiBuffer - dt);

    if (a.alive && f.stunned && this.ctx.pressed.has('dodge')) this.trySubstitution();
    if (!a.alive || f.stunned) {
      this.cancel();
      c.allowMove = c.allowJump = false;
      c.animLocked = true;
      if (!a.alive) a.setAnim('dead');
      else if (a.anim !== 'hit' && a.anim !== 'launched') a.setAnim('hit', true);
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
      const wantsTechnique = this.wantsSpecial() || (this.kunaiBuffer > 0 && f.cooldownReady('kunai')) || this.ctx.pressed.has('grab');
      const wantsDash = this.ctx.pressed.has('sprint') && f.cooldownReady('dash') && this.findTarget(COMBAT.chakraDash.range) !== null;
      if (inRecovery && ((this.ctx.pressed.has('dodge') && f.cooldownReady('dodge')) || wantsTechnique || wantsDash)) {
        this.endMove();
        this.comboIndex = 0;
      }
      else if (inRecovery && this.attackBuffer > 0 && this.comboIndex < COMBAT.combo.length - 1) {
        this.startAttack(this.comboIndex + 1);
      }
    }
    // Dash-cancel: attacking during a chakra dash starts the combo right away.
    if (this.move === 'dash' && this.attackBuffer > 0) this.endMove();
    if (this.move === 'none') this.startFromInput();
    this.runMove(dt, qteInputs);
    this.setVisuals(f.guarding, f.concentrating);
    this.syncOrb();
  }

  /** True while the player is climbing a wall is decided by movement; combat reads actor.climbing. */
  reset(): void {
    this.move = 'none';
    this.t = 0;
    this.fired = false;
    this.comboIndex = 0;
    this.comboTimer = 0;
    this.attackBuffer = this.specialBuffer = this.kunaiBuffer = 0;
    this.specialLatch = false;
    this.target = null;
    this.approach = 0;
    this.concentrating = false;
    this.concentrateLocked = false;
    if (this.grabTarget && this.ctx.qte === this.qte) this.endGrab();
    this.dropGrab();
    if (this.ctx.qte === this.qte) this.ctx.qte = null;
    this.qte = null;
    this.qteOutro = this.recovery = 0;
    this.sharinganTime = 0;
    this.setSharingan(false);
    this.setVisuals(false, false);
    this.syncOrb();
  }

  private startFromInput(): void {
    const a = this.actor, f = a.fighter, pressed = this.ctx.pressed, input = this.ctx.input;
    if (pressed.has('dodge') && f.cooldownReady('dodge')) return this.startDodge();
    // Shift only chakra-dashes when there is someone to rush at; otherwise it is a free sprint (movement).
    if (pressed.has('sprint') && f.cooldownReady('dash') && this.findTarget(COMBAT.chakraDash.range)) return this.startDash();
    if (pressed.has('grab') && this.ctx.qte === null) return this.startGrab();
    if (this.wantsSpecial()) {
      this.specialBuffer = 0;
      this.specialLatch = true;
      const special = CHARACTERS[this.ctx.character].special;
      return special === 'sharingan' ? this.startSharingan() : this.startCharge(special);
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

  private runMove(dt: number, qteInputs: QteDir[]): void {
    const a = this.actor, c = a.control;
    if (this.move === 'none') return;
    c.allowMove = c.allowJump = false;
    c.animLocked = true;
    const fwd = a.forward(this.tmp);
    if (this.move === 'attack') {
      const hit = COMBAT.combo[this.comboIndex], h = COMBAT.homing;
      const target = this.target && this.target.alive && !this.target.removed ? this.target : null;
      if (target && this.t < hit.windup + hit.active) {
        const gap = this.pullToward(target, h.stopDistance, h.speed, dt);
        // Far target: close in first (bounded), the windup clock starts once in range.
        if (gap > 0.05 && !this.fired && this.approach < h.maxApproach) {
          this.approach += dt;
          this.t = 0;
        }
      } else if (this.t < hit.windup + hit.active) c.forcedVelocity = this.forced.copy(fwd).multiplyScalar(hit.lunge);
      if (!this.fired && this.t >= hit.windup) {
        this.fired = true;
        this.ctx.combat.spawnHitbox({
          owner: a, kind: COMBO_KINDS[this.comboIndex], forwardOffset: hit.range, heightOffset: COMBAT.hitboxHeight,
          radius: hit.radius, duration: hit.active, damage: hit.damage, knockback: hit.knockback, launch: hit.launch, stun: hit.stun,
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
    } else if (this.move === 'charge') {
      const cfg = chargeCfg(this.chargeTech);
      c.allowMove = true; // slow walk while charging (no jump)
      c.moveFactor = cfg.chargeMoveFactor;
      if (!this.ctx.input.isHeld('special') || this.t >= cfg.maxHoldTime) this.releaseCharge();
    } else if (this.move === 'chidori') {
      c.passThroughActors = true; // pierce through enemies; walls still stop the dash
      this.runChidori(dt);
    } else if (this.move === 'sharingan') {
      c.forcedVelocity = this.forced.set(0, 0, 0);
      if (this.t >= COMBAT.sharingan.castTime) {
        this.applyGenjutsu();
        this.endMove();
      }
    } else if (this.move === 'grab') {
      c.forcedVelocity = this.forced.set(0, 0, 0);
      if (this.grabTarget) this.updateGrab(this.grabTarget, qteInputs, dt);
      else if (this.t >= this.recovery) this.endMove();
    } else if (this.move === 'special') {
      const s = COMBAT.special;
      if (this.t < s.windup) {
        this.faceTarget();
        c.forcedVelocity = this.forced.set(0, 0, 0);
      } else {
        if (!this.fired) {
          this.fired = true;
          const p = this.power;
          this.ctx.combat.spawnHitbox({
            owner: a, kind: 'special', forwardOffset: s.forwardOffset, heightOffset: COMBAT.hitboxHeight,
            radius: s.radius * (s.minRadiusScale + (1 - s.minRadiusScale) * p), duration: s.dashTime,
            damage: s.damage * p, knockback: s.knockback * p,
          });
          this.ctx.events.emit('technique', { id: a.id, name: 'special', position: this.pos(), power: p });
        }
        c.forcedVelocity = this.forced.copy(fwd).multiplyScalar(s.dashSpeed);
        if (this.t >= s.windup + s.dashTime) this.endMove();
      }
    } else if (this.move === 'dodge') {
      c.forcedVelocity = this.forced;
      if (this.t >= COMBAT.dodge.duration) this.endMove();
    } else if (this.move === 'dash') {
      const d = COMBAT.chakraDash;
      a.velocity.y = 0; // air dash: no gravity build-up
      const target = this.target && this.target.alive && !this.target.removed ? this.target : null;
      if (target) {
        const gap = this.pullToward(target, d.stopDistance, d.speed, dt);
        if (gap <= 0.05 || this.t >= d.maxDuration) this.endMove();
      } else {
        c.forcedVelocity = this.forced;
        if (this.t >= d.burstTime) this.endMove();
      }
    } else if (this.move === 'substitution') {
      c.forcedVelocity = this.forced.set(0, 0, 0);
      if (this.t >= COMBAT.substitution.animTime) this.endMove();
    }
  }

  /** Rasengan / Chidori: hold to charge; chakra is paid on release (a tap releases at once at minPower). */
  /** E pressed recently, or still held after another move ended (holding E always charges as soon as possible). */
  private wantsSpecial(): boolean {
    return !this.specialLatch && (this.specialBuffer > 0 || this.ctx.input.isHeld('special'));
  }

  private startCharge(tech: ChargeTechnique): void {
    this.chargeTech = tech;
    this.begin('charge', 'charge');
    this.faceTarget();
    this.ctx.events.emit('chargeStart', { id: this.actor.id, technique: tech, fullTime: chargeCfg(tech).fullChargeTime });
  }

  private releaseCharge(): void {
    const a = this.actor, tech = this.chargeTech, cfg = chargeCfg(tech), ev = this.ctx.events;
    const level = this.chargeLevel();
    if (!a.fighter.trySpendChakra(cfg.chakraCost)) {
      ev.emit('chakraFail', { id: a.id, action: 'special' });
      this.endMove();
      return;
    }
    this.power = cfg.minPower + (1 - cfg.minPower) * level;
    this.faceTarget();
    ev.emit('chargeRelease', { id: a.id, technique: tech, power: this.power });
    if (tech === 'rasengan') {
      this.begin('special', 'special');
      ev.emit('attackStart', { id: a.id, kind: 'special', position: this.pos() });
      return;
    }
    const d = COMBAT.chidori;
    a.forward(this.dashDir);
    this.dashLeft = d.dashDistance * (d.distanceMinScale + (1 - d.distanceMinScale) * this.power);
    this.dashHit.clear();
    this.begin('chidori', 'chidori');
    ev.emit('attackStart', { id: a.id, kind: 'chidori', position: this.pos() });
    ev.emit('technique', { id: a.id, name: 'chidori', position: this.pos(), power: this.power });
  }

  /** Piercing dash: sweeps enemies along this step's path (each hit once), stops before world obstacles. */
  private runChidori(dt: number): void {
    const a = this.actor, d = COMBAT.chidori, dir = this.dashDir;
    a.velocity.y = 0;
    let step = Math.min(d.dashSpeed * dt, this.dashLeft);
    const from = this.tmp2.copy(a.position).setY(a.position.y + COMBAT.hitboxHeight);
    const wall = this.ctx.physics.raycast(from, dir, step + a.radius + d.wallMargin, { worldOnly: true });
    if (wall) step = Math.max(0, wall.distance - a.radius - d.wallMargin);
    const y = a.position.y + COMBAT.hitboxHeight;
    for (const e of this.ctx.enemies()) {
      if (this.dashHit.has(e.id) || e.removed) continue;
      const px = e.position.x - a.position.x, pz = e.position.z - a.position.z;
      const along = Math.max(0, Math.min(step, px * dir.x + pz * dir.z));
      const qx = px - dir.x * along, qz = pz - dir.z * along, reach = d.radius + e.radius;
      if (qx * qx + qz * qz > reach * reach || y + d.radius < e.position.y || y - d.radius > e.position.y + e.height) continue;
      this.dashHit.add(e.id);
      const res = this.ctx.combat.dealDamage(a, e, d.damage * this.power, 0, 'chidori', e.chest(), 0, d.stun);
      if (res.ignored) continue;
      const side = px * dir.z - pz * dir.x >= 0 ? 1 : -1; // push away from the path, to the enemy's side
      e.knockback.x += dir.z * side * d.knockback;
      e.knockback.z += -dir.x * side * d.knockback;
    }
    this.dashLeft -= step;
    a.control.forcedVelocity = this.forced.copy(dir).multiplyScalar(step / dt);
    if (wall || this.dashLeft <= 1e-6) this.endMove();
  }

  private startSharingan(): void {
    const a = this.actor, f = a.fighter, s = COMBAT.sharingan;
    if (!f.cooldownReady('special')) return;
    if (!f.trySpendChakra(s.chakraCost)) {
      this.ctx.events.emit('chakraFail', { id: a.id, action: 'special' });
      return;
    }
    f.startCooldown('special', s.cooldown);
    this.begin('sharingan', 'sharingan');
    this.faceTarget();
    this.sharinganTime = s.castTime + s.duration;
    this.setSharingan(true);
  }

  private applyGenjutsu(): void {
    const a = this.actor, s = COMBAT.sharingan;
    const targets = this.ctx.enemies().filter((e) => !e.removed && e.position.distanceTo(a.position) <= s.radius);
    for (const e of targets) {
      e.disoriented = s.duration;
      this.ctx.combat.cancelHitboxes(e);
    }
    this.ctx.events.emit('genjutsu', { id: a.id, targets: targets.map((e) => e.id), radius: s.radius, duration: s.duration });
    this.ctx.events.emit('technique', { id: a.id, name: 'sharingan', position: this.pos() });
  }

  /** Grab: nearest valid enemy in the front cone (lock target preferred), else a whiff. */
  private startGrab(): void {
    const a = this.actor, g = COMBAT.grab;
    const t = this.findGrabTarget();
    this.begin('grab', 'grabHold');
    this.recovery = g.whiffTime;
    if (!t) return;
    this.grabTarget = t;
    t.grabbedBy = a.id;
    this.ctx.combat.cancelHitboxes(t);
    this.faceActor(t);
    this.qte = this.ctx.qte = createQte(t.id, randomArrows(g.arrows), g.time);
    this.qteOutro = 0;
    a.fighter.setInvulnerable(g.invulnerablePad);
    this.holdVictim(t);
    this.ctx.events.emit('grabStart', { id: a.id, targetId: t.id });
  }

  private findGrabTarget(): Actor | null {
    const a = this.actor, g = COMBAT.grab;
    const cosHalf = Math.cos(((g.coneDeg / 2) * Math.PI) / 180);
    const yaw = this.ctx.camera.yaw, cx = Math.sin(yaw), cz = Math.cos(yaw);
    const px = Math.sin(a.yaw), pz = Math.cos(a.yaw);
    const dist = (e: Actor) => Math.hypot(e.position.x - a.position.x, e.position.z - a.position.z);
    const valid = (e: Actor) => {
      if (!e.alive || e.removed || e.grabbedBy !== null || e.team === a.team) return false;
      const dx = e.position.x - a.position.x, dz = e.position.z - a.position.z, d = Math.hypot(dx, dz);
      return d <= g.range && (d < 1e-3 || (dx * px + dz * pz) / d >= cosHalf || (dx * cx + dz * cz) / d >= cosHalf);
    };
    const lock = this.lockTarget();
    if (lock && valid(lock)) return lock;
    let best: Actor | null = null;
    for (const e of this.ctx.enemies()) if (valid(e) && (!best || dist(e) < dist(best))) best = e;
    return best;
  }

  private updateGrab(t: Actor, inputs: QteDir[], dt: number): void {
    const a = this.actor, g = COMBAT.grab, q = this.qte;
    if (!q) return this.dropGrab();
    a.fighter.setInvulnerable(g.invulnerablePad);
    for (const dir of inputs) {
      if (!t.alive) break;
      const r = qteApply(q, dir);
      if (r === 'ignored') break;
      this.ctx.events.emit('qteInput', { id: a.id, dir, correct: r !== 'miss', index: r === 'miss' ? q.index : q.index - 1 });
      if (r === 'miss') break;
      const i = q.index - 1;
      a.setAnim(r === 'complete' ? 'grabFinisher' : STRIKE_ANIMS[dir], true);
      // Strikes never kill: the finisher always gets to land (and the completion bonus matters).
      const strike = Math.min(g.damagePerHit * (1 + g.damageRamp * i), Math.max(0, t.fighter.hp - 1));
      if (strike > 0) this.ctx.combat.dealDamage(a, t, strike, g.strikeKnockback, 'grabStrike', t.chest(), 0, g.strikeStun);
      if (r === 'complete' && t.alive) {
        t.grabbedBy = null; // released before the launch so movement takes over
        this.ctx.combat.dealDamage(a, t, g.finisherDamage, g.finisherKnockback, 'grabFinisher', t.chest(), g.finisherLaunch, g.releaseStun);
      }
    }
    if (!q.done && (!t.alive || t.removed)) qteFinish(q, 'interrupted');
    if (!q.done) qteTick(q, dt);
    if (q.done) return this.endGrab();
    this.holdVictim(t);
  }

  /** Keeps the victim in front of the player, facing it, stunned (leftover stun = release stun). */
  private holdVictim(t: Actor): void {
    const a = this.actor, g = COMBAT.grab;
    const p = this.tmp2.copy(a.position).addScaledVector(a.forward(this.tmp), g.holdDistance);
    this.ctx.physics.teleport(t.body, p);
    t.position.copy(p);
    t.velocity.set(0, 0, 0);
    t.yaw = a.yaw + Math.PI;
    t.fighter.setStun(g.releaseStun);
    t.setAnim('grabbed');
  }

  /** Ends the running sequence (default 'interrupted'), emits grabEnd, releases the victim and starts the outro. */
  private endGrab(): void {
    const q = this.qte, t = this.grabTarget, g = COMBAT.grab;
    if (!q || !t) return this.dropGrab();
    qteFinish(q, 'interrupted');
    const result = q.result as 'complete' | 'miss' | 'timeout' | 'interrupted';
    this.ctx.events.emit('grabEnd', { id: this.actor.id, targetId: q.targetId, result, hits: q.index });
    if (t.grabbedBy === this.actor.id) t.grabbedBy = null;
    if (t.alive && result !== 'complete') t.setAnim('hit', true);
    this.grabTarget = null;
    this.qteOutro = g.outro;
    this.recovery = result === 'complete' ? g.finisherRecovery : g.missRecovery;
    this.t = 0;
  }

  /** Forgets the grab without events (sequence already cleaned up elsewhere). */
  private dropGrab(): void {
    if (this.grabTarget && this.grabTarget.grabbedBy === this.actor.id) this.grabTarget.grabbedBy = null;
    this.grabTarget = null;
    if (this.move === 'grab') this.endMove();
  }

  private startAttack(index: number): void {
    this.comboIndex = index;
    this.begin('attack', COMBO_ANIMS[index]);
    this.attackBuffer = 0;
    this.approach = 0;
    this.target = this.findTarget(COMBAT.homing.range);
    if (this.target) this.faceActor(this.target);
    else this.faceTarget();
    this.ctx.events.emit('attackStart', { id: this.actor.id, kind: COMBO_KINDS[index], position: this.pos() });
  }

  private startDodge(): void {
    const a = this.actor, d = COMBAT.dodge;
    if (!this.inputDir(this.forced)) a.forward(this.forced).multiplyScalar(-1);
    this.forced.multiplyScalar(d.speed);
    a.fighter.startCooldown('dodge', d.cooldown);
    a.fighter.setInvulnerable(d.invulnerable);
    this.begin('dodge', 'dodge');
    this.ctx.events.emit('dodge', { id: a.id });
  }

  /** Chakra dash: homing rush at a target in range (callers only start it when one exists; the burst is a fallback). */
  private startDash(): void {
    const a = this.actor, f = a.fighter, d = COMBAT.chakraDash;
    if (!f.trySpendChakra(d.cost)) {
      this.ctx.events.emit('chakraFail', { id: a.id, action: 'dash' });
      return;
    }
    f.startCooldown('dash', d.cooldown);
    this.target = this.findTarget(d.range);
    if (this.target) this.faceActor(this.target);
    else {
      if (this.inputDir(this.forced)) a.yaw = Math.atan2(this.forced.x, this.forced.z);
      a.forward(this.forced).multiplyScalar(d.speed);
    }
    a.velocity.y = 0;
    this.begin('dash', 'dash');
    this.ctx.events.emit('chakraDash', { id: a.id, homing: this.target !== null });
  }

  /** Substitution jutsu: reappear behind the last attacker, free of stun. Returns false when refused. */
  private trySubstitution(): boolean {
    const a = this.actor, f = a.fighter, s = COMBAT.substitution;
    if (!f.stunned || !f.trySpendSubstitution()) return false;
    const last = this.ctx.combat.lastAttacker.get(a.id);
    const attacker = last && last.alive && !last.removed ? last : null;
    const anchor = attacker ? attacker.position : a.position;
    // Direction "behind" = from the player through the attacker (or backwards without an attacker).
    const behind = new THREE.Vector3(anchor.x - a.position.x, 0, anchor.z - a.position.z);
    if (behind.lengthSq() < 1e-6) a.forward(behind).multiplyScalar(-1);
    behind.normalize();
    const left = new THREE.Vector3(behind.z, 0, -behind.x);
    const from = this.pos();
    const origin = new THREE.Vector3(anchor.x, anchor.y + COMBAT.hitboxHeight, anchor.z);
    const dir = [behind, left, left.clone().negate(), behind.clone().negate()]
      .find((d) => !this.ctx.physics.raycast(origin, d, s.distanceBehind + a.radius, { worldOnly: true }));
    const to = dir ? new THREE.Vector3(anchor.x, anchor.y, anchor.z).addScaledVector(dir, s.distanceBehind) : a.position.clone();
    this.ctx.physics.teleport(a.body, to);
    a.position.copy(to);
    a.prevPosition.copy(to);
    a.velocity.set(0, 0, 0);
    a.knockback.set(0, 0, 0);
    if (attacker) this.faceActor(attacker);
    f.clearStun();
    f.setInvulnerable(s.invulnerable);
    this.cancel();
    this.begin('substitution', 'substitution');
    this.ctx.events.emit('substitution', { id: a.id, from, to: { x: to.x, y: to.y, z: to.z } });
    return true;
  }

  /** Camera-relative unit direction of the movement keys into `out`; false when no key is held. */
  private inputDir(out: THREE.Vector3): boolean {
    const { x, y } = this.ctx.input.moveAxes();
    if (x === 0 && y === 0) return false;
    const yaw = this.ctx.camera.yaw, sx = Math.sin(yaw), cz = Math.cos(yaw);
    out.set(sx * y - cz * x, 0, cz * y + sx * x).normalize(); // camera forward*y + right*x
    return true;
  }

  /**
   * Faces `t` and forces horizontal velocity toward it, arriving exactly `stop` m away (never overshoots).
   * Returns the remaining horizontal gap beyond `stop`.
   */
  private pullToward(t: Actor, stop: number, speed: number, dt: number): number {
    const a = this.actor;
    this.faceActor(t);
    const dir = this.forced.set(t.position.x - a.position.x, 0, t.position.z - a.position.z);
    const gap = Math.max(0, dir.length() - stop);
    if (dir.lengthSq() > 1e-6) dir.normalize();
    a.control.forcedVelocity = dir.multiplyScalar(Math.min(speed, gap / dt));
    return gap;
  }

  /**
   * Homing target: the lock target if within `range`, else the nearest living enemy within `range`
   * inside the homing cone around the camera or player forward.
   */
  private findTarget(range: number): Actor | null {
    const a = this.actor;
    const lock = this.lockTarget();
    if (lock && lock.position.distanceTo(a.position) <= range) return lock;
    const cosHalf = Math.cos(((COMBAT.homing.coneDeg / 2) * Math.PI) / 180);
    const yaw = this.ctx.camera.yaw, cx = Math.sin(yaw), cz = Math.cos(yaw);
    const px = Math.sin(a.yaw), pz = Math.cos(a.yaw);
    let best: Actor | null = null;
    let bestD = range;
    for (const e of this.ctx.enemies()) {
      const dx = e.position.x - a.position.x, dz = e.position.z - a.position.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const inCone = d < 1e-3 || (dx * cx + dz * cz) / d >= cosHalf || (dx * px + dz * pz) / d >= cosHalf;
      if (inCone) { best = e; bestD = d; }
    }
    return best;
  }

  private throwKunai(): void {
    const a = this.actor, k = COMBAT.kunai, cam = this.ctx.camera, physics = this.ctx.physics;
    const target = this.lockTarget() ?? pickAimTarget({
      camera: cam.camera, origin: a.chest(), forward: new THREE.Vector3(Math.sin(cam.yaw), 0, Math.cos(cam.yaw)),
      candidates: this.ctx.enemies(), range: COMBAT.aimAssist.range, screenRadius: COMBAT.aimAssist.screenRadius,
      lineOfSight: (from, to) => {
        const d = to.clone().sub(from), len = d.length();
        return len < 1e-6 || !physics.raycast(from, d.divideScalar(len), len, { worldOnly: true });
      },
    });
    if (target) this.faceActor(target);
    else a.yaw = cam.yaw;
    const origin = a.chest().addScaledVector(a.forward(this.tmp), k.spawnForward);
    // No target: toward the reticle (camera forward, kunai max range ahead of the camera).
    const dir = target ? target.chest().sub(origin)
      : cam.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(k.maxRange).add(cam.camera.position).sub(origin);
    this.ctx.combat.spawnProjectile({
      owner: a, kind: 'kunai', origin, direction: dir.normalize(), speed: k.speed, damage: k.damage,
      radius: k.radius, maxRange: k.maxRange, knockback: k.knockback, visual: 'kunai',
    });
  }

  private begin(move: Move, anim: AnimState): void {
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

  /** Stun, death or climbing: drop the current action (a charge is cancelled free). Its hitbox dies in CombatSystem. */
  private cancel(): void {
    if (this.move === 'attack') this.comboIndex = 0;
    if (this.grabTarget) this.endGrab();
    if (this.move === 'sharingan') {
      this.sharinganTime = 0;
      this.setSharingan(false);
    }
    this.endMove();
    this.target = null;
    this.attackBuffer = 0;
    this.setVisuals(false, false);
    this.syncOrb();
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

  private setVisuals(guard: boolean, aura: boolean): void {
    const v = this.visuals, m = this.actor.model;
    if (v.guard !== guard) m.setGuard((v.guard = guard));
    if (v.aura !== aura) m.setAura((v.aura = aura));
  }

  /** Hand orb while charging (level = progress) and during the Rasengan / Chidori dash (level = power). */
  private syncOrb(): void {
    const m = this.actor.model, mv = this.move;
    const style = mv === 'charge' ? this.chargeTech : mv === 'special' ? 'rasengan' : mv === 'chidori' ? 'chidori' : null;
    if (style) m.setHandOrb(true, mv === 'charge' ? this.chargeLevel() : this.power, style);
    else if (this.visuals.orb) m.setHandOrb(false);
    this.visuals.orb = style !== null;
  }

  private setSharingan(on: boolean): void {
    if (this.visuals.sharingan !== on) this.actor.model.setSharingan((this.visuals.sharingan = on));
  }
}
