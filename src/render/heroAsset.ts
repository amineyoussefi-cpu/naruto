import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Blender-made player character ("Ren", built by tools/blender/build_hero.py → public/models/hero.glb).
 *
 * The GLB holds one node per rigid body part, named after the NinjaModel joint it hangs from, with its
 * geometry already expressed relative to that joint. NinjaModel parents each part to the matching joint
 * group, so every procedural animation drives the Blender model unchanged.
 */
export const HERO_PARTS = [
  'pelvis', 'torso', 'head',
  'upperArm_L', 'upperArm_R', 'forearm_L', 'forearm_R',
  'thigh_L', 'thigh_R', 'shin_L', 'shin_R',
] as const;
export type HeroPartName = (typeof HERO_PARTS)[number];

export interface HeroPrimitive {
  /** Blender material name (e.g. 'hoodie', 'skin', 'iris'). */
  material: string;
  /** sRGB hex colour from Blender. */
  color: number;
}
/** One body part: a single geometry whose groups map, in order, to `prims` (one draw call list, one mesh). */
export interface HeroPart {
  geometry: THREE.BufferGeometry;
  prims: HeroPrimitive[];
}
export type HeroParts = ReadonlyMap<HeroPartName, HeroPart>;

let loaded: HeroParts | null = null;

/** Face markings drawn as thin decals: rendered unlit, pulled toward the camera to avoid z-fighting. */
const DECAL_LAYER: Record<string, number> = {
  eye_white: 1, mouth: 1, ink: 2, iris: 2, pupil: 3, highlight: 4,
};
/** Thin strips lying on the hoodie (zipper, pocket welts, strings). */
const SURFACE_DECAL = new Set(['zipper', 'trim', 'string']);

export function isHeroDecal(material: string): boolean {
  return material in DECAL_LAYER;
}

/** Unlit material for a face decal (shared per colour/layer). */
const decalCache = new Map<string, THREE.MeshBasicMaterial>();
export function heroDecalMaterial(p: HeroPrimitive): THREE.MeshBasicMaterial {
  const key = `${p.material}:${p.color}`;
  let m = decalCache.get(key);
  if (!m) {
    const layer = DECAL_LAYER[p.material] ?? 1;
    m = new THREE.MeshBasicMaterial({
      color: p.color, polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer * 2,
    });
    decalCache.set(key, m);
  }
  return m;
}

/** Extra toon-material params for a part (surface strips get a small depth bias). */
export function heroSurfaceParams(material: string): THREE.MeshToonMaterialParameters {
  return SURFACE_DECAL.has(material) ? { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 } : {};
}

/** Load the hero GLB once. Resolves false (and the game keeps the procedural look) if it is missing. */
export async function loadHeroAsset(url = 'models/hero.glb'): Promise<boolean> {
  if (loaded) return true;
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const parts = new Map<HeroPartName, HeroPart>();
    for (const name of HERO_PARTS) {
      const node = gltf.scene.getObjectByName(name);
      if (!node) throw new Error(`hero.glb has no "${name}" part`);
      const prims: HeroPrimitive[] = [];
      const geos: THREE.BufferGeometry[] = [];
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        prims.push({ material: mat.name || 'skin', color: mat.color.getHex() });
        geos.push(mesh.geometry);
      });
      const geometry = mergeGeometries(geos, true);
      if (!geometry) throw new Error(`hero.glb part "${name}" could not be merged`);
      geos.forEach((g) => g.dispose());
      parts.set(name, { geometry, prims });
    }
    loaded = parts;
    return true;
  } catch (err) {
    console.warn('[hero] Blender model not loaded, using the procedural character instead:', err);
    return false;
  }
}

/** The loaded parts, or null before/without a successful loadHeroAsset(). */
export function heroParts(): HeroParts | null {
  return loaded;
}
