/**
 * Client meshes of the v5 seeded world (colliders are built separately with `buildWorldColliders`).
 * Terrain and static props (buildings, walls, giant trees, rocks, bridges) are baked per 64 m chunk into
 * vertex-coloured meshes with distance LODs; normal trees and bushes are instanced with a focus-driven LOD
 * (near mesh → low-poly → crossed cards). Toon materials, ink outlines come from PostFX. Owner: world agent.
 */
import * as THREE from 'three';
import { toon } from '../render/toon';
import { glowMaterial } from '../render/PostFX';
import { groundHeight, worldLayout, zoneAt, type Building, type WorldLayout } from '../sim/world/generate';
import { rockShape } from '../sim/world/shapes';
import { ZONE, type WorldData } from '../sim/world/types';
import { Batcher } from './Batcher';
import { buildSky } from './Sky';
import { waterMaterial } from './Water';
import { bushGeometry, MergeBuilder, prep, shaftTexture, treeCard, treeSpecies, worldKit, type WorldKit } from './worldGeo';

/** Render-only tuning of the world view. */
export const WORLD_VIEW = {
  chunk: 64,
  /** Terrain LOD steps (cells) and switch distances (m). */
  terrainSteps: [1, 2, 4], terrainLod: [0, 140, 280],
  /** Static prop chunk LOD switch distance (m). */
  propLod: 190,
  /** Instanced tree LOD radii (m): full mesh, low-poly, cards; bushes; rebuild after the focus moves this far. */
  treeNear: 75, treeMid: 200, treeFar: 520, bushFar: 85, relod: 4,
  /** Lighting (same look as v3/v4). */
  lightDir: [-0.35, 0.8, 0.6] as const, skySunDir: [0.3, 0.22, 1] as const,
  sunColor: 0xffe6bd, sunIntensity: 2.6, hemiSky: 0xcfe6ff, hemiGround: 0x7a9a50, hemiIntensity: 2.3,
  shadowExtent: 60, shadowMapSize: 2048, shadowDistance: 160,
  fogColor: 0xcdeaf2, fogNear: 140, fogFar: 540,
  colors: {
    grass: 0x79b84a, forest: 0x5f9e3c, plateau: 0x6aa843, dirt: 0xcfae78, paved: 0xdcc9a0, plaza: 0xe3d5b6, field: 0xd9b77a,
    sand: 0xe6d3a3, wetSand: 0xc9b98e, cliff: 0xb49a7a, cliff2: 0xa38c70, lot: 0xc9b896,
    walls: [0xefe2c4, 0xe6d3ae, 0xf3d6b4] as const, roofs: [0xc8452f, 0xd9622b, 0x2f8f8a] as const, slab: 0xd8cbb0,
    timber: 0x5a3a26, lacquer: 0xc8372d, teal: 0x2f8f8a, stone: 0xa39a8a, wallBody: 0xe2d3b0, wood: 0xb5844f, wood2: 0x8f6a46,
    window: 0x4a7a90, bark: 0x7a5a40, hqBody: 0xf0dcb8, hqRoof: 0xc8372d,
    awnings: [0xc8372d, 0x2f8f8a, 0xe9b949, 0x3b5aa8] as const,
    greens: [[0x5fae3f, 0x7cc24a, 0x4f9a3a, 0x8fbf3a, 0x6db644], [0x3f8f4a, 0x2f7a45, 0x4f9a3a, 0x356f40], [0x6aa843, 0x9ccf55, 0x5a9e3c, 0x7cb342]] as const,
    autumn: [0xe0a23a, 0xd9622b] as const, giantLeaves: [0x4f9a3a, 0x3f8f4a, 0x5fae3f] as const,
    bushes: [0x4f9a3a, 0x6aa843, 0x3b7d33, 0x7cb342, 0x5d9e5a] as const,
    rock: [0xb7bec6, 0xa4adb8, 0xc3c6c4] as const, moss: 0x6faa45,
    coop: 0x4fb8ff, red: 0xd8402f, blue: 0x3b78e0, board: 0xefe2c4, lantern: 0xffb060, lantern2: 0xff7048, shaft: 0xfff0c0,
  },
};

export interface WorldView {
  readonly group: THREE.Group;
  update(focus: THREE.Vector3, frameDt: number): void;
  dispose(): void;
}

const hashf = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const pickC = <T>(a: readonly T[], r: number): T => a[Math.floor(r * a.length) % a.length];

