import * as THREE from 'three';
import type { AnimState } from '../core/types';

export interface NinjaLook {
  /** Main outfit colour. */
  outfit: number;
  /** Secondary (vest, trim). */
  accent: number;
  hair: number;
  skin: number;
  /** Headband plate colour. */
  headband: number;
  /** Optional mask (enemies). */
  mask?: boolean;
  scale?: number;
}

/**
 * Procedurally animated low-poly ninja. Feet at local origin, faces +Z.
 * Owner: visuals agent. STUB.
 */
export class NinjaModel {
  readonly root = new THREE.Group();
  constructor(readonly look: NinjaLook) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 4, 8), new THREE.MeshToonMaterial({ color: look.outfit }));
    m.position.y = 0.9;
    m.castShadow = true;
    this.root.add(m);
  }
  /** `speed` is horizontal m/s; `animTime` seconds since the state started. */
  update(_dt: number, _anim: AnimState, _animTime: number, _speed: number): void {}
  /** Visual warning that an attack is coming (glow/flash on weapon arm). */
  setTelegraph(_on: boolean): void {}
  /** Brief white/red hit flash. */
  flash(_seconds: number): void {}
  /** Chakra aura (concentration, special). */
  setAura(_on: boolean, _color?: number): void {}
  /** Guard bubble/pose highlight. */
  setGuard(_on: boolean): void {}
  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    this.root.removeFromParent();
  }
}
