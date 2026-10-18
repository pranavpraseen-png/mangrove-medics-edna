# eDNA Pod — test cartridge (v1)

Two printed parts hold one 47 mm, 0.45 µm filter. Water comes in through the cap's cone, passes through the filter and drains out of the hole in the bottom.

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
- Layer height 0.2 mm, 4 walls, 30 % infill, 6 top and bottom layers.
- PETG: about 235 °C nozzle, 80 °C bed. Slow the outer walls to 30 mm/s so the thread comes out clean.
- Time: about 2.5 h for the base and 1.5 h for the cap, depending on the printer.

## First test

1. Screw the cap on with no filter. It should turn by hand without forcing. If it is tight, set `fit_clear` to 0.55 in the script, rebuild and print again.
2. Put the O-ring in its groove, lay a filter on top, and screw the cap down firmly by hand.
3. Leak test: push 500 mL of tap water in through the cone at full pump speed. Water should only come out of the bottom hole.
4. If it leaks at the edge, change `oring_depth` to 1.3 so the O-ring squeezes harder, and print again.

Write down every change and photograph each version for the Engineering Notebook.
