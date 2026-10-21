# eDNA Pod — test cartridge (v1)

Two printed parts hold one 47 mm, 0.45 µm MCE filter (Cobetter). Water comes in through the cap's cone, passes through the filter and leaves through the hole in the bottom. In the **pull-through** design the sample pump is connected *after* this outlet (intake → cartridge → pump → waste), so the cartridge is under gentle suction, not pressure.

Agreed values are in [`../../docs/DECISIONS.md`](../../docs/DECISIONS.md); field steps in [`../../docs/PROTOCOL.md`](../../docs/PROTOCOL.md).

## Design changes (v2, agreed October 2026)

- **1.2 µm compatible seat:** the seat must also take 47 mm **1.2 µm** filters (backup for muddy water, which can clog 0.45 µm filters at 0.25–1 L). Same 47 mm diameter — check the seat depth and O-ring squeeze still seal with the thicker filter and test both on muddy water.
- **Outlet barb for the pump:** the bottom hole becomes a barb or Luer outlet so the pump can pull through it, and the cartridge must not collapse or leak air under suction.
- **100 % infill + epoxy:** print at 100 % infill with 0.12–0.16 mm layers and brush an epoxy coat (XTC-3D) inside, so no water or DNA hides in layer lines.
- **Tethered caps:** cap and outlet plugs on a tether so they can't be dropped in the field.
- **Reuse:** cartridges are loaded at school with a new sterile filter, used once per mission, then bleached (10% for 10 min, no long soak), rinsed and reused. The 20-cycle bleach test (by 8 Nov) decides the lifetime. Use EPDM or silicone O-rings if nitrile shows wear.
- **Magnet:** each carousel seat now has a magnet under it (double at seat 1) — see [`../pod`](../pod).

| File | What it is |
|---|---|
| `cartridge_base.stl` | The cup: filter seat, O-ring groove, support fins, funnel, drain hole, outside thread |
| `cartridge_cap.stl` | The screw-on cap: inside thread, clamping lip, cone inlet for the nozzle. Already flipped for printing |
| `cartridge.blend` | Blender file with both parts, a filter and an O-ring, plus the cap in print position |
| `make_cartridge.py` | The Blender script that builds the parts. Change the numbers at the top and run it again |
| `preview_*.png` | Renders |

## Sizes

- Base: 58 mm across, 34 mm tall. Cap: 67 mm across the grip ribs, 15.5 mm tall.
- Thread: 56 mm, 3 mm pitch, 0.45 mm gap per side.
- Filter seat: 47.6 mm wide, 2 mm deep.
- O-ring: **42 × 2 mm nitrile** (about 42 mm inside, 2 mm thick). It sits in the groove under the filter's edge.
- Inlet cone: 10 mm wide at the top, 3.5 mm hole.

## Printing (school printer)

- **Material:** PETG. PLA is fine for the first fit test, but it is not watertight enough for real samples.
- **Base:** print upright, flat bottom on the bed. **Cap:** print as it comes in the file, flat top on the bed.
- No supports, for both parts.
- First fit test: layer height 0.2 mm, 4 walls, 30 % infill, 6 top and bottom layers.
- **Real-sample cartridges:** 100 % infill, 0.12–0.16 mm layers, then an epoxy coat inside.
- PETG: about 235 °C nozzle, 80 °C bed. Slow the outer walls to 30 mm/s so the thread comes out clean.
- Time: about 2.5 h for the base and 1.5 h for the cap, depending on the printer.

## First test

1. Screw the cap on with no filter. It should turn by hand without forcing. If it is tight, set `fit_clear` to 0.55 in the script, rebuild and print again.
2. Put the O-ring in its groove, lay a filter on top, and screw the cap down firmly by hand.
3. Leak test: pull 500 mL of tap water through with the pump on the outlet (pull-through), at full speed. No air should be drawn in at the thread, and water should only come out of the outlet.
4. Repeat with a 1.2 µm filter in the seat.
5. If it leaks at the edge, change `oring_depth` to 1.3 so the O-ring squeezes harder, and print again.

Write down every change and photograph each version for the Engineering Notebook.
