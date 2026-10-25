import { CHAKRA } from '../config/chakra';
import { COMBAT } from '../config/combat';

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
 * Pure combat stats: health, chakra, cooldowns, guard, invulnerability, stun, concentration.
 * No Three.js or DOM: fully unit-testable. Time only advances in `tick`. Owner: combat agent.
 */
export class Fighter {
  hp: number;
  chakra: number;
  /** Substitution gauge (player only uses it); regenerates in `tick`, spent by `trySpendSubstitution`. */
  substitution: number = COMBAT.substitution.max;
  guarding = false;
  /** Set each step by the owner's controller; regen boosts after `CHAKRA.concentrateStartup`. */
  concentrating = false;
  private invuln = 0;
  private stun = 0;
  private regenWait = 0;
  private concentrateTime = 0;
  private cooldowns = new Map<string, number>();

  constructor(readonly stats: FighterStats, readonly guardFactor = 0.25) {
    this.hp = stats.maxHp;
    this.chakra = stats.maxChakra;
  }

  get maxHp(): number { return this.stats.maxHp; }
  get maxChakra(): number { return this.stats.maxChakra; }
  get maxSubstitution(): number { return COMBAT.substitution.max; }
  get alive(): boolean { return this.hp > 0; }
  get invulnerable(): boolean { return this.invuln > 0; }
  get stunned(): boolean { return this.stun > 0; }
  get stunRemaining(): number { return this.stun; }
  /** True once concentration has passed its startup and is recharging. */
  get concentrateActive(): boolean { return this.concentrating && this.concentrateTime >= CHAKRA.concentrateStartup; }

  tick(dt: number): void {
    if (!this.alive) return;
    this.invuln = Math.max(0, this.invuln - dt);
    this.stun = Math.max(0, this.stun - dt);
    for (const [k, v] of this.cooldowns) this.cooldowns.set(k, Math.max(0, v - dt));
    this.substitution = Math.min(this.maxSubstitution, this.substitution + COMBAT.substitution.regenPerSecond * dt);
    if (this.concentrating) {
      this.concentrateTime += dt;
      if (this.concentrateActive) this.addChakra(CHAKRA.concentrateRegenPerSecond * dt);
      return;
    }
    this.concentrateTime = 0;
    if (this.regenWait > 0) this.regenWait = Math.max(0, this.regenWait - dt);
    else this.addChakra(CHAKRA.regenPerSecond * dt);
  }

  trySpendChakra(amount: number): boolean {
    if (!this.alive || this.chakra < amount) return false;
    this.chakra -= amount;
    this.regenWait = CHAKRA.regenDelay;
    return true;
  }

  /** Spends one substitution (`COMBAT.substitution.cost`) if the gauge allows it. */
  trySpendSubstitution(): boolean {
    if (!this.alive || this.substitution < COMBAT.substitution.cost) return false;
    this.substitution -= COMBAT.substitution.cost;
    return true;
  }

  addChakra(amount: number): void {
    if (this.alive) this.chakra = Math.min(this.maxChakra, this.chakra + amount);
  }
  cooldownRemaining(key: string): number { return this.cooldowns.get(key) ?? 0; }
  cooldownReady(key: string): boolean { return this.cooldownRemaining(key) <= 0; }
  startCooldown(key: string, seconds: number): void { if (this.alive) this.cooldowns.set(key, seconds); }
  setInvulnerable(seconds: number): void { if (this.alive) this.invuln = Math.max(this.invuln, seconds); }
  setStun(seconds: number): void { if (this.alive) this.stun = Math.max(this.stun, seconds); }
  clearStun(): void { this.stun = 0; }

  applyHit(hit: HitInfo): HitResult {
    if (!this.alive || this.invulnerable) return { applied: 0, blocked: false, killed: false, ignored: true };
    const blocked = this.guarding && !hit.unblockable;
    const applied = Math.min(this.hp, blocked ? hit.damage * this.guardFactor : hit.damage);
    this.hp -= applied;
    this.concentrating = false;
    this.concentrateTime = 0;
    const killed = this.hp <= 0;
    if (killed) this.guarding = false;
    return { applied, blocked, killed, ignored: false };
  }

  reset(): void {
    this.hp = this.maxHp;
    this.chakra = this.maxChakra;
    this.substitution = this.maxSubstitution;
    this.guarding = this.concentrating = false;
    this.invuln = this.stun = this.regenWait = this.concentrateTime = 0;
    this.cooldowns.clear();
  }
}