export function buildWorldView(scene: THREE.Scene, data: WorldData): WorldView {
  const V = WORLD_VIEW, CL = V.colors, L = worldLayout(data), half = data.size / 2;
  const group = new THREE.Group();
  group.name = 'world';
  scene.add(group);
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };
  const ground = (x: number, z: number) => groundHeight(data, x, z);
  const mat = {
    ground: own(toon(0xffffff, { vertexColors: true, rim: 0 })),
    props: own(toon(0xffffff, { vertexColors: true, rim: 0.2 })),
    plain: own(toon(0xffffff, { rim: 0.2 })),
    vc: own(toon(0xffffff, { vertexColors: true, rim: 0.15 })),
    glow: own(glowMaterial(0xffffff, 2.4)),
  };

  // ---------------------------------------------------------------- terrain chunks (3 LODs, skirts hide cracks)
  const H = data.heightfield, per = V.chunk / H.cell, nChunks = Math.ceil((H.nx - 1) / per);
  const c3 = new THREE.Color(), c4 = new THREE.Color();
  const groundColor = (x: number, z: number, h: number, sl: number, out: THREE.Color) => {
    const zc = zoneAt(data, x, z), inV = Math.hypot(x - L.village.x, z - L.village.z) < L.village.r;
    switch (zc) {
      case ZONE.street: out.set(inV ? CL.paved : CL.dirt); break;
      case ZONE.plaza: out.set(CL.plaza); break;
      case ZONE.field: out.set(CL.field); break;
      case ZONE.beach: out.set(CL.sand); break;
      case ZONE.building: case ZONE.wall: out.set(CL.lot); break;
      case ZONE.forest: out.set(h > 28 ? CL.plateau : CL.forest); break;
      default: out.set(CL.grass);
    }
    if (h < L.waterY + 0.5 && zc !== ZONE.street) out.set(CL.wetSand);
    if (zc !== ZONE.street && zc !== ZONE.plaza) out.lerp(c4.set(hashf(Math.floor(h * 0.7)) > 0.5 ? CL.cliff : CL.cliff2), THREE.MathUtils.smoothstep(sl, 0.75, 1.05));
    return out.multiplyScalar(0.95 + hashf(Math.floor(x * 0.25) * 7.1 + Math.floor(z * 0.25) * 3.3) * 0.08);
  };
  const hAt = (ix: number, iz: number) => H.heights[Math.min(H.nz - 1, Math.max(0, iz)) * H.nx + Math.min(H.nx - 1, Math.max(0, ix))];
  const terrainChunk = (cx: number, cz: number, step: number) => {
    const i0 = cx * per, j0 = cz * per, n = Math.min(per, H.nx - 1 - i0) / step, m = Math.min(per, H.nz - 1 - j0) / step;
    const pos: number[] = [], nor: number[] = [], clr: number[] = [], idx: number[] = [], w = n + 3;
    for (let b = -1; b <= m + 1; b++) for (let a = -1; a <= n + 1; a++) {
      const aa = Math.min(n, Math.max(0, a)), bb = Math.min(m, Math.max(0, b)), ix = i0 + aa * step, iz = j0 + bb * step;
      const x = H.originX + ix * H.cell, z = H.originZ + iz * H.cell, h = hAt(ix, iz);
      const nx = hAt(ix - step, iz) - hAt(ix + step, iz), nz = hAt(ix, iz - step) - hAt(ix, iz + step), ny = 2 * step * H.cell, l = Math.hypot(nx, ny, nz);
      const skirt = aa !== a || bb !== b;
      pos.push(x, skirt ? h - 4 : h, z); nor.push(nx / l, ny / l, nz / l);
      groundColor(x, z, h, Math.hypot(nx, nz) / ny, c3);
      clr.push(c3.r, c3.g, c3.b);
    }
    for (let b = 0; b < m + 2; b++) for (let a = 0; a < n + 2; a++) {
      const i = b * w + a;
      idx.push(i, i + w, i + 1, i + 1, i + w, i + w + 1);
    }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat.ground);
    mesh.receiveShadow = true; mesh.castShadow = step === 1;
    return mesh;
  };
  for (let cz = 0; cz < nChunks; cz++) for (let cx = 0; cx < nChunks; cx++) {
    const lod = new THREE.LOD();
    V.terrainSteps.forEach((s, k) => lod.addLevel(terrainChunk(cx, cz, s), V.terrainLod[k]));
    group.add(lod);
  }

  // ---------------------------------------------------------------- static props baked per chunk (2 LODs)
  const kit = worldKit();
  Object.values(kit).forEach(own);
  const chunks = new Map<number, { hi: MergeBuilder; lo: MergeBuilder }>();
  const chunkOf = (x: number, z: number) => {
    const k = Math.floor((x + half) / V.chunk) * 1000 + Math.floor((z + half) / V.chunk);
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { hi: new MergeBuilder(), lo: new MergeBuilder() }));
    return c;
  };
  buildVillageProps(L, kit, chunkOf);
  buildNatureProps(L, kit, chunkOf, own);
  for (const { hi, lo } of chunks.values()) {
    const lod = new THREE.LOD();
    const a = new THREE.Mesh(own(hi.build()), mat.props);
    a.castShadow = a.receiveShadow = true;
    lod.addLevel(a, 0);
    if (!lo.empty) { const b = new THREE.Mesh(own(lo.build()), mat.props); b.receiveShadow = true; lod.addLevel(b, V.propLod); }
    group.add(lod);
  }

  // ---------------------------------------------------------------- water: lake grid, far sea, rivers, waterfalls
  const skySun = new THREE.Vector3(...V.skySunDir).normalize();
  const waterMat = own(waterMaterial(skySun));
  const wy = L.waterY;
  const addWater = (g: THREE.BufferGeometry) => { own(g); g.computeBoundingSphere(); group.add(new THREE.Mesh(g, waterMat)); };
  for (const [x0, z0, x1, z1] of L.lakeRects) {
    const cell = 4, n = Math.round((x1 - x0) / cell), m = Math.round((z1 - z0) / cell), pos: number[] = [], dep: number[] = [], idx: number[] = [], hs: number[] = [];
    for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) { const x = x0 + i * cell, z = z0 + j * cell, h = ground(x, z); hs.push(h); pos.push(x, wy, z); dep.push(wy - h); }
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      if (Math.min(hs[a], hs[b], hs[c], hs[d]) < wy + 0.3) idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(dep, 1));
    g.setIndex(idx);
    addWater(g);
  }
  for (const [cx, cz, w, d] of [[half + 1000, 0, 2000, 4000], [0, half + 1000, 2 * half, 2000]]) {
    const g = new THREE.PlaneGeometry(w, d, 8, 8).rotateX(-Math.PI / 2).translate(cx - (cx > half ? 10 : 0), wy - 0.12, cz - (cz > half ? 10 : 0));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count).fill(12), 1));
    addWater(g);
  }
  for (const wl of L.waterLines) {
    const p = wl.pts, w2 = wl.half + 3, pos: number[] = [], dep: number[] = [], idx: number[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, nx = -(b[2] - a[2]) / l, nz = (b[0] - a[0]) / l;
      for (const k of [-1, -0.5, 0, 0.5, 1]) {
        const x = p[i][0] + nx * w2 * k, z = p[i][2] + nz * w2 * k;
        pos.push(x, p[i][1], z); dep.push(Math.max(-1, p[i][1] - ground(x, z)) * 1.5);
      }
      if (i > 0) for (let k = 0; k < 4; k++) { const s = (i - 1) * 5 + k; idx.push(s, s + 1, s + 5, s + 1, s + 6, s + 5); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(dep, 1));
    g.setIndex(idx);
    addWater(g);
  }
  const fallMat = own(new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]), fog: true,
    vertexShader: /* glsl */ `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `uniform float time; varying vec2 vUv;
      #include <fog_pars_fragment>
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        float col = floor(vUv.x * 24.0);
        float s = fract(vUv.y * 3.0 + time * (1.2 + h(vec2(col, 1.0)) * 0.8) + h(vec2(col, 7.0)));
        vec3 c = mix(vec3(0.37, 0.85, 0.86), vec3(0.95, 1.0, 1.0), step(0.55, s));
        c = mix(c, vec3(1.0), smoothstep(0.75, 1.0, 1.0 - vUv.y));
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  }));
  const foam = new Batcher();
  for (const f of L.waterfalls) {
    const seg = 10, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const dx = f.x1 - f.x0, dz = f.z1 - f.z0, l = Math.hypot(dx, dz) || 1, sx = -dz / l, sz = dx / l;
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, y = THREE.MathUtils.lerp(f.y0, f.y1, t * t * 0.6 + t * 0.4), x = f.x0 + dx * Math.sqrt(t), z = f.z0 + dz * Math.sqrt(t);
      for (const s of [-1, 1]) { pos.push(x + sx * s * f.width / 2, y, z + sz * s * f.width / 2); uv.push(s > 0 ? 1 : 0, t); }
      if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, fallMat);
    mesh.material.side = THREE.DoubleSide;
    group.add(mesh);
    for (let k = 0; k < 7; k++) {
      const t = k / 6 - 0.5, s = 1.4 + hashf(k + f.x0) * 1.2;
      foam.put(kit.ball, 0xffffff, f.x1 + sx * t * f.width, f.y1 + 0.2, f.z1 + sz * t * f.width, s, s * 0.6, s);
    }
  }
  for (const im of foam.build(mat.plain)) { group.add(im); own(im); }

  // ---------------------------------------------------------------- start squares, boards, lanterns
  const solid = new Batcher(), glow = new Batcher();
  for (const s of data.squares) {
    const { x, y, z } = s.center, e = s.size / 2, t = 0.22;
    glow.frame(x, y + 0.04, z, s.yaw); solid.frame(x, y + 0.02, z, s.yaw);
    const bar = (c: number, bx: number, bz: number, sx: number, sz: number) => glow.put(kit.box, c, bx, 0, bz, sx, 0.05, sz);
    if (s.kind === 'coop') {
      bar(CL.coop, 0, -e, s.size + t, t); bar(CL.coop, 0, e, s.size + t, t); bar(CL.coop, -e, 0, t, s.size + t); bar(CL.coop, e, 0, t, s.size + t);
      for (const [cx, cz] of [[-e, -e], [e, -e], [-e, e], [e, e]]) glow.put(kit.box, CL.coop, cx, 0, cz, 0.5, 0.5, 0.5);
      solid.put(kit.box, 0x9fd3f0, 0, 0, 0, s.size - 0.2, 0.03, s.size - 0.2);
    } else {
      solid.put(kit.box, CL.red, -e / 2, 0, 0, e, 0.04, s.size).put(kit.box, CL.blue, e / 2, 0, 0, e, 0.04, s.size);
      bar(CL.red, -e / 2, -e, e, t); bar(CL.red, -e / 2, e, e, t); bar(CL.red, -e, 0, t, s.size);
      bar(CL.blue, e / 2, -e, e, t); bar(CL.blue, e / 2, e, e, t); bar(CL.blue, e, 0, t, s.size);
      glow.put(kit.box, 0xffffff, 0, 0, 0, t * 0.6, 0.05, s.size);
      for (const [sx, c] of [[-1, CL.red], [1, CL.blue]] as const) for (const sz of [-1, 1]) {
        solid.put(kit.cyl6, CL.timber, sx * (e + 0.6), 0, sz * (e - 0.5), 0.09, 4.2, 0.09)
          .put(kit.box, c, sx * (e + 0.6), 2.2, sz * (e - 0.5) + sz * 0.05, 0.08, 1.9, 1.1);
      }
    }
    const b = s.board;
    solid.frame(b.x, b.y, b.z, s.yaw)
      .put(kit.box, CL.timber, -1.5, 0, 0, 0.18, 2.6, 0.18).put(kit.box, CL.timber, 1.5, 0, 0, 0.18, 2.6, 0.18)
      .put(kit.box, CL.board, 0, 0.9, 0, 3.0, 1.5, 0.12).put(kit.box, s.kind === 'coop' ? CL.teal : CL.lacquer, 0, 2.5, 0, 3.6, 0.22, 0.6);
  }
  for (const [i, [x, y, z]] of L.lanterns.entries()) glow.frame(x, y, z).put(kit.ball, i % 3 ? CL.lantern : CL.lantern2, 0, 0, 0, 0.3, 0.38, 0.3);
  for (const im of solid.build(mat.plain, true, true)) { group.add(im); own(im); }
  for (const im of glow.build(mat.glow)) { group.add(im); own(im); }
  for (const s of data.squares.filter((q) => q.kind === 'coop')) {
    const fill = new THREE.Mesh(own(new THREE.PlaneGeometry(s.size, s.size).rotateX(-Math.PI / 2)),
      own(new THREE.MeshBasicMaterial({ color: CL.coop, transparent: true, opacity: 0.22, depthWrite: false })));
    fill.position.set(s.center.x, s.center.y + 0.08, s.center.z);
    group.add(fill);
  }

  // ---------------------------------------------------------------- instanced trees and bushes with focus LOD
  const trees = buildTreeLod(L, group, own);

  // ---------------------------------------------------------------- light shafts in the forest
  {
    const tex = own(shaftTexture());
    const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), card = own(mergeTwo(a, a.clone().rotateY(Math.PI / 2)));
    const im = new THREE.InstancedMesh(card, own(new THREE.MeshBasicMaterial({ map: tex, color: CL.shaft, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })), L.shafts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    L.shafts.forEach(([x, y, z], i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(x, y - 1, z), q.setFromEuler(e.set(0.25, hashf(i) * 3, 0.15)), new THREE.Vector3(3 + hashf(i + 9) * 3, 24, 3 + hashf(i + 9) * 3))));
    im.computeBoundingSphere();
    im.renderOrder = 2;
    group.add(im); own(im);
  }

  // ---------------------------------------------------------------- sky, fog, lights (one shadow sun following the focus)
  buildSky(group, skySun, own);
  const prevFog = scene.fog, prevBg = scene.background;
  scene.fog = new THREE.Fog(V.fogColor, V.fogNear, V.fogFar);
  scene.background = new THREE.Color(V.fogColor);
  const lightDir = new THREE.Vector3(...V.lightDir).normalize();
  const hemi = new THREE.HemisphereLight(V.hemiSky, V.hemiGround, V.hemiIntensity);
  const sun = new THREE.DirectionalLight(V.sunColor, V.sunIntensity);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -V.shadowExtent; sc.right = sc.top = V.shadowExtent;
  sc.near = 1; sc.far = V.shadowDistance * 2;
  sun.shadow.mapSize.set(V.shadowMapSize, V.shadowMapSize);
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
  group.add(hemi, sun, sun.target);
  const yAxis = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3();
  const lightRot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(lightDir, new THREE.Vector3(), yAxis));
  const lightRotInv = lightRot.clone().invert(), texel = (V.shadowExtent * 2) / V.shadowMapSize;
  let time = 0;

  const update = (focus: THREE.Vector3, frameDt: number) => {
    v3.copy(focus).applyQuaternion(lightRotInv);
    v3.x = Math.round(v3.x / texel) * texel; v3.y = Math.round(v3.y / texel) * texel;
    v3.applyQuaternion(lightRot);
    sun.target.position.copy(v3);
    sun.position.copy(v3).addScaledVector(lightDir, V.shadowDistance);
    time += frameDt;
    waterMat.uniforms.time.value = time;
    fallMat.uniforms.time.value = time;
    trees.update(focus);
  };
  const sp = data.spawns[0];
  update(new THREE.Vector3(sp.x, sp.y, sp.z), 0);

  return {
    group,
    update,
    dispose() {
      disposables.forEach((d) => d.dispose());
      sun.shadow.map?.dispose();
      group.removeFromParent();
      scene.fog = prevFog;
      scene.background = prevBg;
    },
  };
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const x = a.getAttribute(name), y = b.getAttribute(name), arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array); arr.set(y.array as Float32Array, x.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  const ia = a.index!.array, ib = b.index!.array, n = a.getAttribute('position').count;
  g.setIndex([...Array.from(ia), ...Array.from(ib, (i) => i + n)]);
  a.dispose(); b.dispose();
  return g;
}

