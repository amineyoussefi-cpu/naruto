import type { CharacterId } from '../core/types';

/** Playable characters: shared movement/combat, one distinct special each (key E). */
export const CHARACTERS: Record<CharacterId, { name: string; special: 'rasengan' | 'sharingan' | 'chidori'; specialLabel: string; blurb: string }> = {
  naruto: { name: 'Naruto', special: 'rasengan', specialLabel: 'Rasengan', blurb: 'Rasengan chargé : maintenez E, relâchez pour frapper et projeter.' },
  sasuke: { name: 'Sasuke', special: 'sharingan', specialLabel: 'Sharingan', blurb: 'Sharingan : genjutsu de zone, les ennemis proches sont désorientés.' },
  kakashi: { name: 'Kakashi', special: 'chidori', specialLabel: 'Chidori', blurb: 'Chidori chargé : maintenez E, relâchez pour transpercer tout sur la ligne.' },
};
export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];
