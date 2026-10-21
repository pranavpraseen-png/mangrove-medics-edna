// ═══════════════════════════════════════════════════════════════════════════
//  config.h — every pin and every number you might want to change.
//  Team Canopy Keepers eDNA Pod. Values come from docs/DECISIONS.md.
//  "approx." = estimate, change it after you measure on the real Pod.
// ═══════════════════════════════════════════════════════════════════════════
#pragma once

// ───────────── Pin map (ESP32 DevKit, 38-pin) ─────────────
// Pins 34, 35, 36 and 39 are INPUT ONLY and have NO internal pull-up,
// so anything on them that needs a pull-up gets a 10 kΩ resistor to 3.3 V.
#define PIN_START_BTN     35   // START button to GND + 10 kΩ pull-up to 3.3 V (also wakes the Pod from deep sleep)
#define PIN_FLOAT         39   // intake float switch, 10 kΩ pull-up; LOW = intake is in water
#define PIN_HX711_DT      36   // HX711 load-cell amplifier DT (data out)
#define PIN_TURB_FALLBACK 34   // turbidity divider output, used ONLY if the ADS1115 is missing
#define PIN_HALL          26   // hall sensor (A3144 / KY-003), internal pull-up; LOW = magnet under it
#define PIN_ONEWIRE        4   // both DS18B20 probes (water + battery pack), 4.7 kΩ pull-up to 3.3 V
#define PIN_GPS_RX        16   // ← GPS TX (we never send to the GPS, so GPS RX is not wired)
#define PIN_SENSOR_PWR    17   // switch for GPS + turbidity + pH + leak sensor power (high-side switch)
#define PIN_HX711_SCK     15   // HX711 SCK
#define PIN_LED            2   // status LED (the DevKit's blue LED is on this pin too) + 330 Ω
#define PIN_SD_CS          5   // microSD on VSPI: SCK 18, MISO 19, MOSI 23
#define PIN_STEP          25   // A4988 STEP
#define PIN_DIR           33   // A4988 DIR
#define PIN_EN            32   // A4988 EN: LOW = driver on, HIGH = off (we keep it off between moves)
#define PIN_SERVO         13   // MG996R signal (servo power comes from its own 5–6 V 3 A UBEC)
#define PIN_PUMP_SAMPLE   14   // D4184 logic-level MOSFET module → sample pump (after the filter)
#define PIN_PUMP_ETHANOL  27   // D4184 logic-level MOSFET module → ethanol pump (≥95% ethanol)
#define PIN_SDA           21   // I2C: INA219 0x40, ADS1115 0x48, DS3231 0x68 (+ its EEPROM 0x57)
#define PIN_SCL           22

// Levels
#define HALL_ACTIVE_LEVEL   LOW
#define FLOAT_WET_LEVEL     LOW
#define SENSOR_PWR_ON_LEVEL HIGH   // HIGH turns the sensor rail ON. Change to LOW if your switch is active-low.

// ADS1115 channels (16-bit ADC, powered from 3.3 V)
#define ADS_CH_TURBIDITY 0   // turbidity, through the 10k/20k divider (4.5 V → 3.0 V)
#define ADS_CH_PH        1   // optional pH board, through a 10k/20k divider
#define ADS_CH_LEAK      2   // floor leak sensor (the old rain-sensor pad, now on the box floor)
                             // channel 3 is spare (planned vacuum-pressure sensor)
const float DIVIDER_GAIN   = 1.5f;   // 10k top / 20k bottom: real volts = measured volts × 1.5
const float LEAK_WET_VOLTS = 1.6f;   // pad output below this = wet (tune in testing)

// ───────────── Mission layout (DECISIONS.md) ─────────────
const int SEATS             = 8;
const int SEAT_BLANK        = 1;     // field blank: 1 L distilled water, ALWAYS first
const int SEAT_FIRST_SAMPLE = 2;     // seats 2–7 = 6 real samples
const int SAMPLE_SEATS      = 6;
const int SEAT_FLUSH        = 8;     // empty seat: 250 mL site water to waste before each site
const int MAX_SITES         = 2;     // 2 sites × 3 replicates, or 1 site × 6

// ───────────── Stop rule (DECISIONS.md) ─────────────
const float TARGET_ML        = 1000; // stop at 1 L …
const float BLANK_ML         = 1000; // field blank volume
const float FLUSH_ML         = 250;  // site-water flush through seat 8
const float MAX_PUMP_MIN     = 20;   // … or after 20 minutes of pumping …
const float MIN_FLOW_ML_MIN  = 20;   // … or when flow falls below 20 mL/min
const float MIN_VALID_ML     = 250;  // a sample only counts if at least 250 mL went through
const float DEFAULT_FLOW_ML_MIN = 80; // approx. pump flow with a filter (60–100). Calibrate by 8 Nov!

// Flow is measured from the load cell over the last FLOW_WINDOW_S seconds
const int   FLOW_WINDOW_S      = 30;
const int   FLOW_CHECK_AFTER_S = 60;  // don't judge the flow in the first minute

