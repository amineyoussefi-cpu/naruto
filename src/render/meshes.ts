import * as THREE from 'three';

/** Projectile meshes. Pointing along +Z. Owner: visuals agent. STUB. */
export function createProjectileMesh(visual: 'kunai' | 'shuriken' | 'chakra'): THREE.Object3D {
  const color = visual === 'chakra' ? 0x55ccff : 0x888888;
  return new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color }));
}

export function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.geometry.dispose();
      const m = c.material as THREE.Material | THREE.Material[];
      (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    }
  });
  o.removeFromParent();
}
