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
  comboResetTime: 0.6,
  combo: [
    { damage: 10, windup: 0.08, active: 0.12, recovery: 0.16, range: 1.6, radius: 0.9, knockback: 2, lunge: 3 },
    { damage: 12, windup: 0.08, active: 0.12, recovery: 0.18, range: 1.6, radius: 0.9, knockback: 2.5, lunge: 3 },
    { damage: 20, windup: 0.14, active: 0.14, recovery: 0.35, range: 1.9, radius: 1.1, knockback: 7, lunge: 5 },
  ],
  kunai: { damage: 8, speed: 30, cooldown: 0.45, maxRange: 40, radius: 0.25, knockback: 1 },
  /** Rasengan-like special: dash forward with a chakra sphere, AoE on contact. */
  special: { damage: 45, chakraCost: 35, cooldown: 6, windup: 0.35, dashSpeed: 18, dashTime: 0.35, radius: 2.2, knockback: 12 },
  dodge: { speed: 16, duration: 0.3, invulnerable: 0.25, cooldown: 0.7 },
  hitStun: 0.35,
  hitStop: 0.06,
  /** Seconds of invulnerability after respawn. */
  respawnInvulnerable: 1.5,
} as const;
