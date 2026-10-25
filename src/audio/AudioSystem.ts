import type { EventBus } from '../core/events';
import type { AttackKind } from '../core/types';

/** Audio tuning (gains are linear 0..1, times in seconds). */
const AUDIO = {
  maxVoices: 24,
  sfxGain: 0.8,
  musicGain: 0.6,
  /** Footsteps are frequent: keep them quiet. */
  footstepGain: 0.08,
  pauseFade: 0.08,
};

type Wave = OscillatorType;

/**
 * Synthesized WebAudio sound effects (no audio files needed), driven by gameplay events.
 * Gameplay SFX go through `sfx` (muted while paused); UI clicks and stingers through `ui` (always live).
 * Every method is a no-op if WebAudio is unavailable.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ui: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private volume = 0.7;
  private paused = false;
  private voices = 0;
  private readonly unsub: (() => void)[] = [];

  constructor(private readonly events: EventBus) {
    const on = this.events.on.bind(this.events);
    this.unsub.push(
      on('attackStart', (e) => this.attack(e.kind)),
      on('damage', (e) => {
        if (e.blocked) this.clang();
        else if (e.kind === 'combo5') this.launcher();
        else this.impact(e.killed || e.kind === 'combo3' || e.kind === 'combo4' || e.kind === 'special');
      }),
      on('technique', () => this.boom()),
      on('jump', (e) => {
        if (!e.air) { this.tone('sine', 280, 620, 0.12, 0.12); return; }
        this.noise(0.25, 0.22, 'bandpass', 900, 3200, 2); // airy rising swish
        this.tone('sine', 520, 1100, 0.16, 0.08);
      }),
      on('chakraDash', (e) => {
        this.noise(0.3, 0.32, 'bandpass', 3500, 700, 1.4); // falling whoosh
        this.tone('sawtooth', 220, e.homing ? 520 : 380, 0.22, 0.05, 0, 0.01, 1600); // chakra surge
      }),
      on('substitution', () => {
        this.noise(0.35, 0.3, 'lowpass', 1800, 200); // smoke poof
        this.tone('triangle', 620, 560, 0.09, 0.3, 0.06, 0.002, 2500); // wooden "tok"
        this.tone('sine', 310, 280, 0.12, 0.2, 0.06, 0.002);
      }),
      on('land', (e) => this.noise(0.12, Math.min(0.1 + e.impact * 0.02, 0.45), 'lowpass', 500, 120)),
      on('footstep', (e) => this.noise(0.05, AUDIO.footstepGain * (e.sprint ? 1.4 : 1), 'lowpass', 900, 300)),
      on('dodge', () => this.noise(0.22, 0.25, 'bandpass', 2400, 500, 1.5)),
      on('chakraFail', () => { this.tone('square', 110, 100, 0.12, 0.12); this.tone('square', 110, 95, 0.12, 0.12, 0.15); }),
      on('concentrateStart', () => { this.tone('sine', 110, 112, 1.4, 0.18, 0, 0.4); this.tone('triangle', 165, 168, 1.4, 0.08, 0, 0.5); }),
      on('telegraph', () => { this.tone('sine', 1500, 1450, 0.25, 0.12); this.tone('sine', 2250, 2200, 0.15, 0.05); }),
      on('climbStart', () => this.noise(0.08, 0.12, 'bandpass', 1400, 900)),
      on('respawn', () => { this.noise(0.4, 0.25, 'bandpass', 600, 2400); this.tone('sine', 400, 900, 0.3, 0.1); }),
      on('projectileHit', (e) => (e.hitActor ? this.impact(false) : this.tone('triangle', 2400, 1800, 0.08, 0.1))),
      on('death', () => { this.tone('sawtooth', 220, 55, 0.6, 0.12, 0, 0.01, 900); this.noise(0.35, 0.2, 'lowpass', 800, 100); }),
      on('waveStart', () => { this.taiko(0); this.taiko(0.22); this.taiko(0.44, 1.4); }),
      on('waveCleared', () => this.arpeggio([523, 659, 784, 1047], 0.09, 'triangle', 0.14)),
      // Victory / defeat stingers play on the UI bus because the game pauses right after these states.
      on('stateChange', (e) => {
        if (e.state === 'victory') this.arpeggio([392, 523, 659, 784, 1047, 1319], 0.11, 'triangle', 0.16, true);
        else if (e.state === 'defeat') this.arpeggio([440, 392, 349, 262, 196], 0.18, 'sawtooth', 0.08, true);
      }),
    );
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        const comp = ctx.createDynamicsCompressor();
        comp.connect(ctx.destination);
        this.master = ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(comp);
        this.sfx = ctx.createGain();
        this.sfx.gain.value = this.paused ? 0 : AUDIO.sfxGain;
        this.sfx.connect(this.master);
        this.ui = ctx.createGain();
        this.ui.gain.value = AUDIO.musicGain;
        this.ui.connect(this.master);
        const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
        this.ctx = ctx;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = Math.min(Math.max(v, 0), 1);
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  /** Mute/unmute gameplay sounds (pause). UI clicks and stingers stay audible. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.ctx && this.sfx) this.sfx.gain.setTargetAtTime(paused ? 0 : AUDIO.sfxGain, this.ctx.currentTime, AUDIO.pauseFade / 3);
  }

  /** Short click for menu buttons. */
  playUiClick(): void {
    this.tone('square', 1200, 900, 0.04, 0.06, 0, 0.002, 4000, true);
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    try { void this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null;
  }

  // ------------------------------------------------------------------ sound recipes

  private attack(kind: AttackKind): void {
    if (kind === 'kunai' || kind === 'enemyRanged') {
      this.noise(0.12, 0.22, 'highpass', 3000, 5000);
      this.tone('triangle', 3200, 2600, 0.05, 0.06);
    } else if (kind === 'special') {
      this.tone('sawtooth', 180, 900, 0.5, 0.08, 0, 0.05, 1800);
      this.noise(0.5, 0.18, 'bandpass', 400, 3000, 3);
    } else {
      const heavy = kind === 'combo3' || kind === 'combo4' || kind === 'combo5';
      this.noise(heavy ? 0.22 : 0.14, heavy ? 0.35 : 0.25, 'bandpass', 600, heavy ? 2000 : 2600, 1.2);
    }
  }

  private impact(heavy: boolean): void {
    this.tone('sine', heavy ? 140 : 180, 45, heavy ? 0.25 : 0.14, heavy ? 0.55 : 0.4);
    this.noise(heavy ? 0.14 : 0.08, heavy ? 0.4 : 0.3, 'lowpass', 2200, 300);
  }

  /** Launcher finisher: deep thump plus a rising swoosh as the enemy flies. */
  private launcher(): void {
    this.impact(true);
    this.tone('sine', 90, 40, 0.4, 0.5);
    this.noise(0.35, 0.25, 'bandpass', 500, 3000, 1.2, 0.04);
  }

  private clang(): void {
    this.tone('triangle', 880, 860, 0.3, 0.14);
    this.tone('square', 1347, 1320, 0.18, 0.05, 0, 0.002, 3500);
    this.noise(0.06, 0.2, 'highpass', 4000, 3000);
  }

  private boom(): void {
    this.tone('sine', 120, 35, 0.7, 0.7);
    this.noise(0.6, 0.45, 'lowpass', 1800, 80);
    this.tone('sawtooth', 600, 1200, 0.2, 0.05, 0, 0.005, 2500);
  }

  private taiko(delay: number, strength = 1): void {
    this.tone('sine', 95, 48, 0.5, 0.6 * strength, delay);
    this.noise(0.08, 0.25 * strength, 'lowpass', 600, 150, 1, delay);
  }

  private arpeggio(freqs: number[], step: number, type: Wave, gain: number, uiBus = false): void {
    freqs.forEach((f, i) => this.tone(type, f, f, step * 2.2, gain, i * step, 0.01, 3000, uiBus));
  }

  /** Oscillator with a pitch sweep and attack/exponential-decay envelope. */
  private tone(type: Wave, f0: number, f1: number, dur: number, gain: number, delay = 0, attack = 0.005, lowpass = 0, uiBus = false): void {
    const ctx = this.begin(uiBus);
    if (!ctx) return;
    try {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
      const g = this.envelope(ctx, t, attack, dur, gain);
      let node: AudioNode = osc;
      if (lowpass > 0) {
        const flt = ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = lowpass;
        node.connect(flt);
        node = flt;
      }
      node.connect(g);
      g.connect(uiBus ? this.ui! : this.sfx!);
      this.track(osc, t, dur);
    } catch {
      /* never let audio break the game */
    }
  }

  /** Filtered white noise with a sweeping cutoff. */
  private noise(dur: number, gain: number, filter: BiquadFilterType, f0: number, f1: number, q = 1, delay = 0): void {
    const ctx = this.begin(false);
    if (!ctx || !this.noiseBuf) return;
    try {
      const t = ctx.currentTime + delay;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = filter;
      flt.Q.value = q;
      flt.frequency.setValueAtTime(f0, t);
      flt.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
      const g = this.envelope(ctx, t, 0.004, dur, gain);
      src.connect(flt).connect(g).connect(this.sfx!);
      this.track(src, t, dur);
    } catch {
      /* ignore */
    }
  }

  private begin(uiBus: boolean): AudioContext | null {
    if (!this.ctx || this.ctx.state === 'closed') return null;
    if (!uiBus && this.paused) return null;
    if (this.voices >= AUDIO.maxVoices) return null;
    return this.ctx;
  }

  private envelope(ctx: AudioContext, t: number, attack: number, dur: number, gain: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + Math.min(attack, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  private track(src: AudioScheduledSourceNode, t: number, dur: number): void {
    this.voices++;
    src.onended = () => { this.voices--; src.disconnect(); };
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
