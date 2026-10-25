import * as THREE from 'three';
import { MOVEMENT } from '../../config/movement';
import { COMBAT } from '../../config/combat';
import { stepCharacter } from '../physics/locomotion';
import { FootstepTimer, JumpAssist, drainClimbChakra, jumpVelocity, turnToward } from './movementMath';
import type { Actor } from '../Actor';
import type { PlayerState, SimContext } from '../context';
import { hasBit, type InputAction } from '../protocol';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Camera-relative locomotion, jump, wall climbing, respawn. Owner: movement agent.
 *
 * Facing rules (in priority order): climbing faces the wall; during a combat `forcedVelocity`
 * combat owns yaw (dodge/lunge/dash); lock-on without sprint faces the target (strafe); otherwise face movement.
 */
export class PlayerController {
  private delta = new THREE.Vector3();
  private wish = new THREE.Vector3();
  private origin = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private wallNormal = new THREE.Vector3();
  private readonly safePos = new THREE.Vector3();
  private readonly jumpAssist = new JumpAssist(MOVEMENT.coyoteTime, MOVEMENT.jumpBuffer);
  private readonly footsteps = new FootstepTimer();
  private sprinting = false;
  /** Double-tap-forward high-speed run; lasts while forward stays held. */
  private boosting = false;
  private airTime = 0;
  /** Seconds before auto-attach is allowed again after leaving a wall. */
  private reattach = 0;
  private airJumpsLeft: number = MOVEMENT.airJumps;

  private readonly actor: Actor;

  constructor(private readonly ctx: SimContext, private readonly player: PlayerState) {
    this.actor = player.actor;
  }

  private held(a: InputAction): boolean { return hasBit(this.player.input.held, a); }

  /** Camera-relative move axes of this step's input (PvP genjutsu rotates them, see `disorientAngle`). */
  private axes(): { x: number; y: number } {
    const i = this.player.input;
    const ang = this.actor.disoriented > 0 ? this.disorientAngle : 0;
    if (ang === 0) return { x: i.moveX, y: i.moveZ };
    const c = Math.cos(ang), s = Math.sin(ang);
    return { x: i.moveX * c - i.moveZ * s, y: i.moveX * s + i.moveZ * c };
  }

  /** Random rotation of the movement input while a player is disoriented; re-rolled every `disorientTurn` s. */
  private disorientAngle = 0;
  private disorientTimer = 0

  /** True while sprint is active (held, moving, started on the ground). */
  get isSprinting(): boolean {
    return this.sprinting;
  }

  update(dt: number): void {
    const a = this.actor;
    const c = a.control;
    const alive = a.alive;
    this.tickDisorient(dt);
    const downed = a.downed > 0;
    const axes = alive || downed ? this.axes() : { x: 0, y: 0 };
    const jumpPressed = alive && c.allowJump && this.player.pressed.has('jump');

    if (a.climbing && (!alive || !c.allowJump)) a.climbing = false;

    const wasClimbing = a.climbing;
    this.reattach = Math.max(0, this.reattach - dt);
    if (a.climbing) {
      this.updateClimb(dt, axes, jumpPressed);
    } else {
      // Automatic: running into a climbable wall attaches (jump near a wall still works too).
      const wantsWall = alive && !downed && c.allowMove && c.allowJump && (axes.x !== 0 || axes.y !== 0) && this.reattach <= 0;
      if ((wantsWall || (jumpPressed && this.reattach <= 0)) && this.tryStartClimb(axes, !jumpPressed)) {
        this.updateClimb(dt, axes, false);
      } else {
        this.updateGround(dt, axes, jumpPressed, alive, downed);
      }
    }
    if (wasClimbing && !a.climbing) this.reattach = MOVEMENT.climbReattachDelay;

    this.updateRespawn();
  }

  private tickDisorient(dt: number): void {
    if (this.actor.disoriented <= 0) { this.disorientAngle = 0; this.disorientTimer = 0; return; }
    this.disorientTimer -= dt;
    if (this.disorientTimer > 0) return;
    this.disorientTimer = MOVEMENT.disorientTurn;
    this.disorientAngle = (this.ctx.rng() * 2 - 1) * Math.PI;
  }

  // ---------------------------------------------------------------- ground / air

