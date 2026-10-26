/** Pure co-op mission flow (no SimContext): idle → countdown → running → results → idle, plus down & revive timing. Owner: missions agent. */
import type { PlayerId } from '../protocol';
import type { ModePhase } from './types';
import { MISSION_RULES } from '../../config/missions';

/** Timer slack: repeated `-= 1/60` leaves float dust. */
const EPS = 1e-6;

export type CoopRules = Pick<typeof MISSION_RULES, 'countdown' | 'resultsTime' | 'bleedTime' | 'reviveTime'>;

/** True when there is at least one connected player and every one of them is inside. */
export function allInside(connected: readonly PlayerId[], inside: readonly PlayerId[]): boolean {
  return connected.length > 0 && connected.every((id) => inside.includes(id));
}

/** Enemies per group and HP multiplier for `players` participants. */
export function scaleGroup(base: number, players: number, scale: { count: number; hp: number }): { count: number; hpMul: number } {
  const extra = Math.max(0, players - 1);
  return { count: Math.max(1, Math.round(base * (1 + scale.count * extra))), hpMul: 1 + scale.hp * extra };
}

export class CoopFlow {
  phase: ModePhase = 'idle';
  /** Seconds left in the start countdown / the results screen. */
  countdown = 0;
  elapsed = 0;
  timeLimit: number | null = null;
  participants: PlayerId[] = [];
  victory = false;

  constructor(readonly rules: CoopRules = MISSION_RULES) {}

  get timeLeft(): number | null {
    return this.timeLimit === null ? null : Math.max(0, this.timeLimit - this.elapsed);
  }

  /** Idle/countdown step. Returns true on the step the mission starts (participants = connected). */
  lobby(dt: number, connected: readonly PlayerId[], inside: readonly PlayerId[], timeLimit: number | null): boolean {
    if (this.phase !== 'idle' && this.phase !== 'countdown') return false;
    if (!allInside(connected, inside)) {
      this.phase = 'idle';
      this.countdown = 0;
      return false;
    }
    if (this.phase === 'idle') {
      this.phase = 'countdown';
      this.countdown = this.rules.countdown;
      return false;
    }
    this.countdown -= dt;
    if (this.countdown > EPS) return false;
    this.phase = 'running';
    this.countdown = 0;
    this.elapsed = 0;
    this.timeLimit = timeLimit;
    this.participants = [...connected];
    this.victory = false;
    return true;
  }

  /** Mission changed on the board during the countdown: start it over. */
  restartCountdown(): void {
    if (this.phase === 'countdown') this.countdown = this.rules.countdown;
  }

  /** Running step: victory when every group is wiped, defeat when nobody stands or time runs out. */
  run(dt: number, groupsLeft: number, standing: number): 'victory' | 'defeat' | null {
    if (this.phase !== 'running') return null;
    this.elapsed += dt;
    const result = groupsLeft === 0 ? 'victory'
      : standing === 0 || this.participants.length === 0 || (this.timeLimit !== null && this.elapsed >= this.timeLimit - EPS) ? 'defeat'
        : null;
    if (result) this.finish(result === 'victory');
    return result;
  }

  finish(victory: boolean): void {
    this.phase = 'results';
    this.victory = victory;
    this.countdown = this.rules.resultsTime;
  }

  /** Results step. Returns true when the screen is over (back to idle). */
  results(dt: number): boolean {
    if (this.phase !== 'results') return false;
    this.countdown -= dt;
    if (this.countdown > EPS) return false;
    this.reset();
    return true;
  }

  /** A participant disconnected: no longer counted (the next `run` ends in defeat if nobody is left). */
  removePlayer(id: PlayerId): void {
    this.participants = this.participants.filter((p) => p !== id);
  }

  reset(): void {
    this.phase = 'idle';
    this.countdown = this.elapsed = 0;
    this.timeLimit = null;
    this.participants = [];
    this.victory = false;
  }
}

/** Downed player timers: `bleed` seconds left, `revive` progress 0..1. */
export interface DownedTimer { bleed: number; revive: number }

/**
 * One step of a downed player. `reviving` = a teammate holds interact in range this step
 * (releasing resets the progress; the bleed-out clock pauses while being revived).
 */
export function tickDowned(d: DownedTimer, dt: number, reviving: boolean, rules: CoopRules = MISSION_RULES): 'down' | 'revived' | 'bledOut' {
  if (reviving) {
    d.revive += dt / rules.reviveTime;
    if (d.revive >= 1 - EPS) return 'revived';
    return 'down';
  }
  d.revive = 0;
  d.bleed -= dt;
  return d.bleed <= EPS ? 'bledOut' : 'down';
}
