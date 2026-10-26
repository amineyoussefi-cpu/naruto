import { describe, expect, it } from 'vitest';
import { CoopFlow, allInside, scaleGroup, tickDowned } from '../../src/sim/missions/coopFlow';
import { inSquare, pvpHalf, spreadPoint } from '../../src/sim/missions/squares';
import { MISSIONS, MISSION_RULES } from '../../src/config/missions';
import type { SquareDef } from '../../src/sim/world/types';

const DT = 1 / 60;
const steps = (s: number) => Math.round(s / DT);

const square = (yaw = 0): SquareDef => ({
  id: 'sq', kind: 'pvp', center: { x: 10, y: 0, z: 20 }, size: 10, yaw, board: { x: 0, y: 0, z: 0 }, returnPoint: { x: 0, y: 0, z: 0 },
});

describe('squares', () => {
  it('point in square, axis-aligned and rotated 45°', () => {
    expect(inSquare(square(), 14.9, 24.9)).toBe(true);
    expect(inSquare(square(), 15.1, 20)).toBe(false);
    // Rotated 45°: the corner direction now lies on an axis, so (10 + 6, 20) is inside (half-diagonal 7.07).
    expect(inSquare(square(Math.PI / 4), 16, 20)).toBe(true);
    expect(inSquare(square(Math.PI / 4), 14.5, 24.5)).toBe(false);
  });
  it('red half is local -X, blue half local +X', () => {
    expect(pvpHalf(square(), 7, 20)).toBe('red');
    expect(pvpHalf(square(), 13, 20)).toBe('blue');
    // yaw 90°: local +X = (cos, 0, -sin) = world -Z.
    expect(pvpHalf(square(Math.PI / 2), 10, 17)).toBe('blue');
    expect(pvpHalf(square(Math.PI / 2), 10, 23)).toBe('red');
  });
  it('spreads players around a point', () => {
    expect(spreadPoint({ x: 1, y: 2, z: 3 }, 0, 1, 2)).toEqual({ x: 1, y: 2, z: 3 });
    const pts = [0, 1, 2].map((i) => spreadPoint({ x: 0, y: 0, z: 0 }, i, 3, 2));
    for (const p of pts) expect(Math.hypot(p.x, p.z)).toBeCloseTo(2);
    expect(Math.hypot(pts[0].x - pts[1].x, pts[0].z - pts[1].z)).toBeGreaterThan(1);
  });
});

describe('CoopFlow', () => {
  it('starts only when every connected player is inside (solo = 1), after 5 s', () => {
    expect(allInside([], [])).toBe(false);
    const f = new CoopFlow();
    f.lobby(DT, [1, 2], [1], null);
    expect(f.phase).toBe('idle');
    f.lobby(DT, [1], [1], null); // solo
    expect(f.phase).toBe('countdown');
    expect(f.countdown).toBe(MISSION_RULES.countdown);
    let started = -1;
    for (let i = 0; i < steps(6) && started < 0; i++) if (f.lobby(DT, [1], [1], 300)) started = i + 1;
    expect(started).toBe(steps(5));
    expect(f.phase).toBe('running');
    expect(f.participants).toEqual([1]);
    expect(f.timeLeft).toBe(300);
  });

  it('cancels when someone leaves the square, restarts on board change', () => {
    const f = new CoopFlow();
    f.lobby(DT, [1, 2], [1, 2], null);
    for (let i = 0; i < 60; i++) f.lobby(DT, [1, 2], [1, 2], null);
    expect(f.countdown).toBeLessThan(5);
    f.restartCountdown();
    expect(f.countdown).toBe(5);
    f.lobby(DT, [1, 2], [2], null);
    expect(f.phase).toBe('idle');
    // A new connected player who is outside blocks the start.
    f.lobby(DT, [1, 2, 3], [1, 2], null);
    expect(f.phase).toBe('idle');
  });

  const running = (players = [1, 2], limit: number | null = null) => {
    const f = new CoopFlow();
    f.lobby(DT, players, players, limit);
    while (!f.lobby(DT, players, players, limit));
    return f;
  };

  it('victory when every group is wiped, results 10 s then idle', () => {
    const f = running();
    expect(f.run(DT, 2, 2)).toBeNull();
    expect(f.run(DT, 0, 2)).toBe('victory');
    expect(f.phase).toBe('results');
    let n = 0;
    while (!f.results(DT)) n++;
    expect(n + 1).toBe(steps(MISSION_RULES.resultsTime));
    expect(f.phase).toBe('idle');
    expect(f.participants).toEqual([]);
  });

  it('defeat when nobody stands, on timeout, or when every participant disconnects', () => {
    expect(running().run(DT, 3, 0)).toBe('defeat');
    const t = running([1], 2);
    let r = null;
    for (let i = 0; i < steps(2) && !r; i++) r = t.run(DT, 1, 1);
    expect(r).toBe('defeat');
    const d = running([1, 2]);
    d.removePlayer(1);
    expect(d.run(DT, 1, 1)).toBeNull();
    d.removePlayer(2);
    expect(d.run(DT, 1, 1)).toBe('defeat');
  });

  it('late joiners are not participants of the running mission', () => {
    const f = running([1]);
    f.lobby(DT, [1, 2], [1, 2], null); // no effect while running
    expect(f.participants).toEqual([1]);
    expect(f.phase).toBe('running');
  });
});

