import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AnimState } from '../core/types';
import { COMBAT } from '../config/combat';
import { toon } from './toon';
import { glowMaterial } from './PostFX';
import { boltGeometry } from './fx/shapes';
import { heroDecalMaterial, heroParts, heroSurfaceParams, isHeroDecal, type HeroPartName, type HeroParts } from './heroAsset';

export type HairStyle = 'spiky' | 'swept' | 'topknot' | 'long' | 'duckTail' | 'leaning';

export interface NinjaLook {
  /** Main outfit colour (jacket, trousers). */
  outfit: number;
  /** Secondary (vest yoke, collar, belt, sandals). */
  accent: number;
  hair: number;
  skin: number;
  /** Headband cloth colour (the plate is always blank steel). */
  headband: number;
  /** Optional mask (enemies): lower face covered, eyes only. */
  mask?: boolean;
  scale?: number;
  /** Hair silhouette (default 'spiky'). */
  hairStyle?: HairStyle;
  /** Iris colour (default blue). */
  eyes?: number;
  /** Trailing neck scarf colour (none when omitted). */
  scarf?: number;
  /** Shoulder mantle / short cloak colour (none when omitted). */
  cloak?: number;
  /** 'hero': use the Blender model (public/models/hero.glb) instead of the procedural body, when loaded. */
  model?: 'hero';
  /** Trousers + sandals colour (default `outfit` / `accent`). */
  pants?: number;
  /** Chest colour (default `outfit`), e.g. a flak vest over the sleeves. */
  vest?: number;
  /** Belt / sash colour (default `accent`). */
  belt?: number;
  /** Mask colour (default dark slate). */
  maskColor?: number;
  /** Forearms covered by the outfit colour instead of bare skin. */
  longSleeves?: boolean;
  /** Three ink whisker marks on each cheek. */
  whiskers?: boolean;
  /** Headband slanted over the left eye: roll (rad, < 0 drops the left side), forward pitch (rad), drop (m). */
  bandTilt?: { roll: number; pitch: number; drop: number };
  /** Draw the small wave mark on the headband plate (default true). */
  plateMark?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Pose model (pure, unit-tested): a pose is a flat array of joint angles / offsets.
// ---------------------------------------------------------------------------------------------

/** Pose channels. Angles in radians. Sign conventions are documented in `applyPose`. */
export const CH = {
  bodyY: 0, bodyPitch: 1, bodyRoll: 2, bodyYaw: 3,
  torsoPitch: 4, torsoTwist: 5, torsoRoll: 6, headPitch: 7, headYaw: 8,
  lShX: 9, lShZ: 10, lEl: 11, rShX: 12, rShZ: 13, rEl: 14,
  lHipX: 15, lHipZ: 16, lKnee: 17, rHipX: 18, rHipZ: 19, rKnee: 20,
} as const;
export const POSE_SIZE = 21;

/** Animation tuning (render-only). */
const ANIM = {
  /** Pose blend rates (1/s): looping states, one-shot actions, death collapse. */
  blendLoop: 12, blendAction: 30, blendDead: 10,
  /** Run-cycle phase advance per metre travelled (rad/m). */
  strideRun: 1.25, strideSprint: 1.0,
  /** Below this speed the run cycle fades out (m/s). */
  runFullSpeed: 3,
  breathRate: 2.2,
  /** Idle weight-shift rate (rad/s) and amplitude (rad). */
  swayRate: 0.8, swayAmp: 0.035,
  /** Dodge roll length (s) — matches the combat dodge. */
  dodgeTime: COMBAT.dodge.duration,
  deathTime: 0.7,
  /** Ninja-run forward lean (rad, ~35°). */
  sprintLean: 0.61,
  /** Hit-flash and telegraph emissive strength. */
  flashStrength: 1.2, telegraphStrength: 0.9,
  /** Scarf / headband cloth: max trail angle (rad) reached at `clothSpeed` m/s. */
  clothTrail: 1.0, clothSpeed: 12,
  /** Chakra-dash lean (rad, ~60°: split between whole-body pitch and torso) and lean-in time (s). */
  dashBodyPitch: 0.62, dashTorsoPitch: 0.42, dashLeanIn: 0.06,
  /** Launched tumble: backward spin rate (rad/s) and limb flail rate (rad/s). */
  launchSpin: 7.5, launchFlail: 15,
  /** Substitution reappear: rise from the crouched seal over this time (s). */
  substitutionRise: 0.35,
  /** Charge pose: tremble amplitude (rad) reached after `chargeShakeTime` seconds of holding. */
  chargeShake: 0.035, chargeShakeTime: 1.5,
  /** Chidori dash leg cycle rate (rad/s). */
  chidoriStride: 22,
  /** Grab strikes: wind-up and snap times (s). */
  strikeWind: 0.05, strikeSnap: 0.08,
  /** Hand orb: scale at charge 0 / 1, swirl speed multiplier at charge 0 / 1, lightning re-roll interval (s). */
  orbMin: 0.55, orbMax: 1.3, swirlMin: 0.5, swirlMax: 2.2, boltFlicker: 0.05,
  /** Chidori ground arcs appear above this charge. */
  arcCharge: 0.6,
  /** Daze ring spin (rad/s) and height above the head centre (m). */
  dazeSpin: 4, dazeHeight: 0.3,
  /** Downed crawl: cycle advance per metre (rad/m) and the speed (m/s) above which the crawl starts / is full. */
  strideCrawl: 6, crawlStart: 0.2, crawlFull: 0.7,
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => { const c = clamp01(x); return c * c * (3 - 2 * c); };
/** Ease-out with overshoot: snappy strike that slightly passes its target (follow-through). */
const backOut = (x: number) => { const c = clamp01(x) - 1; return 1 + 2.7 * c * c * c + 1.7 * c * c; };
const TAU = Math.PI * 2;
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
/** Combo hit timings; falls back to the last configured hit if the config has fewer entries. */
const comboHit = (i: number) => COMBAT.combo[Math.min(i, COMBAT.combo.length - 1)];
/** Grab strike curve: `wind` pull-back 0→1→0, `p` snap with overshoot, held at the end. */
const strike = (t: number) => ({
  wind: t < ANIM.strikeWind ? smooth(t / ANIM.strikeWind) : 1 - smooth((t - ANIM.strikeWind) / 0.05),
  p: t < ANIM.strikeWind ? 0 : backOut((t - ANIM.strikeWind) / ANIM.strikeSnap),
});

/** One-shot states snap faster to their pose. */
const ACTION_STATES = new Set<AnimState>(['attack1', 'attack2', 'attack3', 'attack4', 'attack5', 'throw', 'special', 'dodge', 'hit', 'telegraph', 'guard', 'dash', 'launched', 'substitution',
  'chidori', 'sharingan', 'strikeUp', 'strikeDown', 'strikeLeft', 'strikeRight', 'grabFinisher']);

/** Fills `out` with the target pose. `phase` = locomotion cycle, `time` = free-running clock. */
export function computePose(anim: AnimState, t: number, phase: number, time: number, speed: number, out: Float32Array): Float32Array {
  out.fill(0);
  const P = CH;
  // Neutral relaxed stance.
  out[P.lShZ] = out[P.rShZ] = 0.12;
  out[P.lEl] = out[P.rEl] = 0.2;
  out[P.lKnee] = out[P.rKnee] = 0.08;
  const fightStance = () => {
    out[P.bodyY] = -0.08;
    out[P.lHipX] = -0.45; out[P.lKnee] = 0.45; out[P.rHipX] = 0.3; out[P.rKnee] = 0.3;
    out[P.lHipZ] = out[P.rHipZ] = 0.1;
  };
  switch (anim) {
    case 'idle': {
      const b = Math.sin(time * ANIM.breathRate);
      const w = Math.sin(time * ANIM.swayRate) * ANIM.swayAmp; // weight shift from foot to foot
      out[P.bodyY] = b * 0.012 - 0.02 - Math.abs(w) * 0.3;
      out[P.bodyRoll] = w; out[P.torsoRoll] = -w * 0.8; out[P.headYaw] = w * 2;
      out[P.torsoPitch] = 0.05 + b * 0.025;
      out[P.headPitch] = -b * 0.02;
      out[P.lShZ] = out[P.rShZ] = 0.16 + b * 0.03;
      out[P.lEl] = out[P.rEl] = 0.3;
      out[P.lHipZ] = 0.06 - w; out[P.rHipZ] = 0.06 + w;
      out[P.lKnee] = 0.12 + Math.max(0, -w) * 3; out[P.rKnee] = 0.12 + Math.max(0, w) * 3;
      break;
    }
    case 'run': {
      const a = clamp01(speed / ANIM.runFullSpeed);
      const s = Math.sin(phase);
      out[P.lHipX] = -0.8 * s * a; out[P.rHipX] = 0.8 * s * a;
      out[P.lKnee] = 0.25 + 0.85 * a * (0.5 + 0.5 * Math.cos(phase));
      out[P.rKnee] = 0.25 + 0.85 * a * (0.5 - 0.5 * Math.cos(phase));
      out[P.lShX] = 0.65 * s * a; out[P.rShX] = -0.65 * s * a;
      out[P.lEl] = out[P.rEl] = 1.3;
      out[P.torsoPitch] = 0.18 * a;
      out[P.torsoTwist] = 0.15 * s * a;
      out[P.bodyY] = -0.04 + 0.06 * Math.abs(Math.cos(phase)) * a;
      break;
    }
    case 'sprint': { // ninja run: strong forward lean, arms trailing straight back
      const s = Math.sin(phase);
      out[P.lHipX] = -1.05 * s - 0.15; out[P.rHipX] = 1.05 * s - 0.15;
      out[P.lKnee] = 0.3 + 1.3 * (0.5 + 0.5 * Math.cos(phase));
      out[P.rKnee] = 0.3 + 1.3 * (0.5 - 0.5 * Math.cos(phase));
      out[P.torsoPitch] = ANIM.sprintLean; out[P.headPitch] = -0.5;
      out[P.lShX] = out[P.rShX] = 1.25 + 0.05 * s;
      out[P.lShZ] = out[P.rShZ] = 0.18;
      out[P.lEl] = out[P.rEl] = 0.06;
      out[P.torsoTwist] = 0.06 * s;
      out[P.bodyY] = -0.12 + 0.07 * Math.abs(Math.cos(phase));
      break;
    }
    case 'jump':
      out[P.lHipX] = -1.0; out[P.lKnee] = 1.5; out[P.rHipX] = -0.15; out[P.rKnee] = 0.6;
      out[P.lShX] = -0.5; out[P.rShX] = 0.6; out[P.lShZ] = out[P.rShZ] = 0.5; out[P.lEl] = out[P.rEl] = 0.7;
      out[P.torsoPitch] = -0.1; out[P.headPitch] = -0.15;
      break;
    case 'fall': {
      const w = Math.sin(time * 9) * 0.15;
      out[P.lShZ] = 1.25 + w; out[P.rShZ] = 1.25 - w; out[P.lShX] = out[P.rShX] = -0.3; out[P.lEl] = out[P.rEl] = 0.4;
      out[P.lHipX] = -0.35; out[P.lKnee] = 0.5; out[P.rHipX] = 0.2; out[P.rKnee] = 0.25;
      out[P.torsoPitch] = 0.12; out[P.headPitch] = 0.25;
      break;
    }
    case 'climb': { // wall-walking: the whole model is turned onto the wall, so this is a light ninja run on its feet
      const a = clamp01(speed / ANIM.runFullSpeed);
      const s = Math.sin(phase);
      out[P.lHipX] = -0.85 * s * a - 0.1; out[P.rHipX] = 0.85 * s * a - 0.1;
      out[P.lKnee] = 0.35 + 0.9 * a * (0.5 + 0.5 * Math.cos(phase));
      out[P.rKnee] = 0.35 + 0.9 * a * (0.5 - 0.5 * Math.cos(phase));
      out[P.torsoPitch] = 0.15 + 0.3 * a; out[P.headPitch] = -0.2 * a;
      out[P.lShX] = out[P.rShX] = 0.3 + 0.8 * a; // arms trail back as speed builds
      out[P.lShZ] = out[P.rShZ] = 0.2;
      out[P.lEl] = out[P.rEl] = 0.5 - 0.35 * a;
      out[P.torsoTwist] = 0.08 * s * a;
      out[P.bodyY] = -0.06 + 0.05 * Math.abs(Math.cos(phase)) * a;
      break;
    }
    case 'attack1': { // straight jab (right): pull back, snap out with overshoot
      const c = COMBAT.combo[0];
      const wind = t < c.windup ? smooth(t / c.windup) : 1 - smooth((t - c.windup) / 0.05);
      const p = t < c.windup ? 0 : t < c.windup + c.active ? backOut((t - c.windup) / (c.active * 0.5)) : 1 - smooth((t - c.windup - c.active) / c.recovery);
      fightStance();
      out[P.rShX] = -0.4 + 0.35 * wind - 1.15 * p; out[P.rShZ] = 0.1; out[P.rEl] = 1.9 - 1.85 * p + 0.3 * wind;
      out[P.lShX] = -1.1; out[P.lShZ] = 0.15; out[P.lEl] = 2.0;
      out[P.torsoTwist] = -0.3 * wind + 0.55 * p; out[P.torsoPitch] = 0.12 + 0.15 * p;
      out[P.bodyY] -= 0.04 * wind;
      break;
    }
    case 'attack2': { // left hook
      const c = COMBAT.combo[1];
      const wind = t < c.windup ? smooth(t / c.windup) : 1 - smooth((t - c.windup) / 0.05);
      const p = t < c.windup ? 0 : t < c.windup + c.active ? backOut((t - c.windup) / (c.active * 0.6)) : 1 - smooth((t - c.windup - c.active) / c.recovery);
      fightStance();
      out[P.lShX] = -1.25 - 0.25 * p; out[P.lShZ] = 1.1 + 0.3 * wind - 1.5 * p; out[P.lEl] = 1.5;
      out[P.rShX] = -1.1; out[P.rShZ] = 0.15; out[P.rEl] = 2.0;
      out[P.torsoTwist] = 0.45 * wind - 0.8 * p; out[P.torsoPitch] = 0.18;
      out[P.bodyY] -= 0.05 * p + 0.03 * wind;
      break;
    }
    case 'attack3': { // spinning roundhouse kick
      const c = COMBAT.combo[2];
      const spinEnd = c.windup + c.active;
      out[P.bodyYaw] = smooth(t / spinEnd) * TAU;
      const p = t < c.windup * 0.5 ? 0 : t < spinEnd ? smooth((t - c.windup * 0.5) / (c.windup * 0.6)) : 1 - smooth((t - spinEnd) / c.recovery);
      out[P.rHipZ] = 1.5 * p; out[P.rHipX] = -0.35 * p; out[P.rKnee] = 0.15 + (1 - p) * 0.9;
      out[P.lKnee] = 0.35; out[P.lHipX] = -0.1;
      out[P.torsoRoll] = -0.45 * p; out[P.bodyRoll] = -0.15 * p;
      out[P.lShZ] = out[P.rShZ] = 0.3 + 0.9 * p; out[P.lEl] = out[P.rEl] = 0.6;
      out[P.bodyY] = 0.06 * p - 0.05;
      break;
    }
    case 'attack4': { // flying knee: crouch, hop up driving the right knee forward, hands clinching
      const c = comboHit(3);
      const wind = t < c.windup ? smooth(t / c.windup) : 1 - smooth((t - c.windup) / 0.06);
      const p = t < c.windup ? 0 : t < c.windup + c.active ? backOut((t - c.windup) / (c.active * 0.6)) : 1 - smooth((t - c.windup - c.active) / c.recovery);
      fightStance();
      out[P.bodyY] = -0.14 * wind + 0.32 * p;
      out[P.bodyPitch] = -0.12 * wind + 0.08 * p;
      out[P.rHipX] = 0.3 * wind - 1.95 * p; out[P.rKnee] = 0.4 * wind + 2.1 * p; out[P.rHipZ] = 0.05;
      out[P.lHipX] = mix(-0.45, 0.45, p); out[P.lKnee] = mix(0.45 + 0.4 * wind, 0.7, p);
      out[P.lShX] = out[P.rShX] = -0.3 * wind - 1.55 * p; out[P.lShZ] = out[P.rShZ] = 0.35 * wind - 0.3 * p;
      out[P.lEl] = out[P.rEl] = 1.0 + 0.3 * p;
      out[P.torsoPitch] = 0.1 + 0.3 * p; out[P.torsoTwist] = 0.25 * wind - 0.2 * p; out[P.headPitch] = -0.15 * p;
      break;
    }
    case 'attack5': { // launcher: deep crouch, then a rising two-hand palm strike lifting the whole body
      const c = comboHit(4);
      const crouch = t < c.windup ? smooth(t / c.windup) : 1 - smooth((t - c.windup) / 0.05);
      const p = t < c.windup ? 0 : t < c.windup + c.active ? backOut((t - c.windup) / (c.active * 0.6)) : 1 - 0.6 * smooth((t - c.windup - c.active) / c.recovery);
      out[P.bodyY] = -0.32 * crouch + 0.4 * p;
      out[P.lHipX] = -0.9 * crouch - 0.15 * p; out[P.lKnee] = 1.4 * crouch + 0.05 * p;
      out[P.rHipX] = 0.2 * crouch + 0.55 * p; out[P.rKnee] = 1.3 * crouch + 0.65 * p;
      out[P.lHipZ] = out[P.rHipZ] = 0.3 * crouch;
      out[P.lShX] = out[P.rShX] = 0.45 * crouch - 2.85 * p; out[P.lShZ] = out[P.rShZ] = 0.2 * crouch - 0.2 * p;
      out[P.lEl] = out[P.rEl] = 1.7 * crouch + 0.12 * p;
      out[P.torsoPitch] = 0.5 * crouch - 0.35 * p; out[P.headPitch] = 0.1 * crouch - 0.45 * p;
      out[P.torsoTwist] = -0.2 * crouch;
      break;
    }
    case 'dash': { // chakra dash: ~60° lean, arms swept back, legs stretched in a glide
      const k = backOut(t / ANIM.dashLeanIn);
      const w = Math.sin(time * 30) * 0.04; // wind flutter
      out[P.bodyPitch] = ANIM.dashBodyPitch * k; out[P.torsoPitch] = ANIM.dashTorsoPitch * k; out[P.headPitch] = -0.75 * k;
      out[P.bodyY] = -0.1 * k;
      out[P.lShX] = 0.8 * k + w; out[P.rShX] = 0.85 * k - w; out[P.lShZ] = out[P.rShZ] = 0.28; out[P.lEl] = out[P.rEl] = 0.05;
      out[P.lHipX] = -0.25 * k; out[P.lKnee] = 0.35; out[P.rHipX] = 0.7 * k; out[P.rKnee] = 0.2 + w;
      break;
    }
    case 'launched': { // airborne tumble: spins backward (direct-driven channel), limbs flailing
      const f = time * ANIM.launchFlail;
      out[P.bodyPitch] = -ANIM.launchSpin * t;
      out[P.bodyY] = 0.1;
      out[P.torsoPitch] = -0.35; out[P.headPitch] = -0.4;
      out[P.lShZ] = 1.3 + 0.35 * Math.sin(f); out[P.rShZ] = 1.3 + 0.35 * Math.sin(f + 2); out[P.lShX] = -0.6; out[P.rShX] = 0.4;
      out[P.lEl] = 0.5 + 0.3 * Math.sin(f + 1); out[P.rEl] = 0.5;
      out[P.lHipX] = -0.7 + 0.35 * Math.sin(f + 0.5); out[P.rHipX] = 0.2 - 0.35 * Math.sin(f + 0.5);
      out[P.lKnee] = 0.9; out[P.rKnee] = 0.4; out[P.lHipZ] = out[P.rHipZ] = 0.25;
      break;
    }
    case 'substitution': { // reappears kneeling in a hand seal, then springs up
      const rise = smooth(t / ANIM.substitutionRise);
      const low = 1 - rise;
      out[P.bodyY] = -0.42 * low - 0.06;
      out[P.lHipX] = -1.25 * low - 0.3 * rise; out[P.lKnee] = 1.9 * low + 0.35 * rise;
      out[P.rHipX] = 0.25 * low + 0.25 * rise; out[P.rKnee] = 1.7 * low + 0.3 * rise; out[P.rHipZ] = 0.2;
      out[P.lShX] = out[P.rShX] = -1.2; out[P.lShZ] = out[P.rShZ] = -0.45; out[P.lEl] = out[P.rEl] = 1.75;
      out[P.torsoPitch] = 0.3 * low + 0.1; out[P.torsoTwist] = 0.25; out[P.headPitch] = -0.1;
      break;
    }
    case 'throw': { // overhand kunai throw
      const k = COMBAT.kunai;
      const up = smooth(t / k.windup);
      const rel = smooth((t - k.windup) / 0.08);
      const back = smooth((t - k.windup - 0.1) / k.recovery);
      out[P.rShX] = (-0.5 - 2.2 * up) * (1 - rel) + (-1.25) * rel * (1 - back) + -0.3 * back * rel;
      out[P.rEl] = 1.6 * up * (1 - rel) + 0.1 * rel;
      out[P.rShZ] = 0.25;
      out[P.lShX] = -1.1 * (1 - back); out[P.lEl] = 0.3; out[P.lShZ] = 0.2;
      out[P.torsoTwist] = 0.5 * up * (1 - rel) - 0.35 * rel * (1 - back);
      out[P.torsoPitch] = 0.1 + 0.15 * rel;
      fightStance();
      break;
    }
    case 'special': { // charge at the hip, then palm thrust forward
      const thrust = backOut((t - COMBAT.special.windup) / 0.1);
      out[P.rShX] = 0.4 * (1 - thrust) - 1.5 * thrust; out[P.rShZ] = 0.15; out[P.rEl] = 1.3 * (1 - thrust) + 0.05 * thrust;
      out[P.lShX] = 0.1 * (1 - thrust) - 1.25 * thrust; out[P.lShZ] = -0.4 * thrust; out[P.lEl] = 1.6 * (1 - thrust) + 0.7 * thrust;
      out[P.torsoPitch] = 0.25 + 0.2 * thrust; out[P.torsoTwist] = -0.3 * (1 - thrust) + 0.35 * thrust;
      out[P.lHipX] = -0.75; out[P.lKnee] = 0.7; out[P.rHipX] = 0.55; out[P.rKnee] = 0.25;
      out[P.bodyY] = -0.18;
      break;
    }
    case 'guard': // forearms crossed in front of the face
      out[P.lShX] = out[P.rShX] = -1.35; out[P.lShZ] = out[P.rShZ] = -0.55; out[P.lEl] = out[P.rEl] = 1.95;
      out[P.lHipX] = out[P.rHipX] = -0.3; out[P.lKnee] = out[P.rKnee] = 0.5; out[P.lHipZ] = out[P.rHipZ] = 0.15;
      out[P.torsoPitch] = 0.18; out[P.headPitch] = 0.1; out[P.bodyY] = -0.12;
      break;
    case 'dodge': { // tucked forward roll
      const r = clamp01(t / ANIM.dodgeTime);
      const tuck = Math.sin(r * Math.PI);
      out[P.bodyPitch] = smooth(r) * TAU;
      out[P.bodyY] = -0.32 * tuck - 0.05;
      out[P.lHipX] = out[P.rHipX] = -1.6 * tuck - 0.2; out[P.lKnee] = out[P.rKnee] = 2.0 * tuck + 0.2;
      out[P.lShX] = out[P.rShX] = -1.0 * tuck; out[P.lEl] = out[P.rEl] = 1.8 * tuck + 0.2;
      out[P.torsoPitch] = 0.5 * tuck; out[P.headPitch] = 0.6 * tuck;
      break;
    }
    case 'hit': {
      const a = Math.exp(-t * 5);
      out[P.torsoPitch] = -0.45 * a; out[P.headPitch] = -0.4 * a; out[P.bodyPitch] = -0.1 * a;
      out[P.lShX] = out[P.rShX] = 0.45 * a; out[P.lShZ] = out[P.rShZ] = 0.15 + 0.6 * a; out[P.lEl] = out[P.rEl] = 0.6;
      out[P.lKnee] = out[P.rKnee] = 0.1 + 0.3 * a; out[P.bodyY] = -0.07 * a; out[P.torsoTwist] = 0.2 * a;
      break;
    }
    case 'dead': { // knees buckle, then fall flat on the back
      const slump = smooth(t / (ANIM.deathTime * 0.35));
      const fall = smooth((t - ANIM.deathTime * 0.2) / (ANIM.deathTime * 0.8));
      out[P.lKnee] = out[P.rKnee] = 0.9 * slump * (1 - fall) + 0.1 * fall;
      out[P.lHipZ] = 0.15 * fall; out[P.rHipZ] = 0.25 * fall;
      out[P.bodyPitch] = -1.57 * fall;
      out[P.bodyY] = -0.2 * slump * (1 - fall) - 0.8 * fall;
      out[P.lShZ] = out[P.rShZ] = 0.3 + 1.0 * fall; out[P.lShX] = -0.1 * fall; out[P.rShX] = -0.3 * fall; out[P.lEl] = out[P.rEl] = 0.3;
      out[P.headPitch] = 0.3 * slump * (1 - fall) - 0.05 * fall; out[P.headYaw] = 0.5 * fall;
      break;
    }
    case 'concentrate': { // crouched hand seal at the chest
      const b = Math.sin(time * 6) * 0.012;
      out[P.bodyY] = -0.32 + b;
      out[P.lHipX] = out[P.rHipX] = -0.65; out[P.lKnee] = out[P.rKnee] = 1.15; out[P.lHipZ] = out[P.rHipZ] = 0.35;
      out[P.torsoPitch] = 0.22; out[P.headPitch] = 0.15;
      out[P.lShX] = out[P.rShX] = -0.95; out[P.lShZ] = out[P.rShZ] = -0.5; out[P.lEl] = out[P.rEl] = 1.95;
      break;
    }
    case 'telegraph': { // wind-up: weapon arm raised high, body coiled back
      const q = smooth(t / 0.2);
      fightStance();
      out[P.rShX] = -2.85 * q; out[P.rShZ] = 0.3; out[P.rEl] = 0.5;
      out[P.lShX] = -0.9 * q; out[P.lEl] = 0.6;
      out[P.torsoTwist] = 0.5 * q; out[P.torsoPitch] = -0.18 * q;
      out[P.headPitch] = 0.05;
      break;
    }
    case 'charge': { // crouched, right hand low and forward gripping the orb, left hand cupping it; shake grows with time
      const k = clamp01(t / ANIM.chargeShakeTime);
      const sh = Math.sin(time * 47) * ANIM.chargeShake * k, sh2 = Math.sin(time * 61 + 1) * ANIM.chargeShake * k;
      out[P.bodyY] = -0.3 - 0.06 * k + sh * 0.3;
      out[P.lHipX] = -0.95; out[P.lKnee] = 1.35; out[P.rHipX] = 0.35; out[P.rKnee] = 1.05; out[P.lHipZ] = out[P.rHipZ] = 0.22;
      out[P.torsoPitch] = 0.42 + sh; out[P.torsoTwist] = -0.25 + sh2; out[P.torsoRoll] = sh2;
      out[P.headPitch] = -0.2;
      out[P.rShX] = -0.55 + sh2; out[P.rShZ] = 0.05; out[P.rEl] = 0.55;
      out[P.lShX] = -0.75 + sh; out[P.lShZ] = -0.45; out[P.lEl] = 1.2;
      break;
    }
    case 'chidori': { // lunge dash: low forward lean, lightning arm thrust ahead, left arm trailing, fast stride
      const k = backOut(t / ANIM.dashLeanIn);
      const s = Math.sin(time * ANIM.chidoriStride);
      out[P.bodyPitch] = 0.45 * k; out[P.torsoPitch] = 0.35 * k; out[P.headPitch] = -0.6 * k;
      out[P.bodyY] = -0.16 * k; out[P.torsoTwist] = 0.35 * k;
      out[P.rShX] = -1.45 * k; out[P.rShZ] = 0.05; out[P.rEl] = 0.08;
      out[P.lShX] = 1.0 * k; out[P.lShZ] = 0.35; out[P.lEl] = 0.3;
      out[P.lHipX] = -0.9 * s - 0.3; out[P.rHipX] = 0.9 * s + 0.2;
      out[P.lKnee] = 0.5 + 0.7 * (0.5 + 0.5 * s); out[P.rKnee] = 0.5 + 0.7 * (0.5 - 0.5 * s);
      break;
    }
    case 'sharingan': { // two fingers raised to the eye, wide braced stance
      const q = smooth(t / 0.15);
      out[P.bodyY] = -0.1 * q;
      out[P.lHipX] = -0.35; out[P.lKnee] = 0.4; out[P.rHipX] = 0.3; out[P.rKnee] = 0.35; out[P.lHipZ] = out[P.rHipZ] = 0.22;
      out[P.rShX] = -1.75 * q; out[P.rShZ] = -0.35 * q; out[P.rEl] = 2.35 * q;
      out[P.lShX] = 0.25; out[P.lShZ] = 0.4; out[P.lEl] = 0.35;
      out[P.torsoTwist] = 0.2 * q; out[P.headPitch] = 0.12 * q; out[P.headYaw] = -0.15 * q;
      break;
    }
    case 'dazed': { // genjutsu: wobbly, unsteady, head lolling, arms hanging loose
      const a = Math.sin(time * 2.1), b = Math.sin(time * 1.4 + 1), c = Math.sin(time * 3.3);
      out[P.bodyRoll] = 0.12 * a; out[P.bodyYaw] = 0.2 * b; out[P.bodyY] = -0.08 + 0.03 * c;
      out[P.torsoRoll] = -0.18 * a; out[P.torsoPitch] = 0.15 + 0.08 * b;
      out[P.headPitch] = 0.35 + 0.2 * c; out[P.headYaw] = 0.4 * b;
      out[P.lShZ] = 0.08 + 0.1 * a; out[P.rShZ] = 0.08 - 0.1 * a; out[P.lShX] = 0.15 * b; out[P.rShX] = -0.15 * b; out[P.lEl] = out[P.rEl] = 0.15;
      out[P.lKnee] = 0.3 + 0.2 * Math.max(0, a); out[P.rKnee] = 0.3 + 0.2 * Math.max(0, -a);
      out[P.lHipZ] = 0.12 - 0.08 * a; out[P.rHipZ] = 0.12 + 0.08 * a;
      break;
    }
    case 'grabHold': { // clinch: both hands forward at chest height holding the enemy
      fightStance();
      out[P.lShX] = out[P.rShX] = -1.4; out[P.lShZ] = out[P.rShZ] = -0.3; out[P.lEl] = out[P.rEl] = 0.9;
      out[P.torsoPitch] = 0.22 + Math.sin(time * 5) * 0.02; out[P.headPitch] = 0.05;
      break;
    }
    case 'strikeUp': { // uppercut (right)
      const { wind, p } = strike(t);
      fightStance();
      out[P.bodyY] = -0.18 * wind + 0.1 * p;
      out[P.rShX] = 0.4 * wind - 2.7 * p; out[P.rShZ] = 0.1; out[P.rEl] = 1.9 - 1.2 * p;
      out[P.lShX] = -1.1; out[P.lShZ] = 0.15; out[P.lEl] = 2.0;
      out[P.torsoPitch] = 0.3 * wind - 0.3 * p; out[P.torsoTwist] = -0.3 * wind + 0.4 * p; out[P.headPitch] = -0.25 * p;
      break;
    }
    case 'strikeDown': { // axe kick: right leg swung high, then chopped down
      const lift = smooth(t / 0.1), drop = smooth((t - 0.11) / 0.07);
      out[P.rHipX] = -2.2 * lift * (1 - drop) - 0.75 * drop; out[P.rKnee] = 0.1 + 0.3 * drop;
      out[P.lKnee] = 0.3; out[P.lHipX] = 0.15;
      out[P.torsoPitch] = -0.3 * lift * (1 - drop) + 0.4 * drop; out[P.headPitch] = 0.2 * drop;
      out[P.lShX] = out[P.rShX] = 0.5 * lift; out[P.lShZ] = out[P.rShZ] = 0.6; out[P.lEl] = out[P.rEl] = 0.5;
      out[P.bodyY] = -0.12 * drop;
      break;
    }
    case 'strikeLeft': { // wide left hook sweeping across
      const { wind, p } = strike(t);
      fightStance();
      out[P.lShX] = -1.3; out[P.lShZ] = 1.3 + 0.3 * wind - 1.9 * p; out[P.lEl] = 1.1;
      out[P.rShX] = -1.0; out[P.rShZ] = 0.2; out[P.rEl] = 2.0;
      out[P.torsoTwist] = 0.6 * wind - 1.0 * p; out[P.torsoRoll] = 0.2 * p; out[P.bodyY] -= 0.06 * p;
      break;
    }
    case 'strikeRight': { // right side kick
      const { wind, p } = strike(t);
      out[P.rHipZ] = 0.3 * wind + 1.45 * p; out[P.rHipX] = -0.35 * p; out[P.rKnee] = 1.3 * wind + 0.15 * (1 - wind) * (1 - p);
      out[P.lKnee] = 0.35; out[P.lHipZ] = 0.1;
      out[P.bodyRoll] = 0.3 * p; out[P.torsoRoll] = 0.25 * p; out[P.torsoTwist] = -0.3 * p;
      out[P.lShZ] = 0.9; out[P.rShZ] = 0.5; out[P.lEl] = out[P.rEl] = 1.2; out[P.lShX] = out[P.rShX] = -0.5;
      break;
    }
    case 'grabFinisher': { // big launcher: deep crouch, then a rising flip kick sending the enemy skyward
      const crouch = t < 0.12 ? smooth(t / 0.12) : 1 - smooth((t - 0.12) / 0.06);
      const p = t < 0.12 ? 0 : backOut((t - 0.12) / 0.12);
      out[P.bodyY] = -0.38 * crouch + 0.45 * p;
      out[P.bodyPitch] = -0.45 * p;
      out[P.lHipX] = -0.9 * crouch + 0.3 * p; out[P.lKnee] = 1.5 * crouch + 0.4 * p;
      out[P.rHipX] = 0.2 * crouch - 2.6 * p; out[P.rKnee] = 1.3 * crouch + 0.05 * p;
      out[P.lShX] = out[P.rShX] = 0.5 * crouch + 0.9 * p; out[P.lShZ] = out[P.rShZ] = 0.3 + 0.5 * p; out[P.lEl] = out[P.rEl] = 1.0 * crouch + 0.2;
      out[P.torsoPitch] = 0.45 * crouch - 0.3 * p; out[P.headPitch] = -0.3 * p;
      break;
    }
    case 'downed': { // knocked out face down, head up; arms and legs pull alternately when crawling
      const c = clamp01((speed - ANIM.crawlStart) / (ANIM.crawlFull - ANIM.crawlStart));
      const s = Math.sin(phase) * c, b = Math.sin(time * ANIM.breathRate) * 0.01;
      out[P.bodyPitch] = 1.42; out[P.bodyY] = -0.78 + b + 0.03 * Math.abs(s);
      out[P.bodyRoll] = 0.06 * s; out[P.torsoTwist] = 0.12 * s;
      out[P.headPitch] = -0.75; out[P.headYaw] = 0.15 * (1 - c);
      out[P.lShX] = -2.1 - 0.5 * s; out[P.rShX] = -1.4 + 0.5 * s; out[P.lShZ] = 0.35; out[P.rShZ] = 0.6;
      out[P.lEl] = 0.5 + 0.5 * c * (0.5 + 0.5 * Math.sin(phase)); out[P.rEl] = 0.9 + 0.5 * c * (0.5 - 0.5 * Math.sin(phase));
      out[P.lHipX] = 0.1 + 0.25 * s; out[P.rHipX] = 0.1 - 0.25 * s; out[P.lHipZ] = 0.15; out[P.rHipZ] = 0.2;
      out[P.lKnee] = 0.2 + 0.7 * c * Math.max(0, Math.sin(phase)); out[P.rKnee] = 0.35 + 0.7 * c * Math.max(0, -Math.sin(phase));
      break;
    }
    case 'grabbed': { // victim: limp, slightly lifted, arms loose, head hanging
      const w = Math.sin(time * 3) * 0.05;
      out[P.bodyY] = 0.14; out[P.bodyPitch] = -0.12; out[P.bodyRoll] = w;
      out[P.torsoPitch] = -0.2; out[P.headPitch] = 0.6 + w; out[P.headYaw] = 0.2;
      out[P.lShX] = out[P.rShX] = 0.25; out[P.lShZ] = 0.05 + w; out[P.rShZ] = 0.05 - w; out[P.lEl] = out[P.rEl] = 0.1;
      out[P.lHipX] = 0.15; out[P.rHipX] = -0.1; out[P.lKnee] = 0.55; out[P.rKnee] = 0.7;
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Shared geometry (created once, lives for the app; per-instance resources are materials only).
// Head-local coordinates: origin = head centre, face toward +Z.
// ---------------------------------------------------------------------------------------------

/** Merge parts into one geometry (frees the parts). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = mergeGeometries(flat);
  parts.forEach((g) => g.dispose());
  flat.forEach((g) => g.dispose());
  return out;
}
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);
const tmpHand = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

/** Tapered limb hanging down from its joint (y = 0 → -len), rounded ends. */
function limb(rTop: number, rBot: number, len: number): THREE.BufferGeometry {
  const c = new THREE.CylinderGeometry(rTop, rBot, len, 10, 1, true); c.translate(0, -len / 2, 0);
  const a = new THREE.SphereGeometry(rTop, 10, 6); const b = new THREE.SphereGeometry(rBot, 10, 6); b.translate(0, -len, 0);
  return merge([c, a, b]);
}
/** Cone spike of length `len` whose base sits `from` metres out along `dir` from the head centre. */
function spike(dir: THREE.Vector3, len: number, r: number, from: number): THREE.BufferGeometry {
  const d = dir.clone().normalize();
  const g = new THREE.ConeGeometry(r, len, 5); g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d));
  g.translate(d.x * from, d.y * from, d.z * from);
  return g;
}
/** Thin flat disc decal on the face (normal tilted to follow the head surface at x). */
function decal(g: THREE.BufferGeometry, x: number, y: number, z: number, rotZ = 0): THREE.BufferGeometry {
  g.rotateZ(rotZ);
  g.rotateY(Math.atan2(x, z));
  g.translate(x, y, z);
  return g;
}

/** Head profile (radius, y) bottom → top: tapered jaw and chin, round cranium. */
const HEAD_PROFILE: [number, number][] = [[0.001, -0.135], [0.05, -0.128], [0.1, -0.09], [0.135, -0.04], [0.152, 0.01], [0.16, 0.06], [0.152, 0.11], [0.12, 0.16], [0.06, 0.188], [0.001, 0.195]];
function headR(y: number): number {
  for (let i = 1; i < HEAD_PROFILE.length; i++) {
    const [r1, y1] = HEAD_PROFILE[i], [r0, y0] = HEAD_PROFILE[i - 1];
    if (y <= y1) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
  }
  return 0;
}
/** Z of the face surface at (x, y) plus a small lift so decals sit just proud of it. */
const faceZ = (x: number, y: number, lift: number) => Math.sqrt(Math.max(headR(y) ** 2 - x * x, 0)) + lift;

const EYE = { x: 0.058, y: -0.012, w: 0.036, h: 0.05 };

function buildHead(): THREE.BufferGeometry {
  const head = new THREE.LatheGeometry(HEAD_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 20);
  const neck = new THREE.CylinderGeometry(0.055, 0.06, 0.16, 8, 1, true); neck.translate(0, -0.17, -0.02);
  const nose = new THREE.ConeGeometry(0.014, 0.03, 4); nose.rotateX(Math.PI / 2 + 0.5); nose.translate(0, -0.04, faceZ(0, -0.04, 0.004));
  const ears = [1, -1].map((s) => { const e = new THREE.SphereGeometry(0.035, 6, 5); e.scale(0.45, 1, 0.8); e.translate(0.148 * s, -0.005, -0.01); return e; });
  return merge([head, neck, nose, ...ears]);
}

/** Eye whites + highlights (one white mesh). */
function buildEyeWhite(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const x = EYE.x * s;
    const sclera = new THREE.CircleGeometry(0.5, 12); sclera.scale(EYE.w, EYE.h, 1);
    parts.push(decal(sclera, x, EYE.y, faceZ(x, EYE.y, 0.002)));
    const hx = x + 0.006 * s, hy = EYE.y + 0.011;
    parts.push(decal(new THREE.CircleGeometry(0.0055, 6), hx, hy, faceZ(hx, hy, 0.0065)));
  }
  return merge(parts);
}
function buildIris(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const x = (EYE.x - 0.004) * s; // irises look slightly inward
    const g = new THREE.CircleGeometry(0.0145, 10); g.scale(1, 1.3, 1);
    parts.push(decal(g, x, EYE.y - 0.002, faceZ(x, EYE.y, 0.0035)));
  }
  return merge(parts);
}
/** Ink-coloured face details: pupils, upper lash lines, brows, mouth (unmasked only), headband-plate mark. */
function buildFaceInk(withMouth: boolean, whiskers = false, mark = true): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, x: number, y: number, lift: number, rot: number) =>
    parts.push(decal(new THREE.BoxGeometry(w, h, 0.002), x, y, faceZ(x, y, lift), rot));
  for (const s of [1, -1]) {
    const x = (EYE.x - 0.004) * s;
    const pupil = new THREE.CircleGeometry(0.0065, 8); pupil.scale(1, 1.3, 1);
    parts.push(decal(pupil, x, EYE.y - 0.002, faceZ(x, EYE.y, 0.005)));
    box(EYE.w * 1.15, 0.008, EYE.x * s, EYE.y + EYE.h * 0.47, 0.004, -0.18 * s); // upper lash line
    box(0.042, 0.009, (EYE.x + 0.004) * s, EYE.y + 0.048, 0.003, -0.22 * s); // brow, angled (determined look)
  }
  if (withMouth) box(0.028, 0.005, 0, -0.085, 0.002, 0);
  if (whiskers) for (const s of [1, -1]) for (let i = 0; i < 3; i++) box(0.042, 0.005, 0.095 * s, -0.04 - i * 0.016, 0.002, (0.12 - i * 0.12) * s);
  // Original headband mark: a single horizontal wave of three tilted strokes on the plate.
  if (mark) for (let i = -1; i <= 1; i++) {
    const g = new THREE.BoxGeometry(0.03, 0.006, 0.004); g.rotateZ(i === 0 ? -0.5 : 0.5); g.translate(i * 0.024, 0.085, 0.188);
    parts.push(g);
  }
  return merge(parts);
}

