# eDNA Collector Console

**Find the animals nobody can see — from one bottle of water.**

The eDNA Collector Console is the software that ships with the **eDNA Collector**, a plug-in sampling lab built by
**Team Canopy Keepers** (Dubai, UAE) for the FIRST LEGO League **BIOGLOW** 2026–27 season. It runs in any modern
browser, works offline once loaded, and needs no install or account.

## What it does

| Screen | What you can do |
| --- | --- |
| **Overview** | Live 3D twin of the collector, totals, recent samples and alerts |
| **Connect** | Link to the collector by Bluetooth, USB cable or Wi-Fi — or practise with the built-in simulator |
| **Mission planner** | Put sampling sites on a map, set the murky-water and volume rules, keep a field blank, schedule nightly or after-rain missions |
| **Live mission** | Watch every step in 3D: gantry, pumps, valves, tube rack; pH, turbidity, volume and battery gauges; drive pad; pause and safe-stop |
| **Sample registry** | Chain of custody for every tube, QR labels to print, lab-manifest CSV export |
| **Biodiversity** | Import the lab’s results, species per site, strongest DNA signals, watchlist alerts, blank-contamination alerts |
| **Calibration** | Pump wizard (5 runs, ±5 % check), pH two-point, turbidity zero, gantry slot map, backup and restore |
| **Help & safety** | Quick start, safety rules, team |

All data stays in the browser (export a backup from Calibration). Demo lab results are fictional and clearly labelled.

## Run it

- **Online:** open the GitHub Pages link for this repository.
- **Locally:** `python3 -m http.server` in this folder, then open `http://localhost:8000`.
- **From the collector:** upload these files to the ESP32 (see `firmware/README.md`), join the `EDNA-01` Wi-Fi and open `http://192.168.4.1`.

Bluetooth and USB links need Chrome or Edge. The simulator works everywhere.

## Inside

- `index.html`, `css/`, `js/` — the app (plain ES modules, no build step)
  - `device.js` — Bluetooth / USB / Wi-Fi / simulator links, one JSON-lines protocol
  - `sim.js` — software twin of the collector (same protocol as the firmware)
  - `scene.js` — Three.js 3D model driven by live telemetry
  - `mission.js`, `store.js`, `views.js`, `map.js`, `charts.js`, `main.js`
- `vendor/` — Three.js 0.160, GSAP 3.12, Leaflet 1.9, qrcode-generator 1.4 (bundled so it works offline)
- `firmware/` — ESP32 Arduino sketch + wiring (untested on hardware yet)
- `docs/PROTOCOL.md` — the message protocol · `docs/sample-results.csv` — example lab file

## Team

Araav · Arnav · Atharv · Dipayan · Gokul · Lakshanya · Jude Mugalian — FIRST LEGO League BIOGLOW 2026–27.

Map data © OpenStreetMap contributors. Libraries under their own licences (MIT / BSD-2 / GreenSock standard licence).
