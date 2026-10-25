import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Batcher } from './Batcher';
import { heightAt, lerp, WORLD } from './terrain';

/**
 * Man-made touches in the coastal valley: a small hamlet on the wooded plateau, a red arched bridge over the
 * stream next to the spawn meadow, a torii on the big islet and stone lanterns. Original designs only.
 */
export const VILLAGE = {
  /** Hamlet houses on the plateau: [x, z, width, depth, floors]; they face the valley (−X). */
  houses: [[74, -26, 6, 5, 2], [80, -10, 7, 5.5, 1], [75, 6, 5.5, 5, 2], [88, -20, 5, 4.5, 1]] as [number, number, number, number, number][],
  floorHeight: 3.2,
  /** Arched bridge: stream index, point it should be nearest to, width, arch height, extra length past the banks. */
  bridge: { stream: 1, near: [14, -36] as [number, number], width: 3, arch: 1.6, overhang: 3.5, segments: 16, thickness: 0.35 },
  /** Torii on an islet: [x, z, yaw]. */
  torii: [-20, 22, 0] as [number, number, number],
  /** Stone lanterns (tōrō): [x, z]. */
  stoneLanterns: [[-23, 18.5], [-17, 18.5], [70, -16], [70, 0]] as [number, number][],
  colors: {
    plaster: 0xefe2c4, plaster2: 0xe6d3ae, timber: 0x5a3a26, lacquer: 0xc8372d, roofs: [0xc8452f, 0xd9622b, 0x2f8f8a] as const,
    banners: [0xc8372d, 0x2f8f8a, 0x3b5aa8, 0xe9b949] as const, deck: 0xb5844f, stone: 0xa7aaa8, lantern: 0xffb060, lantern2: 0xff7048,
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

/** What the hamlet builder needs from the arena (batched parts, colliders, obstacle registry). */
export interface Placer {
  solid: Batcher;
  glow: Batcher;
  kit: Kit;
  box(c: THREE.Vector3, half: THREE.Vector3, rotY: number, climbable?: boolean): void;
  cyl(c: THREE.Vector3, halfHeight: number, radius: number): void;
  /** Adds a lit mesh of a single colour; `collide` also makes it a static trimesh collider. */
  mesh(geo: THREE.BufferGeometry, color: number, collide: boolean): void;
  /** Keeps scatter (trees, rocks, spawns) away from a circle. */
  block(x: number, z: number, r: number): void;
}

/** Builds the hamlet, bridge, torii and stone lanterns. */
export function buildVillage(P: Placer): void {
  const V = VILLAGE, C = V.colors, { solid, glow, kit } = P;
  const col = new THREE.Color();
  const tint = (hex: number, seed: number, amt = 0.12) => col.set(hex).multiplyScalar(1 - amt / 2 + hash(seed) * amt).clone();

  // ---- Houses (walls collide and are climbable; roofs are decorative).
  V.houses.forEach(([x, z, w, d, floors], i) => {
    const seed = i * 17 + 3, yaw = -Math.PI / 2, fh = V.floorHeight;
    let y = Infinity;
    for (const [dx, dz] of [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) y = Math.min(y, heightAt(x + dx, z + dz));
    const roof = pick(C.roofs, hash(seed)), wall = hash(seed + 1) > 0.5 ? C.plaster : C.plaster2, top = fh * floors;
    solid.frame(x, y - 1, z, yaw); glow.frame(x, y - 1, z, yaw);
    solid.put(kit.box, tint(wall, seed), 0, 0, 0, w, top + 1, d);
    solid.put(kit.box, C.timber, 0, 0, 0, w + 0.3, 1.25, d + 0.3); // stone/timber footing
    for (let f = 1; f < floors; f++) {
      solid.put(kit.box, C.timber, 0, 1 + fh * f - 0.2, 0, w + 0.25, 0.4, d + 0.25);
      solid.put(kit.box, roof, 0, 1 + fh * f + 0.2, 0, w + 1.6, 0.3, d + 1.6);
    }
    solid.put(kit.box, C.timber, 0, top + 0.9, 0, w + 0.3, 0.35, d + 0.3);
    if (hash(seed + 2) > 0.3) solid.put(kit.gable, roof, 0, top + 1.2, 0, w + 1.6, 2.4 + w * 0.15, d + 1.2, Math.PI / 2);
    else solid.put(kit.hip, roof, 0, top + 1.2, 0, w + 2, 2.6, d + 2);
    solid.put(kit.box, pick(C.banners, hash(seed + 3)), 0, 2.3, d / 2 + 0.06, Math.min(2, w * 0.4), 1.2, 0.1);
    glow.put(kit.ball, hash(seed) > 0.5 ? C.lantern : C.lantern2, w / 2 - 0.4, top + 0.1, d / 2 + 0.5, 0.38, 0.5, 0.38);
    const H = top + 1.2;
    P.box(new THREE.Vector3(x, y + H / 2, z), new THREE.Vector3(w / 2, H / 2, d / 2), yaw, true);
    P.block(x, z, Math.hypot(w, d) / 2 + 1.5);
  });

  // ---- Arched bridge over the stream next to the spawn meadow (deck is a trimesh collider; rails decorative).
  {
    const B = V.bridge, s = WORLD.streams[B.stream];
    let best = Infinity, cx = 0, cz = 0, tx = 1, tz = 0, at = 0;
    for (let i = 0; i < s.length - 1; i++) {
      const [ax, az] = s[i], [bx, bz] = s[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = Math.min(1, Math.max(0, ((B.near[0] - ax) * dx + (B.near[1] - az) * dz) / l2));
      const px = ax + dx * t, pz = az + dz * t, dd = Math.hypot(B.near[0] - px, B.near[1] - pz);
      if (dd < best) { best = dd; cx = px; cz = pz; const l = Math.sqrt(l2); tx = dx / l; tz = dz / l; at = (i + t) / (s.length - 1); }
    }
    const dirX = -tz, dirZ = tx; // across the stream
    const len = 2 * (lerp(WORLD.streamHalf[0], WORLD.streamHalf[1], at) * 1.3 + B.overhang);
    const hA = heightAt(cx - dirX * len / 2, cz - dirZ * len / 2), hB = heightAt(cx + dirX * len / 2, cz + dirZ * len / 2);
    const n = B.segments, hw = B.width / 2, yawB = Math.atan2(-dirZ, dirX);
    const pts = Array.from({ length: n + 1 }, (_, k) => { const t = k / n; return [t * len - len / 2, lerp(hA, hB, t) + B.arch * Math.sin(Math.PI * t) + 0.05] as const; });
    // Deck slab in world space: top and bottom ribbons + sides.
    const pos: number[] = [], idx: number[] = [];
    const ox = dirX, oz = dirZ, sx = -dirZ, sz = dirX; // along / side axes
    for (const [u, y] of pts) for (const [side, dy] of [[-hw, 0], [hw, 0], [-hw, -B.thickness], [hw, -B.thickness]]) {
      pos.push(cx + ox * u + sx * side, y + dy, cz + oz * u + sz * side);
    }
    for (let k = 0; k < n; k++) {
      const a = k * 4, b = a + 4;
      idx.push(a, a + 1, b, a + 1, b + 1, b); // top
      idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3); // bottom
      idx.push(a, b, a + 2, a + 2, b, b + 2); // side
      idx.push(a + 1, a + 3, b + 1, a + 3, b + 3, b + 1); // side
    }
    const e = n * 4;
    idx.push(0, 1, 2, 1, 3, 2, e, e + 2, e + 1, e + 1, e + 2, e + 3);
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    indexed.setIndex(idx);
    const deck = indexed.toNonIndexed(); // flat-shaded planks
    indexed.dispose();
    deck.computeVertexNormals();
    P.mesh(deck, C.deck, true);
    solid.frame(cx, 0, cz, yawB);
    for (let k = 0; k <= n; k += 2) for (const z of [-hw - 0.05, hw + 0.05]) {
      const [u, y] = pts[k];
      solid.put(kit.box, C.lacquer, u, y - 0.2, z, 0.18, 1.25, 0.18);
      if (k < n) {
        const [u1, y1] = pts[k + 2], l = Math.hypot(u1 - u, y1 - y);
        solid.put(kit.box, C.lacquer, (u + u1) / 2, (y + y1) / 2 + 0.95, z, l + 0.1, 0.12, 0.16, 0, Math.atan2(y1 - y, u1 - u));
      }
    }
  }

  // ---- Torii on the islet (posts collide).
  {
    const [x, z, yaw] = V.torii, y = heightAt(x, z) - 0.3;
    solid.frame(x, y, z, yaw)
      .put(kit.cyl, C.lacquer, -2.6, 0, 0, 0.3, 5, 0.3).put(kit.cyl, C.lacquer, 2.6, 0, 0, 0.3, 5, 0.3)
      .put(kit.box, C.lacquer, 0, 3.6, 0, 6, 0.3, 0.35).put(kit.box, C.lacquer, 0, 4.5, 0, 7.4, 0.35, 0.5)
      .put(kit.box, C.timber, 0, 4.85, 0, 8.2, 0.3, 0.8);
    for (const sx of [-2.6, 2.6]) P.cyl(new THREE.Vector3(x + Math.cos(yaw) * sx, y + 2.5, z - Math.sin(yaw) * sx), 2.5, 0.32);
    P.block(x, z, 5);
  }

  // ---- Stone lanterns with a warm glowing fire box.
  for (const [x, z] of V.stoneLanterns) {
    const y = heightAt(x, z) - 0.1;
    solid.frame(x, y, z, 0)
      .put(kit.box, C.stone, 0, 0, 0, 0.9, 0.3, 0.9).put(kit.cylLow, C.stone, 0, 0.3, 0, 0.22, 0.8, 0.22)
      .put(kit.box, C.stone, 0, 1.1, 0, 0.7, 0.15, 0.7).put(kit.box, C.stone, 0, 1.25, 0, 0.55, 0.45, 0.55)
      .put(kit.hip, C.stone, 0, 1.68, 0, 1.15, 0.5, 1.15).put(kit.ball, C.stone, 0, 2.25, 0, 0.14, 0.14, 0.14);
    glow.frame(x, y, z, 0).put(kit.box, C.lantern, 0, 1.33, 0, 0.58, 0.28, 0.4).put(kit.box, C.lantern, 0, 1.33, 0, 0.4, 0.28, 0.58);
    P.cyl(new THREE.Vector3(x, y + 1.1, z), 1.1, 0.45);
    P.block(x, z, 1.5);
  }
}
