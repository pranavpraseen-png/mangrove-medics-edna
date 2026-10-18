"""
eDNA Pod — test cartridge (Canopy Keepers, FLL BIOGLOW 2026–27)
Builds two printable parts in Blender and exports them:
  1. cartridge_base  — cup: 47 mm filter seat, O-ring groove, finned filter support, funnel, bottom drain hole,
                       external M56 x 3 thread
  2. cartridge_cap   — screw-on clamp ring: internal thread, clamping lip, conical inlet the nozzle seals onto
All units are millimetres (1 Blender unit = 1 mm).

Run inside Blender (Scripting tab → Open → Run Script) or headless:
  blender --background --python make_cartridge.py
Edit the numbers in PARAMS to adjust fit, then run again.
"""
import bpy, bmesh, math, os

PARAMS = dict(
    filter_d=47.0,        # membrane diameter
    seat_clear=0.6,       # extra diameter around the filter
    seat_depth=2.0,
    oring_r_in=21.0, oring_r_out=23.0, oring_depth=1.5,   # face groove for a 2 mm cross-section O-ring, about 42 mm ID
    body_r=29.0, body_h=24.0,
    core_r=26.5, thread_len=10.0, pitch=3.0, thread_depth=1.5,
    fit_clear=0.45,       # radial clearance between the two threads (raise to 0.55 if it is too tight)
    chamber_r=20.0, drain_r=2.0,
    fins=8, fin_t=1.6,
    cap_r=32.0, cap_plate=4.0, lip_drop=1.8,
    inlet_top_r=5.0, inlet_hole_r=1.75,
    seg=128,
)
P = PARAMS
OUT = os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else bpy.path.abspath('//')


def clear():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)


def cyl(name, r, z0, z1, seg=None):
    seg = seg or P['seg']
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=z1 - z0, location=(0, 0, (z0 + z1) / 2))
    o = bpy.context.active_object; o.name = name; return o


def cone(name, r0, r1, z0, z1, seg=None):
    seg = seg or P['seg']
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r0, radius2=r1, depth=z1 - z0, location=(0, 0, (z0 + z1) / 2))
    o = bpy.context.active_object; o.name = name; return o


def box(name, sx, sy, sz, loc, rot_z=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.name = name; o.scale = (sx, sy, sz); o.rotation_euler[2] = rot_z
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); return o


