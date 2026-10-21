# eDNA Pod protocols

This file has two parts:

1. **[Field protocol](#1-field-protocol)** — what the team does, step by step, on a sampling trip.
2. **[Console ↔ Pod messages](#2-console--pod-messages-protocol-v3)** — a short summary; the full protocol is in [`firmware/README.md`](../firmware/README.md#console-protocol).

All numbers come from [`DECISIONS.md`](DECISIONS.md). If anything here disagrees with that file, `DECISIONS.md` wins.
"Approx." means estimated, not measured yet. The prototype is being built; tests run 8 Nov–15 Dec 2026.

---

## 1. Field protocol

### Mission layout (every mission)

| Seat | Use |
|---|---|
| 1 | **Field blank** — 1 L distilled water through the full water path. The console forces it first. |
| 2–7 | **6 real samples** — default 2 sites × 3 replicates (or 1 site × 6) |
| 8 | **Empty flush seat** — 250 mL of site water flushed to waste before the first sample at each site |

A mission is **1 blank + 6 samples + 1 flush seat**. Never call it "8 samples".

**Water path (pull-through):** intake → cartridge (filter) → pump → waste bottle on the load cell. The pump only sees filtered water, and a clog cannot burst a tube.

**Sample ID:** `CK-YYYYMMDD-SITE-SEAT` (for example `CK-20261206-AQ01-S3`; the field blank is `CK-20261206-BLANK-S1`), printed as a QR label.

### Before leaving (at school)

1. Clean the cartridges, funnels and tubing sets: 10% bleach for 10 min (no long soak), rinse 3× with distilled water, air-dry. Bag each set and label it with a site number.
2. With fresh gloves, fit a new sterile 47 mm, 0.45 µm MCE filter into each cartridge (1.2 µm if the water is known to be very muddy). Cap and bag them. Seat 8 stays empty.
3. Pack:
   - nitrile gloves (at least 3 pairs per sample; 10+ pairs per mission)
   - a bottle of fresh 10% bleach, labelled with the date it was made
   - distilled water for rinsing, plus 1 L for the field blank
   - ≥95% ethanol for the Pod's preservation pump (silica-gel tubes only for the paired test on 6 Dec)
   - one spare pre-bleached, bagged intake tube + funnel **per site**
   - the stainless mesh pre-filter and mesh bag for the intake
   - a cool box with ice packs
   - QR labels, tamper-evident seals, the custody form and a pencil datasheet
   - a bin bag for waste
4. Charge the Pod (approx. 2 missions per charge; take the spare pack for more). Load the mission and site list into the console and save it for offline use. Check the GPS fix and that the clock is set.
5. No fish or meat in lunches. Pets stay home. Wash boots and clothes.

### At the site

6. Approach from **downstream**. Choose flowing water mid-channel, below a confluence where possible. Write down upstream villages and farms on the datasheet.
7. **Stop rule:** do not sample in rising water or very muddy water (over about 300 NTU). Tether the Pod to the bank.
8. Spray the outside of the Pod and the nozzle with 10% bleach, wait 10 min, rinse with distilled water. Fit the **new bagged intake tube and funnel** for this site, with the mesh pre-filter.
9. Change gloves. At the first site only, run the **field blank** (seat 1): 1 L of distilled water through the full water path.
10. Flush **250 mL of site water** through the empty flush seat (seat 8) to waste. This replaces the about 7 mL of tube volume more than 30 times.

### Per sample (seats 2–7)

11. Change gloves. Place the intake just below the surface, away from the mud. Stand downstream of it.
12. Start the sample. The Pod stops at **1 L**, at **20 minutes**, or when flow drops below **20 mL/min**. A sample counts only if **at least 250 mL** went through. The load cell gives the real volume; write it down too.
13. After pumping, the Pod adds ≥95% ethanol to the filter. Cap the cartridge (tethered caps).
14. Scan the QR label so the console links the ID to GPS, time and sensor readings. Add the tamper-evident seal.
15. Take 3 replicates per site, then move to site 2 and repeat steps 6–14 (new tube set, bleach, 250 mL flush). Write pencil notes as you go.

### After (before leaving the site)

16. Bag all waste and take it home. Spray the Pod with bleach and rinse it. Bag the used tubing set to be cleaned at school.
17. Check that every sample ID is on both the datasheet and the console.

### Transport

18. Keep samples in the cool box, dark and out of the sun.
19. Freeze at −20 °C on return if they will not reach the lab within 2 weeks.
20. Ship the ethanol **with** the filter (some DNA leaks into it). Use Longmire's buffer instead if the lab asks.
21. Sign the custody form at every hand-over. Ship with the sample manifest and the custody form.

### Contamination rules

- **Gloves:** change before every cartridge and after touching anything else (bank, bag, phone, bleach). Never touch the filter or the inside of a cartridge.
- **Body:** stand downstream; don't talk or lean over an open cartridge.
- **Food and pets:** no food near the sampling point; no fish or meat in lunches; pets stay home.
- **Between sites:** new bagged, pre-bleached intake tube and funnel; 10% bleach on the nozzle for 10 min, then rinse; 250 mL site-water flush through seat 8.
- **Bleach:** spray or wipe for 10 min and rinse. Never leave printed parts, seals or tubing soaking.
- **Cartridges:** loaded at school, used once per mission, bleached and reused. The 20-cycle bleach test (by 8 Nov) decides how many times.
- **Blanks:** one field blank per mission (seat 1). Ask the lab for an extraction blank and a PCR blank per batch.
- **If the blank shows DNA:** flag every sample from that mission. A species found in the blank at a similar level is not counted. Find the cause (tubing, gloves, lab) before the next mission.
- **Red flags:** a species that cannot live in that stream (for example tuna in a rainforest creek) points to contamination.

### Reading results

| Result | Rule |
|---|---|
| **Confirmed** | Found in 2 or 3 of 3 replicates, and the blank is clean |
| **Possible** | Found in 1 of 3 replicates |
| **Not detected** | Not found — this is **not** proof the species is absent |

### Test schedule

| Date | Test |
|---|---|
| by 8 Nov | Bleach durability (20 cycles) and flow calibration |
| by 15 Nov | Usability test (5 classmates); lab partner and price locked; aquarium tank chosen |
| 20–25 Nov | Waterproofing bucket test (3 × 30 min) |
| 28 Nov–3 Dec | Dye leak / carry-over test (8 runs) |
| 1–5 Dec | Battery life test |
| 6 Dec | Aquarium test + dilution series + silica vs ethanol |
| 10 Dec | The Green Planet Dubai indoor rainforest |
| by 15 Dec | Ship 13 filters to the lab |

---

## 2. Console ↔ Pod messages (protocol v3)

**The full, authoritative message list is in [`firmware/README.md` → Console protocol](../firmware/README.md#console-protocol).**
If this summary and the firmware README disagree, the firmware README wins. The in-browser simulator (`js/sim.js`) speaks the same v3 protocol.

**Links:** one JSON object per line (UTF-8, `\n`) over USB serial (115200 8N1), Bluetooth LE (Nordic UART service, device `EDNA-01`,
20-byte chunks) or Wi-Fi (WebSocket `ws://192.168.4.1/ws`, open the console from the Pod).

**How the console runs a mission**

| Moment | Pod sends | Console does |
| --- | --- | --- |
| Connect | `hello` (`protocol: 3`, `layout {blank:1, flush:8, samples:[2..7]}`) | Sends `settime`; then `ping` every 2 min (over USB the Pod deep-sleeps after 10 idle minutes without it) |
| Start | — | Sends `start` with `{id, sites:[{code, name, lat?, lon?}] (1–2), rules?, flowMlMin?}`. The Pod fixes the layout itself |
| Field blank | `wait` `BLANK_WATER` | Shows the prompt; operator scans the blank label `CK-YYYYMMDD-BLANK-S1`; console sends `continue` |
| New site | `wait` `SITE` | Shows the cleaning steps; optional typed location → `setloc` (otherwise `setloc {clear:true}`); `continue`. The Pod flushes 250 mL through seat 8 |
| Before each sample | `step` `SEAL` | If that cartridge's label has not been scanned yet, the console sends `pause` and resumes after the scan (labels can be scanned ahead) |
| No GPS fix | `tele.fix = 0` | Console asks for the position and sends `setloc {lat, lon, label}`; the record gets `loc_source: MANUAL`, `hdop: "manual"` |
| Bottle / water / air | `wait` `EMPTY_BOTTLE` · `WATER` · `AIR` | Prompt + `continue` (or `continue {force:true}` if the sensor is wrong) |
| Each filter and flush | `sample` (record: `sample_id`, `role`, `site`, `replicate`, `volume_mL`, `stop_reason`, `valid`, `lat`, `lon`, `hdop`, `loc_source`, …) | Saves it on the phone/laptop; FLUSH records are kept with the mission, not as samples |
| End | `done` / `aborted` | Mission closed; samples ready for seals and a custody batch |
| Afterwards | `record` lines, `records_end` | "Copy records from Pod" reads `samples.csv` from the SD card into the registry |

Errors arrive as `err {code, msg}` (`CLOG`, `AIR`, `SEAT`, `HOME`, `LOWBAT`, `HOT`, `LEAK`, `BLANK`, `MISSION`, `SAVE`, `SD`, `SCALE`, `NOPROBE`, `BUSY`, `CMD`, `PARSE`);
the console shows each one as a warning, and `SAVE` asks for the record to be written on the paper sheet.

**Sample ID** (made by the Pod, printed as QR by the console): `CK-YYYYMMDD-SITE-S#` — the field blank uses `BLANK` as its site code
(`CK-20261206-BLANK-S1`); samples use the site code (`CK-20261206-AQ01-S3`). The date is the day the filter was taken, so print labels for the day you sample.
