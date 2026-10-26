/**
 * Minimap (round, player-centred, rotating or north-up) and full-screen map, drawn on 2D canvases.
 * The zone background is baked once per world. Owner: UI agent.
 */
import type { WorldData } from '../sim/world/types';
import type { Marker } from '../sim/missions/types';
import { MINIMAP as M } from '../config/minimap';
import { bakeZones, clampToRim, headingAngle, worldToMap, zoomAt } from './minimapMath';

export interface MapFrame {
  world: WorldData;
  markers: readonly Marker[];
  me: { x: number; z: number; yaw: number; team: string } | null;
  /** Map rotation (see mapRotation); the full map is always north-up. */
  rot: number;
  /** Render clock (s) for pulses. */
  time: number;
}

type Ctx = CanvasRenderingContext2D;

export class MapView {
  private bg: HTMLCanvasElement | null = null;
  private bgWorld: WorldData | null = null;
  private readonly mini: Ctx;
  private readonly full: Ctx;
  /** Full map view: centre (world) and zoom relative to "whole world fits". */
  private centre = { x: 0, z: 0 };
  private zoom = 1;
  private lastFrame: MapFrame | null = null;
  private readonly colorById = new Map<number, string>();

  constructor(private readonly miniCanvas: HTMLCanvasElement, private readonly fullCanvas: HTMLCanvasElement) {
    this.mini = miniCanvas.getContext('2d')!;
    this.full = fullCanvas.getContext('2d')!;
    fullCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = this.lastFrame;
      if (!f) return;
      const base = this.baseScale(f.world);
      const z = Math.min(M.zoomMax, Math.max(M.zoomMin, this.zoom * (e.deltaY < 0 ? M.zoomStep : 1 / M.zoomStep)));
      const r = fullCanvas.getBoundingClientRect();
      this.centre = zoomAt(this.centre, base * this.zoom, base * z, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      this.zoom = z;
      this.drawFull(f);
    }, { passive: false });
  }

  /** Called when the full map opens: whole world, north-up. */
  resetFull(): void {
    this.centre = { x: 0, z: 0 };
    this.zoom = 1;
  }

  drawMini(f: MapFrame): void {
    this.lastFrame = f;
    const c = this.mini, cv = this.miniCanvas;
    const dpr = window.devicePixelRatio || 1;
    const size = M.sizePx;
    if (cv.width !== size * dpr) { cv.width = cv.height = size * dpr; }
    const r = size / 2, s = size / M.metresAcross;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);
    c.save();
    c.beginPath(); c.arc(r, r, r, 0, Math.PI * 2); c.clip();
    c.fillStyle = M.zoneColors[0]; c.fillRect(0, 0, size, size);
    const me = f.me ?? { x: 0, z: 0, yaw: 0, team: '' };
    c.translate(r, r); c.rotate(f.rot); c.scale(s, s); c.translate(-me.x, -me.z);
    this.drawWorld(c, f);
    c.restore();
    c.save();
    c.translate(r, r);
    this.drawMarkers(c, f, me, s, r - M.rimInset);
    c.restore();
    // North tick on the rim.
    const n = worldToMap(0, -1, f.rot, 1);
    const nr = clampToRim(n.x * 1e3, n.y * 1e3, r - 9);
    c.font = '800 12px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 3; c.strokeStyle = '#000'; c.fillStyle = '#fff';
    c.strokeText('N', r + nr.x, r + nr.y); c.fillText('N', r + nr.x, r + nr.y);
  }

  drawFull(f: MapFrame): void {
    this.lastFrame = f;
    const c = this.full, cv = this.fullCanvas;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const s = this.baseScale(f.world) * this.zoom;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = M.zoneColors[0]; c.fillRect(0, 0, w, h);
    c.save();
    c.translate(w / 2, h / 2); c.scale(s, s); c.translate(-this.centre.x, -this.centre.z);
    this.drawWorld(c, { ...f, rot: 0 });
    c.restore();
    c.save();
    c.font = '800 13px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.85)'; c.fillStyle = '#f4e8cc';
    for (const l of f.world.labels) {
      const x = w / 2 + (l.x - this.centre.x) * s, y = h / 2 + (l.z - this.centre.z) * s;
      c.strokeText(l.text, x, y); c.fillText(l.text, x, y);
    }
    c.restore();
    const me = f.me ?? { x: 0, z: 0, yaw: 0, team: '' };
    c.save();
    c.translate(w / 2 + (me.x - this.centre.x) * s, h / 2 + (me.z - this.centre.z) * s);
    this.drawMarkers(c, { ...f, rot: 0 }, me, s, Infinity);
    c.restore();
  }

  /** Pixels per metre where the whole playable world fits the full map. */
  private baseScale(world: WorldData): number {
    return Math.min(this.fullCanvas.clientWidth || 1, this.fullCanvas.clientHeight || 1) / world.size;
  }

  /** In world space (metres, current transform): zone background and start squares. */
  private drawWorld(c: Ctx, f: MapFrame): void {
    const z = f.world.zones;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.background(f.world), z.originX, z.originZ, z.w * z.res, z.h * z.res);
    for (const m of f.markers) {
      if (m.kind !== 'square') continue;
      const h = m.size / 2;
      c.save();
      c.translate(m.x, m.z); c.rotate(-m.yaw); // local +X (red → blue axis) = (cos yaw, -sin yaw)
      c.globalAlpha = 0.85;
      if (m.mode === 'coop') { c.fillStyle = M.coopSquareColor; c.fillRect(-h, -h, m.size, m.size); }
      else {
        c.fillStyle = M.pvpRedColor; c.fillRect(-h, -h, h, m.size);
        c.fillStyle = M.pvpBlueColor; c.fillRect(0, -h, h, m.size);
      }
      c.restore();
    }
  }

  /** In screen space around the local player (origin = player): icons with a fixed pixel size. */
  private drawMarkers(c: Ctx, f: MapFrame, me: { x: number; z: number; yaw: number; team: string }, s: number, rim: number): void {
    const at = (x: number, z: number, pin: boolean) => {
      const p = worldToMap(x - me.x, z - me.z, f.rot, s);
      const q = clampToRim(p.x, p.y, rim);
      return pin || !q.clamped ? q : null;
    };
    c.font = '700 11px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const m of f.markers) {
      if (m.kind === 'group') {
        const p = at(m.x, m.z, true)!;
        const pulse = m.fighting ? 1 + 0.25 * Math.sin((f.time / M.pulsePeriod) * Math.PI * 2) : 1;
        skull(c, p.x, p.y, 8 * pulse);
        label(c, String(m.count), p.x + 10, p.y - 8, '#fff');
      } else if (m.kind === 'objective') {
        const p = at(m.x, m.z, true)!;
        c.strokeStyle = M.objectiveColor; c.lineWidth = 2.5;
        c.beginPath(); c.arc(p.x, p.y, 11, 0, Math.PI * 2); c.stroke();
      } else if (m.kind === 'downed') {
        const p = at(m.x, m.z, true)!;
        cross(c, p.x, p.y);
      } else if (m.kind === 'player') {
        const p = at(m.x, m.z, false);
        if (!p) continue;
        const ally = m.team === me.team;
        if (!this.colorById.has(m.id)) this.colorById.set(m.id, M.teamColors[this.colorById.size % M.teamColors.length]);
        const col = ally ? this.colorById.get(m.id)! : M.enemyColor;
        arrow(c, p.x, p.y, headingAngle(m.yaw, f.rot), col, 6);
        label(c, m.name, p.x, p.y + 12, col);
      }
    }
    if (f.me) arrow(c, 0, 0, headingAngle(me.yaw, f.rot), M.selfColor, 8);
  }

  private background(world: WorldData): HTMLCanvasElement {
    if (this.bg && this.bgWorld === world) return this.bg;
    const z = world.zones;
    const cv = this.bg ?? document.createElement('canvas');
    cv.width = z.w; cv.height = z.h;
    cv.getContext('2d')!.putImageData(new ImageData(bakeZones(z, M.zoneColors), z.w, z.h), 0, 0);
    this.bg = cv;
    this.bgWorld = world;
    return cv;
  }
}

