import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export interface ArenaInfo {
  playerSpawn: THREE.Vector3;
  enemySpawns: THREE.Vector3[];
  dispose(): void;
}

/**
 * Builds the arena (meshes + static colliders), sky and lights. Owner: visuals agent. STUB.
 * Climbable surfaces must be created with `{ climbable: true }`.
 */
export function buildArena(scene: THREE.Scene, physics: PhysicsWorld): ArenaInfo {
  const ground = new THREE.Mesh(new THREE.BoxGeometry(80, 1, 80), new THREE.MeshToonMaterial({ color: 0x6b8f4e }));
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(40, 0.5, 40));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 1), new THREE.MeshToonMaterial({ color: 0x9a7b5a }));
  wall.position.set(0, 4, 12);
  scene.add(wall);
  physics.addStaticBox(wall.position.clone(), new THREE.Vector3(4, 4, 0.5), 0, { climbable: true });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(20, 30, 10);
  scene.add(sun);
  scene.background = new THREE.Color(0x87b8e8);
  return {
    playerSpawn: new THREE.Vector3(0, 0.1, 0),
    enemySpawns: [new THREE.Vector3(10, 0.1, 10), new THREE.Vector3(-10, 0.1, 10), new THREE.Vector3(10, 0.1, -10), new THREE.Vector3(-10, 0.1, -10)],
    dispose() {},
  };
}
