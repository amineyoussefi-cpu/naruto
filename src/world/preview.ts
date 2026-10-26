/**
 * Dev-only world viewer (`/preview-world.html?view=plaza|forest|lake|village|giant&seed=N`). Not part of the game build.
 * Exposes `window.__world = { stats }` for screenshot scripts: draw calls, triangles, FPS.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PostFX } from '../render/PostFX';
import { generateWorld, worldLayout } from '../sim/world/generate';
import { WORLD_CONFIG } from '../config/world';
import { buildWorldView } from './WorldView';

const qs = new URLSearchParams(location.search);
const seed = Number(qs.get('seed') ?? WORLD_CONFIG.defaultSeed);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
const post = new PostFX(renderer, scene, camera);
const t0 = performance.now();
const data = generateWorld(seed);
const t1 = performance.now();
const view = buildWorldView(scene, data);
const t2 = performance.now();

const sq = data.squares[0].center, lake = data.arenas.find((a) => a.id === 'lake')!.center, forest = data.points['forest.clearing'];
function giantView(): [THREE.Vector3, THREE.Vector3] {
  const g = worldLayout(data).giants.reduce((a, b) => (Math.hypot(b.x - forest.x, b.z - forest.z) < Math.hypot(a.x - forest.x, a.z - forest.z) ? b : a));
  return [new THREE.Vector3(g.x + 26, g.y + 6, g.z + 26), new THREE.Vector3(g.x, g.y + g.h * 0.45, g.z)];
}
const views: Record<string, [THREE.Vector3, THREE.Vector3]> = {
  plaza: [new THREE.Vector3(sq.x + 18, sq.y + 14, sq.z + 34), new THREE.Vector3(sq.x + 12, sq.y + 3, sq.z - 14)],
  forest: [new THREE.Vector3(forest.x + 6, forest.y + 4, forest.z + 14), new THREE.Vector3(forest.x - 20, forest.y + 16, forest.z - 60)],
  lake: [new THREE.Vector3(lake.x - 40, 12, lake.z - 40), new THREE.Vector3(lake.x - 160, 4, lake.z - 140)],
  village: [new THREE.Vector3(sq.x + 10, sq.y + 70, sq.z + 170), new THREE.Vector3(sq.x, sq.y, sq.z - 40)],
  giant: giantView(),
};
const [eye, target] = views[qs.get('view') ?? 'plaza'] ?? views.plaza;
camera.position.copy(eye);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.update();

const resize = () => { renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize);
resize();
const stats = { gen: t1 - t0, build: t2 - t1, calls: 0, triangles: 0, fps: 0, frames: 0 };
(window as unknown as { __world: unknown }).__world = { stats, data };
const hud = document.getElementById('hud')!;
let last = performance.now(), acc = 0, n = 0;
const focus = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = (now - last) / 1000;
  last = now; acc += dt; n++;
  if (acc > 1) { stats.fps = n / acc; acc = 0; n = 0; }
  focus.copy(controls.target);
  view.update(focus, dt);
  renderer.info.reset();
  post.render(dt);
  stats.calls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles; stats.frames++;
  hud.textContent = `gen ${stats.gen.toFixed(0)} ms · build ${stats.build.toFixed(0)} ms · ${stats.calls} calls · ${(stats.triangles / 1000).toFixed(0)}k tris · ${stats.fps.toFixed(0)} fps`;
});
