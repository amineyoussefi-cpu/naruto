import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Sim } from '../../src/sim/Sim';
import { actionBit, emptyInput, type PlayerInput } from '../../src/sim/protocol';

const modules = import.meta.glob('../../src/sim/**/*.ts');
const sources = import.meta.glob<string>('../../src/sim/**/*.ts', { query: '?raw', import: 'default', eager: true });

/** Flat 200 m floor. */
const flat = (physics: Parameters<Parameters<typeof Sim.create>[0]['buildWorld']>[0]) => {
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(100, 0.5, 100));
  return { world: null, playerSpawns: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 0)], enemySpawns: [new THREE.Vector3(20, 0, 20)] };
};

describe('simulation is Node-safe', () => {
  it('imports every src/sim module in Node', async () => {
    const paths = Object.keys(modules);
    expect(paths.length).toBeGreaterThan(15);
    for (const p of paths) await modules[p]();
  });

  it('no DOM, window, WebGL or wall clock in src/sim sources', () => {
    for (const [p, raw] of Object.entries(sources)) {
      const src = raw.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      expect(src, p).not.toMatch(/\b(document|window|WebGLRenderer|requestAnimationFrame|performance\.now|Date\.now)\b/);
    }
  });
});

describe('Sim', () => {
  const step = (sim: Sim, id: number, input: Partial<PlayerInput>, n: number, seq: { v: number }) => {
    for (let i = 0; i < n; i++) {
      sim.setInput(id, { ...emptyInput(++seq.v), ...input });
      sim.step();
    }
  };

  it('moves each player from its own input and acks the last seq', async () => {
    const sim = await Sim.create({ seed: 7, online: true, buildWorld: flat });
    const a = sim.addPlayer('A', 'naruto');
    const b = sim.addPlayer('B', 'sasuke');
    expect(sim.takeActorChanges().add.map((i) => i.look)).toEqual(['naruto', 'sasuke']);
    const seq = { v: 0 };
    const z0 = a.actor.position.z, bx = b.actor.position.x;
    step(sim, a.id, { moveZ: 1, held: actionBit('forward') }, 60, seq); // camYaw 0 → +Z
    expect(a.actor.position.z - z0).toBeGreaterThan(4);
    expect(b.actor.position.x).toBeCloseTo(bx, 3);
    expect(sim.ackSeq(a.id)).toBe(seq.v);
    const snap = sim.snapshot(a.id, sim.takeEvents());
    expect(snap.you?.actorId).toBe(a.actor.id);
    expect(snap.players).toHaveLength(2);
    expect(snap.actors.find((s) => s.id === a.actor.id)?.anim).toBe('run');
    expect(snap.events.some((e) => e.type === 'footstep')).toBe(true);
    sim.dispose();
  });

  it('a pressed action fires once even when the input repeats, and a 7th player is refused', async () => {
    const sim = await Sim.create({ seed: 1, online: true, buildWorld: flat });
    const a = sim.addPlayer('A', 'naruto');
    sim.takeEvents();
    sim.setInput(a.id, { ...emptyInput(1), pressed: actionBit('jump') });
    for (let i = 0; i < 5; i++) sim.step(); // the server repeats the last input while no new packet arrives
    expect(sim.takeEvents().filter((e) => e.type === 'jump')).toHaveLength(1);
    for (let i = 0; i < 5; i++) sim.addPlayer(`P${i}`, 'kakashi');
    expect(() => sim.addPlayer('7', 'naruto')).toThrow();
    sim.dispose();
  });

  it('players of different PvP teams hit each other at the PvP damage scale; same team never', async () => {
    const sim = await Sim.create({ seed: 1, online: true, buildWorld: flat });
    const a = sim.addPlayer('A', 'naruto'), b = sim.addPlayer('B', 'naruto');
    const hit = () => sim.ctx.combat.dealDamage(a.actor, b.actor, 10, 0, 'combo1', b.actor.chest());
    a.actor.team = 'red'; b.actor.team = 'blue';
    expect(sim.ctx.hostiles(a.actor)).toContain(b.actor);
    expect(hit().applied).toBeCloseTo(7);
    a.actor.team = b.actor.team = 'player';
    expect(sim.ctx.hostiles(a.actor)).not.toContain(b.actor);
    sim.dispose();
  });
});
