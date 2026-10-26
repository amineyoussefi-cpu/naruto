import { describe, expect, it } from 'vitest';
import { ServerHost, type ClientLink, type SimLike } from '../../server/ServerHost';
import { encodeInputs, SnapshotDecoder } from '../../src/net/codec';
import { NET } from '../../src/config/net';
import { emptyInput, PROTOCOL_VERSION, type PlayerInput, type ServerMsg, type Snapshot } from '../../src/sim/protocol';

class FakeSim implements SimLike {
  seed = 7;
  tick = 0;
  next = 1;
  players = new Map<number, { name: string; connected: boolean; character: string }>();
  inputs: { id: number; input: PlayerInput }[] = [];
  rtt = new Map<number, number>();
  addPlayer(name: string, character: 'naruto'): { id: number; actor: { id: number } } {
    if (this.players.size >= 6) throw new Error('full');
    const id = this.next++;
    this.players.set(id, { name, connected: true, character });
    return { id, actor: { id: 100 + id } };
  }
  removePlayer(id: number): void { this.players.delete(id); }
  setConnected(id: number, c: boolean): void { this.players.get(id)!.connected = c; }
  setCharacter(id: number, c: string): void { this.players.get(id)!.character = c; }
  setRtt(id: number, ms: number): void { this.rtt.set(id, ms); }
  setInput(id: number, input: PlayerInput): void { this.inputs.push({ id, input }); }
  step(): void { this.tick++; }
  takeEvents(): Snapshot['events'] { return [{ type: 'jump', payload: { id: 1 } }]; }
  takeActorChanges(): { add: []; remove: number[] } { return { add: [], remove: [] }; }
  actorInfos(): [] { return []; }
  snapshot(forPlayer: number | null, events: Snapshot['events']): Snapshot {
    return {
      tick: this.tick, time: this.tick / 60, actors: [], projectiles: [], events, players: [], markers: [],
      mode: {} as Snapshot['mode'], you: forPlayer === null ? null : ({ playerId: forPlayer } as Snapshot['you']),
    };
  }
}

class FakeLink implements ClientLink {
  sent: (string | Uint8Array)[] = [];
  closedWith: number | null = null;
  rtt = 37;
  onMessage: (data: string | Uint8Array) => void = () => {};
  onClose: (code: number, reason: string) => void = () => {};
  constructor(readonly remoteAddress = '100.64.0.9') {}
  send(d: string | Uint8Array): void { this.sent.push(d); }
  ping(): void {}
  close(code = 1000): void { if (this.closedWith === null) { this.closedWith = code; this.onClose(code, ''); } }
  json(): ServerMsg[] { return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d) as ServerMsg); }
  binary(): Uint8Array[] { return this.sent.filter((d): d is Uint8Array => typeof d !== 'string'); }
}

const hello = (name: string): string => JSON.stringify({ t: 'hello', version: PROTOCOL_VERSION, name, character: 'naruto' });

function join(host: ServerHost, name: string, addr?: string): FakeLink {
  const l = new FakeLink(addr);
  host.accept(l);
  l.onMessage(hello(name));
  return l;
}

