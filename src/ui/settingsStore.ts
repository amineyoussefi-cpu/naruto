import { DEFAULT_SETTINGS, SETTINGS_LIMITS, SETTINGS_STORAGE_KEY, type Settings } from '../config/settings';

type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Coerces untrusted data into valid Settings, falling back to defaults field by field. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const L = SETTINGS_LIMITS;
  return {
    masterVolume: clamp(r.masterVolume, L.masterVolume.min, L.masterVolume.max, d.masterVolume),
    sensitivity: clamp(r.sensitivity, L.sensitivity.min, L.sensitivity.max, d.sensitivity),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
    layout: r.layout === 'qwerty' || r.layout === 'azerty' || r.layout === 'auto' ? r.layout : d.layout,
    showFps: typeof r.showFps === 'boolean' ? r.showFps : d.showFps,
    graphics: r.graphics === 'high' || r.graphics === 'low' ? r.graphics : d.graphics,
    character: r.character === 'naruto' || r.character === 'sasuke' || r.character === 'kakashi' ? r.character : d.character,
  };
}

export function loadSettings(store: Store): Settings {
  try {
    const text = store?.getItem(SETTINGS_STORAGE_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Returns false when storage is missing, full or blocked. */
export function saveSettings(store: Store, s: Settings): boolean {
  try {
    if (!store) return false;
    store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeSettings(s)));
    return true;
  } catch {
    return false;
  }
}

/** localStorage, or null where the accessor itself throws (privacy modes, Node). */
export function browserStorage(): Store {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
