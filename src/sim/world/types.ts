/**
 * World data contract: everything the world generator returns. Pure data, Node-safe, deterministic per seed.
 * The server builds only colliders from it; the client builds meshes AND the same colliders from it.
 * Owner: integration (contract); the world agent fills `generateWorld` in `src/sim/world/generate.ts`.
 */
import type { Vec3Like } from '../../core/types';

/** Zone codes of the minimap raster (one byte per pixel). */
export const ZONE = {
  void: 0, grass: 1, forest: 2, water: 3, beach: 4, cliff: 5, street: 6, building: 7, plaza: 8, wall: 9, bridge: 10, dock: 11, field: 12,
} as const;
export type ZoneCode = (typeof ZONE)[keyof typeof ZONE];

export interface ColliderFlags { climbable?: boolean; water?: boolean }

/** Static collider description. Positions in world metres, Y up. */
export type ColliderDef =
  | ({ type: 'box'; center: Vec3Like; half: Vec3Like; yaw: number } & ColliderFlags)
  | ({ type: 'cylinder'; center: Vec3Like; halfHeight: number; radius: number } & ColliderFlags)
  | ({ type: 'capsule'; center: Vec3Like; halfHeight: number; radius: number } & ColliderFlags)
  /** Non-indexed or indexed triangle soup (rocks, sculpted cliffs). */
  | ({ type: 'trimesh'; vertices: Float32Array; indices: Uint32Array } & ColliderFlags);

/** Regular height grid covering the world: heights[iz * nx + ix] at (originX + ix * cell, originZ + iz * cell). */
export interface Heightfield {
  nx: number; nz: number; cell: number; originX: number; originZ: number;
  heights: Float32Array;
}

/** A start square on the ground (co-op: whole square; PvP: split in a red half and a blue half along its local X). */
export interface SquareDef {
  id: string;
  kind: 'coop' | 'pvp';
  /** Centre on the ground. */
  center: Vec3Like;
  /** Side length (m), 10. */
  size: number;
  /** Rotation around Y; for PvP the red half is local -X, the blue half local +X. */
  yaw: number;
  /** Mission board / arena board position (for the visuals). */
  board: Vec3Like;
  /** Where players return to after a mission / match that started here. */
  returnPoint: Vec3Like;
}

/** A PvP battleground closed by a chakra dome during a match. */
export interface PvpArenaDef {
  id: 'training' | 'clearing' | 'lake' | 'rooftops';
  /** French display name. */
  name: string;
  center: Vec3Like;
  /** Dome radius (m). */
  radius: number;
  spawns: { red: Vec3Like[]; blue: Vec3Like[] };
}

export interface WorldData {
  seed: number;
  /** Playable square side (m), centred on the origin. */
  size: number;
  /** Invisible boundary half-extent (m); the sea beyond is visual only. */
  boundary: number;
  killPlaneY: number;
  heightfield: Heightfield;
  /** Minimap raster, north-up (row 0 = most negative Z... see `zoneAt`), `res` metres per pixel. */
  zones: { res: number; w: number; h: number; originX: number; originZ: number; data: Uint8Array };
  colliders: ColliderDef[];
  /** New players appear here (village). */
  spawns: Vec3Like[];
  squares: SquareDef[];
  arenas: PvpArenaDef[];
  /** Named mission points (feet positions), e.g. 'village.market', 'forest.clearing', 'shore.docks', 'island.north', 'gate.main'. */
  points: Record<string, Vec3Like>;
  /** Labelled places for the full-screen map (French). */
  labels: { text: string; x: number; z: number }[];
}
