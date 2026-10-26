/** Seedable deterministic noise / RNG / polyline helpers for the world generator (pure, Node-safe). */

function ih(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * (3 - 2 * t);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Seeded value noise in [-1, 1] and fbm. */
export class Noise {
  constructor(private readonly seed: number) {}
  n2(x: number, z: number, layer = 0): number {
    const s = (this.seed * 31 + layer * 7919) | 0;
    const xi = Math.floor(x), zi = Math.floor(z), u = fade(x - xi), v = fade(z - zi);
    return lerp(lerp(ih(xi, zi, s), ih(xi + 1, zi, s), u), lerp(ih(xi, zi + 1, s), ih(xi + 1, zi + 1, s), u), v) * 2 - 1;
  }
  fbm(x: number, z: number, oct: number, layer = 0): number {
    let s = 0, a = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.n2(x, z, layer + i); n += a; a *= 0.5; x *= 2.03; z *= 2.03; }
    return s / n;
  }
  /** Hash of a 2D integer-ish key in [0, 1). */
  h(x: number, z: number, layer = 0): number { return ih(Math.floor(x * 16), Math.floor(z * 16), (this.seed * 131 + layer * 104729) | 0); }
}

/** Mulberry32 PRNG in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type P2 = [number, number];

/** Polyline with cumulative length, for distance queries (bbox-pruned). */
export class Polyline {
  readonly len: number[] = [0];
  readonly total: number;
  readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number;
  constructor(readonly pts: P2[]) {
    for (let i = 1; i < pts.length; i++) this.len.push(this.len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.total = this.len[this.len.length - 1];
    this.minX = Math.min(...pts.map((p) => p[0])); this.maxX = Math.max(...pts.map((p) => p[0]));
    this.minZ = Math.min(...pts.map((p) => p[1])); this.maxZ = Math.max(...pts.map((p) => p[1]));
  }
  /** Closest distance, arc parameter t (0..1) and segment index; Infinity when farther than `max` from the bbox. */
  dist(x: number, z: number, max = Infinity): { d: number; t: number; i: number } {
    if (x < this.minX - max || x > this.maxX + max || z < this.minZ - max || z > this.maxZ + max) return { d: Infinity, t: 0, i: 0 };
    let best = Infinity, at = 0, seg = 0;
    const p = this.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i][0], az = p[i][1], dx = p[i + 1][0] - ax, dz = p[i + 1][1] - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / l2) : 0;
      const ex = x - ax - dx * t, ez = z - az - dz * t, d2 = ex * ex + ez * ez;
      if (d2 < best) { best = d2; at = this.len[i] + (this.len[i + 1] - this.len[i]) * t; seg = i; }
    }
    return { d: Math.sqrt(best), t: this.total > 0 ? at / this.total : 0, i: seg };
  }
  /** Point and unit tangent at arc parameter t. */
  at(t: number): { x: number; z: number; tx: number; tz: number } {
    const L = clamp01(t) * this.total;
    let i = 0;
    while (i < this.pts.length - 2 && this.len[i + 1] < L) i++;
    const a = this.pts[i], b = this.pts[i + 1], sl = this.len[i + 1] - this.len[i] || 1, u = (L - this.len[i]) / sl;
    const tx = (b[0] - a[0]) / sl, tz = (b[1] - a[1]) / sl;
    return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, tx, tz };
  }
}

/** Catmull-Rom subdivision of control points (≈ `step` m between output points), with seeded lateral wiggle. */
export function smoothLine(ctrl: readonly (readonly [number, number])[], step: number, wiggle = 0, noise?: Noise, layer = 0): P2[] {
  const out: P2[] = [];
  const P = (i: number) => ctrl[Math.min(ctrl.length - 1, Math.max(0, i))];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([ctrl[ctrl.length - 1][0], ctrl[ctrl.length - 1][1]]);
  if (wiggle > 0 && noise) {
    for (let i = 1; i < out.length - 1; i++) {
      const dx = out[i + 1][0] - out[i - 1][0], dz = out[i + 1][1] - out[i - 1][1], l = Math.hypot(dx, dz) || 1;
      const w = noise.n2(i * 0.18, 0.5, layer) * wiggle;
      out[i] = [out[i][0] - (dz / l) * w, out[i][1] + (dx / l) * w];
    }
  }
  return out;
}
