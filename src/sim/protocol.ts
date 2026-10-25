/**
 * Shared client/server contract: player input, snapshots and messages. Node-safe (no DOM).
 * Owner: integration. The binary/JSON encoding of these types lives in `src/net/codec.ts` (net agent).
 */
import type { ActorKind, AnimState, CharacterId, QteDir, QteState, Team, Vec3Like, ChargeTechnique } from '../core/types';
import type { GameEvents } from '../core/events';
import type { ModeState, Marker } from './missions/types';

export const PROTOCOL_VERSION = 1;
/** Small integer id of a connected player (1..255). Not the actor id. */
export type PlayerId = number;
/** Most players allowed on the server at once. */
export const MAX_PLAYERS = 6;

/** Actions a player can send, in bit order (bit i = 1 << i). Never reorder: the wire format depends on it. */
export const INPUT_ACTIONS = [
  'forward', 'back', 'left', 'right', 'sprint', 'jump', 'attack', 'guard', 'special', 'kunai',
  'concentrate', 'dodge', 'lockOn', 'switchTarget', 'boost', 'grab', 'interact',
] as const;
export type InputAction = (typeof INPUT_ACTIONS)[number];
export const actionBit = (a: InputAction): number => 1 << INPUT_ACTIONS.indexOf(a);
export const hasBit = (mask: number, a: InputAction): boolean => (mask & actionBit(a)) !== 0;

/** One simulation step of one player's input. Every gameplay system reads input only through this. */
export interface PlayerInput {
  /** Increments by 1 every client step (uint32). The server acks the last applied seq. */
  seq: number;
  /** Move axes in -1..1: x = screen right, z = screen forward (camera-relative). */
  moveX: number;
  moveZ: number;
  /** Camera angles (radians), yaw 0 looks toward +Z. Movement and homing are relative to camYaw. */
  camYaw: number;
  camPitch: number;
  /** Bitmasks over INPUT_ACTIONS: keys held now / pressed since the previous step. */
  held: number;
  pressed: number;
  /** Camera forward (unit) for the kunai aim assist and the reticle direction; omitted = camYaw/camPitch. */
  aimDir?: Vec3Like;
  /** Lock-on target chosen by the client (actor id), 0 = none. The server validates it. */
  lockId: number;
  /** Grab sequence arrow answered this step, or null. */
  qte: QteDir | null;
}

export const emptyInput = (seq = 0): PlayerInput => ({ seq, moveX: 0, moveZ: 0, camYaw: 0, camPitch: 0, held: 0, pressed: 0, lockId: 0, qte: null });

/** Static info about an actor, sent once when it appears (and on join). */
export interface ActorInfo {
  id: number;
  kind: ActorKind;
  name: string;
  /** Character id for players, enemy look key (see render/looks) for enemies. */
  look: string;
  /** Owning player, players only. */
  playerId?: PlayerId;
}

/** Bit flags of ActorState.flags. */
export const ACTOR_FLAGS = {
  grounded: 1, climbing: 2, onWater: 4, guard: 8, aura: 16, sharingan: 32, telegraph: 64, dazed: 128,
  downed: 256, grabbed: 512, concentrating: 1024, invulnerable: 2048,
  /** Combat owns the actor's movement this step (attack, dash, dodge…): clients don't predict it. */
  busy: 4096,
} as const;
export type ActorFlag = keyof typeof ACTOR_FLAGS;

/** Hand orb style in ActorState.orb. */
export const ORB_NONE = 0, ORB_RASENGAN = 1, ORB_CHIDORI = 2;

/** Dynamic state of one actor in a snapshot. */
export interface ActorState {
  id: number;
  team: Team;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
  anim: AnimState;
  animTime: number;
  hp: number; maxHp: number;
  chakra: number; maxChakra: number;
  flags: number;
  orb: number;
  /** Orb size / charge 0..1. */
  orbLevel: number;
  /** Horizontal wall normal while climbing. */
  wallNx: number; wallNz: number;
}

export interface ProjectileState {
  id: number;
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
  visual: 'kunai' | 'shuriken' | 'chakra';
}

/** A gameplay event replayed on every client (FX, sounds, HUD). */
export type SimEvent = { [K in keyof GameEvents]: { type: K; payload: GameEvents[K] } }[keyof GameEvents];

export interface PlayerSummary {
  id: PlayerId;
  name: string;
  character: CharacterId;
  actorId: number;
  team: Team;
  /** Round-trip time in ms measured by the server (0 solo). */
  ping: number;
  /** False while the player is disconnected but its slot is kept for a reconnect. */
  connected: boolean;
}

/** Private state of the snapshot's recipient (HUD + prediction). */
export interface YouState {
  playerId: PlayerId;
  actorId: number;
  /** Last PlayerInput.seq applied by the server. */
  ackSeq: number;
  cooldowns: { special: number; kunai: number; dodge: number; dash: number };
  substitution: number;
  maxSubstitution: number;
  charge: { technique: ChargeTechnique; level: number } | null;
  qte: QteState | null;
  /** Server-validated lock-on target, 0 = none. */
  lockId: number;
  /** Seconds of disorientation left (PvP genjutsu: no lock-on, rotated movement). */
  disoriented: number;
}

export interface Snapshot {
  /** Server step counter and simulation time (s). */
  tick: number;
  time: number;
  actors: ActorState[];
  projectiles: ProjectileState[];
  /** Events since the previous snapshot, in order. */
  events: SimEvent[];
  players: PlayerSummary[];
  markers: Marker[];
  mode: ModeState;
  you: YouState | null;
}

/** Client → server control messages (JSON text frames). Inputs travel as binary frames (codec). */
export type ClientMsg =
  | { t: 'hello'; version: number; name: string; character: CharacterId }
  | { t: 'character'; character: CharacterId }
  | { t: 'kick'; playerId: PlayerId }
  | { t: 'ping'; time: number };

/** Server → client messages. Snapshots travel as binary frames (codec), the rest as JSON text frames. */
export type ServerMsg =
  | { t: 'welcome'; playerId: PlayerId; actorId: number; seed: number; isHost: boolean; actors: ActorInfo[] }
  | { t: 'full' }
  | { t: 'version'; server: number }
  | { t: 'kicked' }
  | { t: 'actors'; add: ActorInfo[]; remove: number[] }
  | { t: 'snapshot'; snap: Snapshot }
  | { t: 'pong'; time: number };
