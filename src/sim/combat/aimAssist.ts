import * as THREE from 'three';
import type { Actor } from '../Actor';

export interface AimAssistQuery {
  /** Camera used for projection (matrices from the last render). */
  camera: THREE.PerspectiveCamera;
  /** Throw origin (player chest). */
  origin: THREE.Vector3;
  /** Horizontal forward of the player/camera: targets must be in front of it. */
  forward: THREE.Vector3;
  candidates: readonly Actor[];
  /** Max world distance from `origin` (m). */
  range: number;
  /** Max distance from the screen centre, as a fraction of the screen height. */
  screenRadius: number;
  /** True when nothing in the world blocks `from` → `to`. */
  lineOfSight: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
}

const tmpChest = new THREE.Vector3();
const tmpNdc = new THREE.Vector3();

/** Kunai aim assist: the candidate whose chest projects closest to the screen centre, within all limits; else null. */
export function pickAimTarget(q: AimAssistQuery): Actor | null {
  let best: Actor | null = null;
  let bestD = q.screenRadius;
  for (const e of q.candidates) {
    if (!e.alive || e.removed) continue;
    const chest = e.chest(tmpChest);
    const dx = chest.x - q.origin.x, dy = chest.y - q.origin.y, dz = chest.z - q.origin.z;
    if (dx * dx + dy * dy + dz * dz > q.range * q.range) continue;
    if (dx * q.forward.x + dz * q.forward.z <= 0) continue; // behind the player
    const ndc = tmpNdc.copy(chest).project(q.camera);
    if (ndc.z >= 1 || ndc.z <= -1) continue; // behind the camera / clipped
    // NDC spans 2 units per screen height; x is scaled by the aspect so the radius is circular on screen.
    const d = Math.hypot((ndc.x / 2) * q.camera.aspect, ndc.y / 2);
    if (d > bestD) continue;
    if (!q.lineOfSight(q.origin, chest.clone())) continue;
    best = e;
    bestD = d;
  }
  return best;
}
