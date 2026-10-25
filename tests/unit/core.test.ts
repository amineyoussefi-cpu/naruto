import { describe, expect, it, vi } from 'vitest';
import { FixedStepper } from '../../src/core/loop';
import { EventBus } from '../../src/core/events';

describe('FixedStepper', () => {
  it('runs the same number of steps regardless of frame rate', () => {
    const count = (fps: number) => {
      const s = new FixedStepper(1 / 60);
      let n = 0;
      for (let i = 0; i < fps; i++) n += s.advance(1 / fps);
      return n;
    };
    expect(count(30)).toBeGreaterThanOrEqual(59);
    expect(count(144)).toBeGreaterThanOrEqual(59);
    expect(Math.abs(count(30) - count(144))).toBeLessThanOrEqual(1);
  });

  it('clamps huge frames so a stall cannot cause a time jump', () => {
    const s = new FixedStepper(1 / 60, 0.25);
    expect(s.advance(10)).toBe(15);
  });

  it('reset drops leftover time (resume from pause)', () => {
    const s = new FixedStepper(1 / 60);
    s.advance(0.01);
    expect(s.alpha).toBeGreaterThan(0);
    s.reset();
    expect(s.alpha).toBe(0);
    expect(s.advance(0)).toBe(0);
  });
});

describe('EventBus', () => {
  it('delivers, unsubscribes and clears', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('dodge', fn);
    bus.emit('dodge', { id: 1 });
    off();
    bus.emit('dodge', { id: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ id: 1 });
    bus.on('dodge', fn);
    bus.clear();
    bus.emit('dodge', { id: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('tolerates handlers that unsubscribe during emit', () => {
    const bus = new EventBus();
    const calls: string[] = [];
    const off = bus.on('jump', () => { calls.push('a'); off(); });
    bus.on('jump', () => calls.push('b'));
    bus.emit('jump', { id: 1 });
    bus.emit('jump', { id: 1 });
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});
