# eDNA Pod firmware (ESP32)

`edna_collector/edna_collector.ino` runs the eDNA Pod. It talks to the eDNA Collector Console over
USB serial, Bluetooth LE and Wi-Fi (protocol below), and it can also run a whole mission **without
the console** using the START button and the status LED.

All pins and tunable numbers are in **`edna_collector/config.h`**. The agreed values come from
[`../docs/DECISIONS.md`](../docs/DECISIONS.md). If the two ever disagree, DECISIONS.md wins.

> **Status:** firmware 3.0.0 compiles for `esp32:esp32:esp32` (core 2.0.17) but **has not been tested on real hardware yet.**
> Bring it up one part at a time (order below). Numbers marked "approx." in `config.h` must be measured.

## What a mission does

| Order | Seat | Role | What happens |
| --- | --- | --- | --- |
| 1 | 1 | `BLANK` | Field blank: 1 L distilled water, **always first**. The firmware refuses to run any sample until the blank is done. |
| 2 | 8 | `FLUSH` | 250 mL of site A water through the empty seat 8 to waste (no filter). |
| 3–5 | 2, 3, 4 | `SAMPLE` | Site A, replicates 1–3. |
| 6 | 8 | `FLUSH` | 250 mL of site B water. |
| 7–9 | 5, 6, 7 | `SAMPLE` | Site B, replicates 1–3. |

With one site, seats 2–7 are 6 replicates of that site (blank → flush → 6 samples).

**Plumbing (pull-through):** intake → cartridge (filter) → nozzle → sample pump → waste bottle on the load cell.
The pump only touches filtered water, and suction can't burst a tube.

**Stop rule for every filter:** stop at **1 L** (`VOLUME`), after **20 min** of pumping (`TIME`), or when the flow
drops below **20 mL/min** (`CLOG` or `AIR`). A sample only counts (`valid`) if **≥ 250 mL** went through.

**Each job:** `MOVE` (nozzle up, carousel turns forward, hall sensor must see the seat's magnet) → `WAIT` (only if
the Pod needs you) → `SEAL` (servo presses the nozzle down) → `PUMP` → `PRESERVE` (drain 3 s, then ≥95% ethanol
from the second pump; not for flushes) → `LOG` (record saved and checked).

### How volume, clog and air are measured

- **Volume:** HX711 + 1 kg load cell under the waste bottle. 1 g of water = 1 mL. The Pod notes the bottle
  weight at the start of each filter and subtracts it. If the HX711 is missing or not calibrated
  (`scalecal` not done yet), volume = pump time × calibrated flow (`flowMlMin`), and the record says `TIME`.
- **Bottle full:** a 1 kg cell can't weigh more than 1 kg, so before each filter the Pod checks that the bottle
  has room for the planned volume. If not, it waits (`EMPTY_BOTTLE`) until you empty it. A 5 kg cell
  (`LOADCELL_MAX_G = 5000`) means emptying much less often.
- **Clog:** pump current (INA219) more than 0.25 A **above** this filter's normal current (measured 5–15 s after
  start) for 5 s, or flow < 20 mL/min with normal/high current.
- **Air / dry intake:** pump current 0.08 A **below** normal for 5 s, the float switch dry for 5 s, or low flow with
  low current. The Pod stops the pump and waits up to 2 min for you to put the intake back (press START).
  If you don't, the filter ends with `AIR`. For the blank, air just means the distilled-water bottle is empty,
  so it ends straight away.
- The flow rule needs the load cell. Without it, only the current and float rules can stop a filter early.

### Carousel check

There is a magnet under **every** seat, and a **double magnet** under seat 1 (home). Homing turns slowly and
measures how long each magnet keeps the hall sensor on. The long one is seat 1. After **every** move the hall
sensor must see a magnet. If not, the Pod re-homes and retries once; if it still fails, it **aborts safely**
(pumps off, nozzle up, driver off) so no filter is ever used in the wrong seat.
The A4988 is switched off with its EN pin whenever the carousel is not moving (saves about 10 Wh per mission).

### Safety cut-offs