/** Hair cluster per style, head-local. */
function buildHair(style: HairStyle): THREE.BufferGeometry {
  const cap = new THREE.SphereGeometry(0.182, 14, 8, 0, TAU, 0, Math.PI * 0.42); cap.translate(0, 0.035, -0.006);
  const back = new THREE.SphereGeometry(0.17, 12, 6, Math.PI * 1.1, Math.PI * 0.8, Math.PI * 0.4, Math.PI * 0.3); back.translate(0, 0.035, -0.01);
  const parts: THREE.BufferGeometry[] = [cap, back];
  const add = (x: number, y: number, z: number, len: number, r: number, from = 0.11) => parts.push(spike(v3(x, y, z), len, r, from));
  /** Cone at head-local point (x, y, z) pointing along `dir` (locks that do not radiate from the centre). */
  const lock = (x: number, y: number, z: number, dir: THREE.Vector3, len: number, r: number) => {
    const g = new THREE.ConeGeometry(r, len, 5); g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
    g.translate(x, y, z);
    parts.push(g);
  };
  const bangs = (n: number, tilt: number) => {
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.06;
      const g = new THREE.ConeGeometry(0.045, 0.15, 4); g.rotateX(Math.PI * 0.86); g.rotateZ(tilt + x * 1.5);
      g.translate(x, 0.12, 0.13 - Math.abs(x) * 0.3);
      parts.push(g);
    }
  };
  switch (style) {
    case 'spiky':
      add(0, 1, 0.1, 0.26, 0.085); add(0.55, 0.85, 0.05, 0.25, 0.08); add(-0.55, 0.85, 0.05, 0.25, 0.08);
      add(0.3, 0.8, -0.55, 0.27, 0.085); add(-0.3, 0.8, -0.55, 0.27, 0.085); add(0, 0.55, -0.85, 0.28, 0.085);
      add(0.85, 0.4, -0.2, 0.22, 0.075); add(-0.85, 0.4, -0.2, 0.22, 0.075); add(0.5, 0.2, -0.85, 0.24, 0.075);
      add(-0.5, 0.2, -0.85, 0.24, 0.075); add(0, 0, -1, 0.2, 0.075); add(0.25, 0.9, 0.45, 0.2, 0.07); add(-0.25, 0.9, 0.45, 0.2, 0.07);
      bangs(4, 0);
      break;
    case 'swept': // slicked back, long horizontal spikes
      for (const [x, y, len] of [[0, 0.45, 0.32], [0.3, 0.35, 0.28], [-0.3, 0.35, 0.28], [0.15, 0.7, 0.3], [-0.15, 0.7, 0.3], [0.55, 0.1, 0.22], [-0.55, 0.1, 0.22], [0, 0.05, 0.25]] as const) {
        add(x, y, -1, len, 0.08);
      }
      add(0, 1, -0.3, 0.16, 0.08);
      bangs(2, 0.35);
      break;
    case 'topknot': { // tied-up bun with a short plume
      const bun = new THREE.SphereGeometry(0.075, 10, 7); bun.translate(0, 0.19, -0.08);
      parts.push(bun);
      parts.push(spike(v3(0, 1, -0.6), 0.16, 0.05, 0.27), spike(v3(0.4, 1, -0.4), 0.13, 0.04, 0.25), spike(v3(-0.4, 1, -0.4), 0.13, 0.04, 0.25));
      add(0.9, -0.3, 0.25, 0.14, 0.04, 0.14); add(-0.9, -0.3, 0.25, 0.14, 0.04, 0.14); // side locks
      bangs(3, 0);
      break;
    }
    case 'duckTail': // swept back into a spiky tuft at the back, long bangs framing the face
      for (const [x, y, z, len] of [[0, 0.45, -1, 0.3], [0.4, 0.35, -1, 0.27], [-0.4, 0.35, -1, 0.27], [0.2, 0.8, -0.8, 0.28], [-0.2, 0.8, -0.8, 0.28], [0, 0.1, -1, 0.26], [0.55, 0.6, -0.6, 0.22], [-0.55, 0.6, -0.6, 0.22]] as const) {
        add(x, y, z, len, 0.085);
      }
      add(0, 1, -0.2, 0.14, 0.08);
      for (const sx of [1, -1]) {
        lock(0.118 * sx, 0.07, 0.11, v3(0.25 * sx, -1, 0.3), 0.21, 0.035);
        lock(0.15 * sx, 0.05, 0.04, v3(0.2 * sx, -1, 0.1), 0.2, 0.04);
      }
      bangs(3, 0.1);
      break;
    case 'leaning': // tall spikes all swept up and to one side
      for (const [x, y, z, len] of [[-0.35, 1, 0.15, 0.36], [-0.7, 0.85, -0.1, 0.34], [-0.15, 1, -0.45, 0.36], [-0.9, 0.5, 0.15, 0.27], [0.2, 1, -0.1, 0.3], [-0.5, 0.75, -0.65, 0.33], [0.3, 0.7, -0.55, 0.27], [-0.2, 0.55, -0.9, 0.27], [0.55, 0.7, 0.1, 0.22]] as const) {
        add(x, y, z, len, 0.09);
      }
      bangs(3, 0.3);
      break;
    case 'long': // flowing locks down the back and framing the face
      for (const x of [-0.5, -0.17, 0.17, 0.5]) add(x, -1, -0.45, 0.42, 0.085, 0.13);
      add(0.95, -1, 0.15, 0.3, 0.06, 0.13); add(-0.95, -1, 0.15, 0.3, 0.06, 0.13);
      add(0, 1, -0.2, 0.15, 0.08);
      bangs(3, 0.15);
      break;
  }
  return merge(parts);
}