type ChunkOf = (x: number, z: number) => { hi: MergeBuilder; lo: MergeBuilder };

/** Houses, HQ, walls, gates, market stalls, training posts, bridges and docks. */
function buildVillageProps(L: WorldLayout, k: WorldKit, chunkOf: ChunkOf): void {
  const CL = WORLD_VIEW.colors;
  const tint = (hex: number, seed: number, amt = 0.1) => new THREE.Color(hex).multiplyScalar(1 - amt / 2 + hashf(seed) * amt);
  L.buildings.forEach((b: Building, i) => {
    const { hi, lo } = chunkOf(b.x, b.z), wall = tint(CL.walls[b.wall], i), roof = tint(CL.roofs[b.roof], i + 0.5, 0.14), y0 = b.y - 0.6, H = b.h + 0.6;
    hi.frame(b.x, y0, b.z, b.yaw); lo.frame(b.x, y0, b.z, b.yaw);
    if (b.kit === 'round') {
      const r = b.w / 2;
      for (const m of [hi, lo]) m.put(k.cyl, wall, 0, 0, 0, r, H, r).put(k.cone, roof, 0, H, 0, r + 0.9, b.roofH, r + 0.9);
      hi.put(k.cyl, CL.timber, 0, H - 0.5, 0, r + 0.12, 0.35, r + 0.12).put(k.cyl, CL.window, 0, H * 0.55, 0, r + 0.04, 0.7, r + 0.04);
      return;
    }
    for (const m of [hi, lo]) m.put(k.box, wall, 0, 0, 0, b.w, H, b.d);
    hi.put(k.box, CL.stone, 0, 0, 0, b.w + 0.25, 1.0, b.d + 0.25);
    for (let f = 0; f < b.floors; f++) {
      const fy = 0.6 + f * 3.3;
      if (f > 0) hi.put(k.box, CL.timber, 0, fy - 0.2, 0, b.w + 0.2, 0.3, b.d + 0.2);
      hi.put(k.box, CL.window, 0, fy + 1.3, 0, b.w * 0.62, 0.8, b.d + 0.06).put(k.box, CL.window, 0, fy + 1.3, 0, b.w + 0.06, 0.8, b.d * 0.5);
    }
    if (b.kit === 'flat') {
      for (const m of [hi, lo]) m.put(k.box, CL.slab, 0, H, 0, b.w + 0.4, 0.3, b.d + 0.4);
      hi.put(k.box, roof, 0, H - 0.15, 0, b.w + 0.5, 0.2, b.d + 0.5);
      if (b.tank) {
        const ox = b.w / 2 - 1.6, oz = b.d / 2 - 1.6;
        hi.put(k.cyl, CL.wallBody, ox, H, oz, 1.15, 2.2, 1.15).put(k.cone, roof, ox, H + 2.2, oz, 1.3, 0.6, 1.3).put(k.cyl, CL.timber, ox, H + 1.0, oz, 1.2, 0.18, 1.2);
      }
    } else {
      hi.put(k.box, CL.timber, 0, H - 0.3, 0, b.w + 0.3, 0.35, b.d + 0.3);
      const long = b.w >= b.d;
      for (const m of [hi, lo]) {
        if (b.kit === 'gable') m.put(k.gable, roof, 0, H, 0, (long ? b.d : b.w) + 1.4, b.roofH, (long ? b.w : b.d) + 1.2, long ? Math.PI / 2 : 0);
        else m.put(k.hip, roof, 0, H, 0, b.w + 1.8, b.roofH, b.d + 1.8);
      }
    }
    if (b.awning) hi.put(k.box, pickC(CL.awnings, hashf(i * 3.1)), 0, 2.6, b.d / 2 + 0.7, Math.min(4, b.w * 0.6), 0.12, 1.5, 0, 0, 0.3);
  });

  const { hq } = L;
  for (const m of [chunkOf(hq.x, hq.z).hi, chunkOf(hq.x, hq.z).lo]) {
    m.frame(hq.x, hq.y, hq.z)
      .put(k.cyl, CL.hqBody, 0, -0.6, 0, hq.r, hq.h + 0.6, hq.r)
      .put(k.cyl, CL.hqRoof, 0, hq.h, 0, hq.r * 0.82, hq.roof * 0.6, hq.r * 0.82)
      .put(k.cone, CL.hqRoof, 0, hq.h - 0.5, 0, hq.r + 1.8, 2.2, hq.r + 1.8);
  }
  chunkOf(hq.x, hq.z).hi.frame(hq.x, hq.y, hq.z)
    .put(k.cyl, CL.stone, 0, -0.6, 0, hq.r + 0.6, 1.3, hq.r + 0.6)
    .put(k.cyl, CL.window, 0, hq.h * 0.3, 0, hq.r + 0.05, 1.3, hq.r + 0.05).put(k.cyl, CL.window, 0, hq.h * 0.62, 0, hq.r + 0.05, 1.3, hq.r + 0.05)
    .put(k.cyl, CL.lacquer, 0, hq.h - 1.2, 0, hq.r + 0.3, 0.8, hq.r + 0.3)
    .put(k.cyl, CL.slab, 0, hq.h + hq.roof * 0.6, 0, hq.r * 0.84, 0.25, hq.r * 0.84)
    .put(k.box, CL.lacquer, 0, 0, hq.r - 0.2, 5, 4, 1.6).put(k.box, CL.timber, 0, 0, hq.r + 0.5, 3.4, 3.2, 0.3);

  for (const w of L.walls) {
    const { hi, lo } = chunkOf(w.x, w.z), t = 2.6;
    for (const m of [hi, lo]) m.frame(w.x, w.y, w.z, w.yaw).put(k.box, CL.wallBody, 0, 0, 0, w.len, w.h, t);
    hi.put(k.box, CL.teal, 0, w.h, 0, w.len + 0.05, 0.45, t + 0.8);
  }
  for (const g of L.gates) {
    const { hi, lo } = chunkOf(g.x, g.z), tw = g.main ? 3 : 1.5, th = 9 + (g.main ? 4 : 1), dep = g.main ? 7 : 4, o = g.width / 2 + tw;
    for (const m of [hi, lo]) {
      m.frame(g.x, g.y, g.z, g.yaw);
      for (const s of [-1, 1]) m.put(k.box, CL.wallBody, s * o, -1, 0, tw * 2, th + 1, dep);
      m.put(k.box, g.main ? CL.lacquer : CL.wood2, 0, th - 2.7, 0, g.width + tw * 4, 2.4, g.main ? 5 : 3.2);
    }
    hi.put(k.gable, CL.teal, 0, th - 0.3, 0, dep + 2, 2.6, g.width + tw * 4 + 2, Math.PI / 2);
    if (g.main) for (const s of [-1, 1]) hi.put(k.box, 0x4f8f5a, s * (g.width / 2 - 0.4), 0, -3.2, 0.5, th - 3, g.width / 2 - 0.5, s * 1.2);
  }
  for (const s of L.stalls) {
    const { hi } = chunkOf(s.x, s.z);
    hi.frame(s.x, s.y, s.z, s.yaw).put(k.box, CL.wood, 0, 0, 0, 3.2, 1.1, 1.8);
    for (const [px, pz] of [[-1.5, -0.8], [1.5, -0.8], [-1.5, 0.8], [1.5, 0.8]]) hi.put(k.box, CL.timber, px, 0, pz, 0.14, 2.7, 0.14);
    hi.put(k.box, CL.awnings[s.color], 0, 2.6, 0.2, 3.8, 0.14, 2.6, 0, 0, 0.22);
  }
  for (const p of L.posts) chunkOf(p.x, p.z).hi.frame(p.x, p.y - 0.2, p.z).put(k.cyl6, CL.wood2, 0, 0, 0, 0.3, 1.9, 0.3);
  for (const d of L.decks) {
    const { hi, lo } = chunkOf(d.x, d.z), col = d.kind === 'rope' ? CL.wood2 : CL.wood;
    for (const m of [hi, lo]) m.frame(d.x, d.y, d.z, d.yaw).put(k.box, col, 0, -0.5, 0, d.len, 0.5, d.width);
    const n = Math.max(2, Math.round(d.len / 3));
    for (let i = 0; i <= n; i++) {
      const x = -d.len / 2 + (i / n) * d.len;
      for (const s of [-1, 1]) {
        if (d.kind === 'dock') hi.put(k.cyl6, CL.wood2, x, -4.5, s * (d.width / 2 - 0.2), 0.2, 4.6, 0.2);
        else hi.put(k.box, d.kind === 'bridge' ? CL.lacquer : CL.timber, x, 0, s * (d.width / 2 + 0.05), 0.18, 1.2, 0.18);
      }
    }
    if (d.kind !== 'dock') for (const s of [-1, 1]) hi.put(k.box, d.kind === 'bridge' ? CL.lacquer : CL.wood, 0, 1.05, s * (d.width / 2 + 0.05), d.len, 0.12, 0.14);
  }
}

