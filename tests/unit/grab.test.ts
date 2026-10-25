import { describe, expect, it } from 'vitest';
import { createQte, qteApply, qteFinish, qteTick, randomArrows } from '../../src/combat/grab';
import type { QteDir } from '../../src/core/types';

const ARROWS: QteDir[] = ['up', 'left', 'down', 'right', 'up', 'down'];

describe('grab sequence', () => {
  it('random arrows have the requested length and valid directions', () => {
    const a = randomArrows(6, () => 0.999);
    expect(a).toEqual(['right', 'right', 'right', 'right', 'right', 'right']);
    expect(randomArrows(6)).toHaveLength(6);
  });

  it('accepts the arrows in order and completes on the last one', () => {
    const q = createQte(7, ARROWS, 4);
    const results = ARROWS.map((d) => qteApply(q, d));
    expect(results).toEqual(['hit', 'hit', 'hit', 'hit', 'hit', 'complete']);
    expect(q).toMatchObject({ index: 6, result: 'complete', done: true });
    expect(qteApply(q, 'up')).toBe('ignored');
  });

  it('a wrong arrow ends the sequence with miss', () => {
    const q = createQte(1, ARROWS, 4);
    qteApply(q, 'up');
    expect(qteApply(q, 'right')).toBe('miss');
    expect(q).toMatchObject({ index: 1, result: 'miss', done: true });
  });

  it('times out on sim time only, and finishing twice keeps the first result', () => {
    const q = createQte(1, ARROWS, 1);
    expect(qteTick(q, 0.5)).toBe(false);
    expect(q.timeLeft).toBeCloseTo(0.5);
    expect(qteTick(q, 0.6)).toBe(true);
    expect(q).toMatchObject({ result: 'timeout', done: true, timeLeft: 0 });
    qteFinish(q, 'interrupted');
    expect(q.result).toBe('timeout');
    expect(qteTick(q, 1)).toBe(false);
  });
});
