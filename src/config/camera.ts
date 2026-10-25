/** Third-person camera tuning. Owner: camera agent. */
export const CAMERA = {
  fov: 60,
  /** Orbit distance from the pivot (m). */
  distance: 6,
  /** Closest the camera may be pulled in by walls (m). */
  minDistance: 1.2,
  /** Pivot height above the player's feet (m). */
  height: 1.6,
  /** Sideways shift to the right of the player (m). */
  shoulderOffset: 0.6,
  minPitch: -0.6,
  maxPitch: 1.1,
  /** Pitch on reset (rad, positive = camera above looking down). */
  defaultPitch: 0.3,
  /** Radians per pixel at sensitivity 1. */
  mouseRadPerPx: 0.0025,
  /** Pivot follow smoothing (1/s). */
  /** High so the camera keeps up with Storm-speed dashes. */
  followSharpness: 22,
  /** Distance kept from walls hit by the collision ray (m). */
  collisionPadding: 0.25,
  /** Zoom-back-out smoothing after a wall stops blocking (1/s). */
  zoomOutSharpness: 4,
  /** Max lock-on acquisition range (m). */
  lockOnRange: 25,
  /** A locked target farther than lockOnRange * this is dropped. */
  lockOnLoseFactor: 1.3,
  /** Yaw/pitch easing toward the lock framing (1/s). */
  lockOnSharpness: 8,
  /** Base pitch while locked (rad). */
  lockOnPitch: 0.25,
  /** Fraction of the target's elevation angle compensated in pitch. */
  lockOnElevationFollow: 0.5,
  /** Fraction of mouse pitch applied as a nudge while locked. */
  lockOnPitchNudge: 0.4,
  /** Max absolute pitch nudge while locked (rad). */
  lockOnMaxNudge: 0.35,
  /** Score cost per radian off the camera forward when picking a target. */
  lockOnAngleWeight: 2,
  /** Score cost added to targets hidden behind world geometry. */
  lockOnHiddenPenalty: 3,
  /** Max shake offset (m). */
  maxShake: 0.4,
  /** Automatic orbit speed in the menu (rad/s). */
  menuOrbitSpeed: 0.15,
} as const;