  private updateGround(dt: number, axes: { x: number; y: number }, jumpPressed: boolean, alive: boolean, downed: boolean): void {
    const a = this.actor;
    const c = a.control;
    const moving = (c.allowMove || downed) && (axes.x !== 0 || axes.y !== 0);
    const sprintHeld = alive && moving && this.held('sprint');
    // Sprint starts on the ground and keeps its momentum through a jump.
    this.sprinting = sprintHeld && (a.grounded || this.sprinting);
    if (alive && c.allowMove && this.player.pressed.has('boost') && !this.boosting) {
      this.boosting = true;
      this.ctx.events.emit('speedBoost', { id: a.id });
    }
    if (!this.held('forward') || !c.allowMove) this.boosting = false;
    if (this.boosting) this.sprinting = true; // same ninja-run animation and footsteps, just faster

    this.cameraWish(axes, this.wish);
    const speed = !moving ? 0 : downed ? MOVEMENT.crawlSpeed
      : (this.boosting ? MOVEMENT.boostSpeed : this.sprinting ? MOVEMENT.sprintSpeed : MOVEMENT.runSpeed) * c.moveFactor;
    this.wish.multiplyScalar(moving ? speed : 0);

    if (a.grounded) this.airJumpsLeft = MOVEMENT.airJumps;
    if (this.jumpAssist.update(dt, a.grounded, jumpPressed)) {
      a.velocity.y = jumpVelocity(MOVEMENT.jumpHeight, MOVEMENT.gravity);
      a.grounded = false;
      this.ctx.events.emit('jump', { id: a.id });
      if (!c.animLocked) a.setAnim('jump', true);
    } else if (jumpPressed && !a.grounded && this.airTime > MOVEMENT.coyoteTime && this.airJumpsLeft > 0) {
      // Double jump: fresh upward kick, momentum redirected toward the input (Storm-style air control).
      this.airJumpsLeft--;
      this.jumpAssist.reset(); // the press must not also fire a buffered jump on landing
      a.velocity.y = jumpVelocity(MOVEMENT.doubleJumpHeight, MOVEMENT.gravity);
      if (moving && speed > 0) {
        const h = Math.max(Math.hypot(a.velocity.x, a.velocity.z), speed);
        a.velocity.x = this.wish.x / speed * h;
        a.velocity.z = this.wish.z / speed * h;
      }
      this.ctx.events.emit('jump', { id: a.id, air: true });
      if (!c.animLocked) a.setAnim('jump', true);
    }

    const r = stepCharacter(this.ctx.physics, a, this.wish, dt);
    if (r.landed && r.impact >= MOVEMENT.landMinImpact) this.ctx.events.emit('land', { id: a.id, impact: r.impact });
    this.airTime = a.grounded ? 0 : this.airTime + dt;

    this.updateFacing(dt, moving, downed);

    const hSpeed = Math.hypot(a.velocity.x, a.velocity.z);
    if (a.grounded && hSpeed > MOVEMENT.idleSpeed) {
      const stride = this.sprinting ? MOVEMENT.sprintStride : MOVEMENT.runStride;
      if (this.footsteps.update(hSpeed, dt, stride)) this.ctx.events.emit('footstep', { id: a.id, sprint: this.sprinting });
    }

    if (c.animLocked) return;
    if (!a.grounded && this.airTime > MOVEMENT.fallAnimDelay) a.setAnim(a.velocity.y > 0 ? 'jump' : 'fall');
    else if (!a.grounded && a.velocity.y > 0) a.setAnim('jump');
    else if (hSpeed > MOVEMENT.idleSpeed) a.setAnim(this.sprinting ? 'sprint' : 'run');
    else a.setAnim('idle');
  }

  /** Unit camera-relative direction from input axes (zero when no input). D moves screen-right. */
  private cameraWish(axes: { x: number; y: number }, out: THREE.Vector3): THREE.Vector3 {
    const yaw = this.player.input.camYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // forward = (sin, 0, cos); screen-right = forward × up = (-cos, 0, sin)
    return out.set(fx * axes.y - fz * axes.x, 0, fz * axes.y + fx * axes.x);
  }

  private updateFacing(dt: number, moving: boolean, downed: boolean): void {
    const a = this.actor;
    const c = a.control;
    const step = MOVEMENT.turnSpeed * dt;
    const lock = this.player.lockTarget;
    let target: number | null = null;
    // Combat owns yaw during forced moves (lunge/dash face forward already; a back-dodge must not spin).
    if (c.forcedVelocity) return;
    if (lock && lock.alive && !this.sprinting && a.alive) {
      target = Math.atan2(lock.position.x - a.position.x, lock.position.z - a.position.z);
    } else if (moving && (a.alive || downed)) {
      target = Math.atan2(this.wish.x, this.wish.z);
    }
    if (target !== null) a.yaw = turnToward(a.yaw, target, step);
  }

  // ---------------------------------------------------------------- climbing

  /** Probes for a climbable wall in the movement (or facing) direction and attaches to it. */
  private tryStartClimb(axes: { x: number; y: number }, auto = false): boolean {
    const a = this.actor;
    if (axes.x !== 0 || axes.y !== 0) this.cameraWish(axes, this.dir).normalize();
    else a.forward(this.dir);
    const hit = this.probeWall(a.chest(this.origin), this.dir);
    if (!hit) return false;
    // Auto-attach only when really heading into the wall (not when brushing past it).
    if (auto && this.dir.dot(hit) > -MOVEMENT.climbAutoDot) return false;
    if (a.fighter.chakra < MOVEMENT.climbMinChakra) {
      if (auto) return false; // no failure spam while just running along walls
      this.ctx.events.emit('chakraFail', { id: a.id, action: 'climb' });
      return false; // falls through to a normal (buffered) jump
    }
    a.climbing = true;
    a.velocity.set(0, 0, 0);
    this.sprinting = false;
    this.jumpAssist.reset();
    this.airJumpsLeft = MOVEMENT.airJumps;
    this.wallNormal.copy(hit);
    a.wallNormal.copy(hit);
    a.yaw = Math.atan2(-hit.x, -hit.z);
    this.ctx.events.emit('climbStart', { id: a.id });
    return true;
  }

