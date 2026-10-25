/** Enemy archetypes and AI tuning. Owner: AI agent. */
export const ENEMIES = {
  melee: {
    maxHp: 60, speed: 6, detectRange: 30, attackRange: 1.8, damage: 12,
    telegraph: 0.45, active: 0.15, recovery: 0.6, cooldown: 1.4,
    retreatChance: 0.25, dodgeChance: 0.2, knockback: 4,
  },
  ranged: {
    maxHp: 40, speed: 5, detectRange: 35, preferredRange: 11, minRange: 6, damage: 9,
    telegraph: 0.6, cooldown: 2.2, projectileSpeed: 18, knockback: 1.5,
  },
  /** At most this many enemies may be in an attack (telegraph/active) at once. */
  maxSimultaneousAttackers: 2,
  hitStun: 0.4,
  corpseTime: 2.5,
} as const;
