/** Third-person camera tuning. Owner: camera agent. */
export const CAMERA = {
  fov: 60,
  distance: 6,
  minDistance: 1.2,
  height: 1.6,
  shoulderOffset: 0.6,
  minPitch: -0.6,
  maxPitch: 1.1,
  /** Radians per pixel at sensitivity 1. */
  mouseRadPerPx: 0.0025,
  followSharpness: 14,
  collisionPadding: 0.25,
  lockOnRange: 25,
  lockOnSharpness: 8,
  maxShake: 0.4,
} as const;
