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
