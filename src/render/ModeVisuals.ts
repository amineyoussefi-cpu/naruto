import * as THREE from 'three';
import type { ActorView } from '../game/ActorView';
import type { ModeState } from '../sim/missions/types';
import type { WorldData } from '../sim/world/types';

/** Render-only tuning for mode visuals (dome, name tags, team colours, downed rings). */
const MV = {
  /** Dome fade rate (1/s), base opacity, hex cells around / up the dome. */
  domeFade: 3, domeOpacity: 0.55, hexU: 64, hexV: 14,
  /** Dome colour (chakra blue) and the vertical extent below the centre so uneven ground never shows a gap (fraction of radius). */
  domeColor: 0x4fb8ff, domeSink: 0.15,
  /** Name tags: max shown, hidden beyond this distance (m), height above the head (m), screen-space size (sizeAttenuation off). */
  maxTags: 6, tagRange: 40, tagLift: 0.45, tagW: 0.16, tagH: 0.04,
  /** Canvas size (px) and font for a tag texture. */
  tagCanvasW: 256, tagCanvasH: 64, tagFont: 'bold 34px sans-serif',
  /** Team colours: tag fill and model rim tint. Co-op allies: white text with a blue outline. */
  red: 0xff4a3d, blue: 0x4fb8ff, ally: 0xffffff, allyStroke: 0x1d5fae,
  /** Downed ring radii (m), height above the feet (m), colours of the empty / filled revive track. */
  ringInner: 0.75, ringOuter: 0.95, ringLift: 0.06, ringBase: 0xff3b1f, ringFill: 0x4fb8ff,
};

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const tmp = new THREE.Vector3();
const camPos = new THREE.Vector3();

const DOME_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vView;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const DOME_FRAG = /* glsl */ `
uniform vec3 color; uniform float opacity; uniform float time; uniform vec2 cells;
varying vec2 vUv; varying vec3 vN; varying vec3 vView;
// Distance to the nearest hex-cell edge (0 at the edge).
float hexEdge(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h; vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b; g = abs(g);
  return 0.5 - max(dot(g, normalize(r)), g.x);
}
void main() {
  float fres = 1.0 - abs(dot(normalize(vN), normalize(vView)));
  float edge = 1.0 - smoothstep(0.02, 0.06, hexEdge(vUv * cells));
  float wave = 0.5 + 0.5 * sin(vUv.y * 18.0 - time * 2.0);
  float a = 0.08 + 0.55 * pow(fres, 2.5) + edge * (0.25 + 0.25 * wave);
  gl_FragColor = vec4(color * (0.8 + 0.6 * edge), a * opacity);
}`;

const RING_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FRAG = /* glsl */ `
uniform vec3 base; uniform vec3 fill; uniform float progress; uniform float time;
varying vec2 vP;
void main() {
  float ang = fract(atan(-vP.x, vP.y) / 6.2831853 + 1.0); // 0 at the top, clockwise
  bool done = ang < progress;
  vec3 c = done ? fill * 1.4 : base * (0.7 + 0.3 * sin(time * 6.0));
  gl_FragColor = vec4(c, done ? 0.95 : 0.6);
}`;

interface Tag { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; tex: THREE.CanvasTexture | null; key: string }

/**
 * Mode visuals (client, render-only): PvP chakra barrier dome, player name tags, PvP team rim colours and
 * downed revive rings. `update` is called every render frame. Owner: visuals.
 */
export class ModeVisuals {
  readonly dome: THREE.Mesh;
  /** Name tags by actor id (only players other than the local one, ≤ MV.maxTags). */
  readonly tags = new Map<number, Tag>();
  /** Downed revive rings by actor id. */
  readonly rings = new Map<number, THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>>();
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly ringGeo = new THREE.RingGeometry(MV.ringInner, MV.ringOuter, 48);
  private domeLevel = 0;
  private time = 0;
  /** Models this instance tinted, so the tint is removed when the match ends or the view goes away. */
  private readonly tinted = new Set<ActorView['model']>();

  constructor(private readonly scene: THREE.Scene) {
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
      uniforms: {
        color: { value: new THREE.Color(MV.domeColor) }, opacity: { value: 0 }, time: { value: 0 },
        cells: { value: new THREE.Vector2(MV.hexU, MV.hexV) },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const geo = new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI * (0.5 + MV.domeSink));
    this.dome = new THREE.Mesh(geo, this.domeMat);
    this.dome.visible = false;
    this.dome.renderOrder = 5;
    this.ringGeo.rotateX(-Math.PI / 2);
    scene.add(this.dome);
  }

  update(frameDt: number, s: { mode: ModeState | null; world: WorldData | null; views: readonly ActorView[]; myActorId: number; camera: THREE.Camera }): void {
    this.time += frameDt;
    const pvp = s.mode?.pvp;
    const inMatch = pvp?.phase === 'running';
    this.updateDome(frameDt, inMatch && s.world ? s.world.arenas.find((a) => a.id === pvp.arenaId) ?? null : null);

    // Team rim colours: on while a player's team is red/blue, removed otherwise.
    const live = new Set<ActorView['model']>();
    for (const v of s.views) {
      if (v.kind !== 'player' || v.removed) continue;
      const c = v.team === 'red' ? MV.red : v.team === 'blue' ? MV.blue : null;
      v.model.setTeamTint(c);
      if (c !== null) { this.tinted.add(v.model); live.add(v.model); }
    }
    for (const m of this.tinted) if (!live.has(m)) { m.setTeamTint(null); this.tinted.delete(m); }

    this.updateTags(s.views, s.myActorId, s.camera);
    this.updateRings(s.mode, s.views);
  }

