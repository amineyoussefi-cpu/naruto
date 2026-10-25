import type { EventBus } from '../core/events';

/**
 * Synthesized WebAudio sound effects (no audio files needed), driven by gameplay events.
 * Owner: visuals/audio agent. STUB.
 */
export class AudioSystem {
  constructor(private readonly events: EventBus) {}
  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void { void this.events; }
  setVolume(_v: number): void {}
  /** Mute/unmute everything (pause). */
  setPaused(_paused: boolean): void {}
  dispose(): void {}
}
