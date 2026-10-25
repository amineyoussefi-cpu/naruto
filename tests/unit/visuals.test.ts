import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computePose, NinjaModel, POSE_SIZE } from '../../src/render/NinjaModel';
import { Effects } from '../../src/render/Effects';
import { createProjectileMesh, disposeObject } from '../../src/render/meshes';
import { AudioSystem } from '../../src/audio/AudioSystem';
import { EventBus } from '../../src/core/events';
import { buildArena } from '../../src/world/Arena';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import type { AnimState } from '../../src/core/types';
import { LOOKS, pickEnemyLook } from '../../src/render/looks';
import type { Actor } from '../../src/game/Actor';

const STATES: AnimState[] = ['idle', 'run', 'sprint', 'jump', 'fall', 'climb', 'attack1', 'attack2', 'attack3', 'throw', 'special', 'guard', 'dodge', 'hit', 'dead', 'concentrate', 'telegraph'];

describe('NinjaModel poses', () => {
  it('gives every AnimState a distinct pose', () => {
    // Sample each state mid-action so one-shots are in their characteristic pose.
    const poses = STATES.map((s) => Array.from(computePose(s, 0.15, 1, 0.5, 7, new Float32Array(POSE_SIZE))));
    for (let i = 0; i < poses.length; i++) {
      for (let j = i + 1; j < poses.length; j++) {
        const d = poses[i].reduce((acc, v, k) => acc + Math.abs(v - poses[j][k]), 0);
        expect(d, `${STATES[i]} vs ${STATES[j]}`).toBeGreaterThan(0.5);
      }
    }
  });

  it('produces finite poses and the dead pose lies on the ground', () => {
    for (const s of STATES) for (const t of [0, 0.1, 0.3, 1, 5]) {
      expect(computePose(s, t, t * 9, t, 10, new Float32Array(POSE_SIZE)).every(Number.isFinite), s).toBe(true);
    }
    const dead = computePose('dead', 3, 0, 0, 0, new Float32Array(POSE_SIZE));
    expect(dead[1]).toBeLessThan(-1.2); // pitched onto the back
  });

  it('builds, animates and disposes a model', () => {
    const m = new NinjaModel({ outfit: 0xff7a1a, accent: 0x1d2b4f, hair: 0xffd23a, skin: 0xf2c49b, headband: 0x3a5bd6, mask: true });
    const scene = new THREE.Scene();
    scene.add(m.root);
    m.setTelegraph(true); m.setAura(true, 0xff0000); m.setHandOrb(true); m.setGuard(true); m.flash(0.1);
    for (const s of STATES) for (let i = 0; i < 20; i++) m.update(1 / 60, s, i / 60, 6);
    expect(Array.from(m.currentPose).every(Number.isFinite)).toBe(true);
    m.dispose();
    expect(m.root.parent).toBeNull();
  });

  it('stays within the mesh budget for every look and variant', () => {
    const looks = [LOOKS.player, LOOKS.melee, LOOKS.ranged, ...[0, 0.5, 0.99].flatMap((r) => [pickEnemyLook('melee', () => r), pickEnemyLook('ranged', () => r)])];
    for (const look of looks) {
      const m = new NinjaModel(look);
      expect(m.meshCount).toBeLessThanOrEqual(45);
      m.dispose();
    }
    expect(pickEnemyLook('player', () => 0.7)).toBe(LOOKS.player);
  });
});

describe('Effects', () => {
  it('spawns particles from events, decays them and clears', () => {
    const events = new EventBus();
    const fx = new Effects(new THREE.Scene(), events, () => undefined as Actor | undefined);
    const pos = { x: 0, y: 1, z: 0 };
    events.emit('damage', { targetId: 1, sourceId: 2, amount: 5, blocked: false, killed: true, kind: 'combo1', position: pos });
    events.emit('technique', { id: 1, name: 'special', position: pos });
    fx.update(1 / 60);
    expect(fx.liveParticles).toBeGreaterThan(50);
    for (let i = 0; i < 120; i++) fx.update(1 / 60);
    expect(fx.liveParticles).toBe(0);
    fx.burst(new THREE.Vector3(), 0xffffff, 10);
    fx.update(1 / 60);
    fx.clear();
    fx.update(1 / 60);
    expect(fx.liveParticles).toBe(0);
    fx.dispose();
  });
});

describe('meshes / audio', () => {
  it('creates and frees projectile meshes', () => {
    for (const v of ['kunai', 'shuriken', 'chakra'] as const) disposeObject(createProjectileMesh(v));
    expect(createProjectileMesh('shuriken').userData.spin).toBe(true);
  });

  it('never throws without WebAudio', () => {
    const events = new EventBus();
    const a = new AudioSystem(events);
    a.unlock(); a.setVolume(0.5); a.setPaused(true); a.setPaused(false); a.playUiClick();
    events.emit('waveStart', { wave: 1, totalWaves: 3, enemies: 4 });
    a.dispose();
  });
});

describe('Arena', () => {
  it('has reachable spawns on open ground, climbables and frees its colliders', async () => {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    const arena = buildArena(scene, physics);
    physics.step();
    expect(arena.enemySpawns.length).toBeGreaterThanOrEqual(6);
    expect(physics.climbable.size).toBeGreaterThan(10);
    const down = new THREE.Vector3(0, -1, 0);
    for (const s of [arena.playerSpawn, ...arena.enemySpawns]) {
      const hit = physics.raycast(new THREE.Vector3(s.x, 40, s.z), down, 60, { worldOnly: true });
      expect(hit, `spawn ${s.x},${s.z}`).not.toBeNull();
      expect(hit!.point.y, `spawn ${s.x},${s.z} must be on the ground`).toBeCloseTo(0, 1);
    }
    // The chasm next to the bridge is a real hole.
    expect(physics.raycast(new THREE.Vector3(5, 10, -33), down, 100, { worldOnly: true })).toBeNull();
    arena.dispose();
    expect(physics.world.colliders.len()).toBe(0);
    expect(scene.children.length).toBe(0);
  });
});
