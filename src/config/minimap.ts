/** Minimap and full map. Owner: ui agent (missions reads `pvpRevealRadius`). Units: metres, pixels. */
export const MINIMAP = {
  /** PvP opponents appear on the minimap only within this distance (or in line of sight). */
  pvpRevealRadius: 35,
  /** Minimap diameter on screen (CSS px). */
  sizePx: 200,
  /** World metres shown across the minimap diameter. */
  metresAcross: 140,
  /** Markers outside the disc are pinned this many px inside the rim. */
  rimInset: 9,
  /** Pulse period of a fighting enemy group (s, render-only). */
  pulsePeriod: 0.8,
  /** Full map: wheel zoom factor per notch, and zoom range relative to "whole world fits". */
  zoomStep: 1.2,
  zoomMin: 1,
  zoomMax: 8,
  /** localStorage key of the "Minimap orientée nord" setting (kept outside `Settings`, see ui agent report). */
  northUpStorageKey: 'shinobi-arena.minimapNorthUp',
  /** localStorage key of the online player name. */
  nameStorageKey: 'shinobi-arena.playerName',
  /** Online player name length limit (characters). */
  nameMaxLength: 16,
  /** Background colour per world ZONE code (index = code), CSS hex. */
  zoneColors: [
    '#0b1a2e', // void (sea beyond)
    '#6f9a4a', // grass
    '#2f5a2c', // forest
    '#2d6fa8', // water
    '#d9c48a', // beach
    '#7a6a5a', // cliff
    '#b9a27a', // street
    '#8a4b3a', // building
    '#e0cfa0', // plaza
    '#4a3b30', // wall
    '#a07a4a', // bridge
    '#8a6a40', // dock
    '#9ab55a', // field
  ],
  /** Arrow colours of teammates (by player order); the local player is always `selfColor`. */
  teamColors: ['#4fd1ff', '#7be36b', '#ffd34f', '#c58cff', '#ff9ad5', '#ffffff'],
  selfColor: '#ffb347',
  enemyColor: '#ff3b3b',
  objectiveColor: '#ffe34f',
  coopSquareColor: '#3fa7ff',
  pvpRedColor: '#e83b3b',
  pvpBlueColor: '#3f7bff',
} as const;
