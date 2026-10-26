import * as THREE from 'three';

/**
 * Shared 2-band anime gradient (hard terminator between shadow and light), created once, lives for the app.
 * Shadow band is fairly bright: hemisphere light tints it cool so shadows read blue-violet, not black.
 */
let gradient: THREE.DataTexture | null = null;
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const bands = new Uint8Array([105, 105, 255, 255]); // shadow, shadow, lit, lit → threshold at N·L ≈ 0.5 of the ramp
  const data = new Uint8Array(bands.length * 4);
  bands.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gradient = new THREE.DataTexture(data, bands.length, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export interface ToonOptions extends THREE.MeshToonMaterialParameters {
  /** Fresnel rim highlight strength (0 disables). Characters use more than scenery. */
  rim?: number;
}

/**
 * Rim light: bright fresnel edge tinted by the surface colour, the classic anime "back light".
 * `m.userData.rimTint` (a Color, black = off) adds an extra coloured edge, e.g. PvP team colours.
 */
function addRim(m: THREE.MeshToonMaterial, strength: number): void {
  const tint = new THREE.Color(0);
  m.userData.rimTint = tint;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: strength };
    shader.uniforms.rimTint = { value: tint };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float rimStrength;\nuniform vec3 rimTint;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        `{
          float fres = 1.0 - saturate(dot(normalize(normal), normalize(vViewPosition)));
          float rim = smoothstep(0.62, 0.78, fres) * rimStrength;
          outgoingLight += (diffuseColor.rgb * 0.5 + vec3(0.35, 0.38, 0.45)) * rim;
          outgoingLight = mix(outgoingLight, rimTint * 1.3, smoothstep(0.45, 0.72, fres) * step(0.001, dot(rimTint, rimTint)));
        }
        #include <opaque_fragment>`,
      );
  };
  // Distinct program per strength bucket, shared across materials with the same strength.
  m.customProgramCacheKey = () => `toon-rim-${strength.toFixed(2)}`;
}

export function toon(color: number, extra: ToonOptions = {}): THREE.MeshToonMaterial {
  const { rim = 0.35, ...params } = extra;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...params });
  if (rim > 0) addRim(m, rim);
  return m;
}
