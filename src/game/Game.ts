import * as THREE from 'three';
import { COMBAT, MOVEMENT, SIM_DT, WAVES, DEFAULT_SETTINGS, type Settings } from '../config';
import { EventBus } from '../core/events';
import { FixedStepper } from '../core/loop';
import { InputManager, KEY_LABELS, type Action } from '../core/input';
import type { CharacterId, GameState, HudData, QteDir } from '../core/types';
import { PhysicsWorld } from '../sim/physics/PhysicsWorld';
import { CHARACTERS } from '../config/characters';
import { hitFeedback } from '../sim/combat/CombatSystem';
import { actionBit, INPUT_ACTIONS, type ActorInfo, type ActorState, type PlayerInput, type ServerMsg, type Snapshot } from '../sim/protocol';
import type { Connection } from '../net/connection';
import { LocalHost } from '../net/LocalHost';
import { CameraRig, type CameraHost } from '../camera/CameraRig';
import { Effects } from '../render/Effects';
import { buildArena, type ArenaInfo } from '../world/Arena';
import { AudioSystem } from '../audio/AudioSystem';
import { PostFX } from '../render/PostFX';
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
  readonly physics: PhysicsWorld;
  detectedLayout: 'qwerty' | 'azerty' = 'qwerty';
  state: GameState = 'menu';

  private readonly stepper = new FixedStepper(SIM_DT);
  private readonly camera = new CameraRig();
  private readonly fx: Effects;
  private readonly audio: AudioSystem;
  private readonly arena: ArenaInfo;
  private readonly postfx: PostFX;
  private conn: Connection;
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
  private endTimer = -1;
  private lastStateChange = 0;
  private fps = 60;
  private projected = new THREE.Vector3();
  /** True while the grab sequence owns the (unlocked) cursor. */
  private qteCursor = false;

  static async create(canvasHost: HTMLElement): Promise<Game> {
    const physics = await PhysicsWorld.create();
    const conn = await LocalHost.create('Vous', DEFAULT_SETTINGS.character);
    return new Game(canvasHost, physics, conn);
  }

  private constructor(host: HTMLElement, physics: PhysicsWorld, conn: Connection) {
    this.physics = physics;
    this.conn = conn;
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
    this.arena = buildArena(this.scene, physics);
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
    this.events.on('victory', () => { if (this.state === 'playing') this.endTimer = 1.2; });
    this.events.on('death', (e) => { if (e.id === this.myActorId && this.state === 'playing') this.endTimer = 2; });

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
      this.myActorId = m.actorId;
      for (const info of m.actors) this.addView(info);
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
    this.prevSnap = this.snap;
    this.prevStates.clear();
    if (this.prevSnap) for (const a of this.prevSnap.actors) this.prevStates.set(a.id, a);
    this.snap = s;
    for (const a of s.actors) this.viewMap.get(a.id)?.apply(a, a, 1);
    for (const e of s.events) this.events.emit(e.type, e.payload as never);
    this.syncQteCursor();
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

  /** Solo only: the in-process host (restart, waves, debug). */
  private get local(): LocalHost | null {
    return this.conn instanceof LocalHost ? this.conn : null;
  }

  start(): void {
    this.resetWorld();
    this.setState('playing');
    this.userGesture();
    this.local?.waves.start();
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
      local.waves.reset();
      local.flush();
    }
    this.qteQueue.length = 0;
    this.qteCursor = false;
    this.fx.clear();
    this.camera.reset();
    this.hitStop = 0;
    this.endTimer = -1;
    this.stepper.reset();
    this.input.releaseAll();
    this.processMessages();
    this.prevSnap = null;
    this.prevStates.clear();
  }

  /** One client step: send input (solo: the simulation steps right away) and apply what came back. */
  private step(dt: number): void {
    this.conn.sendInput(this.buildInput());
    this.processMessages();
    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.setState(this.me()?.alive ? 'victory' : 'defeat');
    }
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
    if (this.state === 'playing') {
      let steps = this.stepper.advance(frameDt);
      while (steps-- > 0) {
        if (this.hitStop > 0) { this.hitStop -= SIM_DT; continue; }
        this.step(SIM_DT);
        if (this.state !== 'playing') break;
      }
      this.interpolate(this.stepper.alpha);
      for (const v of this.viewList) v.syncModel(frameDt);
      this.camera.update(frameDt, this.stepper.alpha);
      if (me) this.arena.update?.(me.model.root.position, frameDt);
    } else if (this.state === 'menu') {
      // Idle showcase: models animate, nothing simulates.
      this.interpolate(1);
      for (const v of this.viewList) v.syncModel(frameDt);
      this.camera.update(frameDt, 1);
      if (me) this.arena.update?.(me.model.root.position, frameDt);
    } else {
      // Paused / ended: frozen frame, still re-rendered so the UI overlay stays live.
      this.camera.update(0, 1);
    }
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
    const waves = this.local?.waves;
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
      wave: waves?.wave ?? 0,
      totalWaves: WAVES.length,
      enemiesRemaining: waves?.remaining ?? 0,
      intermission: waves?.intermission ?? 0,
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
    return { sim, ctx: sim ? { ...sim.ctx, player } : undefined, waves: local?.waves, ai: sim?.ai, camera: this.camera, player, views: this.viewMap };
  }
}