describe('scaling and down & revive', () => {
  it('scales enemy count and HP with the number of players', () => {
    const s = { count: 0.5, hp: 0.2 };
    expect(scaleGroup(2, 1, s)).toEqual({ count: 2, hpMul: 1 });
    expect(scaleGroup(2, 3, s)).toEqual({ count: 4, hpMul: 1.4 });
    expect(scaleGroup(1, 6, s).count).toBe(4);
    expect(scaleGroup(3, 0, s)).toEqual({ count: 3, hpMul: 1 });
  });

  it('revives after holding 3 s, releasing resets the progress', () => {
    const d = { bleed: MISSION_RULES.bleedTime, revive: 0 };
    for (let i = 0; i < steps(2); i++) expect(tickDowned(d, DT, true)).toBe('down');
    expect(tickDowned(d, DT, false)).toBe('down');
    expect(d.revive).toBe(0);
    let r = 'down', n = 0;
    while (r === 'down') { r = tickDowned(d, DT, true); n++; }
    expect(r).toBe('revived');
    expect(n).toBe(steps(MISSION_RULES.reviveTime));
  });

  it('bleeds out after 30 s', () => {
    const d = { bleed: MISSION_RULES.bleedTime, revive: 0 };
    let r = 'down', n = 0;
    while (r === 'down') { r = tickDowned(d, DT, false); n++; }
    expect(r).toBe('bledOut');
    expect(Math.abs(n - steps(30))).toBeLessThanOrEqual(1);
  });
});

describe('mission config', () => {
  const POINTS = ['village.market', 'village.training', 'village.river', 'village.rooftops', 'village.gate', 'forest.path', 'forest.clearing',
    'forest.ravine', 'forest.deep', 'shore.docks', 'shore.beach', 'island.north', 'island.east', 'gate.main'];
  it('has at least 5 missions with 2–5 groups on known points', () => {
    expect(MISSIONS.length).toBeGreaterThanOrEqual(5);
    for (const t of ['Intrus dans le village', 'Embuscade en forêt', 'Bandits sur les quais', 'Île des déserteurs', 'Défense de la porte']) {
      expect(MISSIONS.some((m) => m.title === t)).toBe(true);
    }
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(MISSIONS.length);
    for (const m of MISSIONS) {
      expect(m.groups.length).toBeGreaterThanOrEqual(2);
      expect(m.groups.length).toBeLessThanOrEqual(5);
      for (const g of m.groups) {
        expect(POINTS).toContain(g.point);
        expect(g.enemies.reduce((s, e) => s + e.count, 0)).toBeGreaterThan(0);
      }
    }
  });
});
