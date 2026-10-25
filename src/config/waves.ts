/** Wave progression. Owner: AI agent. Stat multipliers scale enemy HP and damage. */
export const WAVES = [
  { melee: 2, ranged: 0, hpMul: 1.0, dmgMul: 1.0 },
  { melee: 2, ranged: 1, hpMul: 1.0, dmgMul: 1.0 },
  { melee: 3, ranged: 2, hpMul: 1.15, dmgMul: 1.1 },
  { melee: 4, ranged: 2, hpMul: 1.3, dmgMul: 1.2 },
  { melee: 4, ranged: 3, hpMul: 1.5, dmgMul: 1.3 },
] as const;
export const WAVE_INTERMISSION = 3;
