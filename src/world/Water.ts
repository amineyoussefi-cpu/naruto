import * as THREE from 'three';
import { heightAt, WORLD } from './terrain';

/** Stylised water look (render-only). */
export const WATER = {
  /** Near water grid (walkable collider too): bounds and cell size; a cell is kept when a corner is below water + keep. */
  near: { min: -132, max: 132, maxZ: 134, cell: 2, keep: 0.25 },
  /** Far sea plane out to the horizon: half size, start z, depth value fed to the shader. */
  far: { half: 700, z0: 30, depth: 12, drop: 0.15 },
  colors: { bed: 0xd9cf9e, shallow: 0x5fe3d6, mid: 0x26b3c9, deep: 0x1f6fb0, foam: 0xffffff, sky: 0xcfeef7, sun: 0xfff0c8 },
  /** Small vertex wave amplitude (m), scaled by depth so shores stay put. */
  wave: 0.05,
  /** Sun glitter brightness (> 1 so the glare path blooms). */
  glitter: 1.6,
};

const VERT = /* glsl */ `
attribute float depth;
uniform float time;
varying float vDepth; varying vec3 vWorld;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float a = clamp(depth, 0.0, 1.0);
  wp.y += (sin(wp.x * 0.35 + time * 1.3) + sin(wp.z * 0.27 - time * 1.1)) * WAVE * a;
  vDepth = depth; vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float time; uniform vec3 sunDir; uniform vec3 bed; uniform vec3 shallow; uniform vec3 mid; uniform vec3 deep;
uniform vec3 foam; uniform vec3 sky; uniform vec3 sunCol;
varying float vDepth; varying vec3 vWorld;
#include <fog_pars_fragment>
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
void main(){
  float d = vDepth;
  vec2 p = vWorld.xz;
  // Depth tint: sandy bed shows through the shallows, turquoise → teal → deep blue toward the sea.
  vec3 col = mix(bed, shallow, smoothstep(0.0, 0.5, d));
  col = mix(col, mid, smoothstep(0.7, 2.6, d));
  col = mix(col, deep, smoothstep(3.0, 9.0, d));
  // Drifting light bands (cel caustics), fading with depth.
  float n = vn(p * 0.18 + vec2(time * 0.05, time * 0.03)) + 0.5 * vn(p * 0.45 - vec2(time * 0.07, -time * 0.04));
  float band = smoothstep(0.80, 0.84, n) - smoothstep(0.90, 0.95, n);
  col += vec3(0.16, 0.2, 0.2) * band * (1.0 - smoothstep(1.5, 6.0, d));
  // Shore foam: a solid rim plus a pulsing second line.
  float fw = 0.12 + 0.05 * sin(time * 1.6 + n * 6.0);
  float f = 1.0 - smoothstep(fw, fw + 0.05, d);
  float f2 = smoothstep(0.32, 0.36, d + 0.04 * sin(time * 1.2 + p.x * 0.3)) - smoothstep(0.38, 0.42, d + 0.04 * sin(time * 1.2 + p.x * 0.3));
  col = mix(col, foam, max(f, f2 * 0.7));
  // Fresnel sky tint and sun glitter path (perturbed normal, quantised sparkles).
  vec3 V = normalize(cameraPosition - vWorld);
  float gx = vn(p * 1.3 + time * 0.6) - 0.5, gz = vn(p.yx * 1.3 - time * 0.5) - 0.5;
  vec3 N = normalize(vec3(gx * 0.35, 1.0, gz * 0.35));
  col = mix(col, sky, pow(1.0 - max(V.y, 0.0), 5.0) * 0.6);
  vec3 R = reflect(-V, N);
  float s = max(dot(R, sunDir), 0.0);
  col += sunCol * (pow(s, 12.0) * 0.25 + step(0.985, s) * GLITTER) * smoothstep(0.3, 1.0, d);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

/** Shared animated water material (opaque: the bed is painted from depth, so no sorting issues). */
export function waterMaterial(sunDir: THREE.Vector3): THREE.ShaderMaterial {
  const C = WATER.colors, col = (h: number) => ({ value: new THREE.Color(h) });
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, sunDir: { value: sunDir.clone().normalize() }, bed: col(C.bed), shallow: col(C.shallow), mid: col(C.mid),
      deep: col(C.deep), foam: col(C.foam), sky: col(C.sky), sunCol: col(C.sun),
    }]),
    defines: { WAVE: WATER.wave.toFixed(3), GLITTER: WATER.glitter.toFixed(2) },
    vertexShader: VERT, fragmentShader: FRAG, fog: true,
  });
  return m;
}

/**
 * Near water surface: grid cells over the valley where the terrain dips below the water line, with a per-vertex
 * `depth` (water − terrain) for colour and foam. The same geometry is the walk-on-water collider.
 */
export function nearWaterGeometry(): THREE.BufferGeometry {
  const N = WATER.near, wy = WORLD.waterY, n = Math.round((N.max - N.min) / N.cell), nz = Math.round((N.maxZ - N.min) / N.cell);
  const pos: number[] = [], depth: number[] = [], idx: number[] = [];
  const h = new Float32Array((n + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= n; i++) {
    const x = N.min + i * N.cell, z = N.min + j * N.cell;
    h[j * (n + 1) + i] = heightAt(x, z);
    pos.push(x, wy, z);
    depth.push(wy - h[j * (n + 1) + i]);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    if (Math.min(h[a], h[b], h[c], h[d]) > wy + N.keep) continue;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  g.setIndex(idx);
  return g;
}

/** Big flat sea plane out to the horizon (just under the near grid, which overdraws it near the coast). */
export function farSeaGeometry(): THREE.BufferGeometry {
  const F = WATER.far, y = WORLD.waterY - F.drop;
  const g = new THREE.PlaneGeometry(F.half * 2, F.half, 24, 12).rotateX(-Math.PI / 2).translate(0, y, F.z0 + F.half / 2);
  g.setAttribute('depth', new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count).fill(F.depth), 1));
  return g;
}
