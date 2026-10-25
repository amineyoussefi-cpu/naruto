import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { toon } from '../render/toon';
import { glowMaterial } from '../render/PostFX';
import { Batcher } from './Batcher';
import { buildSky, SKY } from './Sky';
import { buildVillage, makeKitGeometries } from './Village';

export interface ArenaInfo {
  playerSpawn: THREE.Vector3;
  enemySpawns: THREE.Vector3[];
  dispose(): void;
}

/**
 * Arena layout (metres). Plateau top is y = 0, spanning x ∈ [-35, 35], z ∈ [-26, 35].
 * The south edge opens onto a chasm crossed by a rope bridge to a small shrine ledge (fall zone).
 */
const LAYOUT = {
  plateau: { minX: -35, maxX: 35, minZ: -26, maxZ: 35, depth: 12 },
  wallThickness: 2,
  wallSegment: 8,
  /** Gap in the south wall that leads to the bridge (|x| < this). */
  southOpening: 10,
  bridge: { halfWidth: 1.5, fromZ: -26, toZ: -40, thickness: 0.3 },
  ledge: { halfX: 9, minZ: -54, maxZ: -40 },
  /** Climbable rock pillars: [x, z, sizeX|radius, height, sizeZ (0 = cylinder), rotY]. */
  pillars: [
    [12, 10, 4, 8, 4, 0.3], [-14, 8, 2.5, 9, 0, 0], [-20, -14, 5, 12, 5, 0.5], [0, 24, 3, 7, 0, 0],
    [24, 18, 4, 10, 6, -0.2], [-25, 22, 2.2, 5, 0, 0], [16, -14, 4, 6, 4, 0],
  ] as const,
  /** Climbable training wall: [x, z, width, height, thickness]. */
  trainingWall: [-6, -8, 8, 4, 1.2] as const,
  /** Terraces (stone base + wooden deck, climbable): [x, z, size, topY]. A→B→pillar form a jump chain. */
  terraces: [[4, -14, 6, 2], [10, -14, 6, 4], [-12, -15, 5, 7]] as const,
  crates: [[6, 4, 0], [7.1, 4.2, 0], [6.5, 4.1, 1], [-8, 14, 0], [-8, 15.1, 0], [-9.1, 14.4, 0], [-8.5, 14.6, 1], [20, -2, 0], [20.2, -3.1, 0], [-24, -2, 0]] as const,
  crateSize: 1,
  /** Logs: [x, z, rotY], radius / length below. */
  logs: [[-3, 11, 0.6], [14, -4, 1.2], [-18, 0, 0.2], [22, 6, 2.0]] as const,
  logRadius: 0.35, logLength: 3,
  posts: [[-5, 5], [-3.5, 6.5], [5, -5], [6.5, -3.5]] as const,
  postRadius: 0.18, postHeight: 1.6,
  trees: [[-30, 30], [-22, 31.5], [30, 30], [31, 10], [-31, 0], [-30, -18], [30, -21], [14, 31], [-12, 31.5], [31.5, -8], [-31.5, 14]] as const,
  trunkRadius: 0.32, trunkHeight: 3,
  playerSpawn: [0, 0.1, 0] as const,
  enemySpawns: [[-26, -22], [25, -22], [28, 4], [-28, 10], [-12, 26], [12, 26], [-2, -21], [28, 28]] as const,
  /** Stone lanterns (tōrō) along the bridge path and by the shrine gate: [x, z]; collider radius. */
  stoneLanterns: [[-4, -19.5], [4, -19.5], [-4, -24.5], [4, -24.5], [-4.4, -45], [4.4, -45]] as const,
  stoneLanternRadius: 0.45,
  /** Wooden poles carrying paper-lantern strings along the north and west cliffs: [x, z]; height, collider radius. */
  lanternPoles: [[-24, 32.5], [-8, 32.5], [8, 32.5], [24, 32.5], [-32.5, 20], [-32.5, 4], [-32.5, -12]] as const,
  lanternPoleHeight: 6, lanternPoleRadius: 0.16,
  /** Paper lanterns per string and string sag (m). */
  lanternsPerString: 6, lanternSag: 1.4,
  /** Extra dirt paths (visual): [x, z, width, length, rotY]. */
  paths: [[14, 4, 2.6, 16, 1.3], [-15, 6, 2.6, 18, -1.1], [0, 16, 2.4, 14, 0]] as const,
  /** Lighting / atmosphere. */
  sunDir: [30, 50, 22] as const, sunColor: 0xfff1d6, sunIntensity: 2.5, hemiSky: 0xbfe0ff, hemiGround: 0x6d8a4a, hemiIntensity: 2.4,
  shadowExtent: 46, shadowMapSize: 2048,
  fogNear: 80, fogFar: 260,
  colors: {
    grass: 0x79b84a, dirt: 0xd9b77a, rock: 0xc4a684, rockDark: 0xa98a6a, stone: 0xa39a8a, wood: 0x9a6a3e, timber: 0x5a3a26, deck: 0xb5844f,
    crate: 0xc29055, leaves: 0x5fae3f, leavesLight: 0x7cc24a, rope: 0xe0c890, torii: 0xc8372d, straw: 0xe6c97a,
    lantern: 0xffb060, lantern2: 0xff7048, wire: 0x3a2a22,
  },
};

