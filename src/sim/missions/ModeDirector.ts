/**
 * Co-op missions and PvP matches on top of the pure flows (coopFlow / pvpFlow / squares).
 * Called once per step after combat. Owner: missions agent.
 */
import * as THREE from 'three';
import type { SimContext, PlayerState } from '../context';
import type { Actor } from '../Actor';
import { hasBit, type PlayerId } from '../protocol';
import type { GameEvents } from '../../core/events';
import type { Vec3Like } from '../../core/types';
import type { PvpArenaDef, SquareDef } from '../world/types';
import type { Marker, ModeState, PvpTeam } from './types';
import { MISSIONS, MISSION_RULES, type MissionGroupDef } from '../../config/missions';
import { PVP } from '../../config/pvp';
import { MINIMAP } from '../../config/minimap';
import { CoopFlow, scaleGroup, tickDowned, type DownedTimer } from './coopFlow';
import { PvpFlow, checkTeams, handicap, type Spot } from './pvpFlow';
import { inSquare, pvpHalf, squareAt, spreadPoint } from './squares';

interface Group {
  id: number;
  def: MissionGroupDef;
  point: Vec3Like;
  wavesLeft: number;
  awake: boolean;
  members: Actor[];
  wiped: boolean;
}

const TEAMS: PvpTeam[] = ['red', 'blue'];
let nextGroupId = 1;

export class ModeDirector {
  readonly coop = new CoopFlow();
  readonly pvp = new PvpFlow();
  missionIndex = 0;
  arenaIndex = 0;
  private groups: Group[] = [];
  private downed = new Map<number, DownedTimer>(); // actor id → timers
  private bledOut = new Set<number>(); // actor ids spectating until the mission ends
  private coopStats = new Map<PlayerId, { id: PlayerId; name: string; kills: number; revives: number }>();
  private coopSquare: SquareDef | null = null;
  private pvpSquare: SquareDef | null = null;
  private arena: PvpArenaDef | null = null;
  private matchPlayers: PlayerId[] = [];
  private savedMaxHp = new Map<PlayerId, number>();
  private pvpStats = new Map<PlayerId, { id: PlayerId; name: string; team: PvpTeam; damage: number; kos: number }>();
  private killFeed: { killer: string; victim: string; time: number }[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly ctx: SimContext) {
    ctx.events.on('death', (e) => this.onDeath(e.id));
    ctx.events.on('damage', (e) => this.onDamage(e));
  }

  // ---------------------------------------------------------------- step

  update(dt: number): void {
    const connected = [...this.ctx.players.values()].filter((p) => p.connected);
    const ids = connected.map((p) => p.id);
    const coopBusy = this.coop.phase === 'running' || this.coop.phase === 'results';
    const pvpBusy = this.pvp.phase === 'running' || this.pvp.phase === 'results';

    if (!pvpBusy) {
      if (this.coop.phase === 'running') this.tickMission(dt);
      else if (this.coop.phase === 'results') {
        const parts = [...this.coop.participants];
        if (this.coop.results(dt)) this.endMission(parts);
      } else this.coopLobby(dt, connected, ids);
    }
    if (!coopBusy) {
      if (this.pvp.phase === 'running') this.tickMatch(dt);
      else if (this.pvp.phase === 'results') {
        if (this.pvp.results(dt)) this.endMatch();
      } else this.pvpLobby(dt, connected, ids);
    }
  }

  /** PvP pre-round countdown: combat should skip this actor (movement is frozen here too). */
  frozen(actorId: number): boolean {
    return this.pvp.frozen && this.matchPlayers.some((id) => this.ctx.players.get(id)?.actor.id === actorId);
  }

  /** True when the mode owns this player's death (downed / bled out in a mission, KO in a match): don't respawn it. */
  holdsRespawn(actorId: number): boolean {
    if (this.coop.phase === 'running' || this.coop.phase === 'results') {
      if (this.downed.has(actorId) || this.bledOut.has(actorId)) return true;
    }
    return (this.pvp.phase === 'running' || this.pvp.phase === 'results') && this.matchPlayers.some((id) => this.ctx.players.get(id)?.actor.id === actorId);
  }

  onPlayerJoin(p: PlayerState): void {
    // Late joiners wait in the village: never part of the running mission/match.
    p.actor.team = 'player';
    p.actor.downed = 0;
  }

  onPlayerLeave(p: PlayerState): void {
    if (this.coop.participants.includes(p.id)) {
      this.coop.removePlayer(p.id);
      this.downed.delete(p.actor.id);
      this.bledOut.delete(p.actor.id);
      p.actor.downed = 0;
    }
    if (this.matchPlayers.includes(p.id)) {
      this.restoreFighter(p);
      this.matchPlayers = this.matchPlayers.filter((id) => id !== p.id);
    }
    this.pvp.removePlayer(p.id);
  }

