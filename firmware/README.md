# eDNA Pod firmware (ESP32)

`edna_collector/edna_collector.ino` runs the eDNA Pod and talks to the eDNA Collector Console over
USB serial, Bluetooth LE and Wi-Fi using the protocol in [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md).

> **Status:** written to match the Pod parts list in the team's "Flow" doc, **not yet tested on real hardware.**
> Bring it up one subsystem at a time (order below) and fix servo angles and steps on the real build.

## Board and libraries

- Board: **ESP32 Dev Module** (Arduino-ESP32 core 2.0.x or newer), Partition scheme: *Default 4MB with spiffs* (LittleFS uses it).
- Install from Library Manager: **ArduinoJson 7**, **NimBLE-Arduino 1.4.x**, **ESPAsyncWebServer** + **AsyncTCP**,
  **AccelStepper**, **ESP32Servo**, **Adafruit INA219**, **OneWire**, **DallasTemperature**, **TinyGPSPlus**.

## Wiring

| Part | Part pin | ESP32 pin | Note |
| --- | --- | --- | --- |
| Turbidity sensor | analog out | 34 | 10 kΩ / 20 kΩ divider (sensor gives up to 4.5 V) |
| Rain sensor | AO | 35 | power from 3.3 V |
| pH kit (optional) | Po | 36 | divider |
| Float switch | signal | 39 | input-only pin: 10 kΩ pull-up to 3.3 V |
| Home switch | signal | 26 | internal pull-up; magnet under seat 1 |
| DS18B20 | data | 4 | 4.7 kΩ pull-up to 3.3 V |
| INA219 | SDA / SCL | 21 / 22 | in series with the 11.1 V pump rail |
| GPS NEO-6M | TX / RX | 16 / 17 | UART2, 9600 baud |
| MicroSD | CS / SCK / MISO / MOSI | 5 / 18 / 19 / 23 | power from 5 V |
| A4988 | STEP / DIR / EN | 25 / 33 / 32 | motor power 11.1 V, 100 µF across it |
| MG996R servo | signal | 13 | power from the 5 V buck, not the ESP32 |
| Sample pump MOSFET | SIG | 14 | PWM |
| Ethanol pump MOSFET | SIG | 27 | PWM |

Power: 3 × 18650 (3S BMS, 11.1 V) → **2 A fuse + main switch** → pumps and stepper driver. An **LM2596 set to
5.0 V before connecting anything** feeds the servo, SD card and the ESP32 5 V pin. Join every ground.
IRF520 modules only half switch on at 3.3 V; if a pump runs weak, swap to logic-level (D4184 / AOD4184) modules.

## Bring-up order

1. Flash, open Serial Monitor at 115200 — you should see `{"t":"log","msg":"eDNA Pod 2.0.0 ready …"}`.
   Type `{"cmd":"hello"}` and press Enter.
2. **Pumps:** `{"cmd":"pump","which":"S","seconds":3}` then `{"cmd":"pump","which":"E","seconds":3}`.
3. **Sensors:** `{"cmd":"read"}` returns probe voltages and temperature. Calibrate in the console (Calibration page).
4. **Carousel:** `{"cmd":"home"}` — it turns until the magnet reaches the switch. Then check `STEPS_PER_SEAT` lands every seat under the nozzle (test 3: 80 moves).
5. **Servo:** tune `SERVO_UP` / `SERVO_DOWN` so the nozzle presses 6–8 mm into the gasket without stalling.
6. **Clog detection:** run a muddy sample and note the pump current in telemetry (`cur`); adjust `CLOG_AMPS_RISE`.
7. Connect the console by **USB** (Chrome/Edge → Connect → USB cable) and run a one-site mission over a bucket.

## Serving the console from the Pod (Wi-Fi mode)

Browsers block `ws://` connections from an `https://` page, so for Wi-Fi the console must be opened from the
Pod itself. Copy `console.html`, `css/`, `js/`, `vendor/`, `assets/` and `docs/` into `edna_collector/data/` and
upload them with the *ESP32 LittleFS Data Upload* tool. Then join the Wi-Fi network `EDNA-01` (the password you set in
`secrets.h`; copy `secrets.example.h` to `secrets.h` first, it is never committed) and open `http://192.168.4.1`.

## Known limits

- Volume is time-based (pump calibration), so recalibrate if the tubing is changed.
- Turbidity conversion (`readWater`) and the rain threshold are starting estimates; calibrate on the real sensors.
- 8 seats per carousel; swap in a fresh carousel when the console says it is full.