function arrow(c: Ctx, x: number, y: number, angle: number, color: string, size: number): void {
  c.save();
  c.translate(x, y); c.rotate(angle);
  c.beginPath(); c.moveTo(0, -size * 1.3); c.lineTo(size, size); c.lineTo(0, size * 0.45); c.lineTo(-size, size); c.closePath();
  c.fillStyle = color; c.fill();
  c.lineWidth = 1.5; c.strokeStyle = '#000'; c.stroke();
  c.restore();
}

function skull(c: Ctx, x: number, y: number, r: number): void {
  c.fillStyle = M.enemyColor; c.strokeStyle = '#000'; c.lineWidth = 1.5;
  c.beginPath(); c.arc(x, y - r * 0.15, r, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillRect(x - r * 0.5, y + r * 0.6, r, r * 0.5);
  c.fillStyle = '#000';
  c.beginPath(); c.arc(x - r * 0.38, y - r * 0.2, r * 0.25, 0, Math.PI * 2); c.arc(x + r * 0.38, y - r * 0.2, r * 0.25, 0, Math.PI * 2); c.fill();
}

function cross(c: Ctx, x: number, y: number): void {
  c.fillStyle = '#fff'; c.strokeStyle = M.enemyColor; c.lineWidth = 2;
  for (const [w, h] of [[4, 14], [14, 4]]) { c.fillRect(x - w / 2, y - h / 2, w, h); c.strokeRect(x - w / 2, y - h / 2, w, h); }
}

function label(c: Ctx, text: string, x: number, y: number, color: string): void {
  c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.85)'; c.fillStyle = color;
  c.strokeText(text, x, y); c.fillText(text, x, y);
}
