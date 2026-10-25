/** Wave progression. Owner: AI agent. Stat multipliers scale enemy HP and damage. */
export const WAVES = [
  { melee: 2, ranged: 0, hpMul: 1.0, dmgMul: 1.0 },
  { melee: 2, ranged: 1, hpMul: 1.0, dmgMul: 1.0 },
  { melee: 3, ranged: 2, hpMul: 1.15, dmgMul: 1.1 },
  { melee: 4, ranged: 2, hpMul: 1.3, dmgMul: 1.2 },
  { melee: 4, ranged: 3, hpMul: 1.5, dmgMul: 1.3 },
] as const;
/** Seconds between a cleared wave and the next one. */
export const WAVE_INTERMISSION = 3;
/** Seconds after start() before wave 1. */
export const WAVE_START_DELAY = 1.5;
/** Seconds between successive enemy spawns inside a wave. */
export const WAVE_SPAWN_STAGGER = 0.4;
/** Waves spawn at points in this distance ring around the player (m), so fights stay close on the big map. */
export const WAVE_SPAWN_MIN_DIST = 18;
export const WAVE_SPAWN_MAX_DIST = 45;
/** Random horizontal jitter radius around a spawn point. */
export const WAVE_SPAWN_JITTER = 1.2;
