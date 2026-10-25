import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../sim/physics/PhysicsWorld';
import { toon } from '../render/toon';
import { glowMaterial } from '../render/PostFX';
import { Batcher } from './Batcher';
import { buildSky } from './Sky';
import { buildVillage, makeKitGeometries } from './Village';
import { boulderGeometry, seaStackGeometry, treeGeometries, NATURE } from './Nature';
import { farSeaGeometry, nearWaterGeometry, waterMaterial } from './Water';
import { coastZ, estuaryE, fbm2, hash1, heightAt, isOpenGround, noise2, normalAt, streamDist, terrainColor, WORLD } from './terrain';

export interface ArenaInfo {
  playerSpawn: THREE.Vector3;
  enemySpawns: THREE.Vector3[];
  /** Per render frame: keep the shadow camera (and anything view-dependent) around `focus` (player). Optional. */
  update?(focus: THREE.Vector3, frameDt: number): void;
  dispose(): void;
}

/** Scatter, lighting and atmosphere tuning for the coastal valley (layout lives in `WORLD`). */
const ARENA = {
  /** Scatter tile size (m): instanced props are split per tile for frustum culling. */
  tile: 60,
  /** Enemy spawn candidates: jittered grid step and half extent; clearance kept free of props. */
  spawnStep: 9, spawnExtent: 100, spawnClear: 3, spawnMinFromPlayer: 12,
  /** Boulders: candidate grid step, shoreline / meadow chance, size ranges (m), collider and climb thresholds. */
  boulders: { step: 7, shoreChance: 0.55, meadowChance: 0.12, shore: [0.6, 2.6], meadow: [0.5, 2.2], big: [2.5, 4.2], bigChance: 0.12, collideMin: 0.9, climbMin: 2, variants: 5 },
  /** Large climbable rock formations: [x, z, size, flat-top cut]. */
  formations: [[-40, -30, 7, 0.25], [40, -40, 6, 0.3], [-60, 5, 8, 0.25], [30, 2, 5, 0.3], [-14, -82, 9, 0.2], [60, 34, 6, 0.25], [-88, 40, 7, 0.25]] as [number, number, number, number][],
  /** Trees: candidate step, extent (beyond the boundary for a dense backdrop), forest noise threshold, meadow chance. */
  trees: { step: 5, extent: 160, forest: 0.12, meadow: 0.025, clearSpawn: 15, trunkHeight: [2.6, 3.4], scale: [0.8, 1.4], collideR: 128 },
  greens: {
    round: [0x5fae3f, 0x7cc24a, 0x4f9a3a, 0x8fbf3a, 0x3f9a5a] as const,
    wide: [0x6db644, 0x9ccf55, 0x5a9e3c, 0x4a8f4a] as const,
    tall: [0x3f8f4a, 0x4f9a3a, 0x2f7a45, 0x6aa843] as const,
    bush: [0x4f9a3a, 0x6aa843, 0x3b7d33, 0x7cb342, 0x5d9e5a] as const,
  },
  /** Tall grass and flowers: counts, extent. */
  tufts: 2600, flowers: 1100, grassExtent: 115,
  flowerColors: [0xffffff, 0xfff3a0, 0xffe066, 0xffffff, 0xffd0e0] as const,
  driftwood: 16,
  /** Distant sea stacks on the horizon (visual): [x, z, radius, height]. */
  farStacks: [[95, 240, 12, 16], [-30, 310, 16, 9], [190, 200, 9, 22]] as [number, number, number, number][],
  /** Lighting: light direction (higher than the visual sun so flat ground stays in the lit toon band), sky/water sun (low over the sea). */
  lightDir: [-0.25, 0.8, 1] as const, skySunDir: [-0.12, 0.2, 1] as const,
  sunColor: 0xffe6bd, sunIntensity: 2.6, hemiSky: 0xcfe6ff, hemiGround: 0x7a9a50, hemiIntensity: 2.3,
  shadowExtent: 55, shadowMapSize: 2048, shadowDistance: 150,
  fogColor: 0xcdeaf2, fogNear: 150, fogFar: 520,
};