  private updateDome(dt: number, arena: WorldData['arenas'][number] | null): void {
    if (arena) {
      this.dome.position.set(arena.center.x, arena.center.y, arena.center.z);
      this.dome.scale.setScalar(arena.radius);
    }
    this.domeLevel += ((arena ? 1 : 0) - this.domeLevel) * (1 - Math.exp(-MV.domeFade * dt));
    if (!arena && this.domeLevel < 0.01) this.domeLevel = 0;
    this.dome.visible = this.domeLevel > 0;
    this.domeMat.uniforms.opacity.value = this.domeLevel * MV.domeOpacity;
    this.domeMat.uniforms.time.value = this.time;
  }

  private updateTags(views: readonly ActorView[], myActorId: number, camera: THREE.Camera): void {
    camera.getWorldPosition(camPos);
    const shown = views
      .filter((v) => v.kind === 'player' && !v.removed && v.id !== myActorId && v.position.distanceTo(camPos) <= MV.tagRange)
      .sort((a, b) => a.position.distanceToSquared(camPos) - b.position.distanceToSquared(camPos))
      .slice(0, MV.maxTags);
    const ids = new Set(shown.map((v) => v.id));
    for (const [id, tag] of this.tags) if (!ids.has(id)) { this.freeTag(tag); this.tags.delete(id); }
    for (const v of shown) {
      const key = `${v.team}|${v.name}`;
      let tag = this.tags.get(v.id);
      if (!tag) {
        const mat = new THREE.SpriteMaterial({ sizeAttenuation: false, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(MV.tagW, MV.tagH, 1);
        sprite.renderOrder = 6;
        this.scene.add(sprite);
        tag = { sprite, mat, tex: null, key: '' };
        this.tags.set(v.id, tag);
      }
      if (tag.key !== key) {
        tag.key = key;
        tag.tex?.dispose();
        tag.tex = tagTexture(v.name, v.team);
        tag.mat.map = tag.tex;
        tag.mat.needsUpdate = true;
      }
      tag.sprite.position.copy(tmp.copy(v.position).setY(v.position.y + v.height + MV.tagLift));
    }
  }

  private updateRings(mode: ModeState | null, views: readonly ActorView[]): void {
    const list = mode?.downed ?? [];
    const ids = new Set<number>();
    for (const d of list) {
      const v = views.find((x) => x.id === d.actorId && !x.removed);
      if (!v) continue;
      ids.add(d.actorId);
      let ring = this.rings.get(d.actorId);
      if (!ring) {
        const mat = new THREE.ShaderMaterial({
          vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          uniforms: { base: { value: new THREE.Color(MV.ringBase) }, fill: { value: new THREE.Color(MV.ringFill) }, progress: { value: 0 }, time: { value: 0 } },
        });
        ring = new THREE.Mesh(this.ringGeo, mat);
        ring.renderOrder = 4;
        this.scene.add(ring);
        this.rings.set(d.actorId, ring);
      }
      ring.position.copy(v.position).setY(v.position.y + MV.ringLift);
      ring.material.uniforms.progress.value = d.revive;
      ring.material.uniforms.time.value = this.time;
    }
    for (const [id, ring] of this.rings) if (!ids.has(id)) { ring.removeFromParent(); ring.material.dispose(); this.rings.delete(id); }
  }

  private freeTag(tag: Tag): void {
    tag.sprite.removeFromParent();
    tag.tex?.dispose();
    tag.mat.dispose();
  }

  dispose(): void {
    for (const m of this.tinted) m.setTeamTint(null);
    this.tinted.clear();
    for (const tag of this.tags.values()) this.freeTag(tag);
    this.tags.clear();
    for (const ring of this.rings.values()) { ring.removeFromParent(); ring.material.dispose(); }
    this.rings.clear();
    this.ringGeo.dispose();
    this.dome.removeFromParent();
    this.dome.geometry.dispose();
    this.domeMat.dispose();
  }
}

/** Canvas texture with the player's name in the team colour; null without a DOM (Node tests). */
function tagTexture(name: string, team: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = MV.tagCanvasW; c.height = MV.tagCanvasH;
  const g = c.getContext('2d');
  if (!g) return null;
  const pvp = team === 'red' || team === 'blue';
  g.font = MV.tagFont;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 7;
  g.strokeStyle = pvp ? 'rgba(10,14,24,0.9)' : css(MV.allyStroke);
  g.fillStyle = css(team === 'red' ? MV.red : team === 'blue' ? MV.blue : MV.ally);
  const x = c.width / 2, y = c.height / 2;
  g.strokeText(name, x, y, c.width - 12);
  g.fillText(name, x, y, c.width - 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
