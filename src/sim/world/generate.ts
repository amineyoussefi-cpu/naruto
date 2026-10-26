/**
 * Seeded world generator (v5): Konoha-like village against a northern cliff, a big forest with giant trees, a ravine,
 * and a lake/sea on the south and east with beach, rocky shore, docks, islands and a waterfall.
 * Pure and deterministic: same seed → identical data. Node-safe (no DOM / WebGL). Owner: world agent.
 */
import { WORLD_CONFIG as C } from '../../config/world';
import type { Vec3Like } from '../../core/types';
import { clamp01, lerp, Noise, Polyline, rng, smoothLine, smoothstep, type P2 } from './noise';
import { rockShape } from './shapes';
import { ZONE, type ColliderDef, type Heightfield, type PvpArenaDef, type SquareDef, type WorldData } from './types';

// ---------------------------------------------------------------- layout (render data the client rebuilds from the seed)
export type HouseKit = 'flat' | 'gable' | 'hip' | 'round';
/** A house: footprint centre, ground (lowest corner) y, size, eave/flat-top height above `y`, roof height. */
export interface Building { x: number; y: number; z: number; w: number; d: number; h: number; roofH: number; yaw: number; kit: HouseKit; floors: number; roof: number; wall: number; tank: boolean; awning: boolean }
export interface Tree { x: number; y: number; z: number; species: 0 | 1 | 2; s: number; yaw: number; tint: number }
export interface Giant { x: number; y: number; z: number; h: number; r: number; yaw: number; tint: number; branches: { x: number; y: number; z: number; len: number; yaw: number }[] }
export interface Rock { x: number; y: number; z: number; s: number; sy: number; yaw: number; variant: number }
/** Flat wooden deck (bridge, dock, rope bridge): centre, top y, length along local X, width, yaw. */
export interface Deck { x: number; y: number; z: number; len: number; width: number; yaw: number; kind: 'bridge' | 'dock' | 'rope' }
/** River / stream ribbon: smoothed centre points with surface height, half-width of the water surface. */
export interface WaterLine { pts: [number, number, number][]; half: number }
export interface Waterfall { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; width: number }
export interface WallSeg { x: number; y: number; z: number; len: number; h: number; yaw: number }
export interface Gate { x: number; y: number; z: number; yaw: number; width: number; main: boolean }
export interface Stall { x: number; y: number; z: number; yaw: number; color: number }

export interface WorldLayout {
  village: { x: number; z: number; r: number };
  hq: { x: number; y: number; z: number; r: number; h: number; roof: number };
  buildings: Building[];
  walls: WallSeg[];
  gates: Gate[];
  stalls: Stall[];
  posts: Vec3Like[];
  lanterns: [number, number, number][];
  decks: Deck[];
  waterLines: WaterLine[];
  waterfalls: Waterfall[];
  /** Lake surface rectangles [x0, z0, x1, z1] at `waterY`. */
  lakeRects: [number, number, number, number][];
  waterY: number;
  trees: Tree[];
  giants: Giant[];
  /** Bushes: x, y, z, scale, tint per bush. */
  bushes: Float32Array;
  rocks: Rock[];
  /** Seed of the rock shapes: variant v uses `rockShape(rockSeed * 7 + v)`. */
  rockSeed: number;
  /** Light shaft spots in the forest [x, y, z]. */
  shafts: [number, number, number][];
  paths: P2[][];
  streets: { pts: P2[]; half: number }[];
}

export interface WorldBuild { data: WorldData; layout: WorldLayout }

const cache = new WeakMap<WorldData, WorldLayout>();

/** World data for a seed (the contract). The render layout is cached alongside, see `worldLayout`. */
export function generateWorld(seed: number): WorldData {
  const b = generateWorldDetailed(seed);
  return b.data;
}

/** Render layout of a generated world (regenerated from `data.seed` when it was not built in this process). */
export function worldLayout(data: WorldData): WorldLayout {
  return cache.get(data) ?? generateWorldDetailed(data.seed).layout;
}

/** Bilinear ground height of the heightfield (clamped to the grid). */
export function groundHeight(w: Pick<WorldData, 'heightfield'>, x: number, z: number): number {
  const H = w.heightfield;
  const fx = Math.min(H.nx - 1.001, Math.max(0, (x - H.originX) / H.cell)), fz = Math.min(H.nz - 1.001, Math.max(0, (z - H.originZ) / H.cell));
  const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, i = iz * H.nx + ix, h = H.heights;
  return lerp(lerp(h[i], h[i + 1], u), lerp(h[i + H.nx], h[i + H.nx + 1], u), v);
}

/** Zone code at a world position (raster row = z, column = x; row 0 = most negative z = north). */
export function zoneAt(w: Pick<WorldData, 'zones'>, x: number, z: number): number {
  const Z = w.zones, c = Math.floor((x - Z.originX) / Z.res), r = Math.floor((z - Z.originZ) / Z.res);
  return c < 0 || r < 0 || c >= Z.w || r >= Z.h ? ZONE.void : Z.data[r * Z.w + c];
}

/** Spatial hash of circles to keep scatter apart. */
class Blockers {
  private readonly cells = new Map<number, [number, number, number][]>();
  private readonly cs = 16;
  add(x: number, z: number, r: number): void {
    const cs = this.cs;
    for (let i = Math.floor((x - r) / cs); i <= Math.floor((x + r) / cs); i++) for (let j = Math.floor((z - r) / cs); j <= Math.floor((z + r) / cs); j++) {
      const k = i * 4096 + j, l = this.cells.get(k);
      if (l) l.push([x, z, r]); else this.cells.set(k, [[x, z, r]]);
    }
  }
  hit(x: number, z: number, r: number): boolean {
    const l = this.cells.get(Math.floor(x / this.cs) * 4096 + Math.floor(z / this.cs));
    if (!l) return false;
    for (const [bx, bz, br] of l) if ((x - bx) ** 2 + (z - bz) ** 2 < (r + br) ** 2) return true;
    return false;
  }
}

const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx); // yaw that maps local +X onto (dx, dz)
const v3 = (x: number, y: number, z: number): Vec3Like => ({ x, y, z });

