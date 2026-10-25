import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pickAimTarget } from '../../src/combat/aimAssist';
import { Fighter } from '../../src/combat/Fighter';
import { Actor } from '../../src/game/Actor';
import type { NinjaModel } from '../../src/render/NinjaModel';
import type { CharacterBody } from '../../src/physics/PhysicsWorld';

const enemy = (x: number, z: number) => {
  const e = new Actor('melee', 'enemy', 'e', new Fighter({ maxHp: 10, maxChakra: 0 }), {} as NinjaModel, {} as CharacterBody, 0.4, 1.8);
  e.position.set(x, 0, z);
  return e;
};

/** Camera behind the player at the origin, looking down +Z. */
function query(candidates: Actor[], blocked: (to: THREE.Vector3) => boolean = () => false) {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  camera.position.set(0, 1.1, -4);
  camera.lookAt(0, 1.1, 10);
  camera.updateMatrixWorld();
  return pickAimTarget({
    camera, origin: new THREE.Vector3(0, 1.08, 0), forward: new THREE.Vector3(0, 0, 1), candidates,
    range: 40, screenRadius: 0.12, lineOfSight: (_f, to) => !blocked(to),
  });
}

describe('kunai aim assist', () => {
  it('picks the enemy closest to the screen centre', () => {
    const a = enemy(1.5, 10), b = enemy(0.3, 15);
    expect(query([a, b])).toBe(b);
  });

  it('rejects enemies behind, outside the screen radius or out of range', () => {
    expect(query([enemy(0, -2)])).toBeNull(); // behind the player (still in front of the camera)
    expect(query([enemy(0, -6)])).toBeNull(); // behind the camera
    expect(query([enemy(8, 10)])).toBeNull(); // far from the reticle
    expect(query([enemy(0, 45)])).toBeNull(); // beyond range
  });

  it('rejects occluded enemies and falls back to the next visible one', () => {
    const hidden = enemy(0, 10), visible = enemy(1, 12);
    expect(query([hidden, visible], (to) => to.z === 10)).toBe(visible);
    expect(query([hidden], () => true)).toBeNull();
  });

  it('ignores dead enemies', () => {
    const e = enemy(0, 10);
    e.fighter.hp = 0;
    expect(query([e])).toBeNull();
  });
});
