"""
Builds the player character "Ren" (original design: a normal young guy with messy black hair,
navy zip hoodie, dark joggers, white sneakers) and exports it for the game.

Run inside Blender (Scripting > Python console):
    p = '/path/to/naruto/tools/blender/build_hero.py'
    exec(compile(open(p).read(), p, 'exec'), {'__file__': p, '__name__': '__main__'})
or headless:
    blender -b -P tools/blender/build_hero.py

Outputs (relative to the project root):
    public/models/hero.glb      the model the game loads
    art/hero.blend              editable Blender file
    art/hero_front.png, art/hero_34.png, art/hero_side.png   preview renders

How it plugs into the game
--------------------------
The game animates characters procedurally with a joint hierarchy (src/render/NinjaModel.ts).
This model is cut into rigid parts at those same joints; each part's origin IS the joint, so the
game just parents each part to the matching joint group and every existing animation works.

    pelvis       -> body pivot     (0, 0.95, 0)
    torso        -> torso joint    (0, 0.99, 0)
    head         -> neck joint     (0, 1.47, 0)
    upperArm_L/R -> shoulders      (+-0.27, 1.39, 0)
    forearm_L/R  -> elbows         (+-0.27, 1.12, 0)
    thigh_L/R    -> hips           (+-0.10, 0.88, 0)
    shin_L/R     -> knees          (+-0.10, 0.47, 0)

All coordinates below are written in GAME space (metres, Y up, character faces +Z, his left = +X)
and converted to Blender space (Z up, faces -Y) by V().  "_L" = character's left = +X.
"""
import bpy
import bmesh
import math
import os
import random
import traceback
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

try:
    PROJECT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
except NameError:  # pasted into the text editor without __file__
    PROJECT = os.path.expanduser('~/Desktop/naruto')
OUT_GLB = os.path.join(PROJECT, 'public', 'models', 'hero.glb')
ART = os.path.join(PROJECT, 'art')
LOG = os.path.join(ART, 'build_log.txt')

random.seed(7)
TAU = math.pi * 2
rad = math.radians


def V(x, y, z):
    """Game space (Y up, +Z forward) -> Blender space (Z up, -Y forward)."""
    return Vector((x, -z, y))


