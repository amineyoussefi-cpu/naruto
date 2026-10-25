import * as THREE from 'three';

/**
 * World layout (metres) and the pure, deterministic terrain height/colour functions.
 * Coastal valley: the player spawns on a meadow facing the sea (+Z). Braided turquoise streams run from the
 * back hills (−Z) through the meadow into an estuary dotted with grassy islets. A wooded plateau rises on the
 * left (+X), a tall flat-topped sea stack stands on the right coast (−X). No DOM / WebGL: unit-testable in Node.
 */
export const WORLD = {
  /** Terrain mesh covers [-extent, extent]² with this grid step, split into chunks × chunks meshes. */
  extent: 200, cell: 2, chunks: 4,
  /** Water surface of the sea, estuary and streams (m). */
  waterY: 0,
  /** Meadow: base height above water, fine undulation. */
  meadow: 1.1, undulation: 0.9,
  /** Rolling back hills (toward −Z) and side hills: start / full distance and height (+ noise share). */
  backHills: { from: -35, to: -115, height: 12, noise: 9 },
  sideHills: { from: 55, to: 120, height: 9, noise: 7 },
  /** Far rounded mountains behind the valley: radius band and height. */
  far: { from: 135, to: 195, height: 70 },
  /** Wooded plateau on the left (+X): x ramp, z extent, top height. */
  plateau: { x0: 46, x1: 62, z0: -70, z1: 30, zBlend: 16, y: 13 },
  /** Coastline z (+ noise amplitude, wavelength), beach depth and sea floor. */
  coast: { z: 46, noise: 9, wave: 45, beach: 8, shelf: 40, floor: -7 },
  /** Estuary: wide shallow basin where the streams fan out before the sea. */
  estuary: { x: 0, z: 26, ax: 48, az: 20, depth: 0.7 },
  /** Meandering streams (back hills → estuary): polylines, half-width at the source and at the mouth, bed depth. */
  streams: [
    [[-34, -125], [-26, -92], [-36, -62], [-24, -34], [-30, -10], [-14, 12]],
    [[30, -125], [24, -90], [32, -60], [16, -30], [22, -4], [10, 14]],
    [[-26, -40], [-8, -22], [-12, 2], [0, 14]],
  ] as [number, number][][],
  streamHalf: [2.2, 5.5] as const, streamDepth: 0.8,
  /** Round pools along the streams: [x, z, radius]. */
  pools: [[-36, -62, 8], [30, -58, 7], [-6, -16, 6]] as [number, number, number][],
  /** Grassy islets (flat tops, sandy rims): [x, z, radius, top above water]. */
  islets: [
    [-20, 22, 7, 0.7], [6, 28, 5, 0.6], [24, 20, 6, 0.75], [-4, 38, 4, 0.5], [-34, 26, 5, 0.6], [16, 36, 3.5, 0.5],
    [36, 30, 4.5, 0.6], [-10, 8, 3, 0.6], [-29, -14, 2.8, 0.5], [21, -6, 3, 0.6], [-46, 34, 4, 0.5], [32, 44, 3, 0.4],
  ] as [number, number, number, number][],
  /** Sea stack on the right coast: centre, base radius, height. Built as its own climbable mesh. */
  stack: { x: -70, z: 72, radius: 17, height: 34 },
  /** Player spawn (training meadow): centre, flat radius, blend radius. */
  spawn: { x: 0, z: -48, radius: 9, blend: 20 },
  /** Invisible boundary: inner radius of the wall ring, segment count. */
  boundary: { radius: 128, segments: 32 },
  colors: {
    greens: [0xa8cf4f, 0x8cc24a, 0x6db644, 0x4fa64a, 0x3d9a62, 0x7d9a3e, 0x4f8f6a] as const,
    dirt: 0xcfae78, sand: 0xe6d3a3, wetSand: 0xc9b98e, rock: [0xa7b0bd, 0x98a0aa, 0xb3b7b9, 0x8e98a6] as const,
    mountain: 0x7f9fb6,
  },
};

