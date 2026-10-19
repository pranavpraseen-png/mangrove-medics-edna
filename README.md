# eDNA Collector · the eDNA Pod

**Find the animals nobody can see — from one bottle of water.**

The **eDNA Pod** is a 22 cm canister (about 2.5 kg) built by **Team Canopy Keepers** (Dubai, UAE) for the FIRST LEGO
League **BIOGLOW** 2026–27 season. Staked beside a rainforest stream, or under the canopy with its rain funnel, it
pumps water through a 0.45 µm filter, preserves the filter with ethanol and logs where and when. An 8-seat carousel
gives 8 samples per trip. This repository is the software that ships with it.

- **Website** (`index.html`): the public story — scroll animation, the Pod taken apart in 3D, a live simulator, the sampling-site map and the species database.
- **Console** (`console.html`): the app that runs the Pod.

## Console screens

| Screen | What you can do |
| --- | --- |
| **Overview** | Live 3D twin of the Pod, totals, recent samples and alerts |
| **Connect** | Link to the Pod by Bluetooth, USB cable or Wi-Fi — or practise with the built-in simulator |
| **Mission planner** | Put sampling sites on a map, set the murky-water and volume rules, keep a field blank, schedule nightly, after-rain or rain-sensor missions |
| **Live mission** | Watch every step in 3D: carousel, sealing nozzle, both pumps; pH, turbidity, volume, battery, pump current and temperature; "Pod in place" button; pause and safe-stop |
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

- `index.html`, `console.html`, `css/`, `js/` — plain ES modules, no build step
  - `device.js` — Bluetooth / USB / Wi-Fi / simulator links, one JSON-lines protocol
  - `sim.js` — software twin of the Pod (same protocol as the firmware)
  - `scene.js` — Three.js model of the Pod driven by live telemetry
  - `site.js` (website), `mission.js`, `store.js`, `views.js`, `map.js`, `charts.js`, `main.js`
- `vendor/` — Three.js 0.160, GSAP 3.12, Lenis 1.1, Leaflet 1.9, qrcode-generator 1.4 (bundled so it works offline)
- `firmware/` — ESP32 Arduino sketch + wiring (untested on hardware yet)
- `docs/PROTOCOL.md` — the message protocol · `docs/sample-results.csv` — example lab file

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

Map data © OpenStreetMap contributors. Libraries under their own licences (MIT / BSD-2 / GreenSock standard licence).
