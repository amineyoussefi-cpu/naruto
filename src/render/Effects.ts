import * as THREE from 'three';
import type { EventBus } from '../core/events';
import type { Vec3Like } from '../core/types';
import type { Actor } from '../game/Actor';

/** VFX tuning. Times in seconds, distances in metres. */
const FX = {
  maxSparks: 400, maxDust: 240, maxRings: 16, lights: 2,
  sparkSize: 0.07, dustSize: 0.22,
  gravity: 9, dustGravity: -0.6, sparkDrag: 2.5, dustDrag: 3,
  hitColor: 0xffd27a, blockColor: 0x7fd4ff, killColor: 0xff6a3a, chakraColor: 0x4fb8ff,
  dustColor: 0xc8b896, smokeColor: 0xe8e8ee, deathSmoke: 0x6a6470,
  telegraphColor: 0xff3b1f,
  lightIntensity: 6, lightRange: 7, lightDecay: 8,
};

type Pool = {
  mesh: THREE.InstancedMesh;
  pos: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array;
  gravity: number; drag: number; next: number; live: number;
};

interface Ring {
  mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
  life: number; max: number; from: number; to: number; opacity: number;
  follow: number | null;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Particles, impact flashes, chakra bursts, telegraph rings.
 * Listens to gameplay events. All state advances in `update(dt)` (simulation time).
 */
export class Effects {
  private readonly sparks: Pool;
  private readonly dust: Pool;
  private readonly rings: Ring[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
  private readonly lights: { light: THREE.PointLight; t: number }[] = [];
  private readonly unsub: (() => void)[] = [];
  private nextLight = 0;
  private seed = 1;

  constructor(private readonly scene: THREE.Scene, private readonly events: EventBus, private readonly getActor: (id: number) => Actor | undefined) {
    this.sparks = this.makePool(FX.maxSparks, new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), FX.gravity, FX.sparkDrag);
    this.dust = this.makePool(FX.maxDust, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), FX.dustGravity, FX.dustDrag);
    for (let i = 0; i < FX.maxRings; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.rings.push({ mesh, mat, life: 0, max: 1, from: 1, to: 1, opacity: 1, follow: null });
    }
    for (let i = 0; i < FX.lights; i++) {
      // Lights stay in the scene at intensity 0 so toggling never recompiles shaders.
      const light = new THREE.PointLight(0xffffff, 0, FX.lightRange, 2);
      scene.add(light);
      this.lights.push({ light, t: 0 });
    }
    this.listen();
  }

