import * as THREE from 'three';
import { toon } from '../render/toon';
import { Batcher } from './Batcher';

/** Sky look (colours from the art direction palette). */
export const SKY = {
  radius: 450,
  top: 0x3a86dc, horizon: 0xcdeaf2, bottom: 0xd6ecef,
  /** Warm pale-yellow glow on the horizon around the sun (low over the sea), and the sun disc (> 1: blooms). */
  sunGlow: 0xfff0c0, sunGlowPower: 3.0, sunDisc: 2.2,
  cloudLit: 0xf8f8ff, cloudShade: 0xc9c3e6,
  /** fbm threshold: higher = fewer clouds. */
  cloudCover: 0.6,
  /** Shadow crescent: uv shift away from the sun, and how deep inside the cloud the lit core starts. */
  shadeShift: 0.16, shadeDepth: 0.04,
  /** Cloud layer zoom (bigger = smaller clouds). */
  cloudScale: 2.0,
  /** Drift speed of the cloud layer (uv units / s). */
  cloudDrift: [0.012, 0.004] as const,
  /** Sun halo strength (kept < 1 so the sky never blooms). */
  haloStrength: 0.35,
  /** 3D cloud clusters on the horizon: count, ring radius range, height range, puff scale range. */
  clusters: 9, clusterRadius: [300, 380] as const, clusterHeight: [70, 140] as const, puffScale: [14, 28] as const,
  /** Slow rotation of the cluster ring (rad / s). */
  clusterSpin: 0.0015,
  /** Lilac emissive fill so cloud shadow sides read lilac, not grey. */
  clusterShadeEmissive: 0x3a3450,
};

const VERT = /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const FRAG = /* glsl */ `
uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 cloudLit; uniform vec3 cloudShade;
uniform vec3 sunDir; uniform vec3 sunGlow; uniform float glowPow; uniform float disc; uniform float time; uniform float cover; uniform float scale; uniform vec2 drift; uniform float halo; uniform float shadeShift; uniform float shadeDepth;
varying vec3 vP;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
void main(){
  vec3 d = normalize(vP); float h = d.y;
  vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, bottom, pow(-h, 0.4));
  vec2 dh = normalize(d.xz + 1e-4), sh = normalize(sunDir.xz + 1e-4);
  c = mix(c, sunGlow, pow(max(dot(dh, sh), 0.0), glowPow) * (1.0 - smoothstep(-0.05, 0.45, h)) * 0.85);
  c += vec3(1.0, 0.93, 0.8) * pow(max(dot(d, sunDir), 0.0), 20.0) * halo;
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * scale + drift * time;
    float n = fbm(uv);
    // Lit part = the cloud's dense core shifted toward the sun, so the anti-sun side keeps a lilac crescent.
    float n2 = fbm(uv - normalize(sunDir.xz + 1e-4) * shadeShift);
    float aa = fwidth(n) + 1e-4, aa2 = fwidth(n2) + 1e-4;
    float fade = smoothstep(0.03, 0.22, h);
    float body = smoothstep(cover, cover + aa, n) * fade;
    float shade = 1.0 - smoothstep(cover + shadeDepth, cover + shadeDepth + aa2, n2);
    c = mix(c, mix(cloudLit, cloudShade, shade), body);
  }
  c = min(c, vec3(0.98));
  c += vec3(1.0, 0.95, 0.85) * smoothstep(0.9990, 0.9996, dot(d, sunDir)) * disc;
  gl_FragColor = vec4(c, 1.0);
}`;

/** Gradient + cel-cloud sky dome and a ring of puffy 3D cloud clusters. Everything is added to `group`. */
export function buildSky(group: THREE.Group, sunDir: THREE.Vector3, own: <T extends { dispose(): void }>(x: T) => T): void {
  const hash = (n: number) => { const s = Math.sin(n * 91.7 + 17.3) * 43758.5453; return s - Math.floor(s); };
  const uniforms = {
    top: { value: new THREE.Color(SKY.top) }, horizon: { value: new THREE.Color(SKY.horizon) }, bottom: { value: new THREE.Color(SKY.bottom) },
    cloudLit: { value: new THREE.Color(SKY.cloudLit) }, cloudShade: { value: new THREE.Color(SKY.cloudShade) },
    sunDir: { value: sunDir.clone().normalize() }, sunGlow: { value: new THREE.Color(SKY.sunGlow) }, glowPow: { value: SKY.sunGlowPower }, disc: { value: SKY.sunDisc }, time: { value: 0 }, cover: { value: SKY.cloudCover },
    scale: { value: SKY.cloudScale }, drift: { value: new THREE.Vector2(...SKY.cloudDrift) }, halo: { value: SKY.haloStrength },
    shadeShift: { value: SKY.shadeShift }, shadeDepth: { value: SKY.shadeDepth },
  };
  const sky = new THREE.Mesh(
    own(new THREE.SphereGeometry(SKY.radius, 32, 16)),
    own(new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false })),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);

  // Puffy clusters: each is a few overlapping spheres, flattened at the bottom like cumulus.
  const puffGeo = own(new THREE.IcosahedronGeometry(1, 2));
  const b = new Batcher();
  for (let i = 0; i < SKY.clusters; i++) {
    const a = (i / SKY.clusters) * Math.PI * 2 + hash(i) * 0.3;
    const r = SKY.clusterRadius[0] + hash(i * 3.1) * (SKY.clusterRadius[1] - SKY.clusterRadius[0]);
    const y = SKY.clusterHeight[0] + hash(i * 5.7) * (SKY.clusterHeight[1] - SKY.clusterHeight[0]);
    const k = SKY.puffScale[0] + hash(i * 7.3) * (SKY.puffScale[1] - SKY.puffScale[0]);
    b.frame(Math.cos(a) * r, y, Math.sin(a) * r, -a);
    const puffs = 5 + Math.floor(hash(i * 2.2) * 4);
    for (let j = 0; j < puffs; j++) {
      const t = j / (puffs - 1) - 0.5;
      const ps = k * (1 - Math.abs(t) * 0.9) * (0.8 + hash(i * 13 + j) * 0.4);
      b.put(puffGeo, 0xffffff, 0, ps * 0.35 + hash(j + i) * k * 0.2, t * k * 3.2, ps * 1.1, ps, ps * 1.1);
    }
  }
  const cloudMat = own(toon(0xffffff, { rim: 0, fog: false, emissive: SKY.clusterShadeEmissive }));
  const clouds = new THREE.Group();
  for (const im of b.build(cloudMat)) { clouds.add(im); own(im); }
  group.add(clouds);

  // Render-only drift (frame clock, never touches the simulation).
  // The dome and the cloud ring follow the camera so the 3× map never clips the sky (camera far plane).
  sky.onBeforeRender = (_r, _s, cam) => {
    sky.position.copy(cam.position);
    sky.updateMatrixWorld();
    clouds.position.set(cam.position.x, 0, cam.position.z);
    const t = performance.now() / 1000;
    uniforms.time.value = t;
    clouds.rotation.y = t * SKY.clusterSpin;
  };
}
