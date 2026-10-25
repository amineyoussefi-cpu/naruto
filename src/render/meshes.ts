import * as THREE from 'three';
import { toon } from './toon';
import { glowMaterial } from './PostFX';
import { trailGeometry } from './fx/shapes';

/** Shuriken spin (radians per metre travelled). Distance-based so it freezes with the simulation on pause. */
const SHURIKEN_SPIN_PER_M = 1.7;
/** Projectile glow look: trail length/width (m), colours and HDR intensities (> 1 blooms). */
const PROJ = {
  kunaiTrail: { length: 1.3, width: 0.09, color: 0x9fdcff, intensity: 2.2 },
  shurikenTrail: { length: 0.9, width: 0.14, color: 0xff3b1f, intensity: 2.2 },
  shurikenHalo: { inner: 0.2, outer: 0.3, color: 0xff3b1f, intensity: 1.6, opacity: 0.55 },
  chakraCore: 3, chakraShell: 1.6,
};

/** Additive glowing trail behind an object pointing along +Z. */
function trail(t: { length: number; width: number; color: number; intensity: number }): THREE.Mesh {
  const m = new THREE.Mesh(
    trailGeometry(t.length, t.width),
    glowMaterial(t.color, t.intensity, { vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.renderOrder = 2;
  return m;
}

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
    const tr = trail(PROJ.kunaiTrail);
    tr.position.z = -0.1;
    g.add(blade, grip, ring, tr);
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
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, 0.0075, 0), toon(0x9aa4ae, { emissive: 0x3a0e08 }));
    // Enemy shuriken: faint red halo + streak so it reads from distance.
    const h = PROJ.shurikenHalo;
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(h.inner, h.outer, 24).rotateX(-Math.PI / 2),
      glowMaterial(h.color, h.intensity, { transparent: true, opacity: h.opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    halo.renderOrder = 2;
    g.add(star, halo, trail(PROJ.shurikenTrail));
    g.userData.spin = true;
    const last = new THREE.Vector3(NaN, 0, 0);
    // Render-only spin around the vertical axis of the flat star, proportional to distance flown.
    star.onBeforeRender = () => {
      if (!Number.isNaN(last.x)) star.rotation.y += Math.min(g.position.distanceTo(last), 2) * SHURIKEN_SPIN_PER_M;
      last.copy(g.position);
    };
  } else {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), glowMaterial(0xe6f8ff, PROJ.chakraCore));
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 14, 10),
      glowMaterial(0x3aa8ff, PROJ.chakraShell, { transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
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
