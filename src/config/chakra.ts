/** Chakra economy. Owner: combat agent. */
export const CHAKRA = {
  /** Passive regen per second, after `regenDelay` seconds without spending. */
  regenPerSecond: 12, // ×3 with the ×3 pool (v4)
  regenDelay: 2.5,
  /** Regen per second while holding the concentrate key (player cannot move). */
  concentrateRegenPerSecond: 90, // ×3 with the ×3 pool (v4)
  /** Delay before concentration starts recharging (charge-up). */
  concentrateStartup: 0.25,
} as const;
