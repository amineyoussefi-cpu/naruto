import * as THREE from 'three';
import { buildArena } from '../world/Arena';
import type { PhysicsWorld } from './physics/PhysicsWorld';
import type { SimContext } from './context';
import type { EnemyAI } from './ai/EnemyAI';
import { WaveManager } from './ai/WaveManager';
import type { Director, SimOptions } from './Sim';

// shortcut: v4 coastal arena and wave mode keep solo playable until the v5 world and missions are wired; delete then.

/** v4 arena colliders (its meshes are built into a throwaway scene). */
export const legacyWorld: SimOptions['buildWorld'] = (physics: PhysicsWorld) => {
  const arena = buildArena(new THREE.Scene(), physics);
  arena.dispose();
  return { world: null, playerSpawns: [arena.playerSpawn], enemySpawns: arena.enemySpawns };
};

/** v4 waves as a mode director (solo). */
export function waveDirector(ctx: SimContext, ai: () => EnemyAI): Director & { waves: WaveManager } {
  let waves: WaveManager | null = null;
  const w = () => (waves ??= new WaveManager(ctx, ai()));
  const empty: Director = { update() {}, state: () => undefined as never, markers: () => [], onPlayerJoin() {}, onPlayerLeave() {}, reset() {} };
  return {
    ...empty,
    get waves() { return w(); },
    update: (dt) => w().update(dt),
    state: () => undefined as never,
    reset: () => w().reset(),
  };
}