interface SharedGeo {
  pelvis: THREE.BufferGeometry; chest: THREE.BufferGeometry; vest: THREE.BufferGeometry; belt: THREE.BufferGeometry;
  scarf: THREE.BufferGeometry; mantle: THREE.BufferGeometry;
  thigh: THREE.BufferGeometry; pouch: THREE.BufferGeometry; shin: THREE.BufferGeometry; legWrap: THREE.BufferGeometry; sandal: THREE.BufferGeometry;
  upperArm: THREE.BufferGeometry; forearm: THREE.BufferGeometry; armWrap: THREE.BufferGeometry; fist: THREE.BufferGeometry; armGlow: THREE.BufferGeometry;
  head: THREE.BufferGeometry; eyeWhite: THREE.BufferGeometry; iris: THREE.BufferGeometry; ink: Map<string, THREE.BufferGeometry>;
  band: THREE.BufferGeometry; plate: THREE.BufferGeometry; bandTail: THREE.BufferGeometry; mask: THREE.BufferGeometry;
  shell: THREE.BufferGeometry; orbCore: THREE.BufferGeometry; orbShell: THREE.BufferGeometry;
  footChakra: THREE.BufferGeometry;
  hair: Partial<Record<HairStyle, THREE.BufferGeometry>>;
}
let geo: SharedGeo | null = null;
function sharedGeo(): SharedGeo {
  if (geo) return geo;
  // Torso (torso-local, y = 0 at the waist).
  const chest = new THREE.CylinderGeometry(0.235, 0.165, 0.46, 12); chest.scale(1, 1, 0.68); chest.translate(0, 0.23, 0);
  const pecs = new THREE.SphereGeometry(0.2, 12, 8); pecs.scale(1.1, 0.75, 0.72); pecs.translate(0, 0.36, 0.0);
  const yoke = new THREE.CylinderGeometry(0.25, 0.235, 0.13, 12, 1, true); yoke.scale(1, 1, 0.72); yoke.translate(0, 0.39, 0);
  const shoulderCap = new THREE.SphereGeometry(0.25, 12, 6, 0, TAU, 0, Math.PI * 0.32); shoulderCap.scale(1, 0.5, 0.72); shoulderCap.translate(0, 0.43, 0);
  const collar = new THREE.CylinderGeometry(0.11, 0.15, 0.12, 12, 1, true); collar.scale(1, 1, 0.9); collar.translate(0, 0.5, -0.01);
  const pockets = [-1, 1].map((s) => { const a = new THREE.BoxGeometry(0.075, 0.07, 0.035); a.translate(0.09 * s, 0.21, 0.125); return a; });
  const belt = new THREE.CylinderGeometry(0.182, 0.178, 0.075, 12); belt.scale(1, 1, 0.74); belt.translate(0, 0.02, 0);
  const knot = new THREE.BoxGeometry(0.07, 0.07, 0.05); knot.translate(0.1, 0.02, -0.13);
  const sashTail = new THREE.BoxGeometry(0.05, 0.18, 0.015); sashTail.rotateZ(0.15); sashTail.translate(0.12, -0.08, -0.14);
  const pelvis = new THREE.CylinderGeometry(0.175, 0.16, 0.2, 12); pelvis.scale(1, 1, 0.74); pelvis.translate(0, -0.06, 0);
  const scarf = new THREE.BoxGeometry(0.12, 0.2, 0.025); scarf.translate(0, -0.095, 0);
  const mantle = new THREE.CylinderGeometry(0.16, 0.33, 0.3, 14, 1, true); mantle.scale(1, 1, 0.8); mantle.translate(0, 0.38, -0.01);
  // Legs (hip-local / knee-local).
  const pouch = new THREE.BoxGeometry(0.085, 0.1, 0.07); pouch.translate(-0.1, -0.2, 0.0);
  const holster = new THREE.BoxGeometry(0.03, 0.14, 0.05); holster.rotateZ(0.2); holster.translate(-0.105, -0.12, 0.05);
  const strap = new THREE.CylinderGeometry(0.098, 0.094, 0.025, 10, 1, true); strap.translate(0, -0.2, 0);
  const wraps = [-0.2, -0.26, -0.32].map((y) => { const g = new THREE.CylinderGeometry(0.066 - (y + 0.2) * 0.12, 0.064 - (y + 0.2) * 0.12, 0.045, 10); g.translate(0, y, 0); return g; });
  const tabi = new THREE.BoxGeometry(0.1, 0.07, 0.2); tabi.translate(0, -0.42, 0.035);
  const sole = new THREE.BoxGeometry(0.12, 0.035, 0.26); sole.translate(0, -0.46, 0.04);
  const sandalStrap = new THREE.BoxGeometry(0.115, 0.025, 0.04); sandalStrap.translate(0, -0.4, 0.08);
  const heel = new THREE.BoxGeometry(0.115, 0.06, 0.035); heel.translate(0, -0.42, -0.07);
  // Arms (shoulder-local / elbow-local).
  const cuff = new THREE.TorusGeometry(0.066, 0.02, 5, 12); cuff.rotateX(Math.PI / 2); cuff.translate(0, -0.25, 0);
  const armWraps = [-0.06, -0.11, -0.16].map((y) => { const g = new THREE.CylinderGeometry(0.063 + y * 0.06, 0.061 + y * 0.06, 0.04, 10); g.translate(0, y, 0); return g; });
  const fist = new THREE.SphereGeometry(0.06, 10, 7); fist.scale(0.85, 1.0, 1.05); fist.translate(0, -0.27, 0.005);
  const thumb = new THREE.SphereGeometry(0.022, 6, 4); thumb.translate(0, -0.25, 0.05);
  const glowFist = new THREE.SphereGeometry(0.08, 10, 7); glowFist.translate(0, -0.27, 0);
  // Headband (head-local): cloth band, blank plate, fluttering tails.
  const band = new THREE.CylinderGeometry(0.168, 0.172, 0.05, 20, 1, true); band.translate(0, 0.085, 0);
  const plate = new THREE.BoxGeometry(0.13, 0.055, 0.02); plate.translate(0, 0.085, 0.176);
  const bandTail = new THREE.BoxGeometry(0.045, 0.26, 0.012); bandTail.translate(0, -0.13, 0);
  // Mask: lathe of the lower-face profile pushed slightly outward.
  const maskProfile = HEAD_PROFILE.filter(([, y]) => y < -0.03).map(([r, y]) => new THREE.Vector2(r + 0.012, y - 0.004));
  maskProfile.push(new THREE.Vector2(headR(-0.036) + 0.012, -0.036));
  geo = {
    pelvis, chest: merge([chest, pecs]), vest: merge([yoke, shoulderCap, collar, ...pockets]), belt: merge([belt, knot, sashTail]),
    scarf, mantle,
    thigh: merge([limb(0.1, 0.078, 0.4), strap]), pouch: merge([pouch, holster]),
    shin: limb(0.078, 0.052, 0.36), legWrap: merge([...wraps, tabi]), sandal: merge([sole, sandalStrap, heel]),
    upperArm: merge([limb(0.078, 0.06, 0.25), cuff]), forearm: limb(0.058, 0.046, 0.2), armWrap: merge(armWraps),
    fist: merge([fist, thumb]), armGlow: merge([limb(0.078, 0.066, 0.2), glowFist]),
    head: buildHead(), eyeWhite: buildEyeWhite(), iris: buildIris(), ink: new Map(),
    band, plate, bandTail,
    // Mask lathe + a bump that swallows the nose (the mask covers nose and mouth).
    mask: merge([new THREE.LatheGeometry(maskProfile, 20), new THREE.SphereGeometry(0.03, 8, 6).scale(1, 0.85, 0.9).translate(0, -0.045, faceZ(0, -0.045, 0.006))]),
    shell: new THREE.SphereGeometry(1, 20, 14),
    orbCore: new THREE.SphereGeometry(0.1, 14, 10),
    orbShell: new THREE.SphereGeometry(0.17, 16, 10),
    // Chakra under the sole (sole bottom is at y = -0.4775 in the knee frame); flame points away from the foot.
    footChakra: merge([
      new THREE.SphereGeometry(0.1, 14, 8).scale(0.9, 0.22, 1.5).translate(0, -0.49, 0.04),
      new THREE.ConeGeometry(0.075, 0.26, 10, 1, true).rotateX(Math.PI).translate(0, -0.6, 0.04),
    ]),
    hair: {},
  };
  return geo;
}
/** Face ink variant for a look (mouth unless masked, optional whiskers, optional plate mark), cached. */
function faceInkGeo(look: NinjaLook): THREE.BufferGeometry {
  const mouth = !look.mask, whiskers = !!look.whiskers && mouth, mark = look.plateMark ?? true;
  const key = `${mouth}${whiskers}${mark}`;
  const m = sharedGeo().ink;
  let g = m.get(key);
  if (!g) m.set(key, (g = buildFaceInk(mouth, whiskers, mark)));
  return g;
}