# ---------------------------------------------------------------------------------------------
# Palette (sRGB hex). Material names are read by the game (unlit set: eye/face materials).
# ---------------------------------------------------------------------------------------------
PALETTE = {
    'skin': 0xf1c7a1,
    'hair': 0x1b1d26,
    'hoodie': 0x2e4466,
    'trim': 0x22324c,
    'zipper': 0xc9ced6,
    'string': 0xeceae4,
    'pants': 0x2f3138,
    'pants_cuff': 0x26272d,
    'sock': 0xdedcd6,
    'shoe': 0xf1f0ec,
    'sole': 0x3b3d44,
    'heel': 0x2e4466,
    'eye_white': 0xfbfbf6,
    'iris': 0x5a3a26,
    'pupil': 0x1a1113,
    'highlight': 0xffffff,
    'ink': 0x1c1a21,
    'mouth': 0x7a443d,
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    h = PALETTE[name]
    rgb = [srgb_to_linear(((h >> s) & 255) / 255) for s in (16, 8, 0)]
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
        bsdf.inputs['Roughness'].default_value = 0.85
    m.diffuse_color = (*rgb, 1.0)
    return m


# ---------------------------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------------------------
COL = None


def make_obj(name, verts, faces, mat, subsurf=1, smooth=True, recalc=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([V(*v) for v in verts], [], faces)
    me.update()
    if recalc:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(material(mat))
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    if subsurf:
        mod = ob.modifiers.new('Subdivision', 'SUBSURF')
        mod.levels = subsurf
        mod.render_levels = subsurf
    return ob


def ring(cx, y, cz, rx, rz, n=16, e=2.0):
    """Horizontal superellipse ring (game space)."""
    pts = []
    for i in range(n):
        a = TAU * i / n
        c, s = math.cos(a), math.sin(a)
        pts.append((cx + rx * math.copysign(abs(c) ** (2 / e), c), y, cz + rz * math.copysign(abs(s) ** (2 / e), s)))
    return pts


def ring_z(z, cx, cy, rx, ry, n=16, e=2.0):
    """Ring in the XY plane at depth z (for shoes)."""
    pts = []
    for i in range(n):
        a = TAU * i / n
        c, s = math.cos(a), math.sin(a)
        pts.append((cx + rx * math.copysign(abs(c) ** (2 / e), c), cy + ry * math.copysign(abs(s) ** (2 / e), s), z))
    return pts


def loft(rings, cap0=True, cap1=True, loop=False):
    """Skin consecutive rings into quads; optional pole caps or a closed loop of rings."""
    n = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    count = len(rings) if loop else len(rings) - 1
    for k in range(count):
        k2 = (k + 1) % len(rings)
        for i in range(n):
            faces.append((k * n + i, k * n + (i + 1) % n, k2 * n + (i + 1) % n, k2 * n + i))
    if not loop:
        for cap, r, off in ((cap0, rings[0], 0), (cap1, rings[-1], (len(rings) - 1) * n)):
            if not cap:
                continue
            c = [sum(p[j] for p in r) / n for j in range(3)]
            verts.append(tuple(c))
            pole = len(verts) - 1
            for i in range(n):
                faces.append((pole, off + i, off + (i + 1) % n))
    return verts, faces


def limb(cx, cz, profile, n=16, sz=1.0, e=2.0, caps=True):
    """Vertical tapered tube along `profile` [(y, r), ...] top->bottom with hemispherical ends."""
    rings = []
    y0, r0 = profile[0]
    y1, r1 = profile[-1]
    if caps:
        for t in (82, 62, 38):
            rings.append(ring(cx, y0 + r0 * math.sin(rad(t)) * 0.9, cz, r0 * math.cos(rad(t)), r0 * math.cos(rad(t)) * sz, n, e))
    for y, r in profile:
        rings.append(ring(cx, y, cz, r, r * sz, n, e))
    if caps:
        for t in (38, 62, 82):
            rings.append(ring(cx, y1 - r1 * math.sin(rad(t)) * 0.9, cz, r1 * math.cos(rad(t)), r1 * math.cos(rad(t)) * sz, n, e))
    return loft(rings)


def ellipsoid(c, r, n=14, m=9):
    rings = []
    for k in range(1, m):
        phi = -math.pi / 2 + math.pi * k / m
        y = c[1] + r[1] * math.sin(phi)
        rings.append(ring(c[0], y, c[2], r[0] * math.cos(phi), r[2] * math.cos(phi), n))
    verts, faces = loft(rings, cap0=False, cap1=False)
    nn = n
    verts.append((c[0], c[1] - r[1], c[2]))
    b = len(verts) - 1
    for i in range(nn):
        faces.append((b, (i + 1) % nn, i))
    verts.append((c[0], c[1] + r[1], c[2]))
    t = len(verts) - 1
    off = (len(rings) - 1) * nn
    for i in range(nn):
        faces.append((t, off + i, off + (i + 1) % nn))
    return verts, faces


def bezier(p0, c, p2, u):
    return p0 * (1 - u) ** 2 + c * (2 * u * (1 - u)) + p2 * (u * u)


def tube_along(points, radii, n=8, flat=1.0, up=None):
    """Tube through 3D game-space points (Vectors) with per-point radius; pole at the end."""
    verts, faces = [], []
    for i, p in enumerate(points):
        t = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        ref = up(p) if up else Vector((0, 0, 1))
        nrm = (ref - t * ref.dot(t)).normalized()
        b = t.cross(nrm).normalized()
        r = radii[i]
        for k in range(n):
            a = TAU * k / n
            q = p + b * (math.cos(a) * r) + nrm * (math.sin(a) * r * flat)
            verts.append((q.x, q.y, q.z))
    rows = len(points)
    for i in range(rows - 1):
        for k in range(n):
            faces.append((i * n + k, i * n + (k + 1) % n, (i + 1) * n + (k + 1) % n, (i + 1) * n + k))
    # start cap
    s = points[0]
    verts.append((s.x, s.y, s.z))
    sp = len(verts) - 1
    for k in range(n):
        faces.append((sp, (k + 1) % n, k))
    return verts, faces


def step(msg):
    """Progress log (flushed each step, so a crash still leaves a trail)."""
    with open(LOG, 'a') as f:
        f.write(msg + '\n')


def evaluated_data(ob):
    """(verts, polys, mat_names, smooth) of the object with modifiers applied, in world space."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ob.matrix_world.copy()
    verts = [mw @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    mats = [m.name if m else 'skin' for m in me.materials] or ['skin']
    pinfo = [(mats[p.material_index] if p.material_index < len(mats) else mats[0], p.use_smooth) for p in me.polygons]
    ev.to_mesh_clear()
    return verts, polys, pinfo


def bvh_of(ob):
    verts, polys, _ = evaluated_data(ob)
    return BVHTree.FromPolygons(verts, polys)


def project(bvh, x, y, lift, z_from=1.0):
    """Project a game-space (x, y) point onto a surface along -Z (from the front). Returns game-space Vector."""
    hit, nrm, _, _ = bvh.ray_cast(V(x, y, z_from), V(0, 0, -1))
    if hit is None:
        return None
    hb = hit + nrm * lift
    return Vector((hb.x, hb.z, -hb.y))


def decal(name, bvh, outline, lift, mat, holes_ok=False):
    """Flat polygon (list of game-space (x, y)) projected onto bvh; triangle fan from the centroid."""
    cx = sum(p[0] for p in outline) / len(outline)
    cy = sum(p[1] for p in outline) / len(outline)
    pts = [(cx, cy)] + list(outline)
    verts = []
    for x, y in pts:
        q = project(bvh, x, y, lift)
        verts.append((q.x, q.y, q.z))
    faces = [(0, i, i % len(outline) + 1) for i in range(1, len(outline) + 1)]
    return make_obj(name, verts, faces, mat, subsurf=0, smooth=False, recalc=False)


def strip(name, bvh, path, widths, lift, mat):
    """Ribbon along a 2D path (game x, y) with per-point width, projected onto bvh."""
    verts, faces = [], []
    for i, (x, y) in enumerate(path):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, len(path) - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        w = widths[i] / 2
        for s in (1, -1):
            q = project(bvh, x + nx * w * s, y + ny * w * s, lift)
            verts.append((q.x, q.y, q.z))
    for i in range(len(path) - 1):
        faces.append((i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2))
    return make_obj(name, verts, faces, mat, subsurf=0, smooth=False, recalc=False)


# ---------------------------------------------------------------------------------------------
# Joints (game space) — must match NinjaModel.ts
# ---------------------------------------------------------------------------------------------
JOINTS = {
    'pelvis': (0, 0.95, 0),
    'torso': (0, 0.99, 0),
    'head': (0, 1.47, 0),
    'upperArm_L': (0.27, 1.39, 0), 'upperArm_R': (-0.27, 1.39, 0),
    'forearm_L': (0.27, 1.12, 0), 'forearm_R': (-0.27, 1.12, 0),
    'thigh_L': (0.10, 0.88, 0), 'thigh_R': (-0.10, 0.88, 0),
    'shin_L': (0.10, 0.47, 0), 'shin_R': (-0.10, 0.47, 0),
}
FACE_Y = 1.64  # face centre height


def build():
    parts = {k: [] for k in JOINTS}

    # ---------------- Pelvis (jogger hips) ----------------
    rings = [ring(0, y, cz, rx, rz, 18, 2.3) for y, rx, rz, cz in [
        (1.035, 0.150, 0.105, 0.0), (0.99, 0.165, 0.117, 0.0), (0.92, 0.174, 0.122, -0.004),
        (0.86, 0.170, 0.120, -0.006), (0.81, 0.135, 0.100, 0.0), (0.775, 0.075, 0.065, 0.0)]]
    parts['pelvis'].append(make_obj('pelvis_pants', *loft(rings), 'pants'))

    # ---------------- Legs ----------------
    for side, tag in ((1, 'L'), (-1, 'R')):
        x = 0.10 * side
        parts['thigh_' + tag].append(make_obj('thigh_' + tag, *limb(x, 0.004, [(0.88, 0.094), (0.80, 0.091), (0.66, 0.081), (0.53, 0.071), (0.47, 0.069)], sz=1.05), 'pants'))
        shin = parts['shin_' + tag]
        shin.append(make_obj('shin_' + tag, *limb(x, 0.0, [(0.47, 0.069), (0.41, 0.067), (0.29, 0.061), (0.18, 0.055), (0.14, 0.054)], sz=1.03), 'pants'))
        # gathered jogger cuff
        shin.append(make_obj('cuff_' + tag, *limb(x, 0.002, [(0.155, 0.058), (0.10, 0.056)], caps=True), 'pants_cuff'))
        shin.append(make_obj('sock_' + tag, *limb(x, 0.0, [(0.12, 0.040), (0.05, 0.043)]), 'sock'))
        # sneaker upper (rings along Z), sits on the sole
        up = [ring_z(z, x, cy, rx, ry, 18, 3.2) for z, cy, rx, ry in [
            (-0.088, 0.050, 0.026, 0.026), (-0.078, 0.056, 0.046, 0.040), (-0.04, 0.060, 0.052, 0.046),
            (0.02, 0.052, 0.055, 0.038), (0.09, 0.042, 0.054, 0.028), (0.145, 0.037, 0.048, 0.022),
            (0.178, 0.034, 0.034, 0.017), (0.192, 0.034, 0.016, 0.010)]]
        shin.append(make_obj('shoe_' + tag, *loft(up), 'shoe'))
        sole = [ring_z(z, x, 0.012, rx, 0.013, 18, 6) for z, rx in [
            (-0.098, 0.03), (-0.09, 0.052), (-0.04, 0.058), (0.03, 0.061), (0.10, 0.060), (0.16, 0.052), (0.192, 0.036), (0.204, 0.016)]]
        shin.append(make_obj('sole_' + tag, *loft(sole), 'sole', subsurf=1))
        # heel tab + toe cap line
        shin.append(make_obj('heel_' + tag, *ellipsoid((x, 0.075, -0.083), (0.022, 0.03, 0.012)), 'heel', subsurf=1))
        # laces: three small bars across the top of the foot
        for i, z in enumerate((0.03, 0.06, 0.09)):
            yy = 0.052 + 0.038 - i * 0.008 - 0.004
            shin.append(make_obj(f'lace_{tag}{i}', *ellipsoid((x, yy, z), (0.026, 0.006, 0.008), 8, 5), 'sock', subsurf=1))

    # ---------------- Torso (zip hoodie) ----------------
    torso_rings = [ring(0, y, cz, rx, rz, 20, 2.4) for y, rx, rz, cz in [
        (0.885, 0.150, 0.110, 0.0), (0.90, 0.183, 0.133, 0.0), (0.94, 0.181, 0.131, 0.0), (1.00, 0.173, 0.125, 0.0),
        (1.10, 0.174, 0.124, 0.006), (1.20, 0.186, 0.129, 0.011), (1.29, 0.198, 0.133, 0.013),
        (1.36, 0.207, 0.128, 0.008), (1.425, 0.198, 0.115, 0.0), (1.47, 0.135, 0.088, -0.005), (1.50, 0.08, 0.068, -0.005)]]
    hoodie = make_obj('torso_hoodie', *loft(torso_rings), 'hoodie')
    tparts = parts['torso']
    tparts.append(hoodie)
    tparts.append(make_obj('hem', *loft([ring(0, y, 0, rx, rz, 20, 2.4) for y, rx, rz in
                                          [(0.888, 0.180, 0.130), (0.892, 0.188, 0.137), (0.935, 0.187, 0.136), (0.94, 0.178, 0.128)]], cap0=False, cap1=False), 'trim', subsurf=1))
    # stand-up collar (thick tube)
    collar = [ring(0, y, cz, rx, rz, 18) for y, rx, rz, cz in [
        (1.455, 0.090, 0.080, -0.006), (1.545, 0.083, 0.073, -0.004), (1.548, 0.070, 0.061, -0.004), (1.46, 0.072, 0.063, -0.006)]]
    tparts.append(make_obj('collar', *loft(collar, loop=True), 'hoodie'))
    # hood bunched on the back
    tparts.append(make_obj('hood_roll', *ellipsoid((0, 1.46, -0.105), (0.125, 0.06, 0.06)), 'hoodie'))
    tparts.append(make_obj('hood_drape', *ellipsoid((0, 1.37, -0.132), (0.112, 0.085, 0.032)), 'hoodie'))

    # ---------------- Arms ----------------
    for side, tag in ((1, 'L'), (-1, 'R')):
        x = 0.27 * side
        parts['upperArm_' + tag].append(make_obj('sleeve_up_' + tag, *limb(x, 0.0, [(1.39, 0.074), (1.33, 0.071), (1.22, 0.063), (1.13, 0.058), (1.12, 0.057)]), 'hoodie'))
        fa = parts['forearm_' + tag]
        fa.append(make_obj('sleeve_lo_' + tag, *limb(x, 0.0, [(1.12, 0.057), (1.03, 0.055), (0.95, 0.052), (0.935, 0.051)]), 'hoodie'))
        fa.append(make_obj('sleeve_cuff_' + tag, *limb(x, 0.0, [(0.945, 0.051), (0.905, 0.046)], caps=True), 'trim'))
        fa.append(make_obj('wrist_' + tag, *limb(x, 0.0, [(0.92, 0.031), (0.88, 0.030)]), 'skin'))
        fa.append(make_obj('fist_' + tag, *ellipsoid((x, 0.845, 0.006), (0.037, 0.05, 0.045)), 'skin'))
        fa.append(make_obj('thumb_' + tag, *ellipsoid((x - 0.016 * side, 0.858, 0.036), (0.014, 0.024, 0.014), 10, 7), 'skin'))
        # knuckle ridge
        fa.append(make_obj('knuckles_' + tag, *ellipsoid((x + 0.004 * side, 0.818, 0.012), (0.034, 0.018, 0.04), 10, 7), 'skin'))

    step('body done')
    # ---------------- Head ----------------
    c = FACE_Y
    head_rings = [ring(0, c + dy, zc, rx, rz, 22) for dy, rx, rz, zc in [
        (-0.122, 0.022, 0.020, 0.040), (-0.112, 0.042, 0.036, 0.034), (-0.09, 0.068, 0.062, 0.020), (-0.055, 0.088, 0.088, 0.008),
        (-0.015, 0.099, 0.104, 0.0), (0.025, 0.104, 0.114, -0.005), (0.065, 0.104, 0.118, -0.010), (0.105, 0.094, 0.111, -0.015),
        (0.138, 0.072, 0.088, -0.018), (0.158, 0.040, 0.050, -0.018)]]
    head = make_obj('head_skin', *loft(head_rings), 'skin')
    hparts = parts['head']
    hparts.append(head)
    hparts.append(make_obj('neck', *limb(0, -0.018, [(1.56, 0.047), (1.44, 0.051)], sz=0.95), 'skin'))
    for s in (1, -1):
        hparts.append(make_obj(f'ear_{s}', *ellipsoid((0.099 * s, c - 0.012, -0.008), (0.016, 0.03, 0.022), 10, 7), 'skin'))

    bpy.context.view_layer.update()
    step('head bvh')
    hb = bvh_of(head)
    step('face')

    # nose (small, soft)
    tip = project(hb, 0, c - 0.042, 0.0)
    hparts.append(make_obj('nose', *ellipsoid((0, c - 0.038, tip.z - 0.004), (0.011, 0.02, 0.012), 10, 7), 'skin'))

    # eyes
    EY = c - 0.008
    for s in (1, -1):
        ex = 0.043 * s
        w, h = 0.036, 0.031
        up, lo = [], []
        N = 12
        for i in range(N + 1):
            t = -1 + 2 * i / N  # -1 inner .. +1 outer
            xx = ex + t * w / 2 * s
            tilt = 0.002 * t  # outer corner slightly up
            up.append((xx, EY + tilt + h / 2 * (1 - t * t) ** 0.55))
            lo.append((xx, EY + tilt - h / 2 * 0.72 * (1 - t * t) ** 0.85))
        outline = up + lo[::-1][1:-1]
        hparts.append(decal(f'eye_white_{s}', hb, outline, 0.0012, 'eye_white'))
        ix, iy = ex - 0.002 * s, EY - 0.002
        circ = lambda r, ry, cx, cy, k=14: [(cx + r * math.cos(TAU * i / k), cy + ry * math.sin(TAU * i / k)) for i in range(k)]
        # iris clipped by the upper lid: flatten its top
        iris = [(px, min(py, EY + h / 2 * 0.78)) for px, py in circ(0.0122, 0.0142, ix, iy, 16)]
        hparts.append(decal(f'iris_{s}', hb, iris, 0.0024, 'iris'))
        hparts.append(decal(f'pupil_{s}', hb, circ(0.0055, 0.0068, ix, iy - 0.001, 10), 0.0032, 'pupil'))
        hparts.append(decal(f'hl_{s}', hb, circ(0.0034, 0.0034, ix + 0.0045 * s, iy + 0.006, 8), 0.0040, 'highlight'))
        # upper lash line (thicker toward the outer corner)
        path = [(p[0], p[1] + 0.0012) for p in up]
        widths = [0.0035 + 0.0045 * (i / N) ** 1.5 for i in range(N + 1)]
        hparts.append(strip(f'lash_{s}', hb, path, widths, 0.0042, 'ink'))
        # short lower lash at the outer corner
        lpath = [(ex + (0.25 + 0.75 * i / 5) * w / 2 * s, EY - h / 2 * 0.72 * (1 - (0.25 + 0.75 * i / 5) ** 2) ** 0.85 + 0.002 * i / 5) for i in range(6)]
        hparts.append(strip(f'lowlash_{s}', hb, lpath, [0.0018] * 6, 0.0042, 'ink'))
        # eyebrow: thick inner end, tapering, gentle arch
        bp = [(s * (0.022 + 0.046 * i / 8), c + 0.03 + 0.006 * math.sin(math.pi * i / 8 * 0.85) - 0.002 * i / 8) for i in range(9)]
        bw = [0.0085 - 0.0055 * i / 8 for i in range(9)]
        hparts.append(strip(f'brow_{s}', hb, bp, bw, 0.0035, 'ink'))
    # mouth: short relaxed line with a hint of a smile
    mp = [(-0.016 + 0.032 * i / 8, c - 0.08 + 0.0025 * ((i / 8 - 0.5) * 2) ** 2) for i in range(9)]
    hparts.append(strip('mouth', hb, mp, [0.0028] * 9, 0.0025, 'mouth'))

    step('hair')
    # ---------------- Hair ----------------
    HC = Vector((0, c + 0.03, -0.012))
    HR = Vector((0.119, 0.152, 0.133))

    def E(th, ph, k=1.0):
        t, p = rad(th), rad(ph)
        return Vector((HC.x + k * HR.x * math.cos(p) * math.sin(t), HC.y + k * HR.y * math.sin(p), HC.z + k * HR.z * math.cos(p) * math.cos(t)))

    def hairline(th):
        xx = math.cos(rad(th))
        return -5 + 32 * xx - 8 * xx * xx  # 19 deg at the forehead, -5 above the ears, -45 at the nape

    # cap: columns from the crown down to the hairline (no jagged edge)
    NC, NR = 28, 7
    verts, faces = [], []
    for r in range(1, NR + 1):
        for ci in range(NC):
            th = 360 * ci / NC
            ph = 90 - (90 - hairline(th)) * r / NR
            q = E(th, ph)
            verts.append((q.x, q.y, q.z))
    for r in range(NR - 1):
        for ci in range(NC):
            faces.append((r * NC + ci, r * NC + (ci + 1) % NC, (r + 1) * NC + (ci + 1) % NC, (r + 1) * NC + ci))
    top = E(0, 90)
    verts.append((top.x, top.y, top.z))
    for ci in range(NC):
        faces.append((len(verts) - 1, (ci + 1) % NC, ci))
    hparts.append(make_obj('hair_cap', verts, faces, 'hair', subsurf=1))

    def out_normal(p):
        d = p - HC
        return Vector((d.x / HR.x ** 2, d.y / HR.y ** 2, d.z / HR.z ** 2)).normalized()

    def lock(name, th0, ph0, th1, ph1, k1=1.08, mid=1.1, w=0.05, t=0.02, segs=9):
        p0 = E(th0, ph0, 0.95)
        p2 = E(th1, ph1, k1)
        m = E((th0 + th1) / 2, (ph0 + ph1) / 2, mid)
        cc = m * 2 - (p0 + p2) * 0.5
        pts = [bezier(p0, cc, p2, i / segs) for i in range(segs + 1)]
        verts, faces = [], []
        n = 6
        for i, p in enumerate(pts):
            u = i / segs
            tg = (pts[min(i + 1, segs)] - pts[max(i - 1, 0)]).normalized()
            nr = out_normal(p)
            nr = (nr - tg * nr.dot(tg)).normalized()
            bn = tg.cross(nr).normalized()
            sc = (1 - u) ** 0.85 * (0.85 + 0.15 * math.sin(math.pi * min(u * 1.6, 1)))
            if i == segs:
                verts.append((p.x, p.y, p.z))
                continue
            for k in range(n):
                a = TAU * k / n
                q = p + bn * (math.cos(a) * w / 2 * sc) + nr * (math.sin(a) * t / 2 * sc)
                verts.append((q.x, q.y, q.z))
        for i in range(segs - 1):
            for k in range(n):
                faces.append((i * n + k, i * n + (k + 1) % n, (i + 1) * n + (k + 1) % n, (i + 1) * n + k))
        tipi = len(verts) - 1
        last = (segs - 1) * n
        for k in range(n):
            faces.append((last + k, last + (k + 1) % n, tipi))
        for k in range(n):  # root cap
            pass
        hparts.append(make_obj(name, verts, faces, 'hair', subsurf=1))

    j = lambda a: a + random.uniform(-4, 4)
    # fringe: falls over the forehead, swept slightly to his right (-X)
    for i, th in enumerate((-40, -22, -5, 12, 30, 46)):
        lock(f'fringe{i}', th, 52, th * 1.05 - 12 + random.uniform(-3, 3), j(9) + (4 if abs(th) > 35 else 0), k1=1.07, mid=1.12, w=0.054, t=0.022)
    # temples and sides (cover the top of the ears)
    for s in (1, -1):
        lock(f'temple{s}', 48 * s, 42, 62 * s, j(-2), k1=1.07, w=0.05)
        lock(f'side{s}', 70 * s, 36, 86 * s, -13, k1=1.06, w=0.052)
        lock(f'sideb{s}', 98 * s, 34, 108 * s, -18, k1=1.05, w=0.05)
        lock(f'burn{s}', 80 * s, 10, 84 * s, -26, k1=1.02, mid=1.04, w=0.03, t=0.014, segs=6)
    # top: soft messy tufts lying forward/sideways
    for i, (th0, th1) in enumerate(((-30, -55), (0, -20), (28, 48), (60, 80), (-62, -84), (12, 20))):
        lock(f'top{i}', th0, 84, th1, j(58), k1=1.05, mid=1.07, w=0.062, t=0.024)
    # crown and back: layered rows flowing down to the nape
    for i, th in enumerate((125, 152, 180, 208, 235)):
        lock(f'crown{i}', j(th), 80, j(th) + random.uniform(-10, 10), 40, k1=1.06, mid=1.08, w=0.064, t=0.024)
    for i, th in enumerate((115, 140, 165, 195, 220, 245)):
        lock(f'back{i}', j(th), 48, j(th), j(2), k1=1.09, mid=1.1, w=0.058, t=0.022)
    for i, th in enumerate((130, 160, 200, 230)):
        lock(f'nape{i}', j(th), 12, j(th), -40, k1=1.04, mid=1.06, w=0.05, t=0.02)

    # ---------------- Torso details (need the hoodie surface) ----------------
    step('details')
    bpy.context.view_layer.update()
    tb = bvh_of(hoodie)
    zp = [(0.0, 0.905 + (1.455 - 0.905) * i / 20) for i in range(21)]
    tparts.append(strip('zipper', tb, zp, [0.010] * 21, 0.0025, 'zipper'))
    pull = project(tb, 0.0, 1.43, 0.004)
    tparts.append(make_obj('zip_pull', *ellipsoid((0.0, 1.425, pull.z + 0.002), (0.007, 0.016, 0.004), 8, 5), 'zipper', subsurf=0))
    # pocket openings (diagonal welts)
    for s in (1, -1):
        pp = [(s * (0.075 + 0.05 * i / 6), 1.07 - 0.075 * i / 6) for i in range(7)]
        tparts.append(strip(f'pocket{s}', tb, pp, [0.008] * 7, 0.0022, 'trim'))
    # drawstrings hanging from the collar
    for s in (1, -1):
        pts = []
        for i in range(9):
            y = 1.465 - 0.15 * i / 8
            xx = s * (0.036 + 0.006 * i / 8)
            q = project(tb, xx, y, 0.007)
            pts.append(q)
        verts, faces = tube_along(pts, [0.0045] * 9, n=6, up=lambda p: Vector((0, 0, 1)))
        tparts.append(make_obj(f'string{s}', verts, faces, 'string', subsurf=0))
        end = pts[-1]
        tparts.append(make_obj(f'aglet{s}', *ellipsoid((end.x, end.y - 0.008, end.z), (0.006, 0.013, 0.006), 8, 5), 'string', subsurf=0))

    return parts


def bake(parts):
    """Apply modifiers, merge each part into one object with its origin at the joint."""
    out = []
    for name, objs in parts.items():
        step(f'bake {name} ({len(objs)} pieces)')
        joint = V(*JOINTS[name])
        allv, allp, mats, mat_idx, smooth = [], [], [], [], []
        for o in objs:
            verts, polys, pinfo = evaluated_data(o)
            base = len(allv)
            allv.extend(v - joint for v in verts)
            for poly, (mname, sm) in zip(polys, pinfo):
                if mname not in mats:
                    mats.append(mname)
                allp.append(tuple(i + base for i in poly))
                mat_idx.append(mats.index(mname))
                smooth.append(sm)
        me = bpy.data.meshes.new(name)
        me.from_pydata(allv, [], allp)
        for mname in mats:
            me.materials.append(bpy.data.materials[mname])
        me.polygons.foreach_set('material_index', mat_idx)
        me.polygons.foreach_set('use_smooth', smooth)
        me.update()
        ob = bpy.data.objects.new(name, me)
        ob.location = joint
        COL.objects.link(ob)
        out.append(ob)
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
        ob.name = name  # a source piece may have held the joint name; now it is free
    return out


def preview_renders(objs):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    sh.show_object_outline = True
    sh.object_outline_color = (0.05, 0.05, 0.07)
    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    scene.world.color = (0.55, 0.62, 0.72)
    scene.render.resolution_x, scene.render.resolution_y = 720, 1100
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new('PreviewCam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.05
    cam = bpy.data.objects.new('PreviewCam', cam_data)
    COL.objects.link(cam)
    scene.camera = cam
    shots = {'front': 0, '34': 35, 'side': 90}
    for tag, yaw in shots.items():
        a = rad(yaw)
        cam.location = Vector((5 * math.sin(a), -5 * math.cos(a), 0.93))
        cam.rotation_euler = (rad(90), 0, a)
        scene.render.filepath = os.path.join(ART, f'hero_{tag}.png')
        bpy.ops.render.render(write_still=True)
    # head close-up
    cam_data.ortho_scale = 0.42
    cam.location = Vector((5 * math.sin(rad(20)), -5 * math.cos(rad(20)), 1.66))
    cam.rotation_euler = (rad(90), 0, rad(20))
    scene.render.resolution_x, scene.render.resolution_y = 800, 800
    scene.render.filepath = os.path.join(ART, 'hero_face.png')
    bpy.ops.render.render(write_still=True)


def main():
    global COL
    os.makedirs(ART, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    open(LOG, 'w').close()
    step('start')
    scene = bpy.context.scene
    # Fresh collection; clear whatever the script (or the default startup scene) left behind.
    for ob in list(scene.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        if c.name.startswith('Hero'):
            bpy.data.collections.remove(c)
    COL = bpy.data.collections.new('Hero')
    scene.collection.children.link(COL)

    parts = build()
    step('built')
    objs = bake(parts)
    step('baked')

    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
              export_cameras=False, export_lights=False, export_animations=False, export_texcoords=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True)

    # Nice viewport for whoever opens the file.
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type == 'VIEW_3D':
            area.spaces[0].shading.type = 'SOLID'
            area.spaces[0].shading.color_type = 'MATERIAL'

    step('exported')
    preview_renders(objs)
    step('rendered')
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ART, 'hero.blend'), copy=True)
    return f'OK parts={len(objs)} tris={tris} glb={OUT_GLB}'


if __name__ == '__main__':
    try:
        msg = main()
    except Exception:
        msg = 'ERROR\n' + traceback.format_exc()
    os.makedirs(ART, exist_ok=True)
    with open(LOG, 'a') as f:
        f.write(msg + '\n')
    print(msg)
