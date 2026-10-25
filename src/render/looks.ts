import type { ActorKind } from '../core/types';
import type { NinjaLook } from './NinjaModel';

/** Colour schemes per ninja archetype (original designs). Owner: characters. */
export const LOOKS: Record<ActorKind, NinjaLook> = {
  // Bright orange jacket, navy yoke, blond spiky hair, blue headband cloth.
  player: { outfit: 0xff7a1a, accent: 0x22305e, hair: 0xffd23a, skin: 0xf6cfa6, headband: 0x3a6fe0, hairStyle: 'spiky', eyes: 0x2f86e8 },
  // Dark purple / charcoal brawler, crimson scarf, masked, swept-back hair.
  melee: { outfit: 0x4a3566, accent: 0x34343f, hair: 0x3a3450, skin: 0xe3b48c, headband: 0x5a5a6e, mask: true, hairStyle: 'swept', eyes: 0xd0502a, scarf: 0xc8202e },
  // Forest green marksman with a sand cloak, topknot, masked.
  ranged: { outfit: 0x3f7a3c, accent: 0x6b4a2e, hair: 0x6a3d22, skin: 0xe3b48c, headband: 0x4f6a48, mask: true, hairStyle: 'topknot', eyes: 0x3aa860, cloak: 0xd9c08a },
};

/** Palette variants per enemy kind (same silhouette family, different colours / hair). */
const VARIANTS: Record<Exclude<ActorKind, 'player'>, NinjaLook[]> = {
  melee: [
    LOOKS.melee,
    { ...LOOKS.melee, outfit: 0x2f4a6e, hair: 0xb8c0cc, scarf: 0x2f8f8a, eyes: 0x8a6ad8, hairStyle: 'long' },
    { ...LOOKS.melee, outfit: 0x6e2f3a, accent: 0x3a2e2e, hair: 0xd9622b, scarf: 0xefe2c4, hairStyle: 'spiky' },
  ],
  ranged: [
    LOOKS.ranged,
    { ...LOOKS.ranged, outfit: 0x5a6e3c, cloak: 0xc8452f, hair: 0x2a2f4a, hairStyle: 'long' },
    { ...LOOKS.ranged, outfit: 0x2f6e6a, cloak: 0xefe2c4, hair: 0x8a5a2a, eyes: 0xd0a02a },
  ],
};

/** Random look for an enemy of `kind` (player always gets LOOKS.player). `rng` returns [0, 1). */
export function pickEnemyLook(kind: ActorKind, rng: () => number = Math.random): NinjaLook {
  if (kind === 'player') return LOOKS.player;
  const v = VARIANTS[kind];
  return v[Math.min(v.length - 1, Math.floor(rng() * v.length))];
}

/** Display names for enemies (lock-on bar). */
export const NAMES: Record<Exclude<ActorKind, 'player'>, string[]> = {
  melee: ['Rogue Chūnin', 'Mist Swordsman', 'Sound Brawler'],
  ranged: ['Rain Kunoichi', 'Sand Marksman', 'Cloud Archer'],
};