// ---------------------------------------------------------------- noise
function ih(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * (3 - 2 * t);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Deterministic hash in [0,1). */
export const hash1 = (n: number) => ih(Math.floor(n * 1000), 7, 13);

/** Value noise in [-1, 1]. */
export function noise2(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), u = fade(x - xi), v = fade(z - zi);
  return lerp(lerp(ih(xi, zi, 0), ih(xi + 1, zi, 0), u), lerp(ih(xi, zi + 1, 0), ih(xi + 1, zi + 1, 0), u), v) * 2 - 1;
}
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const c = (dx: number, dy: number, dz: number) => ih(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
export function fbm2(x: number, z: number, oct: number): number {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x, z); n += a; a *= 0.5; x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; }
  return s / n;
}

// ---------------------------------------------------------------- geometry helpers
/** Distance from (x, z) to segment a-b and the segment parameter. */
function segT(x: number, z: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return [Math.hypot(x - ax - dx * t, z - az - dz * t), t];
}
/** Distance to a polyline and the normalised arc position (0 = first point, 1 = last) of the closest point. */
export function polyDist(x: number, z: number, pts: readonly (readonly [number, number])[]): [number, number] {
  let best = Infinity, at = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [d, t] = segT(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) { best = d; at = (i + t) / (pts.length - 1); }
  }
  return [best, at];
}

/** Coastline z at x (sea is z greater than this). */
export const coastZ = (x: number) => WORLD.coast.z + noise2(x / WORLD.coast.wave + 3.3, 1.7) * WORLD.coast.noise;
/** Distance to the nearest stream centreline minus its local half-width (< 0 = inside the channel). */
export function streamDist(x: number, z: number): number {
  let d = Infinity;
  for (const s of WORLD.streams) {
    const [dist, t] = polyDist(x, z, s);
    d = Math.min(d, dist - lerp(WORLD.streamHalf[0], WORLD.streamHalf[1], t) * (1 + noise2(x / 9, z / 9) * 0.25));
  }
  for (const [px, pz, r] of WORLD.pools) d = Math.min(d, Math.hypot(x - px, z - pz) - r);
  return d;
}
export const estuaryE = (x: number, z: number) => { const E = WORLD.estuary; return Math.hypot((x - E.x) / E.ax, (z - E.z) / E.az) * (1 + fbm2(x / 14, z / 14, 2) * 0.22); };

/** Land shape before any water carving. */
function landHeight(x: number, z: number): number {
  const W = WORLD, B = W.backHills, S = W.sideHills, P = W.plateau, F = W.far;
  let h = W.meadow + (fbm2(x / 40, z / 40, 3) * 0.5 + 0.5) * W.undulation + noise2(x / 7, z / 7) * 0.15;
  h += smoothstep(B.from, B.to, z) * (B.height + fbm2(x / 45 + 5, z / 45, 3) * B.noise);
  const side = smoothstep(S.from, S.to, Math.abs(x)) * (1 - smoothstep(20, 60, z));
  h += side * (S.height + fbm2(x / 35, z / 35 + 8, 3) * S.noise);
  const r = Math.hypot(x, z);
  if (r > F.from) h += smoothstep(F.from, F.to, r) * (1 - smoothstep(30, 120, z)) * F.height * (0.6 + 0.4 * fbm2(x / 70, z / 70, 3));
  // Wooded plateau: rounded edges, gently undulating top.
  const wp = smoothstep(P.x0, P.x1, x) * smoothstep(P.z0 - P.zBlend, P.z0, z) * (1 - smoothstep(P.z1, P.z1 + P.zBlend, z));
  if (wp > 0) h = Math.max(h, lerp(h, P.y + fbm2(x / 20, z / 20, 2) * 1.5, wp));
  // Spawn meadow stays flat.
  const ds = Math.hypot(x - W.spawn.x, z - W.spawn.z);
  if (ds < W.spawn.blend) h = lerp(h, W.meadow + 0.4, 1 - smoothstep(W.spawn.radius, W.spawn.blend, ds));
  return h;
}

