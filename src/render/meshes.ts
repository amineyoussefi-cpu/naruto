import * as THREE from 'three';
import { toon } from './toon';

/** Shuriken spin (radians per metre travelled). Distance-based so it freezes with the simulation on pause. */
const SHURIKEN_SPIN_PER_M = 1.7;

/**
 * Projectile meshes, pointing along +Z. Every call builds its own geometry/materials so callers can
 * free them with `disposeObject`. The shuriken spins by itself (render-time `onBeforeRender`, by distance flown) and is
 * tagged `userData.spin = true`; callers need not animate it.
 */
export function createProjectileMesh(visual: 'kunai' | 'shuriken' | 'chakra'): THREE.Object3D {
  const g = new THREE.Group();
  if (visual === 'kunai') {
    const steel = toon(0xb9c3cc, { emissive: 0x1a1f26 });
    const wrap = toon(0x2a2a33);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 4).rotateX(Math.PI / 2), steel);
    blade.scale.set(1, 0.35, 1); // flat diamond blade
    blade.position.z = 0.12;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6).rotateX(Math.PI / 2), wrap);
    grip.position.z = -0.12;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 4, 10).rotateY(Math.PI / 2), steel);
    ring.position.z = -0.23;
    g.add(blade, grip, ring);
  } else if (visual === 'shuriken') {
    const shape = new THREE.Shape();
    const pts = 4, outer = 0.2, inner = 0.055;
    for (let i = 0; i < pts * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / (pts * 2)) * Math.PI * 2;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.022, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, 0.0075, 0), toon(0x9aa4ae, { emissive: 0x151a20 }));
    g.add(star);
    g.userData.spin = true;
    const last = new THREE.Vector3(NaN, 0, 0);
    // Render-only spin around the vertical axis of the flat star, proportional to distance flown.
    star.onBeforeRender = () => {
      if (!Number.isNaN(last.x)) star.rotation.y += Math.min(g.position.distanceTo(last), 2) * SHURIKEN_SPIN_PER_M;
      last.copy(g.position);
    };
  } else {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe6f8ff }));
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x3aa8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    g.add(core, shell);
  }
  return g;
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