/** Lazily built extras for player-only / status visuals (not part of every enemy's mesh budget). */
let extra: { tomoe: THREE.BufferGeometry; daze: THREE.BufferGeometry; bolts: THREE.BufferGeometry[]; arcs: THREE.BufferGeometry[]; sharingan: THREE.MeshBasicMaterial; dazeMat: THREE.MeshBasicMaterial; bolt: THREE.MeshBasicMaterial } | null = null;
function extras(): NonNullable<typeof extra> {
  if (extra) return extra;
  // Sharingan: three dots circling each pupil.
  const dots: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
    const a = k * (TAU / 3) + 0.4;
    const x = (EYE.x - 0.004) * s + Math.cos(a) * 0.0095, y = EYE.y - 0.002 + Math.sin(a) * 0.012;
    dots.push(decal(new THREE.CircleGeometry(0.0036, 6), x, y, faceZ(x, EYE.y, 0.006)));
  }
  // Daze halo: thin ring with three little stars riding on it (head-local, above the head).
  const ring = new THREE.TorusGeometry(0.17, 0.012, 4, 24).rotateX(Math.PI / 2);
  const stars = [0, 1, 2].map((k) => new THREE.OctahedronGeometry(0.04, 0).translate(Math.cos(k * TAU / 3) * 0.17, 0, Math.sin(k * TAU / 3) * 0.17));
  const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } as const;
  extra = {
    tomoe: merge(dots),
    daze: merge([ring, ...stars]),
    bolts: [0, 1, 2, 3, 4, 5].map((i) => boltGeometry(i + 1, 5, 6, 1, 0.04)),
    arcs: [0, 1, 2, 3].map((i) => boltGeometry(i + 50, 1, 8, 0.12, 0.05)),
    sharingan: glowMaterial(0xff2a2a, 2.2),
    dazeMat: glowMaterial(0xd8489a, 2),
    bolt: glowMaterial(0xcfe8ff, 2.2, add),
  };
  return extra;
}