- **Battery heat:** DS18B20 taped to the pack. At **55 °C** everything stops. A new mission can't start until it
  is below 50 °C.
- **Low battery:** below **9.9 V** (3.3 V per cell) for 5 s while running, the mission stops. A mission won't start
  below 10.5 V. On USB-only power (battery switch off, reading < 3 V) these checks are skipped for bench work.
- **Floor leak sensor** (the old rain pad, on the box floor): warns once per mission.
- Any abort writes a record for a filter that already had water through it (`stop_reason` = `ABORT`).

### Data safety

Every filter **and** every flush writes one record:
- `samples.csv` on the **SD card**, plus `samples.jsonl` (same data as JSON) — flushed and closed straight away;
- `samples.csv` in the ESP32's own **flash (LittleFS)** as a mirror;
- each write is **read back and compared**. If any copy fails, the Pod sends `err` `SAVE`. Write it on the paper sheet.

Get the data back with the `records` command, by Wi-Fi at `http://192.168.4.1/samples.csv`, or by reading the SD card.

### Clock and location

- **DS3231 RTC** with a coin cell keeps time while the Pod is off. Records use the RTC time (Dubai, `+04:00`).
- When the GPS has a fix, its satellite time is copied into the RTC (at most once an hour). The console's
  `settime` is used only if the GPS has not set the clock since power-on.
- The GPS position is **averaged while the pump runs**, with the average HDOP. If there is no fix (indoors, e.g. The
  Green Planet), the record uses the manual location from `setloc`, or else the site's lat/lon from the mission,
  and `hdop` is `"manual"`.

### Power saving

- The **sensor rail** (GPS, turbidity, pH, leak pad) is switched off while you walk between sites, and while idle
  with no console connected. It comes back on when you confirm the next site.
