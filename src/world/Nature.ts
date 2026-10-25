import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash1, noise2, noise3, smoothstep } from './terrain';

/** Nature look: rock and foliage palettes (sRGB hex), shape tuning. */
export const NATURE = {
  rockGreys: [0xb7bec6, 0xa4adb8, 0x9aa3ad, 0xc3c6c4] as const,
  moss: 0x6faa45,
  /** Sea-stack faces: pale grey-blue strata. */
  cliff: [0xb4c0cf, 0x9fadc0, 0xc2cbd6] as const,
  cliffGrass: [0x7cc24a, 0x5fae3f] as const,
  bark: 0x6e5038, deadWood: 0x8c7a66, driftwood: 0xcdbca2,
};

/** Sets a constant vertex colour attribute (multiplied by the instance colour at draw time). */
function paint(g: THREE.BufferGeometry, shade: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(shade), 3));
  return g;
}
const ico = (r: number, x: number, y: number, z: number, shade: number, sx = 1, sy = 1, sz = 1) =>
  paint(new THREE.IcosahedronGeometry(r, 1).scale(sx, sy, sz).translate(x, y, z), shade);

/**
 * Rounded boulder (base near y = 0, unit radius), smooth normals, grey with mossy tops in vertex colours.
 * `flat` cuts the top for climbable, standable rocks.
 */
export function boulderGeometry(seed: number, flat = 0): THREE.BufferGeometry {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const r = 1 + 0.2 * noise3(v.x * 1.2 + seed * 7.3, v.y * 1.2, v.z * 1.2 - seed) + 0.06 * noise3(v.x * 3.4, v.y * 3.4 + seed, v.z * 3.4);
    v.multiplyScalar(r);
    v.y = Math.max(v.y * 0.78, -0.35);
    if (flat > 0) v.y = Math.min(v.y, 0.78 - flat);
    p.setXYZ(i, v.x, v.y + 0.3, v.z);
  }
  g.computeVertexNormals();
  const n = g.getAttribute('normal'), col: number[] = [], c = new THREE.Color(), m = new THREE.Color(NATURE.moss), gr = NATURE.rockGreys;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(gr[Math.floor(hash1(seed * 3.1 + Math.floor(v.y * 2.2)) * gr.length)]).multiplyScalar(0.95 + noise3(v.x * 2, v.y * 2, v.z * 2) * 0.06);
    const moss = 0.85 * smoothstep(0.7, 0.92, n.getY(i) + noise3(v.x * 2.5, v.y + seed, v.z * 2.5) * 0.25);
    c.lerp(m, moss);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * Tall flat-topped sea stack (local origin at the base centre), mostly vertical faceted faces with
 * horizontal strata, a grassy top. Built from stacked noisy rings + a top cap; used for render and collider.
 */
