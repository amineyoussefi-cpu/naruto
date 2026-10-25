import * as THREE from 'three';
import { CAMERA } from '../config/camera';
import type { Actor } from '../game/Actor';
import type { GameContext } from '../game/context';

/**
 * Third-person orbit camera with wall avoidance and lock-on. Owner: camera agent.
 * STUB.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 500);
  /** Horizontal look angle; yaw 0 looks toward +Z. Movement is relative to this. */
  yaw = 0;
  pitch = 0.3;
  lockTarget: Actor | null = null;
  private ctx!: GameContext;

  /** Called once the context exists. */
  attach(ctx: GameContext): void { this.ctx = ctx; }

  /** Simulation step: lock-on toggle/switch, lost target handling. */
  updateSim(_dt: number): void {}

  /** Render frame: mouse look, follow, collision, shake. `alpha` = interpolation factor. */
  update(_frameDt: number, _alpha: number): void {
    const p = this.ctx.player.model.root.position;
    const back = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(CAMERA.distance);
    this.camera.position.set(p.x + back.x, p.y + CAMERA.height + 2, p.z + back.z);
    this.camera.lookAt(p.x, p.y + CAMERA.height, p.z);
  }

  shake(_intensity: number, _duration: number): void {}
  resize(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  reset(): void { this.lockTarget = null; this.yaw = 0; this.pitch = 0.3; }
}
