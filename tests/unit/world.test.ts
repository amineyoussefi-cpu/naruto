import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../../src/sim/physics/PhysicsWorld';
import { generateWorld, groundHeight, zoneAt } from '../../src/sim/world/generate';
import { buildWorldColliders, colliderHash } from '../../src/sim/world/colliders';
import { ZONE, type WorldData } from '../../src/sim/world/types';
import { WORLD_CONFIG } from '../../src/config/world';

const POINTS = ['village.market', 'village.training', 'village.river', 'village.rooftops', 'village.gate', 'forest.path', 'forest.clearing',
  'forest.ravine', 'forest.deep', 'shore.docks', 'shore.beach', 'island.north', 'island.east', 'gate.main'];

let world: WorldData;
let physics: PhysicsWorld;
beforeAll(async () => {
  world = generateWorld(WORLD_CONFIG.defaultSeed);
  physics = await PhysicsWorld.create();
  buildWorldColliders(physics, world);
  physics.step(); // updates the query pipeline
});

describe('generateWorld', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const t = performance.now();
    const again = generateWorld(WORLD_CONFIG.defaultSeed);
    expect(performance.now() - t).toBeLessThan(1500);
    expect(colliderHash(again)).toBe(colliderHash(world));
    expect(colliderHash(generateWorld(7))).not.toBe(colliderHash(world));
  });

  it('fills the contract', () => {
    expect(Object.keys(world.points).sort()).toEqual([...POINTS].sort());
    expect(world.squares.map((s) => `${s.id}:${s.kind}`).sort()).toEqual(['coop-hq:coop', 'pvp-gate:pvp', 'pvp-hq:pvp']);
    expect(world.arenas.map((a) => a.id).sort()).toEqual(['clearing', 'lake', 'rooftops', 'training']);
    for (const a of world.arenas) {
      expect(a.radius).toBeGreaterThanOrEqual(22); expect(a.radius).toBeLessThanOrEqual(30);
      expect(a.spawns.red.length).toBeGreaterThanOrEqual(3); expect(a.spawns.blue.length).toBeGreaterThanOrEqual(3);
      for (const p of [...a.spawns.red, ...a.spawns.blue]) expect(Math.hypot(p.x - a.center.x, p.z - a.center.z)).toBeLessThan(a.radius);
    }
    expect(world.spawns.length).toBeGreaterThanOrEqual(6);
    expect(world.zones.data.length).toBe(world.zones.w * world.zones.h);
    expect(zoneAt(world, world.points['village.market'].x, world.points['village.market'].z)).toBe(ZONE.street);
    expect(zoneAt(world, 330, 330)).toBe(ZONE.water);
  });

  it('heightfield collider matches the contract layout (not transposed)', () => {
    for (const [x, z] of [[-300, -66], [120, -200], [-80, 200], [250, -300]]) {
      const hit = physics.raycast(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0), 400, { worldOnly: true });
      expect(hit).not.toBeNull();
      expect(hit!.point.y).toBeGreaterThanOrEqual(groundHeight(world, x, z) - 0.6);
    }
  });

  it('puts every point, spawn and square on walkable ground and outside colliders', () => {
    const all = [...Object.entries(world.points), ...world.spawns.map((p, i) => [`spawn${i}`, p] as const),
      ...world.squares.flatMap((s) => [[s.id, s.center], [`${s.id}.return`, s.returnPoint]] as const),
      ...world.arenas.flatMap((a) => [...a.spawns.red, ...a.spawns.blue].map((p, i) => [`${a.id}${i}`, p] as const))];
    const capsule = new RAPIER.Capsule(0.5, 0.35);
    for (const [name, p] of all) {
      const hit = physics.raycast(new THREE.Vector3(p.x, p.y + 0.5, p.z), new THREE.Vector3(0, -1, 0), 1.5, { worldOnly: true });
      expect(hit, name).not.toBeNull();
      let inside = 0;
      physics.world.intersectionsWithShape({ x: p.x, y: p.y + 0.35 + 0.5 + 0.15, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, capsule, () => { inside++; return true; });
      expect(inside, name).toBe(0);
    }
  });

  it('lake arena stands on water', () => {
    const lake = world.arenas.find((a) => a.id === 'lake')!;
    expect(physics.isWater(new THREE.Vector3(lake.center.x, lake.center.y, lake.center.z))).toBe(true);
  });
});
