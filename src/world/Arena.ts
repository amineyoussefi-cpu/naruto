import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { toon } from '../render/toon';

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
  /** Lighting / atmosphere. */
  sunDir: [30, 50, 22] as const, sunIntensity: 2.4, hemiIntensity: 1.2, shadowExtent: 46, shadowMapSize: 2048,
  fogNear: 70, fogFar: 230, skyRadius: 420,
  colors: {
    grass: 0x7aa64f, dirt: 0xc9a46a, rock: 0x8c7d6b, rockDark: 0x6f6355, wood: 0x8a5a35, deck: 0xa8774a,
    crate: 0xb5874f, leaves: 0x3f7d3a, leavesLight: 0x5a9a42, rope: 0xd8c08a, torii: 0xc8372d, mountain: 0x7f93a8,
    fog: 0xd7e3ea, skyTop: 0x3f86d6, skyHorizon: 0xf4e0be, skyBottom: 0xc4d4de,
  },
};

const SKY_VERT = /* glsl */ `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_FRAG = /* glsl */ `
uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP;
void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.4)); gl_FragColor = vec4(c, 1.0); }`;

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
    leavesLight: own(toon(C.leavesLight)), rope: own(toon(C.rope)), torii: own(toon(C.torii)), mountain: own(toon(C.mountain)),
    white: own(toon(0xffffff)),
  };
  const unitBox = own(new THREE.BoxGeometry(1, 1, 1));

  // --- Ground slabs (grass top, rock sides): plateau and far ledge.
  const slab = (minX: number, maxX: number, minZ: number, maxZ: number, depth: number) => {
    const half = new THREE.Vector3((maxX - minX) / 2, depth / 2, (maxZ - minZ) / 2);
    const c = new THREE.Vector3((minX + maxX) / 2, -depth / 2, (minZ + maxZ) / 2);
    const m = add(unitBox, [mat.rockDark, mat.rockDark, mat.grass, mat.rockDark, mat.rockDark, mat.rockDark], false, true);
    m.position.copy(c);
    m.scale.set(half.x * 2, depth, half.z * 2);
    box(c, half);
  };
  const P = L.plateau;
  slab(P.minX, P.maxX, P.minZ, P.maxZ, P.depth);
  slab(-L.ledge.halfX, L.ledge.halfX, L.ledge.minZ, L.ledge.maxZ, P.depth * 0.6);

  // Training circle and a dirt path towards the bridge (visual only).
  const circle = add(own(new THREE.CircleGeometry(8, 40).rotateX(-Math.PI / 2)), mat.dirt, false, true);
  circle.position.y = 0.015;
  const path = add(own(new THREE.PlaneGeometry(3.2, 18).rotateX(-Math.PI / 2)), mat.dirt, false, true);
  path.position.set(0, 0.012, -17);

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
    walls.setColorAt(i, col.set(C.rock).multiplyScalar(0.85 + hash(i) * 0.25));
    if (b.collide) box(b.c, b.s.clone().multiplyScalar(0.5), b.rot, true);
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
  const arms = new THREE.InstancedMesh(armGeo, mat.rope, L.posts.length);
  posts.castShadow = arms.castShadow = true;
  L.posts.forEach(([x, z], i) => {
    m4.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(yAxis, hash(i + 9) * Math.PI), new THREE.Vector3(1, 1, 1));
    posts.setMatrixAt(i, m4); arms.setMatrixAt(i, m4);
    cyl(new THREE.Vector3(x, L.postHeight / 2, z), L.postHeight / 2, L.postRadius);
  });
  group.add(posts, arms); disposables.push(posts, arms);

  // --- Trees (trunk collider) and decorative scatter (no colliders).
  const trunkGeo = own(new THREE.CylinderGeometry(L.trunkRadius * 0.7, L.trunkRadius, L.trunkHeight, 6).translate(0, L.trunkHeight / 2, 0));
  const crownGeo = own(new THREE.ConeGeometry(2, 3.2, 7).translate(0, L.trunkHeight + 1.2, 0));
  const crown2Geo = own(new THREE.ConeGeometry(1.4, 2.4, 7).translate(0, L.trunkHeight + 2.8, 0));
  const trunks = new THREE.InstancedMesh(trunkGeo, mat.wood, L.trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, mat.leaves, L.trees.length);
  const crowns2 = new THREE.InstancedMesh(crown2Geo, mat.leavesLight, L.trees.length);
  for (const im of [trunks, crowns, crowns2]) im.castShadow = true;
  L.trees.forEach(([x, z], i) => {
    const s = 0.9 + hash(i * 11) * 0.5;
    m4.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(yAxis, hash(i) * 6), new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4); crowns.setMatrixAt(i, m4); crowns2.setMatrixAt(i, m4);
    cyl(new THREE.Vector3(x, (L.trunkHeight * s) / 2, z), (L.trunkHeight * s) / 2, L.trunkRadius * s);
  });
  group.add(trunks, crowns, crowns2); disposables.push(trunks, crowns, crowns2);

  const tuftGeo = own(new THREE.ConeGeometry(0.12, 0.45, 4).translate(0, 0.2, 0));
  const tufts = new THREE.InstancedMesh(tuftGeo, mat.leavesLight, 260);
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
  const top = add(unitBox, mat.rockDark); top.position.set(0, 5.0, gz); top.scale.set(8.2, 0.3, 0.8);

  // --- Distant mountains (no colliders, fogged).
  const mountainGeo = own(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0));
  const mountains = new THREE.InstancedMesh(mountainGeo, mat.mountain, 22);
  for (let i = 0; i < mountains.count; i++) {
    const a = (i / mountains.count) * Math.PI * 2 + hash(i) * 0.2;
    const r = 120 + hash(i * 7) * 60;
    const h = 30 + hash(i * 3) * 45;
    mountains.setMatrixAt(i, m4.compose(new THREE.Vector3(Math.cos(a) * r, -25, Math.sin(a) * r), q.setFromAxisAngle(yAxis, a), new THREE.Vector3(h * 0.9, h + 25, h * 0.9)));
  }
  group.add(mountains); disposables.push(mountains);

  // --- Sky, fog, lights.
  const skyGeo = own(new THREE.SphereGeometry(L.skyRadius, 24, 12));
  const skyMat = own(new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(C.skyTop) }, horizon: { value: new THREE.Color(C.skyHorizon) }, bottom: { value: new THREE.Color(C.skyBottom) } },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
  }));
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);
  const prevFog = scene.fog, prevBg = scene.background;
  scene.fog = new THREE.Fog(C.fog, L.fogNear, L.fogFar);
  scene.background = new THREE.Color(C.fog);

  const hemi = new THREE.HemisphereLight(0xdcefff, 0x5d6b3c, L.hemiIntensity);
  const sun = new THREE.DirectionalLight(0xfff0d4, L.sunIntensity);
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
