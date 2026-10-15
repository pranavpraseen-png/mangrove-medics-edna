# eDNA Collector protocol (v1)

The console and the collector exchange **one JSON object per line** (UTF-8, `\n` terminated).
The same messages travel over every link:

| Link | Details |
| --- | --- |
| USB serial | 115200 baud, 8N1 |
| Bluetooth LE | Nordic UART Service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`; app writes to RX `6e400002-…`, device notifies on TX `6e400003-…`. Device name starts with `EDNA`. Writes are chunked to 20 bytes; the device re-assembles lines. |
| Wi-Fi | WebSocket at `ws://<collector>/ws`. Browsers block `ws://` from an `https://` page, so in Wi-Fi mode open the console from the collector itself (`http://192.168.4.1`), which serves the same app from LittleFS. |
| Simulator | In-browser twin (`js/sim.js`) — speaks exactly this protocol. |

## App → collector (`cmd`)

| Command | Fields | Effect |
| --- | --- | --- |
| `hello` | — | Device replies `hello` |
| `settime` | `ts` (ms since 1970) | Sets the collector’s clock (sent on every connect; needed for schedules) |
| `drive` | `l`, `r` (−255…255), `ms` | Manual driving; stops after `ms` unless repeated. Ultrasonic stop still applies |
| `arrived` | — | Operator confirms the collector is at the site; mission moves from DRIVE to TEST |
| `start` | `mission` | Run a mission (see below) |
| `pause` / `resume` | — | Pause stops pumps and closes valves; resume continues |
| `abort` | — | Safe stop: pumps off, valves closed, arm raised; replies `aborted` |
| `home` | — | Home the gantry |
| `read` | — | Replies `raw` with probe voltages (for calibration) |
| `pump` | `which` (`S` sample / `R` rinse), `seconds` | Run a pump for calibration; replies `pumped` |
| `setcal` | `ph {v7,v4}`, `ntuZeroV`, `mlPerS`, `gantry` | Store calibration; replies `ack` |
| `schedule` | `mode` (`now`/`nightly`/`tide` = after rain), `time`, `tide` (after-rain run time), `mission` | Store a mission to run on a timer; replies `ack` |
| `speed` | `value` | Simulator only: time multiplier |

### Mission object

```json
{
  "id": "m_ab12cd",
  "sites": [{ "id": "site_a", "name": "Rainforest stream", "lat": 25.2069, "lon": 55.2618 }],
  "rules": { "ntuMurky": 40, "clearMl": 1000, "murkyMl": 500, "maxPumpS": 600, "primeMl": 100, "rinseMl": 100, "blank": true },
  "tubeStart": 7,
  "mlPerS": 8.5,
  "gantry": { "cols": 10, "rows": 5, "x0": 20, "y0": 20, "dx": 18, "dy": 18 }
}
```

## Collector → app (`t`)

| Type | Fields |
| --- | --- |
| `hello` | `id`, `fw`, `slots`, `bat` |
| `tele` (4 Hz) | `state`, `site`, `tube`, `bat` V, `ph`, `ntu`, `ml`, `target`, `flow` mL/s, `pumpS`, `pumpR`, `vW`, `vF` (0/1), `gx`, `gy` mm, `dist` cm, `arm`, `drive`, `paused` |
| `step` | `n` (1–8), `name`, `site`, `siteName`, `tube` |
| `sample` | `mission`, `tube`, `site`, `name`, `lat`, `lon`, `ts` (ms), `ml`, `target`, `ph`, `ntu`, `blank`, `clog` |
| `mission` | `id`, `sites`, `blank` — mission accepted |
| `done` | `mission`, `tubes` |
| `aborted` | `mission`, `msg` |
| `err` | `code` (`CLOG`, `BUSY`, `CMD`, `PARSE`, `OBSTACLE`, `LOWBAT`), `msg` |
| `log` | `msg` |
| `raw` | `phV`, `ntuV` |
| `pumped` | `which`, `seconds` |
| `ack` | `cmd`, `ok`, `msg` |

## Mission steps

1 `SELFCHECK` → 2 `DRIVE` → 3 `TEST` → 4 `PRIME` → 5 `SAMPLE` → 6 `SEAL` → 7 `LOG` → 8 `RINSE`, repeated per site.
When `rules.blank` is true, a field blank (clean water from the rinse tank, 250 mL) is taken first into its own tube.

Volume is time-based: `ml = seconds × mlPerS` (from the pump calibration). Sampling stops at the target, at `maxPumpS`, or when flow drops below 15 % (clog) — the real volume is always reported.
