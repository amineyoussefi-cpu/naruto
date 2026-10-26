/** Co-op missions: start square rules, down & revive, and the mission list. Owner: missions agent. Units: s, m. */

export type MissionEnemyKind = 'melee' | 'ranged';

export interface MissionGroupDef {
  /** Named world point (WorldData.points). */
  point: string;
  /** Enemies of one wave. */
  enemies: { kind: MissionEnemyKind; count: number }[];
  /** Waves in total (default 1): the next wave spawns, awake, when the previous one is wiped. */
  waves?: number;
}

export interface MissionDef {
  id: string;
  /** French title shown on the board and the HUD. */
  title: string;
  groups: MissionGroupDef[];
  /** Seconds before failure, null = no limit. */
  timeLimit: number | null;
  /** Per extra player: +count × base enemies per group, +hp × enemy HP. */
  scalePerPlayer: { count: number; hp: number };
  /** A dormant group wakes when a participant comes this close to its centre (m). */
  aggroRadius: number;
}

export const MISSION_RULES = {
  /** Start countdown once every connected player is inside the square. */
  countdown: 5,
  /** Results screen duration before everyone returns to free roam. */
  resultsTime: 10,
  /** Seconds a downed player can wait for a revive before bleeding out. */
  bleedTime: 30,
  /** Seconds a teammate must hold interact to revive. */
  reviveTime: 3,
  /** Reviver must stay within this distance of the downed player (m). */
  reviveRadius: 2.5,
  /** Fraction of max HP restored by a revive. */
  reviveHp: 0.4,
  /** Enemies of a group spawn on a ring of this radius around the group point (m). */
  spawnSpread: 2.5,
  /** Players returning to the square's returnPoint are spread on a ring of this radius (m). */
  returnSpacing: 2,
  /** Enemy damage multiplier (missions scale HP and count, not damage). */
  dmgMul: 1,
  /** Label of the objective marker (French). */
  objectiveLabel: 'Vaincre les ennemis',
} as const;

const SCALE = { count: 0.5, hp: 0.2 };

export const MISSIONS: MissionDef[] = [
  {
    id: 'village-intruders',
    title: 'Intrus dans le village',
    timeLimit: null,
    scalePerPlayer: SCALE,
    aggroRadius: 16,
    groups: [
      { point: 'village.market', enemies: [{ kind: 'melee', count: 2 }] },
      { point: 'village.training', enemies: [{ kind: 'melee', count: 2 }, { kind: 'ranged', count: 1 }] },
      { point: 'village.rooftops', enemies: [{ kind: 'ranged', count: 2 }] },
    ],
  },
  {
    id: 'forest-ambush',
    title: 'Embuscade en forêt',
    timeLimit: 420,
    scalePerPlayer: SCALE,
    aggroRadius: 20,
    groups: [
      { point: 'forest.path', enemies: [{ kind: 'melee', count: 2 }, { kind: 'ranged', count: 1 }] },
      { point: 'forest.clearing', enemies: [{ kind: 'melee', count: 3 }], waves: 2 },
      { point: 'forest.ravine', enemies: [{ kind: 'ranged', count: 2 }] },
      { point: 'forest.deep', enemies: [{ kind: 'melee', count: 2 }, { kind: 'ranged', count: 2 }] },
    ],
  },
  {
    id: 'dock-bandits',
    title: 'Bandits sur les quais',
    timeLimit: 360,
    scalePerPlayer: SCALE,
    aggroRadius: 18,
    groups: [
      { point: 'shore.docks', enemies: [{ kind: 'melee', count: 3 }, { kind: 'ranged', count: 1 }] },
      { point: 'shore.beach', enemies: [{ kind: 'melee', count: 2 }, { kind: 'ranged', count: 2 }] },
    ],
  },
  {
    id: 'deserter-island',
    title: 'Île des déserteurs',
    timeLimit: 480,
    scalePerPlayer: SCALE,
    aggroRadius: 22,
    groups: [
      { point: 'shore.beach', enemies: [{ kind: 'ranged', count: 2 }] },
      { point: 'island.north', enemies: [{ kind: 'melee', count: 3 }, { kind: 'ranged', count: 1 }] },
      { point: 'island.east', enemies: [{ kind: 'melee', count: 2 }, { kind: 'ranged', count: 2 }], waves: 2 },
    ],
  },
  {
    id: 'gate-defense',
    title: 'Défense de la porte',
    timeLimit: 300,
    scalePerPlayer: SCALE,
    aggroRadius: 25,
    groups: [
      { point: 'gate.main', enemies: [{ kind: 'melee', count: 3 }], waves: 3 },
      { point: 'village.gate', enemies: [{ kind: 'ranged', count: 2 }] },
      { point: 'forest.path', enemies: [{ kind: 'melee', count: 2 }, { kind: 'ranged', count: 1 }], waves: 2 },
      { point: 'village.river', enemies: [{ kind: 'melee', count: 2 }] },
    ],
  },
];
