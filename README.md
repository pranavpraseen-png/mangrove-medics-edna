# eDNA Collector · the eDNA Pod

**Find the animals nobody can see — from one bottle of water.**

The **eDNA Pod** is a hand-carried canister (about 2.5 kg) built by **Team Canopy Keepers** (The Indian High School,
Dubai, UAE) for the FIRST LEGO League **BIOGLOW** 2026–27 season. Carried to a rainforest stream, it pulls water through
a 47 mm, 0.45 µm filter, preserves the filter with ≥95% ethanol and logs where, when and how much. A lab then reads
which species left their DNA behind. This repository holds the website, the console app, the firmware and the 3D-printed parts.

**Status (October 2026):** the prototype is being built. Nothing has been lab-tested yet. Tests run **8 Nov–15 Dec 2026**
(see below). Numbers marked "approx." are estimates.

**Agreed values live in [`docs/DECISIONS.md`](docs/DECISIONS.md)** — the single source of truth. The field steps are in
[`docs/PROTOCOL.md`](docs/PROTOCOL.md).

## The Pod in one table

| | |
| --- | --- |
| Mission | Seat 1 = field blank (1 L distilled water) · seats 2–7 = **6 real samples** (2 sites × 3 replicates) · seat 8 = empty flush seat. Never "8 samples". |
| Water path | Pull-through: intake → cartridge (filter) → pump → waste bottle on a load cell |
| Volume | Target 1 L per filter. Stops at 1 L, 20 min, or flow below 20 mL/min. Counts only if ≥250 mL |
| Preservation | ≥95% ethanol, shipped with the filter (Longmire's if the lab asks); silica gel tested 6 Dec |
| Between sites | New bagged, pre-bleached intake tube + funnel; 10% bleach on the nozzle for 10 min, rinse; 250 mL site-water flush through seat 8 |
| Results | **Confirmed** = 2–3 of 3 replicates + clean blank · **possible** = 1 of 3 · **not detected** ≠ absent |
| Battery | 3S 18650 (approx. 26 Wh usable): approx. **2 missions per charge**, about 4 with a spare pack |
| Cost | Approx. **AED 1,710** for the Pod (47 parts). Commercial eDNA samplers: about USD 7,500–11,000 |
| Sample ID | `CK-YYYYMMDD-SITE-SEAT`, e.g. `CK-20261206-AQ01-S3`, as a QR label |

## Test schedule

| Date | Test |
| --- | --- |
| by 8 Nov | Bleach durability (20 cycles) and flow calibration |
| by 15 Nov | Usability test (5 classmates); lab partner and price locked; aquarium tank chosen |
| 20–25 Nov | Waterproofing bucket test (3 × 30 min) |
| 28 Nov–3 Dec | Dye leak / carry-over test (8 runs) |
| 1–5 Dec | Battery life test |
| 6 Dec | Aquarium test + dilution series + silica vs ethanol |
| 10 Dec | The Green Planet Dubai indoor rainforest |
| by 15 Dec | Ship 13 filters to the lab |

## In this repository

- **Home page** (`index.html`, live at [canopy-keepers.vercel.app](https://canopy-keepers.vercel.app)): the long scroll page — scroll animation, the Pod taken apart in 3D, the mission in numbers, the testing timeline, a live simulator, the sampling-site map and the species database.
- **One-page summary** (`summary.html`): a short, fast version for judges and sponsors — no JavaScript, one web font. Linked from the home page footer.
- **Console** (`console.html`): the app that runs the Pod. The 3D model loads only when needed: on wide screens when it scrolls into view, on phones after **Show 3D model** is pressed. Leaflet and the QR library also load on demand.

## Console screens

| Screen | What you can do |
| --- | --- |
| **Overview** | Live 3D twin of the Pod, totals, recent samples and alerts |
| **Connect** | Link to the Pod by Bluetooth, USB cable or Wi-Fi — or practise with the built-in simulator |
| **Mission planner** | Put sampling sites on a map, set the murky-water and volume rules, keep a field blank, schedule nightly, after-rain or rain-sensor missions |
| **Live mission** | Watch every step in 3D: carousel, sealing nozzle, both pumps; pH, turbidity, volume, battery, pump current and temperature; "Pod in place" button; pause and safe-stop; **Demo run (judges)** runs one 100 mL cartridge in about 2 minutes, on the Pod or the simulator |
| **Sample registry** | Chain of custody for every cartridge, carousel map, QR labels, lab-manifest CSV export |
| **Biodiversity** | Import the lab's results, species per site, strongest DNA signals, watchlist and blank-contamination alerts |
| **Calibration** | Pump wizard (5 runs, ±5 % check), pH two-point, turbidity zero, carousel steps, backup and restore |
| **Help & safety** | Quick start, safety rules, team |

All data stays in the browser (export a backup from Calibration). Demo lab results are fictional and clearly labelled.

## Run it

- **Online:** open the GitHub Pages link for this repository.
- **Locally:** `python3 -m http.server` in this folder, then open `http://localhost:8000`.
- **From the Pod:** upload these files to the ESP32 (see `firmware/README.md`), join the `EDNA-01` Wi-Fi and open `http://192.168.4.1`.

Bluetooth and USB links need Chrome or Edge. The simulator works everywhere.

## Inside

- `index.html` (+ `css/site.css`, `js/site.js`), `summary.html` (+ `css/home.css`), `console.html`, `css/`, `js/` — plain ES modules, no build step
  - `device.js` — Bluetooth / USB / Wi-Fi / simulator links, one JSON-lines protocol
  - `sim.js` — software twin of the Pod (same protocol as the firmware)
  - `scene3d.js` — Three.js model of the Pod driven by live telemetry; `scene.js` — light stand-in that loads it on demand
  - `site.js` (website), `mission.js`, `store.js`, `views.js`, `map.js`, `charts.js`, `main.js`
- `vendor/` — Three.js 0.160, GSAP 3.12, Lenis 1.1, Leaflet 1.9, qrcode-generator 1.4 (bundled so it works offline)
- `firmware/` — ESP32 Arduino sketch + wiring (untested on hardware yet)
- `hardware/pod/`, `hardware/cartridge/` — Blender scripts, STLs and build notes for the carousel, nozzle and cartridges (including the v2 design changes)
- `docs/DECISIONS.md` — agreed values and test schedule (single source of truth)
- `docs/PROTOCOL.md` — the field protocol, then the console ↔ Pod message protocol · `docs/sample-results.csv` — example lab file

## Team

| Member | Role |
| --- | --- |
| Pranav Praseen | Team Captain |
| Aarav Muralidharan | Project Manager |
| Arnav | Researcher |
| Atharv | Builder |
| Dipayan Saha | Builder · Coder |
| Gokul Charan Chetty Umapathi | Core Values · Robot Design |
| Lakshanya Devidas Mehatkar | Coder |
| Mugilan G Srinivasan | Core Values |
| Jude Raphael Peter | Innovation Project |

## Supported by

- **[Besomi Electronics](https://besomi.com/)** — parts sponsor, and our first sponsor. Thank you for the voucher that covered our GPS module, turbidity sensor, float switch and power parts.

We are looking for a university lab partner and more sponsors.

Map data © OpenStreetMap contributors. Libraries under their own licences (MIT / BSD-2 / GreenSock standard licence).
