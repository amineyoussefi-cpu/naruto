import { CAMERA } from '../config/camera';

/** Pure lock-on target selection (no Three/DOM), unit-tested. */
export interface LockCandidate { id: number; x: number; y: number; z: number; alive: boolean; visible: boolean }
/** Selection origin (player) and the camera yaw; yaw 0 looks toward +Z. */
export interface LockView { x: number; y: number; z: number; yaw: number }

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export function distanceTo(v: LockView, c: LockCandidate): number {
  return Math.hypot(c.x - v.x, c.y - v.y, c.z - v.z);
}

/** Signed horizontal angle of the candidate from camera forward; positive = right of screen. */
export function screenAngle(v: LockView, c: LockCandidate): number {
  // Looking along +Z with Y up, screen-right is -X, so atan2 grows to the left.
  return -wrap(Math.atan2(c.x - v.x, c.z - v.z) - v.yaw);
}

function eligible(v: LockView, cands: readonly LockCandidate[], range: number): LockCandidate[] {
  return cands.filter((c) => c.alive && distanceTo(v, c) <= range);
}

/** Best target id (centre-most, closer, visible preferred) or null. */
export function bestTarget(v: LockView, cands: readonly LockCandidate[], range = CAMERA.lockOnRange, excludeId: number | null = null): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  for (const c of eligible(v, cands, range)) {
    if (c.id === excludeId) continue;
    const score = Math.abs(screenAngle(v, c)) * CAMERA.lockOnAngleWeight + distanceTo(v, c) / range + (c.visible ? 0 : CAMERA.lockOnHiddenPenalty);
    if (score < bestScore) { bestScore = score; best = c.id; }
  }
  return best;
}

/** Next target to the right of `currentId` on screen (wrapping), or best when current is not eligible. */
export function cycleTarget(v: LockView, cands: readonly LockCandidate[], currentId: number | null, range = CAMERA.lockOnRange): number | null {
  const list = eligible(v, cands, range).sort((a, b) => screenAngle(v, a) - screenAngle(v, b));
  const i = list.findIndex((c) => c.id === currentId);
  if (i < 0) return bestTarget(v, cands, range);
  return list[(i + 1) % list.length].id;
}
