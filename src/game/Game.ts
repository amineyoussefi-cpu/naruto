import * as THREE from 'three';
import { COMBAT, MOVEMENT, SIM_DT, DEFAULT_SETTINGS, type Settings } from '../config';
import { EventBus } from '../core/events';
import { FixedStepper } from '../core/loop';
import { InputManager, KEY_LABELS, type Action } from '../core/input';
import type { CharacterId, GameState, HudData, QteDir } from '../core/types';
import { PhysicsWorld } from '../sim/physics/PhysicsWorld';
import { CHARACTERS } from '../config/characters';
import { hitFeedback } from '../sim/combat/CombatSystem';
import { ACTOR_FLAGS, actionBit, INPUT_ACTIONS, type ActorInfo, type ActorState, type DebugMsg, type PlayerInput, type ServerMsg, type Snapshot } from '../sim/protocol';
import type { Connection } from '../net/connection';
import { LocalHost } from '../net/LocalHost';
import { NetClient } from '../net/NetClient';
import { SnapshotBuffer } from '../net/interpolation';
import { CorrectionSmoother } from '../net/prediction';
import { Predictor, PREDICTED_EVENTS } from './Predictor';
import { CameraRig, type CameraHost } from '../camera/CameraRig';
import { Effects } from '../render/Effects';
import { buildWorldView, type WorldView } from '../world/WorldView';
import { generateWorld } from '../sim/world/generate';
import { buildWorldColliders } from '../sim/world/colliders';
import type { WorldData } from '../sim/world/types';
import type { ModeState, Marker } from '../sim/missions/types';
import type { PlayerSummary } from '../sim/protocol';
import { AudioSystem } from '../audio/AudioSystem';
import { PostFX } from '../render/PostFX';
import { ModeVisuals } from '../render/ModeVisuals';
import { ActorView, modelFor } from './ActorView';

/** Keys that answer the grab sequence arrows (physical codes: WASD on QWERTY = ZQSD on AZERTY). */
const QTE_KEYS: Record<string, QteDir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};

/** Public surface the UI is allowed to use. */
export interface GameApi {
  readonly state: GameState;
  readonly events: EventBus;
  readonly settings: Settings;
  readonly layout: 'qwerty' | 'azerty';
  readonly keyLabels: (typeof KEY_LABELS)['qwerty'];
  start(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  quitToMenu(): void;
  applySettings(s: Settings): void;
  getHudData(): HudData;
  /** Unlock audio and capture the mouse; call from a user gesture. */
  userGesture(): void;
  /** Menu button feedback sound (also unlocks audio). */
  uiClick(): void;
  /** Selected playable character; change it from the menu (applies to the next run). */
  readonly character: CharacterId;
  selectCharacter(id: CharacterId): void;
  /** Grab sequence arrow click (UI). Ignored unless a sequence is waiting for input. */
  qteInput(dir: QteDir): void;
  /** True while connected to a host server (no real pause). */
  readonly online: boolean;
  /** Joins the host server that served this page (or `url`); rejects with a French message. */
  joinOnline(name: string, url?: string): Promise<void>;
  /** Leaves the server and returns to solo. */
  leaveOnline(): void;
}

/**
 * The client: renderer, camera, models, effects, audio and input capture. It never decides game state:
 * it sends one `PlayerInput` per step to its `Connection` and draws the snapshots it gets back. Owner: integration.
 */
export class Game implements GameApi, CameraHost {
  readonly events = new EventBus();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: InputManager;
  readonly settings: Settings = { ...DEFAULT_SETTINGS };
  /** Client copy of the world colliders (camera collision, prediction); rebuilt when the world seed changes. */
  physics!: PhysicsWorld;
  /** The world of the current session (generated locally from the host's seed). */
  world: WorldData | null = null;
  private worldSeed: number | null = null;
  private worldView: WorldView | null = null;
  detectedLayout: 'qwerty' | 'azerty' = 'qwerty';
  state: GameState = 'menu';

