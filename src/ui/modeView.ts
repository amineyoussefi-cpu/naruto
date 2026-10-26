/**
 * Pure view logic of the co-op / PvP HUD (French texts, unit-tested). Owner: UI agent.
 * Input: the shared ModeState plus where the local player is; output: what each HUD element shows (null = hidden).
 */
import type { Marker, ModeState, PvpTeam } from '../sim/missions/types';
import type { SquareDef } from '../sim/world/types';
import { pvpHalf, squareAt } from '../sim/missions/squares';
import { MISSION_RULES } from '../config/missions';
import { formatTime } from './minimapMath';

export interface ModeViewInput {
  mode: ModeState;
  markers: readonly Marker[];
  squares: readonly SquareDef[];
  /** Local player feet (x, z), null when unknown. */
  pos: { x: number; z: number } | null;
  myActorId: number;
  myPlayerId: number;
  /** Label of the interact key ('F'). */
  interactKey: string;
}

export interface ModeView {
  /** Board text while standing in a start square (title line, hint line). */
  board: { title: string; hint: string; team: PvpTeam | null; blocked: string | null } | null;
  /** Big centre countdown ("Mission dans 5…", round countdown). */
  countdown: string | null;
  /** Co-op objective panel. */
  objective: { text: string; timer: string | null } | null;
  /** Local player downed. */
  downed: { text: string; timer: string } | null;
  /** Near a downed ally: hold interact. */
  revive: { text: string; progress: number } | null;
  /** PvP top-centre scoreboard while a match runs. */
  pvp: { red: number; blue: number; round: string; timer: string } | null;
}

export function modeView(i: ModeViewInput): ModeView {
  const { coop, pvp, downed } = i.mode;
  const k = i.interactKey;
  const v: ModeView = { board: null, countdown: null, objective: null, downed: null, revive: null, pvp: null };
  const pos = i.pos;

  // Start squares (free roam only).
  if (pos && coop.phase !== 'running' && coop.phase !== 'results' && pvp.phase !== 'running' && pvp.phase !== 'results') {
    if (squareAt(i.squares, 'coop', pos.x, pos.z)) {
      v.board = { title: `Mission : ${coop.title}`, hint: `${k} : changer de mission`, team: null, blocked: null };
    } else {
      const sq = squareAt(i.squares, 'pvp', pos.x, pos.z);
      if (sq) {
        const team = pvpHalf(sq, pos.x, pos.z);
        v.board = {
          title: `Arène : ${pvp.arenaName}`,
          hint: `${k} : changer d’arène · Rouge ${pvp.teams.red.length} – ${pvp.teams.blue.length} Bleu`,
          team,
          blocked: pvp.blocked,
        };
      }
    }
  }

  if (coop.phase === 'countdown') v.countdown = `Mission dans ${Math.max(1, Math.ceil(coop.countdown))}…`;
  else if (pvp.phase === 'countdown') v.countdown = `Combat dans ${Math.max(1, Math.ceil(pvp.countdown))}…`;
  else if (pvp.phase === 'running' && pvp.roundCountdown > 0) v.countdown = `Manche ${pvp.round} — ${Math.ceil(pvp.roundCountdown)}`;

  if (coop.phase === 'running') {
    const inMission = coop.participants.includes(i.myPlayerId);
    v.objective = inMission
      ? { text: `${coop.title} — Groupes restants ${coop.groupsLeft}/${coop.groupsTotal}`, timer: coop.timeLeft === null ? null : formatTime(coop.timeLeft) }
      : { text: `Mission en cours : ${coop.title} — attendez la suivante au village`, timer: null };
  }

  if (pvp.phase === 'running') {
    v.pvp = { red: pvp.score.red, blue: pvp.score.blue, round: `Manche ${pvp.round}`, timer: formatTime(pvp.roundTime) };
  }

  const mine = downed.find((d) => d.actorId === i.myActorId);
  if (mine) {
    v.downed = { text: `À terre — un allié peut vous relever (${k})`, timer: `${Math.max(0, Math.ceil(mine.bleed))} s` };
  } else if (pos) {
    // Closest downed ally within revive range (positions from the minimap markers).
    let best: { d: number; revive: number } | null = null;
    for (const m of i.markers) {
      if (m.kind !== 'downed') continue;
      const d = Math.hypot(m.x - pos.x, m.z - pos.z);
      const info = downed.find((x) => x.actorId === m.id);
      if (info && d <= MISSION_RULES.reviveRadius && (!best || d < best.d)) best = { d, revive: info.revive };
    }
    if (best) v.revive = { text: `Maintenir ${k} pour relever`, progress: Math.max(0, Math.min(1, best.revive)) };
  }
  return v;
}
