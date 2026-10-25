import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Fighter } from '../../src/combat/Fighter';
import { CombatSystem, sphereHitsActor } from '../../src/combat/CombatSystem';
import { Actor } from '../../src/game/Actor';
import { EventBus, type GameEvents } from '../../src/core/events';
import type { GameContext } from '../../src/game/context';
import type { NinjaModel } from '../../src/render/NinjaModel';
import type { CharacterBody } from '../../src/physics/PhysicsWorld';
import { COMBAT } from '../../src/config/combat';
import { ENEMIES } from '../../src/config/enemies';

const DT = 1 / 60;
const fakeModel = () => ({ flash() {}, setAura() {}, setGuard() {}, setHandOrb() {} }) as unknown as NinjaModel;

function actor(kind: 'player' | 'melee', x: number, z: number, hp = 100): Actor {
  const a = new Actor(kind, kind === 'player' ? 'player' : 'enemy', kind, new Fighter({ maxHp: hp, maxChakra: 100 }), fakeModel(), {} as CharacterBody, 0.4, 1.8);
  a.position.set(x, 0, z);
  return a;
}

function setup(actors: Actor[]) {
  const events = new EventBus();
  const log: { type: keyof GameEvents; e: unknown }[] = [];
  for (const t of ['damage', 'death', 'hitStop', 'cameraShake', 'projectileHit'] as const) events.on(t, (e) => log.push({ type: t, e }));
  const ctx = {
    scene: new THREE.Scene(), events, actors, player: actors[0],
    physics: { raycast: () => null },
  } as unknown as GameContext;
  return { combat: new CombatSystem(ctx), log, ctx };
}

describe('sphereHitsActor', () => {
  it('needs horizontal reach and vertical overlap', () => {
    const a = actor('melee', 0, 0);
    expect(sphereHitsActor(new THREE.Vector3(1.2, 1, 0), 0.9, a)).toBe(true);
    expect(sphereHitsActor(new THREE.Vector3(1.4, 1, 0), 0.9, a)).toBe(false);
    expect(sphereHitsActor(new THREE.Vector3(0, 3, 0), 0.9, a)).toBe(false);
  });
});

describe('CombatSystem hitboxes', () => {
  it('a hitbox damages each target at most once and never its own team', () => {
    const p = actor('player', 0, 0);
    const e1 = actor('melee', 0, 1.5);
    const e2 = actor('melee', 0.5, 1.5);
    const { combat, log } = setup([p, e1, e2]);
    combat.spawnHitbox({ owner: p, kind: 'combo1', forwardOffset: 1.5, heightOffset: 1, radius: 1, duration: 0.5, damage: 10, knockback: 2 });
    for (let i = 0; i < 40; i++) combat.update(DT);
    expect(e1.fighter.hp).toBe(90);
    expect(e2.fighter.hp).toBe(90);
    expect(p.fighter.hp).toBe(100);
    expect(log.filter((l) => l.type === 'damage')).toHaveLength(2);
    expect(combat.counts.hitboxes).toBe(0);
  });

  it('a hitbox dies when its owner is stunned', () => {
    const p = actor('player', 0, 0);
    const e = actor('melee', 0, 5);
    const { combat } = setup([p, e]);
    combat.spawnHitbox({ owner: e, kind: 'enemyMelee', forwardOffset: 1, heightOffset: 1, radius: 1, duration: 1, damage: 10, knockback: 2 });
    combat.update(DT);
    e.fighter.setStun(0.5);
    combat.update(DT);
    expect(combat.counts.hitboxes).toBe(0);
  });
});

describe('CombatSystem.dealDamage', () => {
  it('stuns, knocks back and emits player hit feedback', () => {
    const p = actor('player', 0, 0);
    const e = actor('melee', 0, 2);
    const { combat, log } = setup([p, e]);
    combat.dealDamage(p, e, 10, 4, 'combo1', e.chest());
    expect(e.fighter.stunRemaining).toBeCloseTo(ENEMIES.hitStun);
    expect(e.anim).toBe('hit');
    expect(e.knockback.z).toBeCloseTo(4);
    expect(log.map((l) => l.type)).toEqual(['damage', 'hitStop', 'cameraShake']);
  });

  it('guard reduces knockback and does not stun', () => {
    const p = actor('player', 0, 0);
    const e = actor('melee', 0, 2);
    const { combat } = setup([p, e]);
    p.fighter.guarding = true;
    combat.dealDamage(e, p, 20, 4, 'enemyMelee', p.chest());
    expect(p.fighter.hp).toBe(100 - 20 * COMBAT.guardDamageFactor);
    expect(p.fighter.stunned).toBe(false);
    expect(p.knockback.length()).toBeCloseTo(4 * COMBAT.guardKnockbackFactor);
  });

  it('kills emit death and set the dead anim; invulnerable targets ignore hits', () => {
    const p = actor('player', 0, 0);
    const e = actor('melee', 0, 2, 10);
    const { combat, log } = setup([p, e]);
    p.fighter.setInvulnerable(1);
    combat.dealDamage(e, p, 20, 4, 'enemyMelee', p.chest());
    expect(log).toHaveLength(0);
    combat.dealDamage(p, e, 20, 4, 'combo3', e.chest());
    expect(e.alive).toBe(false);
    expect(e.anim).toBe('dead');
    expect(log.some((l) => l.type === 'death')).toBe(true);
  });
});

describe('CombatSystem projectiles', () => {
  it('flies straight, hits the first enemy once, then is removed', () => {
    const p = actor('player', 0, 0);
    const e = actor('melee', 0, 10);
    const { combat, log, ctx } = setup([p, e]);
    combat.spawnProjectile({ owner: p, kind: 'kunai', origin: new THREE.Vector3(0, 1, 0.5), direction: new THREE.Vector3(0, 0, 1), speed: 30, damage: 8, radius: 0.25, maxRange: 40, knockback: 1, visual: 'kunai' });
    expect(ctx.scene.children).toHaveLength(1);
    for (let i = 0; i < 60; i++) combat.update(DT);
    expect(e.fighter.hp).toBe(92);
    expect(combat.counts.projectiles).toBe(0);
    expect(ctx.scene.children).toHaveLength(0);
    expect(log.some((l) => l.type === 'projectileHit')).toBe(true);
  });
});
