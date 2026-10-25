/** Player locomotion tuning. Units: metres, seconds, radians. Owner: movement agent. */
export const MOVEMENT = {
  walkSpeed: 4.5,
  /** Storm-style pace: brisk run, very fast ninja sprint (Shift held). */
  runSpeed: 10,
  sprintSpeed: 17,
  /** Double-tap forward (W/Z) and hold: fastest travel speed (m/s), free of chakra. */
  boostSpeed: 26,
  /** Ground acceleration / braking (m/s²): near-instant starts and stops. */
  acceleration: 90,
  deceleration: 100,
  /** Fraction of ground acceleration available while airborne. */
  airControl: 0.6,
  gravity: 34,
  jumpHeight: 3.2,
  /** Second jump in the air (height in m); it also redirects horizontal momentum toward the input. */
  doubleJumpHeight: 2.6,
  airJumps: 1,
  maxFallSpeed: 40,
  /** Grace periods that make jumping feel reliable. */
  coyoteTime: 0.12,
  jumpBuffer: 0.12,
  /** Max turn rate toward the facing target (rad/s). */
  turnSpeed: 22,
  /** Knockback decay rate (1/s, exponential-ish). */
  knockbackDecay: 8,
  /** Horizontal speed below which the player counts as standing still (m/s). */
  idleSpeed: 0.5,
  /** Airborne time before the fall animation replaces run (avoids flicker on steps). */
  fallAnimDelay: 0.1,
  /** Minimum downward speed at touchdown that emits a `land` event (m/s). */
  landMinImpact: 2,
  /** Distance between footsteps when running / sprinting (m). */
  runStride: 1.6,
  sprintStride: 2.2,
  /** Wall climbing. */
  climbSpeed: 4,
  /** Wall-walking is cheap for a ninja: a light, steady drain. */
  climbChakraPerSecond: 2.5,
  climbMinChakra: 5,
  climbProbeDistance: 0.8,
  /** Upward speed of the hop onto the top of a wall (m/s). */
  climbTopHop: 9,
  /** Forward speed of the hop onto the top of a wall (m/s). */
  climbTopForward: 4,
  /** Height above feet of the lower ledge probe ray (m). */
  climbLedgeProbeHeight: 0.25,
  /** Distance per second the climber is pushed into the wall to stay attached (m/s). */
  climbStick: 1,
  /** Walls steeper than this |normal.y| are not climbable (0 = vertical). */
  climbMaxNormalY: 0.5,
  /** Kick off the wall: horizontal speed away from it (m/s) and fraction of jump velocity upward. */
  wallKickSpeed: 7,
  wallKickUp: 0.8,
  /** Ground normal.y needed to remember a position as a safe respawn point. */
  safeGroundNormalY: 0.8,
  /** Downward probe length to check stable ground for respawn points (m). */
  safeGroundProbe: 0.3,
  /** Height above feet the safe-ground probe starts from (m). */
  safeGroundProbeLift: 0.1,
  /** Below this Y the player is respawned at the last safe position. */
  killPlaneY: -20,
  capsuleRadius: 0.4,
  capsuleHalfHeight: 0.5,
} as const;
