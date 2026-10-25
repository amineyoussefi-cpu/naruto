import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Fighter } from '../../src/sim/combat/Fighter';
import { CombatSystem } from '../../src/sim/combat/CombatSystem';
import { PlayerCombat } from '../../src/sim/combat/PlayerCombat';
import { Actor } from '../../src/sim/Actor';
import { EventBus } from '../../src/core/events';
import type { Action } from '../../src/core/input';
import type { PlayerState, SimContext } from '../../src/sim/context';
import { actionBit, emptyInput, type InputAction } from '../../src/sim/protocol';
import type { CharacterBody } from '../../src/sim/physics/PhysicsWorld';
import { COMBAT } from '../../src/config/combat';
import type { CharacterId } from '../../src/core/types';

const DT = 1 / 60;

function enemy(x: number, z: number, hp = 500): Actor {
  const e = new Actor('melee', 'enemy', 'e', new Fighter({ maxHp: hp, maxChakra: 0 }), {} as CharacterBody, 0.4, 1.8);
  e.position.set(x, 0, z);
  e.grounded = true;
  return e;
}

type Ray = (o: THREE.Vector3, d: THREE.Vector3, max: number) => { distance: number } | null;

/** `walls`: raycast directions (unit x/z) reported as blocked; `raycast` overrides it. */
function setup(enemies: Actor[] = [], walls: { x: number; z: number }[] = [], opts: { character?: CharacterId; raycast?: Ray; chakra?: number } = {}) {
  const p = new Actor('player', 'player', 'p', new Fighter({ maxHp: 100, maxChakra: opts.chakra ?? 100 }), {} as CharacterBody, 0.4, 1.8);
  p.grounded = true;
  const held = new Set<Action>();
  const events = new EventBus();
  const player = {
    id: 1, name: 'p', character: opts.character ?? 'naruto', actor: p, pressed: new Set<InputAction>(), lockTarget: null,
    qte: null, qteInputs: [], charge: null, rtt: 0, connected: true,
    get input() {
      let bits = 0;
      for (const a of held) bits |= actionBit(a as InputAction);
      return { ...emptyInput(), held: bits };
    },
  } as unknown as PlayerState;
  const ctx = {
    events, actors: [p, ...enemies], players: new Map([[1, player]]), rng: Math.random,
    physics: {
      raycast: opts.raycast ?? ((_o: THREE.Vector3, d: THREE.Vector3) => (walls.some((w) => Math.abs(w.x - d.x) < 1e-6 && Math.abs(w.z - d.z) < 1e-6) ? { distance: 0.5 } : null)),
      teleport: () => {},
    },
    enemies: () => enemies.filter((e) => e.alive),
    hostiles: () => enemies.filter((e) => e.alive && !e.removed),
    rewound: (t: Actor) => t.position,
  } as unknown as SimContext;
  ctx.combat = new CombatSystem(ctx);
  const pc = new PlayerCombat(ctx, player);
  /** One sim step; the player moves by its forced velocity (stand-in for the controller). */
  const step = (press: Action[] = []) => {
    player.pressed = new Set(press as InputAction[]);
    pc.update(DT);
    const v = p.control.forcedVelocity;
    if (v) p.position.addScaledVector(v, DT);
    ctx.combat.update(DT);
  };
  return { p, pc, ctx, player, held, events, step };
}

