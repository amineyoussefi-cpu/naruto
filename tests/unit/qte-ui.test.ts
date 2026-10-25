import { describe, expect, it } from 'vitest';
import type { QteState } from '../../src/core/types';
import { qteArrowState, qteBanner } from '../../src/ui/qteView';

const q = (o: Partial<QteState> = {}): QteState => ({
  targetId: 1, arrows: ['up', 'down', 'left', 'right', 'up', 'down'], index: 2, timeLeft: 1, timeTotal: 3, result: 'active', done: false, ...o,
});

describe('qte overlay view', () => {
  it('marks done, next and pending arrows', () => {
    const s = q();
    expect([0, 1, 2, 3].map((i) => qteArrowState(s, i, -1))).toEqual(['done', 'done', 'next', 'pending']);
  });

  it('marks the wrong arrow from a click or a final miss', () => {
    expect(qteArrowState(q(), 2, 2)).toBe('wrong');
    expect(qteArrowState(q({ done: true, result: 'miss' }), 2, -1)).toBe('wrong');
    expect(qteArrowState(q({ done: true, result: 'timeout' }), 2, -1)).toBe('pending');
  });

  it('shows the outcome banner only once done', () => {
    expect(qteBanner(q())).toBe('');
    expect(qteBanner(q({ done: true, result: 'complete', index: 6 }))).toBe('Enchaînement parfait !');
    expect(qteBanner(q({ done: true, result: 'miss' }))).toBe('Raté !');
    expect(qteBanner(q({ done: true, result: 'timeout' }))).toBe('Trop tard !');
    expect(qteBanner(q({ done: true, result: 'interrupted' }))).toBe('Interrompu');
  });
});
