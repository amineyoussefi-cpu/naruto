/** Pure locomotion helpers (no Three.js, no physics) so they can be unit-tested. Owner: movement agent. */

/** Launch speed that reaches `height` under constant `gravity`: v = √(2gh). */
export function jumpVelocity(height: number, gravity: number): number {
  return Math.sqrt(2 * gravity * height);
}

/**
 * Moves horizontal velocity `v` toward `target` by at most `maxDelta` (constant acceleration,
 * never overshoots). Mutates and returns `v`.
 */
export function approachXZ<T extends { x: number; z: number }>(v: T, target: { x: number; z: number }, maxDelta: number): T {
  const dx = target.x - v.x, dz = target.z - v.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-9) {
    v.x = target.x;
    v.z = target.z;
  } else {
    v.x += (dx / d) * maxDelta;
    v.z += (dz / d) * maxDelta;
  }
  return v;
}

/** Turns `yaw` toward `target` along the shortest arc, by at most `maxStep` radians. */
export function turnToward(yaw: number, target: number, maxStep: number): number {
  const diff = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
  return Math.abs(diff) <= maxStep ? target : yaw + Math.sign(diff) * maxStep;
}

/** Coyote time (jump shortly after leaving ground) + jump buffer (press shortly before landing). */
export class JumpAssist {
  private coyote = 0;
  private buffer = 0;
  constructor(private readonly coyoteTime: number, private readonly bufferTime: number) {}

  /** Call once per step. Returns true when a jump should fire now (and consumes it). */
  update(dt: number, grounded: boolean, pressed: boolean): boolean {
    this.coyote = grounded ? this.coyoteTime : Math.max(0, this.coyote - dt);
    this.buffer = pressed ? this.bufferTime : Math.max(0, this.buffer - dt);
    if (this.buffer > 0 && this.coyote > 0) {
      this.reset();
      return true;
    }
    return false;
  }

  /** Forget pending presses and ground grace (after jumping, climbing, respawn). */
  reset(): void {
    this.coyote = 0;
    this.buffer = 0;
  }
}

/** Drains climb chakra for one step. Returns false when the fighter cannot pay (must let go). */
export function drainClimbChakra(fighter: { trySpendChakra(amount: number): boolean }, perSecond: number, dt: number): boolean {
  return fighter.trySpendChakra(perSecond * dt);
}

/** Accumulates distance travelled and reports when a footstep should play. */
export class FootstepTimer {
  private dist = 0;
  /** Returns true when `stride` metres have been covered. */
  update(speed: number, dt: number, stride: number): boolean {
    this.dist += speed * dt;
    if (this.dist < stride) return false;
    this.dist %= stride;
    return true;
  }
  reset(): void {
    this.dist = 0;
  }
}
