/** Pure PvP match flow (no SimContext): team validation, countdown, best-of-N rounds, results. Owner: missions agent. */
import type { PlayerId } from '../protocol';
import type { ModePhase, PvpTeam } from './types';
import { PVP } from '../../config/pvp';

export type PvpRules = Pick<typeof PVP, 'countdown' | 'maxTeam' | 'roundsToWin' | 'roundTime' | 'roundCountdown' | 'roundEndPause' | 'resultsTime'>;
export interface Teams { red: PlayerId[]; blue: PlayerId[] }
/** Where a connected player stands: PvP square id and half, or null outside every PvP square. */
export type Spot = { square: string; team: PvpTeam } | null;

export interface TeamCheck {
  /** Square most connected players stand in (null when none). */
  squareId: string | null;
  teams: Teams;
  /** French reason the countdown cannot run, null when valid. */
  blocked: string | null;
}

/** Validates the lobby: every connected player in the same PvP square, both teams ≥ 1, each ≤ maxTeam. */
export function checkTeams(connected: readonly PlayerId[], spots: ReadonlyMap<PlayerId, Spot>, maxTeam: number = PVP.maxTeam): TeamCheck {
  const count = new Map<string, number>();
  for (const id of connected) {
    const s = spots.get(id);
    if (s) count.set(s.square, (count.get(s.square) ?? 0) + 1);
  }
  let squareId: string | null = null;
  for (const [sq, n] of count) if (squareId === null || n > count.get(squareId)!) squareId = sq;
  const teams: Teams = { red: [], blue: [] };
  if (squareId === null) return { squareId, teams, blocked: null };
  for (const id of connected) {
    const s = spots.get(id);
    if (s?.square === squareId) teams[s.team].push(id);
  }
  const inside = teams.red.length + teams.blue.length;
  const blocked = inside < connected.length ? `En attente de tous les joueurs (${inside}/${connected.length})`
    : teams.red.length === 0 || teams.blue.length === 0 ? 'Il faut au moins un joueur dans chaque équipe'
      : teams.red.length > maxTeam || teams.blue.length > maxTeam ? `${maxTeam} joueurs maximum par équipe`
        : null;
  return { squareId, teams, blocked };
}

/** Timer slack: repeated `-= 1/60` leaves float dust. */
const EPS = 1e-6;

const sameTeams = (a: Teams, b: Teams): boolean =>
  a.red.join() === b.red.join() && a.blue.join() === b.blue.join();

export type PvpEvent =
  /** Reset HP, teleport to spawns: a pre-round countdown begins (players frozen). */
  | { type: 'roundPrep'; round: number }
  | { type: 'roundStart'; round: number }
  /** `winner` null = draw (nobody scores). */
  | { type: 'roundEnd'; round: number; winner: PvpTeam | null }
  | { type: 'matchEnd'; winner: PvpTeam };

export class PvpFlow {
  phase: ModePhase = 'idle';
  /** Seconds left in the start countdown / results screen. */
  countdown = 0;
  round = 0;
  roundTime = 0;
  roundCountdown = 0;
  /** Pause after a round before the next pre-round countdown. */
  pause = 0;
  score = { red: 0, blue: 0 };
  teams: Teams = { red: [], blue: [] };
  squareId: string | null = null;
  blocked: string | null = null;
  winner: PvpTeam | null = null;

  constructor(readonly rules: PvpRules = PVP) {}

  /** Players can't move during the pre-round countdown. */
  get frozen(): boolean {
    return this.phase === 'running' && this.roundCountdown > 0;
  }

