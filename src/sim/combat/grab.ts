import type { QteDir, QteState } from '../../core/types';

/** Pure grab-sequence logic (no Three.js): arrow order, inputs, timeout. Owner: combat agent. */
export const QTE_DIRS: QteDir[] = ['up', 'down', 'left', 'right'];

export function randomArrows(count: number, rng: () => number = Math.random): QteDir[] {
  return Array.from({ length: count }, () => QTE_DIRS[Math.floor(rng() * QTE_DIRS.length) % QTE_DIRS.length]);
}

export function createQte(targetId: number, arrows: QteDir[], time: number): QteState {
  return { targetId, arrows, index: 0, timeLeft: time, timeTotal: time, result: 'active', done: false };
}

/** Applies one arrow click. 'hit' = correct (more to go), 'complete' = last one, 'miss' = wrong (ends), 'ignored' = already over. */
export function qteApply(q: QteState, dir: QteDir): 'hit' | 'miss' | 'complete' | 'ignored' {
  if (q.done) return 'ignored';
  if (q.arrows[q.index] !== dir) {
    qteFinish(q, 'miss');
    return 'miss';
  }
  q.index++;
  if (q.index >= q.arrows.length) {
    qteFinish(q, 'complete');
    return 'complete';
  }
  q.result = 'hit';
  return 'hit';
}

/** Advances the timer (sim dt); returns true when the sequence just timed out. */
export function qteTick(q: QteState, dt: number): boolean {
  if (q.done) return false;
  q.timeLeft = Math.max(0, q.timeLeft - dt);
  if (q.timeLeft > 0) return false;
  qteFinish(q, 'timeout');
  return true;
}

export function qteFinish(q: QteState, result: Exclude<QteState['result'], 'active' | 'hit'>): void {
  if (q.done) return;
  q.result = result;
  q.done = true;
}
