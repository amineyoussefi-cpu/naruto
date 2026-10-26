import * as THREE from 'three';
import { COMBAT, MOVEMENT, SIM_DT } from '../config';
import { EventBus, type GameEvents } from '../core/events';
import type { CharacterId } from '../core/types';
import { Actor } from '../sim/Actor';
import { Fighter } from '../sim/combat/Fighter';
import type { PlayerState, SimContext } from '../sim/context';
import type { PhysicsWorld } from '../sim/physics/PhysicsWorld';
import { PlayerController } from '../sim/player/PlayerController';
import { ACTOR_FLAGS, emptyInput, hasBit, INPUT_ACTIONS, type ActorState, type InputAction, type PlayerInput } from '../sim/protocol';
import { InputHistory } from '../net/prediction';

/** Movement events the predictor plays locally for the own player (the server's copies are dropped). */
export const PREDICTED_EVENTS = new Set<keyof GameEvents>(['jump', 'land', 'footstep', 'climbStart', 'speedBoost']);

interface Pred { x: number; y: number; z: number; vx: number; vy: number; vz: number; grounded: boolean; climbing: boolean }

/**
 * Online client-side prediction of the own player's locomotion (run, sprint, boost, jump, climb, water): the same
 * PlayerController as the server, on the client's copy of the world colliders. Combat moves are not predicted:
 * while the server reports the actor busy (attack, dash, dodge…) or not alive, the prediction follows the server.
 * Owner: integration.
 */
export class Predictor {
  readonly events = new EventBus();
  readonly actor: Actor;
  private readonly player: PlayerState;
  private readonly controller: PlayerController;
  private readonly history = new InputHistory<Pred>((a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  private replaying = false;
  /** Server says combat owns the actor: no prediction until it is free again. */
  private following = true;
  readonly prev = new THREE.Vector3();

  constructor(private readonly physics: PhysicsWorld, id: number, name: string, character: CharacterId, feet: THREE.Vector3) {
    const body = physics.createCharacter(feet, MOVEMENT.capsuleRadius, MOVEMENT.capsuleHalfHeight);
    const height = 2 * (MOVEMENT.capsuleHalfHeight + MOVEMENT.capsuleRadius);
    this.actor = new Actor('player', 'player', name, new Fighter({ maxHp: COMBAT.player.maxHp, maxChakra: COMBAT.player.maxChakra }), body, MOVEMENT.capsuleRadius, height);
    this.actor.position.copy(feet);
    this.player = {
      id, name, character, actor: this.actor, input: emptyInput(), pressed: new Set(), lockTarget: null, qte: null,
      qteInputs: [], charge: null, rtt: 0, connected: true,
    };
    const bus = this.events;
    const ctx = { physics, events: bus, rng: Math.random } as unknown as SimContext;
    this.controller = new PlayerController(ctx, this.player);
    // Replays re-run steps already shown: their events must not play twice.
    const emit = bus.emit.bind(bus);
    bus.emit = ((type, payload) => { if (!this.replaying) emit(type, payload); }) as EventBus['emit'];
    this.controller.reset(feet);
  }

  /** Lock-on target used for strafing (the client's camera choice). */
  setLock(target: { position: THREE.Vector3; alive: boolean } | null): void {
    this.player.lockTarget = target as Actor | null;
  }

  /** One client step with this input (call once per sent input). */
  step(input: PlayerInput): void {
    this.prev.copy(this.actor.position);
    if (!this.following) this.simulate(input);
    this.history.record(input, this.state());
  }

  private simulate(input: PlayerInput): void {
    const p = this.player, a = this.actor;
    p.input = input;
    const pressed = new Set<InputAction>();
    for (const act of INPUT_ACTIONS) if (hasBit(input.pressed, act)) pressed.add(act);
    p.pressed = pressed;
    a.beginStep();
    a.animTime += SIM_DT;
    a.resetControl();
    this.controller.update(SIM_DT);
    a.onWater = a.grounded && this.physics.isWater(a.position);
  }

  private state(): Pred {
    const a = this.actor;
    return { x: a.position.x, y: a.position.y, z: a.position.z, vx: a.velocity.x, vy: a.velocity.y, vz: a.velocity.z, grounded: a.grounded, climbing: a.climbing };
  }

  private reset(s: Pred): void {
    const a = this.actor;
    a.position.set(s.x, s.y, s.z);
    a.velocity.set(s.vx, s.vy, s.vz);
    a.grounded = s.grounded;
    a.climbing = s.climbing;
    this.physics.teleport(a.body, a.position);
  }

  /** Server state of the own actor: reconcile (replaying unacked inputs) or follow it while combat owns it. */
  onServer(me: ActorState, ackSeq: number, disoriented: number): boolean {
    const a = this.actor, f = a.fighter;
    f.hp = me.hp;
    f.chakra = me.chakra;
    a.disoriented = disoriented;
    a.downed = me.flags & ACTOR_FLAGS.downed ? 1 : 0;
    a.team = me.team;
    a.wallNormal.set(me.wallNx, 0, me.wallNz);
    const server: Pred = {
      x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz,
      grounded: (me.flags & ACTOR_FLAGS.grounded) !== 0, climbing: (me.flags & ACTOR_FLAGS.climbing) !== 0,
    };
    const follow = (me.flags & ACTOR_FLAGS.busy) !== 0 || (me.hp <= 0 && !(me.flags & ACTOR_FLAGS.downed));
    if (follow || this.following) {
      this.following = follow;
      a.yaw = me.yaw;
      a.setAnim(me.anim);
      a.animTime = me.animTime;
      this.reset(server);
      this.history.clear();
      return true;
    }
    return this.history.reconcile(ackSeq, server, (i) => this.replay(i), (s) => this.reset(s));
  }

  private replay(input: PlayerInput): Pred {
    this.replaying = true;
    this.simulate(input);
    this.replaying = false;
    return this.state();
  }

  /** True while the view shows the server's state instead of the prediction. */
  get followingServer(): boolean { return this.following; }

  dispose(): void {
    this.physics.removeCharacter(this.actor.body);
  }
}
