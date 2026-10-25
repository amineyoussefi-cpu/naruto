import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computePose, NinjaModel, POSE_SIZE } from '../../src/render/NinjaModel';
import { Effects } from '../../src/render/Effects';
import { createProjectileMesh, disposeObject } from '../../src/render/meshes';
import { AudioSystem } from '../../src/audio/AudioSystem';
import { EventBus } from '../../src/core/events';
import { buildArena } from '../../src/world/Arena';
import { heightAt, WORLD } from '../../src/world/terrain';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import type { AnimState } from '../../src/core/types';
import { CHARACTER_LOOKS, LOOKS, pickEnemyLook } from '../../src/render/looks';
import type { Actor } from '../../src/game/Actor';

const STATES: AnimState[] = ['idle', 'run', 'sprint', 'jump', 'fall', 'climb', 'attack1', 'attack2', 'attack3', 'attack4', 'attack5', 'throw', 'special', 'guard', 'dodge', 'hit', 'dead', 'concentrate', 'telegraph', 'dash', 'launched', 'substitution',
  'charge', 'chidori', 'sharingan', 'dazed', 'grabHold', 'strikeUp', 'strikeDown', 'strikeLeft', 'strikeRight', 'grabFinisher', 'grabbed'];

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
    // v4: charged orb styles, daze ring, Sharingan eyes.
    m.setHandOrb(true, 0.2, 'chidori'); m.setDazed(true); m.setSharingan(true);
    for (let i = 0; i < 20; i++) m.update(1 / 60, 'charge', i / 60, 0);
    m.setHandOrb(true, 1, 'chidori');
    for (let i = 0; i < 20; i++) m.update(1 / 60, 'charge', i / 60, 0);
    m.setHandOrb(true, 0.5, 'rasengan'); m.setDazed(false); m.setSharingan(false);
    m.update(1 / 60, 'charge', 1, 0);
    expect(Array.from(m.currentPose).every(Number.isFinite)).toBe(true);
    m.dispose();
    expect(m.root.parent).toBeNull();
  });

  it('stays within the mesh budget for every look and variant', () => {
    const looks = [LOOKS.player, LOOKS.melee, LOOKS.ranged, ...[0, 0.5, 0.99].flatMap((r) => [pickEnemyLook('melee', () => r), pickEnemyLook('ranged', () => r)])];
    for (const look of looks) {
      const m = new NinjaModel(look);
      expect(m.meshCount).toBeLessThanOrEqual(45);
      m.setDazed(true); // enemies can be dazed
      expect(m.meshCount).toBeLessThanOrEqual(46);
      m.dispose();
    }
    // Playable characters with every status visual created.
    for (const look of Object.values(CHARACTER_LOOKS)) {
      const m = new NinjaModel(look);
      m.setHandOrb(true, 1, 'chidori'); m.setDazed(true); m.setSharingan(true);
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

  it('handles Storm events: dash trail, substitution log, air jump, launcher', () => {
    const events = new EventBus();
    const actor = { position: new THREE.Vector3(), velocity: new THREE.Vector3(0, 0, 20), yaw: 0, anim: 'dash', alive: true, height: 1.8, fighter: { concentrating: false } } as unknown as Actor;
    const scene = new THREE.Scene();
    const fx = new Effects(scene, events, (id) => (id === 1 ? actor : undefined));
    events.emit('chakraDash', { id: 1, homing: true });
    events.emit('substitution', { id: 1, from: { x: 0, y: 0, z: 0 }, to: { x: 2, y: 0, z: 0 } });
    events.emit('jump', { id: 1, air: true });
    events.emit('damage', { targetId: 1, sourceId: 2, amount: 5, blocked: false, killed: false, kind: 'combo5', position: { x: 0, y: 1, z: 0 } });
    for (let i = 0; i < 10; i++) fx.update(1 / 60);
    const log = scene.children.find((o) => (o as THREE.Mesh).isMesh && Array.isArray((o as THREE.Mesh).material) && o.visible);
    expect(log, 'log visible').toBeDefined();
    const live = fx.liveParticles;
    expect(live).toBeGreaterThan(100);
    actor.anim = 'idle';
    for (let i = 0; i < 120; i++) fx.update(1 / 60);
    expect(fx.liveParticles).toBe(0);
    expect(log!.visible).toBe(false);
    expect(log!.position.y).toBeGreaterThan(0); // rests on the ground, not under it
    fx.dispose();
  });
});

describe('Effects v4', () => {
  it('charges, Chidori, Sharingan and grab events spawn and clean up', () => {
    const events = new EventBus();
    const actor = { position: new THREE.Vector3(), velocity: new THREE.Vector3(0, 0, 30), yaw: 0, anim: 'charge', alive: true, height: 1.8, fighter: { concentrating: false } } as unknown as Actor;
    const enemy = { position: new THREE.Vector3(0, 0, 3), velocity: new THREE.Vector3(), yaw: 0, anim: 'grabbed', alive: true, height: 1.8, fighter: { concentrating: false } } as unknown as Actor;
    const scene = new THREE.Scene();
    const fx = new Effects(scene, events, (id) => (id === 1 ? actor : id === 2 ? enemy : undefined));
    const pos = { x: 0, y: 1, z: 0 };
    events.emit('chargeStart', { id: 1, technique: 'chidori', fullTime: 0.5 });
    for (let i = 0; i < 40; i++) fx.update(1 / 60);
    expect(fx.liveParticles).toBeGreaterThan(20);
    const bolts = () => scene.children.filter((o) => o.visible && o.renderOrder === 3).length;
    expect(bolts(), 'crackling bolts while charging').toBeGreaterThan(0);
    events.emit('chargeRelease', { id: 1, technique: 'chidori', power: 1 });
    actor.anim = 'chidori';
    events.emit('technique', { id: 1, name: 'chidori', position: pos, power: 1 });
    events.emit('damage', { targetId: 2, sourceId: 1, amount: 50, blocked: false, killed: false, kind: 'chidori', position: pos });
    for (let i = 0; i < 10; i++) fx.update(1 / 60);
    expect(bolts()).toBeGreaterThan(0);
    actor.anim = 'idle';
    events.emit('technique', { id: 1, name: 'sharingan', position: pos });
    events.emit('genjutsu', { id: 1, targets: [2], radius: 14, duration: 5 });
    events.emit('technique', { id: 1, name: 'special', position: pos, power: 0.2 });
    events.emit('grabStart', { id: 1, targetId: 2 });
    events.emit('qteInput', { id: 1, dir: 'up', correct: true, index: 0 });
    events.emit('qteInput', { id: 1, dir: 'left', correct: false, index: 1 });
    events.emit('grabEnd', { id: 1, targetId: 2, result: 'complete', hits: 6 });
    fx.update(1 / 60);
    expect(fx.liveParticles).toBeGreaterThan(50);
    for (let i = 0; i < 180; i++) fx.update(1 / 60);
    expect(fx.liveParticles, 'charge stopped on release').toBe(0);
    expect(bolts()).toBe(0);
    events.emit('chargeStart', { id: 1, technique: 'rasengan', fullTime: 1.5 });
    events.emit('death', { id: 1, team: 'player' });
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    expect(fx.liveParticles, 'charge stopped on death').toBe(0);
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
    events.emit('chargeStart', { id: 1, technique: 'chidori', fullTime: 1.5 });
    events.emit('chargeRelease', { id: 1, technique: 'chidori', power: 1 });
    events.emit('technique', { id: 1, name: 'sharingan', position: { x: 0, y: 0, z: 0 } });
    events.emit('qteInput', { id: 1, dir: 'up', correct: false, index: 0 });
    events.emit('grabEnd', { id: 1, targetId: 2, result: 'complete', hits: 6 });
    a.dispose();
  });
});

describe('Arena', () => {
  it('builds the coastal valley: open-ground spawns, walkable water, climbables, frees everything', async () => {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    const arena = buildArena(scene, physics);
    physics.step();
    expect(arena.enemySpawns.length).toBeGreaterThanOrEqual(30);
    expect(physics.climbable.size).toBeGreaterThan(20);
    expect(physics.water.size).toBeGreaterThan(0);
    const down = new THREE.Vector3(0, -1, 0);
    for (const s of [arena.playerSpawn, ...arena.enemySpawns]) {
      const hit = physics.raycast(new THREE.Vector3(s.x, s.y + 60, s.z), down, 120, { worldOnly: true });
      expect(hit, `spawn ${s.x},${s.z}`).not.toBeNull();
      // On the ground itself (not on a rock, trunk or roof), not water, not a steep slope.
      expect(s.y - hit!.point.y, `spawn ${s.x},${s.z} height`).toBeGreaterThan(-0.05);
      expect(s.y - hit!.point.y, `spawn ${s.x},${s.z} height`).toBeLessThan(0.8);
      expect(physics.water.has(hit!.collider.handle), `spawn ${s.x},${s.z} water`).toBe(false);
      expect(hit!.normal.y, `spawn ${s.x},${s.z} slope`).toBeGreaterThan(0.8);
      expect(Math.hypot(s.x, s.z)).toBeLessThan(WORLD.boundary.radius);
    }
    // Estuary and open sea are walk-on-water surfaces at the water line.
    for (const [x, z] of [[0, 18], [0, 90], [-30, 110]]) {
      const hit = physics.raycast(new THREE.Vector3(x, 20, z), down, 40, { worldOnly: true });
      expect(hit && physics.water.has(hit.collider.handle), `water at ${x},${z}`).toBe(true);
      expect(physics.isWater(hit!.point)).toBe(true);
    }
    // The sea stack is a climbable vertical face.
    const S = WORLD.stack;
    const side = physics.raycast(new THREE.Vector3(S.x + 40, 15, S.z), new THREE.Vector3(-1, 0, 0), 60, { worldOnly: true });
    expect(side?.climbable).toBe(true);
    expect(Math.abs(side!.normal.y)).toBeLessThanOrEqual(0.5);
    arena.update?.(new THREE.Vector3(50, 2, 50), 1 / 60);
    arena.dispose();
    expect(physics.world.colliders.len()).toBe(0);
    expect(physics.water.size + physics.climbable.size).toBe(0);
    expect(scene.children.length).toBe(0);
  });

  it('terrain is deterministic, finite and roughly 210 m of playable valley', () => {
    expect(heightAt(12.3, -45.6)).toBe(heightAt(12.3, -45.6));
    for (let x = -200; x <= 200; x += 25) for (let z = -200; z <= 200; z += 25) expect(Number.isFinite(heightAt(x, z))).toBe(true);
    expect(heightAt(0, 20)).toBeLessThan(WORLD.waterY); // estuary
    expect(heightAt(0, 100)).toBeLessThan(WORLD.waterY - 3); // sea
    expect(heightAt(WORLD.spawn.x, WORLD.spawn.z)).toBeGreaterThan(WORLD.waterY + 0.5);
    expect(heightAt(80, -10)).toBeGreaterThan(WORLD.plateau.y - 3); // plateau
  });
});
