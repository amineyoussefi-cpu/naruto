import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../../src/config/settings';
import { loadSettings, sanitizeSettings, saveSettings } from '../../src/ui/settingsStore';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('settingsStore', () => {
  it('returns defaults when storage is missing or empty', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(mem())).toEqual(DEFAULT_SETTINGS);
  });

  it('survives bad JSON and throwing storage', () => {
    expect(loadSettings(mem({ [SETTINGS_STORAGE_KEY]: '{nope' }))).toEqual(DEFAULT_SETTINGS);
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(throwing, DEFAULT_SETTINGS)).toBe(false);
    expect(saveSettings(null, DEFAULT_SETTINGS)).toBe(false);
  });

  it('clamps out-of-range values and rejects wrong types', () => {
    const s = sanitizeSettings({ masterVolume: 5, sensitivity: -1, invertY: 'yes', layout: 'dvorak', showFps: 1 });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, masterVolume: 1, sensitivity: 0.2 });
    expect(sanitizeSettings({ masterVolume: NaN }).masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
    expect(sanitizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips valid settings', () => {
    const store = mem();
    const s = { masterVolume: 0.3, sensitivity: 2.5, invertY: true, layout: 'azerty' as const, showFps: true };
    expect(saveSettings(store, s)).toBe(true);
    expect(loadSettings(store)).toEqual(s);
  });
});