describe('ServerHost', () => {
  it('welcomes players, marks localhost as host, refuses the 7th and wrong versions', () => {
    const sim = new FakeSim();
    const host = new ServerHost(sim);
    const links = Array.from({ length: 6 }, (_, k) => join(host, `p${k}`, k === 0 ? '127.0.0.1' : undefined));
    expect(links[0].json()[0]).toMatchObject({ t: 'welcome', playerId: 1, actorId: 101, seed: 7, isHost: true });
    expect(links[1].json()[0]).toMatchObject({ t: 'welcome', isHost: false });
    const seventh = join(host, 'late');
    expect(seventh.json()).toEqual([{ t: 'full' }]);
    expect(seventh.closedWith).not.toBeNull();
    const old = new FakeLink();
    host.accept(old);
    old.onMessage(JSON.stringify({ t: 'hello', version: -1, name: 'x', character: 'naruto' }));
    expect(old.json()).toEqual([{ t: 'version', server: PROTOCOL_VERSION }]);
  });

  it('sends 30 Hz delta snapshots with the events and periodic full ones', () => {
    const sim = new FakeSim();
    const host = new ServerHost(sim);
    const a = join(host, 'a');
    for (let k = 0; k < 60; k++) host.stepOnce();
    const snaps = a.binary();
    expect(snaps).toHaveLength(60 / (60 / NET.snapshotRate));
    const dec = new SnapshotDecoder();
    const decoded = snaps.map((s) => dec.decode(s));
    expect(decoded[0].events).toHaveLength(2); // two steps of events per snapshot
    expect(decoded[0].you).toMatchObject({ playerId: 1 });
    expect(snaps.filter((s) => (s[2] & 1) === 1).length).toBeGreaterThanOrEqual(2); // first + after 1 s
  });

  it('applies one queued input per step, holds the last one with no new edges, merges overflow', () => {
    const sim = new FakeSim();
    const host = new ServerHost(sim);
    const a = join(host, 'a');
    const inp = (seq: number, pressed: number): PlayerInput => ({ ...emptyInput(seq), held: 1, pressed });
    a.onMessage(encodeInputs([inp(1, 4), inp(2, 0)]));
    for (let k = 0; k < 3; k++) host.stepOnce();
    expect(sim.inputs.map((i) => [i.input.seq, i.input.pressed, i.input.held])).toEqual([[1, 4, 1], [2, 0, 1], [2, 0, 1]]);
    sim.inputs = [];
    const burst = Array.from({ length: NET.inputQueueMax + 2 }, (_, k) => inp(3 + k, 1 << k));
    for (let k = 0; k < burst.length; k += 2) a.onMessage(encodeInputs(burst.slice(k, k + 2)));
    for (let k = 0; k < NET.inputQueueMax; k++) host.stepOnce();
    expect(sim.inputs).toHaveLength(NET.inputQueueMax);
    expect(sim.inputs[0].input.pressed).toBe(0b111); // three oldest merged
    a.onMessage(encodeInputs([inp(1, 0)])); // stale seq ignored
    host.stepOnce();
    expect(sim.inputs.at(-1)!.input.seq).toBe(burst.at(-1)!.seq);
  });

  it('keeps a disconnected player for the grace period and gives it back on reconnect', () => {
    const sim = new FakeSim();
    const host = new ServerHost(sim);
    const a = join(host, 'Ren');
    a.close();
    expect(sim.players.get(1)!.connected).toBe(false);
    host.stepOnce();
    const back = join(host, 'Ren');
    expect(back.json()[0]).toMatchObject({ t: 'welcome', playerId: 1, actorId: 101 });
    expect(sim.players.get(1)!.connected).toBe(true);
    back.close();
    for (let k = 0; k < NET.reconnectGrace * 60 + 1; k++) host.stepOnce();
    expect(sim.players.has(1)).toBe(false);
  });

  it('lets only the host kick, measures rtt, answers pings, closes on garbage', () => {
    const sim = new FakeSim();
    const host = new ServerHost(sim);
    const owner = join(host, 'owner', '::1');
    const guest = join(host, 'guest');
    guest.onMessage(JSON.stringify({ t: 'kick', playerId: 1 }));
    expect(sim.players.has(1)).toBe(true);
    owner.onMessage(JSON.stringify({ t: 'ping', time: 12.5 }));
    expect(owner.json().at(-1)).toEqual({ t: 'pong', time: 12.5 });
    for (let k = 0; k < 60; k++) host.stepOnce();
    expect(sim.rtt.get(2)).toBe(37);
    owner.onMessage(JSON.stringify({ t: 'kick', playerId: 2 }));
    expect(guest.json().at(-1)).toEqual({ t: 'kicked' });
    expect(sim.players.has(2)).toBe(false);
    expect(join(host, 'guest').json()[0]).toMatchObject({ t: 'welcome', playerId: 3 }); // no reconnect slot after a kick
    const bad = join(host, 'bad');
    bad.onMessage('{nope');
    expect(bad.closedWith).toBe(1007);
  });
});