  private readonly stepper = new FixedStepper(SIM_DT);
  private readonly camera = new CameraRig();
  private readonly fx: Effects;
  private readonly audio: AudioSystem;
  private readonly postfx: PostFX;
  private readonly modeVisuals = new ModeVisuals(this.scene);
  private conn: Connection;
  /** In-process host kept for solo while playing online. */
  private readonly solo: LocalHost;
  /** Online only: interpolation of remote actors and prediction of the own player. */
  private buffer: SnapshotBuffer | null = null;
  private predictor: Predictor | null = null;
  private readonly smoother = new CorrectionSmoother();
  private myInfo: ActorInfo | null = null;
  private readonly viewMap = new Map<number, ActorView>();
  private viewList: ActorView[] = [];
  private myActorId = 0;
  /** Latest snapshot and the one before (solo renders between them with the stepper alpha). */
  private snap: Snapshot | null = null;
  private prevSnap: Snapshot | null = null;
  private prevStates = new Map<number, ActorState>();
  private seq = 0;
  private qteQueue: QteDir[] = [];
  private hitStop = 0;
  private lastStateChange = 0;
  private fps = 60;
  private projected = new THREE.Vector3();
  /** True while the grab sequence owns the (unlocked) cursor. */
  private qteCursor = false;

  static async create(canvasHost: HTMLElement): Promise<Game> {
    await PhysicsWorld.create(); // loads Rapier once; worlds are created synchronously afterwards
    const conn = await LocalHost.create('Vous', DEFAULT_SETTINGS.character);
    return new Game(canvasHost, conn);
  }

  private constructor(host: HTMLElement, conn: LocalHost) {
    this.conn = this.solo = conn;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps hues and saturation (ACES would wash out the cel-shaded palette).
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.domElement.id = 'game-canvas';
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    this.input = new InputManager(this.renderer.domElement);

    // Client copy of the world: meshes plus colliders for camera collision (and prediction online).
    this.fx = new Effects(this.scene, this.events, (id) => this.viewMap.get(id));
    this.audio = new AudioSystem(this.events);
    this.camera.attach(this);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera.camera);

