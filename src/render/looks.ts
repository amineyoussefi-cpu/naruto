import type { ActorKind } from '../core/types';
import type { NinjaLook } from './NinjaModel';

/** Colour schemes per ninja archetype. Owner: characters. */
export const LOOKS: Record<ActorKind, NinjaLook> = {
  player: { outfit: 0xff7a1a, accent: 0x1d2b4f, hair: 0xffd23a, skin: 0xf2c49b, headband: 0x3a5bd6 },
  melee: { outfit: 0x2b2b38, accent: 0xb3202a, hair: 0x1a1a1a, skin: 0xd9a77e, headband: 0x777777, mask: true },
  ranged: { outfit: 0x3c5a3a, accent: 0xd8c27a, hair: 0x4a2c1a, skin: 0xd9a77e, headband: 0x777777, mask: true },
};

/** Display names for enemies (lock-on bar). */
export const NAMES: Record<Exclude<ActorKind, 'player'>, string[]> = {
  melee: ['Rogue Chūnin', 'Mist Swordsman', 'Sound Brawler'],
  ranged: ['Rain Kunoichi', 'Sand Marksman', 'Cloud Archer'],
};
