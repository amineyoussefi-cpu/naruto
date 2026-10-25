/** User settings persisted to localStorage. Owner: UI agent. */
export interface Settings {
  masterVolume: number; // 0..1
  sensitivity: number; // 0.2..3
  invertY: boolean;
  layout: 'auto' | 'qwerty' | 'azerty';
  showFps: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.7,
  sensitivity: 1,
  invertY: false,
  layout: 'auto',
  showFps: false,
};
export const SETTINGS_STORAGE_KEY = 'shinobi-arena.settings.v1';
