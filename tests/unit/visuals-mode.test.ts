import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ModeVisuals } from '../../src/render/ModeVisuals';
import { computePose, NinjaModel, POSE_SIZE } from '../../src/render/NinjaModel';
import { LOOKS } from '../../src/render/looks';
import type { ActorView } from '../../src/game/ActorView';
import type { ModeState, PvpState } from '../../src/sim/missions/types';
import type { WorldData } from '../../src/sim/world/types';

const world = { arenas: [{ id: 'clearing', name: 'Clairière', center: { x: 10, y: 0, z: -5 }, radius: 25, spawns: { red: [], blue: [] } }] } as unknown as WorldData;

function mode(phase: PvpState['phase'], downed: ModeState['downed'] = []): ModeState {
  return { coop: {} as ModeState['coop'], pvp: { phase, arenaId: 'clearing' } as PvpState, downed };
}

function view(id: number, x: number, team: ActorView['team'] = 'player', kind: ActorView['kind'] = 'player'): ActorView {
  return { id, kind, name: `P${id}`, team, removed: false, height: 1.8, position: new THREE.Vector3(x, 0, 0), model: new NinjaModel(LOOKS.player) } as unknown as ActorView;
}

const camera = new THREE.PerspectiveCamera();
const run = (mv: ModeVisuals, m: ModeState | null, views: ActorView[], frames = 120) => {
  for (let i = 0; i < frames; i++) mv.update(1 / 60, { mode: m, world, views, myActorId: 1, camera });
};

describe('ModeVisuals', () => {
  it('shows the dome only during a match, fades it out after, and frees it', () => {
    const scene = new THREE.Scene();
    const mv = new ModeVisuals(scene);
    run(mv, mode('idle'), []);
    expect(mv.dome.visible).toBe(false);
    run(mv, mode('countdown'), []);
    expect(mv.dome.visible).toBe(false);
    run(mv, mode('running'), []);
    expect(mv.dome.visible).toBe(true);
    expect(mv.dome.position.x).toBe(10);
    expect(mv.dome.scale.x).toBe(25);
    run(mv, mode('results'), [], 1);
    expect(mv.dome.visible).toBe(true); // fading
    run(mv, mode('results'), [], 300);
    expect(mv.dome.visible).toBe(false);
    mv.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('tags every other player (not me, not enemies, not far away), at most 6', () => {
    const scene = new THREE.Scene();
    const mv = new ModeVisuals(scene);
    const views = [view(1, 0), view(2, 3), view(3, 5), view(4, 60), view(5, 4, 'enemy', 'melee')];
    run(mv, null, views, 1);
    expect([...mv.tags.keys()].sort()).toEqual([2, 3]);
    expect(mv.tags.get(2)!.sprite.position.y).toBeGreaterThan(1.8);
    run(mv, null, [view(1, 0), ...Array.from({ length: 9 }, (_, i) => view(i + 10, i + 1))], 1);
    expect(mv.tags.size).toBe(6);
    run(mv, null, [], 1);
    expect(mv.tags.size).toBe(0);
    mv.dispose();
  });

  it('applies the PvP team rim tint and removes it after the match', () => {
    const mv = new ModeVisuals(new THREE.Scene());
    const red = view(2, 3, 'red'), blue = view(3, 4, 'blue');
    run(mv, mode('running'), [red, blue], 1);
    expect(red.model.teamTint).not.toBeNull();
    expect(blue.model.teamTint).not.toBeNull();
    expect(red.model.teamTint).not.toBe(blue.model.teamTint);
    red.team = 'player'; blue.team = 'player';
    run(mv, mode('idle'), [red, blue], 1);
    expect(red.model.teamTint).toBeNull();
    expect(blue.model.teamTint).toBeNull();
    blue.team = 'blue';
    run(mv, mode('running'), [blue], 1);
    run(mv, mode('idle'), [], 1); // view gone: tint still removed
    expect(blue.model.teamTint).toBeNull();
    mv.dispose();
  });

  it('draws a revive ring under downed players with their progress', () => {
    const mv = new ModeVisuals(new THREE.Scene());
    const v = view(2, 3);
    run(mv, mode('idle', [{ actorId: 2, bleed: 20, revive: 0.4 }]), [v], 1);
    const ring = mv.rings.get(2)!;
    expect(ring.material.uniforms.progress.value).toBe(0.4);
    expect(ring.position.x).toBe(3);
    run(mv, mode('idle'), [v], 1);
    expect(mv.rings.size).toBe(0);
    mv.dispose();
  });
});

describe('downed pose', () => {
  const pose = (a: Parameters<typeof computePose>[0], speed = 0, phase = 1) => Array.from(computePose(a, 2, phase, 1, speed, new Float32Array(POSE_SIZE)));
  const diff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
  it('lies on the ground, differs from idle and dead, and crawls when moving', () => {
    const downed = pose('downed');
    expect(downed[1]).toBeGreaterThan(1.2); // face down
    expect(diff(downed, pose('idle'))).toBeGreaterThan(1);
    expect(diff(downed, pose('dead'))).toBeGreaterThan(1);
    expect(diff(pose('downed', 0.5, 0.5), pose('downed', 0.5, 4))).toBeGreaterThan(0.3);
    expect(diff(pose('downed', 0.1, 0.5), pose('downed', 0.1, 4))).toBeLessThan(1e-6);
  });
});
