import * as THREE from 'three';
import type { EventBus } from '../core/events';
import type { Vec3Like } from '../core/types';
import type { Actor } from '../game/Actor';
import { toon } from './toon';
import { crackTexture, glintTexture, hexShieldTexture, impactLinesTexture, impactStarTexture } from './fx/textures';
import { boltGeometry, commaRingGeometry, shockwaveMaterial, swirlGeometry, trailGeometry } from './fx/shapes';
import { COMBAT } from '../config/combat';

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
  /** Water-walking footstep ripple and splash. */
  waterRipple: 0xbfeaff, waterSplash: 0xe6f8ff,
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
  hitboxDrop: 1, crackSize: 3.2, crackLife: 1.6, crackFade: 0.5, techniqueGroundDrop: 0.9,
  // concentration flames
  concentrateRate: 70, concentrateRadius: 0.55, concentrateRise: 2.6, concentrateLife: 0.6,
  // death poof
  deathPuffs: 26, deathPuffSpeed: 3.2, deathPuffLife: 0.9, deathPuffSize: 0.55, deathHeight: 0.8,
  lightIntensity: 3, lightRange: 7, lightDecay: 8,
  // chakra dash: burst, trailing streak (per dashing actor), world-space speed lines, chakra wake
  maxStreaks: 3, maxLines: 160, dashBurst: 26, dashBurstSpeed: 7, streakWidth: 0.9, streakPerSpeed: 0.12, streakMin: 0.8, streakMax: 3.2,
  streakGlow: 2.4, streakFade: 0.15, dashGrace: 0.1, chestHeight: 1.0,
  lineRate: 220, lineSpeed: 26, lineLife: 0.12, lineSize: 0.025, lineStretch: 16, lineRadius: 0.9, lineGlow: 2.2,
  wakeRate: 90, wakeLife: 0.35,
  // substitution: big smoke poof + wooden log that drops, rolls, then pops out
  maxLogs: 3, logRadius: 0.2, logLength: 1.2, logLife: 1.5, logShrink: 0.25, logDrop: 0.7, logTilt: 1.25, logRollSpeed: 1.6,
  logRollDrag: 1.5, logBounce: 0.25, logSettle: 10, logBark: 0xc98d4f, logCut: 0xf2d39a,
  subPuffs: 34, subPuffSpeed: 3.4, subPuffSize: 0.6, subPuffLife: 0.85, subToPuffs: 14,
  // double jump: wind ring + chakra puff under the feet
  airRingTo: 2.1, airPuffs: 16, airPuffSpeed: 3.5,
  // launcher (combo5) extras
  launchDust: 16, launchDustSpeed: 4.5, launchRingTo: 3.2,
  // hold-to-charge (Rasengan / Chidori): converging particles toward the hand, pulsing ground ring
  chargeRate: 110, chargeRadius: 0.95, chargeLife: 0.32, chargeRingEvery: 0.32, chargeHandUp: 0.7, chargeHandFwd: 0.45,
  /** Chidori converges fewer particles (its sparks/bolts carry the effect). */
  chidoriChargeRate: 0.45,
  chidoriColor: 0xd6ecff, chidoriBlue: 0x5fb4ff, chidoriSparkRate: 70, chidoriArcEvery: 0.06, chidoriArcCharge: 0.6,
  // lightning bolts (pooled meshes): life (s), spawn interval along a dash (s), length (m), thickness scale, HDR glow
  maxBolts: 14, boltLife: 0.1, boltEvery: 0.03, boltLen: 1.8, boltWidth: 0.8, boltGlow: 2.2,
  // Sharingan genjutsu: red wave, rotating comma marks, per-target flash
  genjutsuColor: 0xff2a2a, genjutsuDark: 0x8a0f1a, waveLife: 0.6, maxTomoe: 2, tomoeFrom: 0.6, tomoeTo: 3.2, tomoeLife: 0.9, tomoeSpin: 5,
  tomoeGlow: 2.4,
  // grab sequence
  grabFlash: 0xffffff, finisherShockTo: 3.2, finisherRingTo: 4.5,
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

