/**
 * Binary wire format of `PlayerInput` (client → server) and `Snapshot` (server → client). Node-safe, shared by both sides.
 *
 * Quantization (all big-endian, DataView):
 * - positions: int32 millimetres (±2147 km, error ≤ 0.5 mm); velocities: int16 cm/s (±327 m/s, error ≤ 5 mm/s)
 * - angles: uint16 over a full turn (error ≤ 0.003°); pitch int16 over ±π; unit vectors int16 / 32767; wall normal int8 / 127
 * - animTime uint16 1/100 s (≤ 655 s); hp, maxHp, chakra, maxChakra uint16 at 0.1 (≤ 6553.5); orbLevel uint8 / 255
 * - actor and lock ids uint32 (ids are never reused within a session, so 16 bits could wrap).
 * Snapshot delta: each actor is either a full record or "same as in the previous snapshot this decoder received"
 * (WebSocket is ordered and reliable). Actors absent from a snapshot are gone. Header bit 0 = full snapshot (no references).
 * Events, players, markers, mode and `you` travel as a JSON tail.
 */
import type { AnimState, QteDir, Team } from '../core/types';
import type { ActorState, PlayerInput, ProjectileState, Snapshot } from '../sim/protocol';

/** Bump on any change of the binary layout below. */
export const CODEC_VERSION = 1;
const INPUT_MAGIC = 0x49; // 'I'
const SNAP_MAGIC = 0x53; // 'S'
const FLAG_FULL = 1;

/** Fixed index list for ActorState.anim. Append only: the index is on the wire. */
export const ANIM_STATES = [
  'idle', 'run', 'sprint', 'jump', 'fall', 'climb',
  'attack1', 'attack2', 'attack3', 'attack4', 'attack5', 'throw', 'special',
  'guard', 'dodge', 'hit', 'dead', 'concentrate', 'telegraph',
  'dash', 'launched', 'substitution',
  'charge', 'chidori', 'sharingan', 'dazed',
  'grabHold', 'strikeUp', 'strikeDown', 'strikeLeft', 'strikeRight', 'grabFinisher', 'grabbed',
  'downed',
] as const satisfies readonly AnimState[];
// Compile-time check that every AnimState is listed.
const animComplete: Exclude<AnimState, (typeof ANIM_STATES)[number]> extends never ? true : never = true;
void animComplete;
export const TEAMS = ['player', 'enemy', 'red', 'blue'] as const satisfies readonly Team[];
export const PROJECTILE_VISUALS = ['kunai', 'shuriken', 'chakra'] as const satisfies readonly ProjectileState['visual'][];
const QTE_DIRS = ['up', 'down', 'left', 'right'] as const satisfies readonly QteDir[];

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Rounds v·scale into [lo, hi]; NaN → 0. */
const q = (v: number, scale: number, lo: number, hi: number): number => clamp(Math.round((v || 0) * scale), lo, hi);
const angleToU16 = (a: number): number => Math.round((((a || 0) % TAU) + TAU) % TAU / TAU * 65536) & 0xffff;
const u16ToAngle = (v: number): number => { const a = v / 65536 * TAU; return a > Math.PI ? a - TAU : a; };
const index = <T>(list: readonly T[], v: T): number => Math.max(0, list.indexOf(v));
const at = <T>(list: readonly T[], i: number): T => {
  if (i >= list.length) throw new Error(`codec: index ${i} out of range`);
  return list[i];
};

// ---------------------------------------------------------------- inputs

const INPUT_BYTES = 29;