/**
 * Builds the coastal valley (terrain, water, rocks, trees, hamlet), sky and lights with their colliders.
 * Terrain, rocks, the sea stack and house walls are climbable; every water surface is walk-on-water.
 */
export function buildArena(scene: THREE.Scene, physics: PhysicsWorld): ArenaInfo {
  const A = ARENA, W = WORLD;
  const group = new THREE.Group();
  group.name = 'arena';
  scene.add(group);
  const disposables: { dispose(): void }[] = [];
  const colliders: RAPIER.Collider[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, cast = true, receive = true) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = cast; m.receiveShadow = receive;
    group.add(m);
    return m;
  };
  const instanced = (geo: THREE.BufferGeometry, material: THREE.Material, items: { m: THREE.Matrix4; c: THREE.Color }[], cast = true, receive = true) => {
    // One InstancedMesh per map tile so camera and shadow frustum culling skip far scatter.
    const tiles = new Map<string, typeof items>();
    for (const it of items) {
      const k = `${Math.floor(it.m.elements[12] / A.tile)},${Math.floor(it.m.elements[14] / A.tile)}`;
      const list = tiles.get(k) ?? [];
      list.push(it); tiles.set(k, list);
    }
    for (const list of tiles.values()) {
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, it.c); });
      im.castShadow = cast; im.receiveShadow = receive;
      im.computeBoundingSphere();
      group.add(im); own(im);
    }
  };
  const blocked: [number, number, number][] = [];
  const block = (x: number, z: number, r: number) => { blocked.push([x, z, r]); };
  const isBlocked = (x: number, z: number, pad: number) => blocked.some(([bx, bz, r]) => (x - bx) ** 2 + (z - bz) ** 2 < (r + pad) ** 2);
  const v3 = new THREE.Vector3(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const mat4 = (x: number, y: number, z: number, yaw: number, sx: number, sy = sx, sz = sx) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(yAxis, yaw), new THREE.Vector3(sx, sy, sz));
  const pickHex = (arr: readonly number[], r: number) => arr[Math.floor(r * arr.length) % arr.length];

  const mat = {
    ground: own(toon(0xffffff, { vertexColors: true, rim: 0 })),
    vc: own(toon(0xffffff, { vertexColors: true, rim: 0.2 })),
    plain: own(toon(0xffffff, { rim: 0.2 })),
    flat: own(toon(0xffffff, { rim: 0 })),
  };

  // ---- Terrain: chunked heightfield with painted vertex colours; one climbable trimesh collider per chunk.
  {
    const n = Math.round((W.extent * 2) / W.cell), per = n / W.chunks, nrm = new THREE.Vector3();
    for (let cz = 0; cz < W.chunks; cz++) for (let cx = 0; cx < W.chunks; cx++) {
      const pos: number[] = [], nor: number[] = [], clr: number[] = [], idx: number[] = [];
      for (let j = 0; j <= per; j++) for (let i = 0; i <= per; i++) {
        const x = -W.extent + (cx * per + i) * W.cell, z = -W.extent + (cz * per + j) * W.cell, h = heightAt(x, z);
        normalAt(x, z, nrm);
        terrainColor(x, z, h, nrm.y, col);
        pos.push(x, h, z); nor.push(nrm.x, nrm.y, nrm.z); clr.push(col.r, col.g, col.b);
      }
      for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
        const a = j * (per + 1) + i, b = a + 1, c = a + per + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = own(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      add(g, mat.ground, true, true);
      colliders.push(physics.addStaticMesh(g, undefined, { climbable: true }));
    }
  }

  // ---- Water: near grid (walk-on-water collider) + far sea plane out to the horizon.
  const skySun = new THREE.Vector3(...A.skySunDir).normalize();
  const waterMat = own(waterMaterial(skySun));
  {
    const near = own(nearWaterGeometry()), far = own(farSeaGeometry());
    const nm = add(near, waterMat, false, false), fm = add(far, waterMat, false, false);
    nm.frustumCulled = fm.frustumCulled = false;
    colliders.push(physics.addStaticMesh(near, undefined, { water: true }));
    // Render-only animation clock (never touches the simulation).
    nm.onBeforeRender = () => { waterMat.uniforms.time.value = performance.now() / 1000; };
  }

  // ---- Sea stack (tall climbable cliff on the right coast) and distant stacks on the horizon.
  {
    const S = W.stack, geo = own(seaStackGeometry(S.radius, S.height, 3));
    add(geo, mat.vc).position.set(S.x, 0, S.z);
    colliders.push(physics.addStaticMesh(geo, new THREE.Matrix4().makeTranslation(S.x, 0, S.z), { climbable: true }));
    block(S.x, S.z, S.radius * 1.3);
    A.farStacks.forEach(([x, z, r, h], i) => { add(own(seaStackGeometry(r, h, 11 + i)), mat.vc, false, false).position.set(x, 0, z); });
  }

  // ---- Boulders: rounded grey rocks with mossy tops, clustered at shores, half-submerged in streams, scattered on grass.
  {
    const B = A.boulders, geos = Array.from({ length: B.variants }, (_, i) => own(boulderGeometry(i + 1)));
    const flatGeos = [own(boulderGeometry(21, 0.25)), own(boulderGeometry(22, 0.3))];
    const items = geos.map(() => [] as { m: THREE.Matrix4; c: THREE.Color }[]), flatItems = flatGeos.map(() => [] as { m: THREE.Matrix4; c: THREE.Color }[]);
    const place = (x: number, z: number, s: number, seed: number, flat: number) => {
      const yaw = hash1(seed * 1.7) * 6.28, sy = s * (0.75 + hash1(seed * 2.3) * 0.5), y = heightAt(x, z) - s * 0.25;
      const m = mat4(x, y, z, yaw, s * (0.9 + hash1(seed) * 0.3), sy, s);
      const c = new THREE.Color().setScalar(0.92 + hash1(seed * 5.1) * 0.14);
      const k = Math.floor(hash1(seed * 9.7) * (flat ? flatGeos.length : geos.length));
      (flat ? flatItems : items)[k].push({ m, c });
      if (s >= B.collideMin) colliders.push(physics.addStaticMesh((flat ? flatGeos : geos)[k], m, { climbable: s >= B.climbMin }));
      block(x, z, s * 1.1);
    };
    A.formations.forEach(([x, z, s, cut], i) => place(x, z, s, 900 + i, cut));
    const E = 125;
    for (let gz = -E; gz <= E; gz += B.step) for (let gx = -E; gx <= E; gx += B.step) {
      const seed = gx * 13.1 + gz * 7.7, x = gx + (hash1(seed) - 0.5) * B.step, z = gz + (hash1(seed + 1) - 0.5) * B.step;
      if (Math.hypot(x, z) > E || Math.hypot(x - W.spawn.x, z - W.spawn.z) < W.spawn.blend || isBlocked(x, z, 1)) continue;
      const h = heightAt(x, z), shore = h > W.waterY - 0.6 && h < W.waterY + 1.4 && z < coastZ(x) + 6;
      const r = hash1(seed + 2), sz = hash1(seed + 3);
      if (shore && r < B.shoreChance) place(x, z, B.shore[0] + sz * (B.shore[1] - B.shore[0]), seed, 0);
      else if (!shore && h > W.waterY && h < 30 && r < B.meadowChance) {
        const big = hash1(seed + 4) < B.bigChance;
        place(x, z, big ? B.big[0] + sz * (B.big[1] - B.big[0]) : B.meadow[0] + sz * (B.meadow[1] - B.meadow[0]), seed, 0);
      }
    }
    geos.forEach((g, i) => instanced(g, mat.vc, items[i]));
    flatGeos.forEach((g, i) => instanced(g, mat.vc, flatItems[i]));
  }

  // ---- Hamlet, bridge, torii, stone lanterns.
  const kit = makeKitGeometries();
  Object.values(kit).forEach(own);
  const solid = new Batcher(), glow = new Batcher();
  buildVillage({
    solid, glow, kit, block,
    box: (c, half, rot, climbable = false) => colliders.push(physics.addStaticBox(c, half, rot, { climbable })),
    cyl: (c, hh, r) => colliders.push(physics.addStaticCylinder(c, hh, r)),
    mesh: (geo, color, collide) => {
      own(geo);
      add(geo, own(toon(color)));
      if (collide) colliders.push(physics.addStaticMesh(geo));
    },
  });

  // ---- Enemy spawn points (reserved before trees so they stay clear).
  const enemySpawns: THREE.Vector3[] = [];
  for (let gz = -A.spawnExtent; gz <= A.spawnExtent; gz += A.spawnStep) for (let gx = -A.spawnExtent; gx <= A.spawnExtent; gx += A.spawnStep) {
    const x = gx + (hash1(gx * 3.3 + gz) - 0.5) * 3, z = gz + (hash1(gz * 5.1 - gx) - 0.5) * 3;
    if (Math.hypot(x - W.spawn.x, z - W.spawn.z) < A.spawnMinFromPlayer || isBlocked(x, z, A.spawnClear) || !isOpenGround(x, z)) continue;
    let y = -Infinity;
    for (const [dx, dz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) y = Math.max(y, heightAt(x + dx, z + dz));
    enemySpawns.push(new THREE.Vector3(x, y + 0.2, z));
    block(x, z, A.spawnClear);
  }

  // ---- Trees: forests on the plateau and back hills, clumps on the meadow, bushes, dead trees on islets.
  {
    const T = A.trees, G = treeGeometries();
    Object.values(G).forEach(own);
    const trunks: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const crowns = { round: [] as { m: THREE.Matrix4; c: THREE.Color }[], wide: [] as { m: THREE.Matrix4; c: THREE.Color }[], tall: [] as { m: THREE.Matrix4; c: THREE.Color }[], bush: [] as { m: THREE.Matrix4; c: THREE.Color }[] };
    const dead: { m: THREE.Matrix4; c: THREE.Color }[] = [], logs: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const nrm = new THREE.Vector3();
    for (let gz = -T.extent; gz <= T.extent; gz += T.step) for (let gx = -T.extent; gx <= T.extent; gx += T.step) {
      const seed = gx * 1.31 + gz * 2.77, x = gx + (hash1(seed) - 0.5) * T.step * 0.9, z = gz + (hash1(seed + 5) - 0.5) * T.step * 0.9;
      const r = Math.hypot(x, z);
      if (r > T.extent || z > coastZ(x) - 6 || Math.hypot(x - W.spawn.x, z - W.spawn.z) < T.clearSpawn) continue;
      const h = heightAt(x, z);
      if (h < W.waterY + 0.7 || streamDist(x, z) < 1.5 || estuaryE(x, z) < 1.25 || normalAt(x, z, nrm).y < 0.8 || isBlocked(x, z, 1.2)) continue;
      const forest = fbm2(x / 40 + 3, z / 40 - 7, 3) + (x > W.plateau.x0 ? 0.35 : 0) + (z < -80 ? 0.25 : 0) + (r > 125 ? 0.3 : 0);
      const roll = hash1(seed + 9);
      const isTree = forest > T.forest ? roll < 0.55 : roll < T.meadow;
      const isBush = !isTree && roll < (forest > T.forest ? 0.75 : 0.06);
      if (!isTree && !isBush) continue;
      const yaw = hash1(seed + 11) * 6.28, s = T.scale[0] + hash1(seed + 13) * (T.scale[1] - T.scale[0]);
      if (isBush) {
        crowns.bush.push({ m: mat4(x, h - 0.1, z, yaw, s * (0.8 + hash1(seed) * 0.6)), c: new THREE.Color(pickHex(A.greens.bush, hash1(seed + 17))) });
        continue;
      }
      const kind = hash1(seed + 19) < 0.45 ? 'round' : hash1(seed + 21) < 0.55 ? 'wide' : 'tall';
      const th = T.trunkHeight[0] + hash1(seed + 23) * (T.trunkHeight[1] - T.trunkHeight[0]);
      trunks.push({ m: mat4(x, h - 0.2, z, yaw, s, (th + (kind === 'tall' ? 1.5 : 0.8)) * s, s), c: new THREE.Color(NATURE.bark).multiplyScalar(0.9 + hash1(seed) * 0.2) });
      crowns[kind].push({ m: mat4(x, h - 0.2, z, yaw, s), c: new THREE.Color(pickHex(A.greens[kind], hash1(seed + 29))).multiplyScalar(0.94 + hash1(seed + 31) * 0.12) });
      if (r < T.collideR) colliders.push(physics.addStaticCylinder(new THREE.Vector3(x, h + 1.5 * s, z), 1.5 * s, 0.3 * s));
      block(x, z, 1.2 * s);
    }
    // Dead trees on a few islets.
    W.islets.forEach(([x, z, rad], i) => {
      if (i % 3 !== 1) return;
      const px = x + rad * 0.3, pz = z - rad * 0.2, y = heightAt(px, pz) - 0.1;
      dead.push({ m: mat4(px, y, pz, i * 1.7, 1 + hash1(i) * 0.4), c: new THREE.Color(NATURE.deadWood) });
      colliders.push(physics.addStaticCylinder(new THREE.Vector3(px, y + 2, pz), 2, 0.25));
    });
    // Driftwood on the beach.
    for (let i = 0; i < A.driftwood; i++) {
      const x = -60 + hash1(i * 3.7) * 120, z = coastZ(x) - 1 - hash1(i * 5.3) * 6;
      if (estuaryE(x, z) < 1.1 || isBlocked(x, z, 0)) continue;
      logs.push({ m: mat4(x, heightAt(x, z) + 0.12, z, hash1(i) * 6.28, 2 + hash1(i * 7) * 2.5, 1, 1), c: new THREE.Color(NATURE.driftwood).multiplyScalar(0.92 + hash1(i * 9) * 0.12) });
    }
    instanced(G.trunk, mat.plain, trunks);
    instanced(G.round, mat.vc, crowns.round);
    instanced(G.wide, mat.vc, crowns.wide);
    instanced(G.tall, mat.vc, crowns.tall);
    instanced(G.bush, mat.vc, crowns.bush);
    instanced(G.dead, mat.plain, dead);
    instanced(G.log, mat.plain, logs);

    // Tall grass tufts tinted from the ground and white/yellow flower dots in patches.
    const tufts: { m: THREE.Matrix4; c: THREE.Color }[] = [], flowers: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const E = A.grassExtent;
    for (let i = 0; tufts.length < A.tufts && i < A.tufts * 4; i++) {
      const x = (hash1(i * 1.37) * 2 - 1) * E, z = (hash1(i * 2.71 + 5) * 2 - 1) * E;
      const h = heightAt(x, z);
      if (h < W.waterY + 0.7 || h > 25 || z > coastZ(x) - 7 || normalAt(x, z, nrm).y < 0.85 || isBlocked(x, z, 0.3)) continue;
      terrainColor(x, z, h, nrm.y, col);
      const s = 0.7 + hash1(i * 3.3) * 0.9;
      tufts.push({ m: mat4(x, h - 0.05, z, hash1(i) * 6.28, s, s * (0.8 + hash1(i * 4.1) * 0.6), s), c: col.clone().multiplyScalar(1.08) });
    }
    for (let i = 0; flowers.length < A.flowers && i < A.flowers * 8; i++) {
      const x = (hash1(i * 4.13 + 1) * 2 - 1) * E, z = (hash1(i * 3.07 + 9) * 2 - 1) * E;
      if (noise2(x / 12 + 70, z / 12) < 0.15) continue;
      const h = heightAt(x, z);
      if (h < W.waterY + 0.6 || h > 25 || z > coastZ(x) - 7 || isBlocked(x, z, 0.2)) continue;
      flowers.push({ m: mat4(x, h, z, 0, 0.8 + hash1(i) * 0.5), c: new THREE.Color(pickHex(A.flowerColors, hash1(i * 7.7))) });
    }
    instanced(G.tuft, mat.flat, tufts, false, true);
    instanced(G.flower, mat.flat, flowers, false, false);
  }
  for (const im of solid.build(mat.plain, true, true)) { group.add(im); own(im); }
  for (const im of glow.build(own(glowMaterial(0xffffff, 2.4)))) { group.add(im); own(im); }

  // ---- Invisible boundary ring (not climbable) so nobody leaves the valley over the hills or across the sea.
  {
    const Bd = W.boundary, n = Bd.segments, half = Math.PI * Bd.radius / n * 1.15;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = Bd.radius + 2;
      colliders.push(physics.addStaticBox(new THREE.Vector3(Math.cos(a) * r, 50, Math.sin(a) * r), new THREE.Vector3(half, 150, 2), -Math.PI / 2 - a));
    }
  }

  // ---- Sky, fog, lights. The single shadow-casting sun follows the player (see update).
  buildSky(group, skySun, own);
  const prevFog = scene.fog, prevBg = scene.background;
  scene.fog = new THREE.Fog(A.fogColor, A.fogNear, A.fogFar);
  scene.background = new THREE.Color(A.fogColor);
  const lightDir = new THREE.Vector3(...A.lightDir).normalize();
  const hemi = new THREE.HemisphereLight(A.hemiSky, A.hemiGround, A.hemiIntensity);
  const sun = new THREE.DirectionalLight(A.sunColor, A.sunIntensity);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -A.shadowExtent; sc.right = sc.top = A.shadowExtent;
  sc.near = 1; sc.far = A.shadowDistance * 2;
  sun.shadow.mapSize.set(A.shadowMapSize, A.shadowMapSize);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  group.add(hemi, sun, sun.target);

  // Light-space basis for texel snapping (stops shadow shimmer while the frustum follows the player).
  const lightRot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(lightDir, new THREE.Vector3(), yAxis));
  const lightRotInv = lightRot.clone().invert();
  const texel = (A.shadowExtent * 2) / A.shadowMapSize;
  const update = (focus: THREE.Vector3) => {
    v3.copy(focus).applyQuaternion(lightRotInv);
    v3.x = Math.round(v3.x / texel) * texel; v3.y = Math.round(v3.y / texel) * texel;
    v3.applyQuaternion(lightRot);
    sun.target.position.copy(v3);
    sun.position.copy(v3).addScaledVector(lightDir, A.shadowDistance);
  };
  const playerSpawn = new THREE.Vector3(W.spawn.x, heightAt(W.spawn.x, W.spawn.z) + 0.1, W.spawn.z);
  update(playerSpawn);

  return {
    playerSpawn,
    enemySpawns,
    update,
    dispose() {
      disposables.forEach((d) => d.dispose());
      sun.shadow.map?.dispose();
      for (const c of colliders) {
        physics.climbable.delete(c.handle);
        physics.water.delete(c.handle);
        physics.world.removeCollider(c, false);
      }
      group.removeFromParent();
      scene.fog = prevFog;
      scene.background = prevBg;
    },
  };
}
