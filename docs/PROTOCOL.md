# eDNA Pod protocol (v2)

The console and the eDNA Pod exchange **one JSON object per line** (UTF-8, `\n` terminated).
The same messages travel over every link:

| Link | Details |
| --- | --- |
| USB serial | 115200 baud, 8N1 |
| Bluetooth LE | Nordic UART Service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`; app writes to RX `6e400002-…`, device notifies on TX `6e400003-…`. Device name starts with `EDNA`. Writes are chunked to 20 bytes; the device re-assembles lines. |
| Wi-Fi | WebSocket at `ws://<pod>/ws`. Browsers block `ws://` from an `https://` page, so in Wi-Fi mode open the console from the Pod itself (`http://192.168.4.1`), which serves the same app from LittleFS. |
| Simulator | In-browser twin (`js/sim.js`) — speaks exactly this protocol. |

v2 replaces the v1 rover protocol (drive, gantry, arm, 50-tube rack) with the Pod's 8-seat carousel.

## App → Pod (`cmd`)

| Command | Fields | Effect |
| --- | --- | --- |
| `hello` | — | Device replies `hello` |
| `settime` | `ts` (ms since 1970) | Sets the clock (sent on every connect; GPS also sets it in the field) |
| `placed` | — | Operator confirms the Pod is staked at the site; mission moves from INDEX to TEST (`arrived` still accepted) |
| `start` | `mission` | Run a mission (see below) |
| `pause` / `resume` | — | Pause stops both pumps; resume continues |
| `abort` | — | Safe stop: pumps off, nozzle lifted; replies `aborted` |
| `home` | — | Home the carousel to seat 1 (magnet + switch) |
| `read` | — | Replies `raw` with probe voltages and temperature (for calibration) |
| `pump` | `which` (`S` sample / `E` ethanol), `seconds` | Run a pump for calibration; replies `pumped` |
| `setcal` | `ph {v7,v4}`, `ntuZeroV`, `mlPerS`, `carousel {seats, stepsPerSeat}` | Store calibration; replies `ack` |
| `schedule` | `mode` (`now`/`nightly`/`tide` = after rain at a time/`rain` = when the rain sensor stays wet), `time`, `tide`, `mission` | Store a mission to run on its own; replies `ack` |
| `speed` | `value` | Simulator only: time multiplier |

### Mission object

```json
{
  "id": "m_ab12cd",
  "sites": [{ "id": "site_a", "name": "Rainforest stream", "lat": 25.2069, "lon": 55.2618 }],
  "rules": { "ntuMurky": 40, "clearMl": 1000, "murkyMl": 500, "maxPumpS": 900, "primeMl": 34, "rinseMl": 34, "ethanolMl": 2, "blank": true },
  "tubeStart": 7,
  "mlPerS": 1.7,
  "carousel": { "seats": 8, "stepsPerSeat": 400 }
}
```

## Pod → app (`t`)

| Type | Fields |
| --- | --- |
| `hello` | `id`, `fw`, `seats`, `bat` |
| `tele` (4 Hz) | `state`, `site`, `tube`, `seat` (1–8), `press` (nozzle sealed 0/1), `bat` V, `ph`, `ntu`, `temp` °C, `ml`, `target`, `flow` mL/s, `cur` pump A, `pumpS`, `pumpE`, `rain` (0/1), `paused` |
| `step` | `n` (1–8), `name`, `site`, `siteName`, `tube` |
| `sample` | `mission`, `tube`, `seat`, `site`, `name`, `lat`, `lon`, `ts` (ms), `ml`, `target`, `ph`, `ntu`, `temp`, `blank`, `clog` — also appended to `samples.jsonl` on the SD card |
| `mission` | `id`, `sites`, `blank` — mission accepted |
| `done` | `mission`, `tubes` |
| `aborted` | `mission`, `msg` |
| `err` | `code` (`CLOG`, `BUSY`, `CMD`, `PARSE`, `HOME`, `LOWBAT`), `msg` |
| `log` | `msg` |
| `raw` | `phV`, `ntuV`, `temp` |
| `pumped` | `which`, `seconds` |
| `ack` | `cmd`, `ok`, `msg` |

## Mission steps

1 `SELFCHECK` → 2 `INDEX` → 3 `TEST` → 4 `PRIME` → 5 `SAMPLE` → 6 `PRESERVE` → 7 `LOG` → 8 `RINSE`, repeated per site.

- **INDEX** turns cartridge `tube` to seat `(tube − 1) % 8 + 1` under the nozzle and waits for `placed` (scheduled and rain missions skip the wait).
- **SAMPLE** presses the nozzle down, then pumps. It stops at the target volume, at `maxPumpS`, or when pump current rises 0.25 A above its steady value (filter clogging). The real volume is always reported.
- **PRESERVE** drains for 3 s, then runs the ethanol pump for `ethanolMl`.

When `rules.blank` is true, a field blank (bottled water, 250 mL) goes into its own cartridge first.
Volume is time-based: `ml = seconds × mlPerS` (from the pump calibration).
