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

function setup() {
  const p = new Actor('player', 'player', 'p', new Fighter({ maxHp: 100, maxChakra: 100 }), model, {} as CharacterBody, 0.4, 1.8);
  p.grounded = true;
  const held = new Set<Action>();
  const events = new EventBus();
  const ctx = {
    scene: new THREE.Scene(), events, actors: [p], player: p, pressed: new Set<Action>(),
    physics: { raycast: () => null },
    input: { isHeld: (a: Action) => held.has(a), moveAxes: () => ({ x: 0, y: 0 }) },
    camera: { yaw: 0, lockTarget: null },
    enemies: () => [],
  } as unknown as GameContext;
  ctx.combat = new CombatSystem(ctx);
  const pc = new PlayerCombat(ctx, p);
  const step = (press: Action[] = []) => {
    ctx.pressed = new Set(press);
    pc.update(DT);
    ctx.combat.update(DT);
  };
  return { p, pc, ctx, held, events, step };
}

describe('PlayerCombat', () => {
  it('chains a buffered 3-hit combo', () => {
    const { events, step } = setup();
    const kinds: string[] = [];
    events.on('attackStart', (e) => kinds.push(e.kind));
    step(['attack']);
    step(['attack']); // buffered during hit 1
    for (let i = 0; i < 20; i++) step();
    step(['attack']);
    for (let i = 0; i < 60; i++) step();
    expect(kinds).toEqual(['combo1', 'combo2', 'combo3']);
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
