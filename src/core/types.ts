/** Shared gameplay types. Owner: integration. Changes here must be coordinated. */
export type Team = 'player' | 'enemy';
export type ActorKind = 'player' | 'melee' | 'ranged';
export type GameState = 'menu' | 'playing' | 'paused' | 'victory' | 'defeat';

/** Every visual state a ninja can be in. Models must render each distinctly. */
export type AnimState =
  | 'idle' | 'run' | 'sprint' | 'jump' | 'fall' | 'climb'
  | 'attack1' | 'attack2' | 'attack3' | 'attack4' | 'attack5' | 'throw' | 'special'
  | 'guard' | 'dodge' | 'hit' | 'dead' | 'concentrate' | 'telegraph'
  /** Storm-style: chakra dash (homing rush), launched by a finisher (airborne tumble), substitution reappear. */
  | 'dash' | 'launched' | 'substitution';

export type AttackKind = 'combo1' | 'combo2' | 'combo3' | 'combo4' | 'combo5' | 'kunai' | 'special' | 'enemyMelee' | 'enemyRanged';

export interface Vec3Like { x: number; y: number; z: number }

/** Snapshot the UI reads every frame. Built by Game.getHudData(). */
export interface HudData {
  player: { hp: number; maxHp: number; chakra: number; maxChakra: number; concentrating: boolean; guarding: boolean; climbing: boolean; substitution: number; maxSubstitution: number };
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
