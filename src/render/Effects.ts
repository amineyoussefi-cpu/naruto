import * as THREE from 'three';
import type { EventBus } from '../core/events';
import type { Vec3Like } from '../core/types';
import type { Actor } from '../game/Actor';
import { toon } from './toon';
import { crackTexture, glintTexture, hexShieldTexture, impactLinesTexture, impactStarTexture } from './fx/textures';
import { shockwaveMaterial, swirlGeometry } from './fx/shapes';

/** VFX tuning. Times in seconds, distances in metres. Intensities > 1 are HDR and bloom. */
const FX = {
  // pools
  maxSparks: 400, maxChakra: 220, maxDust: 260, maxRings: 16, maxBillboards: 16, maxShocks: 2, maxSwirls: 2, maxCracks: 2, lights: 2,
  // particles
  sparkSize: 0.06, sparkStretch: 4, sparkGlow: 3, chakraSize: 0.14, chakraStretch: 3, chakraGlow: 2.6, dustSize: 0.24,
  gravity: 9, chakraGravity: -5, dustGravity: -0.6, sparkDrag: 2.5, chakraDrag: 1.5, dustDrag: 3,
  /** Puff grows during this fraction of its life, then shrinks out (no alpha fade: cel look). */
  puffGrow: 0.18,
  // colours
  hitColor: 0xffd27a, blockColor: 0x7fd4ff, killColor: 0xff6a3a, chakraColor: 0x4fb8ff, chakraCore: 0xe6f8ff,
  dustColor: 0xe6cf9f, smokeColor: 0xffffff, telegraphColor: 0xff3b1f, windColor: 0xeaf6ff,
  // impact billboards: sizes (m), lifetimes (s), HDR intensity
  starSize: 0.9, starHeavySize: 1.6, starKillSize: 2.1, starLife: 0.18, starHeavyLife: 0.26, starGlow: 1.15,
  linesSize: 2.6, linesLife: 0.22, linesGlow: 1.1,
  hexSize: 1.8, hexLife: 0.22, hexGlow: 2.2,
  glintWidth: 0.9, glintHeight: 2.2, glintLife: 0.3, glintHeadroom: 0.35, glintGlow: 3,
  // rings
  ringGlow: 2, telegraphGlow: 3, windRingLife: 0.25,
  // Rasengan burst
  shockFrom: 0.3, shockTo: 2.4, shockLife: 0.4, shockGlow: 1.6,
  swirlFrom: 0.4, swirlTo: 3, swirlLife: 0.55, swirlSpin: 9, swirlGlow: 2.2,
  crackSize: 3.2, crackLife: 1.6, crackFade: 0.5, techniqueGroundDrop: 0.9,
  // concentration flames
  concentrateRate: 70, concentrateRadius: 0.55, concentrateRise: 2.6, concentrateLife: 0.6,
  // death poof
  deathPuffs: 26, deathPuffSpeed: 3.2, deathPuffLife: 0.9, deathPuffSize: 0.55, deathHeight: 0.8,
  lightIntensity: 6, lightRange: 7, lightDecay: 8,
};

/** Particle size curve over normalised age k ∈ [0,1]: shrink (sparks) or puff (grow then shrink). */
type Profile = 'shrink' | 'puff';

type Pool = {
  mesh: THREE.InstancedMesh;
  pos: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array;
  gravity: number; drag: number; next: number; live: number;
  /** > 0: particle is stretched along its velocity by this factor. */
  stretch: number; profile: Profile;
};

interface Ring {
  mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
  life: number; max: number; from: number; to: number; opacity: number;
  follow: number | null;
}

/** Billboard animation: pop (overshoot in, pop out), fade (expand + fade), glint (flash in/out, follows). */
type BillAnim = 'pop' | 'fade' | 'glint';
interface Billboard {
  sprite: THREE.Sprite; mat: THREE.SpriteMaterial;
  life: number; max: number; delay: number; w: number; h: number; anim: BillAnim;
  follow: number | null; yOff: number;
}

/** Generic timed mesh (shockwave, swirl, crack decal). */
interface Timed<M extends THREE.Material> { mesh: THREE.Mesh; mat: M; life: number; max: number; from: number; to: number; spin: number }

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

const easeOutBack = (x: number): number => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;

/**
 * Particles, manga impact stars, chakra bursts, telegraph rings and glints.
 * Listens to gameplay events. All state advances in `update(dt)` (simulation time).
 */
