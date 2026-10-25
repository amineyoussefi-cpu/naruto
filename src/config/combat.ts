/**
 * Combat tuning: damage, timings and chakra costs. Owner: combat agent.
 * Attack timings are in seconds from the start of the move:
 *  windup -> active (hitbox live) -> recovery. `cooldown` starts when the move starts.
 */
export const COMBAT = {
  player: {
    maxHp: 200,
    maxChakra: 100,
  },
  /** Fraction of damage that still goes through when guarding. */
  guardDamageFactor: 0.25,
  guardMoveFactor: 0.35,
  comboResetTime: 0.5,
  /** Seconds an attack press stays buffered while another move is playing (generous so mashing chains). */
  inputBuffer: 0.4,
  /** Combat auto-faces the nearest enemy within this distance (m) when not locked on. */
  autoFaceRange: 3,
  /** Height (m) of melee hitbox centres above the feet. */
  hitboxHeight: 1,
  /** Combo homing: target search range (m), cone around camera/player forward (deg), pull speed (m/s), stop distance (m). */
  homing: { range: 7, coneDeg: 110, speed: 20, stopDistance: 1.2, maxApproach: 0.3 },
  /**
   * 5-hit mash combo; `range` = hitbox centre distance in front (m), `lunge` = forward speed (m/s) without a homing target,
   * `stun` = hit stun on the target (must exceed the gap to the next hit), `launch` = upward velocity (m/s).
   */
  combo: [
    { damage: 8, windup: 0.06, active: 0.08, recovery: 0.1, range: 1.5, radius: 0.9, knockback: 1, lunge: 4, stun: 0.45, launch: 0 },
    { damage: 8, windup: 0.05, active: 0.08, recovery: 0.1, range: 1.5, radius: 0.9, knockback: 1, lunge: 4, stun: 0.45, launch: 0 },
    { damage: 10, windup: 0.06, active: 0.08, recovery: 0.12, range: 1.6, radius: 0.95, knockback: 1.5, lunge: 4, stun: 0.45, launch: 0 },
    { damage: 10, windup: 0.07, active: 0.09, recovery: 0.12, range: 1.6, radius: 1, knockback: 1.5, lunge: 4, stun: 0.5, launch: 0 },
    { damage: 22, windup: 0.09, active: 0.1, recovery: 0.3, range: 1.8, radius: 1.1, knockback: 14, lunge: 5, stun: 0.4, launch: 13 },
  ],
  /** Stun kept on a launched target while airborne and left after it lands (s). */
  launchLandStun: 0.4,
  /** `windup`: release delay, `recovery`: lock after release, `spawnForward`: spawn distance in front of the chest (m). */
  kunai: { damage: 8, speed: 34, cooldown: 0.4, maxRange: 40, radius: 0.25, knockback: 1, windup: 0.05, recovery: 0.15, spawnForward: 0.5 },
  /** Storm chakra dash (Shift tap): homing rush at a target within `range`, else a forward `burstTime` burst. */
  chakraDash: { cost: 8, range: 25, speed: 26, stopDistance: 1.6, maxDuration: 1.2, burstTime: 0.3, cooldown: 0.35 },
  /** Rasengan-like special: dash forward with a chakra sphere, AoE on contact. */
  special: { damage: 45, chakraCost: 35, cooldown: 6, windup: 0.35, dashSpeed: 24, dashTime: 0.35, radius: 2.2, knockback: 12, forwardOffset: 0.8 },
  dodge: { speed: 20, duration: 0.3, invulnerable: 0.25, cooldown: 0.7 },
  hitStun: 0.35,
  /** Knockback multiplier on a guarded hit. */
  guardKnockbackFactor: 0.3,
  /** Seconds the model flashes white when hit. */
  hitFlash: 0.12,
  hitStop: 0.06,
  /** Hit-stop for combo finisher / special (s). */
  hitStopHeavy: 0.12,
  /** Camera shake per hit category involving the player. */
  shake: {
    light: { intensity: 0.08, duration: 0.12 },
    heavy: { intensity: 0.25, duration: 0.25 },
    /** Combo finisher (launcher). */
    launcher: { intensity: 0.4, duration: 0.3 },
    playerHit: { intensity: 0.18, duration: 0.2 },
    blocked: { intensity: 0.06, duration: 0.1 },
  },
  /** Seconds of invulnerability after respawn. */
  respawnInvulnerable: 1.5,
  /** Storm-style substitution jutsu: gauge (4 uses when full), spent by pressing dodge while stunned. `animTime`: reappear lock (s). */
  substitution: { max: 100, cost: 25, regenPerSecond: 4, invulnerable: 0.6, distanceBehind: 2.2, animTime: 0.2 },
} as const;
