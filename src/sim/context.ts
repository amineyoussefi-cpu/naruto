import type * as THREE from 'three';
import type { EventBus } from '../core/events';
import type { PhysicsWorld } from './physics/PhysicsWorld';
import type { Actor } from './Actor';
import type { CombatSystem } from './combat/CombatSystem';
import type { ActorKind, CharacterId, QteDir, QteState } from '../core/types';
import type { InputAction, PlayerId, PlayerInput } from './protocol';
import type { WorldData } from './world/types';

/** Stat multipliers applied when spawning an enemy (mission scaling). */
export interface SpawnModifiers { hpMul: number; dmgMul: number }

/** One connected (or reconnect-pending) player: its actor and every per-player gameplay state. */
export interface PlayerState {
  readonly id: PlayerId;
  name: string;
  character: CharacterId;
  actor: Actor;
  /** Input applied this step, and its `pressed` bits as a set. */
  input: PlayerInput;
  pressed: ReadonlySet<InputAction>;
  /** Validated lock-on target (from input.lockId). */
  lockTarget: Actor | null;
  /** Grab sequence of this player (null when none). Combat owns it. */
  qte: QteState | null;
  /** Arrow answers queued for combat this step (from input.qte). */
  qteInputs: QteDir[];
  /** Hold-to-charge progress, for the HUD (combat writes it). */
  charge: { technique: 'rasengan' | 'chidori'; level: number } | null;
  /** Measured round-trip time (ms), used for lag compensation. 0 solo. */
  rtt: number;
  connected: boolean;
}

/**
 * Everything a gameplay system may touch. Pure simulation: no renderer, DOM or camera.
 * Built once by `Sim` and passed to each system. Owner: integration.
 */
export interface SimContext {
  readonly physics: PhysicsWorld;
  readonly events: EventBus;
  readonly world: WorldData | null;
  combat: CombatSystem;
  /** Simulation time in seconds. */
  time: number;
  /** Seedable random source in [0, 1) for gameplay decisions. */
  rng(): number;
  readonly actors: Actor[];
  readonly players: Map<PlayerId, PlayerState>;
  /** Owning player of an actor (players only). */
  playerOf(actor: Actor): PlayerState | undefined;
  /** Creates an enemy actor (physics body) and adds it to `actors`. */
  spawnEnemy(kind: Exclude<ActorKind, 'player'>, feet: THREE.Vector3, mods: SpawnModifiers): Actor;
  /** Removes an actor from the world and frees its body. */
  removeActor(actor: Actor): void;
  /** Living AI enemies. */
  enemies(): Actor[];
  /** Living actors hostile to `actor` (other team: enemies in co-op, the other team's players in PvP). */
  hostiles(actor: Actor): Actor[];
  /**
   * Lag compensation: where `target` was when `attacker` saw it (player vs player only: rewound by the attacker's
   * latency, capped by `NET.lagCompensationMaxMs`); otherwise `target.position`.
   */
  rewound(target: Actor, attacker: Actor): THREE.Vector3;
  /** Spawn points. */
  readonly spawns: { player: THREE.Vector3; enemies: THREE.Vector3[] };
  /** Damage/hp multiplier for an enemy. */
  modifiers(actor: Actor): SpawnModifiers;
}
