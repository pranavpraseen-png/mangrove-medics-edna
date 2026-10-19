"""
eDNA Pod — carousel, nozzle and base parts (Canopy Keepers, FLL BIOGLOW 2026–27)
Builds the printed parts that sit around the test cartridge (../cartridge) and exports each one
lying in its print orientation (flat face on the bed, z = 0):

  carousel_hub.stl        hub on the NEMA17 5 mm D-shaft + flange the carousel pieces bolt to
  carousel_quarter.stl    one quarter of the 8-seat carousel (print 4); used when the carousel is wider than the bed
  carousel.stl            one-piece carousel instead (only made when it fits the bed, e.g. SEATS = 6)
  nozzle_block.stl        two hose barbs (sample + ethanol) merging to one outlet, gasket recess underneath
  nozzle_arm.stl          bolt-on arm from the MG996R horn to the nozzle block
  servo_tower.stl         upright that holds the MG996R beside the carousel
  base_plate.stl          NEMA17 mount, tower bolt holes, waste collector + outlet, home-sensor holes

All units are millimetres. Run headless:  blender --background --python make_pod.py
(or python3.11 with the bpy module). Change the numbers in P and run again.
Assembly coordinates: z = 0 is the top of the base plate, the motor shaft is the z axis,
the nozzle sits over seat 1 on the +x axis.
"""
import bpy, bmesh, math, os
from mathutils import Vector

P = dict(
    seats=8,
    # cartridge envelope (from ../cartridge/make_cartridge.py)
    cart_r=29.0, cap_r=33.5, cart_h=38.0,
    seat_clear=0.5, ring_t=2.5, ring_h=8.0, cap_gap=2.0,
    deck_z=8.0, deck_t=5.0, drain_r=7.0,
    # hub on a NEMA17 (5 mm D-shaft, 24 mm long, 22 mm boss, 31 mm M3 square)
    boss_r=11.0, hub_z0=3.0, hub_z1=22.0, bore_r=2.6, flat=2.15, insert_r=2.0, screw_z=17.0,
    flange_r=70.0, bolt_r=50.0,
    bed=210.0,                       # largest part that fits a 220 x 220 bed with a margin
    magnet_r=4.15, magnet_d=4.0, magnet_off=22.0,   # 8 x 5 mm disc: 4 mm pocket keeps a 1 mm floor, magnet stands 1 mm proud underneath
    slot_w=6.0,
    # nozzle
    blk=26.0, blk_h=22.0, gasket_r=8.2, gasket_d=2.0, gasket_out=1.0,
    bore=1.6, barb_dy=7.0, barb_len=14.0,
    # servo (MG996R): body 40.5 x 20.5, tab holes 49.5 x 10, shaft 10 mm from the top end,
    # horn face about 19 mm above the tab face
    sv_l=40.5, sv_w=20.5, sv_holes=(49.5, 10.0), sv_shaft=10.0, horn_above_tab=19.0,
    horn_r=10.75, horn_d=1.5, arm_t=6.0, arm_h=12.0,
    plate_t=5.0, seg=128,
)
P['R'] = math.ceil((2 * P['cap_r'] + P['cap_gap']) / (2 * math.sin(math.pi / P['seats'])))
P['pocket_r'] = P['cart_r'] + P['seat_clear']
P['slot_r0'], P['slot_r1'] = P['R'] - 15.0, P['R'] + 1.0          # waste slots between seats
P['seat_r'] = P['pocket_r'] + P['ring_t']
P['rim_r'] = P['R'] + P['seat_r']
P['split'] = 2 * P['rim_r'] > P['bed']
P['deck_top'] = P['deck_z'] + P['deck_t']
P['zb'] = P['deck_top'] + P['cart_h'] + P['gasket_out']          # nozzle block bottom when pressed
P['Hs'] = P['zb'] + 14.0                                          # servo shaft height (arm level when pressed)
P['xs'] = math.ceil(P['R'] + P['cap_r'] + 3.0 + P['sv_w'] / 2)    # servo shaft x, body clears the cartridges
P['y_horn'] = -(P['blk'] / 2 + P['arm_t'])                         # arm sits against the block's -y face
P['y_tab'] = P['y_horn'] - P['horn_above_tab']
OUT = os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else bpy.path.abspath('//')


# ───────────── helpers ─────────────
def clear():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)


def cyl(name, r, z0, z1, x=0.0, y=0.0, seg=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg or P['seg'], radius=r, depth=z1 - z0, location=(x, y, (z0 + z1) / 2))
    o = bpy.context.active_object; o.name = name; return o


