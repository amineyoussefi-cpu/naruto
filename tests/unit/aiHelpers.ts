import * as THREE from 'three';
import { Actor } from '../../src/game/Actor';
import { Fighter } from '../../src/combat/Fighter';
import { EventBus } from '../../src/core/events';
import type { GameContext } from '../../src/game/context';
import type { NinjaModel } from '../../src/render/NinjaModel';
import type { CharacterBody, PhysicsWorld } from '../../src/physics/PhysicsWorld';
import type { CombatSystem, HitboxSpec, ProjectileSpec } from '../../src/combat/CombatSystem';
import type { ActorKind } from '../../src/core/types';

export function makeActor(kind: ActorKind, x = 0, z = 0, hp = 50): Actor {
  const model = { setTelegraph: () => {} } as unknown as NinjaModel;
  const a = new Actor(kind, kind === 'player' ? 'player' : 'enemy', kind, new Fighter({ maxHp: hp, maxChakra: 0 }), model, {} as CharacterBody, 0.4, 1.8);
  a.position.set(x, 0, z);
  a.grounded = true;
  return a;
}

/** Flat open floor, no obstacles. */
export function makeCtx() {
  const hitboxes: HitboxSpec[] = [];
  const projectiles: ProjectileSpec[] = [];
  const player = makeActor('player', 0, 0, 100);
  const physics = {
    moveCharacter: (_b: CharacterBody, d: THREE.Vector3, out: THREE.Vector3) => {
      out.add(d);
      const grounded = out.y <= 0;
      if (grounded) out.y = 0;
      return { grounded, hitCeiling: false };
    },
    raycast: () => null,
  } as unknown as PhysicsWorld;
  const actors: Actor[] = [player];
  const ctx = {
    physics,
    events: new EventBus(),
    combat: { spawnHitbox: (s: HitboxSpec) => hitboxes.push(s), spawnProjectile: (s: ProjectileSpec) => projectiles.push(s) } as unknown as CombatSystem,
    time: 0,
    actors,
    player,
    spawnEnemy: (kind: 'melee' | 'ranged', feet: THREE.Vector3) => {
      const a = makeActor(kind, feet.x, feet.z);
      actors.push(a);
      return a;
    },
    removeActor: (a: Actor) => { a.removed = true; actors.splice(actors.indexOf(a), 1); },
    enemies: () => actors.filter((a) => a.team === 'enemy' && a.alive && !a.removed),
    spawns: { player: new THREE.Vector3(), enemies: [new THREE.Vector3(20, 0, 0), new THREE.Vector3(-20, 0, 0), new THREE.Vector3(0, 0, 20), new THREE.Vector3(1, 0, 1)] },
    modifiers: () => ({ hpMul: 1, dmgMul: 2 }),
  } as unknown as GameContext;
  return { ctx, player, hitboxes, projectiles, actors };
}

/** Deterministic RNG. */
export function seeded(seed = 1): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
