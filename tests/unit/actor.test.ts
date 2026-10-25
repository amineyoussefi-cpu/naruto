import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ActorView } from '../../src/game/ActorView';
import type { NinjaModel } from '../../src/render/NinjaModel';
import { ACTOR_FLAGS, type ActorState } from '../../src/sim/protocol';

function makeActor() {
  const feet: boolean[] = [];
  const model = { root: new THREE.Group(), update() {}, setDazed() {}, setFootChakra: (on: boolean) => feet.push(on) } as unknown as NinjaModel;
  const a = new ActorView({ id: 1, kind: 'player', name: 'p', look: 'sasuke' });
  a.model.dispose();
  a.model = model;
  return { a, feet };
}

/** Pushes a climbing state (wall normal, velocity, position) into the view as a snapshot would. */
function climb(a: ActorView, on: boolean, n: THREE.Vector3, v = new THREE.Vector3(), p = new THREE.Vector3()): void {
  const s: ActorState = {
    id: 1, team: 'player', x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, yaw: 0, anim: 'climb', animTime: 0,
    hp: 1, maxHp: 1, chakra: 1, maxChakra: 1, flags: on ? ACTOR_FLAGS.climbing : 0, orb: 0, orbLevel: 0, wallNx: n.x, wallNz: n.z,
  };
  a.apply(s, s, 1);
}

describe('ActorView wall-walking render', () => {
  it('stands the model on the wall: up = wall normal, soles on the surface, feet chakra on', () => {
    const { a, feet } = makeActor();
    // wall is at +X, running up
    climb(a, true, new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 4, 0), new THREE.Vector3(5, 2, 0));
    for (let i = 0; i < 120; i++) a.syncModel(1 / 60);
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
    climb(a, true, new THREE.Vector3(0, 0, -1));
    for (let i = 0; i < 60; i++) a.syncModel(1 / 60);
    climb(a, false, new THREE.Vector3(0, 0, -1));
    for (let i = 0; i < 120; i++) a.syncModel(1 / 60);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(a.model.root.quaternion);
    expect(up.y).toBeGreaterThan(0.999);
    expect(a.model.root.position.y).toBeCloseTo(0, 2);
    expect(feet.at(-1)).toBe(false);
  });
});