export class Effects {
  private readonly sparks: Pool;
  private readonly chakra: Pool;
  private readonly dust: Pool;
  private readonly rings: Ring[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
  private readonly tex = { star: impactStarTexture(), lines: impactLinesTexture(), hex: hexShieldTexture(), glint: glintTexture(), crack: crackTexture() };
  private readonly bills: Billboard[] = [];
  private readonly shockGeo = new THREE.SphereGeometry(1, 24, 16);
  private readonly swirlGeo = swirlGeometry();
  private readonly crackGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly shocks: Timed<THREE.ShaderMaterial>[] = [];
  private readonly swirls: Timed<THREE.MeshBasicMaterial>[] = [];
  private readonly cracks: Timed<THREE.MeshBasicMaterial>[] = [];
  private readonly lights: { light: THREE.PointLight; t: number }[] = [];
  private readonly unsub: (() => void)[] = [];
  /** Actors currently concentrating chakra → emission accumulator. */
  private readonly concentrating = new Map<number, number>();
  private nextLight = 0;
  private seed = 1;

  constructor(private readonly scene: THREE.Scene, private readonly events: EventBus, private readonly getActor: (id: number) => Actor | undefined) {
    const additive = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false } as const;
    this.sparks = this.makePool(FX.maxSparks, new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial(additive), FX.gravity, FX.sparkDrag, FX.sparkStretch, 'shrink');
    this.chakra = this.makePool(FX.maxChakra, new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial(additive), FX.chakraGravity, FX.chakraDrag, FX.chakraStretch, 'shrink');
    // Opaque 2-tone cel puffs: lit by the sun through the toon ramp, outlined by the ink pass.
    this.dust = this.makePool(FX.maxDust, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff, { rim: 0.35 }), FX.dustGravity, FX.dustDrag, 0, 'puff');
    for (let i = 0; i < FX.maxRings; i++) {
      const mat = new THREE.MeshBasicMaterial({ ...additive, side: THREE.DoubleSide });
      const mesh = this.add(new THREE.Mesh(this.ringGeo, mat));
      this.rings.push({ mesh, mat, life: 0, max: 1, from: 1, to: 1, opacity: 1, follow: null });
    }
    for (let i = 0; i < FX.maxBillboards; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.tex.star, transparent: true, depthTest: false, depthWrite: false });
      const sprite = this.add(new THREE.Sprite(mat), 5) as THREE.Sprite;
      this.bills.push({ sprite, mat, life: 0, max: 1, delay: 0, w: 1, h: 1, anim: 'pop', follow: null, yOff: 0 });
    }
    for (let i = 0; i < FX.maxShocks; i++) {
      const mat = shockwaveMaterial();
      this.shocks.push({ mesh: this.add(new THREE.Mesh(this.shockGeo, mat)), mat, life: 0, max: 1, from: 1, to: 1, spin: 0 });
    }
    for (let i = 0; i < FX.maxSwirls; i++) {
      const mat = new THREE.MeshBasicMaterial({ ...additive, vertexColors: true, side: THREE.DoubleSide });
      this.swirls.push({ mesh: this.add(new THREE.Mesh(this.swirlGeo, mat)), mat, life: 0, max: 1, from: 1, to: 1, spin: 0 });
    }
    for (let i = 0; i < FX.maxCracks; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: this.tex.crack, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.cracks.push({ mesh: this.add(new THREE.Mesh(this.crackGeo, mat), 1), mat, life: 0, max: 1, from: 1, to: 1, spin: 0 });
    }
    for (let i = 0; i < FX.lights; i++) {
      // Lights stay in the scene at intensity 0 so toggling never recompiles shaders.
      const light = new THREE.PointLight(0xffffff, 0, FX.lightRange, 2);
      scene.add(light);
      this.lights.push({ light, t: 0 });
    }
    this.listen();
  }

  private add<T extends THREE.Object3D>(o: T, renderOrder = 2): T {
    o.visible = false;
    o.renderOrder = renderOrder;
    o.frustumCulled = false;
    this.scene.add(o);
    return o;
  }

  private makePool(n: number, geometry: THREE.BufferGeometry, material: THREE.Material, gravity: number, drag: number, stretch: number, profile: Profile): Pool {
    const mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, ZERO_M); mesh.setColorAt(i, tmpC.set(0xffffff)); }
    mesh.count = 0;
    this.scene.add(mesh);
    return { mesh, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), size: new Float32Array(n), gravity, drag, next: 0, live: 0, stretch, profile };
  }

  /** Deterministic-enough pseudo-random in [0,1) (keeps Math.random out of the hot loop). */
  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /** Spawns one particle; colour is multiplied by `glow` (HDR for additive pools). */
  private spawn(pool: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, glow: number): void {
    const i = pool.next;
    pool.next = (pool.next + 1) % pool.life.length;
    pool.pos[i * 3] = x; pool.pos[i * 3 + 1] = y; pool.pos[i * 3 + 2] = z;
    pool.vel[i * 3] = vx; pool.vel[i * 3 + 1] = vy; pool.vel[i * 3 + 2] = vz;
    pool.max[i] = pool.life[i] = life;
    pool.size[i] = size;
    pool.mesh.setColorAt(i, tmpC.set(color).multiplyScalar(glow));
    pool.mesh.count = pool.life.length; // draw the whole pool; dead slots have zero scale
  }

  private emit(pool: Pool, p: Vec3Like, color: number, count: number, speed: number, life: number, size: number, upBias = 0.4, spread = 0, glow = 1): void {
    for (let k = 0; k < count; k++) {
      const u = this.rand() * 2 - 1, th = this.rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + 0.6 * this.rand());
      this.spawn(pool,
        p.x + (this.rand() - 0.5) * spread, p.y + (this.rand() - 0.5) * spread * 0.5, p.z + (this.rand() - 0.5) * spread,
        r * Math.cos(th) * sp, (u + upBias) * sp, r * Math.sin(th) * sp,
        life * (0.6 + 0.4 * this.rand()), size * (0.6 + 0.8 * this.rand()), color, glow);
    }
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
  }

  private spark(p: Vec3Like, color: number, count: number, speed: number, life: number, size = FX.sparkSize): void {
    this.emit(this.sparks, p, color, count, speed, life, size, 0.4, 0, FX.sparkGlow);
  }

  private ring(p: Vec3Like, color: number, from: number, to: number, life: number, opacity = 0.9, follow: number | null = null, glow = FX.ringGlow): void {
    const r = this.rings.find((x) => x.life <= 0) ?? this.rings.reduce((a, b) => (a.life < b.life ? a : b));
    r.mesh.position.set(p.x, p.y + 0.05, p.z);
    r.mat.color.set(color).multiplyScalar(glow);
    r.life = r.max = life; r.from = from; r.to = to; r.opacity = opacity; r.follow = follow;
    r.mesh.visible = true;
    r.mesh.scale.setScalar(from);
  }

  private billboard(p: Vec3Like, map: THREE.Texture, color: number, glow: number, w: number, h: number, life: number, anim: BillAnim, follow: number | null = null, delay = 0): void {
    const b = this.bills.find((x) => x.life <= 0) ?? this.bills.reduce((a, c) => (a.life < c.life ? a : c));
    b.sprite.position.set(p.x, p.y, p.z);
    b.mat.map = map;
    b.mat.color.set(color).multiplyScalar(glow);
    b.mat.rotation = anim === 'glint' ? 0 : this.rand() * Math.PI * 2;
    b.mat.opacity = 1;
    b.life = b.max = life; b.delay = delay; b.w = w; b.h = h; b.anim = anim; b.follow = follow;
    b.yOff = follow !== null ? p.y - (this.getActor(follow)?.position.y ?? p.y) : 0;
    b.sprite.visible = false; // shown by update once the delay elapses
    b.sprite.scale.set(0, 0, 1);
  }

  private timed<M extends THREE.Material>(list: Timed<M>[], p: Vec3Like, from: number, to: number, life: number, spin = 0): Timed<M> {
    const t = list.find((x) => x.life <= 0) ?? list.reduce((a, b) => (a.life < b.life ? a : b));
    t.mesh.position.set(p.x, p.y, p.z);
    t.mesh.rotation.set(0, this.rand() * Math.PI * 2, 0);
    t.mesh.scale.setScalar(from);
    t.mesh.visible = true;
    t.life = t.max = life; t.from = from; t.to = to; t.spin = spin;
    return t;
  }

  private impact(p: Vec3Like, size: number, life: number, lines: boolean, linesColor = 0xffffff): void {
    this.billboard(p, this.tex.star, 0xffffff, FX.starGlow, size, size, life, 'pop');
    if (lines) this.billboard(p, this.tex.lines, linesColor, FX.linesGlow, FX.linesSize, FX.linesSize, FX.linesLife, 'fade');
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

  /** White cel smoke puff (dodge, death, respawn). */
  private poof(p: Vec3Like, count: number, speed: number, life: number, size: number, spread: number): void {
    this.emit(this.dust, p, FX.smokeColor, count, speed, life, size, 0.15, spread);
  }

  private listen(): void {
    const on = this.events.on.bind(this.events);
    this.unsub.push(
      on('damage', (e) => {
        if (e.blocked) {
          this.spark(e.position, FX.blockColor, 14, 6, 0.3);
          this.billboard(e.position, this.tex.hex, FX.blockColor, FX.hexGlow, FX.hexSize, FX.hexSize, FX.hexLife, 'fade');
        } else if (e.killed) {
          this.spark(e.position, FX.killColor, 40, 9, 0.6, FX.sparkSize * 1.4);
          this.spark(e.position, FX.hitColor, 20, 5, 0.5);
          this.impact(e.position, FX.starKillSize, FX.starHeavyLife, true, FX.hitColor);
          this.flashLight(e.position, FX.killColor, 1.2);
        } else {
          const heavy = e.kind === 'combo3' || e.kind === 'special';
          this.spark(e.position, FX.hitColor, heavy ? 28 : 16, heavy ? 8 : 6, 0.35);
          this.impact(e.position, heavy ? FX.starHeavySize : FX.starSize, heavy ? FX.starHeavyLife : FX.starLife, heavy);
          if (heavy) this.ring(e.position, FX.hitColor, 0.2, 1.4, 0.22, 0.8);
        }
      }),
      on('death', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        p.y += FX.deathHeight;
        this.poof(p, FX.deathPuffs, FX.deathPuffSpeed, FX.deathPuffLife, FX.deathPuffSize, 0.8);
        this.ring(p.setY(p.y - FX.deathHeight), FX.smokeColor, 0.4, 2.6, 0.35, 0.6, null, 1.2);
        this.concentrating.delete(e.id);
      }),
      on('land', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        const n = Math.min(4 + Math.round(e.impact * 1.2), 24);
        this.emit(this.dust, p.setY(p.y + 0.05), FX.dustColor, n, 2.5 + e.impact * 0.15, 0.5, FX.dustSize, 0.15, 0.6);
        if (e.impact > 12) this.ring(p, FX.dustColor, 0.3, 2.2, 0.35, 0.5, null, 1);
      }),
      on('footstep', (e) => {
        if (!e.sprint) return;
        const p = this.feet(e.id);
        if (p) this.emit(this.dust, p.setY(p.y + 0.05), FX.dustColor, 3, 1.2, 0.4, FX.dustSize * 0.8, 0.3, 0.3);
      }),
      on('jump', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        this.emit(this.dust, p.setY(p.y + 0.05), FX.dustColor, 4, 1.6, 0.35, FX.dustSize * 0.7, 0.1, 0.4);
        this.ring(p, FX.windColor, 0.3, 1.3, FX.windRingLife, 0.7, null, 1.3);
      }),
      on('dodge', (e) => {
        const p = this.feet(e.id);
        if (p) this.poof(p.setY(p.y + 0.7), 18, 2.2, 0.55, FX.dustSize * 2.4, 1);
      }),
      on('technique', (e) => {
        const p = e.position;
        this.spark(p, FX.chakraColor, 60, 11, 0.6, FX.sparkSize * 1.5);
        this.spark(p, FX.chakraCore, 20, 4, 0.4, FX.sparkSize * 1.2);
        const s = this.timed(this.shocks, p, FX.shockFrom, FX.shockTo, FX.shockLife);
        s.mat.uniforms.color.value.set(FX.chakraColor).multiplyScalar(FX.shockGlow);
        const tilt = this.rand() * 0.5;
        for (let i = 0; i < 2; i++) {
          const w = this.timed(this.swirls, p, FX.swirlFrom, FX.swirlTo, FX.swirlLife, i ? -FX.swirlSpin : FX.swirlSpin);
          w.mesh.rotation.x = i ? 0.9 + tilt : tilt; // one flat, one tilted
          w.mat.color.set(i ? FX.chakraCore : FX.chakraColor).multiplyScalar(FX.swirlGlow);
        }
        const g = this.feet(e.id) ?? tmpP.set(p.x, p.y - FX.techniqueGroundDrop, p.z);
        this.timed(this.cracks, tmpV.set(p.x, g.y + 0.03, p.z), FX.crackSize, FX.crackSize, FX.crackLife);
        this.ring(tmpV, FX.chakraColor, 0.3, 5, 0.45, 1);
        this.impact(p, FX.starHeavySize, FX.starHeavyLife, false);
        this.flashLight(p, FX.chakraColor, 1.6);
      }),
      on('telegraph', (e) => {
        const a = this.getActor(e.id);
        if (!a) return;
        const d = Math.max(e.duration, 0.1);
        this.ring(a.position, FX.telegraphColor, 2.2, 0.6, d, 0.9, e.id, FX.telegraphGlow);
        const head = tmpV.copy(a.position).setY(a.position.y + a.height + FX.glintHeadroom);
        const life = Math.min(FX.glintLife, d);
        this.billboard(head, this.tex.glint, FX.telegraphColor, FX.glintGlow, FX.glintWidth, FX.glintHeight, life, 'glint', e.id, d - life);
      }),
      on('projectileHit', (e) => {
        this.spark(e.position, e.hitActor ? FX.hitColor : 0xdddddd, e.hitActor ? 12 : 8, 4, 0.25, FX.sparkSize * 0.8);
        if (e.hitActor) this.impact(e.position, FX.starSize * 0.8, FX.starLife, false);
        else this.emit(this.dust, e.position, FX.dustColor, 4, 1.2, 0.35, FX.dustSize * 0.6, 0.3, 0.2);
      }),
      on('respawn', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        this.poof(p.setY(p.y + 0.8), 26, 2.2, 0.8, FX.dustSize * 1.8, 1.2);
        this.ring(p.setY(p.y - 0.8), 0xffffff, 0.3, 2.5, 0.4, 0.6, null, 1.2);
      }),
      on('concentrateStart', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        this.ring(p, FX.chakraColor, 1.6, 0.4, 0.5, 0.8);
        this.concentrating.set(e.id, 0);
      }),
    );
  }

  /** Generic burst at a position. */
  burst(pos: THREE.Vector3, color: number, count = 16): void {
    this.spark(pos, color, count, 6, 0.4);
  }

  /** Number of live particles (all pools). */
  get liveParticles(): number {
    return this.sparks.live + this.chakra.live + this.dust.live;
  }

  update(dt: number): void {
    this.updateConcentration(dt);
    this.stepPool(this.sparks, dt);
    this.stepPool(this.chakra, dt);
    this.stepPool(this.dust, dt);
    this.updateRings(dt);
    this.updateBillboards(dt);
    for (const s of this.shocks) {
      const k = this.age(s, dt);
      if (k < 0) continue;
      s.mesh.scale.setScalar(s.from + (s.to - s.from) * (1 - (1 - k) ** 3));
      s.mat.uniforms.opacity.value = 1 - k * k;
    }
    for (const w of this.swirls) {
      const k = this.age(w, dt);
      if (k < 0) continue;
      w.mesh.scale.setScalar(w.from + (w.to - w.from) * (1 - (1 - k) ** 2));
      w.mesh.rotation.y += w.spin * dt;
      w.mat.opacity = 1 - k;
    }
    for (const c of this.cracks) {
      const k = this.age(c, dt);
      if (k >= 0) c.mat.opacity = Math.min(1, (1 - k) / FX.crackFade);
    }
    for (const l of this.lights) {
      l.t = Math.max(0, l.t - dt * FX.lightDecay * 0.5);
      l.light.intensity = l.t * l.t * FX.lightIntensity;
    }
  }

  /** Advances a timed mesh; returns normalised age, or -1 when inactive (hides it on expiry). */
  private age(t: { life: number; max: number; mesh: THREE.Object3D }, dt: number): number {
    if (t.life <= 0) return -1;
    t.life -= dt;
    if (t.life <= 0) { t.mesh.visible = false; return -1; }
    return 1 - t.life / t.max;
  }

  /** Rising blue chakra flames around every actor still concentrating. */
  private updateConcentration(dt: number): void {
    for (const [id, acc] of this.concentrating) {
      const a = this.getActor(id);
      if (!a || !a.alive || !a.fighter.concentrating) { this.concentrating.delete(id); continue; }
      let n = acc + FX.concentrateRate * dt;
      for (; n >= 1; n--) {
        const th = this.rand() * Math.PI * 2, r = FX.concentrateRadius * (0.5 + 0.5 * this.rand());
        const up = FX.concentrateRise * (0.6 + 0.6 * this.rand());
        this.spawn(this.chakra, a.position.x + Math.cos(th) * r, a.position.y + this.rand() * 0.3, a.position.z + Math.sin(th) * r,
          -Math.cos(th) * 0.4, up, -Math.sin(th) * 0.4, FX.concentrateLife * (0.6 + 0.4 * this.rand()),
          FX.chakraSize * (0.6 + 0.8 * this.rand()), this.rand() < 0.25 ? FX.chakraCore : FX.chakraColor, FX.chakraGlow);
      }
      this.concentrating.set(id, n);
      if (this.chakra.mesh.instanceColor) this.chakra.mesh.instanceColor.needsUpdate = true;
    }
  }

  private updateRings(dt: number): void {
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
  }

  private updateBillboards(dt: number): void {
    for (const b of this.bills) {
      if (b.life <= 0) continue;
      if (b.follow !== null) {
        const a = this.getActor(b.follow);
        if (!a || !a.alive) { b.life = 0; b.sprite.visible = false; continue; }
        b.sprite.position.set(a.position.x, a.position.y + b.yOff, a.position.z);
      }
      if (b.delay > 0) { b.delay -= dt; continue; }
      b.life -= dt;
      if (b.life <= 0) { b.sprite.visible = false; b.follow = null; continue; }
      const k = 1 - b.life / b.max;
      let s = 1;
      if (b.anim === 'pop') {
        s = k < 0.3 ? easeOutBack(k / 0.3) : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      } else if (b.anim === 'fade') {
        s = 0.7 + 0.4 * k;
        b.mat.opacity = 1 - k * k;
      } else {
        s = Math.sin(Math.PI * k);
        b.mat.rotation = k * 0.6;
      }
      b.sprite.scale.set(b.w * s, b.h * s, 1);
      b.sprite.visible = true;
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
      const k = 1 - pool.life[i] / pool.max[i];
      const s = pool.size[i] * (pool.profile === 'puff' ? Math.min(1, k / FX.puffGrow) * Math.sqrt(1 - k) : 1 - k);
      tmpQ.identity();
      tmpS.set(s, s, s);
      if (pool.stretch > 0) {
        tmpV.set(pool.vel[j], pool.vel[j + 1], pool.vel[j + 2]);
        const sp = tmpV.length();
        if (sp > 1e-3) {
          tmpQ.setFromUnitVectors(UP, tmpV.multiplyScalar(1 / sp));
          tmpS.y = s * (1 + Math.min(sp * 0.15, 1) * (pool.stretch - 1));
        }
      }
      tmpM.compose(tmpP.set(pool.pos[j], pool.pos[j + 1], pool.pos[j + 2]), tmpQ, tmpS);
      pool.mesh.setMatrixAt(i, tmpM);
    }
    pool.live = live;
    if (live === 0) pool.mesh.count = 0;
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const pool of [this.sparks, this.chakra, this.dust]) {
      pool.life.fill(0);
      pool.live = 0;
      for (let i = 0; i < pool.life.length; i++) pool.mesh.setMatrixAt(i, ZERO_M);
      pool.mesh.count = 0;
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const r of this.rings) { r.life = 0; r.follow = null; r.mesh.visible = false; }
    for (const b of this.bills) { b.life = 0; b.follow = null; b.sprite.visible = false; }
    for (const t of [...this.shocks, ...this.swirls, ...this.cracks]) { t.life = 0; t.mesh.visible = false; }
    for (const l of this.lights) { l.t = 0; l.light.intensity = 0; }
    this.concentrating.clear();
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.clear();
    for (const pool of [this.sparks, this.chakra, this.dust]) {
      pool.mesh.geometry.dispose();
      (pool.mesh.material as THREE.Material).dispose();
      pool.mesh.dispose();
      pool.mesh.removeFromParent();
    }
    for (const r of this.rings) { r.mat.dispose(); r.mesh.removeFromParent(); }
    for (const b of this.bills) { b.mat.dispose(); b.sprite.removeFromParent(); }
    for (const t of [...this.shocks, ...this.swirls, ...this.cracks]) { t.mat.dispose(); t.mesh.removeFromParent(); }
    for (const g of [this.ringGeo, this.shockGeo, this.swirlGeo, this.crackGeo]) g.dispose();
    for (const t of Object.values(this.tex)) t.dispose();
    for (const l of this.lights) { l.light.dispose(); l.light.removeFromParent(); }
  }
}
