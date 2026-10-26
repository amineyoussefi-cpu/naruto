import { Noise } from './noise';

/** Unit rock (radius ≈ 1, base near y = 0): indexed icosphere (detail 1) pushed by noise, flattened bottom. Shared by collider and mesh. */
export function rockShape(variant: number): { pos: Float32Array; idx: Uint32Array } {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // One subdivision with shared midpoints.
  const mid = new Map<string, number>();
  const m = (a: number, b: number) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    let i = mid.get(k);
    if (i === undefined) { const p = verts[a], q = verts[b]; i = verts.length; verts.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]); mid.set(k, i); }
    return i;
  };
  faces = faces.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  const n = new Noise(variant * 977 + 13);
  verts = verts.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
    const r = 1 + 0.24 * n.n2(x * 1.3 + y * 0.8 + 3, z * 1.3 - y * 0.9) + 0.08 * n.n2(x * 3.1 - z, y * 3.1 + z * 0.5, 2);
    return [x * r, Math.max(y * r * 0.78, -0.35) + 0.3, z * r];
  });
  return { pos: Float32Array.from(verts.flat()), idx: Uint32Array.from(faces.flat()) };
}