function hairGeo(style: HairStyle): THREE.BufferGeometry {
  const g = sharedGeo();
  return (g.hair[style] ??= buildHair(style));
}

interface SharedMat {
  eyeWhite: THREE.MeshBasicMaterial; ink: THREE.MeshBasicMaterial; wrap: THREE.MeshToonMaterial; plate: THREE.MeshToonMaterial;
  orbCore: THREE.MeshBasicMaterial; orbShells: THREE.MeshBasicMaterial[]; armGlow: THREE.MeshBasicMaterial;
  footChakra: THREE.MeshBasicMaterial;
  guard: THREE.MeshBasicMaterial; warn: THREE.MeshBasicMaterial; iris: Map<number, THREE.MeshBasicMaterial>;
}
let mats: SharedMat | null = null;
function sharedMat(): SharedMat {
  if (mats) return mats;
  const add = (color: number, opacity: number, intensity = 1) =>
    glowMaterial(color, intensity, { transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  mats = {
    eyeWhite: new THREE.MeshBasicMaterial({ color: 0xfbfbf6 }),
    ink: new THREE.MeshBasicMaterial({ color: 0x2a1c24 }),
    wrap: toon(0xece4cf, { rim: 0.6 }),
    plate: toon(0xd5dde6, { rim: 0.6, emissive: 0x2a3038 }),
    orbCore: glowMaterial(0xe6f8ff, 4),
    footChakra: add(0x5cc0ff, 0.85, 2.4),
    orbShells: [add(0x4fb8ff, 0.45, 1.6), add(0x7fd0ff, 0.3, 1.4), add(0x2f8fff, 0.25, 1.8)],
    armGlow: glowMaterial(0xff3b1f, 2.6, { side: THREE.BackSide }),
    guard: add(0x66c8ff, 0.14),
    warn: glowMaterial(0xff3b1f, 1.6, { depthTest: false, transparent: true }),
    iris: new Map(),
  };
  return mats;
}
function irisMat(color: number): THREE.MeshBasicMaterial {
  const m = sharedMat().iris;
  let mat = m.get(color);
  if (!mat) m.set(color, (mat = new THREE.MeshBasicMaterial({ color })));
  return mat;
}

let warnGeo: THREE.BufferGeometry | null = null;
function warningGeo(): THREE.BufferGeometry {
  if (warnGeo) return warnGeo;
  const bar = new THREE.BoxGeometry(0.08, 0.3, 0.08); bar.translate(0, 0.12, 0);
  const dot = new THREE.BoxGeometry(0.08, 0.08, 0.08); dot.translate(0, -0.12, 0);
  warnGeo = merge([bar, dot]);
  return warnGeo;
}

/** Chakra flame shell: fresnel edge + rising flame tongues, HDR output so it blooms. */
const AURA_VERT = /* glsl */ `
uniform float time;
varying vec3 vN; varying vec3 vV; varying float vY; varying float vA;
void main() {
  float a = atan(position.z, position.x);
  float h = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 p = position;
  float lick = 0.5 + 0.5 * sin(a * 5.0 + time * 3.0) * sin(position.y * 6.0 - time * 8.0);
  p.xz *= 1.0 + 0.1 * lick * h;
  p.y += h * h * (0.25 + 0.3 * lick);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y; vA = a;
  gl_Position = projectionMatrix * mv;
}`;
const AURA_FRAG = /* glsl */ `
uniform vec3 color; uniform float opacity; uniform float time;
varying vec3 vN; varying vec3 vV; varying float vY; varying float vA;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.8);
  float tongues = 0.55 + 0.45 * sin(vA * 7.0 + vY * 5.0 - time * 11.0);
  float top = 1.0 - smoothstep(0.55, 1.0, vY);
  gl_FragColor = vec4(color * (f * 2.4 * tongues + 0.05) * top * opacity, 1.0);
}`;

/**
 * Procedurally animated anime-styled ninja. Feet at local origin, faces +Z, ~1.8 m tall.
 * Hierarchy: root → body (pivot at hip height) → hips → knees / torso → head, shoulders → elbows.
 */
export class NinjaModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shoulders: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()]; // left, right
  private readonly elbows: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  private readonly hipsJ: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  private readonly knees: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  /** Scarf bone chain (empty when the look has no scarf). */
  private readonly scarf: THREE.Group[] = [];
  private readonly bandTails: THREE.Group[] = [];
  private readonly orb = new THREE.Group();
  private readonly orbShells: THREE.Mesh[] = [];
  /** Per-foot chakra (sole pad + flame), shown while wall-walking. */
  private readonly footChakra: THREE.Mesh[] = [];
  private readonly armGlow: THREE.Mesh;
  private readonly aura: THREE.Mesh;
  private readonly auraMat: THREE.ShaderMaterial;
  private readonly guardMesh: THREE.Mesh;
  private readonly warn: THREE.Mesh;
  /** Per-instance materials (flash/emissive), disposed with the model. */
  private readonly mats: THREE.MeshToonMaterial[] = [];
  private readonly armMats: THREE.MeshToonMaterial[] = [];
  private readonly pose = new Float32Array(POSE_SIZE);
  private readonly target = new Float32Array(POSE_SIZE);
  private phase = 0;
  private clock = 0;
  private flashT = 0;
  private flashDur = 0.12;
  private telegraph = false;
  private auraOn = false;
  private auraLevel = 0;
  private lastAnim: AnimState = 'idle';
  private orbCharge = 1;
  private orbStyle: 'rasengan' | 'chidori' = 'rasengan';
  /** Per-instance orb materials (cloned on first use so the glow can ramp with charge) and their base colours. */
  private orbMats: { mat: THREE.MeshBasicMaterial; base: THREE.Color }[] | null = null;
  private bolts: THREE.Mesh | null = null;
  private arcs: THREE.Mesh | null = null;
  private boltT = 0;
  private daze: THREE.Mesh | null = null;
  /** Procedural iris mesh (null for the Blender hero) and its normal material, swapped for the Sharingan. */
  private iris: THREE.Mesh | null = null;
  private irisMatBase: THREE.Material | null = null;
  private tomoe: THREE.Mesh | null = null;
  private tint: number | null = null;

  constructor(readonly look: NinjaLook) {
    const g = sharedGeo();
    const s = sharedMat();
    const ch = (color: number) => this.mat(toon(color, { rim: 0.6 }));
    const outfit = ch(look.outfit), accent = ch(look.accent), skin = ch(look.skin), hair = ch(look.hair), band = ch(look.headband);
    const armOutfit = ch(look.outfit), armSkin = ch(look.skin);
    const pants = look.pants !== undefined ? ch(look.pants) : outfit;
    const sandal = look.pants !== undefined ? pants : accent;
    this.armMats.push(armOutfit, armSkin);

    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, shadow = true) => {
      const m = new THREE.Mesh(geometry, material);
      m.castShadow = shadow;
      parent.add(m);
      return m;
    };

    // Blender model: one rigid part per joint (falls back to the procedural body if the GLB failed to load).
    const hero = look.model === 'hero' ? heroParts() : null;

    this.root.add(this.body);
    this.body.position.y = 0.95;
    if (hero) this.heroPart(hero, 'pelvis', this.body);
    else mesh(g.pelvis, pants, this.body);
    // Legs
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1; // left = +X
      const hip = this.hipsJ[i], knee = this.knees[i];
      hip.position.set(0.1 * side, -0.07, 0);
      this.body.add(hip);
      knee.position.y = -0.41;
      hip.add(knee);
      if (hero) {
        const tag = i === 0 ? 'L' : 'R';
        this.heroPart(hero, `thigh_${tag}`, hip);
        this.heroPart(hero, `shin_${tag}`, knee);
        continue;
      }
      mesh(g.thigh, pants, hip);
      if (i === 1) mesh(g.pouch, accent, hip, false);
      mesh(g.shin, pants, knee);
      mesh(g.legWrap, s.wrap, knee, false);
      mesh(g.sandal, sandal, knee, false);
    }
    // Torso
    this.torso.position.y = 0.04;
    this.body.add(this.torso);
    if (hero) {
      this.heroPart(hero, 'torso', this.torso);
    } else {
      mesh(g.chest, look.vest !== undefined ? ch(look.vest) : outfit, this.torso);
      mesh(g.vest, accent, this.torso, false);
      mesh(g.belt, look.belt !== undefined ? ch(look.belt) : accent, this.torso, false);
    }
    if (look.cloak !== undefined) {
      const cloak = ch(look.cloak);
      cloak.side = THREE.DoubleSide;
      mesh(g.mantle, cloak, this.torso);
    }
    if (look.scarf !== undefined) {
      const scarf = ch(look.scarf);
      let parent: THREE.Object3D = this.torso;
      for (let i = 0; i < 3; i++) {
        const seg = new THREE.Group();
        if (i === 0) seg.position.set(0.05, 0.53, -0.13); else seg.position.y = -0.18;
        seg.scale.setScalar(1 - i * 0.08);
        parent.add(seg);
        mesh(g.scarf, scarf, seg, false);
        this.scarf.push(seg);
        parent = seg;
      }
    }
    // Head (centre at 0.15 above the neck joint)
    this.head.position.y = 0.48;
    this.torso.add(this.head);
    if (hero) {
      this.heroPart(hero, 'head', this.head);
    } else {
      const face = new THREE.Group();
      face.position.y = 0.15;
      this.head.add(face);
      mesh(g.head, skin, face);
      mesh(hairGeo(look.hairStyle ?? 'spiky'), hair, face);
      mesh(g.eyeWhite, s.eyeWhite, face, false);
      this.iris = mesh(g.iris, irisMat(look.eyes ?? 0x2f7fe0), face, false);
      this.irisMatBase = this.iris.material as THREE.Material;
      mesh(faceInkGeo(look), s.ink, face, false);
      // Headband (optionally slanted over the left eye).
      const bandG = new THREE.Group();
      face.add(bandG);
      if (look.bandTilt) {
        bandG.rotation.set(look.bandTilt.pitch, 0, look.bandTilt.roll);
        bandG.position.y = -look.bandTilt.drop;
      }
      mesh(g.band, band, bandG, false);
      mesh(g.plate, s.plate, bandG, false);
      if (look.mask) mesh(g.mask, ch(look.maskColor ?? 0x34364a), face, false);
      for (const x of [-0.04, 0.045]) {
        const tail = new THREE.Group();
        tail.position.set(x, 0.085, -0.165);
        tail.rotation.z = x * 2;
        bandG.add(tail);
        mesh(g.bandTail, band, tail, false);
        this.bandTails.push(tail);
      }
    }
    // Arms
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const sh = this.shoulders[i], el = this.elbows[i];
      sh.position.set(0.27 * side, 0.4, 0);
      this.torso.add(sh);
      el.position.y = -0.27;
      sh.add(el);
      if (hero) {
        const tag = i === 0 ? 'L' : 'R';
        this.heroPart(hero, `upperArm_${tag}`, sh, i === 1);
        this.heroPart(hero, `forearm_${tag}`, el, i === 1);
        continue;
      }
      mesh(g.upperArm, i === 1 ? armOutfit : outfit, sh);
      mesh(g.forearm, look.longSleeves ? (i === 1 ? armOutfit : outfit) : i === 1 ? armSkin : skin, el);
      mesh(g.armWrap, s.wrap, el, false);
      mesh(g.fist, i === 1 ? armSkin : skin, el, false);
    }
    // Telegraph: red-orange inverted-hull glow edge around the attacking forearm.
    this.armGlow = new THREE.Mesh(g.armGlow, s.armGlow);
    this.armGlow.visible = false;
    this.elbows[1].add(this.armGlow);
    // Hand orb (Rasengan-like): bright core + swirling translucent shells, parented to the right hand.
    this.orb.position.y = -0.36;
    this.orb.visible = false;
    this.elbows[1].add(this.orb);
    this.orb.add(new THREE.Mesh(g.orbCore, s.orbCore));
    const shellScale: [number, number, number][] = [[1, 0.72, 1], [0.8, 1.15, 0.85], [1.3, 1.2, 0.75]];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(g.orbShell, s.orbShells[i]);
      m.scale.set(...shellScale[i]);
      m.rotation.set(i * 0.9, i * 0.6, i * 0.4);
      this.orb.add(m);
      this.orbShells.push(m);
    }
    // Wall-walking chakra on each sole.
    for (const knee of this.knees) {
      const f = new THREE.Mesh(g.footChakra, s.footChakra);
      f.visible = false;
      knee.add(f);
      this.footChakra.push(f);
    }
    // Aura shell (flame, additive), guard bubble and telegraph marker.
    this.auraMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0x4fb8ff) }, opacity: { value: 0 }, time: { value: 0 } },
      vertexShader: AURA_VERT, fragmentShader: AURA_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.aura = new THREE.Mesh(g.shell, this.auraMat);
    this.aura.visible = false;
    this.body.add(this.aura);
    this.guardMesh = new THREE.Mesh(g.shell, s.guard);
    this.guardMesh.scale.setScalar(0.95);
    this.guardMesh.visible = false;
    this.body.add(this.guardMesh);
    this.warn = new THREE.Mesh(warningGeo(), s.warn);
    this.warn.position.y = 2.35;
    this.warn.renderOrder = 10;
    this.warn.visible = false;
    this.root.add(this.warn);

    this.root.scale.setScalar(look.scale ?? 1);
    computePose('idle', 0, 0, 0, 0, this.pose);
    this.applyPose();
  }

  private mat(m: THREE.MeshToonMaterial): THREE.MeshToonMaterial {
    this.mats.push(m);
    return m;
  }

  /** Attach one Blender part (joint-relative geometry, shared across instances) to its joint group as one mesh. */
  private heroPart(parts: HeroParts, name: HeroPartName, joint: THREE.Object3D, weaponArm = false): void {
    const part = parts.get(name);
    if (!part) return;
    const materials = part.prims.map((p) => {
      if (isHeroDecal(p.material)) return heroDecalMaterial(p);
      const m = this.mat(toon(p.color, { rim: 0.6, ...heroSurfaceParams(p.material) }));
      if (weaponArm) this.armMats.push(m);
      return m;
    });
    const m = new THREE.Mesh(part.geometry, materials);
    m.castShadow = true;
    joint.add(m);
  }

  /** `speed` is horizontal m/s; `animTime` seconds since the state started. */
  update(dt: number, anim: AnimState, animTime: number, speed: number): void {
    this.clock += dt;
    if (anim === 'run' || anim === 'climb') this.phase += dt * speed * ANIM.strideRun;
    else if (anim === 'sprint') this.phase += dt * speed * ANIM.strideSprint;
    else if (anim === 'downed') this.phase += dt * speed * ANIM.strideCrawl;
    computePose(anim, animTime, this.phase, this.clock, speed, this.target);
    const rate = anim === 'dead' ? ANIM.blendDead : ACTION_STATES.has(anim) ? ANIM.blendAction : ANIM.blendLoop;
    const k = 1 - Math.exp(-rate * dt);
    // Full-turn channels (spin kick, roll) are driven directly, then wrapped so blending out never unwinds.
    const direct = anim === 'attack3' ? CH.bodyYaw : anim === 'dodge' || anim === 'launched' ? CH.bodyPitch : -1;
    if (anim !== this.lastAnim) {
      this.pose[CH.bodyYaw] = Math.atan2(Math.sin(this.pose[CH.bodyYaw]), Math.cos(this.pose[CH.bodyYaw]));
      this.pose[CH.bodyPitch] = Math.atan2(Math.sin(this.pose[CH.bodyPitch]), Math.cos(this.pose[CH.bodyPitch]));
      this.lastAnim = anim;
    }
    for (let i = 0; i < POSE_SIZE; i++) this.pose[i] = i === direct ? this.target[i] : this.pose[i] + (this.target[i] - this.pose[i]) * k;
    this.applyPose();

    // Secondary motion: cloth hangs against the body lean, trails back with speed, and ripples down the chain.
    const trail = Math.min(speed / ANIM.clothSpeed, 1) * ANIM.clothTrail;
    const lean = this.pose[CH.torsoPitch] + Math.max(-1.2, this.pose[CH.bodyPitch]);
    const flutter = 0.3 + trail;
    this.scarf.forEach((seg, i) => {
      const wave = Math.sin(this.clock * 10 - i * 1.3) * 0.09 * flutter * (1 + i * 0.6);
      seg.rotation.x = (i === 0 ? -0.12 - lean * 0.9 - trail : -trail * 0.35) + wave;
      seg.rotation.z = Math.sin(this.clock * 6.5 - i) * 0.06 * flutter - (i === 0 ? this.pose[CH.torsoTwist] * 0.5 : 0);
    });
    this.bandTails.forEach((tail, i) => {
      tail.rotation.x = -0.25 - lean * 0.6 - trail * 1.1 + Math.sin(this.clock * 12 + i * 1.7) * 0.12 * flutter;
    });

    // Emissive: hit flash (white) overrides telegraph glow (red, weapon arm).
    this.flashT = Math.max(0, this.flashT - dt);
    const f = this.flashDur > 0 ? (this.flashT / this.flashDur) * ANIM.flashStrength : 0;
    const telegraphOn = (this.telegraph || anim === 'telegraph') && anim !== 'dead';
    const pulse = telegraphOn ? (0.6 + 0.4 * Math.sin(this.clock * 18)) * ANIM.telegraphStrength : 0;
    for (const m of this.mats) {
      if (f > 0) m.emissive.setRGB(f, f, f);
      else if (this.armMats.includes(m)) m.emissive.setRGB(pulse, pulse * 0.15, 0);
      else m.emissive.setRGB(pulse * 0.25, 0, 0);
    }
    this.armGlow.visible = telegraphOn;
    if (telegraphOn) this.armGlow.scale.setScalar(1 + 0.08 * Math.sin(this.clock * 18));
    this.warn.visible = telegraphOn;
    if (this.warn.visible) {
      this.warn.position.y = 2.35 + Math.sin(this.clock * 8) * 0.06;
      this.warn.scale.setScalar(1 + 0.15 * Math.sin(this.clock * 16));
    }

    // Aura fades in/out.
    this.auraLevel += ((this.auraOn ? 1 : 0) - this.auraLevel) * (1 - Math.exp(-8 * dt));
    this.aura.visible = this.auraLevel > 0.01;
    this.auraMat.uniforms.opacity.value = this.auraLevel * (0.85 + 0.15 * Math.sin(this.clock * 7));
    this.auraMat.uniforms.time.value = this.clock;
    const breathe = 1 + 0.04 * Math.sin(this.clock * 6);
    this.aura.scale.set(0.62 * breathe, 1.05 * breathe, 0.56 * breathe);

    if (this.footChakra[0].visible) {
      this.footChakra.forEach((f, i) => {
        const flick = 1 + 0.18 * Math.sin(this.clock * 26 + i * 2.1) + 0.08 * Math.sin(this.clock * 41 + i);
        f.scale.set(flick, 1, flick); // x/z only: scaling y would lift the pad off the sole
      });
    }
    if (this.orb.visible) this.updateOrb(dt);
    if (this.daze?.visible) {
      this.daze.rotation.y += dt * ANIM.dazeSpin;
      this.daze.rotation.z = Math.sin(this.clock * 2.5) * 0.15;
    }
    if (this.guardMesh.visible) this.guardMesh.scale.setScalar(0.95 + 0.03 * Math.sin(this.clock * 10));
  }

  /** Hand orb animation: size, swirl speed and glow follow the charge; Chidori re-rolls its bolts every few frames. */
  private updateOrb(dt: number): void {
    const k = this.orbCharge;
    const size = mix(ANIM.orbMin, ANIM.orbMax, k);
    const glow = mix(0.5, 1.3, k);
    if (this.orbMats) for (const o of this.orbMats) o.mat.color.copy(o.base).multiplyScalar(glow);
    if (this.orbStyle === 'rasengan') {
      const sw = mix(ANIM.swirlMin, ANIM.swirlMax, k);
      this.orbShells[0].rotation.y += dt * 13 * sw;
      this.orbShells[1].rotation.x += dt * 10 * sw;
      this.orbShells[2].rotation.z -= dt * 16 * sw;
      this.orb.scale.setScalar(size * (1 + 0.08 * Math.sin(this.clock * 30)));
      return;
    }
    // Chidori: flicker is render-only randomness.
    this.boltT -= dt;
    this.orb.scale.setScalar(size * (0.85 + 0.25 * Math.random()));
    if (this.boltT > 0 || !this.bolts || !this.arcs) return;
    this.boltT = ANIM.boltFlicker;
    const x = extras();
    this.bolts.geometry = x.bolts[Math.floor(Math.random() * x.bolts.length)];
    this.bolts.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
    this.bolts.scale.setScalar(0.3 + 0.25 * k);
    this.arcs.visible = k >= ANIM.arcCharge;
    if (!this.arcs.visible) return;
    // Arc from the hand to a random point on the ground near the feet (model space).
    const hand = this.orb.getWorldPosition(tmpHand);
    this.root.worldToLocal(hand);
    const dir = tmpDir.set((Math.random() - 0.5) * 1.2 - hand.x * 0.3, -hand.y, 0.3 + Math.random() * 0.5 - hand.z * 0.3);
    const len = dir.length();
    this.arcs.geometry = x.arcs[Math.floor(Math.random() * x.arcs.length)];
    this.arcs.position.copy(hand);
    this.arcs.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / Math.max(len, 1e-3)));
    this.arcs.scale.set(1, len, 1);
  }

  /**
   * Sign conventions: bodyPitch/torsoPitch/headPitch > 0 lean forward; sh*X < 0 raises the arm forward;
   * sh*Z > 0 lifts the arm sideways (outward); elbow/knee > 0 bend; hip*X < 0 swings the leg forward;
   * torsoTwist > 0 brings the right shoulder forward.
   */
  private applyPose(): void {
    const p = this.pose;
    this.body.position.y = 0.95 + p[CH.bodyY];
    this.body.rotation.set(p[CH.bodyPitch], p[CH.bodyYaw], p[CH.bodyRoll], 'YXZ');
    this.torso.rotation.set(p[CH.torsoPitch], p[CH.torsoTwist], p[CH.torsoRoll]);
    this.head.rotation.set(p[CH.headPitch], p[CH.headYaw], 0);
    this.shoulders[0].rotation.set(p[CH.lShX], 0, p[CH.lShZ]);
    this.shoulders[1].rotation.set(p[CH.rShX], 0, -p[CH.rShZ]);
    this.elbows[0].rotation.x = -p[CH.lEl];
    this.elbows[1].rotation.x = -p[CH.rEl];
    this.hipsJ[0].rotation.set(p[CH.lHipX], 0, p[CH.lHipZ]);
    this.hipsJ[1].rotation.set(p[CH.rHipX], 0, -p[CH.rHipZ]);
    this.knees[0].rotation.x = p[CH.lKnee];
    this.knees[1].rotation.x = p[CH.rKnee];
  }

  /** Current blended pose (read-only view, for tests/debug). */
  get currentPose(): Readonly<Float32Array> {
    return this.pose;
  }

  /** Number of meshes in this model (perf budget check). */
  get meshCount(): number {
    let n = 0;
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
    return n;
  }

  /** Visual warning that an attack is coming (glow edge on weapon arm + floating "!"). */
  setTelegraph(on: boolean): void {
    this.telegraph = on;
  }
  /** Brief white hit flash. */
  flash(seconds: number): void {
    this.flashDur = Math.max(seconds, 1e-3);
    this.flashT = this.flashDur;
  }
  /** Chakra flame aura (concentration, special). */
  setAura(on: boolean, color?: number): void {
    this.auraOn = on;
    if (color !== undefined) (this.auraMat.uniforms.color.value as THREE.Color).setHex(color);
  }
  /** Glowing technique in the right hand. `charge` 0..1 scales size/brightness/speed; `style` = Rasengan sphere or Chidori lightning. */
  setHandOrb(on: boolean, charge = 1, style: 'rasengan' | 'chidori' = 'rasengan'): void {
    this.orb.visible = on;
    if (this.arcs && !on) this.arcs.visible = false;
    if (!on) return;
    this.orbCharge = clamp01(charge);
    this.orbStyle = style;
    if (!this.orbMats) {
      this.orbMats = [];
      for (const m of this.orb.children as THREE.Mesh[]) {
        const mat = (m.material as THREE.MeshBasicMaterial).clone();
        m.material = mat;
        this.orbMats.push({ mat, base: mat.color.clone() });
      }
    }
    const chidori = style === 'chidori';
    for (const m of this.orbShells) m.visible = !chidori;
    if (chidori && !this.bolts) {
      const x = extras();
      this.bolts = new THREE.Mesh(x.bolts[0], x.bolt);
      this.bolts.renderOrder = 3;
      this.orb.add(this.bolts);
      this.arcs = new THREE.Mesh(x.arcs[0], x.bolt);
      this.arcs.renderOrder = 3;
      this.arcs.visible = false;
      this.root.add(this.arcs);
    }
    if (this.bolts) this.bolts.visible = chidori;
    if (this.arcs && !chidori) this.arcs.visible = false;
  }
  /** Blue chakra glow on both soles (wall-walking). */
  setFootChakra(on: boolean): void {
    for (const f of this.footChakra) f.visible = on;
  }
  /** Genjutsu daze marker: spinning ring of stars over the head. Called every frame (cheap when unchanged). */
  setDazed(on: boolean): void {
    if (!this.daze) {
      if (!on) return;
      const x = extras();
      this.daze = new THREE.Mesh(x.daze, x.dazeMat);
      this.daze.position.y = 0.15 + ANIM.dazeHeight;
      this.head.add(this.daze);
    }
    this.daze.visible = on;
  }
  /** Sharingan: glowing red irises with black marks around the pupils (procedural face only). */
  setSharingan(on: boolean): void {
    if (!this.iris || !this.irisMatBase) return;
    const x = extras();
    if (on && !this.tomoe) {
      this.tomoe = new THREE.Mesh(x.tomoe, sharedMat().ink);
      this.iris.parent!.add(this.tomoe);
    }
    this.iris.material = on ? x.sharingan : this.irisMatBase;
    if (this.tomoe) this.tomoe.visible = on;
  }
  /** Coloured rim on every body material (PvP team red/blue), null removes it. Cheap when unchanged. */
  setTeamTint(color: number | null): void {
    if (color === this.tint) return;
    this.tint = color;
    for (const m of this.mats) (m.userData.rimTint as THREE.Color | undefined)?.setHex(color ?? 0);
  }
  get teamTint(): number | null {
    return this.tint;
  }
  /** Guard bubble/pose highlight. */
  setGuard(on: boolean): void {
    this.guardMesh.visible = on;
  }
  dispose(): void {
    for (const m of this.mats) m.dispose();
    this.orbMats?.forEach((o) => o.mat.dispose());
    this.auraMat.dispose();
    this.root.removeFromParent();
  }
}
