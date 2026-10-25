import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from '../render/toon';
import { glowMaterial } from '../render/PostFX';
import { Batcher } from './Batcher';

/**
 * Hidden-village surroundings: terraced hills stepping up behind the cliff ring, an original village
 * skyline (houses, towers, academy, water tanks, scaffolds, lanterns, power lines), a gorge with a river
 * under the bridge, and a distant mountain range. Purely decorative: no colliders, out of reach.
 */
export const VILLAGE = {
  /** Inner bounds of the hills (just behind the cliff ring): |x| ≥ x, z ≥ north, z ≤ south. */
  inner: { x: 37, north: 37, south: -29 },
  /** Outer extent of the terraced ground (m from origin). */
  extent: 133,
  /** Number of cells per hill band. */
  cellsPerBand: 8,
  /** Far gorge bank begins at this z (south of the shrine ledge). */
  farBankZ: -77,
  /** Terrace tiers: [distance from the cliff ring where the tier ends, top height]. */
  tiers: [[26, 12], [52, 19], [999, 27]] as const,
  /** Far gorge bank is this much lower than the matching tier. */
  farBankDrop: 5,
  /** Bottom of the cliff columns and the river surface (well below the kill plane). */
  cliffBottom: -55, riverY: -45,
  /** Academy: centre, yaw (faces the arena), and the cell-exclusion half-extents around it. */
  academy: { x: 0, z: 74, clearX: 22, clearZ: 13 },
  /** Power line: distance behind the cliff ring and pole spacing. */
  powerLine: { offset: 8, spacing: 14, height: 9 },
  /** Distant mountains: two rings [count, radius min, radius max, height min, height max, colour]. */
  mountains: [[20, 140, 165, 40, 70, 0x7c9fa6], [26, 180, 215, 60, 110, 0x9db4c4]] as const,
  colors: {
    grass: 0x79b84a, grass2: 0x6aa843, cliff: 0xc4a684, cliffDark: 0xa98a6a, plaster: 0xefe2c4, plaster2: 0xe6d3ae,
    timber: 0x5a3a26, lacquer: 0xc8372d, roofs: [0xc8452f, 0xd9622b, 0x2f8f8a, 0xc8452f] as const,
    banners: [0xc8372d, 0x2f8f8a, 0x3b5aa8, 0xe9b949] as const, leaf: 0x5fae3f, leafLight: 0x7cc24a, leafDark: 0x3b7d33,
    tank: 0x8fb7b3, river: 0x3f95c8, wire: 0x3a2a22, lantern: 0xffb060, lantern2: 0xff7048,
  },
};

const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const pick = <T>(arr: readonly T[], r: number): T => arr[Math.floor(r * arr.length) % arr.length];

/** Unit-sized building blocks, base at y = 0. Shared with the arena dressing. */
export function makeKitGeometries() {
  // Curved gable (concave eaves, ridge along Z), 1 wide incl. overhang, 0.5 tall.
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.04);
  shape.quadraticCurveTo(-0.14, 0.06, 0, 0.5);
  shape.quadraticCurveTo(0.14, 0.06, 0.5, -0.04);
  shape.lineTo(-0.5, -0.04);
  const gable = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 5 }).translate(0, 0.04, -0.5).scale(1, 2, 1);
  const crownDark = mergeGeometries([
    new THREE.IcosahedronGeometry(1.9, 1).translate(0, 3.7, 0),
    new THREE.IcosahedronGeometry(1.4, 1).translate(1.3, 3.3, 0.6),
  ]);
  const crownLight = mergeGeometries([
    new THREE.IcosahedronGeometry(1.35, 1).translate(-0.6, 4.9, -0.3),
    new THREE.IcosahedronGeometry(1.1, 1).translate(0.7, 4.6, 0.9),
  ]);
  return {
    box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0),
    cylLow: new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0),
    cone: new THREE.ConeGeometry(1, 1, 12).translate(0, 0.5, 0),
    hip: new THREE.ConeGeometry(0.71, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
    gable,
    ball: new THREE.IcosahedronGeometry(1, 1),
    rock: new THREE.DodecahedronGeometry(1, 0),
    crownDark, crownLight,
  };
}
export type Kit = ReturnType<typeof makeKitGeometries>;