    this.input.onPause = () => {
      if (performance.now() - this.lastStateChange < 250) return;
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    };
    document.addEventListener('pointerlockchange', () => {
      // The grab sequence frees the cursor on purpose (clickable arrows): not a pause.
      if (!this.input.pointerLocked && this.state === 'playing' && !this.qteCursor) this.pause();
    });
    window.addEventListener('blur', () => { if (this.state === 'playing') this.pause(); });
    // Grab sequence: arrow keys (and the physical movement keys ZQSD / WASD) answer the arrows too.
    window.addEventListener('keydown', (e) => {
      const dir = QTE_KEYS[e.code];
      if (!dir || e.repeat || !this.qteCursor) return;
      e.preventDefault();
      this.qteInput(dir);
    });
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.pointerLocked && !this.qteCursor) this.input.requestPointerLock();
    });
    this.events.on('cameraShake', (e) => this.camera.shake(e.intensity, e.duration));
    this.events.on('hitStop', (e) => { if (!this.conn.online) this.hitStop = Math.max(this.hitStop, e.duration); });
    this.events.on('damage', (e) => {
      const v = this.viewMap.get(e.targetId);
      if (v && !e.blocked) v.model.flash(COMBAT.hitFlash);
      const fb = hitFeedback(e, this.myActorId);
      if (!fb) return;
      this.events.emit('hitStop', { duration: fb.hitStop });
      this.events.emit('cameraShake', fb.shake);
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.processMessages();
  }

  // ------------------------------------------------------------------ CameraHost

  me(): ActorView | null { return this.viewMap.get(this.myActorId) ?? null; }
  views(): ActorView[] { return this.viewList; }
  hostiles(): ActorView[] {
    const me = this.me();
    return me ? this.viewList.filter((v) => v.team !== me.team && v.alive && !v.removed) : [];
  }

  get layout(): 'qwerty' | 'azerty' {
    return this.settings.layout === 'auto' ? this.detectedLayout : this.settings.layout;
  }

  get keyLabels() {
    return KEY_LABELS[this.layout];
  }

  // ------------------------------------------------------------------ messages / snapshots

  private processMessages(): void {
    for (const m of this.conn.poll()) this.handle(m);
  }

  private handle(m: ServerMsg): void {
    if (m.t === 'welcome') {
      this.useWorld(m.seed);
      this.hostFlag = m.isHost;
      for (const id of [...this.viewMap.keys()]) this.removeView(id);
      this.myActorId = m.actorId;
      for (const info of m.actors) this.addView(info);
      this.myInfo = m.actors.find((a) => a.id === m.actorId) ?? null;
    } else if (m.t === 'actors') {
      for (const info of m.add) this.addView(info);
      for (const id of m.remove) this.removeView(id);
    } else if (m.t === 'snapshot') {
      this.applySnapshot(m.snap);
    }
  }

  private addView(info: ActorInfo): void {
    const old = this.viewMap.get(info.id);
    if (old) {
      if (old.look !== info.look) {
        old.look = info.look;
        old.setModel(modelFor(info));
        this.scene.add(old.model.root);
      }
      return;
    }
    const v = new ActorView(info);
    this.scene.add(v.model.root);
    this.viewMap.set(info.id, v);
    this.viewList = [...this.viewMap.values()];
  }

  private removeView(id: number): void {
    const v = this.viewMap.get(id);
    if (!v) return;
    v.dispose();
    this.viewMap.delete(id);
    this.viewList = [...this.viewMap.values()];
    if (this.camera.lockTarget === v) this.camera.lockTarget = null;
  }

  private applySnapshot(s: Snapshot): void {
    if (this.conn.online) return this.applyOnline(s);
    this.prevSnap = this.snap;
    this.prevStates.clear();
    if (this.prevSnap) for (const a of this.prevSnap.actors) this.prevStates.set(a.id, a);
    this.snap = s;
    for (const a of s.actors) this.viewMap.get(a.id)?.apply(a, a, 1);
    for (const e of s.events) this.events.emit(e.type, e.payload as never);
    this.syncQteCursor();
  }

  /** Online: remote actors are interpolated from the buffer; the own actor is predicted and reconciled. */
  private applyOnline(s: Snapshot): void {
    this.snap = s;
    this.buffer?.push(s, performance.now());
    const me = s.actors.find((a) => a.id === this.myActorId);
    if (me && !this.predictor && this.myInfo) {
      this.predictor = new Predictor(this.physics, me.id, this.myInfo.name, this.settings.character, new THREE.Vector3(me.x, me.y, me.z));
      for (const type of PREDICTED_EVENTS) this.predictor.events.on(type, (p) => this.events.emit(type, p as never));
    }
    if (me && this.predictor && s.you) {
      const before = this.predictor.actor.position.clone();
      if (this.predictor.onServer(me, s.you.ackSeq, s.you.disoriented)) this.smoother.correct(before, this.predictor.actor.position);
    }
    for (const e of s.events) {
      // Own movement sounds/FX come from the prediction, without the round trip.
      if (PREDICTED_EVENTS.has(e.type) && (e.payload as { id?: number }).id === this.myActorId && this.predictor && !this.predictor.followingServer) continue;
      this.events.emit(e.type, e.payload as never);
    }
    this.syncQteCursor();
  }

  private interpolateOnline(alpha: number, frameDt: number): void {
    const sample = this.buffer?.sample(performance.now());
    if (sample) {
      const from = new Map(sample.a.actors.map((a) => [a.id, a]));
      for (const b of sample.b.actors) {
        if (b.id === this.myActorId) continue;
        this.viewMap.get(b.id)?.apply(from.get(b.id) ?? b, b, sample.t);
      }
    }
    const v = this.me(), p = this.predictor, server = this.snap?.actors.find((a) => a.id === this.myActorId);
    if (!v || !p || !server) return;
    const a = p.actor;
    const pos = new THREE.Vector3().lerpVectors(p.prev, a.position, alpha);
    const own: ActorState = p.followingServer ? server : {
      ...server, x: pos.x, y: pos.y, z: pos.z, vx: a.velocity.x, vy: a.velocity.y, vz: a.velocity.z, yaw: a.yaw,
      anim: server.flags & ACTOR_FLAGS.busy || server.hp <= 0 ? server.anim : a.anim, animTime: a.animTime,
      flags: (server.flags & ~(ACTOR_FLAGS.climbing | ACTOR_FLAGS.grounded | ACTOR_FLAGS.onWater))
        | (a.climbing ? ACTOR_FLAGS.climbing : 0) | (a.grounded ? ACTOR_FLAGS.grounded : 0) | (a.onWater ? ACTOR_FLAGS.onWater : 0),
      wallNx: a.wallNormal.x, wallNz: a.wallNormal.z,
    };
    v.apply(own, own, 1);
    const o = this.smoother.update(frameDt * 1000);
    v.offset.set(o.x, o.y, o.z);
  }

  /** Views between the previous and the latest snapshot. */
  private interpolate(alpha: number): void {
    if (!this.snap) return;
    for (const a of this.snap.actors) this.viewMap.get(a.id)?.apply(this.prevStates.get(a.id) ?? a, a, alpha);
  }

  // ------------------------------------------------------------------ input

  /** One client step of local input as a PlayerInput (camera lock-on is chosen here, validated by the sim). */
  private buildInput(): PlayerInput {
    const pressed = this.input.consumePressed();
    const lockPressed = new Set<Action>(pressed);
    this.camera.updateSim(lockPressed);
    let held = 0, press = 0;
    for (const a of INPUT_ACTIONS) {
      if (this.input.isHeld(a)) held |= actionBit(a);
      if (pressed.has(a)) press |= actionBit(a);
    }
    const axes = this.input.moveAxes();
    const dir = this.camera.camera.getWorldDirection(new THREE.Vector3());
    return {
      seq: ++this.seq, moveX: axes.x, moveZ: axes.y, camYaw: this.camera.yaw, camPitch: this.camera.pitch,
      held, pressed: press, aimDir: { x: dir.x, y: dir.y, z: dir.z }, lockId: this.camera.lockTarget?.id ?? 0,
      qte: this.qteQueue.shift() ?? null,
    };
  }

  // ------------------------------------------------------------------ state machine

  private setState(s: GameState): void {
    if (s === this.state) return;
    const prev = this.state;
    this.state = s;
    this.lastStateChange = performance.now();
    this.input.enabled = s === 'playing';
    this.input.releaseAll();
    this.stepper.reset();
    this.audio.setPaused(s !== 'playing');
    if (s !== 'playing') this.input.exitPointerLock();
    this.events.emit('stateChange', { state: s, prev });
  }

  userGesture(): void {
    this.audio.unlock();
    this.input.requestPointerLock();
  }

  get character(): CharacterId {
    return this.settings.character;
  }

  /** Changes the player's character; only between runs (menu / end screens) so a fight never changes character. */
  selectCharacter(id: CharacterId): void {
    this.settings.character = id;
    if (this.state === 'playing' || this.state === 'paused') return;
    this.conn.send({ t: 'character', character: id });
    this.processMessages();
  }

  qteInput(dir: QteDir): void {
    const q = this.snap?.you?.qte;
    if (this.state === 'playing' && q && !q.done) this.qteQueue.push(dir);
  }

  uiClick(): void {
    this.audio.unlock();
    this.audio.playUiClick();
  }

  get online(): boolean { return this.conn.online; }

  async joinOnline(name: string, url = NetClient.defaultUrl()): Promise<void> {
    const client = await NetClient.connect(url, name, this.settings.character);
    this.switchConnection(client);
    this.buffer = new SnapshotBuffer();
    this.processMessages();
    this.setState('playing');
    this.userGesture();
  }

  leaveOnline(): void {
    if (!this.conn.online) return;
    this.conn.close();
    this.switchConnection(this.solo);
    this.solo.flush();
    this.quitToMenu();
  }

  private switchConnection(c: Connection): void {
    for (const id of [...this.viewMap.keys()]) this.removeView(id);
    this.predictor?.dispose();
    this.predictor = null;
    this.buffer = null;
    this.snap = this.prevSnap = null;
    this.prevStates.clear();
    this.fx.clear();
    this.camera.reset();
    this.conn = c;
    if (c === this.solo) {
      this.myActorId = this.solo.sim.player(this.solo.playerId)!.actor.id;
      this.handle({ t: 'welcome', playerId: this.solo.playerId, actorId: this.myActorId, seed: this.solo.sim.seed, isHost: true, actors: this.solo.sim.actorInfos() });
    }
  }

  /** Builds (once per seed) the world view and the client's collider copy. */
  private useWorld(seed: number): void {
    if (seed === this.worldSeed) return;
    this.predictor?.dispose();
    this.predictor = null;
    this.worldView?.dispose();
    this.physics?.dispose();
    this.world = generateWorld(seed);
    this.worldSeed = seed;
    this.physics = PhysicsWorld.createSync();
    buildWorldColliders(this.physics, this.world);
    this.physics.step(); // query pipeline sees the static world (camera and prediction raycasts)
    this.worldView = buildWorldView(this.scene, this.world);
  }

  /** Shared state of co-op missions / PvP matches (latest snapshot). */
  modeState(): ModeState | null { return this.snap?.mode ?? null; }
  /** Minimap markers for this player (latest snapshot). */
  markers(): Marker[] { return this.snap?.markers ?? []; }
  /** Connected players (latest snapshot). */
  players(): PlayerSummary[] { return this.snap?.players ?? []; }
  get myPlayerId(): number { return this.snap?.you?.playerId ?? 0; }
  get myActorIdPublic(): number { return this.myActorId; }
  /** Camera heading (minimap rotation). */
  get cameraYaw(): number { return this.camera.yaw; }

  /** Test tooling (solo, or servers started with --debug). */
  debugCommand(msg: DebugMsg): void { this.conn.send(msg); }

  /** Online host only (the player on the server's machine): removes a player. */
  kick(playerId: number): void { this.conn.send({ t: 'kick', playerId }); }
  get isHost(): boolean { return this.hostFlag; }
  private hostFlag = true;

  /** Solo only: the in-process host (restart, debug). */
  private get local(): LocalHost | null {
    return this.conn instanceof LocalHost ? this.conn : null;
  }

  start(): void {
    if (this.conn.online) { this.setState('playing'); this.userGesture(); return; }
    this.resetWorld();
    this.setState('playing');
    this.userGesture();
  }

  pause(): void {
    if (this.state === 'playing') this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.setState('playing');
    // During a grab sequence the cursor must stay free for the arrows (locked clicks would hit the canvas).
    if (this.qteCursor) this.audio.unlock();
    else this.userGesture();
  }

  restart(): void {
    this.start();
  }

  quitToMenu(): void {
    if (this.conn.online) return this.leaveOnline();
    this.resetWorld();
    this.setState('menu');
  }

  applySettings(s: Settings): void {
    const character = s.character;
    Object.assign(this.settings, s);
    this.selectCharacter(character);
    this.audio.setVolume(s.masterVolume);
    this.postfx.enabled = s.graphics === 'high';
    this.renderer.shadowMap.enabled = s.graphics === 'high';
  }

  /** Solo restart: the simulation resets, the client drops every transient effect. */
  private resetWorld(): void {
    const local = this.local;
    if (local) {
      local.sim.reset();
      local.flush();
    }
    this.qteQueue.length = 0;
    this.qteCursor = false;
    this.fx.clear();
    this.camera.reset();
    this.hitStop = 0;
    this.stepper.reset();
    this.input.releaseAll();
    this.processMessages();
    this.prevSnap = null;
    this.prevStates.clear();
  }

  /** One client step: send input (solo: the simulation steps right away) and apply what came back. */
  private step(): void {
    const input = this.buildInput();
    if (this.predictor) {
      this.predictor.setLock(this.camera.lockTarget);
      this.predictor.step(input);
    }
    this.conn.sendInput(input);
    this.processMessages();
    if (this.conn instanceof NetClient && !this.conn.connected) { this.leaveOnline(); return; }
  }

  /** Frees the cursor while a grab sequence waits for arrow clicks; recaptures it when the sequence ends. */
  private syncQteCursor(): void {
    const q = this.snap?.you?.qte;
    const want = !!q && !q.done;
    if (want === this.qteCursor) return;
    this.qteCursor = want;
    this.input.releaseAll(); // no click or key carries over between the arrows and the fight
    if (want) this.input.exitPointerLock();
    else if (this.state === 'playing') this.input.requestPointerLock(); // the last arrow click is the user gesture
  }

  /** Called every animation frame with real elapsed seconds. */
  frame(frameDt: number): void {
    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05;
    const me = this.me();
    if (this.conn.online && this.state !== 'menu') {
      // Online never pauses: the menu overlay keeps sending (empty) input while the world goes on.
      let steps = this.stepper.advance(frameDt);
      while (steps-- > 0 && this.conn.online) this.step();
      this.interpolateOnline(this.stepper.alpha, frameDt);
      for (const v of this.viewList) v.syncModel(frameDt);
      this.camera.update(frameDt, this.stepper.alpha);
      if (me) this.worldView?.update(me.model.root.position, frameDt);
    } else if (this.state === 'playing') {
      let steps = this.stepper.advance(frameDt);
      while (steps-- > 0) {
        if (this.hitStop > 0) { this.hitStop -= SIM_DT; continue; }
        this.step();
        if (this.state !== 'playing') break;
      }
      this.interpolate(this.stepper.alpha);
      for (const v of this.viewList) v.syncModel(frameDt);
      this.camera.update(frameDt, this.stepper.alpha);
      if (me) this.worldView?.update(me.model.root.position, frameDt);
    } else if (this.state === 'menu') {
      // Idle showcase: models animate, nothing simulates.
      this.interpolate(1);
      for (const v of this.viewList) v.syncModel(frameDt);
      this.camera.update(frameDt, 1);
      if (me) this.worldView?.update(me.model.root.position, frameDt);
    } else {
      // Paused / ended: frozen frame, still re-rendered so the UI overlay stays live.
      this.camera.update(0, 1);
    }
    this.modeVisuals.update(frameDt, { mode: this.snap?.mode ?? null, world: this.world, views: this.viewList, myActorId: this.myActorId, camera: this.camera.camera });
    this.updateSpeedLines(frameDt);
    this.postfx.render(frameDt);
  }

  /** Anime speed lines while sprinting or in a dash/dodge; eased so they fade in and out. */
  private updateSpeedLines(frameDt: number): void {
    const p = this.me();
    let target = 0;
    if (this.state === 'playing' && p && p.alive) {
      const speed = Math.hypot(p.velocity.x, p.velocity.z);
      target = THREE.MathUtils.clamp((speed - MOVEMENT.runSpeed) / (MOVEMENT.sprintSpeed - MOVEMENT.runSpeed), 0, 1);
      if (p.has('busy') && speed > MOVEMENT.sprintSpeed) target = 1;
    }
    if (frameDt > 0) this.postfx.speedLines += (target - this.postfx.speedLines) * (1 - Math.exp(-8 * frameDt));
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.resize(w / h);
    this.postfx?.setSize(w, h);
  }

  getHudData(): HudData {
    const p = this.me();
    const you = this.snap?.you ?? null;
    const labels = this.keyLabels;
    const chakra = p?.chakra ?? 0;
    const c = CHARACTERS[this.settings.character];
    const special = c.special === 'sharingan' ? COMBAT.sharingan : c.special === 'chidori' ? COMBAT.chidori : COMBAT.special;
    const cd = (id: 'special' | 'kunai' | 'dodge', label: string, key: string, total: number, cost: number) => {
      const remaining = you?.cooldowns[id] ?? 0;
      return { id, label, key, total, chakraCost: cost, remaining, usable: remaining <= 0 && chakra >= cost };
    };
    const cam = this.camera.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const enemyBars: HudData['enemyBars'] = [];
    for (const a of this.hostiles()) {
      const locked = this.camera.lockTarget === a;
      if (!p || (!locked && a.position.distanceTo(p.position) > 22)) continue;
      this.projected.copy(a.model.root.position).setY(a.model.root.position.y + a.height + 0.45).project(cam);
      if (this.projected.z > 1 || Math.abs(this.projected.x) > 1.1 || Math.abs(this.projected.y) > 1.1) continue;
      enemyBars.push({
        id: a.id, x: (this.projected.x * 0.5 + 0.5) * w, y: (-this.projected.y * 0.5 + 0.5) * h,
        hp: a.hp, maxHp: a.maxHp, telegraph: a.has('telegraph'), locked,
      });
    }
    const t = this.camera.lockTarget;
    return {
      player: {
        hp: p?.hp ?? 0, maxHp: p?.maxHp ?? 1, chakra, maxChakra: p?.maxChakra ?? 1,
        concentrating: p?.concentrating ?? false, guarding: p?.has('guard') ?? false, climbing: p?.climbing ?? false,
        substitution: you?.substitution ?? 0, maxSubstitution: you?.maxSubstitution ?? 1, character: this.settings.character,
      },
      charge: you?.charge ?? null,
      qte: you?.qte ?? null,
      cooldowns: [
        cd('special', c.specialLabel, labels.special, special.cooldown, special.chakraCost),
        cd('kunai', 'Kunai', labels.kunai.split(' ')[0], COMBAT.kunai.cooldown, 0),
        cd('dodge', 'Esquive', labels.dodge, COMBAT.dodge.cooldown, 0),
      ],
      wave: 0,
      totalWaves: 0,
      enemiesRemaining: this.snap?.mode.coop.phase === 'running' ? this.hostiles().length : 0,
      intermission: 0,
      lockTarget: t && t.alive ? { name: t.name, hp: t.hp, maxHp: t.maxHp } : null,
      enemyBars,
      fps: this.fps,
    };
  }

  /** Test hook: exposes internals to Playwright in dev/preview builds. */
  debug() {
    const local = this.local;
    const sim = local?.sim;
    const player = sim?.player(local!.playerId)?.actor;
    // `ctx.player`: the local player's actor (fresh copy of the context fields on each call).
    return { sim, ctx: sim ? { ...sim.ctx, player } : undefined, ai: sim?.ai, camera: this.camera, player, views: this.viewMap };
  }
}
