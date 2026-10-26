/** Builds the static colliders of a generated world (server and client alike) and hashes them. Owner: world agent. */
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { WorldData } from './types';

/** Adds the terrain heightfield (climbable) and every `ColliderDef`; returns the created colliders (for removal). */
export function buildWorldColliders(physics: PhysicsWorld, data: WorldData): RAPIER.Collider[] {
  const out: RAPIER.Collider[] = [physics.addStaticHeightfield(data.heightfield, { climbable: true })];
  const c = new THREE.Vector3(), h = new THREE.Vector3();
  for (const d of data.colliders) {
    const flags = { climbable: d.climbable, water: d.water };
    if (d.type === 'box') out.push(physics.addStaticBox(c.set(d.center.x, d.center.y, d.center.z), h.set(d.half.x, d.half.y, d.half.z), d.yaw, flags));
    else if (d.type === 'cylinder') out.push(physics.addStaticCylinder(c.set(d.center.x, d.center.y, d.center.z), d.halfHeight, d.radius, flags));
    else if (d.type === 'capsule') out.push(physics.addStaticCapsule(c.set(d.center.x, d.center.y, d.center.z), d.halfHeight, d.radius, flags));
    else out.push(physics.addStaticTrimesh(d.vertices, d.indices, flags));
  }
  return out;
}

/** Stable FNV-1a hash (hex) of the collider list and the heightfield. */
export function colliderHash(data: WorldData): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  const num = (x: number) => { f[0] = x; a = Math.imul(a ^ u[0], 0x01000193); b = Math.imul(b ^ u[0], 0x5bd1e995) ^ (b >>> 13); };
  const arr = (xs: ArrayLike<number>) => { num(xs.length); for (let i = 0; i < xs.length; i++) num(xs[i]); };
  const H = data.heightfield;
  [H.nx, H.nz, H.cell, H.originX, H.originZ].forEach(num);
  arr(H.heights);
  for (const d of data.colliders) {
    num(['box', 'cylinder', 'capsule', 'trimesh'].indexOf(d.type));
    num(d.climbable ? 1 : 0); num(d.water ? 1 : 0);
    if (d.type === 'trimesh') { arr(d.vertices); arr(d.indices); continue; }
    num(d.center.x); num(d.center.y); num(d.center.z);
    if (d.type === 'box') { num(d.half.x); num(d.half.y); num(d.half.z); num(d.yaw); } else { num(d.halfHeight); num(d.radius); }
  }
  const hex = (x: number) => (x >>> 0).toString(16).padStart(8, '0');
  return hex(a) + hex(b);
}
