import * as THREE from 'three';
import { COMBAT, ENEMIES, MOVEMENT, SIM_DT } from '../config';
import { NET } from '../config/net';
import { EventBus } from '../core/events';
import type { ActorKind, CharacterId } from '../core/types';
import { NAMES } from '../render/looks';
import { Actor } from './Actor';
import { EnemyAI } from './ai/EnemyAI';
import { CombatSystem } from './combat/CombatSystem';
import { Fighter } from './combat/Fighter';
import { PlayerCombat } from './combat/PlayerCombat';
import type { PlayerState, SimContext, SpawnModifiers } from './context';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { PlayerController } from './player/PlayerController';
import {
  ACTOR_FLAGS, emptyInput, hasBit, INPUT_ACTIONS, MAX_PLAYERS,
  type ActorInfo, type ActorState, type InputAction, type PlayerId, type PlayerInput, type SimEvent, type Snapshot,
} from './protocol';
import type { WorldData } from './world/types';
import type { ModeState, Marker } from './missions/types';

/** Mode director plugged in by the missions module (co-op missions, PvP). Optional so the core runs without it. */
export interface Director {
  update(dt: number): void;
  state(): ModeState;
  markers(forPlayer: PlayerId): Marker[];
  onPlayerJoin(p: PlayerState): void;
  onPlayerLeave(p: PlayerState): void;
  reset(): void;
  /** PvP pre-round freeze: combat and movement skip frozen players. */
  frozen?(actorId: number): boolean;
}

export interface SimOptions {
  seed: number;
  /** Online sessions never pause and skip solo-only feedback. */
  online: boolean;
  /** Builds the static world (colliders) into `physics`; returns the world data (null = legacy arena) and spawn points. */
  buildWorld(physics: PhysicsWorld, seed: number): { world: WorldData | null; playerSpawns: THREE.Vector3[]; enemySpawns: THREE.Vector3[] };
  /** Creates the mode director once the context exists. */
  createDirector?(ctx: SimContext): Director;
}

/** Deterministic PRNG (mulberry32). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Records every emitted event (deep-copied: payloads may hold live vectors) for snapshots. */
class RecordingBus extends EventBus {
  log: SimEvent[] = [];
  override emit<K extends keyof import('../core/events').GameEvents>(type: K, payload: import('../core/events').GameEvents[K]): void {
    this.log.push({ type, payload: structuredClone(payload) } as SimEvent);
    super.emit(type, payload);
  }
}

const HISTORY = 16; // steps of player positions kept for lag compensation (> lagCompMaxMs at 60 Hz)
const DEFAULT_MODE: ModeState = {
  coop: { phase: 'idle', missionIndex: 0, missionId: '', title: '', countdown: 0, timeLeft: null, groupsLeft: 0, groupsTotal: 0, participants: [], results: null },
  pvp: {
    phase: 'idle', squareId: null, arenaIndex: 0, arenaId: '', arenaName: '', countdown: 0, round: 0, roundTime: 0, roundCountdown: 0,
    score: { red: 0, blue: 0 }, teams: { red: [], blue: [] }, blocked: null, killFeed: [], results: null,
  },
  downed: [],
};

interface PlayerSlot { state: PlayerState; combat: PlayerCombat; controller: PlayerController; ackSeq: number; history: THREE.Vector3[] }

/**
 * The whole game simulation, renderer-free: runs on the host server (Node) and in the browser for solo (`LocalHost`).
 * Fixed 60 Hz steps; inputs only through `setInput`. Owner: integration.
 */
export class Sim {
  readonly ctx: SimContext;
  readonly events = new RecordingBus();
  readonly seed: number;
  private readonly physics: PhysicsWorld;
  readonly ai: EnemyAI;
  private readonly combat: CombatSystem;
  private readonly director: Director | null;
  private readonly slots = new Map<PlayerId, PlayerSlot>();
  private readonly mods = new WeakMap<Actor, SpawnModifiers>();
  private readonly looks = new Map<number, string>();
  private readonly playerSpawns: THREE.Vector3[];
  private added: ActorInfo[] = [];
  private removed: number[] = [];
  private stepCount = 0;
  private readonly rng: () => number;

  static async create(opts: SimOptions): Promise<Sim> {
    return new Sim(await PhysicsWorld.create(), opts);
  }

