import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Actor } from '../../src/game/Actor';
import { Fighter } from '../../src/combat/Fighter';
import type { NinjaModel } from '../../src/render/NinjaModel';
import type { CharacterBody } from '../../src/physics/PhysicsWorld';

function makeActor() {
  const feet: boolean[] = [];
  const model = { root: new THREE.Group(), update() {}, setFootChakra: (on: boolean) => feet.push(on) } as unknown as NinjaModel;
  const a = new Actor('player', 'player', 'p', new Fighter({ maxHp: 1, maxChakra: 1 }), model, {} as CharacterBody, 0.4, 1.8);
  return { a, feet };
}

describe('Actor wall-walking render', () => {
  it('stands the model on the wall: up = wall normal, soles on the surface, feet chakra on', () => {
    const { a, feet } = makeActor();
    a.position.set(5, 2, 0);
    a.prevPosition.copy(a.position);
    a.climbing = true;
    a.wallNormal.set(-1, 0, 0); // wall is at +X
    a.velocity.set(0, 4, 0); // running up
    for (let i = 0; i < 120; i++) a.syncModel(1, 1 / 60);
    const root = a.model.root;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    expect(up.distanceTo(a.wallNormal)).toBeLessThan(1e-3);
    expect(fwd.y).toBeGreaterThan(0.999);
    expect(root.position.x).toBeCloseTo(5 + a.radius, 3);
    expect(root.position.y).toBeCloseTo(2 + a.height * 0.5, 3);
    expect(feet.at(-1)).toBe(true);
  });

  it('returns upright when the climb ends', () => {
    const { a, feet } = makeActor();
    a.climbing = true;
    a.wallNormal.set(0, 0, -1);
    for (let i = 0; i < 60; i++) a.syncModel(1, 1 / 60);
    a.climbing = false;
    for (let i = 0; i < 120; i++) a.syncModel(1, 1 / 60);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(a.model.root.quaternion);
    expect(up.y).toBeGreaterThan(0.999);
    expect(a.model.root.position.y).toBeCloseTo(0, 2);
    expect(feet.at(-1)).toBe(false);
  });
});
