/** Player locomotion tuning. Units: metres, seconds, radians. Owner: movement agent. */
export const MOVEMENT = {
  walkSpeed: 4.5,
  runSpeed: 7.5,
  sprintSpeed: 12,
  /** Ground acceleration / braking (m/s²). */
  acceleration: 45,
  deceleration: 55,
  /** Fraction of ground acceleration available while airborne. */
  airControl: 0.35,
  gravity: 28,
  jumpHeight: 2.4,
  maxFallSpeed: 40,
  /** Grace periods that make jumping feel reliable. */
  coyoteTime: 0.12,
  jumpBuffer: 0.12,
  turnSpeed: 14,
  /** Wall climbing. */
  climbSpeed: 4,
  climbChakraPerSecond: 12,
  climbMinChakra: 5,
  climbProbeDistance: 0.8,
  climbTopHop: 6,
  /** Below this Y the player is respawned at the last safe position. */
  killPlaneY: -20,
  capsuleRadius: 0.4,
  capsuleHalfHeight: 0.5,
} as const;