describe('PlayerCombat', () => {
  it('mashing chains the 5-hit combo and every hit lands while the target stays stunned', () => {
    const e = enemy(0, 1.5);
    const { events, step } = setup([e]);
    const kinds: string[] = [];
    const hits: string[] = [];
    events.on('attackStart', (ev) => kinds.push(ev.kind));
    events.on('damage', (ev) => hits.push(ev.kind));
    for (let i = 0; i < 90; i++) {
      step(i % 6 === 0 ? ['attack'] : []); // mash every 0.1 s
      if (hits.length > 0 && hits.length < 5) expect(e.fighter.stunned).toBe(true);
      if (kinds.length === 5) break;
    }
    for (let i = 0; i < 30; i++) step();
    expect(kinds).toEqual(['combo1', 'combo2', 'combo3', 'combo4', 'combo5']);
    expect(hits).toEqual(['combo1', 'combo2', 'combo3', 'combo4', 'combo5']);
  });

  it('a swing damages each target once', () => {
    const e = enemy(0, 1.5);
    const { step } = setup([e]);
    step(['attack']);
    for (let i = 0; i < 30; i++) step();
    expect(e.fighter.hp).toBe(500 - COMBAT.combo[0].damage);
  });

  it('homing pulls the player toward a target in the cone and stops at range, facing it', () => {
    const e = enemy(3, 4); // 5 m away, ~37 degrees off forward
    const { p, step } = setup([e]);
    step(['attack']);
    for (let i = 0; i < 20; i++) step();
    const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
    expect(d).toBeCloseTo(COMBAT.homing.stopDistance, 1);
    expect(p.yaw).toBeCloseTo(Math.atan2(3, 4), 1);
    expect(e.fighter.hp).toBeLessThan(500);
  });

  it('homing ignores enemies behind or out of range', () => {
    const behind = enemy(0, -3);
    const far = enemy(0, 20);
    const { p, step } = setup([behind, far]);
    step(['attack']);
    step();
    expect(p.control.forcedVelocity?.length()).toBeCloseTo(COMBAT.combo[0].lunge);
  });

  it('hit 5 launches the target upward with the launched anim', () => {
    const e = enemy(0, 1.5);
    const { step, events } = setup([e]);
    let launched = false;
    events.on('damage', (ev) => { launched ||= ev.kind === 'combo5'; });
    for (let i = 0; i < 90 && !launched; i++) step(i % 6 === 0 ? ['attack'] : []);
    expect(launched).toBe(true);
    expect(e.velocity.y).toBeCloseTo(COMBAT.combo[4].launch);
    expect(e.anim).toBe('launched');
    expect(e.grounded).toBe(false);
  });

  it('chakra dash spends chakra, rushes at the target and stops at its stop distance', () => {
    const e = enemy(0, 15);
    const { p, step, events } = setup([e]);
    const dashes: boolean[] = [];
    events.on('chakraDash', (ev) => dashes.push(ev.homing));
    p.velocity.y = -5;
    step(['sprint']);
    expect(p.fighter.chakra).toBe(100 - COMBAT.chakraDash.cost);
    expect(p.velocity.y).toBe(0);
    expect(p.control.forcedVelocity?.length()).toBeCloseTo(COMBAT.chakraDash.speed);
    for (let i = 0; i < 60; i++) step();
    expect(dashes).toEqual([true]);
    expect(e.position.z - p.position.z).toBeCloseTo(COMBAT.chakraDash.stopDistance, 1);
  });

  it('attack during a chakra dash cancels into the combo', () => {
    const e = enemy(0, 15);
    const { pc, step } = setup([e]);
    step(['sprint']);
    step(['attack']);
    expect(pc.currentMove).toBe('attack');
  });

  it('Shift without a target is a free sprint (no dash, no chakra); with a target but no chakra it fails', () => {
    const { p, pc, step, events } = setup();
    let fails = 0;
    events.on('chakraFail', (ev) => { if (ev.action === 'dash') fails++; });
    step(['sprint']);
    expect(pc.currentMove).toBe('none');
    expect(p.fighter.chakra).toBe(p.fighter.maxChakra);

    const e = enemy(0, 10);
    const t = setup([e]);
    t.p.fighter.chakra = COMBAT.chakraDash.cost - 1;
    t.events.on('chakraFail', (ev) => { if (ev.action === 'dash') fails++; });
    t.step(['sprint']);
    expect(fails).toBe(1);
    expect(t.pc.currentMove).toBe('none');
  });

  it('substitution spends the gauge, teleports behind the attacker facing it and clears stun', () => {
    const e = enemy(0, 2);
    const { p, step, ctx, events } = setup([e]);
    let sub: { from: { z: number }; to: { x: number; z: number } } | null = null;
    events.on('substitution', (ev) => { sub = ev; });
    ctx.combat.dealDamage(e, p, 5, 2, 'enemyMelee', p.chest());
    expect(p.fighter.stunned).toBe(true);
    step(['dodge']);
    expect(sub).not.toBeNull();
    expect(p.fighter.substitution).toBeCloseTo(COMBAT.substitution.max - COMBAT.substitution.cost, 0);
    expect(p.fighter.stunned).toBe(false);
    expect(p.fighter.invulnerable).toBe(true);
    expect(p.anim).toBe('substitution');
    expect(p.position.z).toBeCloseTo(2 + COMBAT.substitution.distanceBehind);
    expect(Math.cos(p.yaw)).toBeCloseTo(-1); // faces the attacker (-Z)
  });

  it('substitution tries the side when the spot behind is blocked', () => {
    const e = enemy(0, 2);
    const { p, step, ctx } = setup([e], [{ x: 0, z: 1 }]);
    ctx.combat.dealDamage(e, p, 5, 2, 'enemyMelee', p.chest());
    step(['dodge']);
    expect(Math.abs(p.position.x)).toBeCloseTo(COMBAT.substitution.distanceBehind);
    expect(p.position.z).toBeCloseTo(2);
  });

  it('substitution is refused with a low gauge, and C is a normal dodge when not stunned', () => {
    const e = enemy(0, 2);
    const { p, pc, step, ctx } = setup([e]);
    p.fighter.substitution = COMBAT.substitution.cost - 1;
    ctx.combat.dealDamage(e, p, 5, 2, 'enemyMelee', p.chest());
    step(['dodge']);
    expect(p.fighter.stunned).toBe(true);
    expect(p.position.z).toBe(0);
    for (let i = 0; i < 60; i++) step();
    p.fighter.substitution = COMBAT.substitution.max;
    step(['dodge']);
    expect(pc.currentMove).toBe('dodge');
    expect(p.fighter.substitution).toBeCloseTo(COMBAT.substitution.max);
  });

  it('a special pressed mid-combo is buffered and fires instead of being dropped', () => {
    const { p, events, step } = setup();
    const kinds: string[] = [];
    events.on('attackStart', (e) => kinds.push(e.kind));
    step(['attack']);
    step(['special']); // during hit 1 windup
    for (let i = 0; i < 40; i++) step();
    expect(kinds).toEqual(['combo1', 'special']);
    expect(p.fighter.chakra).toBeLessThan(100);
  });

  it('special without enough chakra emits chakraFail and does nothing', () => {
    const { p, pc, events, step } = setup();
    let fails = 0;
    events.on('chakraFail', () => fails++);
    p.fighter.chakra = COMBAT.special.chakraCost - 1;
    step(['special']);
    expect(fails).toBe(1);
    expect(pc.currentMove).toBe('none');
  });

  it('guard sets guarding and slows movement; concentration locks movement and is interrupted by hits', () => {
    const { p, held, events, step, ctx } = setup();
    held.add('guard');
    step();
    expect(p.fighter.guarding).toBe(true);
    expect(p.control.moveFactor).toBe(COMBAT.guardMoveFactor);
    held.clear();
    held.add('concentrate');
    let starts = 0;
    events.on('concentrateStart', () => starts++);
    step();
    step();
    expect(starts).toBe(1);
    expect(p.control.allowMove).toBe(false);
    expect(p.fighter.concentrating).toBe(true);
    const e = new Actor('melee', 'enemy', 'e', new Fighter({ maxHp: 10, maxChakra: 0 }), {} as CharacterBody, 0.4, 1.8);
    ctx.combat.dealDamage(e, p, 1, 0, 'enemyMelee', p.chest());
    for (let i = 0; i < 60; i++) step(); // still holding: stays interrupted
    expect(p.fighter.concentrating).toBe(false);
    held.clear();
    step();
    held.add('concentrate');
    step();
    expect(p.fighter.concentrating).toBe(true);
  });

  it('dodge grants invulnerability and starts its cooldown', () => {
    const { p, step } = setup();
    step(['dodge']);
    expect(p.fighter.invulnerable).toBe(true);
    expect(p.fighter.cooldownReady('dodge')).toBe(false);
    expect(p.control.forcedVelocity?.length()).toBeCloseTo(COMBAT.dodge.speed);
  });
});

