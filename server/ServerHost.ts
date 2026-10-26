/**
 * Host-authoritative session: owns the simulation, runs it at a fixed 60 Hz, queues client inputs,
 * broadcasts snapshots (binary, per-recipient delta) and handles join / leave / reconnect / kick.
 * Transport-agnostic: anything shaped like `ClientLink` (the WebSocket in ws.ts, a fake in tests).
 */
import { SIM_DT } from '../src/config';
import { CHARACTER_IDS } from '../src/config/characters';
import { NET } from '../src/config/net';
import type { CharacterId } from '../src/core/types';
import { decodeInputs, SnapshotEncoder } from '../src/net/codec';
import {
  MAX_PLAYERS, PROTOCOL_VERSION,
  type ActorInfo, type ClientMsg, type DebugMsg, type PlayerId, type PlayerInput, type ServerMsg, type SimEvent, type Snapshot,
} from '../src/sim/protocol';

/** The part of `src/sim/Sim.ts` the host drives. */
export interface SimLike {
  readonly seed: number;
  readonly tick: number;
  addPlayer(name: string, character: CharacterId): { id: PlayerId; actor: { id: number } };
  removePlayer(id: PlayerId): void;
  setConnected(id: PlayerId, connected: boolean): void;
  setCharacter(id: PlayerId, character: CharacterId): void;
  setRtt(id: PlayerId, ms: number): void;
  setInput(id: PlayerId, input: PlayerInput): void;
  step(): void;
  takeEvents(): SimEvent[];
  takeActorChanges(): { add: ActorInfo[]; remove: number[] };
  actorInfos(): ActorInfo[];
  snapshot(forPlayer: PlayerId | null, events: SimEvent[]): Snapshot;
  debug?(id: PlayerId, msg: DebugMsg): void;
}

/** One client connection as the host sees it (`WebSocketConnection` matches). */
export interface ClientLink {
  readonly remoteAddress: string;
  /** Last measured round-trip time (ms). */
  readonly rtt: number;
  onMessage: (data: string | Uint8Array) => void;
  onClose: (code: number, reason: string) => void;
  send(data: string | Uint8Array): void;
  ping(): void;
  close(code?: number, reason?: string): void;
}

interface Client {
  link: ClientLink;
  isHost: boolean;
  playerId: PlayerId | null;
  actorId: number;
  name: string;
  queue: PlayerInput[];
  last: PlayerInput | null;
  encoder: SnapshotEncoder;
  lastFullTick: number;
}

/** Disconnected player waiting for a reconnect with the same name. */
interface Pending { playerId: PlayerId; actorId: number; deadlineTick: number }

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const STEPS_PER_SNAPSHOT = Math.max(1, Math.round(1 / SIM_DT / NET.snapshotRate));
const FULL_EVERY_TICKS = Math.round(NET.fullSnapshotInterval / SIM_DT);
const PING_EVERY_TICKS = Math.round(NET.pingIntervalMs / 1000 / SIM_DT);
const GRACE_TICKS = Math.round(NET.reconnectGrace / SIM_DT);

/** Merges the oldest queued input into the next one so its edge-triggered bits are not lost. */
export function mergeOldest(queue: PlayerInput[]): void {
  const [a, b] = queue;
  b.pressed |= a.pressed;
  b.qte ??= a.qte;
  queue.shift();
}

export class ServerHost {
  private readonly clients = new Set<Client>();
  private readonly pending = new Map<string, Pending>();
  private events: SimEvent[] = [];
  private steps = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Accept `debug` test messages (server started with `--debug`). */
  debugEnabled = false;

  constructor(readonly sim: SimLike) {}

  static async create(createSim: () => Promise<SimLike>): Promise<ServerHost> {
    return new ServerHost(await createSim());
  }

  /** Connected players (with a player slot). */
  get playerCount(): number { return [...this.clients].filter((c) => c.playerId !== null).length; }

  /** Starts the real-time loop (fixed steps from a monotonic-clock accumulator, catch-up capped). */
  start(): void {
    if (this.timer) return;
    const dtNs = BigInt(Math.round(SIM_DT * 1e9));
    let last = process.hrtime.bigint();
    let acc = 0n;
    this.timer = setInterval(() => {
      const now = process.hrtime.bigint();
      acc += now - last;
      last = now;
      let n = 0;
      while (acc >= dtNs && n < NET.maxCatchUpSteps) { this.stepOnce(); acc -= dtNs; n++; }
      if (acc >= dtNs) acc = 0n; // shortcut: a long stall is skipped, not replayed
    }, NET.loopIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.clients) c.link.close(1001, 'server stopping');
  }

  /** Registers a new connection. */
  accept(link: ClientLink): void {
    const c: Client = {
      link, isHost: LOCAL_ADDRESSES.has(link.remoteAddress), playerId: null, actorId: 0, name: '',
      queue: [], last: null, encoder: new SnapshotEncoder(), lastFullTick: 0,
    };
    this.clients.add(c);
    link.onMessage = (data) => {
      try {
        if (typeof data === 'string') this.onControl(c, JSON.parse(data) as ClientMsg);
        else this.onInputs(c, decodeInputs(data));
      } catch (e) {
        console.error(`client ${c.name || '?'}: ${e instanceof Error ? e.stack : String(e)}`);
        link.close(1007, 'bad message');
      }
    };
    link.onClose = (code: number, reason: string) => {
      if (c.playerId !== null) console.log(`${c.name} déconnecté / disconnected (${code}${reason ? ` ${reason}` : ''})`);
      this.onClose(c);
    };
  }