  /** Returns the horizontal wall normal if a climbable near-vertical wall is hit, else null. */
  private probeWall(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null {
    const hit = this.ctx.physics.raycast(origin, dir, MOVEMENT.climbProbeDistance, { worldOnly: true });
    if (!hit || !hit.climbable || Math.abs(hit.normal.y) > MOVEMENT.climbMaxNormalY) return null;
    return hit.normal.setY(0).normalize();
  }

  private updateClimb(dt: number, axes: { x: number; y: number }, jumpPressed: boolean): void {
    const a = this.actor;
    const n = this.wallNormal;
    const ev = this.ctx.events;

    if (jumpPressed) {
      // Kick off the wall.
      a.climbing = false;
      a.velocity.copy(n).multiplyScalar(MOVEMENT.wallKickSpeed);
      a.velocity.y = jumpVelocity(MOVEMENT.jumpHeight, MOVEMENT.gravity) * MOVEMENT.wallKickUp;
      a.yaw = Math.atan2(n.x, n.z);
      ev.emit('jump', { id: a.id });
      if (!a.control.animLocked) a.setAnim('jump', true);
      return;
    }

    if (!drainClimbChakra(a.fighter, MOVEMENT.climbChakraPerSecond, dt)) {
      a.climbing = false;
      ev.emit('chakraFail', { id: a.id, action: 'climb' });
      return;
    }

    // Camera-relative: input into the wall runs up it, along the wall moves sideways, away from it lets go.
    const move = a.control.allowMove ? MOVEMENT.climbSpeed * a.control.moveFactor : 0;
    this.cameraWish(axes, this.wish);
    const into = -this.wish.dot(n);
    if (into < -MOVEMENT.climbAutoDot) {
      a.climbing = false;
      a.velocity.copy(n).multiplyScalar(MOVEMENT.climbLetGoPush);
      return;
    }
    const up = Math.max(0, into) * move;
    const side = (this.wish.x * n.z - this.wish.z * n.x) * move;
    a.velocity.set(n.z * side, up, -n.x * side);
    this.delta.copy(a.velocity).addScaledVector(n, -MOVEMENT.climbStick).multiplyScalar(dt);
    const r = this.ctx.physics.moveCharacter(a.body, this.delta, a.position);
    a.grounded = r.grounded && up <= 0;

    this.dir.copy(n).negate();
    const wall = this.probeWall(a.chest(this.origin), this.dir);
    if (wall) {
      n.copy(wall);
      a.wallNormal.copy(wall);
      a.yaw = Math.atan2(-n.x, -n.z);
      if (a.grounded && axes.y < 0) a.climbing = false; // climbed back down to the floor
    } else {
      a.climbing = false;
      this.origin.copy(a.position).addScaledVector(UP, MOVEMENT.climbLedgeProbeHeight);
      if (this.probeWall(this.origin, this.dir)) {
        // Top exit: hop up and over the edge.
        a.velocity.copy(this.dir).multiplyScalar(MOVEMENT.climbTopForward);
        a.velocity.y = MOVEMENT.climbTopHop;
      } else {
        a.velocity.set(0, 0, 0);
      }
    }
    if (a.climbing && !a.control.animLocked) a.setAnim('climb');
  }

  // ---------------------------------------------------------------- respawn

  private updateRespawn(): void {
    const a = this.actor;
    if (a.grounded && !a.climbing && this.onStableGround()) this.safePos.copy(a.position);
    if (a.position.y >= MOVEMENT.killPlaneY) return;
    this.place(this.safePos);
    if (a.alive) a.fighter.setInvulnerable(COMBAT.respawnInvulnerable);
    this.ctx.events.emit('respawn', { id: a.id });
  }

  private onStableGround(): boolean {
    this.origin.copy(this.actor.position).addScaledVector(UP, MOVEMENT.safeGroundProbeLift);
    this.dir.set(0, -1, 0);
    const hit = this.ctx.physics.raycast(this.origin, this.dir, MOVEMENT.safeGroundProbe, { worldOnly: true });
    return !!hit && hit.normal.y >= MOVEMENT.safeGroundNormalY;
  }

  private place(feet: THREE.Vector3): void {
    const a = this.actor;
    this.ctx.physics.teleport(a.body, feet);
    a.position.copy(feet);
    a.prevPosition.copy(feet);
    a.velocity.set(0, 0, 0);
    a.knockback.set(0, 0, 0);
    a.climbing = false;
    a.grounded = false;
    this.sprinting = this.boosting = false;
    this.airTime = 0;
    this.jumpAssist.reset();
    this.airJumpsLeft = MOVEMENT.airJumps;
    this.footsteps.reset();
  }

  reset(feet: THREE.Vector3): void {
    this.place(feet);
    this.safePos.copy(feet);
  }
}