/** Deterministic hash in [0,1) so the arena looks the same on every run. */
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/**
 * Builds the arena (meshes + static colliders), sky and lights.
 * Climbable surfaces are created with `{ climbable: true }`.
 */
export function buildArena(scene: THREE.Scene, physics: PhysicsWorld): ArenaInfo {
  const L = LAYOUT, C = L.colors;
  const group = new THREE.Group();
  group.name = 'arena';
  scene.add(group);
  const disposables: { dispose(): void }[] = [];
  const colliders: RAPIER.Collider[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };
  const box = (c: THREE.Vector3, half: THREE.Vector3, rot = 0, climbable = false) => colliders.push(physics.addStaticBox(c, half, rot, { climbable }));
  const cyl = (c: THREE.Vector3, hh: number, r: number, climbable = false) => colliders.push(physics.addStaticCylinder(c, hh, r, { climbable }));
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], cast = true, receive = true) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = cast; m.receiveShadow = receive;
    group.add(m);
    return m;
  };

  const mat = {
    grass: own(toon(C.grass)), dirt: own(toon(C.dirt)), rock: own(toon(C.rock)), rockDark: own(toon(C.rockDark)),
    wood: own(toon(C.wood)), deck: own(toon(C.deck)), crate: own(toon(C.crate)), leaves: own(toon(C.leaves)),
    leavesLight: own(toon(C.leavesLight)), rope: own(toon(C.rope)), torii: own(toon(C.torii)), timber: own(toon(C.timber)),
    white: own(toon(0xffffff)), ground: own(toon(C.grass, { rim: 0 })), path: own(toon(C.dirt, { rim: 0 })),
  };
  const unitBox = own(new THREE.BoxGeometry(1, 1, 1));
  const kit = makeKitGeometries();
  Object.values(kit).forEach(own);
  /** Decorative instanced parts (white material, colour per instance) and glowing lanterns. */
  const deco = new Batcher(), glow = new Batcher();

  // --- Ground slabs (grass top, rock sides): plateau and far ledge.
  const slab = (minX: number, maxX: number, minZ: number, maxZ: number, depth: number) => {
    const half = new THREE.Vector3((maxX - minX) / 2, depth / 2, (maxZ - minZ) / 2);
    const c = new THREE.Vector3((minX + maxX) / 2, -depth / 2, (minZ + maxZ) / 2);
    const m = add(unitBox, [mat.rock, mat.rock, mat.ground, mat.rock, mat.rock, mat.rock], false, true);
    m.position.copy(c);
    m.scale.set(half.x * 2, depth, half.z * 2);
    box(c, half);
  };
  const P = L.plateau;
  slab(P.minX, P.maxX, P.minZ, P.maxZ, P.depth);
  slab(-L.ledge.halfX, L.ledge.halfX, L.ledge.minZ, L.ledge.maxZ, P.depth * 0.6);

  // Training circle and a dirt path towards the bridge (visual only).
  const circle = add(own(new THREE.CircleGeometry(8, 40).rotateX(-Math.PI / 2)), mat.path, false, true);
  circle.position.y = 0.015;
  const pathGeo = own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const path = add(pathGeo, mat.path, false, true);
  path.position.set(0, 0.012, -17); path.scale.set(3.2, 1, 18);
  for (const [x, z, w, len, rot] of L.paths) {
    const p = add(pathGeo, mat.path, false, true);
    p.position.set(x, 0.01, z); p.scale.set(w, 1, len); p.rotation.y = rot;
  }

  // --- Outer climbable cliff ring (instanced segments with an outward boulder cap).
  const wallBoxes: { c: THREE.Vector3; s: THREE.Vector3; rot: number; collide: boolean }[] = [];
  const t = L.wallThickness;
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / L.wallSegment));
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const rot = Math.atan2(-uz, ux); // box local X along the run
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n;
      const h = 9 + Math.round(hash(x0 + z0 * 7 + i * 13) * 4);
      const cx = x0 + (x1 - x0) * k, cz = z0 + (z1 - z0) * k;
      const segLen = len / n + 0.4;
      wallBoxes.push({ c: new THREE.Vector3(cx, h / 2, cz), s: new THREE.Vector3(segLen, h, t), rot, collide: true });
      // Outward cap: points away from the arena centre, no collider (unreachable behind the wall).
      const ox = -uz, oz = ux;
      const sign = ox * cx + oz * cz > 0 ? 1 : -1;
      const ch = h + 1 + hash(i + x1) * 2.5;
      wallBoxes.push({ c: new THREE.Vector3(cx + ox * sign * 1.6, ch / 2, cz + oz * sign * 1.6), s: new THREE.Vector3(segLen * 0.7, ch, 2.4), rot: rot + (hash(i * 3 + z1) - 0.5) * 0.3, collide: false });
    }
  };
  const W = P.maxX + t / 2;
  run(-W, P.maxZ + t / 2, W, P.maxZ + t / 2); // north
  run(W, P.minZ - t / 2, W, P.maxZ + t / 2); // east
  run(-W, P.minZ - t / 2, -W, P.maxZ + t / 2); // west
  run(-W, P.minZ - t / 2, -L.southOpening, P.minZ - t / 2); // south-west
  run(L.southOpening, P.minZ - t / 2, W, P.minZ - t / 2); // south-east
  const walls = new THREE.InstancedMesh(unitBox, mat.white, wallBoxes.length);
  walls.castShadow = true; walls.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  wallBoxes.forEach((b, i) => {
    walls.setMatrixAt(i, m4.compose(b.c, q.setFromAxisAngle(yAxis, b.rot), b.s));
    walls.setColorAt(i, col.set(b.collide ? C.rock : C.rockDark).multiplyScalar(0.92 + hash(i) * 0.14));
    if (b.collide) box(b.c, b.s.clone().multiplyScalar(0.5), b.rot, true);
    // Visual strata: darker bands, a grass lip on top and a chunky boulder on the outer ridge.
    deco.frame(b.c.x, 0, b.c.z, b.rot);
    const bands = b.collide ? [0.32, 0.68] : [0.5];
    for (const k of bands) deco.put(kit.box, col.set(C.rockDark).multiplyScalar(0.95 + hash(i + k) * 0.1), 0, b.s.y * k, 0, b.s.x * 0.995, 1.1 + hash(i * 2) * 0.6, b.s.z + 0.24);
    deco.put(kit.box, col.set(C.grass).multiplyScalar(0.95 + hash(i * 5) * 0.1), 0, b.s.y - 0.2, 0, b.s.x + 0.2, 0.25, b.s.z + 0.2);
    if (!b.collide) deco.put(kit.rock, col.set(C.rock), (hash(i * 7) - 0.5) * b.s.x * 0.5, b.s.y + 0.3, 0, 1.6 + hash(i) * 1.2, 1.2 + hash(i * 3), 1.6 + hash(i * 9), hash(i) * 3);
  });
  group.add(walls);
  disposables.push(walls);

  // --- Rock pillars (climbable, flat walkable tops).
  const pillarCyl = own(new THREE.CylinderGeometry(1, 1.12, 1, 8));
  pillarCyl.translate(0, 0.5, 0);
  const capGeo = own(new THREE.CylinderGeometry(1.04, 1, 0.25, 8));
  for (const [x, z, sx, h, sz, rot] of L.pillars) {
    if (sz === 0) {
      const m = add(pillarCyl, mat.rock);
      m.position.set(x, 0, z); m.scale.set(sx, h, sx); m.rotation.y = hash(x) * 2;
      const cap = add(capGeo, mat.grass, false);
      cap.position.set(x, h + 0.02, z); cap.scale.set(sx, 1, sx);
      cyl(new THREE.Vector3(x, h / 2, z), h / 2, sx, true);
    } else {
      const m = add(unitBox, mat.rock);
      m.position.set(x, h / 2, z); m.scale.set(sx, h, sz); m.rotation.y = rot;
      const cap = add(unitBox, mat.grass, false);
      cap.position.set(x, h + 0.05, z); cap.scale.set(sx + 0.15, 0.12, sz + 0.15); cap.rotation.y = rot;
      box(new THREE.Vector3(x, h / 2, z), new THREE.Vector3(sx / 2, h / 2, sz / 2), rot, true);
    }
  }
  {
    const [x, z, w, h, d] = L.trainingWall;
    const m = add(unitBox, mat.rockDark);
    m.position.set(x, h / 2, z); m.scale.set(w, h, d);
    box(new THREE.Vector3(x, h / 2, z), new THREE.Vector3(w / 2, h / 2, d / 2), 0, true);
    // Painted target marks on the wall (visual only).
    for (let i = -1; i <= 1; i++) {
      const mark = add(own(new THREE.RingGeometry(0.35, 0.5, 20)), mat.torii, false, false);
      mark.position.set(x + i * 2.4, h * 0.55, z + d / 2 + 0.01);
    }
  }
  // Terraces: stone base + wooden deck.
  for (const [x, z, s, top] of L.terraces) {
    const base = add(unitBox, mat.rockDark);
    base.position.set(x, (top - 0.3) / 2, z); base.scale.set(s, top - 0.3, s);
    const deck = add(unitBox, mat.deck);
    deck.position.set(x, top - 0.15, z); deck.scale.set(s + 0.3, 0.3, s + 0.3);
    box(new THREE.Vector3(x, top / 2, z), new THREE.Vector3(s / 2 + 0.15, top / 2, s / 2 + 0.15), 0, true);
  }

  // --- Low obstacles (instanced): crates, logs, training posts.
  const cs = L.crateSize;
  const crates = new THREE.InstancedMesh(unitBox, mat.crate, L.crates.length);
  crates.castShadow = crates.receiveShadow = true;
  L.crates.forEach(([x, z, layer], i) => {
    const c = new THREE.Vector3(x, cs / 2 + layer * cs, z);
    const rot = hash(i * 5) * 0.6;
    crates.setMatrixAt(i, m4.compose(c, q.setFromAxisAngle(yAxis, rot), new THREE.Vector3(cs, cs, cs)));
    box(c, new THREE.Vector3(cs / 2, cs / 2, cs / 2), rot);
  });
  group.add(crates); disposables.push(crates);

  const logGeo = own(new THREE.CylinderGeometry(L.logRadius, L.logRadius, L.logLength, 8).rotateZ(Math.PI / 2));
  const logs = new THREE.InstancedMesh(logGeo, mat.wood, L.logs.length);
  logs.castShadow = logs.receiveShadow = true;
  L.logs.forEach(([x, z, rot], i) => {
    const c = new THREE.Vector3(x, L.logRadius, z);
    logs.setMatrixAt(i, m4.compose(c, q.setFromAxisAngle(yAxis, rot), new THREE.Vector3(1, 1, 1)));
    box(c, new THREE.Vector3(L.logLength / 2, L.logRadius, L.logRadius), rot);
  });
  group.add(logs); disposables.push(logs);

  const postGeo = own(new THREE.CylinderGeometry(L.postRadius, L.postRadius * 1.1, L.postHeight, 8).translate(0, L.postHeight / 2, 0));
  const armGeo = own(new THREE.BoxGeometry(0.9, 0.12, 0.12).translate(0, L.postHeight * 0.7, 0));
  const posts = new THREE.InstancedMesh(postGeo, mat.wood, L.posts.length);
  const arms = new THREE.InstancedMesh(armGeo, mat.wood, L.posts.length);
  posts.castShadow = arms.castShadow = true;
  L.posts.forEach(([x, z], i) => {
    m4.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(yAxis, hash(i + 9) * Math.PI), new THREE.Vector3(1, 1, 1));
    posts.setMatrixAt(i, m4); arms.setMatrixAt(i, m4);
    // Straw-wrapped training dummy body and head (visual).
    deco.frame(x, 0, z, hash(i + 9) * Math.PI)
      .put(kit.cylLow, C.straw, 0, 0.45, 0, L.postRadius * 1.6, 0.75, L.postRadius * 1.6)
      .put(kit.cylLow, C.rope, 0, 0.75, 0, L.postRadius * 1.7, 0.12, L.postRadius * 1.7)
      .put(kit.ball, C.straw, 0, L.postHeight + 0.12, 0, 0.24, 0.26, 0.24);
    cyl(new THREE.Vector3(x, L.postHeight / 2, z), L.postHeight / 2, L.postRadius);
  });
  group.add(posts, arms); disposables.push(posts, arms);

  // --- Trees (trunk collider) and decorative scatter (no colliders).
  const trunkGeo = own(new THREE.CylinderGeometry(L.trunkRadius * 0.7, L.trunkRadius, L.trunkHeight, 6).translate(0, L.trunkHeight / 2, 0));
  const trunks = new THREE.InstancedMesh(trunkGeo, mat.wood, L.trees.length);
  const crowns = new THREE.InstancedMesh(kit.crownDark, mat.leaves, L.trees.length);
  const crowns2 = new THREE.InstancedMesh(kit.crownLight, mat.leavesLight, L.trees.length);
  for (const im of [trunks, crowns, crowns2]) im.castShadow = true;
  L.trees.forEach(([x, z], i) => {
    const s = 0.9 + hash(i * 11) * 0.5;
    m4.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(yAxis, hash(i) * 6), new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4); crowns.setMatrixAt(i, m4); crowns2.setMatrixAt(i, m4);
    cyl(new THREE.Vector3(x, (L.trunkHeight * s) / 2, z), (L.trunkHeight * s) / 2, L.trunkRadius * s);
  });
  group.add(trunks, crowns, crowns2); disposables.push(trunks, crowns, crowns2);

  const tuftGeo = own(new THREE.ConeGeometry(0.12, 0.45, 4).translate(0, 0.2, 0));
  const tufts = new THREE.InstancedMesh(tuftGeo, mat.leavesLight, 340);
  const pebbleGeo = own(new THREE.DodecahedronGeometry(0.4, 0));
  const pebbles = new THREE.InstancedMesh(pebbleGeo, mat.rock, 40);
  pebbles.castShadow = true; pebbles.receiveShadow = true;
  const scatter = (im: THREE.InstancedMesh, seed: number, scaleMin: number, scaleVar: number) => {
    for (let i = 0; i < im.count; i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 6; tries++) {
        x = P.minX + 2 + hash(seed + i * 2.13 + tries) * (P.maxX - P.minX - 4);
        z = P.minZ + 2 + hash(seed + i * 3.71 + tries * 7) * (P.maxZ - P.minZ - 4);
        if (Math.hypot(x, z) > 9 && Math.abs(x) > 2.5) break; // keep the centre circle and path clear
      }
      const s = scaleMin + hash(seed + i) * scaleVar;
      im.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(yAxis, hash(i + seed) * 6), new THREE.Vector3(s, s * (0.6 + hash(i * 0.7) * 0.8), s)));
    }
  };
  scatter(tufts, 17, 0.7, 0.8);
  scatter(pebbles, 53, 0.4, 0.9);
  group.add(tufts, pebbles); disposables.push(tufts, pebbles);

  // --- Rope bridge over the chasm (rails are visual only, so the player can fall off).
  const B = L.bridge;
  const bLen = B.fromZ - B.toZ;
  const bc = new THREE.Vector3(0, -B.thickness / 2, (B.fromZ + B.toZ) / 2);
  const planks = new THREE.InstancedMesh(unitBox, mat.deck, Math.floor(bLen / 0.5));
  planks.castShadow = planks.receiveShadow = true;
  for (let i = 0; i < planks.count; i++) {
    const z = B.fromZ - 0.25 - i * 0.5;
    planks.setMatrixAt(i, m4.compose(new THREE.Vector3(0, -B.thickness / 2, z), q.setFromAxisAngle(yAxis, (hash(i) - 0.5) * 0.06), new THREE.Vector3(B.halfWidth * 2, B.thickness, 0.44)));
    planks.setColorAt(i, col.set(0xffffff).multiplyScalar(0.8 + hash(i * 3) * 0.3));
  }
  group.add(planks); disposables.push(planks);
  box(bc, new THREE.Vector3(B.halfWidth, B.thickness / 2, bLen / 2));
  const ropePostGeo = own(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6).translate(0, 0.6, 0));
  const nPosts = 5;
  const ropePosts = new THREE.InstancedMesh(ropePostGeo, mat.wood, nPosts * 2);
  ropePosts.castShadow = true;
  for (let i = 0; i < nPosts; i++) for (const sx of [-1, 1]) {
    const z = B.fromZ - (i / (nPosts - 1)) * bLen;
    ropePosts.setMatrixAt(i * 2 + (sx > 0 ? 1 : 0), m4.makeTranslation(sx * (B.halfWidth + 0.05), 0, z));
  }
  group.add(ropePosts); disposables.push(ropePosts);
  const ropeGeo = own(new THREE.CylinderGeometry(0.03, 0.03, bLen, 4).rotateX(Math.PI / 2));
  for (const sx of [-1, 1]) {
    const rope = add(ropeGeo, mat.rope, false, false);
    rope.position.set(sx * (B.halfWidth + 0.05), 1.05, bc.z);
  }

  // --- Shrine gate on the far ledge (posts collide, beams decorative).
  const gz = (L.ledge.minZ + L.ledge.maxZ) / 2 - 2;
  const gatePost = own(new THREE.CylinderGeometry(0.28, 0.32, 5, 8).translate(0, 2.5, 0));
  for (const sx of [-1, 1]) {
    add(gatePost, mat.torii).position.set(sx * 2.6, 0, gz);
    cyl(new THREE.Vector3(sx * 2.6, 2.5, gz), 2.5, 0.3);
  }
  const beam = add(unitBox, mat.torii); beam.position.set(0, 4.6, gz); beam.scale.set(7.4, 0.35, 0.5);
  const beam2 = add(unitBox, mat.torii); beam2.position.set(0, 3.7, gz); beam2.scale.set(6, 0.25, 0.35);
  const top = add(unitBox, mat.timber); top.position.set(0, 5.0, gz); top.scale.set(8.2, 0.3, 0.8);

  // --- Stone lanterns (small colliders, kept off the path and the bridge) with a warm glowing fire box.
  for (const [x, z] of L.stoneLanterns) {
    deco.frame(x, 0, z, 0)
      .put(kit.box, C.stone, 0, 0, 0, 0.9, 0.3, 0.9)
      .put(kit.cylLow, C.stone, 0, 0.3, 0, 0.22, 0.8, 0.22)
      .put(kit.box, C.stone, 0, 1.1, 0, 0.7, 0.15, 0.7)
      .put(kit.box, C.stone, 0, 1.25, 0, 0.55, 0.45, 0.55)
      .put(kit.hip, C.stone, 0, 1.68, 0, 1.15, 0.5, 1.15)
      .put(kit.ball, C.stone, 0, 2.25, 0, 0.14, 0.14, 0.14);
    glow.frame(x, 0, z, 0).put(kit.box, C.lantern, 0, 1.33, 0, 0.58, 0.28, 0.4).put(kit.box, C.lantern, 0, 1.33, 0, 0.4, 0.28, 0.58);
    cyl(new THREE.Vector3(x, 1.1, z), 1.1, L.stoneLanternRadius);
  }

  // --- Paper-lantern strings between tall poles along the cliffs (poles collide, lanterns/wires decorative).
  const wirePts: number[] = [];
  const poleRuns = [L.lanternPoles.slice(0, 4), L.lanternPoles.slice(4)];
  for (const run of poleRuns) run.forEach(([x, z], k) => {
    const H = L.lanternPoleHeight;
    deco.frame(x, 0, z, 0).put(kit.cylLow, C.timber, 0, 0, 0, L.lanternPoleRadius, H, L.lanternPoleRadius).put(kit.box, C.timber, 0, H - 0.5, 0, 0.9, 0.14, 0.14, x === run[0][0] ? 0 : Math.PI / 2);
    cyl(new THREE.Vector3(x, H / 2, z), H / 2, L.lanternPoleRadius);
    if (k === run.length - 1) return;
    const [x1, z1] = run[k + 1], n = L.lanternsPerString, y0 = H - 0.4;
    const at = (t: number) => [x + (x1 - x) * t, y0 - 4 * t * (1 - t) * L.lanternSag, z + (z1 - z) * t];
    for (let s = 0; s < 12; s++) wirePts.push(...at(s / 12), ...at((s + 1) / 12));
    glow.frame(0, 0, 0);
    for (let j = 1; j <= n; j++) {
      const [lx, ly, lz] = at(j / (n + 1));
      glow.put(kit.ball, j % 2 ? C.lantern : C.lantern2, lx, ly - 0.45, lz, 0.28, 0.38, 0.28);
      wirePts.push(lx, ly, lz, lx, ly - 0.2, lz);
    }
  });
  const wires = new THREE.LineSegments(
    own(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3))),
    own(new THREE.LineBasicMaterial({ color: C.wire })),
  );
  group.add(wires);
  for (const im of deco.build(mat.white, true, true)) { group.add(im); own(im); }
  for (const im of glow.build(own(glowMaterial(0xffffff, 2.4)))) { group.add(im); own(im); }

  // --- Village hills, distant mountains and sky.
  buildVillage(group, own, kit);
  const sunDir = new THREE.Vector3(...L.sunDir);
  buildSky(group, sunDir, own);

  const prevFog = scene.fog, prevBg = scene.background;
  scene.fog = new THREE.Fog(SKY.horizon, L.fogNear, L.fogFar);
  scene.background = new THREE.Color(SKY.horizon);

  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity);
  const sun = new THREE.DirectionalLight(L.sunColor, L.sunIntensity);
  sun.position.set(...L.sunDir);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -L.shadowExtent; sc.right = sc.top = L.shadowExtent;
  sc.near = 1; sc.far = 140;
  sun.shadow.mapSize.set(L.shadowMapSize, L.shadowMapSize);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  group.add(hemi, sun, sun.target);

  return {
    playerSpawn: new THREE.Vector3(...L.playerSpawn),
    enemySpawns: L.enemySpawns.map(([x, z]) => new THREE.Vector3(x, 0.1, z)),
    dispose() {
      disposables.forEach((d) => d.dispose());
      sun.shadow.map?.dispose();
      for (const c of colliders) {
        physics.climbable.delete(c.handle);
        physics.world.removeCollider(c, false);
      }
      group.removeFromParent();
      scene.fog = prevFog;
      scene.background = prevBg;
    },
  };
}