describe('PlayerCombat v4 techniques', () => {
  const hold = (t: ReturnType<typeof setup>, steps: number) => {
    t.held.add('special');
    t.step(['special']);
    for (let i = 1; i < steps; i++) t.step();
    t.held.delete('special');
  };

  it('Rasengan tap releases at once at minPower; damage and chakra scale correctly', () => {
    const e = enemy(0, 2);
    const t = setup([e]);
    const powers: number[] = [];
    t.events.on('chargeRelease', (ev) => powers.push(ev.power));
    t.step(['special']); // not held: instant release
    for (let i = 0; i < 40; i++) t.step();
    expect(powers).toEqual([COMBAT.special.minPower]);
    expect(e.fighter.hp).toBeCloseTo(500 - COMBAT.special.damage * COMBAT.special.minPower);
    expect(t.p.fighter.chakra).toBeCloseTo(100 - COMBAT.special.chakraCost, 0);
  });

  it('Rasengan held past full charge caps at power 1, hits once, and has no cooldown', () => {
    const e = enemy(0, 2);
    const t = setup([e], [], { chakra: 300 });
    const powers: number[] = [];
    let hits = 0;
    t.events.on('chargeRelease', (ev) => powers.push(ev.power));
    t.events.on('damage', () => hits++);
    hold(t, Math.round(COMBAT.special.fullChargeTime * 60) + 30);
    expect(t.pc.charge?.level).toBe(1);
    for (let i = 0; i < 40; i++) t.step();
    expect(powers).toEqual([1]);
    expect(hits).toBe(1);
    expect(e.fighter.hp).toBeCloseTo(500 - COMBAT.special.damage);
    expect(t.p.fighter.cooldownReady('special')).toBe(true);
    t.step(['special']);
    expect(powers).toHaveLength(2);
  });

  it('a hit during the charge cancels it for free; charge getter reports progress', () => {
    const t = setup();
    t.held.add('special');
    t.step(['special']);
    for (let i = 0; i < 44; i++) t.step();
    expect(t.pc.charge?.technique).toBe('rasengan');
    expect(t.pc.charge?.level).toBeCloseTo(0.5, 1);
    const e = enemy(0, 5);
    t.ctx.combat.dealDamage(e, t.p, 1, 0, 'enemyMelee', t.p.chest());
    t.step();
    expect(t.pc.charge).toBeNull();
    expect(t.p.fighter.chakra).toBe(100);
  });

  it('Chidori pierces: every enemy on the path is hit exactly once, others are untouched', () => {
    const a = enemy(0, 3), b = enemy(0.5, 7), off = enemy(4, 5);
    const t = setup([a, b, off], [], { character: 'kakashi' });
    const hits = new Map<number, number>();
    t.events.on('damage', (ev) => hits.set(ev.targetId, (hits.get(ev.targetId) ?? 0) + 1));
    hold(t, 100);
    for (let i = 0; i < 60; i++) t.step();
    expect(hits.get(a.id)).toBe(1);
    expect(hits.get(b.id)).toBe(1);
    expect(hits.has(off.id)).toBe(false);
    expect(t.p.position.z).toBeCloseTo(COMBAT.chidori.dashDistance, 1); // passed through
    expect(a.fighter.hp).toBeCloseTo(500 - COMBAT.chidori.damage);
  });

  it('Chidori stops before a wall', () => {
    const behind = enemy(0, 7);
    const ray: Ray = (o, d, max) => (d.z > 0.5 && 5 - o.z <= max ? { distance: 5 - o.z } : null);
    const t = setup([behind], [], { character: 'kakashi', raycast: ray });
    hold(t, 100);
    for (let i = 0; i < 60; i++) t.step();
    expect(t.p.position.z).toBeLessThanOrEqual(5 - t.p.radius);
    expect(t.p.position.z).toBeGreaterThan(4);
    expect(behind.fighter.hp).toBe(500);
    expect(t.pc.currentMove).toBe('none');
  });

  it('Sharingan disorients enemies within radius only and interrupts their attacks', () => {
    const near = enemy(0, 5), far = enemy(0, COMBAT.sharingan.radius + 3);
    const t = setup([near, far], [], { character: 'sasuke' });
    let targets: number[] = [];
    t.events.on('genjutsu', (ev) => { targets = ev.targets; });
    t.ctx.combat.spawnHitbox({ owner: near, kind: 'enemyMelee', forwardOffset: 1, heightOffset: 1, radius: 0.5, duration: 5, damage: 1, knockback: 0 });
    t.step(['special']);
    for (let i = 0; i < Math.ceil(COMBAT.sharingan.castTime * 60) + 2; i++) t.step();
    expect(near.disoriented).toBe(COMBAT.sharingan.duration);
    expect(far.disoriented).toBe(0);
    expect(targets).toEqual([near.id]);
    expect(t.ctx.combat.counts.hitboxes).toBe(0);
    expect(t.p.fighter.chakra).toBeCloseTo(100 - COMBAT.sharingan.chakraCost, 0);
    expect(t.p.fighter.cooldownReady('special')).toBe(false);
  });

  it('grab: six correct arrows strike, finish with a launch, release and clear the qte after the outro', () => {
    const e = enemy(0, 1.5);
    const t = setup([e]);
    const ends: string[] = [];
    t.events.on('grabEnd', (ev) => ends.push(`${ev.result}:${ev.hits}`));
    t.step(['grab']);
    const q = t.player.qte!;
    expect(q.arrows).toHaveLength(COMBAT.grab.arrows);
    expect(e.grabbedBy).toBe(t.p.id);
    expect(e.anim).toBe('grabbed');
    expect(t.p.fighter.invulnerable).toBe(true);
    for (const dir of q.arrows) {
      t.player.qteInputs.push(dir);
      t.step();
    }
    expect(ends).toEqual([`complete:${COMBAT.grab.arrows}`]);
    expect(q.done).toBe(true);
    expect(e.grabbedBy).toBeNull();
    expect(e.anim).toBe('launched');
    const g = COMBAT.grab;
    let strikes = 0;
    for (let i = 0; i < g.arrows; i++) strikes += g.damagePerHit * (1 + g.damageRamp * i);
    expect(e.fighter.hp).toBeCloseTo(500 - strikes - g.finisherDamage);
    for (let i = 0; i < Math.ceil(g.outro * 60) + 1; i++) t.step();
    expect(t.player.qte).toBeNull();
  });

  it('grab: strikes never kill a weak enemy, so the sequence completes and the finisher gets the kill', () => {
    const e = enemy(0, 1.5);
    const t = setup([e]);
    e.fighter.hp = 20; // less than the six strikes combined
    const ends: string[] = [];
    t.events.on('grabEnd', (ev) => ends.push(ev.result));
    t.step(['grab']);
    for (const dir of t.player.qte!.arrows) { t.player.qteInputs.push(dir); t.step(); }
    expect(ends).toEqual(['complete']);
    expect(e.alive).toBe(false);
  });

  it('grab: a wrong arrow ends with miss, waiting ends with timeout, no target whiffs', () => {
    const e = enemy(0, 1.5);
    const t = setup([e]);
    const ends: string[] = [];
    t.events.on('grabEnd', (ev) => ends.push(ev.result));
    t.step(['grab']);
    const wrong = t.player.qte!.arrows[0] === 'up' ? 'down' : 'up';
    t.player.qteInputs.push(wrong);
    t.step();
    expect(ends).toEqual(['miss']);
    expect(e.grabbedBy).toBeNull();
    for (let i = 0; i < 120; i++) t.step();
    t.step(['grab']);
    for (let i = 0; i < Math.ceil(COMBAT.grab.time * 60) + 1; i++) t.step();
    expect(ends).toEqual(['miss', 'timeout']);

    const w = setup([enemy(0, 10)]);
    w.step(['grab']);
    expect(w.player.qte).toBeNull();
    expect(w.p.anim).toBe('grabHold');
  });

  it('grab cleanup: target death, reset() and CombatSystem.clear() release the victim', () => {
    const e = enemy(0, 1.5);
    const t = setup([e]);
    const ends: string[] = [];
    t.events.on('grabEnd', (ev) => ends.push(ev.result));
    t.step(['grab']);
    e.fighter.hp = 0;
    t.step();
    expect(ends).toEqual(['interrupted']);
    expect(e.grabbedBy).toBeNull();

    const e2 = enemy(0, 1.5);
    const r = setup([e2]);
    r.step(['grab']);
    r.pc.reset();
    expect(e2.grabbedBy).toBeNull();
    expect(r.player.qte).toBeNull();

    const e3 = enemy(0, 1.5);
    const c = setup([e3]);
    const cEnds: string[] = [];
    c.events.on('grabEnd', (ev) => cEnds.push(ev.result));
    c.step(['grab']);
    c.ctx.combat.clear();
    expect(cEnds).toEqual(['interrupted']);
    expect(e3.grabbedBy).toBeNull();
    expect(c.player.qte).toBeNull();
    c.step();
    expect(c.pc.currentMove).toBe('none');
  });
});