def rod(name, r, a, b, seg=48):
    """Cylinder from point a to point b."""
    a, b = Vector(a), Vector(b); d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=d.length, location=(a + b) / 2)
    o = bpy.context.active_object; o.name = name
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False); return o


def cone(name, r0, r1, z0, z1, x=0.0, y=0.0, seg=48):
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r0, radius2=r1, depth=z1 - z0, location=(x, y, (z0 + z1) / 2))
    o = bpy.context.active_object; o.name = name; return o


def box(name, x0, x1, y0, y1, z0, z1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object; o.name = name; o.scale = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True); return o


def hexprism(name, r, z0, z1, x, y):
    return cyl(name, r, z0, z1, x, y, seg=6)


def prism_x(name, pts_yz, x0, x1):
    """Closed prism: polygon in the yz plane extruded from x0 to x1."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in pts_yz]; b = [bm.verts.new((x1, y, z)) for y, z in pts_yz]
    n = len(pts_yz)
    bm.faces.new(list(reversed(a))); bm.faces.new(b)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); return o


def sector(name, a0, a1, r, z0, z1):
    """Pie-slice prism from angle a0 to a1 (radians), radius r."""
    bm = bmesh.new(); n = 64
    pts = [(0.0, 0.0)] + [(r * math.cos(a0 + (a1 - a0) * i / n), r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    lo = [bm.verts.new((x, y, z0)) for x, y in pts]; hi = [bm.verts.new((x, y, z1)) for x, y in pts]
    m = len(pts)
    bm.faces.new(list(reversed(lo))); bm.faces.new(hi)
    for i in range(m):
        bm.faces.new((lo[i], lo[(i + 1) % m], hi[(i + 1) % m], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); return o


def boolean(target, tool, op):
    m = target.modifiers.new('b', 'BOOLEAN'); m.operation = op; m.object = tool; m.solver = 'EXACT'; m.use_hole_tolerant = True
    bpy.context.view_layer.objects.active = target; bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(tool, do_unlink=True)


def dup(o, name):
    c = o.copy(); c.data = o.data.copy(); c.name = name; bpy.context.collection.objects.link(c); return c


def seat_xy(k, r=None):
    a = 2 * math.pi * k / P['seats']; r = r or P['R']; return r * math.cos(a), r * math.sin(a)


def gap_angle(k):
    return 2 * math.pi * (k + 0.5) / P['seats']


# ───────────── carousel ─────────────
def make_deck():
    """Full carousel deck (all seats) without the hub."""
    z0, z1 = P['deck_z'], P['deck_top']
    deck = cyl('deck', P['R'] - 10.0, z0, z1)  # inner disc; its edge stays clear of the drain holes
    for k in range(P['seats']):
        x, y = seat_xy(k)
        seat = cyl(f'seat{k}', P['seat_r'], z0, z1 + P['ring_h'], x, y)      # floor + ring wall in one solid
        boolean(seat, cyl(f'pk{k}', P['pocket_r'], z1, z1 + P['ring_h'] + 1, x, y), 'DIFFERENCE')
        boolean(deck, seat, 'UNION')
    for k in range(P['seats']):
        x, y = seat_xy(k)
        boolean(deck, cyl(f'dr{k}', P['drain_r'], z0 - 1, z1 + 1, x, y, seg=64), 'DIFFERENCE')
    # waste slots in every other gap between seats: the firmware turns half a seat so PRIME / RINSE water
    # falls through a slot instead of onto a clean cartridge
    for k in range(1, P['seats'], 2):
        a = gap_angle(k); ca, sa = math.cos(a), math.sin(a)
        for r in (P['slot_r0'], P['slot_r1']):
            boolean(deck, cyl(f'sl{k}{r}', P['slot_w'] / 2, z0 - 1, z1 + 1, r * ca, r * sa, seg=32), 'DIFFERENCE')
        rm = (P['slot_r0'] + P['slot_r1']) / 2
        s = box(f'slb{k}', -(P['slot_r1'] - P['slot_r0']) / 2, (P['slot_r1'] - P['slot_r0']) / 2, -P['slot_w'] / 2, P['slot_w'] / 2, z0 - 1, z1 + 1)
        s.rotation_euler[2] = a; s.location = (rm * ca, rm * sa, 0)
        bpy.context.view_layer.objects.active = s; bpy.ops.object.transform_apply(location=True, rotation=True)
        boolean(deck, s, 'DIFFERENCE')
    # home magnet (8 x 5 mm disc) under seat 1, glued in from below; pocket 8.3 x 4.0 mm leaves a 1 mm floor
    x, y = seat_xy(0)
    boolean(deck, cyl('mag', P['magnet_r'], z0 - 1, z0 + P['magnet_d'], x, y + P['magnet_off'], seg=48), 'DIFFERENCE')
    return deck


def hub_bore(target):
    """D-shaped bore for the 5 mm shaft + radial M3 heat-set insert hole aimed at the flat (+x side)."""
    bore = cyl('bore', P['bore_r'], P['hub_z0'] - 1, P['hub_z1'] + 1, seg=48)
    boolean(bore, box('flat', P['flat'], 10, -10, 10, P['hub_z0'] - 2, P['hub_z1'] + 2), 'DIFFERENCE')
    boolean(target, bore, 'DIFFERENCE')
    boolean(target, rod('insert', P['insert_r'], (P['flat'] - 0.5, 0, P['screw_z']), (P['boss_r'] + 1, 0, P['screw_z'])), 'DIFFERENCE')


def make_hub():
    hub = cyl('carousel_hub', P['flange_r'], P['hub_z0'], P['deck_z'])
    boolean(hub, cyl('boss', P['boss_r'], P['deck_z'] - 1.0, P['hub_z1']), 'UNION')
    hub_bore(hub)
    for i, (x, y) in enumerate(bolt_xy()):
        boolean(hub, cyl(f'hb{i}', 1.7, P['hub_z0'] - 1, P['deck_z'] + 1, x, y, seg=32), 'DIFFERENCE')
        boolean(hub, hexprism(f'nut{i}', 3.3, P['hub_z0'] - 1, P['hub_z0'] + 2.6, x, y), 'DIFFERENCE')
    return hub


def bolt_xy():
    """Two M3 bolts per carousel quarter, either side of the quarter's middle."""
    pts = []
    for q in range(4):
        mid = gap_angle(2 * q + 1) if P['seats'] == 8 else (q * math.pi / 2 - math.pi / 4)
        for d in (-math.radians(20), math.radians(20)):
            pts.append((P['bolt_r'] * math.cos(mid + d), P['bolt_r'] * math.sin(mid + d)))
    return pts


