import type { AttackKind, GameState, Team, Vec3Like } from './types';

/** Gameplay events. Producers emit, any system may listen. */
export interface GameEvents {
  damage: { targetId: number; sourceId: number; amount: number; blocked: boolean; killed: boolean; kind: AttackKind; position: Vec3Like };
  death: { id: number; team: Team };
  attackStart: { id: number; kind: AttackKind; position: Vec3Like };
  /** An enemy announces an attack; `duration` is the wind-up time. */
  telegraph: { id: number; duration: number };
  chakraFail: { id: number; action: string };
  technique: { id: number; name: 'special'; position: Vec3Like };
  projectileHit: { position: Vec3Like; hitActor: boolean };
  dodge: { id: number };
  jump: { id: number };
  land: { id: number; impact: number };
  footstep: { id: number; sprint: boolean };
  climbStart: { id: number };
  concentrateStart: { id: number };
  respawn: { id: number };
  waveStart: { wave: number; totalWaves: number; enemies: number };
  waveCleared: { wave: number };
  enemiesRemaining: { count: number };
  victory: Record<string, never>;
  defeat: Record<string, never>;
  lockOn: { targetId: number | null };
  cameraShake: { intensity: number; duration: number };
  hitStop: { duration: number };
  stateChange: { state: GameState; prev: GameState };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  off<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): void {
    this.handlers.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) (fn as Handler<GameEvents[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
