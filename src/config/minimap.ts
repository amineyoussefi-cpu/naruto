/** Minimap and full map. Owner: ui agent (missions reads `pvpRevealRadius`). Units: metres, pixels. */
export const MINIMAP = {
  /** PvP opponents appear on the minimap only within this distance (or in line of sight). */
  pvpRevealRadius: 35,
} as const;
