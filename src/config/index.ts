/**
 * Central gameplay configuration. Every tunable value lives in this folder;
 * see docs/CONFIG.md for descriptions.
 */
export { MOVEMENT } from './movement';
export { CAMERA } from './camera';
export { COMBAT } from './combat';
export { CHAKRA } from './chakra';
export { ENEMIES } from './enemies';
export { WAVES, WAVE_INTERMISSION } from './waves';
export { CHARACTERS, CHARACTER_IDS } from './characters';
export { INPUT } from './input';
export { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, type Settings } from './settings';
/** Fixed simulation step (s). */
export const SIM_DT = 1 / 60;
