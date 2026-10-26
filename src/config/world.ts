/**
 * Big seeded world (v5): layout and scatter numbers. Owner: world agent. Units: metres, north = −Z, east = +X.
 * Village-relative positions are offsets from `village.center`. Polylines are [x, z] control points (smoothed).
 */
export const WORLD_CONFIG = {
  /** Seed used when nobody picks one. */
  defaultSeed: 1337,
  /** Free roam spawns ambient enemies (off: enemies only come from missions). */
  ambientEnemies: false,
  /** Playable square side (m), centred on the origin. */
  size: 900,
  /** Heightfield cell (m); the grid covers [-size/2, size/2]². */
  cell: 2,
  /** Minimap raster resolution (m per pixel). */
  zoneRes: 2,
  /** Falling below this kills (ravine floor is far below). */
  killPlaneY: -15,
  /** Lake / sea surface height. */
  waterY: 0,

  /** Forest ground: base height, large / small noise amplitude and wavelength. */
  ground: { base: 10, bigAmp: 4, bigWave: 110, smallAmp: 1.6, smallWave: 28 },
  /** Mountains rising inside the north and west edges (visual backdrop + natural barrier): start / end distance from centre, height. */
  edgeMountains: { from: 385, to: 445, height: 75 },
  /** Northern plateau behind the village cliff: extra height, cliff line z at the village + curvature, cliff half-width, line noise. */
  plateau: { height: 30, curve: 0.0008, halfWidth: 7, noise: 5 },

  village: {
    /** Village centre (world). */
    center: [-80, -60] as [number, number],
    /** Ring wall radius, thickness, height above ground, segment length. */
    wallRadius: 130, wallThickness: 2.6, wallHeight: 9, wallSegment: 10,
    /** Ground: base height, rise toward the cliff (north), noise amplitude. */
    groundY: 12, northRise: 2.5, noise: 0.35,
    /** Cliff line z (relative) at the village x. */
    cliffZ: -100,
    /** Gates: angle (rad, 0 = +Z south, π/2 = +X east) and opening width. */
    gates: [
      { id: 'main', angle: 0, width: 16 },
      { id: 'west', angle: -Math.PI / 2, width: 7 },
      { id: 'east', angle: Math.PI / 2, width: 7 },
    ],
    /** HQ: relative centre, radius, wall height, roof height. */
    hq: { x: 0, z: -40, radius: 14, height: 13, roof: 6 },
    /** Plaza south of the HQ: relative rect [x0, z0, x1, z1]. */
    plaza: [-32, -26, 32, 20] as [number, number, number, number],
    /** Start squares (relative centres), side, board offset beyond the north edge, return point offset south. */
    squares: { coop: [-14, 6] as [number, number], pvpHq: [14, 6] as [number, number], pvpGate: [15, 112] as [number, number], size: 10, boardGap: 1.5, returnGap: 3 },
    /** Player spawns: ring centre (relative), radius, count. */
    spawnRing: { x: 0, z: -16, radius: 4.5, count: 8 },
    /** Streets (relative polylines) with half-widths; index 1 (east street) is the market street. */
    streets: [
      { pts: [[0, 20], [0, 136]], half: 6 },
      { pts: [[32, 0], [136, 0]], half: 5 },
      { pts: [[-32, 0], [-136, 0]], half: 5 },
      { pts: [[-32, -20], [-60, -45], [-70, -80]], half: 3 },
      { pts: [[32, -20], [40, -60]], half: 3 },
      { pts: [[-6, 95], [-80, 95]], half: 3.5 },
      { pts: [[-100, 0], [-105, -50]], half: 3 },
    ] as { pts: [number, number][]; half: number }[],
    /** Training ground: relative centre, half size. */
    field: { x: -70, z: 50, half: 26 },
    /** Training posts: count along the field edge (inset from the border), post radius / height. */
    posts: { inset: 3, step: 8, radius: 0.28, height: 1.7 },
    /** Rooftop district: relative centre, grid count per side, building size, alley gap, roof height range. */
    rooftops: { x: 29, z: 62, n: 4, size: 8, gap: 3, height: [9, 11] as [number, number] },
    /** Market stalls along the market street: x range (relative), step, offset from the street axis. */
    market: { x0: 62, x1: 118, step: 9, offset: 6.6 },
    /** Houses: placement grid step, jitter, footprint range, floor height, max floors, edge inset from the wall, max ground step over a footprint, street clearance, min alley between houses. */
    houses: { step: 10.5, jitter: 1.5, minSize: 6, maxSize: 9.5, floorHeight: 3.3, maxFloors: 3, wallInset: 9, maxSlope: 2.5, clearance: 1, gap: 1.8 },
    /** Chance a flat-roof house gets a water tank. */
    tankChance: 0.55,
  },

  /** River from the village cliff to the waterfall on the east shore (world polyline), half-width, bank blend, depth below banks. */
  river: { pts: [[-25, -150], [-20, -110], [-35, -60], [-20, -10], [5, 40], [60, 110], [150, 150], [235, 168]] as [number, number][], half: 6, bank: 5, drop: 1.6, depth: 1.3 },
  /** Forest stream to the south beach. */
  stream: { pts: [[-260, 60], [-215, 130], [-235, 200], [-245, 290]] as [number, number][], half: 2.6, bank: 3, drop: 0.7, depth: 0.7 },
  /** River bridges: parameters along the smoothed river (0..1) and deck widths. */
  riverBridges: [{ t: 0.14, width: 4 }, { t: 0.3, width: 9 }, { t: 0.42, width: 4 }],

  /** Dirt paths from the gates (world polylines) and half-width. */
  paths: {
    half: 3,
    lines: [
      [[-80, 72], [-92, 140], [-70, 200], [-80, 262]],
      [[-212, -60], [-258, -52], [-300, -66], [-360, -40], [-405, -90]],
      [[52, -60], [110, -40], [170, -62], [238, -50]],
      [[-92, 140], [-130, 160], [-170, 170]],
    ] as [number, number][][],
  },
  /** Ravine (world polyline), half-width at the rim, floor height, wall steepness (inner fraction of half-width at floor). */
  ravine: { pts: [[-290, -330], [-310, -190], [-298, -66], [-322, 60], [-300, 200]] as [number, number][], half: 15, floor: -40, inner: 0.5 },

  /** Coast: east shore x and south shore z (+ noise), rocky (east) vs beach (south) blend ranges. */
  coast: { eastX: 255, southZ: 262, noise: 14, noiseWave: 70, beachTop: 2.2, beachWidth: 22, landBlend: 45, rockyDrop: 9, floor: -8, slope: 0.13 },
  /** Islands: world centre, radius, top height. */
  islands: [
    { x: 360, z: -120, r: 24, top: 3.5 },
    { x: 372, z: 120, r: 18, top: 3 },
    { x: 60, z: 372, r: 16, top: 2.5 },
    { x: 300, z: 230, r: 7, top: 1.5 },
  ],
  /** Docks on the south beach: world x, length, width, deck height. */
  docks: { xs: [-80, -44], length: 34, width: 4, deckY: 1.1 },
  /** Lake surface collider tile (m) and the coast distance from which water tiles are allowed. */
  waterTile: 32, waterFrom: -40,

  /** Forest clearings (world centre, radius); the first is the PvP "Clairière". */
  clearings: [[-170, 170, 32], [-380, 80, 22], [120, -200, 20], [-200, -300, 24], [100, 190, 18]] as [number, number, number][],
  /** Normal trees: jittered grid step, keep chance, density noise wavelength / threshold, scale range. */
  trees: { step: 8, chance: 0.72, densityWave: 60, gapBelow: -0.35, scale: [0.85, 1.35] as [number, number] },
  /** Giant trees: grid step, chance, height range, trunk radius range, branch platforms count range and height range (fraction of tree height). */
  giants: { step: 42, chance: 0.6, height: [30, 40] as [number, number], radius: [1.8, 2.6] as [number, number], branches: [3, 4] as [number, number], branchAt: [0.32, 0.72] as [number, number], branchLen: [6, 9] as [number, number], clear: 7 },
  /** Bushes (visual only): grid step, chance. */
  bushes: { step: 6, chance: 0.45 },
  /** Rocks: forest grid step + chance, shore cluster step + chance, size range, climbable from this size. */
  rocks: { step: 30, chance: 0.35, shoreStep: 14, shoreChance: 0.5, size: [1, 3.6] as [number, number], climbMin: 2, variants: 5 },
  /** Light shafts in the forest: count (visual). */
  lightShafts: 140,

  /** PvP arenas: radius and spawn distance (fraction of radius). The lake arena centre is world-space. */
  arenas: { radius: 26, spawnFrac: 0.65, lake: [330, 330] as [number, number], lakeRadius: 30 },
  /** Points: offset of the outside-gate point, mission spawn offsets. */
  gateOutside: 14,
} as const;
