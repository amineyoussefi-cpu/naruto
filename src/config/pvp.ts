/** PvP matches: lobby, rounds and combat scaling against players. Owner: missions agent (combat reads the scales). Units: s. */
export const PVP = {
  /** Start countdown once every connected player stands in the same PvP square with valid teams. */
  countdown: 5,
  /** Most players per team. */
  maxTeam: 3,
  /** Round wins needed to win the match (best of 3). */
  roundsToWin: 2,
  /** Round duration before the HP % decides. */
  roundTime: 120,
  /** Frozen countdown before each round. */
  roundCountdown: 3,
  /** Pause after a round ends, before the next round's countdown. */
  roundEndPause: 2,
  /** Results screen before everyone returns to free roam. */
  resultsTime: 10,
  /** Damage multiplier of every hit/technique on a player. */
  damageScale: 0.7,
  /** Grabs (QTE) work on players. */
  allowGrab: true,
  /** Grab sequence time limit on a player (shorter than co-op). */
  grabTime: 2.5,
  /** Sharingan disorientation duration multiplier on players. */
  genjutsuScale: 0.5,
  /** Smaller team: +25 % max HP per missing player, each. */
  handicapPerMissingPlayer: 0.25,
  /** Players are kept this far inside the dome edge (m). */
  domeMargin: 0.5,
  /** Spawn points are spread this far apart when a team has more players than spawns (m). */
  spawnSpacing: 1.5,
  /** Kill feed entries kept. */
  killFeedSize: 5,
} as const;
