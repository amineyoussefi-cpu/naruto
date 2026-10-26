import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Actor } from '../../src/sim/Actor';
import { Fighter } from '../../src/sim/combat/Fighter';
import { EventBus } from '../../src/core/events';
import { ModeDirector } from '../../src/sim/missions/ModeDirector';
import { MISSIONS, MISSION_RULES } from '../../src/config/missions';
import { PVP } from '../../src/config/pvp';
import { actionBit, emptyInput, type InputAction } from '../../src/sim/protocol';
import type { PlayerState, SimContext } from '../../src/sim/context';
import type { CharacterBody, PhysicsWorld } from '../../src/sim/physics/PhysicsWorld';
import type { ActorKind } from '../../src/core/types';
import type { WorldData } from '../../src/sim/world/types';

const DT = 1 / 60;
const v = (x: number, z: number) => ({ x, y: 0, z });
const POINTS = ['village.market', 'village.training', 'village.river', 'village.rooftops', 'village.gate', 'forest.path', 'forest.clearing',
  'forest.ravine', 'forest.deep', 'shore.docks', 'shore.beach', 'island.north', 'island.east', 'gate.main'];

function makeWorld(): WorldData {
  return {
    squares: [
      { id: 'coop-hq', kind: 'coop', center: v(0, 0), size: 10, yaw: 0, board: v(0, 6), returnPoint: v(0, -10) },
      { id: 'pvp-hq', kind: 'pvp', center: v(30, 0), size: 10, yaw: 0, board: v(30, 6), returnPoint: v(30, -10) },
    ],
    arenas: [{ id: 'training', name: "Terrain d'entraînement", center: v(100, 100), radius: 20, spawns: { red: [v(90, 100)], blue: [v(110, 100), v(110, 104)] } }],
    points: Object.fromEntries(POINTS.map((p, i) => [p, v(-200 + i * 30, -100)])),
  } as unknown as WorldData;
}

function makeSim() {
  const events = new EventBus();
  const actors: Actor[] = [];
  const players = new Map<number, PlayerState>();
  const rayBlocked = { value: false };
  const physics = {
    teleport: () => {},
    raycast: () => (rayBlocked.value ? { distance: 1 } : null),
  } as unknown as PhysicsWorld;
  const mk = (kind: ActorKind, hp: number) => new Actor(kind, kind === 'player' ? 'player' : 'enemy', kind, new Fighter({ maxHp: hp, maxChakra: 50 }), {} as CharacterBody, 0.4, 1.8);
  const ctx = {
    physics, events, world: makeWorld(), time: 0, actors, players,
    playerOf: (a: Actor) => [...players.values()].find((p) => p.actor === a),
    spawnEnemy: (kind: Exclude<ActorKind, 'player'>, feet: THREE.Vector3) => {
      const a = mk(kind, 40);
      a.position.copy(feet);
      actors.push(a);
      return a;
    },
    removeActor: (a: Actor) => { a.removed = true; actors.splice(actors.indexOf(a), 1); },
    enemies: () => actors.filter((a) => a.kind !== 'player' && a.alive),
  } as unknown as SimContext;
  const addPlayer = (id: number, x: number, z: number) => {
    const actor = mk('player', 100);
    actor.position.set(x, 0, z);
    actors.push(actor);
    const p = { id, name: `P${id}`, actor, input: emptyInput(), pressed: new Set<InputAction>(), connected: true } as unknown as PlayerState;
    players.set(id, p);
    return p;
  };
  const dir = new ModeDirector(ctx);
  const run = (seconds: number, each?: () => void) => { for (let i = 0; i < Math.round(seconds / DT); i++) { each?.(); dir.update(DT); } };
  const kill = (a: Actor, by?: Actor) => {
    a.fighter.hp = 0;
    if (by) events.emit('damage', { targetId: a.id, sourceId: by.id, amount: 10, blocked: false, killed: true, kind: 'light' as never, position: a.position });
    events.emit('death', { id: a.id, team: a.team });
  };
  return { ctx, dir, addPlayer, run, kill, rayBlocked };
}

