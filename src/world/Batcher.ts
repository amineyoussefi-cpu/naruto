import * as THREE from 'three';

const tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();

/**
 * Collects (geometry, matrix, colour) parts and turns them into one InstancedMesh per geometry,
 * so a whole village of composed buildings costs a handful of draw calls.
 * Parts are placed in a local "frame" (set with `frame`) so kits can be authored in building space.
 */
export class Batcher {
  private readonly parts = new Map<THREE.BufferGeometry, { m: THREE.Matrix4[]; c: THREE.Color[] }>();
  private readonly parent = new THREE.Matrix4();

  /** Sets the parent transform (position + yaw + uniform scale) for following `put` calls. */
  frame(x: number, y: number, z: number, yaw = 0, scale = 1): this {
    this.parent.compose(v.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), s.setScalar(scale));
    return this;
  }

  /** Adds one part in frame space: position, size (geometry scale), yaw/roll in radians. */
  put(geo: THREE.BufferGeometry, color: number | THREE.Color, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, roll = 0): this {
    let p = this.parts.get(geo);
    if (!p) this.parts.set(geo, (p = { m: [], c: [] }));
    tmp.compose(v.set(x, y, z), q.setFromEuler(e.set(0, yaw, roll)), s.set(sx, sy, sz));
    p.m.push(new THREE.Matrix4().multiplyMatrices(this.parent, tmp));
    p.c.push(color instanceof THREE.Color ? color.clone() : new THREE.Color(color));
    return this;
  }

  /** Builds the instanced meshes (material colour should be white; per-instance colour carries the hue). */
  build(material: THREE.Material, cast = false, receive = false): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const [geo, p] of this.parts) {
      const im = new THREE.InstancedMesh(geo, material, p.m.length);
      p.m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, p.c[i]); });
      im.castShadow = cast; im.receiveShadow = receive;
      im.computeBoundingSphere();
      out.push(im);
    }
    this.parts.clear();
    return out;
  }
}
