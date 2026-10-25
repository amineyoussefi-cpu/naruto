import * as THREE from 'three';
import { COMBAT, ENEMIES, MOVEMENT, SIM_DT, WAVES, DEFAULT_SETTINGS, type Settings } from '../config';
import { EventBus } from '../core/events';
import { FixedStepper } from '../core/loop';
import { InputManager, KEY_LABELS } from '../core/input';
import type { ActorKind, CharacterId, GameState, HudData, QteDir } from '../core/types';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Actor } from './Actor';
import type { GameContext, SpawnModifiers } from './context';
import { Fighter } from '../combat/Fighter';
import { CombatSystem } from '../combat/CombatSystem';
import { PlayerCombat } from '../combat/PlayerCombat';
import { PlayerController } from '../player/PlayerController';
import { CameraRig } from '../camera/CameraRig';
import { EnemyAI } from '../ai/EnemyAI';
import { WaveManager } from '../ai/WaveManager';
import { NinjaModel } from '../render/NinjaModel';
import { CHARACTER_LOOKS, NAMES, pickEnemyLook } from '../render/looks';
import { CHARACTERS } from '../config/characters';
import { Effects } from '../render/Effects';
import { buildArena, type ArenaInfo } from '../world/Arena';
import { AudioSystem } from '../audio/AudioSystem';
import { PostFX } from '../render/PostFX';


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
 * Integration root: owns the renderer, the fixed-step loop, the game state machine
 * and wires all systems together. Owner: integration.
 */
export class Game implements GameApi {
  readonly events = new EventBus();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: InputManager;
  readonly settings: Settings = { ...DEFAULT_SETTINGS };
  detectedLayout: 'qwerty' | 'azerty' = 'qwerty';
  state: GameState = 'menu';

  private readonly stepper = new FixedStepper(SIM_DT);
  private readonly ctx: GameContext;
  private readonly physics: PhysicsWorld;
  private readonly camera = new CameraRig();
  private readonly combat: CombatSystem;
  private readonly fx: Effects;
  private readonly audio: AudioSystem;
  private readonly ai: EnemyAI;
  private readonly waves: WaveManager;
  private readonly playerCombat: PlayerCombat;
  private readonly playerController: PlayerController;
  private readonly arena: ArenaInfo;
  private readonly mods = new WeakMap<Actor, SpawnModifiers>();
  private hitStop = 0;
  private endTimer = -1;
  private lastStateChange = 0;
  private fps = 60;
  private projected = new THREE.Vector3();
  private readonly postfx: PostFX;
  /** True while the grab sequence owns the (unlocked) cursor. */
  private qteCursor = false;

  static async create(canvasHost: HTMLElement): Promise<Game> {
    return new Game(canvasHost, await PhysicsWorld.create());
  }