// Clog / air detection from the INA219 pump current
const float CLOG_AMPS_RISE     = 0.25f; // current this much ABOVE normal = filter clogging (more suction)
const float AIR_AMPS_DROP      = 0.08f; // current this much BELOW normal = pumping air (intake out / dry)
const int   BASELINE_FROM_S    = 5;     // "normal" current = average from 5 s …
const int   BASELINE_TO_S      = 15;    // … to 15 s after the pump starts
const unsigned long TRIP_MS    = 5000;  // a condition must last 5 s before we act (ignores spikes)
const unsigned long AIR_GIVE_UP_MS = 120000; // wait 2 min for the intake to go back in, then stop (AIR)

// Preservation and mechanics (calibrate on the real build)
const float ETHANOL_ML        = 2.0f;   // ≥95% ethanol dose after each filter
const float ETHANOL_ML_PER_S  = 0.5f;   // ethanol pump at low PWM (approx.)
const int   PUMP_PWM          = 255;    // sample pump speed (255 = full)
const int   ETHANOL_PWM       = 160;    // slower for the small dose
const unsigned long DRAIN_MS  = 3000;   // after pumping, let the cartridge drain before ethanol
const unsigned long SEAL_MS   = 1200;   // servo time to press the nozzle onto a seat
const unsigned long LIFT_MS   = 600;    // servo time to lift before the carousel turns
const int   SERVO_UP = 75, SERVO_DOWN = 95; // degrees: nozzle lifted / pressed (tune on the build)

// Carousel and hall sensor
const int   STEPS_PER_SEAT_DEFAULT = 400;  // 200 steps × 16 microsteps ÷ 8 seats
const float HOME_SPEED          = 300;     // steps per second while homing
const long  HOME_SPAN_MIN_STEPS = 120;     // seat 1 has a DOUBLE magnet: its "on" window is wider than this.
                                           // A single magnet is about 40–80 steps wide (check with the "hall" test)
const unsigned long HALL_SETTLE_MS = 80;

// ───────────── Battery safety ─────────────
const float BAT_MIN_START_V   = 10.5f;  // 3S pack: don't start a mission below this
const float BAT_CUTOFF_V      = 9.9f;   // 3.3 V per cell: stop the mission
const unsigned long BAT_LOW_TRIP_MS = 5000; // must stay low for 5 s (pump start-up dips are ignored)
const float BAT_USB_ONLY_V    = 3.0f;   // below this the battery switch is off (bench, USB power): no cut-off
const float BAT_TEMP_CUTOFF_C = 55.0f;  // DS18B20 on the pack: stop everything at 55 °C
const float BAT_TEMP_OK_C     = 50.0f;  // must cool below this before a new mission can start

// ───────────── Load cell (HX711 + 1 kg cell under the waste bottle) ─────────────
const float LOADCELL_MAX_G    = 1000;   // 1 kg cell. With a 5 kg cell, set 5000 and empty the bottle less often
const float BOTTLE_SLACK_G    = 30;     // allowed extra before we ask you to empty the bottle
const float HX711_SCALE_DEFAULT = 420.0f; // counts per gram (approx.) — use the "scalecal" command

// ───────────── GPS, clock, power ─────────────
const unsigned long GPS_FRESH_MS = 2000;    // a GPS position older than this is ignored
const long  TZ_OFFSET_S        = 4L * 3600; // Dubai is UTC+4 (no daylight saving)
#define     TZ_SUFFIX          "+04:00"
const unsigned long SENSOR_WARMUP_MS = 3000;  // probes need a few seconds after power-on
const unsigned long CONSOLE_TIMEOUT_MS = 5UL * 60 * 1000; // USB console counts as "connected" for 5 min after its last command
const int   IDLE_SLEEP_MIN_DEFAULT = 10;  // deep sleep after 10 idle minutes with no console (0 = never)
const bool  SLOW_CPU_WHEN_WAITING  = true; // 80 MHz while waiting for the operator (set false if Bluetooth misbehaves)
const unsigned long TELE_MS   = 500;      // telemetry twice a second

// ───────────── START button ─────────────
const bool START_BUTTON_FITTED = true;      // false = no button wired (pin 35 would float!) — also disables deep sleep
const unsigned long BTN_DEBOUNCE_MS = 30;
const unsigned long BTN_LONG_MS     = 3000;  // hold 3 s = abort the mission safely

// ───────────── DS18B20 addresses ─────────────
// Send {"cmd":"probes"} to list the probes, warm one in your hand to see which is which,
// then paste the addresses here. All zeros = "first probe found is water, second is battery".
const uint8_t WATER_PROBE_ADDR[8]   = { 0, 0, 0, 0, 0, 0, 0, 0 };
const uint8_t BATTERY_PROBE_ADDR[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };

// ───────────── Status LED patterns ─────────────
// 20 slots of 100 ms = one 2-second loop. '#' = LED on, '-' = off.
#define LED_READY    "#-------------------"   // idle, ready: press START to begin
#define LED_RUNNING  "####################"   // moving / pumping: leave it alone
#define LED_WAIT     "##--##--------------"   // waiting for you: do the job, then press START
#define LED_WATER    "##--##--##----------"   // intake is out of the water: put it back, press START
#define LED_PAUSED   "##########----------"   // paused from the console
#define LED_DONE     "###-###-###---------"   // mission finished
#define LED_ERROR    "#-#-#-#-#-#-#-#-#-#-"   // stopped with an error: read the log, press START to clear
