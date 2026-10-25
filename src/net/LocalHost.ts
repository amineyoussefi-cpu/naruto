import type { CharacterId } from '../core/types';
import { Sim } from '../sim/Sim';
import { legacyWorld, waveDirector } from '../sim/legacy';
import type { WaveManager } from '../sim/ai/WaveManager';
import type { ClientMsg, PlayerId, PlayerInput, ServerMsg } from '../sim/protocol';
import type { Connection } from './connection';

/**
 * Solo, offline: the simulation runs in the page. Each `sendInput` runs exactly one step and queues its
 * snapshot, so a paused client (no inputs) is a paused game. Owner: integration.
 */
export class LocalHost implements Connection {
  readonly online = false;
  private queue: ServerMsg[] = [];
  private constructor(readonly sim: Sim, readonly playerId: PlayerId, readonly waves: WaveManager) {}

  static async create(name: string, character: CharacterId, seed = 1): Promise<LocalHost> {
    let director: ReturnType<typeof waveDirector> | null = null;
    const sim = await Sim.create({
      seed, online: false, buildWorld: legacyWorld,
      createDirector: (ctx) => (director = waveDirector(ctx, () => sim.ai)),
    });
    const p = sim.addPlayer(name, character);
    sim.takeActorChanges();
    const host = new LocalHost(sim, p.id, director!.waves);
    host.queue.push({ t: 'welcome', playerId: p.id, actorId: p.actor.id, seed, isHost: true, actors: sim.actorInfos() });
    host.queue.push({ t: 'snapshot', snap: sim.snapshot(p.id, []) });
    return host;
  }

  poll(): ServerMsg[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  sendInput(input: PlayerInput): void {
    this.sim.setInput(this.playerId, input);
    this.sim.step();
    this.flush();
  }

  /** Queues actor changes and a snapshot of the current state (after a step or a reset). */
  flush(): void {
    const ch = this.sim.takeActorChanges();
    if (ch.add.length || ch.remove.length) this.queue.push({ t: 'actors', ...ch });
    this.queue.push({ t: 'snapshot', snap: this.sim.snapshot(this.playerId, this.sim.takeEvents()) });
  }

  send(msg: ClientMsg): void {
    if (msg.t === 'character') {
      this.sim.setCharacter(this.playerId, msg.character);
      this.flush();
    }
  }

  close(): void {
    this.sim.dispose();
  }
}