/** Full build: contract data + render layout. Same seed → identical output. */
export function generateWorldDetailed(seed: number): WorldBuild {
  const N = new Noise(seed), R = rng(seed ^ 0x9e3779b9), V = C.village, [vcx, vcz] = V.center;
  const half = C.size / 2, wy = C.waterY;

  // ---------------------------------------------------------------- lines
  const river = new Polyline(smoothLine(C.river.pts, 4, 4, N, 50));
  const stream = new Polyline(smoothLine(C.stream.pts, 4, 3, N, 60));
  const ravine = new Polyline(smoothLine(C.ravine.pts, 5, 6, N, 70));
  const paths = C.paths.lines.map((l, i) => new Polyline(smoothLine(l, 4, 3, N, 80 + i * 3)));
  const streets = V.streets.map((s) => ({ line: new Polyline(s.pts.map(([x, z]) => [x + vcx, z + vcz] as P2)), half: s.half }));

  // ---------------------------------------------------------------- height functions
  const smax = (a: number, b: number, k: number) => { const h = clamp01(0.5 + (0.5 * (b - a)) / k); return lerp(a, b, h) + k * h * (1 - h); };
  const CO = C.coast;
  /** Signed distance past the shoreline (> 0 = water side). */
  const shore = (x: number, z: number) => smax(
    x - (CO.eastX + N.n2(z / CO.noiseWave, 3.1, 20) * CO.noise),
    z - (CO.southZ + N.n2(x / CO.noiseWave, 7.7, 21) * CO.noise), 18);
  const rocky = (x: number, z: number) => smoothstep(-25, 25, (x - CO.eastX) - (z - CO.southZ));
  const cliffLine = (x: number) => vcz + V.cliffZ + C.plateau.curve * (x - vcx) ** 2 + N.n2(x / 40, 0.5, 9) * C.plateau.noise;
  const villageGround = (z: number) => V.groundY + V.northRise * smoothstep(vcz + 60, vcz - 90, z);

  const raw = (x: number, z: number): number => {
    const G = C.ground;
    let g = G.base + G.bigAmp * N.fbm(x / G.bigWave, z / G.bigWave, 3, 1) + G.smallAmp * N.n2(x / G.smallWave, z / G.smallWave, 5);
    const dv = Math.hypot(x - vcx, z - vcz);
    const vm = 1 - smoothstep(V.wallRadius + 4, V.wallRadius + 34, dv);
    if (vm > 0) g = lerp(g, villageGround(z) + V.noise * N.n2(x / 15, z / 15, 13), vm);
    const p = smoothstep(cliffLine(x) + C.plateau.halfWidth, cliffLine(x) - C.plateau.halfWidth, z);
    g += p * (C.plateau.height + 3 * N.fbm(x / 50, z / 50, 2, 11));
    const E = C.edgeMountains, e = Math.max(-x, -z);
    if (e > E.from) g += smoothstep(E.from, E.to, e) * E.height * (0.7 + 0.3 * N.fbm(x / 60, z / 60, 3, 15));
    const s = shore(x, z);
    if (s > -(CO.beachWidth + CO.landBlend)) {
      const beach = s < -CO.beachWidth ? lerp(g, CO.beachTop, smoothstep(-(CO.beachWidth + CO.landBlend), -CO.beachWidth, s))
        : s < 0 ? lerp(CO.beachTop, 0.25, (s + CO.beachWidth) / CO.beachWidth) : Math.max(CO.floor, 0.25 - s * CO.slope);
      const rock = s < -CO.rockyDrop ? g : s < 1 ? lerp(g, -1.5, smoothstep(-CO.rockyDrop, 1, s)) : Math.max(CO.floor, -1.5 - s * CO.slope);
      g = lerp(beach, rock, rocky(x, z));
    }
    for (const I of C.islands) {
      const d = Math.hypot(x - I.x, z - I.z);
      if (d < I.r * 1.4) g = Math.max(g, I.top * smoothstep(I.r * 1.3, I.r * 0.45, d) + 0.6 * N.n2(x / 6, z / 6, 25) - 0.7);
    }
    return g;
  };

  // Flattened pads (rects / circles) for the plaza, squares, training ground, rooftops and clearings.
  type Pad = { x: number; z: number; hw: number; hd: number; round: boolean; y: number; blend: number };
  const pads: Pad[] = [];
  const rect = (x0: number, z0: number, x1: number, z1: number, blend: number, y?: number) =>
    pads.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, round: false, y: y ?? villageGround((z0 + z1) / 2), blend });
  const [px0, pz0, px1, pz1] = V.plaza;
  rect(vcx + px0, vcz + pz0, vcx + px1, vcz + pz1, 8);
  const plazaY = pads[0].y;
  pads.push({ x: vcx + V.hq.x, z: vcz + V.hq.z, hw: V.hq.radius + 3, hd: 0, round: true, y: plazaY, blend: 6 });
  const F = V.field;
  rect(vcx + F.x - F.half, vcz + F.z - F.half, vcx + F.x + F.half, vcz + F.z + F.half, 8);
  const RT = V.rooftops, rtHalf = (RT.n * RT.size + (RT.n - 1) * RT.gap) / 2;
  rect(vcx + RT.x - rtHalf, vcz + RT.z - rtHalf, vcx + RT.x + rtHalf, vcz + RT.z + rtHalf, 6);
  const SQ = V.squares, sqh = SQ.size / 2 + 2;
  rect(vcx + SQ.pvpGate[0] - sqh, vcz + SQ.pvpGate[1] - sqh, vcx + SQ.pvpGate[0] + sqh, vcz + SQ.pvpGate[1] + sqh, 6);
  for (const [x, z, r] of C.clearings) pads.push({ x, z, hw: r * 0.8, hd: 0, round: true, y: raw(x, z), blend: r * 0.5 });

  const base = (x: number, z: number): number => {
    let g = raw(x, z);
    for (const P of pads) {
      const e = P.round ? Math.max(0, Math.hypot(x - P.x, z - P.z) - P.hw) : Math.hypot(Math.max(0, Math.abs(x - P.x) - P.hw), Math.max(0, Math.abs(z - P.z) - P.hd));
      if (e < P.blend) g = lerp(g, P.y, 1 - smoothstep(0, P.blend, e));
    }
    const RV = C.ravine, rd = ravine.dist(x, z, RV.half + 2);
    if (rd.d < RV.half) g = lerp(g, RV.floor, smoothstep(RV.half, RV.half * RV.inner, rd.d) * smoothstep(0, 0.07, rd.t) * smoothstep(1, 0.93, rd.t));
    return g;
  };

  // River / stream surfaces: base height minus drop, monotonic downstream, smoothed.
  const waterSurface = (line: Polyline, drop: number) => {
    let s = line.pts.map(([x, z]) => Math.max(wy, base(x, z) - drop));
    for (let k = 0; k < 4; k++) {
      for (let i = 1; i < s.length; i++) s[i] = Math.min(s[i], s[i - 1]);
      s = s.map((v, i) => (v + s[Math.max(0, i - 1)] + s[Math.min(s.length - 1, i + 1)]) / 3);
    }
    for (let i = 1; i < s.length; i++) s[i] = Math.min(s[i], s[i - 1]);
    return s;
  };
  // Extend the river to the cliff edge of the coast (waterfall there).
  {
    const p = river.pts, a = p[p.length - 2], b = p[p.length - 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]), tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
    let x = b[0], z = b[1];
    for (let k = 0; k < 80 && shore(x, z) < -CO.rockyDrop + 1; k++) { x += tx * 2; z += tz * 2; if (k % 2 === 1) p.push([x, z]); }
  }
  const riverL = new Polyline(river.pts);
  const lines = [
    { line: riverL, surf: waterSurface(riverL, C.river.drop), ...C.river },
    { line: stream, surf: waterSurface(stream, C.stream.drop), ...C.stream },
  ];
  const full = (x: number, z: number): number => {
    let g = base(x, z);
    for (const L of lines) {
      const r = L.line.dist(x, z, L.half + L.bank);
      if (r.d >= L.half + L.bank) continue;
      const sy = lerp(L.surf[r.i], L.surf[r.i + 1] ?? L.surf[r.i], clamp01(r.t * (L.line.pts.length - 1) - r.i));
      const k = 1 - smoothstep(L.half * 0.55, L.half + L.bank, r.d);
      g = Math.min(g, lerp(g, sy - L.depth, k));
    }
    return g;
  };

  // ---------------------------------------------------------------- heightfield
  const cell = C.cell, nx = Math.round(C.size / cell) + 1, nz = nx;
  const heights = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) heights[iz * nx + ix] = full(-half + ix * cell, -half + iz * cell);
  const heightfield: Heightfield = { nx, nz, cell, originX: -half, originZ: -half, heights };
  const ground = (x: number, z: number) => groundHeight({ heightfield }, x, z);
  const slope = (x: number, z: number) => Math.hypot(ground(x + 1.5, z) - ground(x - 1.5, z), ground(x, z + 1.5) - ground(x, z - 1.5)) / 3;

  const colliders: ColliderDef[] = [];
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw: number, climbable = true, water = false) =>
    colliders.push({ type: 'box', center: v3(x, y, z), half: v3(hx, hy, hz), yaw, ...(climbable ? { climbable } : {}), ...(water ? { water } : {}) });
  const block = new Blockers();

  // ---------------------------------------------------------------- village: HQ, squares, spawns
  const hq = { x: vcx + V.hq.x, y: plazaY, z: vcz + V.hq.z, r: V.hq.radius, h: V.hq.height, roof: V.hq.roof };
  colliders.push({ type: 'cylinder', center: v3(hq.x, hq.y + hq.h / 2 - 0.5, hq.z), halfHeight: hq.h / 2 + 0.5, radius: hq.r, climbable: true });
  colliders.push({ type: 'cylinder', center: v3(hq.x, hq.y + hq.h + hq.roof * 0.3, hq.z), halfHeight: hq.roof * 0.3, radius: hq.r * 0.82, climbable: true });

  const squares: SquareDef[] = [];
  const square = (id: string, kind: 'coop' | 'pvp', rel: readonly [number, number]) => {
    const x = vcx + rel[0], z = vcz + rel[1], y = ground(x, z), e = SQ.size / 2;
    const board = v3(x, ground(x, z - e - SQ.boardGap), z - e - SQ.boardGap);
    squares.push({ id, kind, center: v3(x, y, z), size: SQ.size, yaw: 0, board, returnPoint: v3(x, ground(x, z + e + SQ.returnGap), z + e + SQ.returnGap) });
    box(board.x, board.y + 1.2, board.z, 1.6, 1.2, 0.2, 0, false);
  };
  square('coop-hq', 'coop', SQ.coop);
  square('pvp-hq', 'pvp', SQ.pvpHq);
  square('pvp-gate', 'pvp', SQ.pvpGate);
  const SR = V.spawnRing;
  const spawns = Array.from({ length: SR.count }, (_, i) => {
    const a = (i / SR.count) * Math.PI * 2, x = vcx + SR.x + Math.sin(a) * SR.radius, z = vcz + SR.z + Math.cos(a) * SR.radius;
    return v3(x, ground(x, z), z);
  });

  // ---------------------------------------------------------------- walls and gates
  const walls: WallSeg[] = [], gates: Gate[] = [];
  const W = V.wallRadius, segN = Math.round((2 * Math.PI * W) / V.wallSegment), segA = (2 * Math.PI) / segN;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const at = (a: number, r = W) => [vcx + Math.sin(a) * r, vcz + Math.cos(a) * r] as const;
  for (let i = 0; i < segN; i++) {
    const a = i * segA, [x, z] = at(a), len = W * segA + 0.4;
    if (V.gates.some((g) => Math.abs(wrap(a - g.angle)) * W < g.width / 2 + len / 2)) continue;
    if (riverL.dist(x, z, 20).d < C.river.half + 2) continue;
    const [ax, az] = at(a - segA / 2), [bx, bz] = at(a + segA / 2);
    const lo = Math.min(ground(ax, az), ground(bx, bz), ground(x, z)), hi = Math.max(ground(ax, az), ground(bx, bz), ground(x, z));
    if (hi > villageGround(z) + V.wallHeight - 1) continue; // buried in the cliff
    const h = V.wallHeight + (hi - lo) + 1;
    walls.push({ x, y: lo - 1, z, len, h, yaw: a });
    box(x, lo - 1 + h / 2, z, len / 2, h / 2, V.wallThickness / 2, a);
  }
  for (const g of V.gates) {
    const [x, z] = at(g.angle), y = ground(x, z), main = g.id === 'main', tw = main ? 3 : 1.5, th = V.wallHeight + (main ? 4 : 1);
    gates.push({ x, y, z, yaw: g.angle, width: g.width, main });
    for (const sgn of [-1, 1]) {
      const o = g.width / 2 + tw;
      box(x + Math.cos(g.angle) * o * sgn, y - 1 + th / 2, z - Math.sin(g.angle) * o * sgn, tw, th / 2 + 0.5, main ? 3.5 : 2, g.angle);
    }
    box(x, y + th - 1.5, z, g.width / 2 + tw * 2, 1.2, main ? 2.5 : 1.6, g.angle);
  }

  // ---------------------------------------------------------------- rooftops district, market, houses
  const buildings: Building[] = [];
  const tankPos = (b: Building): [number, number] => {
    const ox = b.w / 2 - 1.6, oz = b.d / 2 - 1.6, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    return [b.x + ox * c + oz * s, b.z - ox * s + oz * c];
  };
  const addTank = (b: Building) => {
    const [tx, tz] = tankPos(b);
    colliders.push({ type: 'cylinder', center: v3(tx, b.y + b.h + 1.3, tz), halfHeight: 1.3, radius: 1.15, climbable: true });
  };
  const place = (b: Building) => {
    buildings.push(b);
    const extra = b.kit === 'gable' || b.kit === 'hip' ? b.roofH * 0.45 : 0, top = b.h + extra;
    if (b.kit === 'round') colliders.push({ type: 'cylinder', center: v3(b.x, b.y - 0.6 + (top + 0.6) / 2, b.z), halfHeight: (top + 0.6) / 2, radius: b.w / 2, climbable: true });
    else box(b.x, b.y - 0.6 + (top + 0.6) / 2, b.z, b.w / 2, (top + 0.6) / 2, b.d / 2, b.yaw);
    if (b.tank) addTank(b);
  };

  const roofCount = 3, wallCount = 3;
  const rtRoofs: Vec3Like[][] = [];
  for (let i = 0; i < RT.n; i++) {
    rtRoofs.push([]);
    for (let j = 0; j < RT.n; j++) {
      const x = vcx + RT.x - rtHalf + RT.size / 2 + i * (RT.size + RT.gap), z = vcz + RT.z - rtHalf + RT.size / 2 + j * (RT.size + RT.gap);
      const h = RT.height[0] + Math.floor(R() * ((RT.height[1] - RT.height[0]) * 2 + 1)) / 2, y = ground(x, z);
      place({ x, y, z, w: RT.size, d: RT.size, h, roofH: 0, yaw: 0, kit: 'flat', floors: 3, roof: Math.floor(R() * roofCount), wall: Math.floor(R() * wallCount), tank: R() < 0.35, awning: false });
      rtRoofs[i].push(v3(x, y + h, z));
    }
  }

  const stalls: Stall[] = [], lanterns: [number, number, number][] = [];
  const M = V.market;
  for (let x = vcx + M.x0; x <= vcx + M.x1; x += M.step) for (const sgn of [-1, 1]) {
    const z = vcz + sgn * M.offset;
    if (riverL.dist(x, z, 20).d < C.river.half + C.river.bank + 3) continue;
    stalls.push({ x, y: ground(x, z), z, yaw: sgn > 0 ? Math.PI : 0, color: Math.floor(R() * 4) });
    box(x, ground(x, z) + 0.55, z, 1.6, 0.55, 0.9, 0, false);
    block.add(x, z, 2.5);
    if (sgn > 0) for (let k = 0; k <= 4; k++) lanterns.push([x, ground(x, vcz) + 4.6 - Math.sin((k / 4) * Math.PI) * 0.7, vcz - M.offset + (k / 4) * 2 * M.offset]);
  }

  // Reserved areas for houses.
  const H = V.houses;
  const inRect = (x: number, z: number, x0: number, z0: number, x1: number, z1: number, m: number) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;
  const reserved = (x: number, z: number, rad: number) => {
    if (inRect(x, z, vcx + px0, vcz + pz0, vcx + px1, vcz + pz1, rad + 2)) return true;
    if (Math.hypot(x - hq.x, z - hq.z) < hq.r + rad + 4) return true;
    if (inRect(x, z, vcx + F.x - F.half, vcz + F.z - F.half, vcx + F.x + F.half, vcz + F.z + F.half, rad + 2)) return true;
    if (inRect(x, z, vcx + RT.x - rtHalf, vcz + RT.z - rtHalf, vcx + RT.x + rtHalf, vcz + RT.z + rtHalf, rad + 3)) return true;
    if (inRect(x, z, vcx + SQ.pvpGate[0] - sqh, vcz + SQ.pvpGate[1] - sqh, vcx + SQ.pvpGate[0] + sqh, vcz + SQ.pvpGate[1] + sqh, rad + 2)) return true;
    for (const s of streets) if (s.line.dist(x, z, s.half + rad + H.clearance).d < s.half + rad + H.clearance) return true;
    if (riverL.dist(x, z, 40).d < C.river.half + C.river.bank + rad + 1) return true;
    for (const g of gates) if (Math.hypot(x - g.x, z - g.z) < 16 + rad) return true;
    return block.hit(x, z, rad);
  };
  const houseRects: [number, number, number, number][] = []; // AABB (houses are rotated 0 / 90° only)
  for (let gz = vcz - W; gz <= vcz + W; gz += H.step) for (let gx = vcx - W; gx <= vcx + W; gx += H.step) {
    const x = gx + (R() - 0.5) * 2 * H.jitter, z = gz + (R() - 0.5) * 2 * H.jitter;
    const w = lerp(H.minSize, H.maxSize, R()), d = lerp(H.minSize, H.maxSize, R()), rot = R() < 0.5, rad = Math.hypot(w, d) / 2;
    const kr = R(), fr = R(), roof = Math.floor(R() * roofCount), wall = Math.floor(R() * wallCount), tank = R() < V.tankChance, awn = R() < 0.3;
    const hx = (rot ? d : w) / 2 + H.gap / 2, hz = (rot ? w : d) / 2 + H.gap / 2;
    if (Math.hypot(x - vcx, z - vcz) > W - H.wallInset - rad * 0.5 || reserved(x, z, rad)) continue;
    if (houseRects.some(([ax, az, ahx, ahz]) => Math.abs(x - ax) < hx + ahx && Math.abs(z - az) < hz + ahz)) continue;
    let lo = Infinity, hi = -Infinity;
    for (const [dx, dz] of [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) { const g = ground(x + dx, z + dz); lo = Math.min(lo, g); hi = Math.max(hi, g); }
    if (hi - lo > H.maxSlope || lo > villageGround(z) + 4) continue;
    const kit: HouseKit = kr < 0.42 ? 'flat' : kr < 0.72 ? 'gable' : kr < 0.94 ? 'hip' : 'round';
    const near = 1 - smoothstep(30, W, Math.hypot(x - vcx, z - vcz));
    const floors = Math.min(H.maxFloors, 1 + Math.floor(fr * (1.6 + near * 1.6)));
    const ww = kit === 'round' ? Math.min(w, d) : w;
    houseRects.push([x, z, hx, hz]);
    place({ x, y: lo, z, w: ww, d: kit === 'round' ? ww : d, h: floors * H.floorHeight + 0.4, roofH: kit === 'flat' ? 0 : 2.2 + Math.min(w, d) * 0.18, yaw: rot ? Math.PI / 2 : 0, kit, floors, roof, wall, tank: kit === 'flat' && tank, awning: awn });
  }
  // HQ plaza lanterns (glow posts) and gate lanterns.
  for (const [dx, dz] of [[px0 + 2, pz1 - 2], [px1 - 2, pz1 - 2], [px0 + 2, pz0 + 4], [px1 - 2, pz0 + 4]]) lanterns.push([vcx + dx, plazaY + 2.6, vcz + dz]);

  // ---------------------------------------------------------------- training ground posts
  const posts: Vec3Like[] = [];
  {
    const P = V.posts, fx = vcx + F.x, fz = vcz + F.z, e = F.half - P.inset;
    for (let t = -e; t <= e + 0.01; t += P.step) for (const [x, z] of [[fx + t, fz - e], [fx + t, fz + e]]) {
      posts.push(v3(x, ground(x, z), z));
      colliders.push({ type: 'cylinder', center: v3(x, ground(x, z) + P.height / 2 - 0.2, z), halfHeight: P.height / 2 + 0.2, radius: P.radius });
    }
    // Three-post target trio at the north edge centre.
    for (const dx of [-3, 0, 3]) { const x = fx + dx, z = fz - e + 4; posts.push(v3(x, ground(x, z), z)); colliders.push({ type: 'cylinder', center: v3(x, ground(x, z) + 0.8, z), halfHeight: 1, radius: 0.35 }); }
  }

  // ---------------------------------------------------------------- bridges, docks
  const decks: Deck[] = [];
  const deck = (x: number, y: number, z: number, len: number, width: number, yaw: number, kind: Deck['kind']) => {
    decks.push({ x, y, z, len, width, yaw, kind });
    box(x, y - 0.25, z, len / 2, 0.25, width / 2, yaw, false);
  };
  const riverBridge = (t: number, width: number) => {
    const p = riverL.at(t), dx = -p.tz, dz = p.tx, len = 2 * (C.river.half + C.river.bank) + 3;
    const y = Math.max(ground(p.x - dx * len / 2, p.z - dz * len / 2), ground(p.x + dx * len / 2, p.z + dz * len / 2)) + 0.12;
    deck(p.x, y, p.z, len, width, yawOf(dx, dz), 'bridge');
    block.add(p.x, p.z, len / 2 + 1);
  };
  const crossT: number[] = [];
  for (const s of streets) {
    let best = { d: Infinity, t: 0 };
    for (let k = 0; k <= 200; k++) { const p = s.line.at(k / 200), r = riverL.dist(p.x, p.z); if (r.d < best.d) best = { d: r.d, t: r.t }; }
    if (best.d < C.river.half) { riverBridge(best.t, s.half * 2); crossT.push(best.t); }
  }
  for (const b of C.riverBridges) if (crossT.every((t) => Math.abs(t - b.t) * riverL.total > 25)) riverBridge(b.t, b.width);
  // Rope bridge over the ravine where the west path crosses it.
  let ravinePoint = v3(0, 0, 0);
  for (const p of paths) {
    let best = { d: Infinity, t: 0 };
    for (let k = 0; k <= 300; k++) { const q = p.at(k / 300), r = ravine.dist(q.x, q.z); if (r.d < best.d) best = { d: r.d, t: k / 300 }; }
    if (best.d > C.ravine.half) continue;
    const q = p.at(best.t), len = C.ravine.half * 2 + 8;
    const y = Math.max(ground(q.x - q.tx * len / 2, q.z - q.tz * len / 2), ground(q.x + q.tx * len / 2, q.z + q.tz * len / 2)) + 0.1;
    deck(q.x, y, q.z, len, 3, yawOf(q.tx, q.tz), 'rope');
    const ex = q.x + q.tx * (len / 2 + 6), ez = q.z + q.tz * (len / 2 + 6);
    ravinePoint = v3(ex, ground(ex, ez), ez);
  }
  const D = C.docks;
  let docksPoint = v3(0, 0, 0);
  D.xs.forEach((x, i) => {
    let z = 150;
    while (z < half && ground(x, z) > D.deckY - 0.4) z += 1;
    const z0 = z - 5, zc = z0 + D.length / 2;
    deck(x, D.deckY, zc, D.length, D.width, Math.PI / 2, 'dock');
    if (i === 0) { deck(x, D.deckY, z0 + D.length - 2, 12, 3.5, 0, 'dock'); docksPoint = v3(x, D.deckY, z0 + D.length * 0.7); }
  });

  // ---------------------------------------------------------------- water: lake tiles, ribbons, waterfalls
  const lakeRects: [number, number, number, number][] = [];
  {
    const T = C.waterTile, n = Math.ceil(C.size / T);
    for (let j = 0; j < n; j++) {
      let run = -1;
      for (let i = 0; i <= n; i++) {
        let wet = false;
        if (i < n) {
          const x0 = -half + i * T, z0 = -half + j * T;
          if (shore(x0 + T / 2, z0 + T / 2) > C.waterFrom) for (let a = 0; a <= T && !wet; a += 4) for (let b = 0; b <= T && !wet; b += 4) wet = ground(x0 + a, z0 + b) < wy;
        }
        if (wet && run < 0) run = i;
        if (!wet && run >= 0) {
          const x0 = -half + run * T, x1 = -half + i * T, z0 = -half + j * T;
          lakeRects.push([x0, z0, x1, z0 + T]);
          box((x0 + x1) / 2, wy - 0.5, z0 + T / 2, (x1 - x0) / 2, 0.5, T / 2, 0, false, true);
          run = -1;
        }
      }
    }
  }
  const waterLines: WaterLine[] = lines.map((L) => ({ pts: L.line.pts.map(([x, z], i) => [x, L.surf[i], z] as [number, number, number]), half: L.half + L.bank * 0.45 }));
  for (const wl of waterLines) {
    const p = wl.pts, vtx = new Float32Array(p.length * 6), idx: number[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, nx2 = -(b[2] - a[2]) / l, nz2 = (b[0] - a[0]) / l;
      vtx.set([p[i][0] + nx2 * wl.half, p[i][1], p[i][2] + nz2 * wl.half, p[i][0] - nx2 * wl.half, p[i][1], p[i][2] - nz2 * wl.half], i * 6);
      if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    colliders.push({ type: 'trimesh', vertices: vtx, indices: Uint32Array.from(idx), water: true });
  }
  const waterfalls: Waterfall[] = [];
  {
    const p = waterLines[0].pts, e = p[p.length - 1], q = p[p.length - 2], l = Math.hypot(e[0] - q[0], e[2] - q[2]), tx = (e[0] - q[0]) / l, tz = (e[2] - q[2]) / l;
    waterfalls.push({ x0: e[0], y0: e[1], z0: e[2], x1: e[0] + tx * 9, y1: wy - 0.2, z1: e[2] + tz * 9, width: C.river.half * 2 });
    const s = p[0], s1 = p[1], l2 = Math.hypot(s1[0] - s[0], s1[2] - s[2]), ux = (s1[0] - s[0]) / l2, uz = (s1[2] - s[2]) / l2;
    const tx2 = s[0] - ux * 16, tz2 = s[2] - uz * 16;
    waterfalls.push({ x0: tx2, y0: ground(tx2, tz2) + 0.3, z0: tz2, x1: s[0] - ux * 2, y1: s[1] - 0.1, z1: s[2] - uz * 2, width: C.river.half * 1.4 });
  }

  // ---------------------------------------------------------------- arenas and named points (reserved before scatter)
  const ar = C.arenas, sf = ar.spawnFrac;
  const sideSpawns = (cx: number, cz: number, r: number, y: (x: number, z: number) => number) => {
    const mk = (sgn: number) => [-6, 0, 6].map((dz) => { const x = cx + sgn * r * sf, z = cz + dz; return v3(x, y(x, z), z); });
    return { red: mk(-1), blue: mk(1) };
  };
  const fcx = vcx + F.x, fcz = vcz + F.z, [ccx, ccz] = C.clearings[0], [lx, lz] = ar.lake;
  const rtc = v3(vcx + RT.x, rtRoofs.flat().reduce((a, p) => a + p.y, 0) / (RT.n * RT.n), vcz + RT.z);
  const arenas: PvpArenaDef[] = [
    { id: 'training', name: "Terrain d'entraînement", center: v3(fcx, ground(fcx, fcz), fcz), radius: ar.radius, spawns: sideSpawns(fcx, fcz, ar.radius, ground) },
    { id: 'clearing', name: 'Clairière', center: v3(ccx, ground(ccx, ccz), ccz), radius: ar.radius + 2, spawns: sideSpawns(ccx, ccz, ar.radius + 2, ground) },
    { id: 'lake', name: 'Lac', center: v3(lx, wy, lz), radius: ar.lakeRadius, spawns: sideSpawns(lx, lz, ar.lakeRadius, () => wy) },
    { id: 'rooftops', name: 'Toits', center: rtc, radius: ar.radius - 2, spawns: { red: rtRoofs[0].slice(0, 3), blue: rtRoofs[RT.n - 1].slice(0, 3) } },
  ];
  const pathPt = (i: number, t: number) => { const p = paths[i].at(t); return v3(p.x, ground(p.x, p.z), p.z); };
  const rp = riverL.at(0.33), rbx = rp.x - rp.tz * (C.river.half + C.river.bank + 2.5), rbz = rp.z + rp.tx * (C.river.half + C.river.bank + 2.5);
  let beachZ = 150;
  while (beachZ < half && ground(-180, beachZ) > CO.beachTop - 0.6) beachZ += 1;
  const isl = (i: number) => v3(C.islands[i].x, ground(C.islands[i].x, C.islands[i].z), C.islands[i].z);
  const gateZ = vcz + W;
  const points: Record<string, Vec3Like> = {
    'village.market': v3(vcx + (M.x0 + M.x1) / 2, ground(vcx + (M.x0 + M.x1) / 2, vcz), vcz),
    'village.training': v3(fcx, ground(fcx, fcz + 12), fcz + 12),
    'village.river': v3(rbx, ground(rbx, rbz), rbz),
    'village.rooftops': rtRoofs[1][1],
    'village.gate': v3(vcx - 2, ground(vcx - 2, gateZ - 18), gateZ - 18),
    'forest.path': pathPt(0, 0.5),
    'forest.clearing': v3(ccx, ground(ccx, ccz + 10), ccz + 10),
    'forest.ravine': ravinePoint,
    'forest.deep': v3(-370, ground(-370, -230), -230),
    'shore.docks': docksPoint,
    'shore.beach': v3(-180, ground(-180, beachZ), beachZ),
    'island.north': isl(0),
    'island.east': isl(1),
    'gate.main': v3(vcx, ground(vcx, gateZ + C.gateOutside), gateZ + C.gateOutside),
  };
  for (const p of Object.values(points)) block.add(p.x, p.z, 4);
  for (const a of arenas) for (const p of [...a.spawns.red, ...a.spawns.blue]) block.add(p.x, p.z, 3);

  // ---------------------------------------------------------------- forest scatter
  const inForest = (x: number, z: number, pad: number) => {
    if (Math.abs(x) > half - 8 || Math.abs(z) > half - 8) return false;
    if (Math.hypot(x - vcx, z - vcz) < W + 8 + pad) return false;
    const s = shore(x, z), rk = rocky(x, z);
    if (s > -lerp(CO.beachWidth + 4, CO.rockyDrop + 2, rk) - pad) return false;
    if (ground(x, z) < wy + 1.5) return false;
    for (const p of paths) if (p.dist(x, z, C.paths.half + 2.5 + pad).d < C.paths.half + 2.5 + pad) return false;
    for (const L of lines) if (L.line.dist(x, z, L.half + L.bank + 1 + pad).d < L.half + L.bank + 1 + pad) return false;
    if (ravine.dist(x, z, C.ravine.half + 3 + pad).d < C.ravine.half + 3 + pad) return false;
    for (const [cx, cz, r] of C.clearings) if (Math.hypot(x - cx, z - cz) < r + pad) return false;
    return !block.hit(x, z, pad);
  };
  const islandFix = (x: number, z: number) => C.islands.some((I) => Math.hypot(x - I.x, z - I.z) < I.r * 0.9);
  const forestOk = (x: number, z: number, pad: number) => (inForest(x, z, pad) || (islandFix(x, z) && ground(x, z) > wy + 1 && !block.hit(x, z, pad))) && slope(x, z) < 0.75;

  const GI = C.giants, giants: Giant[] = [];
  for (let gz = -half; gz < half; gz += GI.step) for (let gx = -half; gx < half; gx += GI.step) {
    const x = gx + GI.step / 2 + (R() - 0.5) * GI.step * 0.7, z = gz + GI.step / 2 + (R() - 0.5) * GI.step * 0.7;
    const keep = R() < GI.chance, h = lerp(GI.height[0], GI.height[1], R()), r = lerp(GI.radius[0], GI.radius[1], R()), yaw = R() * Math.PI * 2, tint = R();
    const nb = GI.branches[0] + Math.floor(R() * (GI.branches[1] - GI.branches[0] + 1));
    const br = Array.from({ length: nb }, (_, k) => ({ f: lerp(GI.branchAt[0], GI.branchAt[1], (k + R() * 0.6) / nb), len: lerp(GI.branchLen[0], GI.branchLen[1], R()), a: yaw + k * 2.4 + R() * 0.5 }));
    if (!keep || !forestOk(x, z, GI.clear) || islandFix(x, z)) continue;
    const y = ground(x, z) - 0.3;
    const branches = br.map((b) => {
      const dx = Math.cos(b.a), dz = Math.sin(b.a), o = r * 0.55 + b.len / 2;
      return { x: x + dx * o, y: y + b.f * h, z: z + dz * o, len: b.len, yaw: yawOf(dx, dz) };
    });
    giants.push({ x, y, z, h, r, yaw, tint, branches });
    const top = h * 0.85, hh = Math.max(0.5, (top + 1) / 2 - r * 0.85);
    colliders.push({ type: 'capsule', center: v3(x, y - 1 + hh + r * 0.85, z), halfHeight: hh, radius: r * 0.85, climbable: true });
    for (const b of branches) box(b.x, b.y, b.z, b.len / 2, 0.45, 1.3, b.yaw);
    block.add(x, z, GI.clear);
  }

  const RK = C.rocks, rocks: Rock[] = [];
  const rockShapes = Array.from({ length: RK.variants }, (_, i) => rockShape(seed * 7 + i));
  const addRock = (x: number, z: number, s: number) => {
    const sy = s * lerp(0.6, 1.1, R()), yaw = R() * Math.PI * 2, variant = Math.floor(R() * RK.variants), y = ground(x, z) - s * 0.25;
    rocks.push({ x, y, z, s, sy, yaw, variant });
    const sh = rockShapes[variant], c = Math.cos(yaw), sn = Math.sin(yaw), vtx = new Float32Array(sh.pos.length);
    for (let i = 0; i < sh.pos.length; i += 3) {
      const lx2 = sh.pos[i] * s, ly = sh.pos[i + 1] * sy, lz2 = sh.pos[i + 2] * s;
      vtx[i] = x + lx2 * c + lz2 * sn; vtx[i + 1] = y + ly; vtx[i + 2] = z - lx2 * sn + lz2 * c;
    }
    colliders.push({ type: 'trimesh', vertices: vtx, indices: sh.idx, ...(s >= RK.climbMin ? { climbable: true } : {}) });
    block.add(x, z, s * 1.1);
  };
  for (let gz = -half; gz < half; gz += RK.step) for (let gx = -half; gx < half; gx += RK.step) {
    const x = gx + R() * RK.step, z = gz + R() * RK.step, keep = R() < RK.chance, s = lerp(RK.size[0], RK.size[1], R() ** 1.5);
    if (keep && forestOk(x, z, s + 1)) addRock(x, z, s);
  }
  for (let gz = -half; gz < half; gz += RK.shoreStep) for (let gx = -half; gx < half; gx += RK.shoreStep) {
    const x = gx + R() * RK.shoreStep, z = gz + R() * RK.shoreStep, keep = R() < RK.shoreChance * (0.3 + rocky(x, z)), s = lerp(RK.size[0], RK.size[1] * 0.9, R());
    const sh = shore(x, z);
    if (!keep || sh < -CO.rockyDrop - 3 || sh > 6 || Math.abs(x) > half - 6 || Math.abs(z) > half - 6 || block.hit(x, z, s + 1)) continue;
    if (paths.some((p) => p.dist(x, z, 8).d < 8) || decks.some((d) => Math.hypot(x - d.x, z - d.z) < d.len / 2 + 6)) continue;
    addRock(x, z, s);
  }

  const T = C.trees, trees: Tree[] = [];
  for (let gz = -half; gz < half; gz += T.step) for (let gx = -half; gx < half; gx += T.step) {
    const x = gx + T.step / 2 + (R() - 0.5) * T.step * 0.8, z = gz + T.step / 2 + (R() - 0.5) * T.step * 0.8;
    const keep = R() < T.chance, sp = R(), s = lerp(T.scale[0], T.scale[1], R()), yaw = R() * Math.PI * 2, tint = R();
    if (!keep || N.fbm(x / T.densityWave, z / T.densityWave, 2, 30) < T.gapBelow || !forestOk(x, z, 1.2)) continue;
    const y = ground(x, z), high = y > 25;
    const species: Tree['species'] = high ? (sp < 0.7 ? 1 : sp < 0.85 ? 0 : 2) : sp < 0.5 ? 0 : sp < 0.72 ? 1 : 2;
    trees.push({ x, y: y - 0.2, z, species, s, yaw, tint });
    const r = 0.45 * s, top = 5 * s, hh = Math.max(0.3, (top + 0.5) / 2 - r);
    colliders.push({ type: 'capsule', center: v3(x, y - 0.5 + hh + r, z), halfHeight: hh, radius: r, climbable: true });
    block.add(x, z, 1.2 * s);
  }
  const bushList: number[] = [];
  for (let gz = -half; gz < half; gz += C.bushes.step) for (let gx = -half; gx < half; gx += C.bushes.step) {
    const x = gx + R() * C.bushes.step, z = gz + R() * C.bushes.step, keep = R() < C.bushes.chance, s = lerp(0.7, 1.5, R()), tint = R();
    if (keep && forestOk(x, z, 0.6)) bushList.push(x, ground(x, z) - 0.1, z, s, tint);
  }
  const shafts: [number, number, number][] = [];
  for (let tries = 0; shafts.length < C.lightShafts && tries < C.lightShafts * 20; tries++) {
    const x = (R() * 2 - 1) * (half - 20), z = (R() * 2 - 1) * (half - 20);
    if (inForest(x, z, 0) && !block.hit(x, z, 2)) { shafts.push([x, ground(x, z), z]); }
  }

  // ---------------------------------------------------------------- boundary
  const bd = half;
  for (const [x, z, hx, hz] of [[bd + 1, 0, 1, bd + 2], [-bd - 1, 0, 1, bd + 2], [0, bd + 1, bd + 2, 1], [0, -bd - 1, bd + 2, 1]]) box(x, 60, z, hx, 160, hz, 0, false);

  // ---------------------------------------------------------------- zones raster
  const zr = C.zoneRes, zw = Math.round(C.size / zr), zdata = new Uint8Array(zw * zw);
  const fillRect = (cx: number, cz: number, hw: number, hd: number, yaw: number, code: number) => {
    const rr = Math.hypot(hw, hd), c = Math.cos(yaw), s = Math.sin(yaw);
    for (let r = Math.floor((cz - rr + half) / zr); r <= Math.floor((cz + rr + half) / zr); r++) for (let q = Math.floor((cx - rr + half) / zr); q <= Math.floor((cx + rr + half) / zr); q++) {
      if (r < 0 || q < 0 || r >= zw || q >= zw) continue;
      const x = -half + (q + 0.5) * zr - cx, z = -half + (r + 0.5) * zr - cz;
      const lx2 = x * c - z * s, lz2 = x * s + z * c; // inverse yaw
      if (Math.abs(lx2) <= hw && Math.abs(lz2) <= hd) zdata[r * zw + q] = code;
    }
  };
  for (let r = 0; r < zw; r++) for (let q = 0; q < zw; q++) {
    const x = -half + (q + 0.5) * zr, z = -half + (r + 0.5) * zr, g = ground(x, z), s = shore(x, z);
    let code: number = Math.hypot(x - vcx, z - vcz) < W ? ZONE.grass : ZONE.forest;
    if (s > -CO.beachWidth - 6 && g < CO.beachTop + 1 && rocky(x, z) < 0.6) code = ZONE.beach;
    if (slope(x, z) > 1) code = ZONE.cliff;
    for (const [cx, cz, cr] of C.clearings) if (Math.hypot(x - cx, z - cz) < cr) code = ZONE.grass;
    for (const p of paths) if (p.dist(x, z, C.paths.half).d < C.paths.half) code = ZONE.street;
    for (const st of streets) if (st.line.dist(x, z, st.half).d < st.half) code = ZONE.street;
    if (g < wy - 0.05 && ravine.dist(x, z, C.ravine.half).d >= C.ravine.half) code = ZONE.water;
    for (const L of lines) if (L.line.dist(x, z, L.half).d < L.half) code = ZONE.water;
    zdata[r * zw + q] = code;
  }
  fillRect(vcx + (px0 + px1) / 2, vcz + (pz0 + pz1) / 2, (px1 - px0) / 2, (pz1 - pz0) / 2, 0, ZONE.plaza);
  fillRect(vcx + F.x, vcz + F.z, F.half, F.half, 0, ZONE.field);
  for (const sq of squares) fillRect(sq.center.x, sq.center.z, sq.size / 2, sq.size / 2, 0, ZONE.plaza);
  fillRect(hq.x, hq.z, hq.r * 0.9, hq.r * 0.9, 0, ZONE.building);
  for (const b of buildings) fillRect(b.x, b.z, b.w / 2, b.d / 2, b.yaw, ZONE.building);
  for (const w of walls) fillRect(w.x, w.z, w.len / 2, V.wallThickness / 2 + 0.5, w.yaw, ZONE.wall);
  for (const d of decks) fillRect(d.x, d.z, d.len / 2, d.width / 2, d.yaw, d.kind === 'dock' ? ZONE.dock : ZONE.bridge);

  const labels = [
    { text: 'Konoha', x: vcx, z: vcz - 70 }, { text: 'QG', x: hq.x, z: hq.z }, { text: 'Place du QG', x: vcx, z: vcz + 12 },
    { text: 'Porte principale', x: vcx, z: gateZ + 8 }, { text: 'Porte ouest', x: vcx - W - 10, z: vcz }, { text: 'Porte est', x: vcx + W + 10, z: vcz },
    { text: 'Marché', x: points['village.market'].x, z: vcz }, { text: "Terrain d'entraînement", x: fcx, z: fcz }, { text: 'Toits', x: rtc.x, z: rtc.z },
    { text: 'Rivière', x: rp.x, z: rp.z }, { text: 'Falaise', x: vcx, z: cliffLine(vcx) - 20 }, { text: 'Plateau nord', x: 0, z: -330 },
    { text: 'Grande forêt', x: -260, z: -160 }, { text: 'Forêt profonde', x: -370, z: -230 }, { text: 'Clairière', x: ccx, z: ccz },
    { text: 'Ravin', x: ravinePoint.x - 20, z: ravinePoint.z }, { text: 'Cascade', x: waterfalls[0].x1, z: waterfalls[0].z1 },
    { text: 'Plage', x: -180, z: beachZ }, { text: 'Quais', x: docksPoint.x, z: docksPoint.z }, { text: 'Lac', x: lx, z: lz },
    { text: 'Île du nord', x: C.islands[0].x, z: C.islands[0].z }, { text: "Île de l'est", x: C.islands[1].x, z: C.islands[1].z },
  ];

  const data: WorldData = {
    seed, size: C.size, boundary: half, killPlaneY: C.killPlaneY, heightfield,
    zones: { res: zr, w: zw, h: zw, originX: -half, originZ: -half, data: zdata },
    colliders, spawns, squares, arenas, points, labels,
  };
  const layout: WorldLayout = {
    village: { x: vcx, z: vcz, r: W }, hq, buildings, walls, gates, stalls, posts, lanterns, decks, waterLines, waterfalls, lakeRects, waterY: wy,
    trees, giants, bushes: Float32Array.from(bushList), rocks, rockSeed: seed, shafts,
    paths: paths.map((p) => p.pts), streets: streets.map((s) => ({ pts: s.line.pts, half: s.half })),
  };
  cache.set(data, layout);
  return { data, layout };
}
