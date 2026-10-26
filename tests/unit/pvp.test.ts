import { describe, expect, it } from 'vitest';
import { PvpFlow, checkTeams, handicap, type Spot } from '../../src/sim/missions/pvpFlow';
import { PVP } from '../../src/config/pvp';

const DT = 1 / 60;
const steps = (s: number) => Math.round(s / DT);
const spots = (o: Record<number, Spot>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
const R = (square = 'a'): Spot => ({ square, team: 'red' });
const B = (square = 'a'): Spot => ({ square, team: 'blue' });

describe('checkTeams', () => {
  it('needs everyone in the same square and both teams non-empty', () => {
    expect(checkTeams([1], spots({ 1: null })).squareId).toBeNull();
    expect(checkTeams([1], spots({ 1: R() })).blocked).toBe('Il faut au moins un joueur dans chaque équipe');
    expect(checkTeams([1, 2], spots({ 1: R(), 2: R() })).blocked).not.toBeNull();
    expect(checkTeams([1, 2, 3], spots({ 1: R(), 2: B(), 3: null })).blocked).toContain('2/3');
    expect(checkTeams([1, 2], spots({ 1: R('a'), 2: B('b') })).blocked).not.toBeNull();
    const ok = checkTeams([1, 2, 3], spots({ 1: R(), 2: B(), 3: B() }));
    expect(ok.blocked).toBeNull();
    expect(ok.teams).toEqual({ red: [1], blue: [2, 3] });
  });
  it('max 3 per team', () => {
    expect(checkTeams([1, 2, 3, 4], spots({ 1: R(), 2: B(), 3: B(), 4: B() })).blocked).toBeNull();
    expect(checkTeams([1, 2, 3, 4], spots({ 1: R(), 2: B(), 3: B(), 4: B() }), 2).blocked).toContain('maximum');
    const check = checkTeams([1, 2, 3, 4, 5], spots({ 1: R(), 2: B(), 3: B(), 4: B(), 5: B() }));
    expect(check.blocked).toContain('maximum');
  });
  it('handicap: +25 % HP per missing player for the smaller team', () => {
    const t = { red: [1], blue: [2, 3, 4] };
    expect(handicap(t, 'red')).toBeCloseTo(2 * PVP.handicapPerMissingPlayer);
    expect(handicap(t, 'blue')).toBe(0);
  });
});

const startMatch = () => {
  const f = new PvpFlow();
  const c = checkTeams([1, 2], spots({ 1: R(), 2: B() }));
  while (!f.lobby(DT, c));
  return f;
};

describe('PvpFlow', () => {
  it('5 s countdown, side switching restarts it, invalid teams cancel it', () => {
    const f = new PvpFlow();
    const c1 = checkTeams([1, 2, 3], spots({ 1: R(), 2: B(), 3: B() }));
    f.lobby(DT, c1);
    expect(f.phase).toBe('countdown');
    for (let i = 0; i < 60; i++) f.lobby(DT, c1);
    expect(f.countdown).toBeCloseTo(4);
    f.lobby(DT, checkTeams([1, 2, 3], spots({ 1: R(), 2: B(), 3: R() }))); // player 3 changes sides
    expect(f.countdown).toBe(PVP.countdown);
    expect(f.teams).toEqual({ red: [1, 3], blue: [2] });
    f.lobby(DT, checkTeams([1, 2, 3], spots({ 1: R(), 2: R(), 3: R() })));
    expect(f.phase).toBe('idle');
    expect(f.blocked).not.toBeNull();
    let n = 0;
    const c2 = checkTeams([1, 2], spots({ 1: R(), 2: B() }));
    f.lobby(DT, c2);
    while (!f.lobby(DT, c2)) n++;
    expect(n + 1).toBe(steps(PVP.countdown));
    expect(f.phase).toBe('running');
    expect(f.round).toBe(1);
  });

  it('3 s frozen pre-round countdown, then elimination wins the round', () => {
    const f = startMatch();
    expect(f.frozen).toBe(true);
    let ev = null, n = 0;
    while (!ev) { ev = f.run(DT, { red: 1, blue: 1 }, { red: 1, blue: 1 }); n++; }
    expect(ev).toEqual({ type: 'roundStart', round: 1 });
    expect(n).toBe(steps(PVP.roundCountdown));
    expect(f.frozen).toBe(false);
    expect(f.roundTime).toBe(PVP.roundTime);
    expect(f.run(DT, { red: 1, blue: 0 }, { red: 1, blue: 0 })).toEqual({ type: 'roundEnd', round: 1, winner: 'red' });
    expect(f.score).toEqual({ red: 1, blue: 0 });
  });

  it('timer: higher total HP % wins; best of 3 ends the match', () => {
    const f = startMatch();
    const play = (pct: { red: number; blue: number }, killBlue = false) => {
      for (;;) {
        const ev = f.run(DT, { red: 1, blue: killBlue && f.roundTime > 0 && f.roundTime < PVP.roundTime ? 0 : 1 }, pct);
        if (ev && (ev.type === 'roundEnd' || ev.type === 'matchEnd')) return ev;
      }
    };
    expect(play({ red: 0.3, blue: 0.6 })).toEqual({ type: 'roundEnd', round: 1, winner: 'blue' });
    let prep = null;
    while (!prep) prep = f.run(DT, { red: 1, blue: 1 }, { red: 1, blue: 1 });
    expect(prep).toEqual({ type: 'roundPrep', round: 2 });
    expect(f.frozen).toBe(true);
    expect(play({ red: 0.5, blue: 0.5 })).toEqual({ type: 'roundEnd', round: 2, winner: null }); // draw: nobody scores
    expect(play({ red: 0.9, blue: 0.1 })).toEqual({ type: 'roundEnd', round: 3, winner: 'red' });
    expect(play({ red: 1, blue: 1 }, true)).toEqual({ type: 'matchEnd', winner: 'red' });
    expect(f.phase).toBe('results');
    expect(f.score).toEqual({ red: 2, blue: 1 });
    let n = 0;
    while (!f.results(DT)) n++;
    expect(n + 1).toBe(steps(PVP.resultsTime));
    expect(f.phase).toBe('idle');
  });

  it('a disconnect that empties a team ends the match', () => {
    const f = new PvpFlow();
    const c = checkTeams([1, 2, 3], spots({ 1: R(), 2: B(), 3: B() }));
    while (!f.lobby(DT, c));
    expect(f.removePlayer(2)).toBeNull();
    expect(f.teams.blue).toEqual([3]);
    expect(f.removePlayer(1)).toBe('blue');
    expect(f.phase).toBe('results');
    expect(f.winner).toBe('blue');
  });
});
