import { describe, expect, it } from 'vitest';
import { modeView, type ModeViewInput } from '../../src/ui/modeView';
import type { CoopState, ModeState, PvpState } from '../../src/sim/missions/types';
import type { SquareDef } from '../../src/sim/world/types';

const sq = (id: string, kind: 'coop' | 'pvp', x: number): SquareDef => ({
  id, kind, center: { x, y: 0, z: 0 }, size: 10, yaw: 0, board: { x, y: 0, z: 6 }, returnPoint: { x, y: 0, z: 8 },
});
const coop = (o: Partial<CoopState> = {}): CoopState => ({
  phase: 'idle', missionIndex: 0, missionId: 'm', title: 'Intrus dans le village', countdown: 0, timeLeft: null,
  groupsLeft: 0, groupsTotal: 0, participants: [], results: null, ...o,
});
const pvp = (o: Partial<PvpState> = {}): PvpState => ({
  phase: 'idle', squareId: null, arenaIndex: 0, arenaId: 'training', arenaName: 'Terrain d’entraînement', countdown: 0,
  round: 0, roundTime: 0, roundCountdown: 0, score: { red: 0, blue: 0 }, teams: { red: [], blue: [] }, blocked: null,
  killFeed: [], results: null, ...o,
});
const input = (mode: Partial<ModeState>, pos: { x: number; z: number } | null, o: Partial<ModeViewInput> = {}): ModeViewInput => ({
  mode: { coop: coop(), pvp: pvp(), downed: [], ...mode }, markers: [], squares: [sq('coop', 'coop', 0), sq('pvp', 'pvp', 40)],
  pos, myActorId: 7, myPlayerId: 1, interactKey: 'F', ...o,
});

describe('mode HUD view', () => {
  it('shows nothing in free roam outside the squares', () => {
    expect(modeView(input({}, { x: 100, z: 100 }))).toEqual({ board: null, countdown: null, objective: null, downed: null, revive: null, pvp: null });
  });

  it('shows the mission board in the co-op square and the countdown', () => {
    const v = modeView(input({ coop: coop({ phase: 'countdown', countdown: 4.2 }) }, { x: 1, z: 1 }));
    expect(v.board?.title).toBe('Mission : Intrus dans le village');
    expect(v.board?.hint).toContain('F');
    expect(v.countdown).toBe('Mission dans 5…');
  });

  it('PvP square: half → team, counts and blocked reason', () => {
    const p = pvp({ teams: { red: [1], blue: [] }, blocked: 'Il faut au moins un joueur dans chaque équipe' });
    const red = modeView(input({ pvp: p }, { x: 37, z: 0 }));
    expect(red.board?.team).toBe('red');
    expect(red.board?.hint).toContain('Rouge 1 – 0 Bleu');
    expect(red.board?.blocked).toContain('chaque équipe');
    expect(modeView(input({ pvp: p }, { x: 43, z: 0 })).board?.team).toBe('blue');
  });

  it('co-op running: objective for participants, waiting text for late joiners', () => {
    const c = coop({ phase: 'running', groupsLeft: 2, groupsTotal: 3, timeLeft: 75, participants: [1] });
    const v = modeView(input({ coop: c }, { x: 0, z: 0 }));
    expect(v.board).toBeNull();
    expect(v.objective).toEqual({ text: 'Intrus dans le village — Groupes restants 2/3', timer: '1:15' });
    expect(modeView(input({ coop: c }, null, { myPlayerId: 2 })).objective?.text).toContain('attendez');
  });

  it('downed prompt with bleed-out timer, revive prompt near a downed ally', () => {
    const downed = [{ actorId: 7, bleed: 21.3, revive: 0 }, { actorId: 9, bleed: 10, revive: 0.5 }];
    const me = modeView(input({ downed }, { x: 0, z: 0 }));
    expect(me.downed).toEqual({ text: 'À terre — un allié peut vous relever (F)', timer: '22 s' });
    const markers = [{ kind: 'downed' as const, id: 9, x: 1, z: 1 }];
    const ally = modeView(input({ downed: [downed[1]] }, { x: 0, z: 0 }, { markers }));
    expect(ally.revive).toEqual({ text: 'Maintenir F pour relever', progress: 0.5 });
    expect(modeView(input({ downed: [downed[1]] }, { x: 30, z: 0 }, { markers })).revive).toBeNull();
  });

  it('PvP running: scoreboard, timer and round countdown', () => {
    const v = modeView(input({ pvp: pvp({ phase: 'running', round: 2, roundTime: 90, roundCountdown: 2.5, score: { red: 1, blue: 0 } }) }, { x: 40, z: 0 }));
    expect(v.pvp).toEqual({ red: 1, blue: 0, round: 'Manche 2', timer: '1:30' });
    expect(v.countdown).toBe('Manche 2 — 3');
    expect(v.board).toBeNull();
  });
});