  private constructor(physics: PhysicsWorld, readonly opts: SimOptions) {
    this.physics = physics;
    this.seed = opts.seed;
    this.rng = seededRng(opts.seed ^ 0x9e3779b9);
    const built = opts.buildWorld(physics, opts.seed);
    this.playerSpawns = built.playerSpawns;
    const players = new Map<PlayerId, PlayerState>();
    const actors: Actor[] = [];
    this.ctx = {
      physics,
      events: this.events,
      world: built.world,
      combat: null as unknown as CombatSystem, // assigned below; systems need ctx first
      time: 0,
      rng: this.rng,
      actors,
      players,
      playerOf: (a) => {
        for (const p of players.values()) if (p.actor === a) return p;
        return undefined;
      },
      spawnEnemy: (kind, feet, mods) => this.spawnEnemy(kind, feet, mods),
      removeActor: (a) => this.removeActor(a),
      enemies: () => actors.filter((a) => a.team === 'enemy' && a.alive && !a.removed),
      hostiles: (me) => actors.filter((a) => a.team !== me.team && a.alive && !a.removed),
      rewound: (target, attacker) => this.rewound(target, attacker),
      spawns: { player: built.playerSpawns[0], enemies: built.enemySpawns },
      modifiers: (a) => this.mods.get(a) ?? { hpMul: 1, dmgMul: 1 },
    };
    this.combat = this.ctx.combat = new CombatSystem(this.ctx);
    this.ai = new EnemyAI(this.ctx, this.rng);
    this.director = opts.createDirector?.(this.ctx) ?? null;
  }

  get tick(): number { return this.stepCount; }

  // ------------------------------------------------------------------ players

  addPlayer(name: string, character: CharacterId): PlayerState {
    if (this.slots.size >= MAX_PLAYERS) throw new Error('server full');
    let id = 1;
    while (this.slots.has(id)) id++;
    const feet = this.playerSpawns[(id - 1) % this.playerSpawns.length].clone();
    const actor = this.createActor('player', feet, { hpMul: 1, dmgMul: 1 }, name);
    this.looks.set(actor.id, character);
    const state: PlayerState = {
      id, name, character, actor, input: emptyInput(), pressed: new Set(), lockTarget: null, qte: null, qteInputs: [],
      charge: null, rtt: 0, connected: true,
    };
    const slot: PlayerSlot = {
      state, combat: new PlayerCombat(this.ctx, state), controller: new PlayerController(this.ctx, state), ackSeq: 0,
      history: Array.from({ length: HISTORY }, () => feet.clone()),
    };
    slot.controller.reset(feet);
    this.slots.set(id, slot);
    this.ctx.players.set(id, state);
    this.ctx.actors.push(actor);
    this.added.push(this.info(actor));
    this.director?.onPlayerJoin(state);
    return state;
  }

