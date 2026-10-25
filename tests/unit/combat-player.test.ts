import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Fighter } from '../../src/combat/Fighter';
import { CombatSystem } from '../../src/combat/CombatSystem';
import { PlayerCombat } from '../../src/combat/PlayerCombat';
import { Actor } from '../../src/game/Actor';
import { EventBus } from '../../src/core/events';
import type { Action } from '../../src/core/input';
import type { GameContext } from '../../src/game/context';
import type { NinjaModel } from '../../src/render/NinjaModel';
import type { CharacterBody } from '../../src/physics/PhysicsWorld';
import { COMBAT } from '../../src/config/combat';

const DT = 1 / 60;
const model = { flash() {}, setAura() {}, setGuard() {}, setHandOrb() {} } as unknown as NinjaModel;

function enemy(x: number, z: number, hp = 500): Actor {
  const e = new Actor('melee', 'enemy', 'e', new Fighter({ maxHp: hp, maxChakra: 0 }), model, {} as CharacterBody, 0.4, 1.8);
  e.position.set(x, 0, z);
  e.grounded = true;
  return e;
}

/** `walls`: raycast directions (unit x/z) reported as blocked. */
function setup(enemies: Actor[] = [], walls: { x: number; z: number }[] = []) {
  const p = new Actor('player', 'player', 'p', new Fighter({ maxHp: 100, maxChakra: 100 }), model, {} as CharacterBody, 0.4, 1.8);
  p.grounded = true;
  const held = new Set<Action>();
  const events = new EventBus();
  const ctx = {
    scene: new THREE.Scene(), events, actors: [p, ...enemies], player: p, pressed: new Set<Action>(),
    physics: {
      raycast: (_o: THREE.Vector3, d: THREE.Vector3) => (walls.some((w) => Math.abs(w.x - d.x) < 1e-6 && Math.abs(w.z - d.z) < 1e-6) ? { distance: 0.5 } : null),
      teleport: () => {},
    },
    input: { isHeld: (a: Action) => held.has(a), moveAxes: () => ({ x: 0, y: 0 }) },
    camera: { yaw: 0, lockTarget: null },
    enemies: () => enemies.filter((e) => e.alive),
  } as unknown as GameContext;
  ctx.combat = new CombatSystem(ctx);
  const pc = new PlayerCombat(ctx, p);
  /** One sim step; the player moves by its forced velocity (stand-in for the controller). */
  const step = (press: Action[] = []) => {
    ctx.pressed = new Set(press);
    pc.update(DT);
    const v = p.control.forcedVelocity;
    if (v) p.position.addScaledVector(v, DT);
    ctx.combat.update(DT);
  };
  return { p, pc, ctx, held, events, step };
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
    const e = new Actor('melee', 'enemy', 'e', new Fighter({ maxHp: 10, maxChakra: 0 }), model, {} as CharacterBody, 0.4, 1.8);
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