describe('ModeDirector co-op', () => {
  it('does nothing without a world', () => {
    const s = makeSim();
    (s.ctx as { world: WorldData | null }).world = null;
    s.addPlayer(1, 0, 0);
    s.run(6);
    expect(s.dir.state().coop.phase).toBe('idle');
    expect(s.dir.markers(1)).toEqual([]);
  });

  it('board cycling, start, dormant groups, aggro, down & revive, victory and return', () => {
    const s = makeSim();
    const p1 = s.addPlayer(1, 1, 1), p2 = s.addPlayer(2, -1, 2);
    p1.pressed = new Set(['interact']);
    s.run(DT);
    p1.pressed = new Set();
    expect(s.dir.state().coop.missionIndex).toBe(1);
    s.dir.missionIndex = 0;
    expect(s.dir.state().coop.phase).toBe('countdown');
    s.run(MISSION_RULES.countdown);
    const st = s.dir.state().coop;
    expect(st.phase).toBe('running');
    expect(st.participants).toEqual([1, 2]);
    expect(st.groupsTotal).toBe(MISSIONS[0].groups.length);

    const enemies = s.ctx.actors.filter((a) => a.kind !== 'player');
    expect(enemies.length).toBe(3 + 5 + 3); // 2 → 3, (2+1) → (3+2), 2 → 3 with 2 players
    expect(enemies.every((a) => a.dormant && a.groupId > 0)).toBe(true);
    const m = s.dir.markers(1);
    expect(m.filter((x) => x.kind === 'group').length).toBe(3);
    expect(m.filter((x) => x.kind === 'square').length).toBe(2);
    expect(m.filter((x) => x.kind === 'objective').length).toBe(1);
    expect(m.find((x) => x.kind === 'player')).toMatchObject({ id: p2.actor.id, name: 'P2' });

    // Walk p1 to the market group: that group wakes, the others stay dormant.
    const market = s.ctx.world!.points['village.market'];
    p1.actor.position.set(market.x + 5, 0, market.z);
    s.run(DT);
    const marketGroup = enemies[0].groupId;
    expect(enemies.filter((a) => a.groupId === marketGroup).every((a) => !a.dormant)).toBe(true);
    expect(enemies.filter((a) => a.groupId !== marketGroup).every((a) => a.dormant)).toBe(true);
    expect(s.dir.markers(1).find((x) => x.kind === 'group' && x.id === marketGroup)).toMatchObject({ fighting: true });

    // p1 is downed; p2 holds interact next to them for 3 s.
    s.kill(p1.actor);
    expect(p1.actor.downed).toBe(MISSION_RULES.bleedTime);
    expect(s.dir.holdsRespawn(p1.actor.id)).toBe(true);
    expect(s.dir.markers(2).some((x) => x.kind === 'downed' && x.id === p1.actor.id)).toBe(true);
    p2.actor.position.set(market.x + 6, 0, market.z);
    p2.input.held = actionBit('interact');
    s.run(MISSION_RULES.reviveTime);
    p2.input.held = 0;
    expect(p1.actor.fighter.hp).toBeCloseTo(MISSION_RULES.reviveHp * 100);
    expect(p1.actor.downed).toBe(0);
    expect(s.dir.state().downed).toEqual([]);

    // Kills are credited, wiping every group wins.
    for (const e of enemies) s.kill(e, p1.actor);
    s.run(DT * 2);
    const res = s.dir.state().coop;
    expect(res.phase).toBe('results');
    expect(res.results).toMatchObject({ victory: true });
    expect(res.results!.players).toEqual([{ id: 1, name: 'P1', kills: enemies.length, revives: 0 }, { id: 2, name: 'P2', kills: 0, revives: 1 }]);

    s.run(MISSION_RULES.resultsTime);
    expect(s.dir.state().coop.phase).toBe('idle');
    expect(p1.actor.fighter.hp).toBe(100);
    expect(Math.hypot(p1.actor.position.x, p1.actor.position.z + 10)).toBeCloseTo(MISSION_RULES.returnSpacing);
    expect(s.ctx.actors.filter((a) => a.kind !== 'player')).toEqual([]);
  });

  it('all downed → defeat; bled-out players stay out; late joiner and disconnect', () => {
    const s = makeSim();
    const p1 = s.addPlayer(1, 0, 0), p2 = s.addPlayer(2, 1, 0);
    s.run(MISSION_RULES.countdown + DT);
    expect(s.dir.state().coop.phase).toBe('running');
    const p3 = s.addPlayer(3, 0, 0); // late joiner
    s.dir.onPlayerJoin(p3);
    s.run(DT);
    expect(s.dir.state().coop.participants).toEqual([1, 2]);

    s.kill(p1.actor);
    s.run(MISSION_RULES.bleedTime + DT);
    expect(p1.actor.downed).toBe(0);
    expect(s.dir.holdsRespawn(p1.actor.id)).toBe(true); // spectating
    expect(s.dir.state().coop.phase).toBe('running');
    s.kill(p2.actor);
    s.run(DT);
    expect(s.dir.state().coop.results).toMatchObject({ victory: false });
  });

  it('a mission ends in defeat when every participant disconnects', () => {
    const s = makeSim();
    const p1 = s.addPlayer(1, 0, 0);
    s.run(MISSION_RULES.countdown + DT);
    p1.connected = false;
    s.dir.onPlayerLeave(p1);
    s.run(DT);
    expect(s.dir.state().coop.phase).toBe('results');
    s.run(MISSION_RULES.resultsTime);
    expect(s.ctx.actors.filter((a) => a.kind !== 'player')).toEqual([]);
  });
});

