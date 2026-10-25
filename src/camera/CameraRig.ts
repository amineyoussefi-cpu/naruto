import type { AnimState } from '../core/types';
import * as THREE from 'three';
import { CAMERA } from '../config/camera';
import type { Actor } from '../game/Actor';
import type { GameContext } from '../game/context';
import { bestTarget, cycleTarget, distanceTo, type LockCandidate, type LockView } from './targeting';

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Frame-rate independent smoothing factor. */
const ease = (sharpness: number, dt: number): number => 1 - Math.exp(-sharpness * dt);

/**
 * Third-person orbit camera with wall avoidance and lock-on. Owner: camera agent.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 500);
  /** Horizontal look angle; yaw 0 looks toward +Z. Movement is relative to this. */
  yaw = 0;
  pitch: number = CAMERA.defaultPitch;
  lockTarget: Actor | null = null;
  private ctx!: GameContext;
  /** Id last announced through `lockOn`; detects targets cleared externally (Game.removeActor). */
  private lockedId: number | null = null;
  private lockNudge = 0;
  private readonly pivot = new THREE.Vector3();
  private snap = true;
  /** Current orbit length as a fraction of the desired one (wall pull-in). */
  private zoom = 1;
  private shakeIntensity = 0;
  private shakeTime = 0;
  private shakeDuration = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  /** Called once the context exists. */
  attach(ctx: GameContext): void {
    this.ctx = ctx;
    // Storm-style hard cut: substitution and respawn teleport the player, so the camera jumps with it.
    ctx.events.on('substitution', (e) => { if (e.id === ctx.player.id) this.snap = true; });
    ctx.events.on('respawn', (e) => { if (e.id === ctx.player.id) this.snap = true; });
  }

  /** Simulation step: lock-on toggle/switch, lost target handling. */
  updateSim(_dt: number): void {
    const ctx = this.ctx;
    let next: Actor | null = this.lockTarget;
    if (ctx.pressed.has('lockOn')) {
      next = next ? null : this.pick(null);
    } else if (next && ctx.pressed.has('switchTarget')) {
      next = this.byId(cycleTarget(this.view(), this.candidates(false), next.id));
    } else if (next && (!next.alive || next.removed || this.distance(next) > CAMERA.lockOnRange * CAMERA.lockOnLoseFactor)) {
      next = this.pick(next.id);
    } else if (!next && this.lockedId !== null) {
      next = this.pick(this.lockedId); // target was removed by the Game
    }
    this.setLock(next);
  }

  /** Render frame: mouse look, follow, collision, shake. `alpha` = interpolation factor. */
  update(frameDt: number, _alpha: number): void {
    if (frameDt === 0) return; // paused: keep the frozen frame
    const ctx = this.ctx;
    const k = CAMERA.mouseRadPerPx * ctx.settings.sensitivity;
    const { dx, dy } = ctx.input.consumeMouse();
    const dPitch = dy * k * (ctx.settings.invertY ? -1 : 1);
    const target = this.lockTarget;
    const p = ctx.player.model.root.position;

    if (target) {
      const t = target.model.root.position;
      const h = Math.hypot(t.x - p.x, t.z - p.z);
      this.lockNudge = clamp(this.lockNudge + dPitch * CAMERA.lockOnPitchNudge, -CAMERA.lockOnMaxNudge, CAMERA.lockOnMaxNudge);
      const wantYaw = h > 1e-3 ? Math.atan2(t.x - p.x, t.z - p.z) : this.yaw;
      const wantPitch = CAMERA.lockOnPitch - Math.atan2(t.y - p.y, Math.max(h, 1e-3)) * CAMERA.lockOnElevationFollow + this.lockNudge;
      const f = ease(CAMERA.lockOnSharpness, frameDt);
      this.yaw = wrap(this.yaw + wrap(wantYaw - this.yaw) * f);
      this.pitch += (clamp(wantPitch, CAMERA.minPitch, CAMERA.maxPitch) - this.pitch) * f;
    } else {
      this.yaw = wrap(this.yaw - dx * k);
      this.pitch = clamp(this.pitch + dPitch, CAMERA.minPitch, CAMERA.maxPitch);
      if (!ctx.input.enabled && dx === 0 && dy === 0) this.yaw = wrap(this.yaw + CAMERA.menuOrbitSpeed * frameDt);
    }

    this.updateFraming(frameDt);

    // Follow the interpolated model.
    this.tmp.set(p.x, p.y + CAMERA.height, p.z);
    if (this.snap) { this.pivot.copy(this.tmp); this.snap = false; }
    else this.pivot.lerp(this.tmp, ease(CAMERA.followSharpness, frameDt));

    // Orbit offset: behind + above, shifted toward screen-right (yaw 0 looks +Z, right is -X).
    const cp = Math.cos(this.pitch);
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.dir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)
      .multiplyScalar(this.orbitDistance)
      .addScaledVector(this.right, CAMERA.shoulderOffset);
    const len = this.dir.length();
    this.dir.divideScalar(len);

    // Wall avoidance: snap in instantly, ease back out.
    const hit = ctx.physics.raycast(this.pivot, this.dir, len + CAMERA.collisionPadding, { worldOnly: true });
    const allowed = hit ? clamp((hit.distance - CAMERA.collisionPadding) / len, Math.min(1, CAMERA.minDistance / len), 1) : 1;
    this.zoom = allowed < this.zoom ? allowed : this.zoom + (allowed - this.zoom) * ease(CAMERA.zoomOutSharpness, frameDt);

    this.camera.position.copy(this.pivot).addScaledVector(this.dir, len * this.zoom);
    this.look.copy(this.pivot).addScaledVector(this.right, CAMERA.shoulderOffset);
    this.camera.lookAt(this.look);

    // Shake: decaying random offset, render only.
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - frameDt);
      const r = this.shakeTime / this.shakeDuration;
      const m = this.shakeIntensity * r * r;
      this.camera.position.x += (Math.random() * 2 - 1) * m;
      this.camera.position.y += (Math.random() * 2 - 1) * m;
      this.camera.position.z += (Math.random() * 2 - 1) * m;
    }
  }

  /** Current blended orbit distance (m) and its combat timer; see `cameraFraming`. */
  private orbitDistance: number = CAMERA.distance;
  private combatTimer = 0;

  private updateFraming(frameDt: number): void {
    const p = this.ctx.player;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    const r2 = CAMERA.combatRange ** 2;
    const cue = this.lockTarget !== null || COMBAT_ANIMS.has(p.anim) || this.ctx.actors.some((e) => e.team === 'enemy' && e.alive && !e.removed && e.position.distanceToSquared(p.position) < r2);
    this.combatTimer = cue ? CAMERA.combatHold : Math.max(0, this.combatTimer - frameDt);
    const f = cameraFraming(speed, this.combatTimer > 0);
    this.orbitDistance += (f.distance - this.orbitDistance) * ease(CAMERA.distanceSharpness, frameDt);
    const fov = this.camera.fov + (f.fov - this.camera.fov) * ease(CAMERA.fovSharpness, frameDt);
    if (Math.abs(fov - this.camera.fov) > 1e-3) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  shake(intensity: number, duration: number): void {
    if (duration <= 0) return;
    const current = this.shakeTime > 0 ? this.shakeIntensity * (this.shakeTime / this.shakeDuration) ** 2 : 0;
    const i = Math.min(Math.max(0, intensity), CAMERA.maxShake);
    if (i < current) return; // keep the stronger ongoing shake
    this.shakeIntensity = i;
    this.shakeTime = this.shakeDuration = duration;
  }

  resize(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  reset(): void {
    this.setLock(null);
    this.lockTarget = null;
    this.yaw = 0;
    this.pitch = CAMERA.defaultPitch;
    this.snap = true;
    this.zoom = 1;
    this.orbitDistance = CAMERA.distance;
    this.combatTimer = 0;
    this.shakeTime = 0;
  }

  /** Applies a lock change and emits `lockOn` when the announced target differs. */
  private setLock(a: Actor | null): void {
    this.lockTarget = a;
    const id = a ? a.id : null;
    if (id === this.lockedId) return;
    this.lockedId = id;
    this.lockNudge = 0;
    this.ctx?.events.emit('lockOn', { targetId: id });
  }

  private pick(excludeId: number | null): Actor | null {
    return this.byId(bestTarget(this.view(), this.candidates(true), CAMERA.lockOnRange, excludeId));
  }

  private byId(id: number | null): Actor | null {
    return id === null ? null : this.ctx.actors.find((a) => a.id === id) ?? null;
  }

  private view(): LockView {
    const p = this.ctx.player.position;
    return { x: p.x, y: p.y, z: p.z, yaw: this.yaw };
  }

  private distance(a: Actor): number {
    const p = a.position;
    return distanceTo(this.view(), { id: a.id, x: p.x, y: p.y, z: p.z, alive: true, visible: true });
  }

  /** Living enemies; visibility raycasts only when `checkVisibility` (acquisition). */
  private candidates(checkVisibility: boolean): LockCandidate[] {
    const from = this.ctx.player.chest();
    return this.ctx.enemies().filter((a) => !a.removed).map((a) => {
      let visible = true;
      if (checkVisibility) {
        const to = a.chest().sub(from);
        const d = to.length();
        if (d > 1e-3) visible = !this.ctx.physics.raycast(from, to.divideScalar(d), d, { worldOnly: true });
      }
      return { id: a.id, x: a.position.x, y: a.position.y, z: a.position.z, alive: a.alive, visible };
    });
  }
}

/** Player states that count as fighting for the camera. */
const COMBAT_ANIMS = new Set<AnimState>(['attack1', 'attack2', 'attack3', 'attack4', 'attack5', 'special', 'throw', 'charge', 'chidori', 'sharingan',
  'grabHold', 'strikeUp', 'strikeDown', 'strikeLeft', 'strikeRight', 'grabFinisher', 'hit', 'guard']);

/** Target camera distance / FOV: combat framing has priority over sprint framing. */
export function cameraFraming(speed: number, inCombat: boolean): { distance: number; fov: number } {
  if (inCombat) return { distance: CAMERA.distanceCombat, fov: CAMERA.fovCombat };
  if (speed > CAMERA.sprintFramingSpeed) return { distance: CAMERA.distanceSprint, fov: CAMERA.fovSprint };
  return { distance: CAMERA.distance, fov: CAMERA.fov };
}
