import type * as THREE from 'three';
import type { EventBus } from '../core/events';
import type { InputManager, Action } from '../core/input';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Actor } from './Actor';
import type { CameraRig } from '../camera/CameraRig';
import type { CombatSystem } from '../combat/CombatSystem';
import type { Effects } from '../render/Effects';
import type { ActorKind, CharacterId, QteDir, QteState } from '../core/types';
import type { Settings } from '../config/settings';

/** Stat multipliers applied when spawning an enemy for a given wave. */
export interface SpawnModifiers { hpMul: number; dmgMul: number }

/**
 * Everything a gameplay system may touch. Built once by Game and passed to each system.
 * Owner: integration.
 */
export interface GameContext {
  readonly scene: THREE.Scene;
  readonly physics: PhysicsWorld;
  readonly events: EventBus;
  readonly input: InputManager;
  readonly camera: CameraRig;
  combat: CombatSystem;
  readonly fx: Effects;
  readonly settings: Settings;
  /** Actions pressed since the previous simulation step. */
  pressed: ReadonlySet<Action>;
  /** Simulation time in seconds (frozen while paused). */
  time: number;
  readonly actors: Actor[];
  player: Actor;
  /** Creates an enemy actor (model + physics body) and adds it to `actors`. */
  spawnEnemy(kind: Exclude<ActorKind, 'player'>, feet: THREE.Vector3, mods: SpawnModifiers): Actor;
  /** Removes an actor from the world and frees its resources. */
  removeActor(actor: Actor): void;
  /** Living enemies. */
  enemies(): Actor[];
  /** Spawn points provided by the arena. */
  readonly spawns: { player: THREE.Vector3; enemies: THREE.Vector3[] };
  /** Damage/speed multiplier for an enemy (from its wave). */
  modifiers(actor: Actor): SpawnModifiers;
  /** Selected playable character (fixed during a run). */
  character: CharacterId;
  /** Grab sequence state, owned by combat (null when none). Game/UI read it. */
  qte: QteState | null;
  /** Arrow clicks from the UI, queued by Game and consumed by combat on the next simulation step. */
  qteInputs: QteDir[];
}