describe('ModeDirector PvP', () => {
  const setup = () => {
    const s = makeSim();
    const p1 = s.addPlayer(1, 27, 0); // red half
    const p2 = s.addPlayer(2, 33, 0), p3 = s.addPlayer(3, 33, 2); // blue half
    return { ...s, p1, p2, p3 };
  };

  it('2v1: teams, handicap, frozen pre-round, dome, KO feed, results and restore', () => {
    const s = setup();
    s.run(DT);
    const lobby = s.dir.state().pvp;
    expect(lobby).toMatchObject({ phase: 'countdown', squareId: 'pvp-hq', teams: { red: [1], blue: [2, 3] }, blocked: null });
    s.run(PVP.countdown);
    expect(s.dir.state().pvp.phase).toBe('running');
    expect(s.p1.actor.team).toBe('red');
    expect(s.p2.actor.team).toBe('blue');
    expect(s.p1.actor.fighter.maxHp).toBeCloseTo(100 * (1 + PVP.handicapPerMissingPlayer));
    expect(s.p1.actor.fighter.hp).toBeCloseTo(125);
    expect(s.p2.actor.fighter.maxHp).toBe(100);
    expect(s.p1.actor.position.x).toBe(90);
    expect(s.dir.frozen(s.p1.actor.id)).toBe(true);
    expect(s.p1.actor.control.allowMove).toBe(false);
    s.run(PVP.roundCountdown, () => s.p1.actor.resetControl()); // combat resets control every step
    expect(s.dir.frozen(s.p1.actor.id)).toBe(false);
    expect(s.p1.actor.control.allowMove).toBe(true);

    // Dome keeps players inside.
    s.p1.actor.position.set(200, 0, 100);
    s.run(DT);
    expect(Math.hypot(s.p1.actor.position.x - 100, s.p1.actor.position.z - 100)).toBeLessThanOrEqual(20);

    // Opponents are hidden far away behind walls, shown when near.
    s.rayBlocked.value = true;
    s.p2.actor.position.set(81, 0, 100); // ~38 m from p1 (clamped near x 119)
    expect(s.dir.markers(1).some((x) => x.kind === 'player' && x.id === s.p2.actor.id)).toBe(false);
    expect(s.dir.markers(2).some((x) => x.kind === 'player' && x.id === s.p3.actor.id)).toBe(true); // teammate
    s.rayBlocked.value = false; // far but in line of sight
    expect(s.dir.markers(1).some((x) => x.kind === 'player' && x.id === s.p2.actor.id)).toBe(true);
    s.rayBlocked.value = true;
    s.p2.actor.position.set(110, 0, 100);
    expect(s.dir.markers(1).some((x) => x.kind === 'player' && x.id === s.p2.actor.id)).toBe(true);

    // KO: p2 kills p1 → round to blue.
    s.kill(s.p1.actor, s.p2.actor);
    s.run(DT);
    let st = s.dir.state().pvp;
    expect(st.score).toEqual({ red: 0, blue: 1 });
    expect(st.killFeed).toEqual([{ killer: 'P2', victim: 'P1', time: 0 }]);
    s.run(PVP.roundEndPause + DT);
    st = s.dir.state().pvp;
    expect(st.round).toBe(2);
    expect(s.p1.actor.fighter.hp).toBeCloseTo(125); // full HP between rounds
    s.run(PVP.roundCountdown + DT);
    s.kill(s.p1.actor, s.p3.actor);
    s.run(DT);
    st = s.dir.state().pvp;
    expect(st.phase).toBe('results');
    expect(st.results).toMatchObject({ winner: 'blue', rounds: { red: 0, blue: 2 } });
    expect(st.results!.players.find((p) => p.id === 2)).toMatchObject({ damage: 10, kos: 1 });

    s.run(PVP.resultsTime);
    expect(s.dir.state().pvp.phase).toBe('idle');
    expect(s.p1.actor.team).toBe('player');
    expect(s.p1.actor.fighter.maxHp).toBe(100);
    expect(s.p1.actor.fighter.hp).toBe(100);
    expect(Math.hypot(s.p1.actor.position.x - 30, s.p1.actor.position.z + 10)).toBeCloseTo(MISSION_RULES.returnSpacing);
  });

  it('a disconnect emptying a team ends the match; co-op cannot start meanwhile', () => {
    const s = setup();
    s.run(PVP.countdown + DT);
    expect(s.dir.state().pvp.phase).toBe('running');
    s.p1.connected = false;
    s.dir.onPlayerLeave(s.p1);
    expect(s.p1.actor.fighter.maxHp).toBe(100);
    expect(s.p1.actor.team).toBe('player');
    const st = s.dir.state().pvp;
    expect(st.phase).toBe('results');
    expect(st.results?.winner).toBe('blue');
    for (const p of [s.p2, s.p3]) p.actor.position.set(0, 0, 0); // everyone left in the co-op square
    s.run(MISSION_RULES.countdown);
    expect(s.dir.state().coop.phase).toBe('idle');
  });

  it('blocked message when all stand on one half', () => {
    const s = setup();
    s.p1.actor.position.set(33, 0, -2);
    s.run(DT);
    expect(s.dir.state().pvp).toMatchObject({ phase: 'idle', blocked: 'Il faut au moins un joueur dans chaque équipe' });
  });
});
