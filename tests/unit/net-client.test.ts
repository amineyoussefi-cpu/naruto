import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from '../../src/net/interpolation';
import { CorrectionSmoother, InputHistory } from '../../src/net/prediction';
import { emptyInput, type PlayerInput, type Snapshot } from '../../src/sim/protocol';

const snapAt = (tick: number): Snapshot => ({ tick, time: tick / 60 } as Snapshot);

describe('SnapshotBuffer', () => {
  it('brackets now − delay with a blend factor', () => {
    const buf = new SnapshotBuffer(100);
    // Snapshots every 2 ticks (33.3 ms), arriving with a constant 50 ms latency.
    for (let k = 0; k < 10; k++) buf.push(snapAt(k * 2), (k * 2 * 1000) / 60 + 50);
    const now = (12 * 1000) / 60 + 50 + 100 + 1000 / 60 / 2; // render server tick 12.5
    const s = buf.sample(now)!;
    expect(s.a.tick).toBe(12);
    expect(s.b.tick).toBe(14);
    expect(s.t).toBeCloseTo(0.25, 2);
  });

  it('clamps before the oldest and after the newest snapshot', () => {
    const buf = new SnapshotBuffer(100);
    buf.push(snapAt(0), 0);
    buf.push(snapAt(2), 33);
    expect(buf.sample(0)).toMatchObject({ t: 0 });
    const late = buf.sample(10000)!;
    expect([late.a.tick, late.b.tick, late.t]).toEqual([2, 2, 1]);
    expect(new SnapshotBuffer().sample(0)).toBeNull();
  });

  it('smooths arrival jitter in the clock offset', () => {
    const buf = new SnapshotBuffer(100);
    for (let k = 0; k < 200; k++) buf.push(snapAt(k * 2), (k * 2 * 1000) / 60 + 50 + (k % 2 ? 15 : -15));
    const tNow = (398 * 1000) / 60 + 50 + 100;
    expect(Math.abs(buf.renderTime(tNow) - 398 / 60)).toBeLessThan(0.01);
  });
});

/** Toy 1-D movement model: the server applies the same rule plus an external push. */
type State = { x: number };
const apply = (s: State, i: PlayerInput): State => ({ x: s.x + i.moveX * 0.1 });
const input = (seq: number, moveX: number): PlayerInput => ({ ...emptyInput(seq), moveX });

describe('prediction', () => {
  it('replaying pending inputs converges to the server state', () => {
    const history = new InputHistory<State>((a, b) => Math.abs(a.x - b.x), 0.01);
    let client: State = { x: 0 };
    let server: State = { x: 0 };
    const inputs = Array.from({ length: 30 }, (_, k) => input(k + 1, k % 3 === 0 ? -1 : 1));
    for (const i of inputs) { client = apply(client, i); history.record(i, client); }
    // Server applied the first 20 inputs, and something pushed the player by 1 m at input 10.
    for (const i of inputs.slice(0, 20)) { server = apply(server, i); if (i.seq === 10) server = { x: server.x + 1 }; }
    let replays = 0;
    const corrected = history.reconcile(20, server, (i) => { replays++; client = apply(client, i); return client; }, (s) => { client = { ...s }; });
    expect(corrected).toBe(true);
    expect(replays).toBe(10);
    expect(history.pending.map((i) => i.seq)).toEqual(inputs.slice(20).map((i) => i.seq));
    for (const i of inputs.slice(20)) server = apply(server, i);
    expect(client.x).toBeCloseTo(server.x, 9);
    // Next ack agrees with the corrected prediction: no correction.
    expect(history.reconcile(25, (() => { let s = { x: 0 }; for (const i of inputs.slice(0, 25)) { s = apply(s, i); if (i.seq === 10) s = { x: s.x + 1 }; } return s; })(), () => client, () => {})).toBe(false);
    expect(history.pending).toHaveLength(5);
  });

  it('smooths small corrections over smoothMs and snaps large ones', () => {
    const s = new CorrectionSmoother(100, 2);
    s.correct({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(s.update(50).x).toBeCloseTo(0.5, 5);
    expect(s.update(50).x).toBeCloseTo(0, 5);
    s.correct({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(s.offset.x).toBe(0);
  });
});