  reset(): void {
    this.removeMissionEnemies();
    for (const id of this.matchPlayers) {
      const p = this.ctx.players.get(id);
      if (p) this.restoreFighter(p);
    }
    for (const p of this.ctx.players.values()) p.actor.downed = 0;
    this.coop.reset();
    this.pvp.reset();
    this.groups = [];
    this.downed.clear();
    this.bledOut.clear();
    this.matchPlayers = [];
    this.savedMaxHp.clear();
    this.killFeed = [];
    this.coopSquare = this.pvpSquare = this.arena = null;
  }

  // ---------------------------------------------------------------- co-op

  private coopLobby(dt: number, connected: PlayerState[], ids: PlayerId[]): void {
    const sq = this.ctx.world?.squares.find((s) => s.kind === 'coop');
    if (!sq) return;
    const inside = connected.filter((p) => inSquare(sq, p.actor.position.x, p.actor.position.z));
    if (inside.some((p) => p.pressed.has('interact'))) {
      this.missionIndex = (this.missionIndex + 1) % MISSIONS.length;
      this.coop.restartCountdown();
    }
    const mission = MISSIONS[this.missionIndex];
    if (this.coop.lobby(dt, ids, inside.map((p) => p.id), mission.timeLimit)) this.startMission(sq);
  }

  private startMission(sq: SquareDef): void {
    const mission = MISSIONS[this.missionIndex];
    this.coopSquare = sq;
    this.coopStats.clear();
    for (const id of this.coop.participants) {
      const p = this.ctx.players.get(id);
      if (p) this.coopStats.set(id, { id, name: p.name, kills: 0, revives: 0 });
    }
    this.groups = [];
    for (const def of mission.groups) {
      const point = this.ctx.world?.points[def.point];
      if (!point) continue; // unknown point in the data: the group is skipped
      const g: Group = { id: nextGroupId++, def, point, wavesLeft: (def.waves ?? 1) - 1, awake: false, members: [], wiped: false };
      this.spawnWave(g);
      this.groups.push(g);
    }
  }

  private spawnWave(g: Group): void {
    const mission = MISSIONS[this.missionIndex];
    const n = this.coop.participants.length;
    const list: { kind: 'melee' | 'ranged'; hpMul: number }[] = [];
    for (const e of g.def.enemies) {
      const s = scaleGroup(e.count, n, mission.scalePerPlayer);
      for (let i = 0; i < s.count; i++) list.push({ kind: e.kind, hpMul: s.hpMul });
    }
    g.members = list.map((e, i) => {
      const pos = spreadPoint(g.point, i, list.length, MISSION_RULES.spawnSpread);
      const a = this.ctx.spawnEnemy(e.kind, new THREE.Vector3(pos.x, pos.y, pos.z), { hpMul: e.hpMul, dmgMul: MISSION_RULES.dmgMul });
      a.groupId = g.id;
      a.dormant = !g.awake;
      return a;
    });
  }

  private wake(g: Group): void {
    g.awake = true;
    for (const a of g.members) a.dormant = false;
  }

  private tickMission(dt: number): void {
    const mission = MISSIONS[this.missionIndex];
    const standing = this.participantStates().filter((p) => p.actor.alive);

    for (const g of this.groups) {
      if (g.wiped) continue;
      const living = g.members.filter((a) => a.alive && !a.removed);
      if (living.length === 0) {
        if (g.wavesLeft > 0) {
          g.wavesLeft--;
          g.awake = true; // later waves come in fighting
          this.spawnWave(g);
        } else g.wiped = true;
        continue;
      }
      if (!g.awake) {
        const c = this.centre(living);
        if (standing.some((p) => Math.hypot(p.actor.position.x - c.x, p.actor.position.z - c.z) <= mission.aggroRadius)) this.wake(g);
      }
    }

    for (const [actorId, d] of this.downed) {
      const actor = this.actorById(actorId);
      const p = actor && this.ctx.playerOf(actor);
      if (!actor || !p) { this.downed.delete(actorId); continue; }
      if (actor.alive) { this.downed.delete(actorId); actor.downed = 0; continue; } // revived/respawned elsewhere
      const reviver = standing.find((q) => q !== p && hasBit(q.input.held, 'interact')
        && Math.hypot(q.actor.position.x - actor.position.x, q.actor.position.z - actor.position.z) <= MISSION_RULES.reviveRadius);
      const r = tickDowned(d, dt, !!reviver);
      if (r === 'revived') {
        actor.fighter.hp = MISSION_RULES.reviveHp * actor.fighter.maxHp;
        actor.downed = 0;
        actor.setAnim('idle', true);
        this.downed.delete(actorId);
        const s = reviver && this.coopStats.get(reviver.id);
        if (s) s.revives++;
      } else if (r === 'bledOut') {
        actor.downed = 0;
        this.downed.delete(actorId);
        this.bledOut.add(actorId);
      } else actor.downed = Math.max(d.bleed, 1e-3);
    }

    const groupsLeft = this.groups.filter((g) => !g.wiped).length;
    const standingNow = this.participantStates().filter((p) => p.actor.alive).length;
    if (this.coop.run(dt, groupsLeft, standingNow)) {
      for (const g of this.groups) for (const a of g.members) a.dormant = true; // leftovers stop fighting during the results
    }
  }

