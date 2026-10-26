/**
 * Pure minimap maths (no DOM, unit-tested). Owner: UI agent.
 * Screen space: x right, y down. North-up: north = -Z is up, east = +X is right, so world (dx, dz) maps to screen (dx, dz).
 * Every view applies `rot` (a canvas rotation, clockwise on screen) to that north-up picture.
 */

/** Canvas rotation of the map: north-up → 0; rotating → the camera's forward points up. */
export function mapRotation(cameraYaw: number, northUp: boolean): number {
  return northUp ? 0 : cameraYaw - Math.PI;
}

/** Screen offset (px) from the map centre of a world offset (m) from the centre point. */
export function worldToMap(dx: number, dz: number, rot: number, pxPerMetre: number): { x: number; y: number } {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: (dx * c - dz * s) * pxPerMetre, y: (dx * s + dz * c) * pxPerMetre };
}

/** Canvas rotation for an icon drawn pointing up so it shows an actor facing `yaw` (yaw 0 = +Z). */
export function headingAngle(yaw: number, rot: number): number {
  return Math.PI - yaw + rot;
}

/** Pins a point outside the disc of radius `r` (px, centred) onto its rim. */
export function clampToRim(x: number, y: number, r: number): { x: number; y: number; clamped: boolean } {
  const d = Math.hypot(x, y);
  if (d <= r) return { x, y, clamped: false };
  return { x: (x / d) * r, y: (y / d) * r, clamped: true };
}

/** Full map zoom around a screen point: returns the new centre (world) keeping the world point under (sx, sy) fixed. */
export function zoomAt(
  centre: { x: number; z: number }, scale: number, newScale: number, sx: number, sy: number, w: number, h: number,
): { x: number; z: number } {
  const wx = centre.x + (sx - w / 2) / scale, wz = centre.z + (sy - h / 2) / scale;
  return { x: wx - (sx - w / 2) / newScale, z: wz - (sy - h / 2) / newScale };
}

/** RGBA pixels of the zone raster (row 0 = north = top), `colors[code]` as '#rrggbb'. */
export function bakeZones(zones: { w: number; h: number; data: Uint8Array }, colors: readonly string[]): Uint8ClampedArray {
  const rgb = colors.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
  const out = new Uint8ClampedArray(zones.w * zones.h * 4);
  for (let i = 0; i < zones.data.length; i++) {
    const c = rgb[zones.data[i]] ?? rgb[0];
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
  }
  return out;
}

/** "m:ss" for a duration in seconds (rounded up, never negative). */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