def helix_thread(name, r_root, r_tip, z0, length, pitch, steps_per_turn=96):
    """Closed helical solid with a trapezoid profile; root at r_root, tip at r_tip (works for inner or outer threads)."""
    turns = length / pitch
    n = int(turns * steps_per_turn) + 1
    half_root, half_tip = 0.42 * pitch, 0.12 * pitch
    prof = [(r_root, -half_root), (r_tip, -half_tip), (r_tip, half_tip), (r_root, half_root)]
    bm = bmesh.new(); rings = []
    for i in range(n):
        t = i / steps_per_turn; a = 2 * math.pi * t; zc = z0 + half_root + t * pitch
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), zc + dz)) for r, dz in prof])
    for i in range(n - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(4):
            bm.faces.new((A[k], A[(k + 1) % 4], B[(k + 1) % 4], B[k]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); return o


def boolean(target, tool, op):
    m = target.modifiers.new('b', 'BOOLEAN'); m.operation = op; m.object = tool; m.solver = 'EXACT'
    bpy.context.view_layer.objects.active = target; bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(tool, do_unlink=True)


def make_base():
    zt = P['body_h'] + P['thread_len']                 # top face
    seat_r = (P['filter_d'] + P['seat_clear']) / 2
    floor = zt - P['seat_depth']                       # filter rests here
    base = cyl('cartridge_base', P['body_r'], 0, P['body_h'] + 0.01)
    boolean(base, cyl('core', P['core_r'], P['body_h'], zt), 'UNION')
    # filter seat pocket and O-ring face groove
    boolean(base, cyl('seat', seat_r, floor, zt + 1), 'DIFFERENCE')
    groove = cyl('g', P['oring_r_out'], floor - P['oring_depth'], floor + 0.2)
    boolean(groove, cyl('gi', P['oring_r_in'], floor - P['oring_depth'] - 1, floor + 1), 'DIFFERENCE')
    boolean(base, groove, 'DIFFERENCE')
    # chamber under the filter, 45° funnel and drain hole (prints upright with no supports)
    ch_bot = floor - 12.0
    boolean(base, cyl('ch', P['chamber_r'], ch_bot, floor + 0.01), 'DIFFERENCE')
    f_h = P['chamber_r'] - P['drain_r']
    boolean(base, cone('fun', P['drain_r'], P['chamber_r'], ch_bot - f_h, ch_bot + 0.01), 'DIFFERENCE')
    boolean(base, cyl('drain', P['drain_r'], -1, ch_bot - f_h + 0.5), 'DIFFERENCE')
    # filter support: radial fins + one ring, tops flush with the seat floor
    r0, r1 = 3.6, P['chamber_r'] + 0.3
    for i in range(P['fins']):
        a = i * 2 * math.pi / P['fins'] + math.pi / P['fins']
        rm = (r0 + r1) / 2
        boolean(base, box(f'fin{i}', r1 - r0, P['fin_t'], 11.99, (rm * math.cos(a), rm * math.sin(a), floor - 6.0), a), 'UNION')
    ring = cyl('sr', 12.6, floor - 6.0, floor); boolean(ring, cyl('sri', 11.4, floor - 7, floor + 1), 'DIFFERENCE')
    boolean(base, ring, 'UNION')
    boolean(base, cyl('hub', 3.0, floor - 12.0, floor + 1), 'DIFFERENCE')   # keep the centre open over the drain
    # thread last: the exact boolean solver is happiest when the helix is added to a finished body
    t_out = P['core_r'] + P['thread_depth']
    th = helix_thread('t', P['core_r'] - 0.3, t_out, P['body_h'] + 0.6, P['thread_len'] - 1.4 - 0.84 * P['pitch'], P['pitch'])
    boolean(base, th, 'UNION')
    return base, zt, floor


def make_cap(zt, floor):
    bore = P['core_r'] + P['thread_depth'] + P['fit_clear']
    z0 = P['body_h'] + 0.3          # skirt stops just above the base's shoulder
    top = zt + P['cap_plate']
    cap = cyl('cartridge_cap', P['cap_r'], z0, top)
    boolean(cap, cyl('bore', bore, z0 - 1, zt), 'DIFFERENCE')
    th = helix_thread('ti', bore + 0.3, P['core_r'] + P['fit_clear'], z0 + 0.6, (zt - z0) - 1.4 - 0.84 * P['pitch'], P['pitch'])
    boolean(cap, th, 'UNION')
    # clamping lip presses the filter edge onto the O-ring
    seat_r = (P['filter_d'] + P['seat_clear']) / 2
    lip = cyl('lip', seat_r - 0.4, zt - P['lip_drop'], zt + 0.01)
    boolean(lip, cyl('lipi', P['oring_r_in'] - 0.5, zt - 3, zt + 1), 'DIFFERENCE')
    boolean(cap, lip, 'UNION')
    # conical inlet: the nozzle's silicone gasket seals into this cone
    boolean(cap, cone('inlet', P['inlet_hole_r'], P['inlet_top_r'], top - 3.0, top + 0.01), 'DIFFERENCE')
    boolean(cap, cyl('inh', P['inlet_hole_r'], zt - 1, top - 2.9), 'DIFFERENCE')
    # grip ribs
    for i in range(24):
        a = i * 2 * math.pi / 24
        boolean(cap, box(f'rib{i}', 2.0, 1.6, top - z0 - 2, (math.cos(a) * (P['cap_r'] + 0.5), math.sin(a) * (P['cap_r'] + 0.5), (z0 + top) / 2), a), 'UNION')
    return cap


def export(o, fname):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    path = os.path.join(OUT, fname)
    if hasattr(bpy.ops.wm, 'stl_export'):
        bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True, ascii_format=False)
    else:
        bpy.ops.export_mesh.stl(filepath=path, use_selection=True)
    return path


if __name__ == '__main__' or True:
    clear()
    base, zt, floor = make_base()
    cap = make_cap(zt, floor)
    export(base, 'cartridge_base.stl')
    # the cap prints upside down (flat top on the bed): export it flipped and sitting on z = 0
    bpy.ops.object.select_all(action='DESELECT'); cap.select_set(True); bpy.context.view_layer.objects.active = cap
    cap_print = cap.copy(); cap_print.data = cap.data.copy(); bpy.context.collection.objects.link(cap_print)
    cap_print.name = 'cartridge_cap_print'; cap_print.rotation_euler[0] = math.pi
    bpy.context.view_layer.objects.active = cap_print; bpy.ops.object.select_all(action='DESELECT'); cap_print.select_set(True)
    bpy.ops.object.transform_apply(rotation=True)
    zmin = min(v.co.z for v in cap_print.data.vertices); cap_print.location.z = -zmin
    bpy.ops.object.transform_apply(location=True)
    export(cap_print, 'cartridge_cap.stl')
    cap_print.location.x = 80   # park it beside the assembly in the .blend
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'cartridge.blend'))
    print('done', zt, floor)
