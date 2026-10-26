/** Pure geometry of the start squares. Owner: missions agent. */
import type { Vec3Like } from '../../core/types';
import type { SquareDef } from '../world/types';
import type { PvpTeam } from './types';

/** Position in the square's local frame (local +X = (cos yaw, 0, -sin yaw), local +Z = forward (sin yaw, 0, cos yaw)). */
export function toLocal(sq: SquareDef, x: number, z: number): { lx: number; lz: number } {
  const dx = x - sq.center.x, dz = z - sq.center.z;
  const c = Math.cos(sq.yaw), s = Math.sin(sq.yaw);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

export function inSquare(sq: SquareDef, x: number, z: number): boolean {
  const { lx, lz } = toLocal(sq, x, z);
  const h = sq.size / 2;
  return Math.abs(lx) <= h && Math.abs(lz) <= h;
}

/** Red half = local -X, blue half = local +X (the centre line counts as blue). */
export function pvpHalf(sq: SquareDef, x: number, z: number): PvpTeam {
  return toLocal(sq, x, z).lx < 0 ? 'red' : 'blue';
}

/** First square of `kind` containing (x, z). */
export function squareAt(squares: readonly SquareDef[], kind: SquareDef['kind'], x: number, z: number): SquareDef | null {
  return squares.find((s) => s.kind === kind && inSquare(s, x, z)) ?? null;
}

/** Point i of n spread on a ring of `radius` around `center` (the centre itself when n = 1). */
export function spreadPoint(center: Vec3Like, i: number, n: number, radius: number): { x: number; y: number; z: number } {
  if (n <= 1) return { x: center.x, y: center.y, z: center.z };
  const a = (i / n) * Math.PI * 2;
  return { x: center.x + Math.sin(a) * radius, y: center.y, z: center.z + Math.cos(a) * radius };
}
