import * as THREE from 'three';

/**
 * Spiral wind streaks in the XZ plane (radius ≈ 1): `arms` tapered strips whose vertex colour fades to black
 * towards the tail, so an additive material fades them out.
 */
export function swirlGeometry(arms = 3, segments = 24, turn = Math.PI * 1.3): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let k = 0; k < arms; k++) {
    const base = pos.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const a = (k / arms) * Math.PI * 2 + t * turn;
      const r = 0.25 + t * 0.75, w = 0.14 * (1 - t) + 0.02;
      const c = Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.1)); // soft head, bright middle, fading tail
      for (const s of [-0.5, 0.5]) {
        pos.push(Math.cos(a) * (r + s * w), 0, Math.sin(a) * (r + s * w));
        col.push(c, c, c);
      }
      if (i > 0) {
        const j = base + i * 2;
        idx.push(j - 2, j - 1, j, j - 1, j + 1, j);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Motion trail behind an object pointing along +Z: two crossed tapered triangles from the head (z = 0, full width)
 * to the tail (z = -length), vertex colour 1 → 0 for use with an additive material.
 */
export function trailGeometry(length: number, width: number): THREE.BufferGeometry {
  const h = width / 2;
  const pos = [-h, 0, 0, h, 0, 0, 0, 0, -length, 0, -h, 0, 0, h, 0, 0, 0, -length];
  const col = [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Additive fresnel shell (bright edges, see-through middle) for shockwave spheres. Colour may exceed 1 to bloom. */
export function shockwaveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, opacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float opacity;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = (pow(f, 3.0) + 0.02) * opacity;
        gl_FragColor = vec4(color * a, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * Jagged lightning: `bolts` zig-zag strokes of length ≈ 1 from the origin, each drawn as two crossed tapered ribbons
 * (reads from any angle). `spread` 0 = all along +Y, 1 = any direction. Seeded, so variants are stable.
 */
export function boltGeometry(seed: number, bolts = 4, segs = 6, spread = 1, width = 0.05): THREE.BufferGeometry {
  let s = seed * 7919 + 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const pos: number[] = [];
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const strokes: { o: THREE.Vector3; dir: THREE.Vector3; len: number; w: number }[] = [];
  for (let k = 0; k < bolts; k++) {
    d.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    const dir = up.clone().lerp(d, spread).normalize();
    strokes.push({ o: new THREE.Vector3(), dir, len: 0.6 + 0.4 * rnd(), w: width });
  }
  for (let n = 0; n < strokes.length; n++) {
    const { o, dir, len, w } = strokes[n];
    a.set(1, 0, 0); if (Math.abs(dir.x) > 0.9) a.set(0, 0, 1);
    const p1 = a.clone().cross(dir).normalize(), p2 = dir.clone().cross(p1).normalize();
    let prev = o.clone();
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const j = i === segs ? 0 : 0.18 * len;
      const next = o.clone().addScaledVector(dir, t * len).addScaledVector(p1, (rnd() - 0.5) * j).addScaledVector(p2, (rnd() - 0.5) * j);
      const w0 = w * (1 - (t - 1 / segs) * 0.8), w1 = w * (1 - t * 0.8);
      for (const p of [p1, p2]) {
        a.copy(prev).addScaledVector(p, w0 / 2); b.copy(prev).addScaledVector(p, -w0 / 2);
        const c = next.clone().addScaledVector(p, w1 / 2), e = next.clone().addScaledVector(p, -w1 / 2);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, e.x, e.y, e.z, c.x, c.y, c.z);
      }
      // One side branch per main stroke, forking from the middle.
      if (n < bolts && i === Math.floor(segs / 2)) {
        d.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
        strokes.push({ o: next.clone(), dir: dir.clone().lerp(d, 0.6).normalize(), len: len * 0.45, w: w * 0.6 });
      }
      prev = next;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Three comma marks (round head + curling tapered tail) around a circle of radius ≈ 1 in the XZ plane. Original shape. */
export function commaRingGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const head = 0.22, segs = 12;
  for (let k = 0; k < 3; k++) {
    const a0 = (k / 3) * Math.PI * 2;
    const cx = Math.cos(a0), cz = Math.sin(a0);
    for (let i = 0; i < segs; i++) { // head disc
      const t0 = (i / segs) * Math.PI * 2, t1 = ((i + 1) / segs) * Math.PI * 2;
      pos.push(cx, 0, cz, cx + Math.cos(t1) * head, 0, cz + Math.sin(t1) * head, cx + Math.cos(t0) * head, 0, cz + Math.sin(t0) * head);
    }
    // Tail: follows the circle backwards from the head, tapering to a point.
    for (let i = 0; i < segs; i++) {
      const u0 = i / segs, u1 = (i + 1) / segs;
      const r0 = 1, w0 = head * (1 - u0), w1 = head * (1 - u1);
      const b0 = a0 - u0 * 1.1, b1 = a0 - u1 * 1.1;
      const o0 = [Math.cos(b0) * (r0 + w0), Math.sin(b0) * (r0 + w0)], i0 = [Math.cos(b0) * (r0 - w0 * 0.2), Math.sin(b0) * (r0 - w0 * 0.2)];
      const o1 = [Math.cos(b1) * (1 + w1), Math.sin(b1) * (1 + w1)], i1 = [Math.cos(b1) * (1 - w1 * 0.2), Math.sin(b1) * (1 - w1 * 0.2)];
      pos.push(o0[0], 0, o0[1], i0[0], 0, i0[1], o1[0], 0, o1[1], i0[0], 0, i0[1], i1[0], 0, i1[1], o1[0], 0, o1[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
