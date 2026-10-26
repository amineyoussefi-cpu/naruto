import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/** Collision groups: 16 high bits = membership, 16 low bits = filter. */
export const GROUP_WORLD = 0x0001;
export const GROUP_ACTOR = 0x0002;
const groups = (member: number, filter: number) => (member << 16) | filter;
export const WORLD_GROUPS = groups(GROUP_WORLD, 0xffff);
export const ACTOR_GROUPS = groups(GROUP_ACTOR, 0xffff);
/** Query filter that only hits static arena geometry. */
export const QUERY_WORLD_ONLY = groups(0xffff, GROUP_WORLD);

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: RAPIER.Collider;
  climbable: boolean;
}

export interface CharacterBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

/**
 * Thin wrapper around a Rapier world. Characters are kinematic capsules moved
 * through a KinematicCharacterController; the arena is static colliders.
 * Owner: movement agent.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly controller: RAPIER.KinematicCharacterController;
  /** Handles of colliders the player may climb. */
  readonly climbable = new Set<number>();

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.controller = this.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setSlideEnabled(true);
  }

  private static initPromise: Promise<void> | null = null;

  /** After one `create()` has loaded Rapier, more worlds can be made synchronously. */
  static createSync(): PhysicsWorld {
    return new PhysicsWorld();
  }

  static async create(): Promise<PhysicsWorld> {
    PhysicsWorld.initPromise ??= RAPIER.init();
    await PhysicsWorld.initPromise;
    return new PhysicsWorld();
  }

  addStaticBox(center: THREE.Vector3, half: THREE.Vector3, rotationY = 0, opts: { climbable?: boolean; water?: boolean } = {}): RAPIER.Collider {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCollisionGroups(WORLD_GROUPS);
    const c = this.world.createCollider(desc);
    if (opts.climbable) this.climbable.add(c.handle);
    if (opts.water) this.water.add(c.handle);
    return c;
  }

  /**
   * Static triangle-mesh collider from a Three geometry (terrain, sculpted rocks, mountains).
   * `matrix` places the geometry in the world (defaults to identity: geometry already in world space).
   * `water` marks a walk-on-water surface (see `isWater`).
   */
  addStaticMesh(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4, opts: { climbable?: boolean; water?: boolean } = {}): RAPIER.Collider {
    const pos = geometry.getAttribute('position');
    const v = new Float32Array(pos.count * 3);
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      if (matrix) p.applyMatrix4(matrix);
      v[i * 3] = p.x; v[i * 3 + 1] = p.y; v[i * 3 + 2] = p.z;
    }
    let idx: Uint32Array;
    if (geometry.index) idx = Uint32Array.from(geometry.index.array as ArrayLike<number>);
    else idx = Uint32Array.from({ length: pos.count }, (_, i) => i);
    const c = this.world.createCollider(RAPIER.ColliderDesc.trimesh(v, idx).setCollisionGroups(WORLD_GROUPS));
    if (opts.climbable) this.climbable.add(c.handle);
    if (opts.water) this.water.add(c.handle);
    return c;
  }

  /** Handles of walk-on-water surfaces (ninjas stand on them with chakra). */
  readonly water = new Set<number>();

  /** True when the ground right under `feet` is a water surface. */
  isWater(feet: THREE.Vector3): boolean {
    if (this.water.size === 0) return false;
    const hit = this.raycast(new THREE.Vector3(feet.x, feet.y + 0.3, feet.z), new THREE.Vector3(0, -1, 0), 0.6, { worldOnly: true });
    return !!hit && this.water.has(hit.collider.handle);
  }

  addStaticCylinder(center: THREE.Vector3, halfHeight: number, radius: number, opts: { climbable?: boolean } = {}): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(center.x, center.y, center.z)
      .setCollisionGroups(WORLD_GROUPS);
    const c = this.world.createCollider(desc);
    if (opts.climbable) this.climbable.add(c.handle);
    return c;
  }

  /** Static capsule (axis Y) centred at `center`. Added for the v5 world (tree trunks). */
  addStaticCapsule(center: THREE.Vector3, halfHeight: number, radius: number, opts: { climbable?: boolean } = {}): RAPIER.Collider {
    const c = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(center.x, center.y, center.z).setCollisionGroups(WORLD_GROUPS));
    if (opts.climbable) this.climbable.add(c.handle);
    return c;
  }

  /** Static triangle mesh from raw world-space arrays (rocks, river surfaces). */
  addStaticTrimesh(vertices: Float32Array, indices: Uint32Array, opts: { climbable?: boolean; water?: boolean } = {}): RAPIER.Collider {
    const c = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(WORLD_GROUPS));
    if (opts.climbable) this.climbable.add(c.handle);
    if (opts.water) this.water.add(c.handle);
    return c;
  }

  /**
   * Static heightfield: `heights[iz * nx + ix]` at (originX + ix * cell, originZ + iz * cell) (row-major in z, as in the
   * world contract); transposed here to Rapier's column-major layout.
   */
  addStaticHeightfield(hf: { nx: number; nz: number; cell: number; originX: number; originZ: number; heights: Float32Array }, opts: { climbable?: boolean } = {}): RAPIER.Collider {
    const { nx, nz, cell } = hf, h = new Float32Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) h[ix * nz + iz] = hf.heights[iz * nx + ix];
    const w = (nx - 1) * cell, d = (nz - 1) * cell;
    const desc = RAPIER.ColliderDesc.heightfield(nz - 1, nx - 1, h, { x: w, y: 1, z: d })
      // Sub-mm nudge: Rapier misses vertical rays lying exactly on grid lines, which round coordinates often do.
      .setTranslation(hf.originX + w / 2 + 0.0013, 0, hf.originZ + d / 2 + 0.0017)
      .setCollisionGroups(WORLD_GROUPS);
    const c = this.world.createCollider(desc);
    if (opts.climbable) this.climbable.add(c.handle);
    return c;
  }

  /** Capsule whose bottom sits at `feet`. */
  createCharacter(feet: THREE.Vector3, radius: number, halfHeight: number): CharacterBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, feet.y + halfHeight + radius, feet.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(ACTOR_GROUPS),
      body,
    );
    return { body, collider };
  }

  removeCharacter(c: CharacterBody): void {
    this.world.removeRigidBody(c.body);
  }

  /**
   * Moves a character capsule by `delta`, sliding along obstacles.
   * Returns the corrected feet position and whether it is grounded.
   */
  moveCharacter(c: CharacterBody, delta: THREE.Vector3, outFeet: THREE.Vector3, opts: { worldOnly?: boolean } = {}): { grounded: boolean; hitCeiling: boolean } {
    // worldOnly: pass through other characters (Chidori piercing dash) but never through walls.
    this.controller.computeColliderMovement(c.collider, delta, undefined, opts.worldOnly ? QUERY_WORLD_ONLY : undefined, (other) => other.handle !== c.collider.handle);
    const m = this.controller.computedMovement();
    const t = c.body.translation();
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    c.body.setNextKinematicTranslation(next);
    // Also set the current translation so queries in the same step see the new position.
    c.body.setTranslation(next, false);
    const halfTotal = c.collider.halfHeight() + c.collider.radius();
    outFeet.set(next.x, next.y - halfTotal, next.z);
    return { grounded: this.controller.computedGrounded(), hitCeiling: delta.y > 0 && m.y < delta.y * 0.5 };
  }

  teleport(c: CharacterBody, feet: THREE.Vector3): void {
    const halfTotal = c.collider.halfHeight() + c.collider.radius();
    const p = { x: feet.x, y: feet.y + halfTotal, z: feet.z };
    c.body.setTranslation(p, true);
    c.body.setNextKinematicTranslation(p);
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, opts: { worldOnly?: boolean; exclude?: RAPIER.Collider } = {}): RayHit | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, opts.worldOnly ? QUERY_WORLD_ONLY : undefined, opts.exclude);
    if (!hit) return null;
    return {
      distance: hit.timeOfImpact,
      point: new THREE.Vector3().copy(dir).multiplyScalar(hit.timeOfImpact).add(origin),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
      climbable: this.climbable.has(hit.collider.handle),
    };
  }

  step(): void {
    this.world.step();
  }

  dispose(): void {
    this.controller.free();
    this.world.free();
  }
}
