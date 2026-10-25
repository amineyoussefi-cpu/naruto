import type * as THREE from 'three';
import type { EventBus } from '../core/events';

/**
 * Particles, impact flashes, chakra bursts, telegraph rings, hit-stop and shake requests.
 * Listens to gameplay events. Owner: visuals agent. STUB.
 */
export class Effects {
  constructor(private readonly scene: THREE.Scene, private readonly events: EventBus) {}
  /** Generic burst at a position. */
  burst(_pos: THREE.Vector3, _color: number, _count?: number): void { void this.scene; void this.events; }
  update(_dt: number): void {}
  clear(): void {}
  dispose(): void {}
}
