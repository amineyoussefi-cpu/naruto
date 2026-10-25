/** User settings persisted to localStorage. Owner: UI agent. */
export interface Settings {
  masterVolume: number; // 0..1
  sensitivity: number; // 0.2..3
  invertY: boolean;
  layout: 'auto' | 'qwerty' | 'azerty';
  showFps: boolean;
  /** 'high' = anime post-processing (ink outlines, bloom, speed lines) + shadows; 'low' = direct render. */
  graphics: 'high' | 'low';
}
export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.7,
  sensitivity: 1,
  invertY: false,
  layout: 'auto',
  showFps: false,
  graphics: 'high',
};
export const SETTINGS_STORAGE_KEY = 'shinobi-arena.settings.v1';

/** Valid ranges for numeric settings (loaded values are clamped to these). */
export const SETTINGS_LIMITS = {
  masterVolume: { min: 0, max: 1 }, // linear gain
  sensitivity: { min: 0.2, max: 3, step: 0.1 }, // camera mouse multiplier
};

/** Render-only HUD timings (seconds unless noted). */
export const UI_CONFIG = {
  trailDelay: 0.45, // damage trail waits this long before catching up
  trailSpeed: 0.6, // fraction of max bar per second the damage trail shrinks
  vignetteTime: 0.45, // red damage vignette fade duration
  chakraFailTime: 1.1, // "Chakra insuffisant" message duration
  bannerTime: 2.4, // wave banner duration
};