  private makePool(n: number, geometry: THREE.BufferGeometry, material: THREE.MeshBasicMaterial, gravity: number, drag: number): Pool {
    const mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, ZERO_M); mesh.setColorAt(i, tmpC.set(0xffffff)); }
    mesh.count = 0;
    this.scene.add(mesh);
    return { mesh, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), size: new Float32Array(n), gravity, drag, next: 0, live: 0 };
  }

  /** Deterministic-enough pseudo-random in [0,1) (keeps Math.random out of the hot loop). */
  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private emit(pool: Pool, p: Vec3Like, color: number, count: number, speed: number, life: number, size: number, upBias = 0.4, spread = 0): void {
    const n = pool.life.length;
    for (let k = 0; k < count; k++) {
      const i = pool.next;
      pool.next = (pool.next + 1) % n;
      const u = this.rand() * 2 - 1, th = this.rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + 0.6 * this.rand());
      pool.pos[i * 3] = p.x + (this.rand() - 0.5) * spread;
      pool.pos[i * 3 + 1] = p.y + (this.rand() - 0.5) * spread * 0.5;
      pool.pos[i * 3 + 2] = p.z + (this.rand() - 0.5) * spread;
      pool.vel[i * 3] = r * Math.cos(th) * sp;
      pool.vel[i * 3 + 1] = (u + upBias) * sp;
      pool.vel[i * 3 + 2] = r * Math.sin(th) * sp;
      pool.max[i] = pool.life[i] = life * (0.6 + 0.4 * this.rand());
      pool.size[i] = size * (0.6 + 0.8 * this.rand());
      pool.mesh.setColorAt(i, tmpC.set(color));
    }
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    pool.mesh.count = n; // draw the whole pool; dead slots have zero scale
  }

  private ring(p: Vec3Like, color: number, from: number, to: number, life: number, opacity = 0.9, follow: number | null = null): void {
    const r = this.rings.find((x) => x.life <= 0) ?? this.rings.reduce((a, b) => (a.life < b.life ? a : b));
    r.mesh.position.set(p.x, p.y + 0.05, p.z);
    r.mat.color.set(color);
    r.life = r.max = life; r.from = from; r.to = to; r.opacity = opacity; r.follow = follow;
    r.mesh.visible = true;
    r.mesh.scale.setScalar(from);
  }

  private flashLight(p: Vec3Like, color: number, strength = 1): void {
    const l = this.lights[this.nextLight];
    this.nextLight = (this.nextLight + 1) % this.lights.length;
    l.light.position.set(p.x, p.y + 0.5, p.z);
    l.light.color.set(color);
    l.t = strength;
  }

  private feet(id: number): THREE.Vector3 | null {
    const a = this.getActor(id);
    return a ? tmpP.copy(a.position) : null;
  }

  private listen(): void {
    const on = this.events.on.bind(this.events);
    this.unsub.push(
      on('damage', (e) => {
        if (e.blocked) {
          this.emit(this.sparks, e.position, FX.blockColor, 14, 6, 0.3, FX.sparkSize);
          this.ring(e.position, FX.blockColor, 0.2, 0.9, 0.18, 0.7);
        } else if (e.killed) {
          this.emit(this.sparks, e.position, FX.killColor, 40, 9, 0.6, FX.sparkSize * 1.4);
          this.emit(this.sparks, e.position, FX.hitColor, 20, 5, 0.5, FX.sparkSize);
          this.flashLight(e.position, FX.killColor, 1.2);
        } else {
          const heavy = e.kind === 'combo3' || e.kind === 'special';
          this.emit(this.sparks, e.position, FX.hitColor, heavy ? 28 : 16, heavy ? 8 : 6, 0.35, FX.sparkSize);
          if (heavy) this.ring(e.position, FX.hitColor, 0.2, 1.4, 0.22, 0.8);
        }
      }),
      on('death', (e) => {
        const p = this.feet(e.id);
        if (p) this.emit(this.dust, p.setY(p.y + 0.5), FX.deathSmoke, 14, 1.5, 0.9, FX.dustSize * 1.4, 0.6, 0.8);
      }),
      on('land', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        const n = Math.min(4 + Math.round(e.impact * 1.2), 24);
        this.emit(this.dust, p.setY(p.y + 0.05), FX.dustColor, n, 2.5 + e.impact * 0.15, 0.5, FX.dustSize, 0.15, 0.6);
        if (e.impact > 12) this.ring(p, FX.dustColor, 0.3, 2.2, 0.35, 0.5);
      }),
      on('footstep', (e) => {
        if (!e.sprint) return;
        const p = this.feet(e.id);
        if (p) this.emit(this.dust, p.setY(p.y + 0.05), FX.dustColor, 3, 1.2, 0.4, FX.dustSize * 0.8, 0.3, 0.3);
      }),
      on('jump', (e) => {
        const p = this.feet(e.id);
        if (p) this.emit(this.dust, p.setY(p.y + 0.05), FX.dustColor, 5, 1.6, 0.35, FX.dustSize * 0.8, 0.1, 0.4);
      }),
      on('dodge', (e) => {
        const p = this.feet(e.id);
        if (p) this.emit(this.dust, p.setY(p.y + 0.6), FX.smokeColor, 12, 1.6, 0.55, FX.dustSize * 1.3, 0.2, 0.9);
      }),
      on('technique', (e) => {
        this.emit(this.sparks, e.position, FX.chakraColor, 60, 11, 0.6, FX.sparkSize * 1.5);
        this.emit(this.sparks, e.position, 0xe6f8ff, 20, 4, 0.4, FX.sparkSize * 1.2);
        this.ring({ x: e.position.x, y: e.position.y - 0.9, z: e.position.z }, FX.chakraColor, 0.3, 5, 0.45, 1);
        this.ring(e.position, 0xbfeaff, 0.2, 2.5, 0.25, 0.9);
        this.flashLight(e.position, FX.chakraColor, 1.6);
      }),
      on('telegraph', (e) => {
        const p = this.feet(e.id);
        if (p) this.ring(p, FX.telegraphColor, 2.2, 0.6, Math.max(e.duration, 0.1), 0.9, e.id);
      }),
      on('projectileHit', (e) => {
        this.emit(this.sparks, e.position, e.hitActor ? FX.hitColor : 0xdddddd, e.hitActor ? 12 : 8, 4, 0.25, FX.sparkSize * 0.8);
        if (!e.hitActor) this.emit(this.dust, e.position, FX.dustColor, 4, 1.2, 0.35, FX.dustSize * 0.6, 0.3, 0.2);
      }),
      on('respawn', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        this.emit(this.dust, p.setY(p.y + 0.8), FX.smokeColor, 26, 2.2, 0.8, FX.dustSize * 1.6, 0.1, 1.2);
        this.ring(p, 0xffffff, 0.3, 2.5, 0.4, 0.6);
      }),
      on('concentrateStart', (e) => {
        const p = this.feet(e.id);
        if (p) this.ring(p, FX.chakraColor, 1.6, 0.4, 0.5, 0.8);
      }),
    );
  }

  /** Generic burst at a position. */
  burst(pos: THREE.Vector3, color: number, count = 16): void {
    this.emit(this.sparks, pos, color, count, 6, 0.4, FX.sparkSize);
  }

  /** Number of live particles (both pools). */
  get liveParticles(): number {
    return this.sparks.live + this.dust.live;
  }

  update(dt: number): void {
    this.stepPool(this.sparks, dt);
    this.stepPool(this.dust, dt);
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; r.follow = null; continue; }
      const k = 1 - r.life / r.max;
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * (1 - (1 - k) * (1 - k)));
      r.mat.opacity = r.opacity * (r.follow !== null ? 0.5 + 0.5 * k : 1 - k);
      if (r.follow !== null) {
        const a = this.getActor(r.follow);
        if (a && a.alive) r.mesh.position.set(a.position.x, a.position.y + 0.05, a.position.z);
        else { r.life = 0; r.mesh.visible = false; r.follow = null; }
      }
    }
    for (const l of this.lights) {
      l.t = Math.max(0, l.t - dt * FX.lightDecay * 0.5);
      l.light.intensity = l.t * l.t * FX.lightIntensity;
    }
  }

  private stepPool(pool: Pool, dt: number): void {
    const n = pool.life.length;
    const drag = Math.exp(-pool.drag * dt);
    let live = 0;
    for (let i = 0; i < n; i++) {
      if (pool.life[i] <= 0) continue;
      pool.life[i] -= dt;
      if (pool.life[i] <= 0) { pool.mesh.setMatrixAt(i, ZERO_M); continue; }
      live++;
      const j = i * 3;
      pool.vel[j] *= drag; pool.vel[j + 2] *= drag;
      pool.vel[j + 1] = pool.vel[j + 1] * drag - pool.gravity * dt;
      pool.pos[j] += pool.vel[j] * dt; pool.pos[j + 1] += pool.vel[j + 1] * dt; pool.pos[j + 2] += pool.vel[j + 2] * dt;
      const s = pool.size[i] * (pool.life[i] / pool.max[i]);
      tmpM.compose(tmpP.set(pool.pos[j], pool.pos[j + 1], pool.pos[j + 2]), tmpQ.identity(), tmpS.set(s, s, s));
      pool.mesh.setMatrixAt(i, tmpM);
    }
    pool.live = live;
    if (live === 0) pool.mesh.count = 0;
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const pool of [this.sparks, this.dust]) {
      pool.life.fill(0);
      pool.live = 0;
      for (let i = 0; i < pool.life.length; i++) pool.mesh.setMatrixAt(i, ZERO_M);
      pool.mesh.count = 0;
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const r of this.rings) { r.life = 0; r.follow = null; r.mesh.visible = false; }
    for (const l of this.lights) { l.t = 0; l.light.intensity = 0; }
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.clear();
    for (const pool of [this.sparks, this.dust]) {
      pool.mesh.geometry.dispose();
      (pool.mesh.material as THREE.Material).dispose();
      pool.mesh.dispose();
      pool.mesh.removeFromParent();
    }
    for (const r of this.rings) { r.mat.dispose(); r.mesh.removeFromParent(); }
    this.ringGeo.dispose();
    for (const l of this.lights) { l.light.dispose(); l.light.removeFromParent(); }
  }
}