/** Encodes 1..255 inputs into one binary packet. */
export function encodeInputs(inputs: readonly PlayerInput[]): Uint8Array {
  const buf = new Uint8Array(3 + inputs.length * INPUT_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint8(0, INPUT_MAGIC); v.setUint8(1, CODEC_VERSION); v.setUint8(2, inputs.length);
  let o = 3;
  for (const i of inputs) {
    v.setUint32(o, i.seq >>> 0); o += 4;
    v.setInt8(o++, q(i.moveX, 127, -127, 127));
    v.setInt8(o++, q(i.moveZ, 127, -127, 127));
    v.setUint16(o, angleToU16(i.camYaw)); o += 2;
    v.setInt16(o, q(i.camPitch, 32767 / Math.PI, -32767, 32767)); o += 2;
    v.setUint32(o, i.held >>> 0); o += 4;
    v.setUint32(o, i.pressed >>> 0); o += 4;
    const a = i.aimDir;
    v.setInt16(o, a ? q(a.x, 32767, -32767, 32767) : 0);
    v.setInt16(o + 2, a ? q(a.y, 32767, -32767, 32767) : 0);
    v.setInt16(o + 4, a ? q(a.z, 32767, -32767, 32767) : 0); o += 6;
    v.setUint32(o, i.lockId >>> 0); o += 4;
    v.setUint8(o++, i.qte ? QTE_DIRS.indexOf(i.qte) + 1 : 0);
  }
  return buf;
}

/** Decodes an input packet. Throws on a malformed or foreign packet (server: ignore/close). */
export function decodeInputs(data: Uint8Array): PlayerInput[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 3 || v.getUint8(0) !== INPUT_MAGIC || v.getUint8(1) !== CODEC_VERSION) throw new Error('codec: not an input packet');
  const n = v.getUint8(2);
  if (data.length !== 3 + n * INPUT_BYTES) throw new Error('codec: bad input packet length');
  const out: PlayerInput[] = [];
  let o = 3;
  for (let k = 0; k < n; k++) {
    const seq = v.getUint32(o); o += 4;
    const moveX = v.getInt8(o++) / 127;
    const moveZ = v.getInt8(o++) / 127;
    const camYaw = u16ToAngle(v.getUint16(o)); o += 2;
    const camPitch = v.getInt16(o) / (32767 / Math.PI); o += 2;
    const held = v.getUint32(o); o += 4;
    const pressed = v.getUint32(o); o += 4;
    const ax = v.getInt16(o), ay = v.getInt16(o + 2), az = v.getInt16(o + 4); o += 6;
    const lockId = v.getUint32(o); o += 4;
    const qi = v.getUint8(o++);
    const input: PlayerInput = { seq, moveX, moveZ, camYaw, camPitch, held, pressed, lockId, qte: qi ? at(QTE_DIRS, qi - 1) : null };
    if (ax || ay || az) input.aimDir = { x: ax / 32767, y: ay / 32767, z: az / 32767 };
    out.push(input);
  }
  return out;
}

// ---------------------------------------------------------------- snapshots

const HEADER_BYTES = 19;
const ACTOR_BYTES = 38;
const PROJ_BYTES = 23;

function writeActor(v: DataView, o: number, a: ActorState): void {
  v.setUint8(o, index(TEAMS, a.team));
  v.setInt32(o + 1, q(a.x, 1000, -2147483647, 2147483647));
  v.setInt32(o + 5, q(a.y, 1000, -2147483647, 2147483647));
  v.setInt32(o + 9, q(a.z, 1000, -2147483647, 2147483647));
  v.setInt16(o + 13, q(a.vx, 100, -32767, 32767));
  v.setInt16(o + 15, q(a.vy, 100, -32767, 32767));
  v.setInt16(o + 17, q(a.vz, 100, -32767, 32767));
  v.setUint16(o + 19, angleToU16(a.yaw));
  v.setUint8(o + 21, index(ANIM_STATES, a.anim));
  v.setUint16(o + 22, q(a.animTime, 100, 0, 65535));
  v.setUint16(o + 24, q(a.hp, 10, 0, 65535));
  v.setUint16(o + 26, q(a.maxHp, 10, 0, 65535));
  v.setUint16(o + 28, q(a.chakra, 10, 0, 65535));
  v.setUint16(o + 30, q(a.maxChakra, 10, 0, 65535));
  v.setUint16(o + 32, a.flags & 0xffff);
  v.setUint8(o + 34, a.orb & 0xff);
  v.setUint8(o + 35, q(a.orbLevel, 255, 0, 255));
  v.setInt8(o + 36, q(a.wallNx, 127, -127, 127));
  v.setInt8(o + 37, q(a.wallNz, 127, -127, 127));
}

