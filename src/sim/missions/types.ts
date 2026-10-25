/**
 * Co-op missions and PvP matches: state shared with every client (snapshot `mode` and `markers`).
 * Owner: integration (contract); the missions agent implements the directors in `src/sim/missions/`.
 */
import type { PlayerId } from '../protocol';

export type ModePhase = 'idle' | 'countdown' | 'running' | 'results';
export type PvpTeam = 'red' | 'blue';

export interface CoopResults {
  victory: boolean;
  time: number;
  players: { id: PlayerId; name: string; kills: number; revives: number }[];
}

export interface CoopState {
  phase: ModePhase;
  /** Mission chosen on the board (index in MISSIONS) and its id / French title. */
  missionIndex: number;
  missionId: string;
  title: string;
  /** Seconds left in the start countdown (phase 'countdown'), in the results screen (phase 'results'). */
  countdown: number;
  /** Seconds left before failure, null without a time limit. */
  timeLeft: number | null;
  groupsLeft: number;
  groupsTotal: number;
  /** Players taking part (others wait in the village). */
  participants: PlayerId[];
  results: CoopResults | null;
}

export interface PvpResults {
  winner: PvpTeam;
  rounds: { red: number; blue: number };
  players: { id: PlayerId; name: string; team: PvpTeam; damage: number; kos: number }[];
}

export interface PvpState {
  phase: ModePhase;
  /** Square in use (or the one all players gather on), null when nobody is in a PvP square. */
  squareId: string | null;
  /** Battleground chosen on the board. */
  arenaIndex: number;
  arenaId: string;
  arenaName: string;
  countdown: number;
  /** 1-based round number, 0 before the first round. */
  round: number;
  /** Seconds left in the round (0 between rounds). */
  roundTime: number;
  /** 3 s countdown before each round (players frozen), 0 otherwise. */
  roundCountdown: number;
  score: { red: number; blue: number };
  teams: { red: PlayerId[]; blue: PlayerId[] };
  /** Why the countdown cannot start yet (French), e.g. "Il faut au moins un joueur dans chaque équipe". */
  blocked: string | null;
  killFeed: { killer: string; victim: string; time: number }[];
  results: PvpResults | null;
}

export interface ModeState {
  coop: CoopState;
  pvp: PvpState;
  /** Downed teammates (co-op): actor id → seconds of bleed-out left, revive progress 0..1. */
  downed: { actorId: number; bleed: number; revive: number }[];
}

/** Minimap marker (server-computed so every client sees the same). */
export type Marker =
  | { kind: 'group'; id: number; x: number; z: number; count: number; fighting: boolean }
  | { kind: 'square'; id: string; x: number; z: number; yaw: number; size: number; mode: 'coop' | 'pvp' }
  | { kind: 'objective'; id: number; x: number; z: number; label: string }
  | { kind: 'downed'; id: number; x: number; z: number }
  /** Players: teammates always; PvP opponents only near (pvpRevealRadius) or in line of sight of the recipient. */
  | { kind: 'player'; id: number; x: number; z: number; yaw: number; team: string; name: string };
