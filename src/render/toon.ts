import * as THREE from 'three';

/** Shared 3-band gradient map for MeshToonMaterial (created once, lives for the app). */
let gradient: THREE.DataTexture | null = null;
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const bands = new Uint8Array([90, 170, 255]); // shadow, mid, lit
  const data = new Uint8Array(bands.length * 4);
  bands.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gradient = new THREE.DataTexture(data, bands.length, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export function toon(color: number, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}