  private constructor(host: HTMLElement, physics: PhysicsWorld) {
    this.physics = physics;
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

    this.arena = buildArena(this.scene, physics);
    this.fx = new Effects(this.scene, this.events, (id) => this.ctx.actors.find((a) => a.id === id));
    this.audio = new AudioSystem(this.events);

    const player = this.createActor('player', this.arena.playerSpawn, { hpMul: 1, dmgMul: 1 });
    this.ctx = {
      scene: this.scene,
      physics,
      events: this.events,
      input: this.input,
      camera: this.camera,
      combat: null as unknown as CombatSystem, // assigned below; systems need ctx first
      fx: this.fx,
      settings: this.settings,
      pressed: new Set(),
      time: 0,
      actors: [player],
      player,
      spawnEnemy: (kind, feet, mods) => {
        const a = this.createActor(kind, feet, mods);
        this.ctx.actors.push(a);
        return a;
      },
      removeActor: (a) => this.removeActor(a),
      enemies: () => this.ctx.actors.filter((a) => a.team === 'enemy' && a.alive && !a.removed),
      spawns: { player: this.arena.playerSpawn, enemies: this.arena.enemySpawns },
      modifiers: (a) => this.mods.get(a) ?? { hpMul: 1, dmgMul: 1 },
      character: this.settings.character,
      qte: null,
      qteInputs: [],
    };
    this.combat = this.ctx.combat = new CombatSystem(this.ctx);
    this.camera.attach(this.ctx);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera.camera);
    this.ai = new EnemyAI(this.ctx);
    this.waves = new WaveManager(this.ctx, this.ai);
    this.playerCombat = new PlayerCombat(this.ctx, player);
    this.playerController = new PlayerController(this.ctx, player);

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
    this.events.on('hitStop', (e) => { this.hitStop = Math.max(this.hitStop, e.duration); });
    this.events.on('cameraShake', (e) => this.camera.shake(e.intensity, e.duration));
    this.events.on('victory', () => { if (this.state === 'playing') this.endTimer = 1.2; });
    this.events.on('death', (e) => { if (e.team === 'player' && this.state === 'playing') this.endTimer = 2; });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.playerController.reset(this.arena.playerSpawn);
    player.beginStep();
  }

  get layout(): 'qwerty' | 'azerty' {
    return this.settings.layout === 'auto' ? this.detectedLayout : this.settings.layout;
  }

  get keyLabels() {
    return KEY_LABELS[this.layout];
  }

  private createActor(kind: ActorKind, feet: THREE.Vector3, mods: SpawnModifiers): Actor {
    const stats = kind === 'player'
      ? { maxHp: COMBAT.player.maxHp, maxChakra: COMBAT.player.maxChakra }
      : { maxHp: Math.round(ENEMIES[kind].maxHp * mods.hpMul), maxChakra: 0 };
    const fighter = new Fighter(stats, COMBAT.guardDamageFactor);
    const model = new NinjaModel(kind === 'player' ? CHARACTER_LOOKS[this.settings.character] : pickEnemyLook(kind));
    this.scene.add(model.root);
    const body = this.physics.createCharacter(feet, MOVEMENT.capsuleRadius, MOVEMENT.capsuleHalfHeight);
    const name = kind === 'player' ? 'You' : NAMES[kind][Math.floor(Math.random() * NAMES[kind].length)];
    const height = 2 * (MOVEMENT.capsuleHalfHeight + MOVEMENT.capsuleRadius);
    const a = new Actor(kind, kind === 'player' ? 'player' : 'enemy', name, fighter, model, body, MOVEMENT.capsuleRadius, height);
    a.position.copy(feet);
    a.prevPosition.copy(feet);
    this.mods.set(a, mods);
    return a;
  }

  private removeActor(a: Actor): void {
    if (a.removed) return;
    a.removed = true;
    this.ai.unregister(a);
    this.physics.removeCharacter(a.body);
    a.model.dispose();
    const i = this.ctx.actors.indexOf(a);
    if (i >= 0) this.ctx.actors.splice(i, 1);
    if (this.camera.lockTarget === a) this.camera.lockTarget = null;
  }

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
    return this.ctx.character;
  }

  /** Swaps the player's model; only between runs (menu / end screens) so a fight never changes character. */
  selectCharacter(id: CharacterId): void {
    this.settings.character = id;
    if (id === this.ctx.character || this.state === 'playing' || this.state === 'paused') return;
    this.ctx.character = id;
    const p = this.ctx.player;
    p.model.dispose();
    p.model = new NinjaModel(CHARACTER_LOOKS[id]);
    this.scene.add(p.model.root);
    p.syncModel(1, 0);
  }

  qteInput(dir: QteDir): void {
    const q = this.ctx.qte;
    if (this.state === 'playing' && q && !q.done) this.ctx.qteInputs.push(dir);
  }

  uiClick(): void {
    this.audio.unlock();
    this.audio.playUiClick();
  }

  start(): void {
    this.resetWorld();
    this.setState('playing');
    this.userGesture();
    this.waves.start();
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

  /** Removes every transient object and restores the player: no state survives a restart. */
  private resetWorld(): void {
    for (const a of [...this.ctx.actors]) if (a !== this.ctx.player) this.removeActor(a);
    this.ai.clear();
    this.combat.clear();
    this.ctx.qte = null;
    this.ctx.qteInputs.length = 0;
    this.qteCursor = false;
    this.fx.clear();
    this.waves.reset();
    const p = this.ctx.player;
    p.fighter.reset();
    p.knockback.set(0, 0, 0);
    p.velocity.set(0, 0, 0);
    p.climbing = false;
    p.deadTime = 0;
    p.yaw = 0;
    p.setAnim('idle', true);
    p.resetControl();
    this.playerCombat.reset();
    this.playerController.reset(this.arena.playerSpawn);
    p.onWater = false;
    p.disoriented = 0;
    p.grabbedBy = null;
    p.beginStep();
    this.camera.reset();
    this.ctx.time = 0;
    this.hitStop = 0;
    this.endTimer = -1;
    this.stepper.reset();
    this.input.releaseAll();
  }

  /** One fixed simulation step. Never called while paused. */
  step(dt: number): void {
    const ctx = this.ctx;
    ctx.pressed = this.input.consumePressed();
    ctx.time += dt;
    for (const a of ctx.actors) {
      a.beginStep();
      a.animTime += dt;
    }
    this.camera.updateSim(dt);
    this.playerCombat.update(dt);
    this.playerController.update(dt);
    this.ai.update(dt);
    for (const a of ctx.actors) {
      a.onWater = a.alive && a.grounded && this.physics.isWater(a.position);
      a.disoriented = Math.max(0, a.disoriented - dt);
    }
    this.combat.update(dt);
    this.fx.update(dt);
    this.waves.update(dt);
    for (const a of [...ctx.actors]) {
      if (a.team !== 'enemy') continue;
      if (!a.alive) {
        a.deadTime += dt;
        if (a.deadTime > ENEMIES.corpseTime) this.removeActor(a);
      } else if (a.position.y < MOVEMENT.killPlaneY) {
        const s = ctx.spawns.enemies[a.id % ctx.spawns.enemies.length];
        this.physics.teleport(a.body, s);
        a.position.copy(s);
        a.prevPosition.copy(s);
        a.velocity.set(0, 0, 0);
      }
    }
    this.physics.step();
    this.syncQteCursor();
    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.setState(ctx.player.alive ? 'victory' : 'defeat');
    }
  }

  /** Frees the cursor while a grab sequence waits for arrow clicks; recaptures it when the sequence ends. */
  private syncQteCursor(): void {
    const q = this.ctx.qte;
    const want = !!q && !q.done;
    if (want === this.qteCursor) return;
    this.qteCursor = want;
    this.input.releaseAll(); // no click or key carries over between the arrows and the fight
    if (want) this.input.exitPointerLock();
    else this.input.requestPointerLock(); // the last arrow click is the user gesture; else the next canvas click relocks
  }

  /** Called every animation frame with real elapsed seconds. */
  frame(frameDt: number): void {
    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05;
    if (this.state === 'playing') {
      let steps = this.stepper.advance(frameDt);
      while (steps-- > 0) {
        if (this.hitStop > 0) { this.hitStop -= SIM_DT; continue; }
        this.step(SIM_DT);
        if (this.state !== 'playing') break;
      }
      const alpha = this.stepper.alpha;
      for (const a of this.ctx.actors) a.syncModel(alpha, frameDt);
      this.camera.update(frameDt, alpha);
      this.arena.update?.(this.ctx.player.model.root.position, frameDt);
    } else if (this.state === 'menu') {
      // Idle showcase: models animate, nothing simulates.
      for (const a of this.ctx.actors) a.syncModel(1, frameDt);
      this.camera.update(frameDt, 1);
      this.arena.update?.(this.ctx.player.model.root.position, frameDt);
    } else {
      // Paused / ended: frozen frame, still re-rendered so the UI overlay stays live.
      this.camera.update(0, 1);
    }
    this.updateSpeedLines(frameDt);
    this.postfx.render(frameDt);
  }

  /** Anime speed lines while sprinting or in a forced dash/dodge; eased so they fade in and out. */
  private updateSpeedLines(frameDt: number): void {
    const p = this.ctx.player;
    let target = 0;
    if (this.state === 'playing' && p.alive) {
      const speed = Math.hypot(p.velocity.x, p.velocity.z);
      target = THREE.MathUtils.clamp((speed - MOVEMENT.runSpeed) / (MOVEMENT.sprintSpeed - MOVEMENT.runSpeed), 0, 1);
      if (p.control.forcedVelocity && p.control.forcedVelocity.lengthSq() > MOVEMENT.sprintSpeed ** 2) target = 1;
    }
    if (frameDt > 0) this.postfx.speedLines += (target - this.postfx.speedLines) * (1 - Math.exp(-8 * frameDt));
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.resize(w / h);
    this.postfx?.setSize(w, h);
  }

  /** HUD slot for the character's E technique (cost / cooldown depend on the character). */
  private specialSlot(cd: (id: 'special', label: string, key: string, total: number, cost: number) => HudData['cooldowns'][number], key: string) {
    const c = CHARACTERS[this.ctx.character];
    const cfg = c.special === 'sharingan' ? COMBAT.sharingan : c.special === 'chidori' ? COMBAT.chidori : COMBAT.special;
    return cd('special', c.specialLabel, key, cfg.cooldown, cfg.chakraCost);
  }

  getHudData(): HudData {
    const p = this.ctx.player;
    const f = p.fighter;
    const labels = this.keyLabels;
    const cd = (id: 'special' | 'kunai' | 'dodge', label: string, key: string, total: number, cost: number) => ({
      id, label, key, total, chakraCost: cost,
      remaining: f.cooldownRemaining(id),
      usable: f.cooldownReady(id) && f.chakra >= cost,
    });
    const cam = this.camera.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const enemyBars: HudData['enemyBars'] = [];
    for (const a of this.ctx.actors) {
      if (a.team !== 'enemy' || !a.alive || a.removed) continue;
      const locked = this.camera.lockTarget === a;
      if (!locked && a.position.distanceTo(p.position) > 22) continue;
      this.projected.copy(a.model.root.position).setY(a.model.root.position.y + a.height + 0.45).project(cam);
      if (this.projected.z > 1 || Math.abs(this.projected.x) > 1.1 || Math.abs(this.projected.y) > 1.1) continue;
      enemyBars.push({
        id: a.id,
        x: (this.projected.x * 0.5 + 0.5) * w,
        y: (-this.projected.y * 0.5 + 0.5) * h,
        hp: a.fighter.hp,
        maxHp: a.fighter.maxHp,
        telegraph: this.ai.isTelegraphing(a),
        locked,
      });
    }
    const t = this.camera.lockTarget;
    return {
      player: { hp: f.hp, maxHp: f.maxHp, chakra: f.chakra, maxChakra: f.maxChakra, concentrating: f.concentrating, guarding: f.guarding, climbing: p.climbing, substitution: f.substitution, maxSubstitution: f.maxSubstitution, character: this.ctx.character },
      charge: this.playerCombat.charge,
      qte: this.ctx.qte,
      cooldowns: [
        this.specialSlot(cd, labels.special),
        cd('kunai', 'Kunai', labels.kunai.split(' ')[0], COMBAT.kunai.cooldown, 0),
        cd('dodge', 'Esquive', labels.dodge, COMBAT.dodge.cooldown, 0),
      ],
      wave: this.waves.wave,
      totalWaves: WAVES.length,
      enemiesRemaining: this.waves.remaining,
      intermission: this.waves.intermission,
      lockTarget: t && t.alive ? { name: t.name, hp: t.fighter.hp, maxHp: t.fighter.maxHp } : null,
      enemyBars,
      fps: this.fps,
    };
  }

  /** Test hook: exposes internals to Playwright in dev/preview builds. */
  debug() {
    return { ctx: this.ctx, waves: this.waves, ai: this.ai, camera: this.camera };
  }
}
