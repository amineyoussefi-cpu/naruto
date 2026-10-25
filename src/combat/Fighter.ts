import { CHAKRA } from '../config/chakra';

export interface FighterStats { maxHp: number; maxChakra: number }

export interface HitInfo {
  damage: number;
  /** Unblockable hits ignore guard (none by default). */
  unblockable?: boolean;
}

export interface HitResult {
  /** Damage actually applied. */
  applied: number;
  blocked: boolean;
  killed: boolean;
  /** True when the hit was ignored (invulnerable or already dead). */
  ignored: boolean;
}

/**
 * Pure combat stats: health, chakra, cooldowns, guard, invulnerability, stun.
 * No Three.js or DOM: fully unit-testable. Owner: combat agent.
 * STUB: the combat agent replaces the internals and keeps this public API.
 */
export class Fighter {
  hp: number;
  chakra: number;
  guarding = false;
  concentrating = false;
  private invuln = 0;
  private stun = 0;
  private regenWait = 0;
  private cooldowns = new Map<string, number>();

  constructor(readonly stats: FighterStats, readonly guardFactor = 0.25) {
    this.hp = stats.maxHp;
    this.chakra = stats.maxChakra;
  }

  get maxHp(): number { return this.stats.maxHp; }
  get maxChakra(): number { return this.stats.maxChakra; }
  get alive(): boolean { return this.hp > 0; }
  get invulnerable(): boolean { return this.invuln > 0; }
  get stunned(): boolean { return this.stun > 0; }

  tick(dt: number): void {
    this.invuln = Math.max(0, this.invuln - dt);
    this.stun = Math.max(0, this.stun - dt);
    for (const [k, v] of this.cooldowns) this.cooldowns.set(k, Math.max(0, v - dt));
    if (!this.alive) return;
    if (this.regenWait > 0) this.regenWait -= dt;
    else this.chakra = Math.min(this.maxChakra, this.chakra + CHAKRA.regenPerSecond * dt);
  }

  trySpendChakra(amount: number): boolean {
    if (this.chakra < amount) return false;
    this.chakra -= amount;
    this.regenWait = CHAKRA.regenDelay;
    return true;
  }

  addChakra(amount: number): void { this.chakra = Math.min(this.maxChakra, this.chakra + amount); }
  cooldownRemaining(key: string): number { return this.cooldowns.get(key) ?? 0; }
  cooldownReady(key: string): boolean { return this.cooldownRemaining(key) <= 0; }
  startCooldown(key: string, seconds: number): void { this.cooldowns.set(key, seconds); }
  setInvulnerable(seconds: number): void { this.invuln = Math.max(this.invuln, seconds); }
  setStun(seconds: number): void { this.stun = Math.max(this.stun, seconds); }

  applyHit(hit: HitInfo): HitResult {
    if (!this.alive || this.invulnerable) return { applied: 0, blocked: false, killed: false, ignored: true };
    const blocked = this.guarding && !hit.unblockable;
    const applied = Math.min(this.hp, blocked ? hit.damage * this.guardFactor : hit.damage);
    this.hp -= applied;
    return { applied, blocked, killed: this.hp <= 0, ignored: false };
  }

  reset(): void {
    this.hp = this.maxHp;
    this.chakra = this.maxChakra;
    this.guarding = this.concentrating = false;
    this.invuln = this.stun = this.regenWait = 0;
    this.cooldowns.clear();
  }
}