  private endMission(parts: PlayerId[]): void {
    const sq = this.coopSquare;
    const players = parts.map((id) => this.ctx.players.get(id)).filter((p): p is PlayerState => !!p);
    players.forEach((p, i) => {
      p.actor.downed = 0;
      p.actor.fighter.reset();
      p.actor.setAnim('idle', true);
      if (sq) this.teleport(p.actor, spreadPoint(sq.returnPoint, i, players.length, MISSION_RULES.returnSpacing));
    });
    this.removeMissionEnemies();
    this.groups = [];
    this.downed.clear();
    this.bledOut.clear();
    this.coopSquare = null;
  }

  private removeMissionEnemies(): void {
    for (const g of this.groups) for (const a of g.members) if (!a.removed) this.ctx.removeActor(a);
  }

  private participantStates(): PlayerState[] {
    return this.coop.participants.map((id) => this.ctx.players.get(id)).filter((p): p is PlayerState => !!p);
  }

  // ---------------------------------------------------------------- PvP

  private pvpLobby(dt: number, connected: PlayerState[], ids: PlayerId[]): void {
    const squares = this.ctx.world?.squares ?? [];
    const arenas = this.ctx.world?.arenas ?? [];
    const spots = new Map<PlayerId, Spot>();
    for (const p of connected) {
      const sq = squareAt(squares, 'pvp', p.actor.position.x, p.actor.position.z);
      spots.set(p.id, sq ? { square: sq.id, team: pvpHalf(sq, p.actor.position.x, p.actor.position.z) } : null);
      if (sq && p.pressed.has('interact') && arenas.length) {
        this.arenaIndex = (this.arenaIndex + 1) % arenas.length;
        this.pvp.restartCountdown();
      }
    }
    const check = checkTeams(ids, spots);
    if (check.squareId !== null && !check.blocked && arenas.length === 0) check.blocked = 'Aucune arène disponible';
    if (this.pvp.lobby(dt, check)) this.startMatch();
  }

  private startMatch(): void {
    const world = this.ctx.world!;
    this.pvpSquare = world.squares.find((s) => s.id === this.pvp.squareId) ?? null;
    this.arena = world.arenas[this.arenaIndex % world.arenas.length];
    this.matchPlayers = [];
    this.pvpStats.clear();
    this.killFeed = [];
    for (const team of TEAMS) {
      const bonus = handicap(this.pvp.teams, team);
      for (const id of this.pvp.teams[team]) {
        const p = this.ctx.players.get(id);
        if (!p) continue;
        this.matchPlayers.push(id);
        p.actor.team = team;
        this.savedMaxHp.set(id, p.actor.fighter.stats.maxHp);
        p.actor.fighter.stats.maxHp *= 1 + bonus;
        this.pvpStats.set(id, { id, name: p.name, team, damage: 0, kos: 0 });
      }
    }
    this.prepRound();
  }

  /** Full HP, teleport each team to its spawn side, facing the arena centre. */
  private prepRound(): void {
    const arena = this.arena!;
    for (const team of TEAMS) {
      const spawns = arena.spawns[team];
      this.pvp.teams[team].forEach((id, i) => {
        const p = this.ctx.players.get(id);
        if (!p) return;
        const base = spawns.length ? spawns[i % spawns.length] : arena.center;
        const extra = spawns.length ? Math.floor(i / spawns.length) : i;
        const pos = { x: base.x + extra * PVP.spawnSpacing, y: base.y, z: base.z };
        this.teleport(p.actor, pos);
        p.actor.yaw = p.actor.prevYaw = Math.atan2(arena.center.x - pos.x, arena.center.z - pos.z);
        p.actor.downed = 0;
        p.actor.fighter.reset();
        p.actor.setAnim('idle', true);
        p.actor.control.allowMove = p.actor.control.allowJump = false; // pre-round freeze starts this step
      });
    }
  }