export function seaStackGeometry(radius: number, height: number, seed: number): THREE.BufferGeometry {
  const NA = 30, NR = 9, bottom = -10, rings: THREE.Vector3[][] = [];
  const rad = (a: number, y: number) => {
    const ca = Math.cos(a), sa = Math.sin(a);
    return radius * (1 + 0.22 * noise2(ca * 1.6 + seed, sa * 1.6) + 0.07 * noise2(ca * 5 + y * 0.05, sa * 5 + seed)) * (1.06 - 0.12 * smoothstep(bottom, height, y));
  };
  for (let r = 0; r <= NR; r++) {
    const y = bottom + ((height - bottom) * r) / NR + (r > 0 && r < NR ? (hash1(seed + r) - 0.5) * 2 : 0);
    rings.push(Array.from({ length: NA }, (_, k) => { const a = (k / NA) * Math.PI * 2, rr = rad(a, y) * (1 + (hash1(seed * 3 + r * 7 + k) - 0.5) * 0.05); return new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr); }));
  }
  const pos: number[] = [], col: number[] = [], c = new THREE.Color();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, hex: number, shade: number) => {
    c.set(hex).multiplyScalar(shade);
    for (const v of [a, b, d]) { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); }
  };
  const F = NATURE.cliff;
  for (let r = 0; r < NR; r++) for (let k = 0; k < NA; k++) {
    const a = rings[r][k], b = rings[r][(k + 1) % NA], d = rings[r + 1][k], e = rings[r + 1][(k + 1) % NA];
    const hex = F[Math.floor(hash1(seed + r * 1.7) * F.length)], s = 0.94 + hash1(seed + r * 13 + k) * 0.1;
    tri(a, d, b, hex, s); tri(b, d, e, hex, s);
  }
  // Grassy top: a grass lip slightly outside the rim, then a gently domed cap.
  const top = rings[NR], centre = new THREE.Vector3(0, height + 0.8, 0);
  const lip = top.map((v) => new THREE.Vector3(v.x * 1.03, height + 0.35, v.z * 1.03));
  for (let k = 0; k < NA; k++) {
    const k1 = (k + 1) % NA, g = NATURE.cliffGrass[k % 2], s = 0.95 + hash1(seed + k) * 0.08;
    tri(top[k], lip[k], top[k1], g, s * 0.9); tri(top[k1], lip[k], lip[k1], g, s * 0.9);
    tri(lip[k], centre, lip[k1], g, s);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Tree species (vertex colours = light/shade split, instance colour = hue). Base at y = 0, ~6–8 m tall. */
export function treeGeometries() {
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 1, 6).translate(0, 0.5, 0);
  const round = mergeGeometries([
    ico(2.1, 0, 4.0, 0, 0.8), ico(1.6, 1.4, 3.6, 0.7, 0.88), ico(1.5, -1.3, 3.8, -0.5, 0.86),
    ico(1.5, -0.5, 5.3, 0.2, 1.08), ico(1.2, 0.8, 5.0, -0.8, 1.12),
  ]);
  const wide = mergeGeometries([
    ico(2.2, 0, 4.6, 0, 0.82, 1.5, 0.7, 1.3), ico(1.8, 1.8, 4.3, 0.6, 0.9, 1.2, 0.75, 1.1), ico(1.7, -1.6, 4.9, -0.4, 1.06, 1.3, 0.7, 1.2),
    ico(1.4, 0.3, 5.6, 0.4, 1.12, 1.2, 0.7, 1.1),
  ]);
  const tall = mergeGeometries([
    ico(1.5, 0, 4.5, 0, 0.84, 1, 1.7, 1), ico(1.2, 0.5, 6.3, 0.2, 1.08, 1, 1.5, 1), ico(1.0, -0.6, 5.3, -0.4, 0.95, 1, 1.4, 1),
  ]);
  const bush = mergeGeometries([ico(1, 0, 0.55, 0, 0.88), ico(0.75, 0.75, 0.5, 0.3, 1.0), ico(0.65, -0.6, 0.5, -0.35, 1.08), ico(0.6, 0.1, 1.05, -0.1, 1.12)]);
  const dead = mergeGeometries([
    new THREE.CylinderGeometry(0.12, 0.26, 4, 5).translate(0, 2, 0),
    new THREE.CylinderGeometry(0.05, 0.1, 2, 4).translate(0, 1, 0).rotateZ(0.8).translate(0, 2.4, 0),
    new THREE.CylinderGeometry(0.05, 0.09, 1.7, 4).translate(0, 0.85, 0).rotateZ(-0.9).translate(0, 3.0, 0),
    new THREE.CylinderGeometry(0.04, 0.08, 1.4, 4).translate(0, 0.7, 0).rotateX(0.9).translate(0, 3.4, 0),
  ]);
  const log = new THREE.CylinderGeometry(0.22, 0.28, 1, 6).rotateZ(Math.PI / 2);
  // Tall grass: three leaning blades. Flowers: tiny blobs.
  const blade = (rx: number, rz: number) => new THREE.ConeGeometry(0.11, 0.55, 3).translate(0, 0.27, 0).rotateX(rx).rotateZ(rz);
  const tuft = mergeGeometries([blade(0.2, 0.1), blade(-0.15, 0.25), blade(0.05, -0.3)]);
  const flower = new THREE.IcosahedronGeometry(0.11, 0).translate(0, 0.35, 0);
  return { trunk, round, wide, tall, bush, dead, log, tuft, flower };
}