/** Terrain height at (x, z), deterministic. */
export function heightAt(x: number, z: number): number {
  const W = WORLD, C = W.coast, wy = W.waterY;
  let h = landHeight(x, z);
  // Beach and sea shelf.
  const cz = coastZ(x);
  if (z > cz - C.beach) {
    const beach = wy + 0.9 - ((z - (cz - C.beach)) / C.beach) * 1.2; // beach slopes into the water at the coastline
    h = Math.min(h, Math.max(beach, lerp(wy - 1, C.floor, smoothstep(cz, cz + C.shelf, z))));
  }
  // Estuary basin and streams (shallow, sandy beds).
  const e = estuaryE(x, z);
  if (e < 1.4) h = Math.min(h, wy - W.estuary.depth + (e * e) * 1.4);
  const sd = streamDist(x, z);
  if (sd < 4) h = Math.min(h, wy - W.streamDepth + smoothstep(-4, 3, sd) * (W.streamDepth + 1.4));
  // Grassy islets: rounded flat tops pushed back above the water.
  for (const [ix, iz, r, top] of W.islets) {
    const d = Math.hypot(x - ix, z - iz) * (1 + noise2(x / 3 + ix, z / 3) * 0.12);
    if (d < r) h = Math.max(h, wy + top - (1 - Math.cos((Math.PI / 2) * smoothstep(r * 0.55, r, d))) * (top + 0.6));
  }
  return h;
}

/** Surface normal from central differences (consistent across chunk seams). */
export function normalAt(x: number, z: number, out: THREE.Vector3, e = WORLD.cell): THREE.Vector3 {
  return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

const tA = new THREE.Color(), tB = new THREE.Color();
/** Painted ground colour: patchy greens, sand/dirt by the water, grey rock on steep slopes, blue haze on far mountains. */
export function terrainColor(x: number, z: number, h: number, ny: number, out: THREE.Color): THREE.Color {
  const W = WORLD, C = W.colors, G = C.greens, wy = W.waterY;
  const t = (fbm2(x / 30 + 11, z / 30 - 4, 3) * 0.5 + 0.5) * (G.length - 1) * 1.3 - 0.15 * (G.length - 1);
  const i = Math.min(G.length - 2, Math.max(0, Math.floor(t)));
  out.set(G[i]).lerp(tA.set(G[i + 1]), Math.min(1, Math.max(0, t - i)));
  // Sunlit yellow-green speckles and fine jitter.
  if (noise2(x / 6 + 50, z / 6) > 0.45) out.lerp(tA.set(G[0]), 0.35);
  out.multiplyScalar(0.94 + hash1(x * 0.37 + z * 1.91) * 0.1);
  // Dirt around the spawn meadow edge and patches near water.
  const ds = Math.hypot(x - W.spawn.x, z - W.spawn.z);
  const dirt = Math.max(1 - smoothstep(5.5, 7, ds), smoothstep(0.35, 0.7, noise2(x / 9, z / 9 + 30)) * (1 - smoothstep(wy + 1.2, wy + 2.4, h)));
  if (dirt > 0) out.lerp(tA.set(C.dirt), dirt * 0.85);
  if (h < wy + 1.5) out.lerp(tA.set(h < wy ? C.wetSand : C.sand), 1 - smoothstep(wy + 0.5, wy + 1.5, h));
  const rockMix = 1 - smoothstep(0.62, 0.78, ny);
  if (rockMix > 0) {
    const r = C.rock, k = (fbm2(x / 14, z / 14 + h / 20, 2) * 0.5 + 0.5) * (r.length - 1);
    const j = Math.min(r.length - 2, Math.floor(k));
    tB.set(r[j]).lerp(tA.set(r[j + 1]), k - j);
    out.lerp(tB, rockMix);
  }
  const far = smoothstep(W.far.from, W.far.to, Math.hypot(x, z));
  if (far > 0) out.lerp(tA.set(C.mountain), far * 0.55);
  return out;
}

/** Ground check for spawns: dry meadow, not steep, away from water, inside the valley. */
export function isOpenGround(x: number, z: number, flatTol = 0.6): boolean {
  const W = WORLD;
  if (Math.hypot(x, z) > W.boundary.radius - 25 || z > coastZ(x) - W.coast.beach - 4) return false;
  const h = heightAt(x, z);
  if (h < W.waterY + 0.6 || streamDist(x, z) < 3 || estuaryE(x, z) < 1.5) return false;
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1.4, 1.4], [-1.4, -1.4]]) if (Math.abs(heightAt(x + dx, z + dz) - h) > flatTol) return false;
  return true;
}
