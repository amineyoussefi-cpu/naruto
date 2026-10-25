import { describe, expect, it } from 'vitest';
import { ChordDetector } from '../../src/core/chord';

describe('ChordDetector (grab = left + right click)', () => {
  it('two presses inside the window form a chord and are swallowed until released', () => {
    const c = new ChordDetector('Mouse0', 'Mouse2', 120);
    expect(c.press('Mouse0', 0)).toBe(false);
    expect(c.suppressed('Mouse0')).toBe(true);
    expect(c.press('Mouse2', 80)).toBe(true);
    expect(c.flush(1000)).toEqual([]);
    expect(c.suppressed('Mouse0') && c.suppressed('Mouse2')).toBe(true);
    expect(c.release('Mouse0')).toBe(false);
    expect(c.suppressed('Mouse0')).toBe(false);
  });

  it('a lone press is delivered after the window', () => {
    const c = new ChordDetector('Mouse0', 'Mouse2', 120);
    c.press('Mouse0', 0);
    expect(c.flush(100)).toEqual([]);
    expect(c.flush(121)).toEqual(['Mouse0']);
    expect(c.suppressed('Mouse0')).toBe(false);
  });

  it('presses too far apart are two normal presses', () => {
    const c = new ChordDetector('Mouse0', 'Mouse2', 120);
    c.press('Mouse0', 0);
    expect(c.flush(130)).toEqual(['Mouse0']);
    expect(c.press('Mouse2', 200)).toBe(false);
    expect(c.flush(400)).toEqual(['Mouse2']);
  });

  it('a quick click released inside the window is delivered on release', () => {
    const c = new ChordDetector('Mouse0', 'Mouse2', 120);
    c.press('Mouse0', 0);
    expect(c.release('Mouse0')).toBe(true);
    expect(c.flush(500)).toEqual([]);
  });
});