- While waiting for you, the CPU drops to 80 MHz (`SLOW_CPU_WHEN_WAITING`).
- **Deep sleep:** after 10 idle minutes with no console (`idleSleepMin`, 0 = never), the Pod sleeps (about 10 µA for
  the chip; the dev board's regulator uses more). The stepper driver and pumps are held OFF while asleep.
  Press START to wake it.
- We don't use light sleep. It would drop the Bluetooth/Wi-Fi link to the console, and the ESP32 can't light-sleep
  while it is a Wi-Fi access point. Deep sleep is used when idle instead.

## START button and status LED (no console needed)

| You do | Pod does |
| --- | --- |
| Short press while idle | Starts the last mission the console sent (saved in flash), or a default **2 sites × 3** mission (`ST01`, `ST02`) |
| Short press while the LED double-blinks | "Done, carry on": confirms the blank bottle, the site, the emptied bottle, or the intake back in water |
| Short press after done / error | Clears the LED back to "ready" |
| **Hold 3 s** during a mission | Safe stop (pumps off, nozzle up, record saved) |
| Press while asleep | Wakes up; press again to start |

LED patterns (each one repeats every 2 seconds):

| Pattern | Meaning |
| --- | --- |
| short blip every 2 s | Ready, idle |
| on all the time | Moving or pumping, leave it alone |
| 2 blinks | Waiting for you. Do the job (see the console or the list above), then press START |
| 3 blinks | Intake is out of the water. Put it back and press START |
| slow on/off (1 s) | Paused from the console |
| 3 long blinks then a gap | Mission finished |
| fast flashing | Stopped with an error. Check the console log, then press START to clear |

## Board and libraries

- Board: **ESP32 Dev Module** (Arduino-ESP32 core 2.0.x), Partition scheme: **No OTA (2MB APP/2MB SPIFFS)**.
  The sketch is about 1.25 MB, too big for the 1.2 MB app slot in *Default 4MB with spiffs*.
- Library Manager: **ArduinoJson 7**, **NimBLE-Arduino 1.4.x**, **ESPAsyncWebServer** + **AsyncTCP**, **AccelStepper**,
  **ESP32Servo**, **Adafruit INA219**, **Adafruit ADS1X15**, **RTClib** (Adafruit), **HX711** (by Rob Tillaart),
  **OneWire**, **DallasTemperature**, **TinyGPSPlus**.
- Compile from the command line:
  `arduino-cli compile -b esp32:esp32:esp32:PartitionScheme=no_ota firmware/edna_collector`
  (copy `secrets.example.h` to `secrets.h` first).

## Wiring / pin map

| Part | Part pin | ESP32 pin | Note |
| --- | --- | --- | --- |
| START button | one side | 35 | other side to GND; **10 kΩ pull-up to 3.3 V** (35 has no internal pull-up). Also wakes from deep sleep |
| Float switch (intake) | signal | 39 | 10 kΩ pull-up to 3.3 V; LOW = in water |
| HX711 (load cell amp) | DT / SCK | 36 / 15 | VCC 3.3 V. 1 kg load cell under the waste bottle |
| Turbidity (fallback only) | divider out | 34 | used **only if the ADS1115 is missing** |
| Hall sensor (A3144/KY-003) | OUT | 26 | internal pull-up; LOW = magnet |
| DS18B20 × 2 (water + battery pack) | DQ | 4 | one bus, 4.7 kΩ pull-up to 3.3 V, powered from 3.3 V **always on** |
| GPS NEO-6M | TX | 16 | UART2, 9600 baud. GPS RX not connected. Powered from the switched sensor rail |
| Sensor-rail switch | gate / EN | 17 | high-side switch for GPS + turbidity + pH + leak pad (see below) |
| Status LED | + (via 330 Ω) | 2 | the DevKit's blue LED is on the same pin |
| MicroSD | CS / SCK / MISO / MOSI | 5 / 18 / 19 / 23 | power from 5 V |
| A4988 | STEP / DIR / EN | 25 / 33 / 32 | EN HIGH = off between moves. Motor power 11.1 V, 100 µF across it |
| MG996R servo | signal | 13 | power from its **own 5–6 V 3 A UBEC**, ground joined to the ESP32 |
| Sample pump | D4184 SIG | 14 | logic-level MOSFET module (PWM), **flyback diode** across the pump |
| Ethanol pump (≥95% ethanol) | D4184 SIG | 27 | logic-level MOSFET module, flyback diode across the pump |
| INA219 | SDA / SCL | 21 / 22 | I2C 0x40, in series with the 11.1 V pump rail (measures battery V and pump current) |
| ADS1115 (16-bit ADC) | SDA / SCL | 21 / 22 | I2C 0x48, **powered from 3.3 V** |
| DS3231 RTC + CR2032 | SDA / SCL | 21 / 22 | I2C 0x68 (its EEPROM is 0x57) |

ADS1115 inputs:

| Channel | Sensor | Note |
| --- | --- | --- |
| A0 | Turbidity SEN0189 (0–4.5 V out) | through a **10 kΩ / 20 kΩ divider** → max 3.0 V |
| A1 | pH board (optional) | through a 10 kΩ / 20 kΩ divider |
| A2 | Floor leak pad (old rain sensor) | pad powered from the sensor rail |
| A3 | spare | planned vacuum-pressure sensor |

**Why the divider stays even with the ADS1115:** the ADS1115 runs at 3.3 V so its I2C lines are safe for the
ESP32, and an input must never go above its supply. The divider turns 4.5 V into 3.0 V. The ADS1115 then reads
it much more accurately than the ESP32's own ADC. **Fallback:** without an ADS1115, wire the same divider output
to pin 34. Turbidity still works (less accurately), but pH and the leak pad read `NA`.

**Magnets:** 8 × (8×5 mm) magnets, one under every seat, all at the same radius over the hall sensor.
Seat 1 gets **two magnets side by side** (a longer "on" window = home). Use the `seat` command to check every
seat, and the homing log to see that only seat 1 is found as home. Adjust `HOME_SPAN_MIN_STEPS` if needed.

**Power:** 3 × 18650 (3S BMS, 11.1 V) → **fuse + main switch** → pumps (via D4184) and the A4988.
LM2596 set to **5.0 V before connecting anything** → ESP32 5 V pin, SD card, turbidity sensor rail.
The **servo has its own 5–6 V 3 A UBEC** (a stall draws about 2.5 A); re-size the main fuse after measuring.
**Sensor-rail switch:** a high-side P-MOSFET (e.g. AO3401 with a 10 kΩ gate pull-up to the rail and a small NPN
driven from pin 17), or a load-switch module. HIGH on pin 17 = sensors ON (change `SENSOR_PWR_ON_LEVEL` if yours is
the other way round). The pull-up keeps sensors OFF while the ESP32 sleeps or resets. Don't use a low-side
(ground) switch for the GPS: its data line would still power it through the ESP32 pin.
**Battery probe:** tape a DS18B20 to the middle cell of the pack. Find which probe is which with `probes`, then
put the addresses into `config.h`. Join every ground.

## Bring-up order

1. Copy `secrets.example.h` to `secrets.h`, flash, open Serial Monitor at 115200. You should see a `log` line with
   `eDNA Pod 3.0.0 ready …` and which parts were found. Type `{"cmd":"hello"}` and check `hw`.
2. **Clock:** with the console connected the clock is set automatically. Or wait for a GPS fix outside.
3. **Pumps:** `{"cmd":"pump","which":"S","seconds":3}`, then `{"cmd":"pump","which":"E","seconds":3}`.
4. **Load cell:** empty bottle on, `{"cmd":"tare"}`. Put a known weight (e.g. 500 g of water) in it, then
   `{"cmd":"scalecal","grams":500}`. Check `{"cmd":"read"}` shows `grams` close to 500.
5. **Flow calibration** (by 8 Nov): `{"cmd":"pump","which":"S","seconds":60}` with a filter fitted. With the load cell
   the reply includes `flowMlMin`. Save it with `{"cmd":"setcal","flowMlMin":75}` (this is the fallback if the load cell fails).
6. **Probes:** `{"cmd":"probes"}`, then hold the battery probe in your hand to see which one warms up.
7. **Sensors:** `{"cmd":"read"}` returns probe volts, NTU, pH, temperatures, grams, hall, float, leak.
8. **Carousel:** `{"cmd":"home"}`, then `{"cmd":"seat","n":2}` … `{"cmd":"seat","n":8}`. Every seat must reply `ok:true`.
   Run 100 moves for the reliability test and count `SEAT` errors.
9. **Servo:** tune `SERVO_DOWN` so the gasket just squashes without stalling, `SERVO_UP` about 20° higher.
10. **Clog/air:** block a filter and lift the intake during a bench run. Watch `cur` in telemetry and adjust
    `CLOG_AMPS_RISE` / `AIR_AMPS_DROP`.
11. **Button-only mission** over a bucket, then a console mission over USB.

## Serving the console from the Pod (Wi-Fi mode)

Browsers block `ws://` connections from an `https://` page, so for Wi-Fi the console must be opened from the
Pod itself. Copy `console.html`, `css/`, `js/`, `vendor/`, `assets/` and `docs/` into `edna_collector/data/` and
upload them with the *ESP32 LittleFS Data Upload* tool.
The full folder is about 3 MB, more than the 2 MB data partition, so copy only what the console uses
(`console.html`, `css/`, `js/`, `assets/`, `vendor/gsap`, `vendor/leaflet`, `vendor/qrcode`,
`vendor/three/three.module.js` and `vendor/three/addons`) and gzip each file (`gzip -9 file`). The web server
sends the `.gz` copy automatically, and the whole console is then about 410 KB. Then join the Wi-Fi network `EDNA-01`
(the password you set in `secrets.h`) and open `http://192.168.4.1`. The flash copy of the data is at
`http://192.168.4.1/samples.csv`. **Uploading a new data folder erases it, so download it first.**

## Console protocol

Protocol version **3** (firmware 3.0.0). One JSON object per line (UTF-8, `\n` terminated), the same on every link:

| Link | Details |
| --- | --- |
| USB serial | 115200 baud, 8N1 |
| Bluetooth LE | Nordic UART Service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`; app writes to RX `6e400002-…`, Pod notifies on TX `6e400003-…`. Device name `EDNA-01`. Lines are sent in 20-byte chunks; join them until `\n`. |
| Wi-Fi | WebSocket `ws://192.168.4.1/ws` (open the console from the Pod) |

**Changes from v2** (docs/PROTOCOL.md describes v2):
- Mission layout is fixed: blank seat 1 → (flush seat 8 → samples) per site. `tubeStart`, `rules.blank`,
  `ntuMurky`, `clearMl`, `murkyMl`, `maxPumpS`, `primeMl`, `rinseMl` are **ignored**. `sites` must have **1 or 2** entries.
- `step` names are new: `IDLE SELFCHECK MOVE WAIT SEAL PUMP AIR_WAIT PRESERVE LOG` (no more INDEX/TEST/PRIME/RINSE).
- New `wait` message tells the console what the Pod is waiting for. Answer it with `continue` (`placed` still works).
- `sample` has new snake_case record fields (below). The old v2 keys are still included for now.
- `tele` is sent **2×/s** (was 4×), and not while the carousel is turning. Many numbers can be `null` (sensor missing / off).
- `schedule` mode `rain` is removed (the rain pad is now the floor leak sensor). `ack ok:false`.
- New commands: `continue`, `ping`, `seat`, `tare`, `scalecal`, `setloc`, `records`, `probes`, `sleep`.
- The Pod deep-sleeps after 10 idle minutes **unless a console is connected**. BLE and WebSocket connections count
  automatically. **Over USB serial, send any command (e.g. `ping`) at least every 5 minutes** to keep it awake.

### App → Pod (`cmd`)

| Command | Fields | Effect / reply |
| --- | --- | --- |
| `hello` | — | `hello` |
| `ping` | — | `pong` `{ms}`. Keeps the Pod awake over USB |
| `settime` | `ts` (ms since 1970, UTC) | Sets RTC + clock, unless GPS already set it since power-on. `ack ok:false` if `ts` is bad |
| `start` | `mission` (below) | Validates and runs a mission → `mission`, then `step`s. Bad mission → `err MISSION`. Also saved for the START button |
| `continue` | `force` (optional bool) | Answers the current `wait`. `force:true` skips the float-switch check (`WATER`, `AIR`) or the bottle-full check (`EMPTY_BOTTLE`) |
| `placed` / `arrived` / `emptied` | `force` (optional) | Same as `continue` (old names kept) |
| `pause` / `resume` | `resume` may take `force` | Pause stops both pumps; pumping time stops too. `resume` during `AIR_WAIT` = `continue`. Resuming during PRESERVE redoes the ethanol dose |
| `abort` | — | Safe stop: pumps off, nozzle up, driver off; a used filter still gets a record (`ABORT`) → `aborted` |
| `home` | — | (idle) Find seat 1 → `ack` `{cmd:"home", ok}` |
| `seat` | `n` (1–8) | (idle) Move to seat n and check its magnet → `ack` `{cmd:"seat", ok, seat}` |
| `read` | — | Turns the sensor rail on if needed (waits ~3 s) → `raw` |
| `pump` | `which` (`S` sample / `E` ethanol), `seconds` (1–600) | (idle) Run a pump → `pumped` |
| `setcal` | any of: `ph {v7, v4}`, `ntuZeroV`, `flowMlMin` (or v2 `mlPerS`), `carousel {stepsPerSeat}`, `hxScale`, `idleSleepMin` | Saved in flash → `ack` |
| `tare` | — | Empty waste bottle on the load cell = 0 g, saved → `ack` |
| `scalecal` | `grams` | Known weight in the bottle → sets the load-cell scale, saved → `ack` `{hxScale}` |
| `setloc` | `lat`, `lon`, `label` (optional) — or `clear:true` | Manual location used when there is no GPS fix → `ack` |
| `records` | `from`: `"sd"` (default) or `"flash"` | (idle) Streams `samples.csv` → many `record`, then `records_end` |
| `probes` | — | Lists DS18B20 probes → `probes` |
| `sleep` | — | (idle) Deep sleep now. START button wakes it |
| `schedule` | `mode` (`now`/`nightly`/`tide`), `time` / `tide` ("HH:MM"), `mission` | Stores a mission to start on its own (skips the blank/site waits, still waits for bottle and water) → `ack` |
| `speed` | `value` | Simulator only |

### Mission object

```json
{
  "id": "m_ab12cd",
  "sites": [
    { "code": "AQ01", "name": "Aquarium tank", "lat": 25.2069, "lon": 55.2618 },
    { "code": "GP01", "name": "Green Planet stream" }
  ],
  "rules": { "targetMl": 1000, "blankMl": 1000, "flushMl": 250, "maxMin": 20,
             "minFlowMlMin": 20, "minValidMl": 250, "ethanolMl": 2 },
  "flowMlMin": 80,
  "carousel": { "stepsPerSeat": 400 }
}
```

- `sites`: **1 or 2.** 2 sites → 3 replicates each (seats 2–4, 5–7); 1 site → 6 replicates (seats 2–7).
- `code` is used in the sample ID: letters and digits only, max 8, upper-cased (falls back to `id`, then `ST01`…).
  `lat`/`lon` are optional; they are used only if there is no GPS fix and no `setloc`.
- `rules` are all optional. Leave them out to use the DECISIONS.md values above. They are only for bench tests.
- `flowMlMin` (or v2 `mlPerS`) and `carousel.stepsPerSeat` are optional calibration; if sent they are saved.

### Pod → app (`t`)

| Type | Fields |
| --- | --- |
| `hello` | `id`, `fw`, `protocol` (3), `seats` (8), `bat`, `hw {ina219, ads1115, rtc, rtcValid, hx711, hxCal, sd, flash, waterProbe, batProbe}`, `layout {blank:1, flush:8, samples:[2..7]}` |
| `pong` | `ms` |
| `mission` | `id`, `sites` (count), `blank` (always true), `source` (`console`/`button`/`schedule`), `jobs` [`{role, seat, site, rep}`…] |
| `step` | `n` (state number), `name` (state), and during a mission: `job` (1-based), `jobs`, `role`, `seat`, `site` (code), `siteName`, `rep`, `tube` (= seat, v2) |
| `wait` | `for`: `BLANK_WATER` (put intake in the 1 L distilled bottle) · `SITE` (at the new site: new intake tube, bleach nozzle, intake in water) · `EMPTY_BOTTLE` · `WATER` (float dry before pumping) · `AIR` (pumping air, waits 2 min); `msg` (text to show), `seat`, `site`. Answer with `continue` |
| `tele` (2 Hz) | `state`, `wait` (as above or null), `job`, `jobs`, `role`, `siteCode`, `site` (name), `rep`, `seat`, `tube` (= seat), `press` (0/1), `blankDone`, `samples`, `bat` V, `batTemp` °C, `cur` pump A, `ph`, `ntu`, `temp` water °C, `ml` (this filter), `target`, `pumpSec`, `flowMlMin`, `flow` (mL/s, v2), `grams` (bottle), `volSrc` (`SCALE`/`TIME`), `pumpS`, `pumpE`, `float` (1 = wet), `leak`, `rain` (= leak, v2), `paused`, `sensors` (rail on), `fix`, `hdop`, `sats`, `manualLoc`, `clock` (ISO local time or "") |
| `sample` | One per BLANK, FLUSH and SAMPLE. **Record fields** (below) + `site_name`, `sats`, `loc_label`, `ethanol_mL`, `fw`, `saved_sd`, `saved_flash` + v2 keys `tube`, `name`, `ts` (ms), `ml`, `target`, `ph`, `ntu`, `temp`, `blank`, `clog` |
| `done` | `mission`, `samples` (sample filters run), `valid` (≥ 250 mL), `blank` (blank done), `tubes` (v2: samples + blank) |
| `aborted` | `mission`, `msg`, `samples`, `valid`, `blank`, `tubes` |
| `err` | `code`, `msg`. Codes: `CLOG` and `AIR` (a filter stopped early, info), `SEAT` (magnet missing), `HOME`, `LOWBAT`, `HOT` (battery ≥ 55 °C), `LEAK`, `BLANK` (sample refused, blank not done), `MISSION` (bad mission), `SAVE` (a copy failed to save/verify), `SD`, `SCALE`, `NOPROBE`, `BUSY`, `CMD`, `PARSE` |
| `log` | `msg` |
| `raw` | `phV`, `ntuV` (sensor-side volts), `ntu`, `ph`, `temp`, `batTemp`, `grams`, `hall`, `float`, `leak`, `ads` |
| `pumped` | `which`, `seconds`, and with the load cell `grams`, `flowMlMin` |
| `ack` | `cmd`, `ok`, `msg` (+ `seat` for `seat`, `hxScale` for `scalecal`) |
| `record` | `src` (`sd`/`flash`), `line` (one CSV line, the first is the header) |
| `records_end` | `src`, `n` |
| `probes` | `list` [`{addr, c, role}`] (`role`: `water`, `battery` or `?`) |

Unknown sensor values are `null` in JSON and `NA` in the CSV.

### Record fields (`sample` message and `samples.csv`)

| Field | Example | Meaning |
| --- | --- | --- |
| `sample_id` | `CK-20261206-AQ01-S3` | `CK-YYYYMMDD-SITE-SEAT` (date = local start date; `00000000` if the clock is not set; blank uses `BLANK`) |
| `mission` | `m_ab12cd` | mission id |
| `seat` | `3` | 1–8 |
| `role` | `SAMPLE` | `BLANK` / `SAMPLE` / `FLUSH` |
| `site` | `AQ01` | site code (`BLANK` for the blank) |
| `replicate` | `2` | 1–3 (1–6 with one site); 0 for blank and flush |
| `start_time`, `end_time` | `2026-12-06T10:15:02+04:00` | from the DS3231 RTC; empty if the clock was never set |
| `volume_mL` | `840` | volume through the filter |
| `target_mL` | `1000` | 1000 (blank and samples) or 250 (flush) |
| `stop_reason` | `CLOG` | `VOLUME` / `TIME` / `CLOG` / `AIR` / `ABORT` |
| `valid` | `true` (CSV `1`) | sample/blank: ≥ 250 mL. Flush: reached 250 mL |
| `volume_source` | `SCALE` | `SCALE` (load cell) or `TIME` (pump time × flow) |
| `pump_s` | `655` | seconds the pump actually ran |
| `lat`, `lon` | `25.206912` | GPS average while pumping, or manual / mission position |
| `hdop` | `1.4` or `"manual"` | average HDOP of the GPS fixes, `"manual"` when the position was typed in, null if none |
| `loc_source` | `GPS` | `GPS` / `MANUAL` (setloc) / `MISSION` (site lat/lon) / `NONE` |
| `temp_C` | `26.3` | water temperature, average while pumping (null for the blank) |
| `turbidity_NTU` | `12.5` | average while pumping, rough (null for the blank) |
| `pH` | `7.12` | average while pumping (null for the blank or without pH/ADS1115) |
| `battery_V` | `11.42` | at the end of the filter |
| `battery_temp_C` | `31.0` | pack temperature at the end |

CSV header (`samples.csv`, same on SD and flash):

```
sample_id,mission,seat,role,site,replicate,start_time,end_time,volume_mL,target_mL,stop_reason,valid,volume_source,pump_s,lat,lon,hdop,loc_source,temp_C,turbidity_NTU,pH,battery_V,battery_temp_C,fw
```

## Known limits

- Not yet tested on hardware. All thresholds (clog/air current, home magnet span, flow) are first guesses.
- Turbidity is a rough, relative reading until it is compared with a lab meter (mid-December).
- With a 1 kg load cell you must empty the waste bottle before nearly every filter. The Pod asks you to.
- Scheduled missions are experimental: they skip the blank-bottle and site waits, so they don't follow the agreed field method.
- Sample IDs repeat if the same site code is sampled twice on the same day with the same seat. Use a new site code.
- Homing and the `seat`/`read` commands block for a few seconds, and commands wait until they finish.