  /** One simulation step (+ snapshot every `STEPS_PER_SNAPSHOT`). Public for tests. */
  stepOnce(): void {
    for (const c of this.clients) {
      if (c.playerId === null) continue;
      if (c.queue.length) c.last = c.queue.shift()!;
      else if (c.last) c.last = { ...c.last, pressed: 0, qte: null }; // hold the keys, no new edges
      if (c.last) this.sim.setInput(c.playerId, c.last);
    }
    this.sim.step();
    this.steps++;
    this.events.push(...this.sim.takeEvents());
    for (const [name, p] of this.pending) {
      if (this.sim.tick < p.deadlineTick) continue;
      this.pending.delete(name);
      this.sim.removePlayer(p.playerId);
    }
    if (this.steps % PING_EVERY_TICKS === 0) {
      for (const c of this.clients) {
        c.link.ping();
        if (c.playerId !== null && c.link.rtt > 0) this.sim.setRtt(c.playerId, c.link.rtt);
      }
    }
    if (this.steps % STEPS_PER_SNAPSHOT === 0) this.broadcast();
  }

  private broadcast(): void {
    const changes = this.sim.takeActorChanges();
    if (changes.add.length || changes.remove.length) this.sendAll({ t: 'actors', add: changes.add, remove: changes.remove });
    const events = this.events;
    this.events = [];
    const tick = this.sim.tick;
    for (const c of this.clients) {
      if (c.playerId === null) continue;
      const full = tick - c.lastFullTick >= FULL_EVERY_TICKS;
      if (full) c.lastFullTick = tick;
      c.link.send(c.encoder.encode(this.sim.snapshot(c.playerId, events), full));
    }
  }

  private sendAll(msg: ServerMsg): void {
    const text = JSON.stringify(msg);
    for (const c of this.clients) if (c.playerId !== null) c.link.send(text);
  }

  private send(c: Client, msg: ServerMsg): void { c.link.send(JSON.stringify(msg)); }

  private onInputs(c: Client, inputs: PlayerInput[]): void {
    if (c.playerId === null) return;
    for (const i of inputs) {
      if (c.last && i.seq <= c.last.seq) continue; // duplicate or stale
      if (c.queue.length && i.seq <= c.queue[c.queue.length - 1].seq) continue;
      c.queue.push(i);
    }
    while (c.queue.length > NET.inputQueueMax) mergeOldest(c.queue);
  }

  private onControl(c: Client, msg: ClientMsg): void {
    switch (msg.t) {
      case 'hello': return this.onHello(c, msg);
      case 'character':
        if (c.playerId !== null && CHARACTER_IDS.includes(msg.character)) this.sim.setCharacter(c.playerId, msg.character);
        return;
      case 'kick': {
        if (!c.isHost || msg.playerId === c.playerId) return;
        const target = [...this.clients].find((o) => o.playerId === msg.playerId);
        if (target) {
          this.send(target, { t: 'kicked' });
          target.playerId = null; // so onClose doesn't keep a reconnect slot
          target.link.close(4000, 'kicked');
          this.sim.removePlayer(msg.playerId);
          return;
        }
        for (const [name, p] of this.pending) {
          if (p.playerId !== msg.playerId) continue;
          this.pending.delete(name);
          this.sim.removePlayer(p.playerId);
        }
        return;
      }
      case 'ping': return this.send(c, { t: 'pong', time: Number(msg.time) || 0 });
      case 'debug':
        if (this.debugEnabled && c.playerId !== null) this.sim.debug?.(c.playerId, msg);
        return;
      default: throw new Error('unknown message');
    }
  }

  private onHello(c: Client, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (c.playerId !== null) return;
    if (msg.version !== PROTOCOL_VERSION) {
      this.send(c, { t: 'version', server: PROTOCOL_VERSION });
      c.link.close(4001, 'version');
      return;
    }
    const name = String(msg.name ?? '').trim().slice(0, NET.nameMaxLength) || 'Ninja';
    const character: CharacterId = CHARACTER_IDS.includes(msg.character) ? msg.character : CHARACTER_IDS[0];
    const back = this.pending.get(name);
    if (back) {
      this.pending.delete(name);
      c.playerId = back.playerId;
      c.actorId = back.actorId;
      this.sim.setConnected(back.playerId, true);
      this.sim.setCharacter(back.playerId, character);
    } else {
      if (this.playerCount + this.pending.size >= MAX_PLAYERS) return this.reject(c);
      try {
        const p = this.sim.addPlayer(name, character);
        c.playerId = p.id;
        c.actorId = p.actor.id;
      } catch {
        return this.reject(c);
      }
    }
    c.name = name;
    c.lastFullTick = this.sim.tick;
    this.send(c, { t: 'welcome', playerId: c.playerId, actorId: c.actorId, seed: this.sim.seed, isHost: c.isHost, actors: this.sim.actorInfos() });
  }

  private reject(c: Client): void {
    this.send(c, { t: 'full' });
    c.link.close(4002, 'full');
  }

  private onClose(c: Client): void {
    this.clients.delete(c);
    if (c.playerId === null) return;
    this.sim.setConnected(c.playerId, false);
    const older = this.pending.get(c.name); // two players shared a name: only the latest keeps the slot
    if (older) this.sim.removePlayer(older.playerId);
    this.pending.set(c.name, { playerId: c.playerId, actorId: c.actorId, deadlineTick: this.sim.tick + GRACE_TICKS });
  }
}
