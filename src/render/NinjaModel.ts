import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AnimState } from '../core/types';
import { COMBAT } from '../config/combat';
import { toon } from './toon';

export interface NinjaLook {
  /** Main outfit colour. */
  outfit: number;
  /** Secondary (vest, trim). */
  accent: number;
  hair: number;
  skin: number;
  /** Headband plate colour. */
  headband: number;
  /** Optional mask (enemies). */
  mask?: boolean;
  scale?: number;
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
  blendLoop: 12, blendAction: 28, blendDead: 10,
  /** Run-cycle phase advance per metre travelled (rad/m). */
  strideRun: 1.25, strideSprint: 1.0,
  /** Below this speed the run cycle fades out (m/s). */
  runFullSpeed: 3,
  breathRate: 2.2,
  climbRate: 7,
  /** Dodge roll length (s) — matches the combat dodge. */
  dodgeTime: COMBAT.dodge.duration,
  deathTime: 0.7,
  /** Hit-flash and telegraph emissive strength. */
  flashStrength: 1.2, telegraphStrength: 0.9,
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => { const c = clamp01(x); return c * c * (3 - 2 * c); };
const TAU = Math.PI * 2;

/** One-shot states snap faster to their pose. */
const ACTION_STATES = new Set<AnimState>(['attack1', 'attack2', 'attack3', 'throw', 'special', 'dodge', 'hit', 'telegraph', 'guard']);

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
      out[P.bodyY] = b * 0.012 - 0.02;
      out[P.torsoPitch] = 0.05 + b * 0.025;
      out[P.headPitch] = -b * 0.02;
      out[P.lShZ] = out[P.rShZ] = 0.16 + b * 0.03;
      out[P.lEl] = out[P.rEl] = 0.3;
      out[P.lHipZ] = out[P.rHipZ] = 0.06;
      out[P.lKnee] = out[P.rKnee] = 0.12;
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
    case 'sprint': {
      const s = Math.sin(phase);
      out[P.lHipX] = -1.05 * s; out[P.rHipX] = 1.05 * s;
      out[P.lKnee] = 0.3 + 1.3 * (0.5 + 0.5 * Math.cos(phase));
      out[P.rKnee] = 0.3 + 1.3 * (0.5 - 0.5 * Math.cos(phase));
      out[P.torsoPitch] = 0.7; out[P.headPitch] = -0.55;
      out[P.lShX] = out[P.rShX] = 1.3 + 0.05 * s; // arms swept back, ninja run
      out[P.lShZ] = out[P.rShZ] = 0.22;
      out[P.lEl] = out[P.rEl] = 0.15;
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
    case 'climb': {
      const s = Math.sin(t * ANIM.climbRate);
      out[P.lShX] = -2.75 + 0.45 * s; out[P.rShX] = -2.75 - 0.45 * s; // alternating reach
      out[P.lEl] = 0.5 - 0.4 * s; out[P.rEl] = 0.5 + 0.4 * s;
      out[P.lShZ] = out[P.rShZ] = 0.25;
      out[P.lHipX] = -0.9 - 0.4 * s; out[P.rHipX] = -0.9 + 0.4 * s;
      out[P.lKnee] = 1.3 + 0.3 * s; out[P.rKnee] = 1.3 - 0.3 * s;
      out[P.torsoPitch] = -0.08; out[P.headPitch] = -0.35;
      out[P.bodyY] = 0.03 * Math.abs(s);
      break;
    }
    case 'attack1': { // straight jab (right)
      const c = COMBAT.combo[0];
      const wind = t < c.windup ? smooth(t / c.windup) : 1 - smooth((t - c.windup) / 0.05);
      const p = t < c.windup ? 0 : t < c.windup + c.active ? smooth((t - c.windup) / (c.active * 0.5)) : 1 - smooth((t - c.windup - c.active) / c.recovery);
      fightStance();
      out[P.rShX] = -0.4 - 1.15 * p; out[P.rShZ] = 0.1; out[P.rEl] = 1.9 - 1.85 * p + 0.3 * wind;
      out[P.lShX] = -1.1; out[P.lShZ] = 0.15; out[P.lEl] = 2.0;
      out[P.torsoTwist] = -0.25 * wind + 0.5 * p; out[P.torsoPitch] = 0.15 + 0.1 * p;
      break;
    }
    case 'attack2': { // left hook
      const c = COMBAT.combo[1];
      const wind = t < c.windup ? smooth(t / c.windup) : 1 - smooth((t - c.windup) / 0.05);
      const p = t < c.windup ? 0 : t < c.windup + c.active ? smooth((t - c.windup) / (c.active * 0.6)) : 1 - smooth((t - c.windup - c.active) / c.recovery);
      fightStance();
      out[P.lShX] = -1.25 - 0.25 * p; out[P.lShZ] = 1.1 + 0.2 * wind - 1.5 * p; out[P.lEl] = 1.5;
      out[P.rShX] = -1.1; out[P.rShZ] = 0.15; out[P.rEl] = 2.0;
      out[P.torsoTwist] = 0.35 * wind - 0.75 * p; out[P.torsoPitch] = 0.18;
      out[P.bodyY] -= 0.05 * p;
      break;
    }
    case 'attack3': { // spinning roundhouse kick
      const c = COMBAT.combo[2];
      const spinEnd = c.windup + c.active;
      out[P.bodyYaw] = smooth(t / spinEnd) * TAU;
      const p = t < c.windup * 0.5 ? 0 : t < spinEnd ? smooth((t - c.windup * 0.5) / (c.windup * 0.6)) : 1 - smooth((t - spinEnd) / c.recovery);
      out[P.rHipZ] = 1.45 * p; out[P.rHipX] = -0.35 * p; out[P.rKnee] = 0.15 + (1 - p) * 0.9;
      out[P.lKnee] = 0.35; out[P.lHipX] = -0.1;
      out[P.torsoRoll] = -0.4 * p; out[P.bodyRoll] = -0.15 * p;
      out[P.lShZ] = out[P.rShZ] = 0.3 + 0.9 * p; out[P.lEl] = out[P.rEl] = 0.6;
      out[P.bodyY] = 0.06 * p - 0.05;
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
      const thrust = smooth((t - COMBAT.special.windup) / 0.08);
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
      out[P.lKnee] = out[P.rKnee] = 0.9 * slump * (1 - fall) + 0.25 * fall;
      out[P.lHipZ] = 0.15 * fall; out[P.rHipZ] = 0.25 * fall;
      out[P.bodyPitch] = -1.5 * fall;
      out[P.bodyY] = -0.2 * slump * (1 - fall) - 0.78 * fall;
      out[P.lShZ] = out[P.rShZ] = 0.3 + 1.0 * fall; out[P.lShX] = -0.3 * fall; out[P.rShX] = -0.6 * fall; out[P.lEl] = out[P.rEl] = 0.3;
      out[P.headPitch] = 0.3 * slump * (1 - fall) - 0.15 * fall; out[P.headYaw] = 0.5 * fall;
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
    case 'telegraph': { // wind-up: weapon arm raised high
      const q = smooth(t / 0.2);
      fightStance();
      out[P.rShX] = -2.85 * q; out[P.rShZ] = 0.3; out[P.rEl] = 0.5;
      out[P.lShX] = -0.9 * q; out[P.lEl] = 0.6;
      out[P.torsoTwist] = 0.45 * q; out[P.torsoPitch] = -0.15 * q;
      out[P.headPitch] = 0.05;
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Shared geometry (created once, lives for the app; per-instance resources are materials only).
// ---------------------------------------------------------------------------------------------

interface SharedGeo {
  pelvis: THREE.BufferGeometry; chest: THREE.BufferGeometry; belt: THREE.BufferGeometry; collar: THREE.BufferGeometry;
  scarfTail: THREE.BufferGeometry; thigh: THREE.BufferGeometry; shin: THREE.BufferGeometry; foot: THREE.BufferGeometry;
  upperArm: THREE.BufferGeometry; forearm: THREE.BufferGeometry; hand: THREE.BufferGeometry; head: THREE.BufferGeometry;
  hair: THREE.BufferGeometry; band: THREE.BufferGeometry; plate: THREE.BufferGeometry; bandTail: THREE.BufferGeometry;
  eye: THREE.BufferGeometry; mask: THREE.BufferGeometry; shell: THREE.BufferGeometry; bang: THREE.BufferGeometry;
  orbCore: THREE.BufferGeometry; orbShell: THREE.BufferGeometry; orbRing: THREE.BufferGeometry;
}
let geo: SharedGeo | null = null;
function sharedGeo(): SharedGeo {
  if (geo) return geo;
  const hairParts: THREE.BufferGeometry[] = [];
  // Spiky hair: cones radiating from the top/back of the head.
  const spikes: [number, number, number][] = [
    [0, 1, 0], [0.5, 0.8, -0.3], [-0.5, 0.8, -0.3], [0, 0.7, -0.7], [0.75, 0.4, -0.5], [-0.75, 0.4, -0.5],
    [0.3, 0.9, 0.35], [-0.3, 0.9, 0.35], [0, 0.3, -1], [0.45, 0.2, -0.85], [-0.45, 0.2, -0.85],
  ];
  const up = new THREE.Vector3(0, 1, 0);
  for (const [x, y, z] of spikes) {
    const dir = new THREE.Vector3(x, y, z).normalize();
    const g = new THREE.ConeGeometry(0.075, 0.24, 5);
    g.translate(0, 0.12, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(dir.x * 0.12, dir.y * 0.12, dir.z * 0.12);
    hairParts.push(g);
  }
  hairParts.push(new THREE.SphereGeometry(0.17, 10, 6, 0, TAU, 0, Math.PI * 0.55)); // hair cap
  const hair = mergeGeometries(hairParts.map((g) => g.toNonIndexed()));
  hairParts.forEach((g) => g.dispose());
  const tail = new THREE.BoxGeometry(0.1, 0.32, 0.02); tail.translate(0, -0.16, 0);
  const bandTail = new THREE.BoxGeometry(0.04, 0.2, 0.01); bandTail.translate(0, -0.1, 0);
  const cap = (r: number, len: number, y: number) => { const g = new THREE.CapsuleGeometry(r, len, 3, 8); g.translate(0, y, 0); return g; };
  const chest = new THREE.CylinderGeometry(0.21, 0.16, 0.46, 10); chest.scale(1, 1, 0.72); chest.translate(0, 0.24, 0);
  const foot = new THREE.BoxGeometry(0.12, 0.08, 0.25); foot.translate(0, -0.44, 0.04);
  const hand = new THREE.SphereGeometry(0.075, 8, 6); hand.translate(0, -0.27, 0);
  const plate = new THREE.BoxGeometry(0.15, 0.065, 0.025);
  const mask = new THREE.SphereGeometry(0.172, 12, 6, 0, TAU, Math.PI * 0.55, Math.PI * 0.3);
  const bang = new THREE.ConeGeometry(0.05, 0.14, 4); bang.rotateX(Math.PI * 0.85);
  geo = {
    pelvis: new THREE.BoxGeometry(0.34, 0.18, 0.22),
    chest,
    belt: new THREE.CylinderGeometry(0.175, 0.175, 0.07, 10).scale(1, 1, 0.75),
    collar: new THREE.TorusGeometry(0.13, 0.045, 6, 12).rotateX(Math.PI / 2),
    scarfTail: tail,
    thigh: cap(0.085, 0.3, -0.21), shin: cap(0.075, 0.3, -0.21), foot,
    upperArm: cap(0.07, 0.2, -0.15), forearm: cap(0.065, 0.16, -0.13), hand,
    head: new THREE.SphereGeometry(0.16, 14, 10),
    hair,
    band: new THREE.CylinderGeometry(0.168, 0.168, 0.055, 14, 1, true),
    plate, bandTail,
    eye: new THREE.BoxGeometry(0.045, 0.02, 0.01),
    mask,
    shell: new THREE.SphereGeometry(1, 18, 12),
    bang,
    orbCore: new THREE.SphereGeometry(0.1, 12, 8),
    orbShell: new THREE.SphereGeometry(0.19, 14, 10),
    orbRing: new THREE.TorusGeometry(0.15, 0.012, 4, 20),
  };
  return geo;
}

interface SharedMat { eye: THREE.MeshBasicMaterial; plate: THREE.MeshToonMaterial; orbCore: THREE.MeshBasicMaterial; orbShell: THREE.MeshBasicMaterial; orbRing: THREE.MeshBasicMaterial; guard: THREE.MeshBasicMaterial; warn: THREE.MeshBasicMaterial }
let mats: SharedMat | null = null;
function sharedMat(): SharedMat {
  if (mats) return mats;
  const add = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  mats = {
    eye: new THREE.MeshBasicMaterial({ color: 0x15151c }),
    plate: toon(0xc9d2dc, { emissive: 0x222831 }),
    orbCore: new THREE.MeshBasicMaterial({ color: 0xe6f8ff }),
    orbShell: add(0x3aa8ff, 0.55),
    orbRing: add(0x9fe0ff, 0.8),
    guard: add(0x66c8ff, 0.14),
    warn: new THREE.MeshBasicMaterial({ color: 0xff3b1f, depthTest: false, transparent: true }),
  };
  return mats;
}

let warnGeo: THREE.BufferGeometry | null = null;
function warningGeo(): THREE.BufferGeometry {
  if (warnGeo) return warnGeo;
  const bar = new THREE.BoxGeometry(0.08, 0.3, 0.08); bar.translate(0, 0.12, 0);
  const dot = new THREE.BoxGeometry(0.08, 0.08, 0.08); dot.translate(0, -0.12, 0);
  warnGeo = mergeGeometries([bar.toNonIndexed(), dot.toNonIndexed()]);
  bar.dispose(); dot.dispose();
  return warnGeo;
}

const AURA_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y;
  gl_Position = projectionMatrix * mv;
}`;
const AURA_FRAG = /* glsl */ `
uniform vec3 color; uniform float opacity; uniform float time;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float flicker = 0.75 + 0.25 * sin(time * 9.0 + vY * 12.0);
  gl_FragColor = vec4(color * (f * 1.2 + 0.06) * opacity * flicker, 1.0);
}`;

/**
 * Procedurally animated low-poly ninja. Feet at local origin, faces +Z.
 * Hierarchy: root → body (pivot at hip height) → hips → legs / torso → head, arms.
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
  private readonly scarf: THREE.Mesh;
  private readonly bandTails: THREE.Group;
  private readonly orb = new THREE.Group();
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

  constructor(readonly look: NinjaLook) {
    const g = sharedGeo();
    const s = sharedMat();
    const outfit = this.mat(toon(look.outfit));
    const accent = this.mat(toon(look.accent));
    const skin = this.mat(toon(look.skin));
    const hair = this.mat(toon(look.hair));
    const band = this.mat(toon(look.headband));
    const armOutfit = toon(look.outfit), armSkin = toon(look.skin);
    this.mats.push(armOutfit, armSkin);
    this.armMats.push(armOutfit, armSkin);
    const mask = look.mask ? this.mat(toon(0x30323a)) : null;

    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, shadow = true) => {
      const m = new THREE.Mesh(geometry, material);
      m.castShadow = shadow;
      parent.add(m);
      return m;
    };

    this.root.add(this.body);
    this.body.position.y = 0.95;
    mesh(g.pelvis, accent, this.body);
    // Legs
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1; // left = +X
      const hip = this.hipsJ[i], knee = this.knees[i];
      hip.position.set(0.1 * side, -0.05, 0);
      this.body.add(hip);
      mesh(g.thigh, outfit, hip);
      knee.position.y = -0.43;
      hip.add(knee);
      mesh(g.shin, outfit, knee);
      mesh(g.foot, accent, knee, false);
    }
    // Torso
    this.torso.position.y = 0.06;
    this.body.add(this.torso);
    mesh(g.chest, outfit, this.torso);
    mesh(g.belt, accent, this.torso, false).position.y = 0.03;
    mesh(g.collar, accent, this.torso, false).position.y = 0.46;
    this.scarf = mesh(g.scarfTail, accent, this.torso, false);
    this.scarf.position.set(0.05, 0.45, -0.13);
    // Head
    this.head.position.y = 0.48;
    this.torso.add(this.head);
    mesh(g.head, skin, this.head).position.y = 0.14;
    const hairMesh = mesh(g.hair, hair, this.head);
    hairMesh.position.set(0, 0.17, -0.01);
    for (const x of [-0.07, 0, 0.07]) {
      const b = mesh(g.bang, hair, this.head, false);
      b.position.set(x, 0.24, 0.13);
    }
    mesh(g.band, band, this.head, false).position.y = 0.2;
    const plate = mesh(g.plate, s.plate, this.head, false);
    plate.position.set(0, 0.2, 0.165);
    this.bandTails = new THREE.Group();
    this.bandTails.position.set(0, 0.2, -0.16);
    this.head.add(this.bandTails);
    for (const x of [-0.035, 0.035]) mesh(g.bandTail, band, this.bandTails, false).position.x = x;
    for (const x of [-0.06, 0.06]) mesh(g.eye, s.eye, this.head, false).position.set(x, 0.155, 0.152);
    if (mask) mesh(g.mask, mask, this.head, false).position.y = 0.14;
    // Arms
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const sh = this.shoulders[i], el = this.elbows[i];
      sh.position.set(0.25 * side, 0.4, 0);
      this.torso.add(sh);
      mesh(g.upperArm, i === 1 ? armOutfit : outfit, sh);
      el.position.y = -0.3;
      sh.add(el);
      mesh(g.forearm, i === 1 ? armSkin : skin, el);
      mesh(g.hand, i === 1 ? armSkin : skin, el, false);
    }
    // Hand orb (Rasengan-like), parented to the right hand.
    this.orb.position.y = -0.36;
    this.orb.visible = false;
    this.elbows[1].add(this.orb);
    this.orb.add(new THREE.Mesh(g.orbCore, s.orbCore), new THREE.Mesh(g.orbShell, s.orbShell));
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(g.orbRing, s.orbRing);
      r.rotation.set(i * 1.1, i * 0.7, 0);
      this.orb.add(r);
    }
    // Aura shell (fresnel, additive), guard bubble and telegraph marker.
    this.auraMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0x4fb8ff) }, opacity: { value: 0 }, time: { value: 0 } },
      vertexShader: AURA_VERT, fragmentShader: AURA_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.aura = new THREE.Mesh(g.shell, this.auraMat);
    this.aura.scale.set(0.6, 1.05, 0.55);
    this.aura.position.y = 0.0;
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

  /** `speed` is horizontal m/s; `animTime` seconds since the state started. */
  update(dt: number, anim: AnimState, animTime: number, speed: number): void {
    this.clock += dt;
    if (anim === 'run') this.phase += dt * speed * ANIM.strideRun;
    else if (anim === 'sprint') this.phase += dt * speed * ANIM.strideSprint;
    computePose(anim, animTime, this.phase, this.clock, speed, this.target);
    const rate = anim === 'dead' ? ANIM.blendDead : ACTION_STATES.has(anim) ? ANIM.blendAction : ANIM.blendLoop;
    const k = 1 - Math.exp(-rate * dt);
    // Full-turn channels (spin kick, roll) are driven directly, then wrapped so blending out never unwinds.
    const direct = anim === 'attack3' ? CH.bodyYaw : anim === 'dodge' ? CH.bodyPitch : -1;
    if (anim !== this.lastAnim) {
      this.pose[CH.bodyYaw] = Math.atan2(Math.sin(this.pose[CH.bodyYaw]), Math.cos(this.pose[CH.bodyYaw]));
      this.pose[CH.bodyPitch] = Math.atan2(Math.sin(this.pose[CH.bodyPitch]), Math.cos(this.pose[CH.bodyPitch]));
      this.lastAnim = anim;
    }
    for (let i = 0; i < POSE_SIZE; i++) this.pose[i] = i === direct ? this.target[i] : this.pose[i] + (this.target[i] - this.pose[i]) * k;
    this.applyPose();

    // Secondary motion: scarf and headband tails trail behind with speed.
    const trail = Math.min(speed / 12, 1);
    this.scarf.rotation.x = -0.15 - trail * 1.1 + Math.sin(this.clock * 10) * 0.08 * (0.3 + trail);
    this.bandTails.rotation.x = -0.2 - trail * 1.0 + Math.sin(this.clock * 12 + 1) * 0.1 * (0.3 + trail);

    // Emissive: hit flash (white) overrides telegraph glow (red, weapon arm).
    this.flashT = Math.max(0, this.flashT - dt);
    const f = this.flashDur > 0 ? (this.flashT / this.flashDur) * ANIM.flashStrength : 0;
    const telegraphOn = this.telegraph || anim === 'telegraph';
    const pulse = telegraphOn ? (0.6 + 0.4 * Math.sin(this.clock * 18)) * ANIM.telegraphStrength : 0;
    for (const m of this.mats) {
      if (f > 0) m.emissive.setRGB(f, f, f);
      else if (this.armMats.includes(m)) m.emissive.setRGB(pulse, pulse * 0.15, 0);
      else m.emissive.setRGB(pulse * 0.25, 0, 0);
    }
    this.warn.visible = telegraphOn && anim !== 'dead';
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
    this.aura.scale.set(0.62 * breathe, 1.08 * breathe, 0.56 * breathe);

    if (this.orb.visible) {
      this.orb.rotation.y += dt * 14;
      this.orb.children.forEach((c, i) => { if (i >= 2) c.rotation.x += dt * (9 + i * 3); });
      this.orb.scale.setScalar(1 + 0.08 * Math.sin(this.clock * 30));
    }
    if (this.guardMesh.visible) this.guardMesh.scale.setScalar(0.95 + 0.03 * Math.sin(this.clock * 10));
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

  /** Visual warning that an attack is coming (glow/flash on weapon arm). */
  setTelegraph(on: boolean): void {
    this.telegraph = on;
  }
  /** Brief white/red hit flash. */
  flash(seconds: number): void {
    this.flashDur = Math.max(seconds, 1e-3);
    this.flashT = this.flashDur;
  }
  /** Chakra aura (concentration, special). */
  setAura(on: boolean, color?: number): void {
    this.auraOn = on;
    if (color !== undefined) (this.auraMat.uniforms.color.value as THREE.Color).setHex(color);
  }
  /** Glowing chakra sphere in the right hand (Rasengan wind-up/dash). */
  setHandOrb(on: boolean): void {
    this.orb.visible = on;
  }
  /** Guard bubble/pose highlight. */
  setGuard(on: boolean): void {
    this.guardMesh.visible = on;
  }
  dispose(): void {
    for (const m of this.mats) m.dispose();
    this.auraMat.dispose();
    this.root.removeFromParent();
  }
}