  private tickMatch(dt: number): void {
    const standing = { red: 0, blue: 0 };
    const hp = { red: 0, blue: 0 };
    const max = { red: 0, blue: 0 };
    for (const team of TEAMS) {
      for (const id of this.pvp.teams[team]) {
        const f = this.ctx.players.get(id)?.actor.fighter;
        if (!f) continue;
        if (f.alive) standing[team]++;
        hp[team] += Math.max(0, f.hp);
        max[team] += f.maxHp;
      }
    }
    const pct = { red: max.red ? hp.red / max.red : 0, blue: max.blue ? hp.blue / max.blue : 0 };
    const ev = this.pvp.run(dt, standing, pct);
    if (ev?.type === 'roundPrep') this.prepRound();
    if (this.pvp.phase !== 'running') return;

    const arena = this.arena!;
    for (const id of this.matchPlayers) {
      const a = this.ctx.players.get(id)?.actor;
      if (!a) continue;
      if (this.pvp.frozen) {
        a.control.allowMove = false;
        a.control.allowJump = false;
      }
      // Chakra dome: keep everyone inside.
      const dx = a.position.x - arena.center.x, dz = a.position.z - arena.center.z;
      const d = Math.hypot(dx, dz);
      const lim = arena.radius - a.radius - PVP.domeMargin;
      if (d > lim && d > 0) this.teleport(a, { x: arena.center.x + (dx / d) * lim, y: a.position.y, z: arena.center.z + (dz / d) * lim });
    }
  }

  private endMatch(): void {
    const sq = this.pvpSquare;
    const players = this.matchPlayers.map((id) => this.ctx.players.get(id)).filter((p): p is PlayerState => !!p);
    players.forEach((p, i) => {
      this.restoreFighter(p);
      if (sq) this.teleport(p.actor, spreadPoint(sq.returnPoint, i, players.length, MISSION_RULES.returnSpacing));
    });
    this.matchPlayers = [];
    this.savedMaxHp.clear();
    this.pvpSquare = this.arena = null;
  }

  private restoreFighter(p: PlayerState): void {
    const hp = this.savedMaxHp.get(p.id);
    if (hp !== undefined) p.actor.fighter.stats.maxHp = hp;
    this.savedMaxHp.delete(p.id);
    p.actor.team = 'player';
    p.actor.downed = 0;
    p.actor.fighter.reset();
    p.actor.setAnim('idle', true);
  }

  // ---------------------------------------------------------------- events

  private onDeath(id: number): void {
    if (this.coop.phase !== 'running') return;
    const actor = this.actorById(id);
    if (!actor || actor.kind !== 'player' || this.bledOut.has(id)) return;
    const p = this.ctx.playerOf(actor);
    if (!p || !this.coop.participants.includes(p.id)) return;
    actor.downed = MISSION_RULES.bleedTime;
    this.downed.set(id, { bleed: MISSION_RULES.bleedTime, revive: 0 });
  }

  private onDamage(e: GameEvents['damage']): void {
    const src = this.actorById(e.sourceId);
    const tgt = this.actorById(e.targetId);
    if (!tgt) return;
    if (this.coop.phase === 'running') {
      const g = tgt.groupId ? this.groups.find((x) => x.id === tgt.groupId) : undefined;
      if (g && !g.awake) this.wake(g);
      if (e.killed && g && src) {
        const p = this.ctx.playerOf(src);
        const s = p && this.coopStats.get(p.id);
        if (s) s.kills++;
      }
    }
    if (this.pvp.phase === 'running' && src) {
      const sp = this.ctx.playerOf(src), tp = this.ctx.playerOf(tgt);
      const ss = sp && this.pvpStats.get(sp.id), ts = tp && this.pvpStats.get(tp.id);
      if (!ss || !ts || ss.team === ts.team) return;
      ss.damage += e.amount;
      if (e.killed) {
        ss.kos++;
        this.killFeed.push({ killer: ss.name, victim: ts.name, time: this.ctx.time });
        if (this.killFeed.length > PVP.killFeedSize) this.killFeed.shift();
      }
    }
  }

  // ---------------------------------------------------------------- snapshot

