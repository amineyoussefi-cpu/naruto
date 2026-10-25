/** Shared gameplay types. Owner: integration. Changes here must be coordinated. */
export type Team = 'player' | 'enemy';
export type ActorKind = 'player' | 'melee' | 'ranged';
export type GameState = 'menu' | 'playing' | 'paused' | 'victory' | 'defeat';
/** Playable characters (selected in the menu). */
export type CharacterId = 'naruto' | 'sasuke' | 'kakashi';
/** Charged techniques (hold E, release to attack). */
export type ChargeTechnique = 'rasengan' | 'chidori';
/** Grab sequence arrow directions. */
export type QteDir = 'up' | 'down' | 'left' | 'right';

/** Grab / six-arrow sequence state, written by combat, read by Game (cursor) and UI (arrows). */
export interface QteState {
  targetId: number;
  arrows: QteDir[];
  /** Index of the next expected arrow (== arrows.length when complete). */
  index: number;
  /** Seconds left / total for the whole sequence (sim time: frozen on pause). */
  timeLeft: number;
  timeTotal: number;
  /** Outcome of the latest input; 'active' while waiting. Stays set for a short outro after the end. */
  result: 'active' | 'hit' | 'miss' | 'timeout' | 'complete' | 'interrupted';
  /** True once the sequence has ended (UI shows the outcome, cursor is recaptured). */
  done: boolean;
}

/** Every visual state a ninja can be in. Models must render each distinctly. */
export type AnimState =
  | 'idle' | 'run' | 'sprint' | 'jump' | 'fall' | 'climb'
  | 'attack1' | 'attack2' | 'attack3' | 'attack4' | 'attack5' | 'throw' | 'special'
  | 'guard' | 'dodge' | 'hit' | 'dead' | 'concentrate' | 'telegraph'
  /** Storm-style: chakra dash (homing rush), launched by a finisher (airborne tumble), substitution reappear. */
  | 'dash' | 'launched' | 'substitution'
  /** Charging Rasengan/Chidori (hold), Chidori piercing dash, Sharingan cast, dazed by genjutsu. */
  | 'charge' | 'chidori' | 'sharingan' | 'dazed'
  /** Grab sequence: attacker hold, one strike per arrow direction, finisher; victim held. */
  | 'grabHold' | 'strikeUp' | 'strikeDown' | 'strikeLeft' | 'strikeRight' | 'grabFinisher' | 'grabbed';

export type AttackKind = 'combo1' | 'combo2' | 'combo3' | 'combo4' | 'combo5' | 'kunai' | 'special' | 'chidori' | 'grabStrike' | 'grabFinisher' | 'enemyMelee' | 'enemyRanged';

export interface Vec3Like { x: number; y: number; z: number }

/** Snapshot the UI reads every frame. Built by Game.getHudData(). */
export interface HudData {
  player: { hp: number; maxHp: number; chakra: number; maxChakra: number; concentrating: boolean; guarding: boolean; climbing: boolean; substitution: number; maxSubstitution: number; character: CharacterId };
  /** Active Rasengan/Chidori charge (0..1 power progress), null when not charging. */
  charge: { technique: ChargeTechnique; level: number } | null;
  /** Active or just-finished grab sequence, null otherwise. */
  qte: QteState | null;
  cooldowns: { id: 'special' | 'kunai' | 'dodge'; label: string; key: string; remaining: number; total: number; chakraCost: number; usable: boolean }[];
  wave: number;
  totalWaves: number;
  enemiesRemaining: number;
  intermission: number; // seconds until next wave, 0 when fighting
  lockTarget: { name: string; hp: number; maxHp: number } | null;
  /** Enemies to draw floating bars for, in CSS pixels. */
  enemyBars: { id: number; x: number; y: number; hp: number; maxHp: number; telegraph: boolean; locked: boolean }[];
  fps: number;
}