  removePlayer(id: PlayerId): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.combat.reset();
    this.director?.onPlayerLeave(slot.state);
    this.slots.delete(id);
    this.ctx.players.delete(id);
    this.removeActor(slot.state.actor);
  }

  setConnected(id: PlayerId, connected: boolean): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.state.connected = connected;
    if (!connected) slot.state.input = { ...emptyInput(slot.state.input.seq), camYaw: slot.state.input.camYaw };
  }

  /** Changes a player's character (new look for everyone: the actor is re-announced). */
  setCharacter(id: PlayerId, character: CharacterId): void {
    const slot = this.slots.get(id);
    if (!slot || slot.state.character === character) return;
    slot.state.character = character;
    slot.combat.reset();
    this.looks.set(slot.state.actor.id, character);
    this.added.push(this.info(slot.state.actor));
  }

  setRtt(id: PlayerId, ms: number): void {
    const slot = this.slots.get(id);
    if (slot) slot.state.rtt = ms;
  }

  /** Input used by the next step. Pressed bits of inputs not yet stepped are merged (never lost). */
  setInput(id: PlayerId, input: PlayerInput): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    const prev = slot.state.input;
    const pending = slot.ackSeq < prev.seq ? prev.pressed : 0;
    slot.state.input = { ...input, pressed: input.pressed | pending, qte: input.qte ?? (slot.ackSeq < prev.seq ? prev.qte : null) };
  }

  ackSeq(id: PlayerId): number { return this.slots.get(id)?.ackSeq ?? 0; }

  player(id: PlayerId): PlayerState | undefined { return this.slots.get(id)?.state; }

  // ------------------------------------------------------------------ step

  /** One fixed simulation step (SIM_DT). */
  step(): void {
    const ctx = this.ctx, dt = SIM_DT;
    this.stepCount++;
    ctx.time += dt;
    for (const a of ctx.actors) {
      a.beginStep();
      a.animTime += dt;
    }
    for (const slot of this.slots.values()) this.applyInput(slot);
    for (const slot of this.slots.values()) {
      if (this.director?.frozen?.(slot.state.actor.id)) continue;
      slot.combat.update(dt);
    }
    for (const slot of this.slots.values()) slot.controller.update(dt);
    this.ai.update(dt);
    for (const a of ctx.actors) {
      a.onWater = a.alive && a.grounded && this.physics.isWater(a.position);
      a.disoriented = Math.max(0, a.disoriented - dt);
    }
    this.combat.update(dt);
    this.director?.update(dt);
    for (const a of [...ctx.actors]) {
      if (a.team !== 'enemy') continue;
      if (!a.alive) {
        a.deadTime += dt;
        if (a.deadTime > ENEMIES.corpseTime) this.removeActor(a);
      } else if (a.position.y < MOVEMENT.killPlaneY) {
        const s = ctx.spawns.enemies[a.id % ctx.spawns.enemies.length];
        this.physics.teleport(a.body, s);
        a.position.copy(s);
        a.prevPosition.copy(s);
        a.velocity.set(0, 0, 0);
      }
    }
    for (const slot of this.slots.values()) {
      slot.history[this.stepCount % HISTORY].copy(slot.state.actor.position);
      slot.ackSeq = slot.state.input.seq;
    }
    this.physics.step();
  }

  private applyInput(slot: PlayerSlot): void {
    const p = slot.state, i = p.input;
    // A repeated input (no fresh packet this step) holds keys but never presses again.
    const fresh = i.seq !== slot.ackSeq;
    const pressed = new Set<InputAction>();
    if (fresh) for (const a of INPUT_ACTIONS) if (hasBit(i.pressed, a)) pressed.add(a);
    p.pressed = pressed;
    if (fresh && i.qte) p.qteInputs.push(i.qte);
    const want = i.lockId ? this.ctx.actors.find((a) => a.id === i.lockId) ?? null : null;
    p.lockTarget = want && want.alive && !want.removed && want.team !== p.actor.team && p.actor.disoriented <= 0 ? want : null;
  }

  private rewound(target: Actor, attacker: Actor): THREE.Vector3 {
    if (target.kind !== 'player' || attacker.kind !== 'player') return target.position;
    const from = this.ctx.playerOf(attacker), to = this.ctx.playerOf(target);
    if (!from || !to) return target.position;
    const back = Math.min(Math.round(Math.min(from.rtt / 2, NET.lagCompMaxMs) / (SIM_DT * 1000)), HISTORY - 1);
    if (back <= 0) return target.position;
    return this.slots.get(to.id)!.history[(this.stepCount - back + HISTORY * 4) % HISTORY];
  }

  // ------------------------------------------------------------------ actors

  private createActor(kind: ActorKind, feet: THREE.Vector3, mods: SpawnModifiers, name?: string): Actor {
    const stats = kind === 'player'
      ? { maxHp: COMBAT.player.maxHp, maxChakra: COMBAT.player.maxChakra }
      : { maxHp: Math.round(ENEMIES[kind].maxHp * mods.hpMul), maxChakra: 0 };
    const fighter = new Fighter(stats, COMBAT.guardDamageFactor);
    const body = this.physics.createCharacter(feet, MOVEMENT.capsuleRadius, MOVEMENT.capsuleHalfHeight);
    const height = 2 * (MOVEMENT.capsuleHalfHeight + MOVEMENT.capsuleRadius);
    const label = name ?? NAMES[kind as Exclude<ActorKind, 'player'>][Math.floor(this.rng() * 3) % 3];
    const a = new Actor(kind, kind === 'player' ? 'player' : 'enemy', label, fighter, body, MOVEMENT.capsuleRadius, height);
    a.position.copy(feet);
    a.prevPosition.copy(feet);
    this.mods.set(a, mods);
    return a;
  }

  private spawnEnemy(kind: Exclude<ActorKind, 'player'>, feet: THREE.Vector3, mods: SpawnModifiers): Actor {
    const a = this.createActor(kind, feet, mods);
    this.looks.set(a.id, `${kind}:${Math.floor(this.rng() * 3)}`);
    this.ctx.actors.push(a);
    this.ai.register(a);
    this.added.push(this.info(a));
    return a;
  }

  private removeActor(a: Actor): void {
    if (a.removed) return;
    a.removed = true;
    this.ai.unregister(a);
    this.physics.removeCharacter(a.body);
    const i = this.ctx.actors.indexOf(a);
    if (i >= 0) this.ctx.actors.splice(i, 1);
    this.looks.delete(a.id);
    this.removed.push(a.id);
    for (const p of this.ctx.players.values()) if (p.lockTarget === a) p.lockTarget = null;
  }

  private info(a: Actor): ActorInfo {
    const p = this.ctx.playerOf(a);
    return { id: a.id, kind: a.kind, name: a.name, look: this.looks.get(a.id) ?? a.kind, ...(p ? { playerId: p.id } : {}) };
  }

  /** Removes every enemy, projectile and grab; players back to full health at the spawns (solo restart). */
  reset(): void {
    for (const a of [...this.ctx.actors]) if (a.kind !== 'player') this.removeActor(a);
    this.ai.clear();
    this.combat.clear();
    this.director?.reset();
    for (const slot of this.slots.values()) {
      const a = slot.state.actor;
      a.fighter.reset();
      a.knockback.set(0, 0, 0);
      a.velocity.set(0, 0, 0);
      a.climbing = false;
      a.deadTime = 0;
      a.downed = 0;
      a.yaw = 0;
      a.team = 'player';
      a.setAnim('idle', true);
      a.resetControl();
      a.onWater = false;
      a.disoriented = 0;
      a.grabbedBy = null;
      slot.combat.reset();
      slot.controller.reset(this.playerSpawns[(slot.state.id - 1) % this.playerSpawns.length]);
      a.beginStep();
    }
  }

  // ------------------------------------------------------------------ output

  takeEvents(): SimEvent[] {
    const e = this.events.log;
    this.events.log = [];
    return e;
  }

  takeActorChanges(): { add: ActorInfo[]; remove: number[] } {
    const r = { add: this.added, remove: this.removed };
    this.added = [];
    this.removed = [];
    return r;
  }

  actorInfos(): ActorInfo[] {
    return this.ctx.actors.map((a) => this.info(a));
  }

  snapshot(forPlayer: PlayerId | null, events: SimEvent[]): Snapshot {
    const slot = forPlayer !== null ? this.slots.get(forPlayer) : undefined;
    const players = [...this.slots.values()].map(({ state: p }) => ({
      id: p.id, name: p.name, character: p.character, actorId: p.actor.id, team: p.actor.team, ping: Math.round(p.rtt), connected: p.connected,
    }));
    let you: Snapshot['you'] = null;
    if (slot) {
      const p = slot.state, f = p.actor.fighter;
      you = {
        playerId: p.id, actorId: p.actor.id, ackSeq: slot.ackSeq,
        cooldowns: { special: f.cooldownRemaining('special'), kunai: f.cooldownRemaining('kunai'), dodge: f.cooldownRemaining('dodge'), dash: f.cooldownRemaining('dash') },
        substitution: f.substitution, maxSubstitution: f.maxSubstitution,
        charge: p.charge, qte: p.qte ? { ...p.qte, arrows: [...p.qte.arrows] } : null,
        lockId: p.lockTarget?.id ?? 0, disoriented: p.actor.disoriented,
      };
    }
    return {
      tick: this.stepCount, time: this.ctx.time,
      actors: this.ctx.actors.map(actorState),
      projectiles: this.combat.projectileStates(),
      events, players,
      markers: this.director && forPlayer !== null ? this.director.markers(forPlayer) : [],
      mode: this.director?.state() ?? DEFAULT_MODE,
      you,
    };
  }

  dispose(): void {
    this.physics.dispose();
  }
}