  /** Idle/countdown step. Teams changing (side switch) restart the countdown. Returns true when the match starts. */
  lobby(dt: number, check: TeamCheck): boolean {
    if (this.phase !== 'idle' && this.phase !== 'countdown') return false;
    this.squareId = check.squareId;
    this.blocked = check.blocked;
    if (check.squareId === null || check.blocked !== null) {
      this.phase = 'idle';
      this.countdown = 0;
      this.teams = check.teams;
      return false;
    }
    if (this.phase === 'idle' || !sameTeams(this.teams, check.teams)) {
      this.phase = 'countdown';
      this.countdown = this.rules.countdown;
      this.teams = { red: [...check.teams.red], blue: [...check.teams.blue] };
      return false;
    }
    this.countdown -= dt;
    if (this.countdown > EPS) return false;
    this.phase = 'running';
    this.countdown = 0;
    this.score = { red: 0, blue: 0 };
    this.winner = null;
    this.round = 1;
    this.roundCountdown = this.rules.roundCountdown;
    this.roundTime = 0;
    this.pause = 0;
    return true;
  }

  restartCountdown(): void {
    if (this.phase === 'countdown') this.countdown = this.rules.countdown;
  }

  /**
   * Running step. `standing` = living players per team, `hpPct` = team HP / team max HP (0..1).
   * Returns the event of this step, if any.
   */
  run(dt: number, standing: { red: number; blue: number }, hpPct: { red: number; blue: number }): PvpEvent | null {
    if (this.phase !== 'running') return null;
    if (this.roundCountdown > 0) {
      this.roundCountdown -= dt;
      if (this.roundCountdown > EPS) return null;
      this.roundCountdown = 0;
      this.roundTime = this.rules.roundTime;
      return { type: 'roundStart', round: this.round };
    }
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause > EPS) return null;
      this.pause = 0;
      this.round++;
      this.roundCountdown = this.rules.roundCountdown;
      return { type: 'roundPrep', round: this.round };
    }
    this.roundTime = Math.max(0, this.roundTime - dt);
    let over = false;
    let winner: PvpTeam | null = null;
    if (standing.red === 0 || standing.blue === 0) {
      over = true;
      winner = standing.red > 0 ? 'red' : standing.blue > 0 ? 'blue' : null;
    } else if (this.roundTime <= EPS) {
      over = true;
      winner = hpPct.red > hpPct.blue ? 'red' : hpPct.blue > hpPct.red ? 'blue' : null;
    }
    if (!over) return null;
    this.roundTime = 0;
    if (winner) this.score[winner]++;
    if (winner && this.score[winner] >= this.rules.roundsToWin) {
      this.endMatch(winner);
      return { type: 'matchEnd', winner };
    }
    this.pause = this.rules.roundEndPause;
    return { type: 'roundEnd', round: this.round, winner };
  }

  /** A player left. Returns the winner when this empties a team during a match (the match is then over). */
  removePlayer(id: PlayerId): PvpTeam | null {
    this.teams = { red: this.teams.red.filter((p) => p !== id), blue: this.teams.blue.filter((p) => p !== id) };
    if (this.phase !== 'running') return null;
    const empty: PvpTeam | null = this.teams.red.length === 0 ? 'red' : this.teams.blue.length === 0 ? 'blue' : null;
    if (!empty) return null;
    const winner: PvpTeam = empty === 'red' ? 'blue' : 'red';
    this.endMatch(winner);
    return winner;
  }

  private endMatch(winner: PvpTeam): void {
    this.phase = 'results';
    this.winner = winner;
    this.countdown = this.rules.resultsTime;
    this.roundTime = this.roundCountdown = this.pause = 0;
  }

  /** Results step. Returns true when over (back to idle). */
  results(dt: number): boolean {
    if (this.phase !== 'results') return false;
    this.countdown -= dt;
    if (this.countdown > EPS) return false;
    this.reset();
    return true;
  }

  reset(): void {
    this.phase = 'idle';
    this.countdown = this.round = this.roundTime = this.roundCountdown = this.pause = 0;
    this.score = { red: 0, blue: 0 };
    this.teams = { red: [], blue: [] };
    this.squareId = this.blocked = this.winner = null;
  }
}

/** Extra max-HP fraction for each member of `team` (smaller team only). */
export function handicap(teams: Teams, team: PvpTeam, perMissing: number = PVP.handicapPerMissingPlayer): number {
  const other: PvpTeam = team === 'red' ? 'blue' : 'red';
  return Math.max(0, teams[other].length - teams[team].length) * perMissing;
}