/** Builds the village ring into `group`. */
export function buildVillage(group: THREE.Group, own: <T extends { dispose(): void }>(x: T) => T, kit: Kit): void {
  const V = VILLAGE, C = V.colors, I = V.inner;
  const solid = new Batcher(), glow = new Batcher();
  const col = new THREE.Color();
  const tint = (hex: number, seed: number, amt = 0.12) => col.set(hex).multiplyScalar(1 - amt / 2 + hash(seed) * amt).clone();

  // ---- Terraced hills on a cell grid.
  const seg = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const xs = [...seg(-V.extent, -I.x, V.cellsPerBand), ...seg(-I.x, I.x, 6).slice(1), ...seg(I.x, V.extent, V.cellsPerBand).slice(1)];
  const zs = [...seg(-V.extent, I.south, V.cellsPerBand), ...seg(I.south, I.north, 6).slice(1), ...seg(I.north, V.extent, V.cellsPerBand).slice(1)];
  const tierTop = (e: number) => V.tiers.find(([d]) => e < d)![1];
  const cells: { x: number; z: number; w: number; d: number; y: number; e: number; seed: number }[] = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const x = (xs[i] + xs[i + 1]) / 2, z = (zs[j] + zs[j + 1]) / 2, w = xs[i + 1] - xs[i], d = zs[j + 1] - zs[j];
    const inPlateauX = Math.abs(x) < I.x, inPlateauZ = z > I.south && z < I.north;
    if (inPlateauX && inPlateauZ) continue;
    let e = Math.max(Math.abs(x) - I.x, z - I.north, Math.abs(x) > I.x ? I.south - z : -1);
    let y: number;
    if (inPlateauX && z < I.south) {
      if (z > V.farBankZ) continue; // the gorge under the bridge stays open
      e = V.farBankZ - z;
      y = tierTop(e) - V.farBankDrop;
    } else y = tierTop(e);
    const seed = i * 31 + j * 7;
    cells.push({ x, z, w, d, y, e, seed });
    const h = y - V.cliffBottom;
    solid.frame(x, V.cliffBottom, z)
      .put(kit.box, tint(C.cliff, seed), 0, 0, 0, w, h, d)
      .put(kit.box, tint(C.cliffDark, seed + 1), 0, h - 9 - hash(seed) * 3, 0, w + 0.3, 1.6, d + 0.3) // strata band
      .put(kit.box, tint(hash(seed + 2) > 0.5 ? C.grass : C.grass2, seed + 3, 0.08), 0, h - 0.05, 0, w + 0.2, 0.6, d + 0.2);
  }
  // River at the bottom of the gorge.
  solid.frame(0, V.riverY, (I.south + V.farBankZ) / 2).put(kit.box, C.river, 0, -1, 0, I.x * 2, 1, I.south - V.farBankZ);

  // ---- Building kits (local frame: origin on the ground, front faces local +Z).
  const lantern = (x: number, y: number, z: number, seed: number) => glow.put(kit.ball, hash(seed) > 0.5 ? C.lantern : C.lantern2, x, y, z, 0.38, 0.5, 0.38);
  const house = (w: number, d: number, floors: number, seed: number) => {
    const roof = pick(C.roofs, hash(seed)), wall = hash(seed + 1) > 0.5 ? C.plaster : C.plaster2, fh = 3.2;
    solid.put(kit.box, tint(wall, seed), 0, 0, 0, w, fh * floors, d);
    for (let f = 1; f < floors; f++) {
      solid.put(kit.box, C.timber, 0, fh * f - 0.2, 0, w + 0.25, 0.4, d + 0.25);
      solid.put(kit.box, roof, 0, fh * f + 0.2, 0, w + 1.6, 0.3, d + 1.6); // skirt roof between floors
    }
    const top = fh * floors;
    solid.put(kit.box, C.timber, 0, top - 0.1, 0, w + 0.3, 0.35, d + 0.3);
    if (hash(seed + 2) > 0.3) solid.put(kit.gable, roof, 0, top + 0.2, 0, w + 1.6, 2.4 + w * 0.15, d + 1.2, Math.PI / 2);
    else solid.put(kit.hip, roof, 0, top + 0.2, 0, w + 2, 2.6, d + 2);
    // Plain noren over the door and a paper lantern at the eave.
    solid.put(kit.box, pick(C.banners, hash(seed + 3)), 0, 1.3, d / 2 + 0.06, Math.min(2, w * 0.4), 1.2, 0.1);
    lantern(w / 2 - 0.4, top - 0.9, d / 2 + 0.5, seed);
    if (hash(seed + 4) > 0.75) { // wooden scaffold on the side
      const sx = w / 2 + 0.9, hgt = top + 0.6;
      for (const pz of [-d / 2 + 0.3, d / 2 - 0.3]) solid.put(kit.box, C.timber, sx, 0, pz, 0.25, hgt, 0.25);
      for (let k = 1; k <= 3; k++) solid.put(kit.box, C.timber, sx, (hgt * k) / 3.4, 0, 0.2, 0.2, d - 0.4);
    }
  };
  const tower = (r: number, h: number, seed: number) => {
    solid.put(kit.cyl, tint(C.plaster, seed), 0, 0, 0, r, h, r);
    solid.put(kit.cyl, C.lacquer, 0, h * 0.62, 0, r * 1.08, 0.7, r * 1.08);
    solid.put(kit.cyl, C.timber, 0, h - 0.3, 0, r * 1.12, 0.45, r * 1.12);
    solid.put(kit.cone, pick([C.roofs[0], C.roofs[1]], hash(seed)), 0, h + 0.1, 0, r * 1.55, r * 1.6, r * 1.55);
    lantern(0, h * 0.62 - 0.6, r + 0.4, seed);
  };
  const tank = (seed: number) => {
    const h = 6 + hash(seed) * 3;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) solid.put(kit.box, C.timber, sx * 1.1, 0, sz * 1.1, 0.3, h, 0.3);
    solid.put(kit.box, C.timber, 0, h * 0.5, 0, 2.6, 0.2, 2.6);
    solid.put(kit.cyl, tint(C.tank, seed), 0, h, 0, 1.7, 2.4, 1.7);
    solid.put(kit.cone, C.roofs[2], 0, h + 2.4, 0, 1.9, 1.1, 1.9);
  };
  const tree = (x: number, z: number, s: number, seed: number) => {
    solid.put(kit.cylLow, C.timber, x, 0, z, 0.35 * s, 3 * s, 0.35 * s);
    solid.put(kit.crownDark, tint(C.leaf, seed), x, 0, z, s, s, s, hash(seed) * 6);
    solid.put(kit.crownLight, tint(C.leafLight, seed + 1), x, 0, z, s, s, s, hash(seed) * 6);
  };
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.5));
    for (let k = 0; k <= n; k++) solid.put(kit.box, C.timber, x0 + ((x1 - x0) * k) / n, 0, z0 + ((z1 - z0) * k) / n, 0.22, 1.2, 0.22);
    for (const y of [0.5, 0.95]) solid.put(kit.box, C.timber, (x0 + x1) / 2, y, (z0 + z1) / 2, 0.12, 0.14, len, yaw);
  };

  // ---- Populate cells.
  const A = V.academy;
  const poleLine: THREE.Vector3[][] = [];
  for (const c of cells) {
    const r = hash(c.seed * 1.37);
    const yaw = Math.round(Math.atan2(-c.x, -c.z) / (Math.PI / 2)) * (Math.PI / 2); // face the arena, grid aligned
    solid.frame(c.x, c.y, c.z, yaw);
    glow.frame(c.x, c.y, c.z, yaw);
    if (Math.abs(c.x - A.x) < A.clearX && Math.abs(c.z - A.z) < A.clearZ) continue;
    if (c.e < 4) { // first strip behind the cliffs: trees only, they frame the ridge
      if (r < 0.7) tree(0, 0, 1.3 + hash(c.seed) * 0.6, c.seed);
      continue;
    }
    const big = c.e < 30; // nearer cells get two buildings, far ones one
    if (r < 0.5) {
      const n = big ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const s = c.seed + k * 17, w = 4.5 + hash(s) * 2.5, d = 4 + hash(s + 1) * 2;
        const off = n === 2 ? (k ? 2.8 : -2.8) : 0;
        solid.frame(c.x + Math.cos(yaw) * off, c.y, c.z - Math.sin(yaw) * off, yaw);
        glow.frame(c.x + Math.cos(yaw) * off, c.y, c.z - Math.sin(yaw) * off, yaw);
        house(w, d, 1 + Math.floor(hash(s + 2) * 2.4), s);
      }
    } else if (r < 0.62) tower(2 + hash(c.seed) * 1.2, 11 + hash(c.seed + 1) * 8, c.seed);
    else if (r < 0.7) { tank(c.seed); solid.frame(c.x + 3.5, c.y, c.z + 2, yaw); tree(0, 0, 1.1, c.seed + 5); }
    else if (r < 0.9) {
      for (let k = 0; k < 3; k++) tree((hash(c.seed + k) - 0.5) * c.w * 0.7, (hash(c.seed + k * 3) - 0.5) * c.d * 0.7, 1.2 + hash(c.seed + k * 5) * 0.8, c.seed + k);
    } else fence(-c.w * 0.35, c.d * 0.4, c.w * 0.35, c.d * 0.4);
  }

  // ---- Academy: big original hall facing the arena, round central tower, banners, fenced courtyard.
  {
    const y = cells.find((c) => Math.abs(c.x - A.x) < 8 && Math.abs(c.z - A.z) < 8)?.y ?? V.tiers[1][1];
    solid.frame(A.x, y, A.z, Math.PI); glow.frame(A.x, y, A.z, Math.PI);
    solid.put(kit.box, C.plaster, 0, 0, 0, 30, 8, 12)
      .put(kit.box, C.lacquer, 0, 3.6, 0, 30.6, 0.6, 12.6)
      .put(kit.box, C.timber, 0, 7.8, 0, 31, 0.5, 13)
      .put(kit.gable, C.roofs[0], -9, 8.2, 0, 13, 4.5, 14, 0)
      .put(kit.gable, C.roofs[0], 9, 8.2, 0, 13, 4.5, 14, 0)
      .put(kit.box, C.plaster2, 0, 8, 0, 12, 5, 9)
      .put(kit.box, C.lacquer, 0, 12.6, 0, 12.8, 0.5, 9.8)
      .put(kit.hip, C.roofs[1], 0, 13, 0, 16, 4, 12.5)
      // Central round tower in front.
      .put(kit.cyl, C.plaster, 0, 0, 7, 4, 17, 4)
      .put(kit.cyl, C.lacquer, 0, 11, 7, 4.25, 1, 4.25)
      .put(kit.cyl, C.timber, 0, 16.6, 7, 4.4, 0.6, 4.4)
      .put(kit.cone, C.roofs[0], 0, 17, 7, 6, 5.5, 6)
      .put(kit.cyl, C.lacquer, 0, 22.3, 7, 0.25, 1.5, 0.25);
    for (const bx of [-12, -6, 6, 12]) solid.put(kit.box, pick(C.banners, hash(bx + 50)), bx, 1.5, 6.1, 1.8, 5.5, 0.15);
    for (const lx of [-14, -4, 4, 14]) glow.put(kit.ball, C.lantern2, lx, 7.2, 6.8, 0.5, 0.65, 0.5);
    fence(-15, 13, -5, 13); fence(5, 13, 15, 13);
  }

  // ---- Power line on poles running behind the cliff ring (north, east and west), wires sag between poles.
  {
    const P = V.powerLine, o = I.x + P.offset, n = I.north + P.offset;
    const route: [number, number][] = [[-o, I.south - 4], [-o, n], [o, n], [o, I.south - 4]];
    const poles: THREE.Vector3[] = [];
    for (let k = 0; k < route.length - 1; k++) {
      const [x0, z0] = route[k], [x1, z1] = route[k + 1], len = Math.hypot(x1 - x0, z1 - z0), m = Math.round(len / P.spacing);
      for (let s = k ? 1 : 0; s <= m; s++) {
        const x = x0 + ((x1 - x0) * s) / m, z = z0 + ((z1 - z0) * s) / m;
        const y = tierTop(Math.max(Math.abs(x) - I.x, z - I.north));
        poles.push(new THREE.Vector3(x, y, z));
      }
    }
    solid.frame(0, 0, 0);
    for (const p of poles) {
      solid.put(kit.cylLow, C.timber, p.x, p.y, p.z, 0.2, P.height, 0.2).put(kit.box, C.timber, p.x, p.y + P.height - 0.8, p.z, 1.8, 0.18, 0.18, Math.atan2(p.x, p.z));
    }
    poleLine.push(poles);
  }
  const wirePts: number[] = [];
  for (const poles of poleLine) for (let k = 0; k < poles.length - 1; k++) {
    const a = poles[k], b = poles[k + 1];
    for (const side of [-0.75, 0.75]) {
      const yaw = Math.atan2(a.x, a.z), ox = Math.cos(yaw) * side, oz = -Math.sin(yaw) * side;
      const steps = 8;
      for (let s = 0; s < steps; s++) for (const t of [s / steps, (s + 1) / steps]) {
        const sag = 4 * t * (1 - t) * 1.2;
        wirePts.push(a.x + (b.x - a.x) * t + ox, a.y + (b.y - a.y) * t + V.powerLine.height - 0.75 - sag, a.z + (b.z - a.z) * t + oz);
      }
    }
  }
  const wires = new THREE.LineSegments(
    own(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3))),
    own(new THREE.LineBasicMaterial({ color: C.wire })),
  );
  group.add(wires);

  // ---- Distant mountains: cool and desaturated, the fog adds the aerial perspective.
  solid.frame(0, 0, 0);
  V.mountains.forEach(([count, r0, r1, h0, h1, color], ring) => {
    for (let i = 0; i < count; i++) {
      const s = ring * 100 + i, a = (i / count) * Math.PI * 2 + hash(s) * 0.25, r = r0 + hash(s * 7) * (r1 - r0), h = h0 + hash(s * 3) * (h1 - h0);
      solid.put(kit.cone, tint(color, s, 0.08), Math.cos(a) * r, -30, Math.sin(a) * r, h * 0.85, h + 30, h * 0.85, a);
    }
  });

  const villageMat = own(toon(0xffffff));
  for (const im of solid.build(villageMat)) { group.add(im); own(im); }
  const glowMat = own(glowMaterial(0xffffff, 2.4));
  for (const im of glow.build(glowMat)) { group.add(im); own(im); }
}
