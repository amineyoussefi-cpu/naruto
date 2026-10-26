import { describe, expect, it } from 'vitest';
import { decodeInputs, encodeInputs, SnapshotDecoder, SnapshotEncoder } from '../../src/net/codec';
import type { ActorState, PlayerInput, Snapshot } from '../../src/sim/protocol';

const angleDiff = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

const actor = (id: number, over: Partial<ActorState> = {}): ActorState => ({
  id, team: 'enemy', x: 123.4567, y: -2.3456, z: 400.0011, vx: 3.217, vy: -9.81, vz: 0.004, yaw: 2.5,
  anim: 'attack3', animTime: 0.734, hp: 57.25, maxHp: 60, chakra: 12.3, maxChakra: 100, flags: 1 | 8 | 4096,
  orb: 1, orbLevel: 0.42, wallNx: 0.6, wallNz: -0.8, ...over,
});

const snap = (tick: number, actors: ActorState[]): Snapshot => ({
  tick, time: tick / 60, actors,
  projectiles: [{ id: 70000, x: 1.5, y: 2.25, z: -3.125, dx: 0.6, dy: 0, dz: 0.8, visual: 'shuriken' }],
  events: [{ type: 'jump', payload: { id: 3, air: true } }],
  players: [{ id: 1, name: 'Ren', character: 'naruto', actorId: 3, team: 'player', ping: 42, connected: true }],
  markers: [{ kind: 'group', id: 2, x: 10, z: 20, count: 4, fighting: false }],
  mode: { downed: [] } as unknown as Snapshot['mode'],
  you: null,
});

describe('input codec', () => {
  it('round-trips two inputs within quantization bounds', () => {
    const inputs: PlayerInput[] = [
      { seq: 4000000000, moveX: -0.71, moveZ: 0.33, camYaw: -3.0, camPitch: 0.4, held: 0x1ffff, pressed: 1 << 16, lockId: 123456, qte: 'left', aimDir: { x: 0.6, y: -0.48, z: 0.64 } },
      { seq: 4000000001, moveX: 1, moveZ: -1, camYaw: 7.1, camPitch: -1.2, held: 0, pressed: 0, lockId: 0, qte: null },
    ];
    const out = decodeInputs(encodeInputs(inputs));
    expect(out).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const a = inputs[i], b = out[i];
      expect(b.seq).toBe(a.seq);
      expect(Math.abs(b.moveX - a.moveX)).toBeLessThan(1 / 127);
      expect(Math.abs(b.moveZ - a.moveZ)).toBeLessThan(1 / 127);
      expect(angleDiff(b.camYaw, a.camYaw)).toBeLessThan(1e-4);
      expect(Math.abs(b.camPitch - a.camPitch)).toBeLessThan(1e-4);
      expect([b.held, b.pressed, b.lockId, b.qte]).toEqual([a.held, a.pressed, a.lockId, a.qte]);
    }
    expect(out[0].aimDir!.x).toBeCloseTo(0.6, 4);
    expect(out[1].aimDir).toBeUndefined();
  });

  it('rejects malformed packets', () => {
    expect(() => decodeInputs(new Uint8Array([1, 2, 3]))).toThrow();
    const bad = encodeInputs([{ seq: 1, moveX: 0, moveZ: 0, camYaw: 0, camPitch: 0, held: 0, pressed: 0, lockId: 0, qte: null }]);
    expect(() => decodeInputs(bad.subarray(0, bad.length - 1))).toThrow();
  });
});

describe('snapshot codec', () => {
  it('round-trips a full snapshot within quantization bounds', () => {
    const s = snap(600, [actor(3), actor(9, { team: 'red', anim: 'downed', yaw: -0.1 })]);
    const d = new SnapshotDecoder().decode(new SnapshotEncoder().encode(s));
    expect(d.tick).toBe(600);
    expect(d.time).toBe(s.time);
    for (let i = 0; i < 2; i++) {
      const a = s.actors[i], b = d.actors[i];
      expect([b.id, b.team, b.anim, b.flags, b.orb]).toEqual([a.id, a.team, a.anim, a.flags, a.orb]);
      for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(b[k] - a[k])).toBeLessThanOrEqual(0.0005);
      for (const k of ['vx', 'vy', 'vz'] as const) expect(Math.abs(b[k] - a[k])).toBeLessThanOrEqual(0.005);
      for (const k of ['hp', 'maxHp', 'chakra', 'maxChakra'] as const) expect(Math.abs(b[k] - a[k])).toBeLessThanOrEqual(0.05);
      expect(angleDiff(b.yaw, a.yaw)).toBeLessThan(1e-4);
      expect(Math.abs(b.animTime - a.animTime)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(b.orbLevel - a.orbLevel)).toBeLessThanOrEqual(1 / 510);
      expect(Math.abs(b.wallNx - a.wallNx)).toBeLessThanOrEqual(1 / 254);
    }
    expect(d.projectiles[0]).toMatchObject({ id: 70000, visual: 'shuriken' });
    expect(d.projectiles[0].z).toBeCloseTo(-3.125, 3);
    expect(d.projectiles[0].dz).toBeCloseTo(0.8, 4);
    expect([d.events, d.players, d.markers, d.mode, d.you]).toEqual([s.events, s.players, s.markers, s.mode, s.you]);
  });

  it('sends unchanged actors as references, and a full snapshot on request', () => {
    const enc = new SnapshotEncoder(), dec = new SnapshotDecoder();
    const first = enc.encode(snap(1, [actor(1), actor(2)]));
    dec.decode(first);
    const moved = actor(2, { x: 130 });
    const delta = enc.encode(snap(3, [actor(1), moved, actor(5)]));
    expect(delta.length).toBeLessThan(first.length + 38); // actor 1 is a 5-byte reference, 5 is new
    const d = dec.decode(delta);
    expect(d.actors.map((a) => a.id)).toEqual([1, 2, 5]);
    expect(d.actors[0].x).toBeCloseTo(123.457, 3);
    expect(d.actors[1].x).toBeCloseTo(130, 3);
    // Actor 2 removed, then a forced full snapshot decodes on a fresh decoder (no references).
    const full = enc.encode(snap(5, [actor(1), actor(5)]), true);
    expect(new SnapshotDecoder().decode(full).actors.map((a) => a.id)).toEqual([1, 5]);
    expect(full.length).toBeGreaterThan(enc.encode(snap(7, [actor(1), actor(5)])).length);
  });

  it('a delta without its reference fails loudly', () => {
    const enc = new SnapshotEncoder();
    enc.encode(snap(1, [actor(1)]));
    expect(() => new SnapshotDecoder().decode(enc.encode(snap(3, [actor(1)])))).toThrow();
  });
});
