# eDNA Collector firmware (ESP32)

`edna_collector/edna_collector.ino` runs the collector and talks to the eDNA Collector Console over
USB serial, Bluetooth LE and Wi-Fi using the protocol in [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md).

> **Status:** written to match the team’s parts list, **not yet tested on real hardware.** Bring it up one
> subsystem at a time (order below) and fix pin numbers, servo angles and positions on the real build.

## Board and libraries

- Board: **ESP32 Dev Module** (Arduino-ESP32 core 2.0.x or newer), Partition scheme: *Default 4MB with spiffs* (LittleFS uses it).
- Install from Library Manager: **ArduinoJson 7**, **NimBLE-Arduino 1.4.x**, **ESPAsyncWebServer** + **AsyncTCP**,
  **Adafruit PWM Servo Driver**, **Adafruit SSD1306** + **Adafruit GFX**, **Adafruit ADS1X15**, **AccelStepper**.

## Wiring

| Function | Part | ESP32 pin |
| --- | --- | --- |
| Left motors | L298N #1 ENA / IN1 / IN2 | 25 / 26 / 27 |
| Right motors | L298N #2 ENB / IN3 / IN4 | 14 / 32 / 33 |
| Sample pump | Relay 1 (active LOW) | 4 |
| Rinse pump | Relay 2 | 16 |
| Waste valve | Relay 3 | 17 |
| Filter valve | Relay 4 | 5 |
| Gantry X | STEP / DIR | 18 / 19 |
| Gantry Y | STEP / DIR | 23 / 2 |
| Home switches | X / Y (to GND, 10 kΩ pull-up to 3.3 V) | 34 / 35 |
| Ultrasonic ×2 | shared TRIG | 15 |
| Ultrasonic echo | left / right (**5 V → 3.3 V divider**) | 36 / 39 |
| Flow sensor YF-S201 | signal (cross-check only) | 13 |
| I²C bus | SDA / SCL | 21 / 22 |
| Servo board | PCA9685 @ 0x40 — ch0 shoulder, ch1 elbow, ch2 gripper turn, ch3 gripper lift, ch4 jaw | I²C |
| Display | SSD1306 128×64 @ 0x3C | I²C |
| Analog | ADS1115 @ 0x48 — A0 pH, A1 turbidity, A2 battery (30k/10k divider) | I²C |

Power: 12 V battery → **fuse + main switch** → L298Ns, pumps, valves, gantry drivers. A **5 V buck sized for all
servos moving at once** feeds the PCA9685 servo rail and the ESP32 5 V pin. Join every ground. The ESP32 pins only
send signals. Keep all boards in the IP65 box above the waterline.

## Bring-up order

1. Flash, open Serial Monitor at 115200 — you should see `{"t":"log","msg":"eDNA Collector 1.0.0 ready …"}`.
   Type `{"cmd":"hello"}` and press Enter.
2. **Relays:** `{"cmd":"pump","which":"S","seconds":3}` — the sample pump and waste valve click on, then off.
3. **Sensors:** `{"cmd":"read"}` returns probe voltages. Calibrate in the console (Calibration page).
4. **Gantry:** `{"cmd":"home"}`. Then adjust `STEPS_PER_MM`, slot map and the station positions at the top of the sketch.
5. **Servos:** tune `ARM_*`, `LIFT_*`, `JAW_*` angles so nothing hits the frame.
6. **Drive:** `{"cmd":"drive","l":150,"r":150,"ms":500}` — wheels turn half a second.
7. Connect the console by **USB** (Chrome/Edge → Connect → USB cable) and run a one-site mission over a bucket.

## Serving the console from the collector (Wi-Fi mode)

Browsers block `ws://` connections from an `https://` page, so for Wi-Fi the console must be opened from the
collector itself. Copy the console files (`index.html`, `css/`, `js/`, `vendor/`, `docs/`) into
`edna_collector/data/` and upload them with the *ESP32 LittleFS Data Upload* tool. Then join the Wi-Fi network
`EDNA-01` (password in the sketch) and open `http://192.168.4.1`.

## Known limits

- Driving is manual (console arrow pad) with ultrasonic stop; the operator confirms arrival at each site. A GPS
  module is a planned upgrade.
- Long BLE messages are sent in 20-byte chunks; on slow links telemetry can delay gantry moves slightly — use USB
  during sealing tests.
- Turbidity conversion (`readWater`) is a starting estimate; calibrate against known samples.
