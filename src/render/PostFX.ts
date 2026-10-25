import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Post-processing tuning (anime look). Render-only. */
export const POSTFX = {
  /** Ink line width in pixels at 1080p; scales with resolution. */
  inkWidth: 2.2,
  /** Relative inverse-depth Laplacian above which a pixel is inked. */
  inkThreshold: 0.035,
  inkColor: new THREE.Color(0x14101c),
  /** Ink fades out between these view distances (m) so distant scenery stays clean. */
  inkFadeNear: 60,
  inkFadeFar: 140,
  saturation: 1.06,
  contrast: 1.06,
  vignette: 0.28,
  bloomStrength: 0.75,
  bloomRadius: 0.45,
  /** Linear HDR luminance above which pixels bloom: only emissive "glow" materials exceed it. */
  bloomThreshold: 1.0,
  msaaSamples: 4,
} as const;

const InkShader = {
  uniforms: {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 500 },
    inkWidth: { value: POSTFX.inkWidth },
    inkThreshold: { value: POSTFX.inkThreshold },
    inkColor: { value: POSTFX.inkColor },
    inkFade: { value: new THREE.Vector2(POSTFX.inkFadeNear, POSTFX.inkFadeFar) },
    saturation: { value: POSTFX.saturation },
    contrast: { value: POSTFX.contrast },
    vignette: { value: POSTFX.vignette },
    speedLines: { value: 0 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tColor; uniform sampler2D tDepth;
    uniform vec2 resolution; uniform float cameraNear; uniform float cameraFar;
    uniform float inkWidth; uniform float inkThreshold; uniform vec3 inkColor; uniform vec2 inkFade;
    uniform float saturation; uniform float contrast; uniform float vignette;
    uniform float speedLines; uniform float time;
    varying vec2 vUv;

    float viewDist(vec2 uv) {
      return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
    }
    float hash(float n) { return fract(sin(n * 91.345) * 47453.5453); }

    void main() {
      vec3 col = texture2D(tColor, vUv).rgb;

      // Ink: Laplacian of inverse depth. 1/z is linear across planes in screen space, so flat surfaces
      // give zero and only silhouettes and creases are inked.
      vec2 px = inkWidth * (resolution.y / 1080.0) / resolution;
      float d = viewDist(vUv);
      float w = 1.0 / d;
      float wl = 1.0 / viewDist(vUv - vec2(px.x, 0.0));
      float wr = 1.0 / viewDist(vUv + vec2(px.x, 0.0));
      float wd = 1.0 / viewDist(vUv - vec2(0.0, px.y));
      float wu = 1.0 / viewDist(vUv + vec2(0.0, px.y));
      float lap = abs(wl + wr + wd + wu - 4.0 * w) / w;
      // Silhouette term: a neighbour much nearer than this pixel (object edge against background).
      float sil = max(max(wl, wr), max(wd, wu)) / w - 1.0;
      float edge = smoothstep(inkThreshold, inkThreshold * 2.5, max(lap, sil * 0.6));
      edge *= 1.0 - smoothstep(inkFade.x, inkFade.y, d);
      col = mix(col, inkColor, edge * 0.92);

      // Grade: saturation + contrast around mid grey, in linear space.
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.18) * contrast + 0.18;
      col = max(col, 0.0);

      // Anime speed lines: radial streaks toward the screen edge while sprinting / dashing.
      if (speedLines > 0.001) {
        vec2 c = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
        float r = length(c);
        float a = atan(c.y, c.x);
        float bucket = floor(a * 70.0);
        float on = step(0.72, hash(bucket + floor(time * 18.0) * 13.0));
        float streak = on * smoothstep(0.32, 0.75, r) * speedLines;
        col = mix(col, vec3(1.0), streak * 0.55);
      }

      // Vignette.
      vec2 v = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.35, 0.85, length(v) * 1.2);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/**
 * Anime post-processing: scene → HDR multisampled target (with depth) → ink outlines + grading +
 * speed lines → bloom (emissive chakra only) → tone mapping / sRGB. `enabled = false` renders directly.
 */
export class PostFX {
  enabled = true;
  /** 0..1, eased toward by the game from player speed. */
  speedLines = 0;
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly composer: EffectComposer;
  private readonly ink: ShaderPass;
  private readonly bloom: UnrealBloomPass;
  private time = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera) {
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: POSTFX.msaaSamples,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    });
    this.composer = new EffectComposer(renderer);
    this.ink = new ShaderPass(InkShader, 'tUnused');
    this.ink.uniforms.tColor.value = this.sceneRT.texture;
    this.ink.uniforms.tDepth.value = this.sceneRT.depthTexture;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), POSTFX.bloomStrength, POSTFX.bloomRadius, POSTFX.bloomThreshold);
    this.composer.addPass(this.ink);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio();
    this.sceneRT.setSize(Math.floor(w * pr), Math.floor(h * pr));
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.ink.uniforms.resolution.value.set(w * pr, h * pr);
  }

  render(frameDt: number): void {
    if (!this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.time += frameDt;
    const u = this.ink.uniforms;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    u.speedLines.value = this.speedLines;
    u.time.value = this.time;
    this.renderer.setRenderTarget(this.sceneRT);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.composer.render(frameDt);
  }

  dispose(): void {
    this.sceneRT.depthTexture?.dispose();
    this.sceneRT.dispose();
    this.composer.dispose();
    this.bloom.dispose();
  }
}

/**
 * Emissive "glow" material: colour pushed above 1.0 in linear HDR so it blooms
 * (bloom threshold is 1.0, nothing lit by the sun reaches that).
 */
export function glowMaterial(color: number, intensity = 2.5, extra: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ ...extra });
  m.color.setHex(color).multiplyScalar(intensity);
  return m;
}