  state(): ModeState {
    const mission = MISSIONS[this.missionIndex];
    const arenas = this.ctx.world?.arenas ?? [];
    const arena = arenas[this.arenaIndex % Math.max(1, arenas.length)];
    const c = this.coop, v = this.pvp;
    return {
      coop: {
        phase: c.phase,
        missionIndex: this.missionIndex,
        missionId: mission.id,
        title: mission.title,
        countdown: Math.max(0, c.countdown),
        timeLeft: c.phase === 'running' || c.phase === 'results' ? c.timeLeft : mission.timeLimit,
        groupsLeft: this.groups.filter((g) => !g.wiped).length,
        groupsTotal: this.groups.length,
        participants: [...c.participants],
        results: c.phase === 'results' ? { victory: c.victory, time: c.elapsed, players: [...this.coopStats.values()].map((s) => ({ ...s })) } : null,
      },
      pvp: {
        phase: v.phase,
        squareId: v.squareId,
        arenaIndex: this.arenaIndex,
        arenaId: arena?.id ?? '',
        arenaName: arena?.name ?? '',
        countdown: Math.max(0, v.countdown),
        round: v.round,
        roundTime: v.roundTime,
        roundCountdown: v.roundCountdown,
        score: { ...v.score },
        teams: { red: [...v.teams.red], blue: [...v.teams.blue] },
        blocked: v.blocked,
        killFeed: this.killFeed.map((k) => ({ ...k })),
        results: v.phase === 'results' && v.winner
          ? { winner: v.winner, rounds: { ...v.score }, players: [...this.pvpStats.values()].map((s) => ({ ...s })) }
          : null,
      },
      downed: [...this.downed].map(([actorId, d]) => ({ actorId, bleed: d.bleed, revive: d.revive })),
    };
  }

  markers(forPlayer: PlayerId): Marker[] {
    const out: Marker[] = [];
    for (const s of this.ctx.world?.squares ?? []) out.push({ kind: 'square', id: s.id, x: s.center.x, z: s.center.z, yaw: s.yaw, size: s.size, mode: s.kind });
    const me = this.ctx.players.get(forPlayer);

    if (this.coop.phase === 'running') {
      let objective: { id: number; x: number; z: number; d: number } | null = null;
      for (const g of this.groups) {
        if (g.wiped) continue;
        const living = g.members.filter((a) => a.alive && !a.removed);
        if (!living.length) continue;
        const c = this.centre(living);
        out.push({ kind: 'group', id: g.id, x: c.x, z: c.z, count: living.length, fighting: g.awake });
        const d = me ? Math.hypot(me.actor.position.x - c.x, me.actor.position.z - c.z) : 0;
        if (!objective || d < objective.d) objective = { id: g.id, x: c.x, z: c.z, d };
      }
      if (objective) out.push({ kind: 'objective', id: objective.id, x: objective.x, z: objective.z, label: MISSION_RULES.objectiveLabel });
    }
    for (const actorId of this.downed.keys()) {
      const a = this.actorById(actorId);
      if (a && a !== me?.actor) out.push({ kind: 'downed', id: actorId, x: a.position.x, z: a.position.z });
    }
    for (const p of this.ctx.players.values()) {
      if (!p.connected || p.id === forPlayer) continue;
      const a = p.actor;
      const opponent = !!me && (a.team === 'red' || a.team === 'blue') && (me.actor.team === 'red' || me.actor.team === 'blue') && a.team !== me.actor.team;
      if (opponent && !this.revealed(me!.actor, a)) continue;
      out.push({ kind: 'player', id: a.id, x: a.position.x, z: a.position.z, yaw: a.yaw, team: a.team, name: p.name });
    }
    return out;
  }

  /** PvP opponent visible on the minimap: within pvpRevealRadius or in line of sight (world geometry only). */
  private revealed(viewer: Actor, target: Actor): boolean {
    const from = viewer.chest();
    const dir = target.chest().sub(from);
    const dist = dir.length();
    if (dist <= MINIMAP.pvpRevealRadius) return true;
    const hit = this.ctx.physics.raycast(from, dir.divideScalar(dist), dist, { worldOnly: true });
    return !hit || hit.distance >= dist - 0.05;
  }

  // ---------------------------------------------------------------- helpers

  private actorById(id: number): Actor | undefined {
    return this.ctx.actors.find((a) => a.id === id);
  }

  private centre(actors: Actor[]): { x: number; z: number } {
    let x = 0, z = 0;
    for (const a of actors) { x += a.position.x; z += a.position.z; }
    return { x: x / actors.length, z: z / actors.length };
  }

  private teleport(a: Actor, p: { x: number; y: number; z: number }): void {
    this.tmp.set(p.x, p.y, p.z);
    this.ctx.physics.teleport(a.body, this.tmp);
    a.position.copy(this.tmp);
    a.prevPosition.copy(this.tmp);
    a.velocity.set(0, 0, 0);
    a.knockback.set(0, 0, 0);
  }
}