def make_quarter(deck):
    """Cut one quarter (two seats) out of the deck; the cuts run through gaps 0, 2, 4, 6."""
    q = dup(deck, 'carousel_quarter')
    a0, a1 = gap_angle(0) - math.pi / 2, gap_angle(0)                   # boundaries at gaps 6 and 0: seats 7 and 0 inside
    boolean(q, sector('sec', a0, a1, P['rim_r'] + 5, P['deck_z'] - 2, P['deck_top'] + P['ring_h'] + 2), 'INTERSECT')
    boolean(q, cyl('hubhole', P['boss_r'] + 1.0, P['deck_z'] - 1, P['deck_top'] + 1), 'DIFFERENCE')
    for i, (x, y) in enumerate(bolt_xy()):
        ang = math.atan2(y, x)
        if not (a0 - 1e-6 <= ang <= a1 + 1e-6): continue
        boolean(q, cyl(f'qb{i}', 1.7, P['deck_z'] - 1, P['deck_top'] + 1, x, y, seg=32), 'DIFFERENCE')
        boolean(q, cyl(f'qc{i}', 3.25, P['deck_top'] - 3.0, P['deck_top'] + 1, x, y, seg=32), 'DIFFERENCE')
    return q


def make_one_piece(deck):
    c = dup(deck, 'carousel')
    boolean(c, cyl('boss', P['boss_r'], P['hub_z0'], P['hub_z1']), 'UNION')
    hub_bore(c)
    return c


