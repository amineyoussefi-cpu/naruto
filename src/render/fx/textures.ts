import * as THREE from 'three';

/**
 * Procedural FX textures computed pixel by pixel into a DataTexture (no DOM, so they also build in Node tests).
 * Each generator returns a new texture; the caller owns and disposes it.
 */

const SIZE = 128;
const TAU = Math.PI * 2;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Signed angular difference wrapped to [-π, π]. */
const angDiff = (a: number, b: number): number => ((((a - b) % TAU) + TAU * 1.5) % TAU) - Math.PI;

/** Small seeded LCG so textures are identical every run. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

type Pixel = (u: number, v: number, r: number, th: number, out: number[]) => void;

function bake(px: Pixel, srgb = false): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const out = [0, 0, 0, 0];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = ((x + 0.5) / SIZE) * 2 - 1, v = ((y + 0.5) / SIZE) * 2 - 1;
      out[0] = out[1] = out[2] = out[3] = 0;
      px(u, v, Math.hypot(u, v), Math.atan2(v, u), out);
      const i = (y * SIZE + x) * 4;
      for (let c = 0; c < 4; c++) data[i + c] = Math.round(clamp01(out[c]) * 255);
    }
  }
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const AA = SIZE / 2; // 1 texel in uv units
const INK = [0.08, 0.06, 0.11];
const WHITE = [1, 1, 1], YELLOW = [1, 0.86, 0.25], ORANGE = [1, 0.45, 0.1];

/** Anime impact star: white jagged core, yellow→orange rim, thin ink outline. */
export function impactStarTexture(): THREE.DataTexture {
  const N = 12, rnd = seeded(7);
  const len = Array.from({ length: N }, () => 0.6 + rnd() * 0.36);
  return bake((_u, _v, r, th, o) => {
    const ph = ((th + Math.PI) / TAU) * N, i = Math.floor(ph) % N, t = ph - Math.floor(ph);
    const sh = (1 - Math.abs(2 * t - 1)) ** 2; // concave spikes
    const R = 0.26 + (len[i] - 0.26) * sh, Rw = 0.18 + (len[i] * 0.68 - 0.18) * sh, edge = R + 0.045;
    let c: number[];
    if (r < Rw) c = WHITE;
    else if (r < R) {
      const k = clamp01((r - Rw) / Math.max(R - Rw, 1e-3));
      c = [YELLOW[0] + (ORANGE[0] - YELLOW[0]) * k, YELLOW[1] + (ORANGE[1] - YELLOW[1]) * k, YELLOW[2] + (ORANGE[2] - YELLOW[2]) * k];
    } else c = INK;
    o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; o[3] = clamp01((edge - r) * AA);
  }, true);
}

/** Radial manga "impact lines": thin wedges pointing at the centre, empty middle. White, tinted by the sprite. */
export function impactLinesTexture(): THREE.DataTexture {
  const N = 44, rnd = seeded(11);
  const lines = Array.from({ length: N }, (_, i) => ({ c: ((i + 0.5 + (rnd() - 0.5) * 0.6) / N) * TAU - Math.PI, ri: 0.4 + rnd() * 0.35, w: 0.012 + rnd() * 0.022 }));
  return bake((_u, _v, r, th, o) => {
    let a = 0;
    for (const l of lines) {
      if (r < l.ri) continue;
      const half = l.w * ((r - l.ri) / (1 - l.ri));
      a = Math.max(a, clamp01((half - Math.abs(angDiff(th, l.c)) * r) * AA));
    }
    o[0] = o[1] = o[2] = 1;
    o[3] = a * clamp01((0.98 - r) / 0.1);
  });
}

/** Hexagonal guard shield: bright rim, faint fill, inner hex line. White, tinted by the sprite. */
export function hexShieldTexture(): THREE.DataTexture {
  return bake((u, v, _r, _th, o) => {
    const x = Math.abs(u), y = Math.abs(v);
    const d = Math.max(x * 0.866 + y * 0.5, x); // flat-side hexagon distance
    const rim = Math.exp(-(((d - 0.8) / 0.045) ** 2));
    const inner = 0.45 * Math.exp(-(((d - 0.5) / 0.025) ** 2));
    o[0] = o[1] = o[2] = 1;
    o[3] = Math.max(rim, inner, d < 0.8 ? 0.2 : 0);
  });
}

/** Tall 4-point glint (telegraph "flash" above an enemy). White, tinted by the sprite. */
export function glintTexture(): THREE.DataTexture {
  return bake((u, v, r, _th, o) => {
    const x = Math.abs(u), y = Math.abs(v);
    o[0] = o[1] = o[2] = 1;
    o[3] = Math.max(Math.exp(-x * 14 - y * 2.2), Math.exp(-y * 14 - x * 3.5), Math.exp(-r * r * 25));
  });
}

/** Ground crack decal: dark crater plus jagged radial cracks. */
export function crackTexture(): THREE.DataTexture {
  const N = 10, rnd = seeded(23);
  const cracks = Array.from({ length: N }, (_, i) => ({ c: (i / N) * TAU + rnd() * 0.5 - Math.PI, len: 0.55 + rnd() * 0.42, ph: rnd() * 6 }));
  return bake((_u, _v, r, th, o) => {
    let a = 0.55 * (1 - clamp01((r - 0.12) / 0.14));
    for (const k of cracks) {
      if (r > k.len) continue;
      const c = k.c + 0.14 * Math.sin(r * 13 + k.ph) + 0.06 * Math.sin(r * 37 + k.ph * 2);
      const w = 0.03 * (1 - r / k.len) + 0.005;
      a = Math.max(a, 0.85 * clamp01((w - Math.abs(angDiff(th, c)) * r) * AA));
    }
    o[0] = 0.24; o[1] = 0.17; o[2] = 0.12;
    o[3] = a;
  }, true);
}
