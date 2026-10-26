import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Non-indexed copy with a white vertex colour attribute when missing (merge inputs). */
export function prep(g: THREE.BufferGeometry, shade = 1): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.deleteAttribute('uv');
  if (!n.getAttribute('normal')) n.computeVertexNormals();
  if (!n.getAttribute('color')) n.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n.getAttribute('position').count * 3).fill(shade), 3));
  return n;
}

const tmpM = new THREE.Matrix4(), tmpN = new THREE.Matrix3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
const col = new THREE.Color();

/**
 * Bakes many (geometry, transform, colour) parts into one vertex-coloured geometry: one draw call per chunk.
 * Parts are placed in a parent frame (`frame`), like the v3 Batcher.
 */
export class MergeBuilder {
  private pos: number[] = []; private nor: number[] = []; private clr: number[] = [];
  private readonly parent = new THREE.Matrix4();
  frame(x: number, y: number, z: number, yaw = 0): this {
    this.parent.compose(pv.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), sv.set(1, 1, 1));
    return this;
  }
  /** Part in frame space: position, scale, yaw, roll (Z), pitch (X). Geometry must come from `prep`. */
  put(g: THREE.BufferGeometry, color: number | THREE.Color, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, roll = 0, pitch = 0): this {
    tmpM.compose(pv.set(x, y, z), q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ')), sv.set(sx, sy, sz)).premultiply(this.parent);
    return this.putMatrix(g, color, tmpM);
  }
  putMatrix(g: THREE.BufferGeometry, color: number | THREE.Color, m: THREE.Matrix4): this {
    col.set(color);
    tmpN.getNormalMatrix(m);
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color');
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(tmpN).normalize(); this.nor.push(v.x, v.y, v.z);
      this.clr.push(col.r * c.getX(i), col.g * c.getY(i), col.b * c.getZ(i));
    }
    return this;
  }
  get empty(): boolean { return this.pos.length === 0; }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.clr, 3));
    g.computeBoundingSphere();
    this.pos = []; this.nor = []; this.clr = [];
    return g;
  }
}

/** Unit kit (base at y = 0) for buildings, walls, props; all prepped for merging. */
export function worldKit() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.04);
  shape.quadraticCurveTo(-0.14, 0.06, 0, 0.5);
  shape.quadraticCurveTo(0.14, 0.06, 0.5, -0.04);
  shape.lineTo(-0.5, -0.04);
  const gable = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 4 }).translate(0, 0.04, -0.5).scale(1, 2, 1);
  return {
    box: prep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
    cyl: prep(new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0)),
    cyl6: prep(new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0)),
    taper: prep(new THREE.CylinderGeometry(0.55, 1, 1, 10).translate(0, 0.5, 0)),
    cone: prep(new THREE.ConeGeometry(1, 1, 14).translate(0, 0.5, 0)),
    hip: prep(new THREE.ConeGeometry(0.71, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0)),
    gable: prep(gable),
    ball: prep(new THREE.IcosahedronGeometry(1, 1)),
    ball0: prep(new THREE.IcosahedronGeometry(1, 0)),
  };
}
export type WorldKit = ReturnType<typeof worldKit>;

const ico = (r: number, x: number, y: number, z: number, shade: number, detail = 1, sx = 1, sy = 1, sz = 1) =>
  prep(new THREE.IcosahedronGeometry(r, detail).scale(sx, sy, sz).translate(x, y, z), shade);
const cone = (r: number, h: number, y: number, shade: number, seg: number) => prep(new THREE.ConeGeometry(r, h, seg).translate(0, y + h / 2, 0), shade);
const merged = (parts: THREE.BufferGeometry[]) => { const g = mergeGeometries(parts); parts.forEach((p) => p.dispose()); return g; };

/** Normal tree species: [trunk, crown] per LOD (0 near, 1 mid). Base at y = 0, height ≈ 10–12 m at scale 1. */
export function treeSpecies() {
  const trunk = (h: number, seg: number) => prep(new THREE.CylinderGeometry(0.28, 0.45, h, seg).translate(0, h / 2, 0));
  return [
    { // broad leaf
      lod0: [trunk(5, 6), merged([ico(2.6, 0, 6.2, 0, 0.82), ico(2.0, 1.8, 5.6, 0.8, 0.9), ico(1.9, -1.7, 5.9, -0.6, 0.88), ico(1.9, -0.5, 7.9, 0.3, 1.08), ico(1.5, 1.0, 7.5, -1.0, 1.12)])],
      lod1: [trunk(5, 4), merged([ico(3.0, 0, 6.3, 0, 0.86, 0, 1.15, 1, 1.15), ico(2.0, 0.2, 8.0, 0, 1.08, 0)])],
    },
    { // pine
      lod0: [trunk(4, 6), merged([cone(3.2, 5, 2.4, 0.82, 8), cone(2.5, 4.4, 5.2, 0.95, 8), cone(1.7, 3.8, 8.0, 1.1, 8)])],
      lod1: [trunk(4, 4), merged([cone(3.2, 7, 2.4, 0.85, 5), cone(2.0, 4.5, 7.2, 1.05, 5)])],
    },
    { // poplar / tall
      lod0: [trunk(4.5, 6), merged([ico(1.9, 0, 6.2, 0, 0.84, 1, 1, 1.8, 1), ico(1.5, 0.5, 8.8, 0.2, 1.08, 1, 1, 1.6, 1), ico(1.3, -0.6, 7.4, -0.4, 0.95, 1, 1, 1.5, 1)])],
      lod1: [trunk(4.5, 4), merged([ico(2.0, 0, 7.2, 0, 0.92, 0, 1, 2.3, 1)])],
    },
  ];
}

export function bushGeometry(): THREE.BufferGeometry {
  return merged([ico(1, 0, 0.55, 0, 0.88), ico(0.75, 0.75, 0.5, 0.3, 1.0), ico(0.65, -0.6, 0.5, -0.35, 1.08), ico(0.6, 0.1, 1.05, -0.1, 1.12)]);
}

/** Crossed-quad tree card (base at y = 0, 1 × 1) and its canvas silhouette texture. */
export function treeCard(): { geo: THREE.BufferGeometry; tex: THREE.CanvasTexture } {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), b = a.clone().rotateY(Math.PI / 2);
  const geo = mergeGeometries([a, b]); a.dispose(); b.dispose();
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#8a7a6a'; x.fillRect(29, 70, 6, 58);
  for (const [cx, cy, r, s] of [[32, 60, 24, 205], [20, 50, 16, 225], [44, 48, 16, 225], [32, 30, 18, 245], [32, 14, 11, 255]] as const) {
    x.fillStyle = `rgb(${s},${s},${s})`; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { geo, tex };
}

/** Soft vertical light-shaft texture (alpha gradient). */
export function shaftTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 32; c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 128);
  const h = x.createLinearGradient(0, 0, 32, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = h; x.fillRect(0, 0, 32, 128);
  return new THREE.CanvasTexture(c);
}