# ───────────── nozzle ─────────────
def make_nozzle_block():
    R, zb, b, h = P['R'], P['zb'], P['blk'], P['blk_h']
    zt = zb + h
    blk = box('nozzle_block', R - b / 2, R + b / 2, -b / 2, b / 2, zb, zt)
    for s in (-1, 1):   # hose barbs for 6 mm ID silicone tube
        y = s * P['barb_dy']
        boolean(blk, cyl(f'shank{s}', 2.9, zt - 1.0, zt + P['barb_len'], R, y, seg=48), 'UNION')
        for i in range(3):
            z0 = zt + 2 + i * 4
            boolean(blk, cone(f'barb{s}{i}', 3.55, 2.9, z0, z0 + 3.6, R, y), 'UNION')
    # gasket recess and outlet
    boolean(blk, cyl('gasket', P['gasket_r'], zb - 1, zb + P['gasket_d'], R, 0, seg=64), 'DIFFERENCE')
    zm = zb + 7.0
    boolean(blk, cyl('outlet', 1.75, zb - 1, zm + 0.5, R, 0), 'DIFFERENCE')
    for s in (-1, 1):
        y = s * P['barb_dy']
        boolean(blk, cyl(f'in{s}', P['bore'], zb + 14, zt + P['barb_len'] + 1, R, y), 'DIFFERENCE')
        boolean(blk, rod(f'ch{s}', P['bore'], (R, y, zb + 14.5), (R, 0, zm)), 'DIFFERENCE')
    # pilot holes for two M3 screws from the arm (screw straight into the PETG)
    for dx in (-7, 7):
        boolean(blk, rod(f'ap{dx}', 1.4, (R + dx, -b / 2 - 1, P['Hs']), (R + dx, -b / 2 + 12, P['Hs'])), 'DIFFERENCE')
    return blk


def make_arm():
    R, Hs, xs, t = P['R'], P['Hs'], P['xs'], P['arm_t']
    y1 = -P['blk'] / 2; y0 = y1 - t
    arm = box('nozzle_arm', R - 12, xs, y0, y1, Hs - P['arm_h'] / 2, Hs + P['arm_h'] / 2)
    boolean(arm, rod('boss', 13.0, (xs, y0, Hs), (xs, y1, Hs), seg=96), 'UNION')
    for dx in (-7, 7):
        boolean(arm, rod(f'h{dx}', 1.7, (R + dx, y0 - 1, Hs), (R + dx, y1 + 1, Hs), seg=32), 'DIFFERENCE')
    # MG996R round horn: shallow recess, hub-screw hole, 4 horn-screw holes (check against your horn)
    boolean(arm, rod('horn', P['horn_r'], (xs, y0 - 1, Hs), (xs, y0 + P['horn_d'], Hs), seg=96), 'DIFFERENCE')
    boolean(arm, rod('hub', 4.5, (xs, y0 - 1, Hs), (xs, y1 + 1, Hs), seg=48), 'DIFFERENCE')
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        x, z = xs + 7.25 * math.cos(a), Hs + 7.25 * math.sin(a)
        boolean(arm, rod(f'hs{i}', 1.0, (x, y0 - 1, z), (x, y1 + 1, z), seg=24), 'DIFFERENCE')
    return arm


# ───────────── servo tower ─────────────
def servo_geom():
    xs, Hs = P['xs'], P['Hs']
    top = Hs + P['sv_shaft']; bot = top - P['sv_l']; zc = (top + bot) / 2
    holes = [(xs + sx * P['sv_holes'][1] / 2, zc + sz * P['sv_holes'][0] / 2) for sx in (-1, 1) for sz in (-1, 1)]
    return top, bot, holes


def make_tower():
    xs = P['xs']; yf = P['y_tab']; yb = yf - P['plate_t']
    top, bot, holes = servo_geom()
    ztop = max(z for _, z in holes) + 5.5
    t = box('servo_tower', xs - 14, xs + 14, yb, yf, 0, ztop)
    boolean(t, box('foot', xs - 20, xs + 20, -80, yb + 1.0, 0, P['plate_t']), 'UNION')
    for x0 in (xs - 20, xs + 16):
        boolean(t, prism_x(f'gus{x0}', [(yb + 1.0, P['plate_t'] - 1.0), (yb + 1.0, 70), (-80, P['plate_t'] - 1.0)], x0, x0 + 4), 'UNION')
    boolean(t, box('window', xs - P['sv_w'] / 2 - 0.25, xs + P['sv_w'] / 2 + 0.25, yb - 1, yf + 1, bot - 0.25, top + 0.25), 'DIFFERENCE')
    for i, (x, z) in enumerate(holes):
        boolean(t, rod(f'sh{i}', 1.7, (x, yb - 1, z), (x, yf + 1, z), seg=32), 'DIFFERENCE')
    for i, (x, y) in enumerate(tower_feet()):
        boolean(t, cyl(f'fh{i}', 1.7, -1, P['plate_t'] + 1, x, y, seg=32), 'DIFFERENCE')
    return t


def tower_feet():
    xs = P['xs']; return [(xs - 9, -52), (xs + 9, -52), (xs - 9, -74), (xs + 9, -74)]


