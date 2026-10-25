/** Enemy archetypes and AI tuning. Owner: AI agent. Units: metres, seconds, radians. */
export const ENEMIES = {
  melee: {
    maxHp: 60, speed: 9.5, detectRange: 60, attackRange: 1.8, damage: 12,
    // Storm pace: quick but still readable wind-up.
    telegraph: 0.32, active: 0.12, recovery: 0.4, cooldown: 0.95,
    retreatChance: 0.25, dodgeChance: 0.2, knockback: 4,
    /** Hitbox sphere: radius, distance ahead of the feet, height above the feet. */
    hitboxRadius: 0.9, hitboxForward: 1.0, hitboxHeight: 1.0,
    /** Speed fraction while circling without an attack token. */
    orbitSpeedFactor: 0.6,
  },
  ranged: {
    maxHp: 40, speed: 7.5, detectRange: 60, preferredRange: 11, minRange: 6, damage: 9,
    telegraph: 0.45, cooldown: 1.5, projectileSpeed: 26, knockback: 1.5,
    /** Throw animation hold after release, then recovery before moving again. */
    active: 0.2, recovery: 0.4,
    /** Distance band around preferredRange where the ninja just strafes. */
    rangeBand: 2,
    /** Strafing speed fraction and seconds between strafe direction rolls. */
    strafeSpeedFactor: 0.55, strafeSwitch: 1.6,
    projectileRadius: 0.3, projectileMaxRange: 45,
    /** Fraction of the player's velocity * travel time added to the aim point. */
    leadFactor: 0.5,
    /** Spawn offset of the projectile ahead of the chest. */
    muzzleForward: 0.6,
  },
  /** At most this many enemies may be in an attack (telegraph/active) at once. */
  maxSimultaneousAttackers: 2,
  /** Minimum seconds between two attack starts across all enemies. */
  attackStagger: 0.25,
  hitStun: 0.4,
  corpseTime: 2.5,
  /** Seconds spent in `detect` (noticing the player) before chasing. */
  detectTime: 0.2,
  /** Max facing turn rate (rad/s). */
  turnRate: 16,
  /** Distance token-less enemies circle the player at. */
  orbitRange: 4.5,
  /** Radial correction strength while orbiting (0..1 of the move direction). */
  orbitRadialGain: 0.6,
  /** Obstacle probe length for steering, and probe height above the feet. */
  steerProbe: 1.5, steerProbeHeight: 0.9,
  /** Enemies closer than this push each other apart, with this weight. */
  separationRadius: 1.6, separationWeight: 1.2,
  /** Evasive move (back-off / side-step): duration and speed multiplier. */
  evadeTime: 0.4, evadeSpeedFactor: 1.6,
  /** Melee enemies within this distance may react to a player attack start. */
  dodgeReactRange: 4,
  /** Max time spent retreating in `reposition` before re-evaluating. */
  repositionMaxTime: 1.5,
} as const;
