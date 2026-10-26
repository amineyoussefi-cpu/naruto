import * as THREE from 'three';
import { Sim } from './Sim';
import { generateWorld } from './world/generate';
import { buildWorldColliders } from './world/colliders';
import { ModeDirector } from './missions/ModeDirector';
import type { WorldData } from './world/types';

const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

/** The v5 world from its seed: colliders into `physics`, spawns from the data. */
export function worldFromSeed(physics: Parameters<Parameters<typeof Sim.create>[0]['buildWorld']>[0], seed: number): { world: WorldData; playerSpawns: THREE.Vector3[]; enemySpawns: THREE.Vector3[] } {
  const world = generateWorld(seed);
  buildWorldColliders(physics, world);
  return { world, playerSpawns: world.spawns.map(v3), enemySpawns: Object.values(world.points).map(v3) };
}

/** The game simulation as the host server and solo both run it: v5 world, co-op missions and PvP. Owner: integration. */
export async function createGameSim(seed: number, online: boolean): Promise<Sim> {
  return Sim.create({ seed, online, buildWorld: worldFromSeed, createDirector: (ctx) => new ModeDirector(ctx) });
}