function readActor(v: DataView, o: number, id: number): ActorState {
  return {
    id,
    team: at(TEAMS, v.getUint8(o)),
    x: v.getInt32(o + 1) / 1000, y: v.getInt32(o + 5) / 1000, z: v.getInt32(o + 9) / 1000,
    vx: v.getInt16(o + 13) / 100, vy: v.getInt16(o + 15) / 100, vz: v.getInt16(o + 17) / 100,
    yaw: u16ToAngle(v.getUint16(o + 19)),
    anim: at(ANIM_STATES, v.getUint8(o + 21)),
    animTime: v.getUint16(o + 22) / 100,
    hp: v.getUint16(o + 24) / 10, maxHp: v.getUint16(o + 26) / 10,
    chakra: v.getUint16(o + 28) / 10, maxChakra: v.getUint16(o + 30) / 10,
    flags: v.getUint16(o + 32),
    orb: v.getUint8(o + 34),
    orbLevel: v.getUint8(o + 35) / 255,
    wallNx: v.getInt8(o + 36) / 127, wallNz: v.getInt8(o + 37) / 127,
  };
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Per-recipient snapshot encoder: remembers the actor records it sent last for the delta. */
export class SnapshotEncoder {
  private prev = new Map<number, Uint8Array>();
  private sentFull = false;

  /** `full` forces a snapshot without references (the first one always is). */
  encode(snap: Snapshot, full = false): Uint8Array {
    full ||= !this.sentFull;
    this.sentFull = true;
    const json = new TextEncoder().encode(JSON.stringify({
      events: snap.events, players: snap.players, markers: snap.markers, mode: snap.mode, you: snap.you,
    }));
    const rec = new Uint8Array(ACTOR_BYTES);
    const recView = new DataView(rec.buffer);
    const next = new Map<number, Uint8Array>();
    const parts: { id: number; rec: Uint8Array | null }[] = [];
    for (const a of snap.actors) {
      writeActor(recView, 0, a);
      const old = this.prev.get(a.id);
      const same = !full && old !== undefined && sameBytes(old, rec);
      const copy = same ? old : rec.slice();
      next.set(a.id, copy);
      parts.push({ id: a.id, rec: same ? null : copy });
    }
    this.prev = next;
    const actorBytes = parts.reduce((s, p) => s + 5 + (p.rec ? ACTOR_BYTES : 0), 0);
    const buf = new Uint8Array(HEADER_BYTES + actorBytes + snap.projectiles.length * PROJ_BYTES + 4 + json.length);
    const v = new DataView(buf.buffer);
    v.setUint8(0, SNAP_MAGIC); v.setUint8(1, CODEC_VERSION); v.setUint8(2, full ? FLAG_FULL : 0);
    v.setUint32(3, snap.tick >>> 0);
    v.setFloat64(7, snap.time);
    v.setUint16(15, parts.length);
    v.setUint16(17, snap.projectiles.length);
    let o = HEADER_BYTES;
    for (const p of parts) {
      v.setUint32(o, p.id >>> 0);
      v.setUint8(o + 4, p.rec ? 1 : 0);
      o += 5;
      if (p.rec) { buf.set(p.rec, o); o += ACTOR_BYTES; }
    }
    for (const p of snap.projectiles) {
      v.setUint32(o, p.id >>> 0);
      v.setInt32(o + 4, q(p.x, 1000, -2147483647, 2147483647));
      v.setInt32(o + 8, q(p.y, 1000, -2147483647, 2147483647));
      v.setInt32(o + 12, q(p.z, 1000, -2147483647, 2147483647));
      v.setInt16(o + 16, q(p.dx, 32767, -32767, 32767));
      v.setInt16(o + 18, q(p.dy, 32767, -32767, 32767));
      v.setInt16(o + 20, q(p.dz, 32767, -32767, 32767));
      v.setUint8(o + 22, index(PROJECTILE_VISUALS, p.visual));
      o += PROJ_BYTES;
    }
    v.setUint32(o, json.length);
    buf.set(json, o + 4);
    return buf;
  }
}

/** Per-connection snapshot decoder: keeps the previous actors to resolve "same as previous" records. */
export class SnapshotDecoder {
  private prev = new Map<number, ActorState>();

  decode(data: Uint8Array): Snapshot {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length < HEADER_BYTES || v.getUint8(0) !== SNAP_MAGIC) throw new Error('codec: not a snapshot');
    if (v.getUint8(1) !== CODEC_VERSION) throw new Error(`codec: snapshot version ${v.getUint8(1)} ≠ ${CODEC_VERSION}`);
    const full = (v.getUint8(2) & FLAG_FULL) !== 0;
    const tick = v.getUint32(3);
    const time = v.getFloat64(7);
    const nActors = v.getUint16(15), nProj = v.getUint16(17);
    let o = HEADER_BYTES;
    const actors: ActorState[] = [];
    const next = new Map<number, ActorState>();
    for (let k = 0; k < nActors; k++) {
      const id = v.getUint32(o);
      const hasRec = v.getUint8(o + 4) === 1;
      o += 5;
      let a: ActorState;
      if (hasRec) { a = readActor(v, o, id); o += ACTOR_BYTES; } else {
        const old = full ? undefined : this.prev.get(id);
        if (!old) throw new Error(`codec: delta references unknown actor ${id}`);
        a = { ...old };
      }
      actors.push(a);
      next.set(id, a);
    }
    this.prev = next;
    const projectiles: ProjectileState[] = [];
    for (let k = 0; k < nProj; k++) {
      projectiles.push({
        id: v.getUint32(o),
        x: v.getInt32(o + 4) / 1000, y: v.getInt32(o + 8) / 1000, z: v.getInt32(o + 12) / 1000,
        dx: v.getInt16(o + 16) / 32767, dy: v.getInt16(o + 18) / 32767, dz: v.getInt16(o + 20) / 32767,
        visual: at(PROJECTILE_VISUALS, v.getUint8(o + 22)),
      });
      o += PROJ_BYTES;
    }
    const len = v.getUint32(o);
    const tail = JSON.parse(new TextDecoder().decode(data.subarray(o + 4, o + 4 + len))) as Pick<Snapshot, 'events' | 'players' | 'markers' | 'mode' | 'you'>;
    return { tick, time, actors, projectiles, events: tail.events, players: tail.players, markers: tail.markers, mode: tail.mode, you: tail.you };
  }
}
