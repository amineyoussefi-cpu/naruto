import type { QteDir, QteState } from '../core/types';

/** Pure view logic for the grab six-arrow sequence overlay (unit-tested). Owner: UI agent. */
export const QTE_GLYPHS: Record<QteDir, string> = { up: '↑', down: '↓', left: '←', right: '→' };
export const QTE_DIR_LABELS: Record<QteDir, string> = { up: 'Haut', down: 'Bas', left: 'Gauche', right: 'Droite' };

const OUTCOME: Record<QteState['result'], string> = {
  active: '', hit: '', complete: 'Enchaînement parfait !', miss: 'Raté !', timeout: 'Trop tard !', interrupted: 'Interrompu',
};

export type QteArrowState = 'done' | 'wrong' | 'next' | 'pending';

/** `wrong` = index of the last wrong click (-1 if none). */
export function qteArrowState(q: QteState, i: number, wrong: number): QteArrowState {
  if (i < q.index) return 'done';
  if (i === wrong || (q.done && q.result === 'miss' && i === q.index)) return 'wrong';
  if (i === q.index && !q.done) return 'next';
  return 'pending';
}

/** Outcome banner text, empty while the sequence is running. */
export function qteBanner(q: QteState): string {
  return q.done ? OUTCOME[q.result] : '';
}