/** Giant trees and rocks (merged per chunk). */
function buildNatureProps(L: WorldLayout, k: WorldKit, chunkOf: ChunkOf, own: <T extends { dispose(): void }>(x: T) => T): void {
  const CL = WORLD_VIEW.colors;
  for (const [i, g] of L.giants.entries()) {
    const { hi, lo } = chunkOf(g.x, g.z), leaf = new THREE.Color(pickC(CL.giantLeaves, g.tint)).multiplyScalar(0.94 + hashf(i) * 0.12);
    for (const m of [hi, lo]) m.frame(g.x, g.y, g.z, g.yaw).put(k.taper, CL.bark, 0, -1, 0, g.r, g.h * 0.9, g.r);
    hi.put(k.taper, CL.bark, 0, -1, 0, g.r * 1.55, 3.5, g.r * 1.55);
    for (let j = 0; j < 6; j++) {
      const a = j * 1.1 + hashf(i + j) * 0.6, rr = j === 0 ? 0 : 3.5 + hashf(i * 3 + j) * 3, s = 6 + hashf(i * 5 + j) * 3;
      hi.put(k.ball, leaf.clone().multiplyScalar(0.9 + (j % 3) * 0.08), Math.cos(a) * rr, g.h * (0.78 + (j === 0 ? 0.12 : hashf(i + j * 7) * 0.12)), Math.sin(a) * rr, s, s * 0.62, s);
    }
    for (let j = 0; j < 3; j++) { const a = g.yaw + j * 2.1; lo.put(k.ball0, leaf, Math.cos(a) * 3.5, g.h * (0.8 + j * 0.05), Math.sin(a) * 3.5, 7.5, 5, 7.5); }
    for (const b of g.branches) {
      hi.frame(b.x, b.y, b.z, b.yaw).put(k.box, CL.bark, 0, -0.45, 0, b.len, 0.9, 2.6).put(k.ball, leaf, b.len / 2 + 1.2, 1.0, 0, 3.4, 1.7, 3.4);
    }
  }
  // Same seeded shapes as the colliders (rockShape(seed * 7 + variant)).
  const seedShapes = new Map<number, THREE.BufferGeometry>();
  const shapeFor = (variant: number) => {
    let g = seedShapes.get(variant);
    if (g) return g;
    const s = rockShape(L.rockSeed * 7 + variant), raw = new THREE.BufferGeometry();
    raw.setAttribute('position', new THREE.BufferAttribute(s.pos, 3));
    raw.setIndex(new THREE.BufferAttribute(s.idx, 1));
    raw.computeVertexNormals();
    g = own(prep(raw));
    const p = g.getAttribute('position'), nr = g.getAttribute('normal'), c = g.getAttribute('color'), cc = new THREE.Color(), moss = new THREE.Color(CL.moss);
    for (let i = 0; i < p.count; i++) {
      cc.set(CL.rock[Math.floor(hashf(variant * 3 + Math.floor(p.getY(i) * 2.2)) * CL.rock.length)]).lerp(moss, 0.85 * THREE.MathUtils.smoothstep(nr.getY(i), 0.72, 0.92));
      c.setXYZ(i, cc.r, cc.g, cc.b);
    }
    seedShapes.set(variant, g);
    return g;
  };
  for (const r of L.rocks) {
    const { hi, lo } = chunkOf(r.x, r.z), g = shapeFor(r.variant), shade = 0.92 + hashf(r.x * 0.37 + r.z) * 0.14;
    for (const m of [hi, lo]) m.frame(r.x, r.y, r.z, r.yaw).put(g, new THREE.Color().setScalar(shade), 0, 0, 0, r.s, r.sy, r.s);
  }
}