/** Dash trail attached to an actor while its anim is `anim` (chakra dash or Chidori). */
interface Streak { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; id: number | null; t: number; fade: number; acc: number; wake: number; anim: 'dash' | 'chidori'; bolt: number }
/** Active hold-to-charge on an actor. */
interface Charge { t: number; full: number; chidori: boolean; acc: number; ring: number; arc: number; spark: number; done: boolean }
/** Substitution log: drops, bounces, rolls, then shrinks out. */
interface Log { mesh: THREE.Mesh; life: number; vy: number; v: number; roll: number; tilt: number; ground: number; yaw: number }

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
  private readonly lines: Pool;
  private readonly streakGeo = trailGeometry(1, FX.streakWidth);
  private readonly streaks: Streak[] = [];
  private readonly logGeo = new THREE.CylinderGeometry(FX.logRadius, FX.logRadius * 1.08, FX.logLength, 10).rotateZ(Math.PI / 2);
  private readonly logMats = [toon(FX.logBark, { rim: 0.35 }), toon(FX.logCut, { rim: 0.35 })];
  private readonly logs: Log[] = [];
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
  private readonly charges = new Map<number, Charge>();
  /** Grabber id → grabbed target id (for QTE strike impacts). */
  private readonly grabs = new Map<number, number>();
  private readonly boltGeos = [1, 2, 3, 4, 5].map((i) => boltGeometry(i * 13, 1, 9, 0.35, 0.07 * FX.boltWidth));
  private readonly bolts: Timed<THREE.MeshBasicMaterial>[] = [];
  private readonly tomoeGeo = commaRingGeometry();
  private readonly tomoes: Timed<THREE.MeshBasicMaterial>[] = [];
  private nextLight = 0;
  private seed = 1;

  constructor(private readonly scene: THREE.Scene, private readonly events: EventBus, private readonly getActor: (id: number) => Actor | undefined) {
    const additive = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false } as const;
    this.sparks = this.makePool(FX.maxSparks, new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial(additive), FX.gravity, FX.sparkDrag, FX.sparkStretch, 'shrink');
    this.chakra = this.makePool(FX.maxChakra, new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial(additive), FX.chakraGravity, FX.chakraDrag, FX.chakraStretch, 'shrink');
    // Opaque 2-tone cel puffs: lit by the sun through the toon ramp, outlined by the ink pass.
    this.dust = this.makePool(FX.maxDust, new THREE.IcosahedronGeometry(1, 1), toon(0xffffff, { rim: 0.35 }), FX.dustGravity, FX.dustDrag, 0, 'puff');
    this.lines = this.makePool(FX.maxLines, new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial(additive), 0, 0, FX.lineStretch, 'shrink');
    for (let i = 0; i < FX.maxStreaks; i++) {
      const mat = new THREE.MeshBasicMaterial({ ...additive, vertexColors: true, side: THREE.DoubleSide });
      this.streaks.push({ mesh: this.add(new THREE.Mesh(this.streakGeo, mat)), mat, id: null, t: 0, fade: 0, acc: 0, wake: 0, anim: 'dash', bolt: 0 });
    }
    for (let i = 0; i < FX.maxLogs; i++) {
      // Cylinder groups: 0 = bark side, 1/2 = cut ends.
      const mesh = this.add(new THREE.Mesh(this.logGeo, [this.logMats[0], this.logMats[1], this.logMats[1]]), 0);
      mesh.castShadow = true;
      mesh.rotation.order = 'YZX'; // roll about the log axis (X), then tilt (Z), then yaw (Y)
      this.logs.push({ mesh, life: 0, vy: 0, v: 0, roll: 0, tilt: 0, ground: 0, yaw: 0 });
    }
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
    for (let i = 0; i < FX.maxBolts; i++) {
      const mat = new THREE.MeshBasicMaterial({ ...additive, side: THREE.DoubleSide });
      mat.color.set(FX.chidoriColor).multiplyScalar(FX.boltGlow);
      this.bolts.push({ mesh: this.add(new THREE.Mesh(this.boltGeos[0], mat), 3), mat, life: 0, max: 1, from: 1, to: 1, spin: 0 });
    }
    for (let i = 0; i < FX.maxTomoe; i++) {
      const mat = new THREE.MeshBasicMaterial({ ...additive, side: THREE.DoubleSide });
      mat.color.set(FX.genjutsuColor).multiplyScalar(FX.tomoeGlow);
      this.tomoes.push({ mesh: this.add(new THREE.Mesh(this.tomoeGeo, mat)), mat, life: 0, max: 1, from: 1, to: 1, spin: 0 });
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
          const launcher = e.kind === 'combo5';
          const heavy = launcher || e.kind === 'combo3' || e.kind === 'combo4' || e.kind === 'special' || e.kind === 'chidori' || e.kind === 'grabFinisher';
          this.spark(e.position, FX.hitColor, heavy ? 28 : 16, heavy ? 8 : 6, 0.35);
          this.impact(e.position, launcher ? FX.starKillSize : heavy ? FX.starHeavySize : FX.starSize, heavy ? FX.starHeavyLife : FX.starLife, heavy);
          if (heavy) this.ring(e.position, FX.hitColor, 0.2, 1.4, 0.22, 0.8);
          if (launcher) this.launcherBlast(e.targetId, e.position);
        }
        if (e.kind === 'chidori') { // lightning impact flash on each pierced enemy
          this.spark(e.position, FX.chidoriColor, 26, 9, 0.3);
          for (let i = 0; i < 4; i++) this.bolt(e.position, tmpV.set(this.rand() - 0.5, this.rand() - 0.3, this.rand() - 0.5), FX.boltLen * 0.6, FX.boltLife * 1.5);
          this.flashLight(e.position, FX.chidoriBlue, 1.5);
        }
      }),
      on('death', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        p.y += FX.deathHeight;
        this.poof(p, FX.deathPuffs, FX.deathPuffSpeed, FX.deathPuffLife, FX.deathPuffSize, 0.8);
        this.ring(p.setY(p.y - FX.deathHeight), FX.smokeColor, 0.4, 2.6, 0.35, 0.6, null, 1.2);
        this.concentrating.delete(e.id);
        this.charges.delete(e.id);
      }),
      on('land', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        const n = Math.min(4 + Math.round(e.impact * 1.2), 24);
        this.emit(this.dust, p.setY(p.y + 0.05), FX.dustColor, n, 2.5 + e.impact * 0.15, 0.5, FX.dustSize, 0.15, 0.6);
        if (e.impact > 12) this.ring(p, FX.dustColor, 0.3, 2.2, 0.35, 0.5, null, 1);
      }),
      on('footstep', (e) => {
        const a = this.getActor(e.id);
        if (a?.onWater) {
          // Water-walking: a chakra ripple under each step instead of dust.
          const w = tmpV.set(a.position.x, a.position.y + 0.04, a.position.z);
          this.ring(w, FX.waterRipple, 0.25, e.sprint ? 1.8 : 1.3, 0.55, 0.7, null, 1);
          if (e.sprint) this.spark(w, FX.waterSplash, 5, 2.5, 0.3);
          return;
        }
        if (!e.sprint) return;
        const p = this.feet(e.id);
        if (p) this.emit(this.dust, p.setY(p.y + 0.05), FX.dustColor, 3, 1.2, 0.4, FX.dustSize * 0.8, 0.3, 0.3);
      }),
      on('jump', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        if (e.air) {
          this.ring(p, FX.windColor, 0.4, FX.airRingTo, FX.windRingLife * 1.4, 0.8, null, 1.5);
          this.ring(p, FX.chakraColor, 0.2, 1.1, FX.windRingLife, 0.9);
          this.emit(this.chakra, p, FX.chakraColor, FX.airPuffs, FX.airPuffSpeed, 0.3, FX.chakraSize, -0.6, 0.3, FX.chakraGlow);
          this.poof(p, 6, 1.4, 0.4, FX.dustSize, 0.4);
          return;
        }
        this.emit(this.dust, p.setY(p.y + 0.05), FX.dustColor, 4, 1.6, 0.35, FX.dustSize * 0.7, 0.1, 0.4);
        this.ring(p, FX.windColor, 0.3, 1.3, FX.windRingLife, 0.7, null, 1.3);
      }),
      on('dodge', (e) => {
        const p = this.feet(e.id);
        if (p) this.poof(p.setY(p.y + 0.7), 18, 2.2, 0.55, FX.dustSize * 2.4, 1);
      }),
      on('technique', (e) => {
        if (e.name === 'chidori') { this.chidoriStart(e.id, e.position); return; }
        if (e.name === 'sharingan') { this.sharinganWave(e.id, e.position); return; }
        const p = e.position;
        const pw = 0.45 + 0.55 * Math.min(Math.max(e.power ?? 1, 0), 1); // Rasengan burst scales with charge power
        this.spark(p, FX.chakraColor, Math.round(60 * pw), 11 * pw, 0.6, FX.sparkSize * 1.5);
        this.spark(p, FX.chakraCore, Math.round(20 * pw), 4, 0.4, FX.sparkSize * 1.2);
        const s = this.timed(this.shocks, p, FX.shockFrom, FX.shockTo * pw, FX.shockLife);
        s.mat.uniforms.color.value.set(FX.chakraColor).multiplyScalar(FX.shockGlow);
        const tilt = this.rand() * 0.5;
        for (let i = 0; i < 2; i++) {
          const w = this.timed(this.swirls, p, FX.swirlFrom, FX.swirlTo * pw, FX.swirlLife, i ? -FX.swirlSpin : FX.swirlSpin);
          w.mesh.rotation.x = i ? 0.9 + tilt : tilt; // one flat, one tilted
          w.mat.color.set(i ? FX.chakraCore : FX.chakraColor).multiplyScalar(FX.swirlGlow);
        }
        const g = this.feet(e.id) ?? tmpP.set(p.x, p.y - FX.techniqueGroundDrop, p.z);
        this.timed(this.cracks, tmpV.set(p.x, g.y + 0.03, p.z), FX.crackSize * pw, FX.crackSize * pw, FX.crackLife);
        this.ring(tmpV, FX.chakraColor, 0.3, 5 * pw, 0.45, 1);
        this.impact(p, FX.starHeavySize * pw, FX.starHeavyLife, false);
        this.flashLight(p, FX.chakraColor, 1.6 * pw);
      }),
      on('chargeStart', (e) => {
        this.charges.set(e.id, { t: 0, full: Math.max(e.fullTime, 0.05), chidori: e.technique === 'chidori', acc: 0, ring: 0, arc: 0, spark: 0, done: false });
        const p = this.feet(e.id);
        if (p) this.ring(p, e.technique === 'chidori' ? FX.chidoriBlue : FX.chakraColor, 0.3, 1.8, 0.3, 0.9);
      }),
      on('chargeRelease', (e) => this.charges.delete(e.id)),
      on('genjutsu', (e) => {
        for (const id of e.targets) {
          const a = this.getActor(id);
          if (!a) continue;
          const c = tmpV.copy(a.position).setY(a.position.y + FX.chestHeight + 0.4);
          this.billboard(c, this.tex.star, FX.genjutsuColor, FX.starGlow * 1.6, FX.starSize, FX.starSize, FX.starHeavyLife, 'pop', id);
          this.spark(c, FX.genjutsuColor, 10, 3, 0.35);
          this.ring(a.position, FX.genjutsuColor, 1.4, 0.3, 0.35, 0.9, id, FX.telegraphGlow);
        }
      }),
      on('grabStart', (e) => {
        this.grabs.set(e.id, e.targetId);
        const c = this.chest(e.targetId);
        if (!c) return;
        this.impact(c, FX.starHeavySize, FX.starLife, false);
        this.spark(c, FX.grabFlash, 14, 5, 0.25);
        this.ring(tmpV.copy(c).setY(c.y - FX.chestHeight), FX.grabFlash, 0.3, 1.6, 0.25, 0.8, null, 1.5);
        this.flashLight(c, FX.grabFlash, 0.9);
      }),
      on('qteInput', (e) => {
        const c = this.chest(this.grabs.get(e.id) ?? -1);
        if (!c) return;
        if (!e.correct) { this.spark(c, FX.telegraphColor, 10, 3, 0.25, FX.sparkSize * 0.8); return; }
        this.impact(c, FX.starHeavySize, FX.starLife, true, FX.hitColor);
        this.spark(c, FX.hitColor, 18, 7, 0.3);
      }),
      on('grabEnd', (e) => {
        this.grabs.delete(e.id);
        if (e.result !== 'complete') return;
        const c = this.chest(e.targetId)?.clone(); // launcherBlast reuses the shared temp vectors
        if (!c) return;
        const s = this.timed(this.shocks, c, FX.shockFrom, FX.finisherShockTo, FX.shockLife);
        s.mat.uniforms.color.value.set(FX.hitColor).multiplyScalar(FX.shockGlow);
        this.impact(c, FX.starKillSize, FX.starHeavyLife, true, FX.hitColor);
        this.spark(c, FX.hitColor, 40, 11, 0.5, FX.sparkSize * 1.4);
        this.launcherBlast(e.targetId, c);
        this.ring(tmpV.copy(c).setY(c.y - FX.chestHeight + 0.05), FX.windColor, 0.3, FX.finisherRingTo, 0.4, 0.8, null, 1.6);
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
      on('speedBoost', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        this.ring(p.setY(p.y + 0.05), FX.chakraColor, 0.3, 2.2, 0.3, 0.8);
        this.spark(p.setY(p.y + 0.4), FX.chakraColor, 14, 5, 0.35);
      }),
      on('chakraDash', (e) => {
        const a = this.getActor(e.id);
        if (!a) return;
        const c = tmpV.copy(a.position).setY(a.position.y + FX.chestHeight);
        this.emit(this.chakra, c, FX.chakraColor, FX.dashBurst, FX.dashBurstSpeed, 0.35, FX.chakraSize, 0.1, 0.3, FX.chakraGlow);
        this.emit(this.chakra, c, FX.chakraCore, FX.dashBurst / 3, FX.dashBurstSpeed * 0.5, 0.25, FX.chakraSize, 0.1, 0.2, FX.chakraGlow);
        this.ring(a.position, FX.chakraColor, 0.3, e.homing ? 2.4 : 1.8, 0.3, 0.9);
        this.poof(tmpV.copy(a.position).setY(a.position.y + 0.1), 6, 2, 0.35, FX.dustSize, 0.5);
        const s = this.streaks.find((x) => x.id === e.id) ?? this.streaks.find((x) => x.id === null && x.fade <= 0) ?? this.streaks.reduce((x, y) => (x.fade < y.fade ? x : y));
        s.id = e.id; s.t = 0; s.fade = 1; s.acc = 0; s.wake = 0; s.anim = 'dash'; s.bolt = 0;
      }),
      on('substitution', (e) => {
        tmpV.set(e.from.x, e.from.y + FX.deathHeight, e.from.z);
        this.poof(tmpV, FX.subPuffs, FX.subPuffSpeed, FX.subPuffLife, FX.subPuffSize, 1);
        this.ring(e.from, FX.smokeColor, 0.4, 2.6, 0.35, 0.7, null, 1.2);
        this.spawnLog(e.from);
        tmpV.set(e.to.x, e.to.y + FX.deathHeight, e.to.z);
        this.poof(tmpV, FX.subToPuffs, FX.subPuffSpeed * 0.6, FX.subPuffLife * 0.7, FX.subPuffSize * 0.6, 0.6);
      }),
      on('concentrateStart', (e) => {
        const p = this.feet(e.id);
        if (!p) return;
        this.ring(p, FX.chakraColor, 1.6, 0.4, 0.5, 0.8);
        this.concentrating.set(e.id, 0);
      }),
    );
  }

  /** Chest position of an actor (copy in tmpP), or null. */
  private chest(id: number): THREE.Vector3 | null {
    const a = this.getActor(id);
    return a ? tmpP.copy(a.position).setY(a.position.y + FX.chestHeight) : null;
  }

  /** One lightning bolt from `p` along `dir` (need not be normalised), `len` metres, flickering out over `life`. */
  private bolt(p: Vec3Like, dir: THREE.Vector3, len: number, life = FX.boltLife): void {
    const b = this.timed(this.bolts, p, 1, 1, life);
    b.mesh.geometry = this.boltGeos[Math.floor(this.rand() * this.boltGeos.length)];
    b.mesh.quaternion.setFromUnitVectors(UP, tmpS.copy(dir).normalize());
    b.mesh.rotateY(this.rand() * Math.PI * 2);
    b.mesh.scale.set(1, len, 1);
  }

  /** Chidori release: burst at the hand, then the dash streak (lightning trail) follows the actor while anim = 'chidori'. */
  private chidoriStart(id: number, p: Vec3Like): void {
    this.spark(p, FX.chidoriColor, 40, 10, 0.35);
    for (let i = 0; i < 5; i++) this.bolt(p, tmpV.set(this.rand() - 0.5, this.rand() - 0.2, this.rand() - 0.5), FX.boltLen * 0.7);
    this.flashLight(p, FX.chidoriBlue, 1.8);
    const g = this.feet(id);
    if (g) this.ring(g, FX.chidoriBlue, 0.3, 2.6, 0.3, 0.9, null, 2.4);
    const s = this.streaks.find((x) => x.id === id) ?? this.streaks.find((x) => x.id === null && x.fade <= 0) ?? this.streaks.reduce((x, y) => (x.fade < y.fade ? x : y));
    s.id = id; s.t = 0; s.fade = 1; s.acc = 0; s.wake = 0; s.anim = 'chidori'; s.bolt = 0;
  }

  /** Sharingan cast: red ring wave out to the genjutsu radius, three rotating comma marks, eye glint. */
  private sharinganWave(id: number, p: Vec3Like): void {
    const g = this.feet(id) ?? tmpP.set(p.x, p.y, p.z);
    const r = COMBAT.sharingan.radius;
    this.ring(g, FX.genjutsuColor, 0.5, r, FX.waveLife, 0.9, null, FX.telegraphGlow);
    this.ring(g, FX.genjutsuDark, 0.3, r * 0.6, FX.waveLife * 0.8, 0.8, null, 1.5);
    const t = this.timed(this.tomoes, tmpV.copy(g).setY(g.y + 0.08), FX.tomoeFrom, FX.tomoeTo, FX.tomoeLife, FX.tomoeSpin);
    t.mat.opacity = 1;
    const a = this.getActor(id);
    if (a) this.billboard(tmpV.copy(a.position).setY(a.position.y + a.height - 0.15), this.tex.glint, FX.genjutsuColor, FX.glintGlow, FX.glintWidth, FX.glintHeight * 0.6, FX.glintLife, 'glint', id);
    this.flashLight(tmpV.copy(g).setY(g.y + 1), FX.genjutsuColor, 1.4);
  }

  /** Converging chakra toward the charging hand + pulsing ground ring; Chidori adds crackling sparks and ground arcs. */
  private updateCharges(dt: number): void {
    for (const [id, c] of this.charges) {
      const a = this.getActor(id);
      if (!a || !a.alive) { this.charges.delete(id); continue; }
      c.t += dt;
      const k = Math.min(c.t / c.full, 1);
      const col = c.chidori ? FX.chidoriColor : FX.chakraColor;
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      const h = tmpV.set(a.position.x + fx * FX.chargeHandFwd, a.position.y + FX.chargeHandUp, a.position.z + fz * FX.chargeHandFwd);
      for (c.acc += FX.chargeRate * (c.chidori ? FX.chidoriChargeRate : 1) * (0.4 + 0.6 * k) * dt; c.acc >= 1; c.acc--) {
        const u = this.rand() * 2 - 1, th = this.rand() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
        const r = FX.chargeRadius * (0.6 + 0.6 * this.rand()), life = FX.chargeLife * (0.7 + 0.3 * this.rand());
        const dx = rr * Math.cos(th), dy = u, dz = rr * Math.sin(th);
        this.spawn(this.chakra, h.x + dx * r, h.y + dy * r, h.z + dz * r, -dx * r / life, -dy * r / life + FX.chakraGravity * life * 0.5, -dz * r / life,
          life, FX.chakraSize * (0.5 + 0.5 * this.rand()), this.rand() < 0.3 ? FX.chakraCore : col, FX.chakraGlow);
      }
      if (this.chakra.mesh.instanceColor) this.chakra.mesh.instanceColor.needsUpdate = true;
      if ((c.ring -= dt) <= 0) {
        c.ring = FX.chargeRingEvery * (1 - 0.5 * k);
        this.ring(a.position, c.chidori ? FX.chidoriBlue : FX.chakraColor, 1.4 + 0.8 * k, 0.3, FX.chargeRingEvery, 0.5 + 0.4 * k);
      }
      if (c.chidori) {
        for (c.spark += FX.chidoriSparkRate * k * dt; c.spark >= 1; c.spark--) this.spark(h, FX.chidoriColor, 1, 4, 0.15, FX.sparkSize * 0.8);
        if ((c.arc -= dt) <= 0) {
          c.arc = FX.chidoriArcEvery;
          this.bolt(h, tmpS.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5), 0.3 + 0.4 * k, FX.boltLife * 0.6);
          if (k >= FX.chidoriArcCharge) { // arc to the ground
            const gx = (this.rand() - 0.5) * 1.6, gz = (this.rand() - 0.5) * 1.6;
            const dir = tmpS.set(gx, -FX.chargeHandUp, gz);
            this.bolt(h, dir, dir.length(), FX.boltLife * 0.8);
          }
        }
      }
      if (k >= 1 && !c.done) { // fully charged: flash
        c.done = true;
        this.ring(a.position, col, 0.3, 2.4, 0.3, 1, null, 2.4);
        this.spark(h, col, 24, 6, 0.3);
      }
    }
  }

  /** Launcher finisher: shock ring on the ground, upward dust column, rising sparks, light flash. */
  private launcherBlast(targetId: number, p: Vec3Like): void {
    const g = this.feet(targetId) ?? tmpP.set(p.x, p.y - FX.hitboxDrop, p.z);
    g.y += 0.05;
    this.ring(g, FX.hitColor, 0.3, FX.launchRingTo, 0.35, 0.9, null, 2.2);
    this.ring(g, FX.windColor, 0.2, FX.launchRingTo * 0.6, 0.25, 0.7, null, 1.4);
    this.emit(this.dust, g, FX.dustColor, FX.launchDust, FX.launchDustSpeed, 0.7, FX.dustSize * 1.3, 1.4, 0.8);
    this.emit(this.sparks, p, FX.hitColor, 18, 10, 0.4, FX.sparkSize, 1.6, 0, FX.sparkGlow);
    this.flashLight(p, FX.hitColor, 1.3);
  }

  private spawnLog(p: Vec3Like): void {
    const l = this.logs.find((x) => x.life <= 0) ?? this.logs.reduce((a, b) => (a.life < b.life ? a : b));
    l.life = FX.logLife; l.vy = 0; l.v = 0; l.roll = 0; l.tilt = FX.logTilt; l.ground = p.y; l.yaw = this.rand() * Math.PI * 2;
    l.mesh.position.set(p.x, p.y + FX.logDrop + FX.logLength / 2, p.z);
    l.mesh.scale.setScalar(1);
    l.mesh.visible = true;
  }

  /** Generic burst at a position. */
  burst(pos: THREE.Vector3, color: number, count = 16): void {
    this.spark(pos, color, count, 6, 0.4);
  }

  /** Number of live particles (all pools). */
  get liveParticles(): number {
    return this.sparks.live + this.chakra.live + this.dust.live + this.lines.live;
  }

  update(dt: number): void {
    this.updateConcentration(dt);
    this.updateCharges(dt);
    this.stepPool(this.sparks, dt);
    this.stepPool(this.chakra, dt);
    this.stepPool(this.dust, dt);
    this.updateStreaks(dt);
    this.stepPool(this.lines, dt);
    this.updateLogs(dt);
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
    for (const b of this.bolts) {
      const k = this.age(b, dt);
      if (k >= 0) b.mat.opacity = (1 - k) * (0.6 + 0.4 * this.rand());
    }
    for (const t of this.tomoes) {
      const k = this.age(t, dt);
      if (k < 0) continue;
      t.mesh.scale.setScalar(t.from + (t.to - t.from) * (1 - (1 - k) ** 2));
      t.mesh.rotation.y += t.spin * dt;
      t.mat.opacity = 1 - k * k;
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

  /** Dash trails: follow the actor while its anim is `dash`, emit speed lines + chakra wake, fade out after. */
  private updateStreaks(dt: number): void {
    for (const s of this.streaks) {
      if (s.fade <= 0) continue;
      const a = s.id !== null ? this.getActor(s.id) : undefined;
      s.t += dt;
      const dashing = !!a && a.alive && (a.anim === s.anim || s.t < FX.dashGrace);
      if (!dashing) { s.id = null; s.fade -= dt / FX.streakFade; }
      if (s.fade <= 0) { s.mesh.visible = false; continue; }
      if (a) {
        const v = a.velocity;
        const sp = Math.hypot(v.x, v.z);
        const yaw = sp > 0.5 ? Math.atan2(v.x, v.z) : a.yaw;
        s.mesh.position.set(a.position.x, a.position.y + FX.chestHeight, a.position.z);
        s.mesh.rotation.set(0, yaw, 0);
        s.mesh.scale.set(1, 1, Math.min(FX.streakMax, Math.max(FX.streakMin, sp * FX.streakPerSpeed)));
        if (dashing) this.dashParticles(s, a.position, yaw, dt);
        if (dashing && s.anim === 'chidori' && (s.bolt -= dt) <= 0) { // lightning crackling along the dash
          s.bolt = FX.boltEvery;
          const c = tmpP.set(a.position.x, a.position.y + FX.chestHeight, a.position.z);
          this.bolt(c, tmpS.set(-Math.sin(yaw) + (this.rand() - 0.5) * 1.2, (this.rand() - 0.5) * 0.8, -Math.cos(yaw) + (this.rand() - 0.5) * 1.2), FX.boltLen * (0.6 + 0.6 * this.rand()));
          this.spark(c, FX.chidoriColor, 3, 4, 0.2, FX.sparkSize * 0.8);
        }
      }
      s.mat.color.set(s.anim === 'chidori' ? FX.chidoriColor : FX.chakraColor).multiplyScalar(FX.streakGlow * s.fade);
      s.mesh.visible = true;
    }
  }

  private dashParticles(s: Streak, p: THREE.Vector3, yaw: number, dt: number): void {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (s.acc += FX.lineRate * dt; s.acc >= 1; s.acc--) {
      const th = this.rand() * Math.PI * 2, r = FX.lineRadius * (0.4 + 0.6 * this.rand());
      // ring around the dash axis: sideways offset (perpendicular to forward) + height
      const side = Math.cos(th) * r, up = FX.chestHeight + Math.sin(th) * r;
      const ahead = (this.rand() - 0.2) * 1.2;
      this.spawn(this.lines, p.x + fz * side + fx * ahead, p.y + up, p.z - fx * side + fz * ahead,
        -fx * FX.lineSpeed, 0, -fz * FX.lineSpeed, FX.lineLife, FX.lineSize * (0.6 + 0.8 * this.rand()),
        this.rand() < 0.5 ? FX.windColor : FX.chakraCore, FX.lineGlow);
    }
    for (s.wake += FX.wakeRate * dt; s.wake >= 1; s.wake--) {
      this.spawn(this.chakra, p.x + (this.rand() - 0.5) * 0.4, p.y + 0.2 + this.rand() * 1.4, p.z + (this.rand() - 0.5) * 0.4,
        -fx * 2, 0.5, -fz * 2, FX.wakeLife * (0.6 + 0.4 * this.rand()), FX.chakraSize * (0.5 + 0.6 * this.rand()),
        this.rand() < 0.3 ? FX.chakraCore : FX.chakraColor, FX.chakraGlow);
    }
    for (const pool of [this.lines, this.chakra]) if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
  }

  private updateLogs(dt: number): void {
    for (const l of this.logs) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.life <= 0) { l.mesh.visible = false; continue; }
      const m = l.mesh;
      l.vy -= FX.gravity * dt;
      m.position.y += l.vy * dt;
      const rest = l.ground + FX.logRadius;
      if (m.position.y <= rest) {
        m.position.y = rest;
        if (l.vy < -1) { l.vy *= -FX.logBounce; if (l.v === 0) l.v = FX.logRollSpeed; } else l.vy = 0;
        l.tilt += (0 - l.tilt) * (1 - Math.exp(-FX.logSettle * dt)); // topple flat
      }
      l.v *= Math.exp(-FX.logRollDrag * dt);
      m.position.x += Math.sin(l.yaw) * l.v * dt;
      m.position.z += Math.cos(l.yaw) * l.v * dt;
      l.roll += (l.v / FX.logRadius) * dt;
      m.rotation.set(l.roll, l.yaw, l.tilt); // yaw keeps the log axis (X) perpendicular to its roll direction
      m.scale.setScalar(Math.min(1, l.life / FX.logShrink));
    }
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
    for (const s of this.streaks) { s.id = null; s.fade = 0; s.mesh.visible = false; }
    for (const l of this.logs) { l.life = 0; l.mesh.visible = false; }
    for (const pool of [this.sparks, this.chakra, this.dust, this.lines]) {
      pool.life.fill(0);
      pool.live = 0;
      for (let i = 0; i < pool.life.length; i++) pool.mesh.setMatrixAt(i, ZERO_M);
      pool.mesh.count = 0;
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const r of this.rings) { r.life = 0; r.follow = null; r.mesh.visible = false; }
    for (const b of this.bills) { b.life = 0; b.follow = null; b.sprite.visible = false; }
    for (const t of [...this.shocks, ...this.swirls, ...this.cracks, ...this.bolts, ...this.tomoes]) { t.life = 0; t.mesh.visible = false; }
    for (const l of this.lights) { l.t = 0; l.light.intensity = 0; }
    this.concentrating.clear();
    this.charges.clear();
    this.grabs.clear();
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.clear();
    for (const s of this.streaks) { s.mat.dispose(); s.mesh.removeFromParent(); }
    for (const l of this.logs) l.mesh.removeFromParent();
    this.logMats.forEach((m) => m.dispose());
    for (const g of [this.streakGeo, this.logGeo]) g.dispose();
    for (const pool of [this.sparks, this.chakra, this.dust, this.lines]) {
      pool.mesh.geometry.dispose();
      (pool.mesh.material as THREE.Material).dispose();
      pool.mesh.dispose();
      pool.mesh.removeFromParent();
    }
    for (const r of this.rings) { r.mat.dispose(); r.mesh.removeFromParent(); }
    for (const b of this.bills) { b.mat.dispose(); b.sprite.removeFromParent(); }
    for (const t of [...this.shocks, ...this.swirls, ...this.cracks, ...this.bolts, ...this.tomoes]) { t.mat.dispose(); t.mesh.removeFromParent(); }
    for (const g of [this.ringGeo, this.shockGeo, this.swirlGeo, this.crackGeo, this.tomoeGeo, ...this.boltGeos]) g.dispose();
    for (const t of Object.values(this.tex)) t.dispose();
    for (const l of this.lights) { l.light.dispose(); l.light.removeFromParent(); }
  }
}
