import { describe, expect, it } from 'vitest';
import { bakeZones, clampToRim, formatTime, headingAngle, mapRotation, worldToMap, zoomAt } from '../../src/ui/minimapMath';

/** Direction an up-pointing icon shows after a canvas rotation `t` (screen, y down). */
const iconDir = (t: number) => ({ x: Math.sin(t), y: -Math.cos(t) });
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('minimap maths', () => {
  it('north-up: north (-Z) is up and east (+X) is right', () => {
    const r = mapRotation(1.3, true);
    close(worldToMap(0, -10, r, 2), { x: 0, y: -20 });
    close(worldToMap(10, 0, r, 2), { x: 20, y: 0 });
  });

  it('rotating: the camera forward always points up, its right points right', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, -2.4, Math.PI]) {
      const r = mapRotation(yaw, false);
      close(worldToMap(Math.sin(yaw), Math.cos(yaw), r, 1), { x: 0, y: -1 });
      // Camera right for yaw (Y up, forward (sin, cos)) is (-cos, sin).
      close(worldToMap(-Math.cos(yaw), Math.sin(yaw), r, 1), { x: 1, y: 0 });
    }
  });

  it('heading arrows match the actor facing direction in both modes', () => {
    for (const northUp of [true, false]) {
      for (const camYaw of [0, 1.1, -2]) {
        const r = mapRotation(camYaw, northUp);
        for (const yaw of [0, 0.5, 2, -1.7]) close(iconDir(headingAngle(yaw, r)), worldToMap(Math.sin(yaw), Math.cos(yaw), r, 1));
      }
    }
    // Facing the camera direction → arrow up.
    close(iconDir(headingAngle(0.9, mapRotation(0.9, false))), { x: 0, y: -1 });
  });

  it('clamps outside markers to the rim and keeps inside ones', () => {
    expect(clampToRim(3, 4, 10)).toEqual({ x: 3, y: 4, clamped: false });
    const p = clampToRim(30, 40, 10);
    expect(p.clamped).toBe(true);
    close(p, { x: 6, y: 8 });
  });

  it('zooms around the cursor (the world point under it stays put)', () => {
    const c = { x: 10, z: -20 }, w = 800, h = 600, sx = 600, sy = 100;
    const before = { x: c.x + (sx - w / 2) / 2, z: c.z + (sy - h / 2) / 2 };
    const n = zoomAt(c, 2, 5, sx, sy, w, h);
    expect(n.x + (sx - w / 2) / 5).toBeCloseTo(before.x, 6);
    expect(n.z + (sy - h / 2) / 5).toBeCloseTo(before.z, 6);
  });

  it('bakes zone codes to RGBA with a fallback colour', () => {
    const px = bakeZones({ w: 3, h: 1, data: new Uint8Array([0, 1, 99]) }, ['#000000', '#ff8001']);
    expect([...px]).toEqual([0, 0, 0, 255, 255, 128, 1, 255, 0, 0, 0, 255]);
  });

  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(119.2)).toBe('2:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(-3)).toBe('0:00');
  });
});