# ───────────── base plate ─────────────
def make_base_plate():
    t = P['plate_t']; xs = P['xs']
    bp = box('base_plate', -30, 30, -30, 30, -t, 0)
    boolean(bp, box('strip', 0, xs + 24, -82, 30, -t, 0), 'UNION')
    # waste collector under seat 1 and the slots next to it
    x0, x1, yw = P['R'] - 17.0, P['R'] + 19.0, 16.0
    wall = box('wall', x0 - 2, x1 + 2, -yw - 2, yw + 2, -1.0, 3.5)
    boolean(wall, box('wi', x0, x1, -yw, yw, -1, 5), 'DIFFERENCE')
    boolean(bp, wall, 'UNION')
    boolean(bp, cyl('outlet', 4.75, -t - 1, 1, x1 - 7, 0, seg=64), 'DIFFERENCE')        # 9.5 mm tube / bulkhead
    # NEMA17
    boolean(bp, cyl('boss', 11.25, -t - 1, 1, seg=96), 'DIFFERENCE')
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = 15.5 * sx, 15.5 * sy
            boolean(bp, cyl(f'm{sx}{sy}', 1.7, -t - 1, 1, x, y, seg=32), 'DIFFERENCE')
            boolean(bp, cyl(f'mc{sx}{sy}', 3.25, -3.0, 1, x, y, seg=32), 'DIFFERENCE')
    # servo tower bolts with nut traps underneath
    for i, (x, y) in enumerate(tower_feet()):
        boolean(bp, cyl(f'tf{i}', 1.7, -t - 1, 1, x, y, seg=32), 'DIFFERENCE')
        boolean(bp, hexprism(f'tn{i}', 3.3, -t - 1, -t + 2.6, x, y), 'DIFFERENCE')
    # home sensor (Hall module) holes under the magnet track, and four mounting holes for the box
    hx, hy = seat_xy(0)[0], P['magnet_off'] + 2
    for dx in (-6, 6):
        boolean(bp, cyl(f'hall{dx}', 1.4, -t - 1, 1, hx + dx, hy, seg=24), 'DIFFERENCE')
    for i, (x, y) in enumerate([(-24, 24), (-24, -24), (xs - 26, -76), (xs - 26, 25)]):
        boolean(bp, cyl(f'mt{i}', 1.7, -t - 1, 1, x, y, seg=32), 'DIFFERENCE')
    return bp


# ───────────── export ─────────────
def export(o, fname, rot=None):
    """Copy o, rotate into print orientation, sit it on z = 0 and write an STL.
    Set POD_ASM=<folder> to also write each part in assembly position (for clash checks and renders)."""
    asm = os.environ.get('POD_ASM')
    if asm:
        os.makedirs(asm, exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.wm.stl_export(filepath=os.path.join(asm, fname), export_selected_objects=True, ascii_format=False)
    c = dup(o, o.name + '_print')
    if rot: c.rotation_euler = rot
    bpy.ops.object.select_all(action='DESELECT'); c.select_set(True); bpy.context.view_layer.objects.active = c
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    zmin = min(v.co.z for v in c.data.vertices)
    for v in c.data.vertices: v.co.z -= zmin
    path = os.path.join(OUT, fname)
    bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True, ascii_format=False)
    bpy.data.objects.remove(c, do_unlink=True)
    return path


if __name__ == '__main__' or True:
    clear()
    print('R', P['R'], 'rim diameter', 2 * P['rim_r'], 'split' if P['split'] else 'one piece', 'xs', P['xs'], 'Hs', P['Hs'])
    deck = make_deck()
    parts = []
    if P['split']:
        if P['seats'] != 8: raise SystemExit('quarters are laid out for 8 seats; use 8, or fewer seats for a one-piece carousel')
        hub = make_hub(); quarter = make_quarter(deck)
        parts += [(hub, 'carousel_hub.stl', None), (quarter, 'carousel_quarter.stl', None)]
    else:
        parts += [(make_one_piece(deck), 'carousel.stl', None)]
    bpy.data.objects.remove(deck, do_unlink=True)
    parts += [
        (make_nozzle_block(), 'nozzle_block.stl', None),                       # gasket face down, barbs up
        (make_arm(), 'nozzle_arm.stl', (math.pi / 2, 0, 0)),                    # horn face down
        (make_tower(), 'servo_tower.stl', (-math.pi / 2, 0, 0)),                # servo tab face down
        (make_base_plate(), 'base_plate.stl', None),
    ]
    for o, fn, rot in parts:
        print('export', export(o, fn, rot))
    print('done', {k: P[k] for k in ('R', 'rim_r', 'xs', 'Hs', 'zb', 'y_tab')})