/** Instanced normal trees (3 species × 2 mesh LODs + shared cards) and bushes, re-bucketed when the focus moves. */
function buildTreeLod(L: WorldLayout, group: THREE.Group, own: <T extends { dispose(): void }>(x: T) => T) {
  const V = WORLD_VIEW, CL = V.colors, species = treeSpecies();
  species.forEach((s) => [...s.lod0, ...s.lod1].forEach(own));
  const trunkMat = own(toon(0xffffff, { rim: 0.2 })), crownMat = own(toon(0xffffff, { vertexColors: true, rim: 0.15 }));
  const card = treeCard();
  own(card.geo); own(card.tex);
  const cardMat = own(new THREE.MeshBasicMaterial({ map: card.tex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xd8e8d0 }));
  const n = L.trees.length;
  const mats = new Float32Array(n * 16), cardM = new Float32Array(n * 16), crownC = new Float32Array(n * 3), barkC = new Float32Array(n * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const counts = [0, 0, 0];
  L.trees.forEach((t, i) => {
    counts[t.species]++;
    m.compose(new THREE.Vector3(t.x, t.y, t.z), q.setFromAxisAngle(up, t.yaw), new THREE.Vector3(t.s, t.s, t.s)).toArray(mats, i * 16);
    m.compose(new THREE.Vector3(t.x, t.y, t.z), q.setFromAxisAngle(up, t.yaw), new THREE.Vector3(7 * t.s, 11.5 * t.s, 7 * t.s)).toArray(cardM, i * 16);
    const autumn = t.species === 0 && hashf(t.x + t.z * 1.3) < 0.06;
    c.set(autumn ? pickC(CL.autumn, t.tint) : pickC(CL.greens[t.species], t.tint)).multiplyScalar(0.94 + hashf(t.x * 0.7) * 0.12).toArray(crownC, i * 3);
    c.set(CL.bark).multiplyScalar(0.9 + hashf(t.z) * 0.2).toArray(barkC, i * 3);
  });
  const inst = (geo: THREE.BufferGeometry, material: THREE.Material, cap: number, cast: boolean) => {
    const im = new THREE.InstancedMesh(geo, material, Math.max(1, cap));
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    im.count = 0; im.frustumCulled = false; im.castShadow = cast; im.receiveShadow = true;
    group.add(im); own(im);
    return im;
  };
  const meshes = species.map((s, k) => ({
    lod0: [inst(s.lod0[0], trunkMat, counts[k], true), inst(s.lod0[1], crownMat, counts[k], true)],
    lod1: [inst(s.lod1[0], trunkMat, counts[k], false), inst(s.lod1[1], crownMat, counts[k], false)],
  }));
  const cards = inst(card.geo, cardMat, n, false);
  const bushGeo = own(bushGeometry()), B = L.bushes, nb = B.length / 5;
  const bushes = inst(bushGeo, crownMat, nb, false);
  const bushM = new Float32Array(nb * 16), bushC = new Float32Array(nb * 3);
  for (let i = 0; i < nb; i++) {
    const s = B[i * 5 + 3];
    m.compose(new THREE.Vector3(B[i * 5], B[i * 5 + 1], B[i * 5 + 2]), q.setFromAxisAngle(up, hashf(i) * 6.28), new THREE.Vector3(s, s * 0.85, s)).toArray(bushM, i * 16);
    c.set(pickC(CL.bushes, B[i * 5 + 4])).toArray(bushC, i * 3);
  }
  const put = (im: THREE.InstancedMesh, src: Float32Array, col: Float32Array, i: number) => {
    const k = im.count++;
    (im.instanceMatrix.array as Float32Array).set(src.subarray(i * 16, i * 16 + 16), k * 16);
    (im.instanceColor!.array as Float32Array).set(col.subarray(i * 3, i * 3 + 3), k * 3);
  };
  const all = [...meshes.flatMap((s) => [...s.lod0, ...s.lod1]), cards, bushes];
  const last = new THREE.Vector3(Infinity, 0, 0);
  const n2 = V.treeNear ** 2, m2 = V.treeMid ** 2, f2 = V.treeFar ** 2, b2 = V.bushFar ** 2;
  return {
    update(focus: THREE.Vector3) {
      if (last.distanceToSquared(focus) < V.relod ** 2) return;
      last.copy(focus);
      for (const im of all) im.count = 0;
      L.trees.forEach((t, i) => {
        const d = (t.x - focus.x) ** 2 + (t.z - focus.z) ** 2;
        if (d < n2) { put(meshes[t.species].lod0[0], mats, barkC, i); put(meshes[t.species].lod0[1], mats, crownC, i); }
        else if (d < m2) { put(meshes[t.species].lod1[0], mats, barkC, i); put(meshes[t.species].lod1[1], mats, crownC, i); }
        else if (d < f2) put(cards, cardM, crownC, i);
      });
      for (let i = 0; i < nb; i++) if ((B[i * 5] - focus.x) ** 2 + (B[i * 5 + 2] - focus.z) ** 2 < b2) put(bushes, bushM, bushC, i);
      for (const im of all) { im.instanceMatrix.needsUpdate = true; im.instanceColor!.needsUpdate = true; }
    },
  };
}
