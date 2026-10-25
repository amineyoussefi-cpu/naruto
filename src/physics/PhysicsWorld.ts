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

  static async create(): Promise<PhysicsWorld> {
    PhysicsWorld.initPromise ??= RAPIER.init();
    await PhysicsWorld.initPromise;
    return new PhysicsWorld();
  }

  addStaticBox(center: THREE.Vector3, half: THREE.Vector3, rotationY = 0, opts: { climbable?: boolean } = {}): RAPIER.Collider {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCollisionGroups(WORLD_GROUPS);
    const c = this.world.createCollider(desc);
    if (opts.climbable) this.climbable.add(c.handle);
    return c;
  }

  addStaticCylinder(center: THREE.Vector3, halfHeight: number, radius: number, opts: { climbable?: boolean } = {}): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(center.x, center.y, center.z)
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
  moveCharacter(c: CharacterBody, delta: THREE.Vector3, outFeet: THREE.Vector3): { grounded: boolean; hitCeiling: boolean } {
    this.controller.computeColliderMovement(c.collider, delta, undefined, undefined, (other) => other.handle !== c.collider.handle);
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