export function actorState(a: Actor): ActorState {
  const F = ACTOR_FLAGS, f = a.fighter, c = a.control;
  const flags = (a.grounded ? F.grounded : 0) | (a.climbing ? F.climbing : 0) | (a.onWater ? F.onWater : 0)
    | (a.vis.guard ? F.guard : 0) | (a.vis.aura ? F.aura : 0) | (a.vis.sharingan ? F.sharingan : 0)
    | (a.vis.telegraph ? F.telegraph : 0) | (a.disoriented > 0 && a.alive ? F.dazed : 0) | (a.downed > 0 ? F.downed : 0)
    | (a.grabbedBy !== null ? F.grabbed : 0) | (f.concentrating ? F.concentrating : 0) | (f.invulnerable ? F.invulnerable : 0)
    | (!c.allowMove || c.forcedVelocity ? F.busy : 0);
  return {
    id: a.id, team: a.team,
    x: a.position.x, y: a.position.y, z: a.position.z,
    vx: a.velocity.x, vy: a.velocity.y, vz: a.velocity.z,
    yaw: a.yaw, anim: a.anim, animTime: a.animTime,
    hp: f.hp, maxHp: f.maxHp, chakra: f.chakra, maxChakra: f.maxChakra,
    flags, orb: a.vis.orb, orbLevel: a.vis.orbLevel,
    wallNx: a.wallNormal.x, wallNz: a.wallNormal.z,
  };
}
