/*
  eDNA Collector firmware — Team Mangrove Medics (FIRST LEGO League BIOGLOW 2026–27)

  ESP32 DevKit. Talks to the eDNA Collector Console in newline-delimited JSON
  (docs/PROTOCOL.md) over USB serial, Bluetooth LE (Nordic UART Service) and
  Wi-Fi (access point + WebSocket, and it serves the console from LittleFS).

  Mission per site: SELFCHECK → DRIVE → TEST → PRIME → SAMPLE → SEAL → LOG → RINSE.
  Everything in loop() is non-blocking so a stop/abort is handled within milliseconds.

  STATUS: written for the team’s hardware plan and NOT yet tested on real hardware.
  Test each subsystem on its own first (see firmware/README.md).

  Libraries (Arduino Library Manager):
    ArduinoJson 7.x · NimBLE-Arduino 1.4.x · ESPAsyncWebServer + AsyncTCP
    Adafruit PWM Servo Driver · Adafruit SSD1306 + Adafruit GFX · Adafruit ADS1X15 · AccelStepper
*/
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <Adafruit_PWMServoDriver.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_ADS1X15.h>
#include <AccelStepper.h>
#include <time.h>

// ───────────── Identity ─────────────
#define FW_VERSION   "1.0.0"
#define DEVICE_ID    "EDNA-01"           // BLE name + Wi-Fi network name
#define WIFI_PASS    "mangrove2026"      // change before the event (8+ characters)
#define UTC_OFFSET_S (4 * 3600)          // Dubai, UTC+4

// ───────────── Pin map (ESP32 DevKit) ─────────────
// Drive: two L298N boards (left and right side motors wired in parallel)
#define DRV_L_EN   25   // PWM
#define DRV_L_IN1  26
#define DRV_L_IN2  27
#define DRV_R_EN   14   // PWM
#define DRV_R_IN1  32
#define DRV_R_IN2  33
// Relay board (most modules switch ON when the input is LOW)
#define RELAY_ON        LOW
#define RELAY_OFF       HIGH
#define PIN_PUMP_SAMPLE 4
#define PIN_PUMP_RINSE  16
#define PIN_VALVE_WASTE 17
#define PIN_VALVE_FILTER 5
// Gantry steppers (STEP/DIR drivers, e.g. A4988 / DRV8825 or the slide’s own driver)
#define X_STEP 18
#define X_DIR  19
#define Y_STEP 23
#define Y_DIR  2
#define X_HOME 34       // limit switch to GND, external 10k pull-up (input-only pin)
#define Y_HOME 35       // limit switch to GND, external 10k pull-up (input-only pin)
// Ultrasonic HC-SR04 ×2 (shared trigger; ECHO through a 5 V → 3.3 V divider!)
#define US_TRIG    15
#define US_ECHO_L  36
#define US_ECHO_R  39
// Flow sensor YF-S201 (cross-check only; reads ~1–30 L/min)
#define PIN_FLOW   13
// I2C: SDA 21, SCL 22 → PCA9685 servo board (0x40), SSD1306 OLED (0x3C), ADS1115 ADC (0x48)
// ADS1115 channels
#define ADC_PH   0
#define ADC_NTU  1
#define ADC_BAT  2
#define BAT_DIVIDER 4.0f   // 12 V battery through a 30k/10k divider → ×4
// PCA9685 servo channels
#define SV_SHOULDER 0
#define SV_ELBOW    1
#define SV_TURN     2
#define SV_LIFT     3
#define SV_JAW      4

// ───────────── Mechanics (calibrate on the real build) ─────────────
const float STEPS_PER_MM = 80.0f;        // GT2 belt, 20T pulley, 1/16 microstep
const float GANTRY_MAX_MM_S = 60.0f;
const int   OBSTACLE_CM = 30;
// Fixed gantry positions (mm from home)
const float FILTER_STATION_X = 200, FILTER_STATION_Y = 10;   // used cartridge sits here after sampling
const float FRESH_STACK_X    = 200, FRESH_STACK_Y    = 60;   // stack of clean cartridges
// Servo angles
const int ARM_UP_SH = 20, ARM_UP_EL = 150, ARM_DOWN_SH = 95, ARM_DOWN_EL = 60;
const int LIFT_UP = 30, LIFT_DOWN = 120, JAW_OPEN = 40, JAW_CLOSED = 100;

// ───────────── Hardware objects ─────────────
Adafruit_PWMServoDriver servos(0x40);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Adafruit_ADS1115 ads;
AccelStepper stepX(AccelStepper::DRIVER, X_STEP, X_DIR);
AccelStepper stepY(AccelStepper::DRIVER, Y_STEP, Y_DIR);
AsyncWebServer http(80);
AsyncWebSocket ws("/ws");
NimBLECharacteristic *bleTx = nullptr;
bool bleConnected = false, oledOK = false, adsOK = false;

// Calibration (persisted only in RAM; the console re-sends it with every mission)
struct Cal { float v7 = 2.50, v4 = 3.05, ntuZeroV = 4.20, mlPerS = 8.5; int cols = 10, rows = 5; float x0 = 20, y0 = 20, dx = 18, dy = 18; } cal;

// ───────────── Incoming lines from three links → one queue ─────────────
QueueHandle_t inbox;
struct Line { char s[512]; };
void pushLine(const char *s, size_t n) {
  Line l; n = min(n, sizeof(l.s) - 1); memcpy(l.s, s, n); l.s[n] = 0;
  xQueueSend(inbox, &l, 0);
}
String bleBuf;
class RxCB : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c) override {
    std::string v = c->getValue();
    for (char ch : v) {
      if (ch == '\n') { pushLine(bleBuf.c_str(), bleBuf.length()); bleBuf = ""; }
      else if (bleBuf.length() < 500) bleBuf += ch;
    }
  }
};
class SrvCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *) override { bleConnected = true; }
  void onDisconnect(NimBLEServer *) override { bleConnected = false; NimBLEDevice::startAdvertising(); }
};
void onWs(AsyncWebSocket *, AsyncWebSocketClient *, AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type != WS_EVT_DATA) return;
  AwsFrameInfo *info = (AwsFrameInfo *)arg;
  if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
    size_t n = len; while (n && (data[n - 1] == '\n' || data[n - 1] == '\r')) n--;
    pushLine((const char *)data, n);
  }
}

// ───────────── Outgoing: same line to every link ─────────────
void emit(JsonDocument &doc) {
  String out; serializeJson(doc, out); out += '\n';
  Serial.print(out);
  if (ws.count()) ws.textAll(out);
  if (bleConnected && bleTx) {
    for (size_t i = 0; i < out.length(); i += 20) {
      String part = out.substring(i, min(out.length(), i + 20));
      bleTx->setValue((uint8_t *)part.c_str(), part.length());
      bleTx->notify();
      delay(4);
    }
  }
}
void logMsg(const String &m) { JsonDocument d; d["t"] = "log"; d["msg"] = m; emit(d); }
void errMsg(const char *code, const String &m) { JsonDocument d; d["t"] = "err"; d["code"] = code; d["msg"] = m; emit(d); }

// ───────────── Actuators & sensors ─────────────
void relay(int pin, bool on) { digitalWrite(pin, on ? RELAY_ON : RELAY_OFF); }
bool pumpS = false, pumpR = false, valveW = false, valveF = false;
void setFluidics(bool ps, bool pr, bool vw, bool vf) {
  pumpS = ps; pumpR = pr; valveW = vw; valveF = vf;
  relay(PIN_PUMP_SAMPLE, ps); relay(PIN_PUMP_RINSE, pr); relay(PIN_VALVE_WASTE, vw); relay(PIN_VALVE_FILTER, vf);
}
void allStop() { setFluidics(false, false, false, false); analogWrite(DRV_L_EN, 0); analogWrite(DRV_R_EN, 0); stepX.stop(); stepY.stop(); }
void servoAngle(uint8_t ch, int deg) { servos.setPWM(ch, 0, map(constrain(deg, 0, 180), 0, 180, 110, 500)); }
int armPos = 0;
void armDown(bool down) { armPos = down; servoAngle(SV_SHOULDER, down ? ARM_DOWN_SH : ARM_UP_SH); servoAngle(SV_ELBOW, down ? ARM_DOWN_EL : ARM_UP_EL); }

int driveL = 0, driveR = 0; unsigned long driveUntil = 0;
void drive(int l, int r, unsigned long ms) {   // -255..255
  driveL = l; driveR = r; driveUntil = millis() + ms;
  digitalWrite(DRV_L_IN1, l > 0); digitalWrite(DRV_L_IN2, l < 0); analogWrite(DRV_L_EN, abs(l));
  digitalWrite(DRV_R_IN1, r > 0); digitalWrite(DRV_R_IN2, r < 0); analogWrite(DRV_R_EN, abs(r));
}

float readVolts(int ch) { return adsOK ? ads.computeVolts(ads.readADC_SingleEnded(ch)) : 0; }
float phNow = 7, ntuNow = 0, batNow = 12.6;
void readWater() {
  float v = 0; for (int i = 0; i < 8; i++) v += readVolts(ADC_PH); v /= 8;
  phNow = 7.0f + (v - cal.v7) * (3.0f / (cal.v7 - cal.v4));         // two-point line
  float t = 0; for (int i = 0; i < 8; i++) t += readVolts(ADC_NTU); t /= 8;
  ntuNow = max(0.0f, (cal.ntuZeroV - t) * 833.0f);                     // ~0–3000 NTU over the sensor’s range; refine in testing
}
int distanceCm(int echo) {
  digitalWrite(US_TRIG, LOW); delayMicroseconds(2); digitalWrite(US_TRIG, HIGH); delayMicroseconds(10); digitalWrite(US_TRIG, LOW);
  unsigned long us = pulseIn(echo, HIGH, 25000);
  return us ? (int)(us / 58) : 400;
}
volatile uint32_t flowPulses = 0;
void IRAM_ATTR onFlow() { flowPulses++; }

// gantry helpers (mm)
void gantryTo(float x, float y) { stepX.moveTo(lround(x * STEPS_PER_MM)); stepY.moveTo(lround(y * STEPS_PER_MM)); }
bool gantryIdle() { return stepX.distanceToGo() == 0 && stepY.distanceToGo() == 0; }
float gx() { return stepX.currentPosition() / STEPS_PER_MM; }
float gy() { return stepY.currentPosition() / STEPS_PER_MM; }
void slotXY(int tube, float &x, float &y) {
  int slot = (tube - 1) % (cal.cols * cal.rows);
  x = cal.x0 + (slot % cal.cols) * cal.dx; y = cal.y0 + (slot / cal.cols) * cal.dy;
}
bool homeGantry() {   // blocking but short; only called while idle or in SELFCHECK
  stepX.setSpeed(-30 * STEPS_PER_MM); stepY.setSpeed(-30 * STEPS_PER_MM);
  unsigned long t0 = millis();
  while ((digitalRead(X_HOME) == HIGH || digitalRead(Y_HOME) == HIGH) && millis() - t0 < 15000) {
    if (digitalRead(X_HOME) == HIGH) stepX.runSpeed();
    if (digitalRead(Y_HOME) == HIGH) stepY.runSpeed();
  }
  stepX.setCurrentPosition(0); stepY.setCurrentPosition(0);
  gantryTo(5, 5);   // park off the switches (pin 34/35 boot-safe either way)
  return millis() - t0 < 15000;
}

// ───────────── Mission state ─────────────
enum St { IDLE, SELFCHECK, DRIVE, TEST, PRIME, SAMPLE, SEAL, LOG, RINSE };
const char *ST_NAME[] = { "IDLE", "SELFCHECK", "DRIVE", "TEST", "PRIME", "SAMPLE", "SEAL", "LOG", "RINSE" };
St st = IDLE;
bool paused = false, arrived = false;
JsonDocument mission;
int siteIdx = -1;            // -1 = field blank
int tube = 1, tubesDone = 0;
float targetMl = 0, sampledMl = 0;
bool clogged = false;
unsigned long phaseT = 0, pumpMsAcc = 0, lastPumpTick = 0;
int sealStep = 0;
struct Rules { float ntuMurky = 40, clearMl = 1000, murkyMl = 500, maxPumpS = 600, primeMl = 100, rinseMl = 100; bool blank = true; } rules;

JsonObject site() { return siteIdx >= 0 ? mission["sites"][siteIdx].as<JsonObject>() : JsonObject(); }
const char *siteId() { return siteIdx >= 0 ? (const char *)site()["id"] : "BLANK"; }
const char *siteName() { return siteIdx >= 0 ? (const char *)site()["name"] : "Field blank"; }

void enter(St s) {
  st = s; phaseT = millis();
  JsonDocument d; d["t"] = "step"; d["n"] = (int)s; d["name"] = ST_NAME[s]; d["site"] = siteId(); d["siteName"] = siteName(); d["tube"] = tube; emit(d);
}
void finishMission(bool aborted, const char *msg = "") {
  allStop(); armDown(false); servoAngle(SV_LIFT, LIFT_UP);
  st = IDLE; paused = false;
  JsonDocument d; d["t"] = aborted ? "aborted" : "done"; d["mission"] = mission["id"]; if (aborted) d["msg"] = msg; else d["tubes"] = tubesDone; emit(d);
}
void nextSiteOrDone() {
  siteIdx++;
  if (siteIdx >= (int)mission["sites"].size()) { gantryTo(5, 5); finishMission(false); return; }
  arrived = false; enter(DRIVE);
  logMsg(String("Drive to ") + siteName() + " — confirm arrival in the console");
}
void startMission(JsonObject m) {
  if (st != IDLE) { errMsg("BUSY", "A mission is already running"); return; }
  mission.clear(); mission.set(m);
  JsonObject r = mission["rules"];
  rules.ntuMurky = r["ntuMurky"] | 40; rules.clearMl = r["clearMl"] | 1000; rules.murkyMl = r["murkyMl"] | 500;
  rules.maxPumpS = r["maxPumpS"] | 600; rules.primeMl = r["primeMl"] | 100; rules.rinseMl = r["rinseMl"] | 100; rules.blank = r["blank"] | true;
  cal.mlPerS = mission["mlPerS"] | cal.mlPerS;
  if (mission["gantry"].is<JsonObject>()) { JsonObject g = mission["gantry"]; cal.cols = g["cols"] | 10; cal.rows = g["rows"] | 5; cal.x0 = g["x0"] | 20; cal.y0 = g["y0"] | 20; cal.dx = g["dx"] | 18; cal.dy = g["dy"] | 18; }
  tube = mission["tubeStart"] | 1; tubesDone = 0;
  siteIdx = rules.blank ? -1 : 0;
  JsonDocument d; d["t"] = "mission"; d["id"] = mission["id"]; d["sites"] = mission["sites"].size(); d["blank"] = rules.blank; emit(d);
  enter(SELFCHECK);
}

// Seal sub-sequence: used cartridge → tube N, fresh cartridge → station
struct Act { char kind; float a, b; };   // 'M' move x,y · 'L' lift deg · 'J' jaw deg · 'W' wait ms
Act sealSeq[14]; int sealLen = 0;
void buildSeal() {
  float tx, ty; slotXY(tube, tx, ty);
  Act s[] = {
    {'J', JAW_OPEN, 0}, {'M', FILTER_STATION_X, FILTER_STATION_Y}, {'L', LIFT_DOWN, 0}, {'J', JAW_CLOSED, 0}, {'L', LIFT_UP, 0},
    {'M', tx, ty}, {'L', LIFT_DOWN, 0}, {'J', JAW_OPEN, 0}, {'L', LIFT_UP, 0},
    {'M', FRESH_STACK_X, FRESH_STACK_Y}, {'L', LIFT_DOWN, 0}, {'J', JAW_CLOSED, 0}, {'L', LIFT_UP, 0}, {'M', FILTER_STATION_X, FILTER_STATION_Y},
  };
  sealLen = sizeof(s) / sizeof(s[0]); memcpy(sealSeq, s, sizeof(s)); sealStep = 0;
}
// (after the last move the fresh cartridge is lowered and released at the station)
bool runSeal() {
  static unsigned long waitUntil = 0; static bool started = false;
  if (sealStep >= sealLen) {
    if (!started) { servoAngle(SV_LIFT, LIFT_DOWN); waitUntil = millis() + 600; started = true; }
    if (millis() < waitUntil) return false;
    servoAngle(SV_JAW, JAW_OPEN); servoAngle(SV_LIFT, LIFT_UP); started = false; return true;
  }
  Act &a = sealSeq[sealStep];
  if (!started) {
    if (a.kind == 'M') gantryTo(a.a, a.b);
    else if (a.kind == 'L') { servoAngle(SV_LIFT, a.a); waitUntil = millis() + 600; }
    else if (a.kind == 'J') { servoAngle(SV_JAW, a.a); waitUntil = millis() + 400; }
    else waitUntil = millis() + (unsigned long)a.a;
    started = true;
  }
  bool done = a.kind == 'M' ? gantryIdle() : millis() >= waitUntil;
  if (done) { started = false; sealStep++; }
  return false;
}

void missionTick() {
  if (st == IDLE || paused) return;
  unsigned long el = millis() - phaseT;
  switch (st) {
    case SELFCHECK:
      if (el < 50) return;
      batNow = readVolts(ADC_BAT) * BAT_DIVIDER;
      if (adsOK && batNow < 11.0f) { errMsg("LOWBAT", String("Battery ") + batNow + " V — charge before sampling"); finishMission(true, "Battery too low"); return; }
      if (!homeGantry()) errMsg("HOME", "Gantry did not reach the home switches");
      logMsg(String("Self-check OK · battery ") + String(batNow, 2) + " V");
      if (siteIdx < 0) { enter(TEST); } else { siteIdx--; nextSiteOrDone(); }
      break;
    case DRIVE:
      if (min(distanceCm(US_ECHO_L), distanceCm(US_ECHO_R)) < OBSTACLE_CM && (driveL > 0 || driveR > 0)) { drive(0, 0, 0); errMsg("OBSTACLE", "Obstacle ahead — stopped"); }
      if (arrived) { drive(0, 0, 0); enter(TEST); }
      break;
    case TEST:
      if (el < 50) { if (siteIdx >= 0) armDown(true); return; }
      if (el < 4000) return;               // let the arm settle and the probe stabilise
      readWater();
      if (siteIdx < 0) { targetMl = 250; logMsg("Field blank: clean water, 250 mL"); }
      else { targetMl = ntuNow >= rules.ntuMurky ? rules.murkyMl : rules.clearMl; logMsg(String(ntuNow >= rules.ntuMurky ? "Water MURKY" : "Water clear") + " (" + String(ntuNow, 1) + " NTU) → target " + (int)targetMl + " mL"); }
      enter(PRIME);
      break;
    case PRIME: {
      bool blank = siteIdx < 0;
      setFluidics(!blank, blank, true, false);
      if (el >= (unsigned long)(rules.primeMl / cal.mlPerS * 1000)) { setFluidics(false, false, false, false); sampledMl = 0; pumpMsAcc = 0; lastPumpTick = millis(); clogged = false; flowPulses = 0; enter(SAMPLE); }
      break;
    }
    case SAMPLE: {
      bool blank = siteIdx < 0;
      setFluidics(!blank, blank, false, true);
      unsigned long now = millis(); pumpMsAcc += now - lastPumpTick; lastPumpTick = now;
      sampledMl = pumpMsAcc / 1000.0f * cal.mlPerS;
      if (sampledMl >= targetMl || pumpMsAcc >= rules.maxPumpS * 1000) {
        clogged = sampledMl < targetMl;
        setFluidics(false, false, false, false);
        if (clogged) errMsg("CLOG", String("Time limit reached at ") + (int)sampledMl + " mL");
        armDown(false); buildSeal(); enter(SEAL);
      }
      break;
    }
    case SEAL:
      if (runSeal()) { logMsg(String("Cartridge sealed in tube ") + tube); enter(LOG); }
      break;
    case LOG: {
      JsonDocument d; d["t"] = "sample"; d["mission"] = mission["id"]; d["tube"] = tube; d["site"] = siteId(); d["name"] = siteName();
      JsonObject s = siteIdx >= 0 ? site() : mission["sites"][0].as<JsonObject>();
      d["lat"] = s["lat"]; d["lon"] = s["lon"];
      time_t nowT = time(nullptr); d["ts"] = nowT > 1700000000 ? (double)nowT * 1000.0 : (double)millis();
      d["ml"] = (int)sampledMl; d["target"] = (int)targetMl; d["ph"] = serialized(String(phNow, 2)); d["ntu"] = serialized(String(ntuNow, 1));
      d["blank"] = siteIdx < 0; d["clog"] = clogged; emit(d);
      tubesDone++; enter(RINSE);
      break;
    }
    case RINSE:
      setFluidics(false, true, true, false);
      if (el >= (unsigned long)(rules.rinseMl / cal.mlPerS * 1000)) { setFluidics(false, false, false, false); tube++; nextSiteOrDone(); }
      break;
    default: break;
  }
}

// ───────────── Commands ─────────────
unsigned long calPumpUntil = 0; char calPump = 0; int calPumpS = 0;
struct Sched { char mode[8] = "now"; int hh = -1, mm = -1; bool armed = false; int lastDay = -1; } sched;
JsonDocument schedMission;

void handle(const char *line) {
  JsonDocument m;
  if (deserializeJson(m, line)) { errMsg("PARSE", "Bad JSON"); return; }
  const char *cmd = m["cmd"] | "";
  if (!strcmp(cmd, "hello")) {
    JsonDocument d; d["t"] = "hello"; d["id"] = DEVICE_ID; d["fw"] = FW_VERSION; d["slots"] = cal.cols * cal.rows; d["bat"] = serialized(String(batNow, 2)); emit(d);
  } else if (!strcmp(cmd, "settime")) {
    struct timeval tv = { (time_t)((m["ts"] | 0.0) / 1000.0), 0 }; settimeofday(&tv, nullptr);
  } else if (!strcmp(cmd, "start")) startMission(m["mission"].as<JsonObject>());
  else if (!strcmp(cmd, "pause")) { if (st != IDLE) { paused = true; allStop(); logMsg("Paused — pumps stopped, valves closed"); } }
  else if (!strcmp(cmd, "resume")) { if (paused) { paused = false; lastPumpTick = millis(); logMsg("Resumed"); } }
  else if (!strcmp(cmd, "abort")) { if (st != IDLE) finishMission(true, "Safe stop: pumps off, valves closed, arm raised"); }
  else if (!strcmp(cmd, "arrived")) { arrived = true; }
  else if (!strcmp(cmd, "drive")) { if (st == IDLE || st == DRIVE) drive(m["l"] | 0, m["r"] | 0, m["ms"] | 300); }
  else if (!strcmp(cmd, "home")) { if (st == IDLE) { homeGantry(); logMsg("Gantry homed"); } }
  else if (!strcmp(cmd, "read")) { readWater(); JsonDocument d; d["t"] = "raw"; d["phV"] = serialized(String(readVolts(ADC_PH), 3)); d["ntuV"] = serialized(String(readVolts(ADC_NTU), 3)); emit(d); }
  else if (!strcmp(cmd, "pump")) {
    if (st != IDLE) { errMsg("BUSY", "Mission running"); return; }
    calPump = (m["which"] | "S")[0]; calPumpS = m["seconds"] | 10; calPumpUntil = millis() + calPumpS * 1000UL;
    setFluidics(calPump == 'S', calPump == 'R', true, false);
    logMsg(String("Calibration: pump ") + calPump + " on for " + calPumpS + " s");
  } else if (!strcmp(cmd, "setcal")) {
    cal.v7 = m["ph"]["v7"] | cal.v7; cal.v4 = m["ph"]["v4"] | cal.v4; cal.ntuZeroV = m["ntuZeroV"] | cal.ntuZeroV; cal.mlPerS = m["mlPerS"] | cal.mlPerS;
    JsonDocument d; d["t"] = "ack"; d["cmd"] = "setcal"; d["ok"] = true; emit(d);
  } else if (!strcmp(cmd, "schedule")) {
    strlcpy(sched.mode, m["mode"] | "now", sizeof(sched.mode));
    const char *t = !strcmp(sched.mode, "tide") ? (m["tide"] | "") : (m["time"] | "");
    sched.armed = sscanf(t, "%d:%d", &sched.hh, &sched.mm) == 2 && strcmp(sched.mode, "now");
    schedMission.clear(); schedMission.set(m["mission"]);
    JsonDocument d; d["t"] = "ack"; d["cmd"] = "schedule"; d["ok"] = sched.armed; d["msg"] = sched.armed ? String("Will start at ") + t + (time(nullptr) < 1700000000 ? " (clock not set — reconnect the console)" : "") : String("No time set"); emit(d);
  } else errMsg("CMD", String("Unknown command ") + cmd);
}

// ───────────── Display + telemetry ─────────────
void telemetry() {
  JsonDocument d; d["t"] = "tele"; d["state"] = ST_NAME[st]; d["site"] = siteName(); d["tube"] = tube;
  d["bat"] = serialized(String(batNow, 2)); d["ph"] = serialized(String(phNow, 2)); d["ntu"] = serialized(String(ntuNow, 1));
  d["ml"] = (int)sampledMl; d["target"] = (int)targetMl; d["flow"] = serialized(String(pumpS || pumpR ? cal.mlPerS : 0, 2));
  d["pumpS"] = (int)pumpS; d["pumpR"] = (int)pumpR; d["vW"] = (int)valveW; d["vF"] = (int)valveF;
  static int lastDist = 400;   // pulseIn blocks, so only ping while driving or idle (keeps the gantry smooth)
  if (st == DRIVE || st == IDLE) lastDist = min(distanceCm(US_ECHO_L), distanceCm(US_ECHO_R));
  d["gx"] = (int)gx(); d["gy"] = (int)gy(); d["dist"] = lastDist;
  d["arm"] = armPos; d["drive"] = (int)(driveL || driveR); d["paused"] = (int)paused; d["flowPulses"] = flowPulses;
  emit(d);
}
void drawOled() {
  if (!oledOK) return;
  oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE); oled.setCursor(0, 0);
  oled.printf("eDNA %s %s\n", DEVICE_ID, paused ? "PAUSED" : ST_NAME[st]);
  oled.printf("Tube %d  %s\n", tube, siteName());
  oled.printf("pH %.2f  %.0f NTU\n", phNow, ntuNow);
  oled.printf("Vol %d/%d mL\n", (int)sampledMl, (int)targetMl);
  oled.printf("Bat %.2f V\n", batNow);
  oled.printf("P%c%c V%c%c\n", pumpS ? 'S' : '-', pumpR ? 'R' : '-', valveW ? 'W' : '-', valveF ? 'F' : '-');
  oled.display();
}

// ───────────── Setup / loop ─────────────
void setup() {
  Serial.begin(115200);
  inbox = xQueueCreate(8, sizeof(Line));
  for (int p : { PIN_PUMP_SAMPLE, PIN_PUMP_RINSE, PIN_VALVE_WASTE, PIN_VALVE_FILTER }) { pinMode(p, OUTPUT); digitalWrite(p, RELAY_OFF); }
  for (int p : { DRV_L_EN, DRV_L_IN1, DRV_L_IN2, DRV_R_EN, DRV_R_IN1, DRV_R_IN2, US_TRIG }) { pinMode(p, OUTPUT); digitalWrite(p, LOW); }
  pinMode(X_HOME, INPUT); pinMode(Y_HOME, INPUT); pinMode(US_ECHO_L, INPUT); pinMode(US_ECHO_R, INPUT);
  pinMode(PIN_FLOW, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(PIN_FLOW), onFlow, RISING);
  stepX.setMaxSpeed(GANTRY_MAX_MM_S * STEPS_PER_MM); stepX.setAcceleration(200 * STEPS_PER_MM);
  stepY.setMaxSpeed(GANTRY_MAX_MM_S * STEPS_PER_MM); stepY.setAcceleration(200 * STEPS_PER_MM);

  Wire.begin(21, 22);
  servos.begin(); servos.setPWMFreq(50);
  armDown(false); servoAngle(SV_LIFT, LIFT_UP); servoAngle(SV_JAW, JAW_OPEN); servoAngle(SV_TURN, 90);
  oledOK = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  adsOK = ads.begin(0x48); if (adsOK) ads.setGain(GAIN_ONE);   // ±4.096 V

  // Wi-Fi access point + console from LittleFS + WebSocket
  WiFi.softAP(DEVICE_ID, WIFI_PASS);
  if (LittleFS.begin(true)) http.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
  ws.onEvent(onWs); http.addHandler(&ws); http.begin();

  // Bluetooth LE — Nordic UART Service
  NimBLEDevice::init(DEVICE_ID);
  NimBLEServer *srv = NimBLEDevice::createServer(); srv->setCallbacks(new SrvCB());
  NimBLEService *svc = srv->createService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
  NimBLECharacteristic *rx = svc->createCharacteristic("6E400002-B5A3-F393-E0A9-E50E24DCCA9E", NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCB());
  bleTx = svc->createCharacteristic("6E400003-B5A3-F393-E0A9-E50E24DCCA9E", NIMBLE_PROPERTY::NOTIFY);
  svc->start();
  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising(); adv->addServiceUUID(svc->getUUID()); adv->start();

  setenv("TZ", "UTC-4", 1); tzset();   // POSIX sign is inverted: UTC-4 means UTC+4 (Dubai)
  batNow = readVolts(ADC_BAT) * BAT_DIVIDER;
  logMsg(String("eDNA Collector ") + FW_VERSION + " ready · Wi-Fi " + DEVICE_ID + " · http://192.168.4.1");
}

String serialBuf;
unsigned long lastTele = 0, lastOled = 0, lastSched = 0;
void loop() {
  // USB serial lines
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { pushLine(serialBuf.c_str(), serialBuf.length()); serialBuf = ""; }
    else if (c != '\r' && serialBuf.length() < 500) serialBuf += c;
  }
  Line l; while (xQueueReceive(inbox, &l, 0) == pdTRUE) handle(l.s);

  stepX.run(); stepY.run();
  if (driveUntil && millis() > driveUntil) { drive(0, 0, 0); driveUntil = 0; }
  if (calPumpUntil && millis() > calPumpUntil) {
    setFluidics(false, false, false, false); calPumpUntil = 0;
    JsonDocument d; d["t"] = "pumped"; d["which"] = String(calPump); d["seconds"] = calPumpS; emit(d);
  }
  missionTick();

  if (millis() - lastTele > 250) { lastTele = millis(); if (st == TEST || st == SAMPLE) readWater(); if (adsOK) batNow = readVolts(ADC_BAT) * BAT_DIVIDER; telemetry(); }
  if (millis() - lastOled > 500) { lastOled = millis(); drawOled(); ws.cleanupClients(); }
  if (sched.armed && st == IDLE && millis() - lastSched > 10000) {
    lastSched = millis();
    time_t now = time(nullptr); struct tm t; localtime_r(&now, &t);
    if (now > 1700000000 && t.tm_hour == sched.hh && t.tm_min == sched.mm && t.tm_yday != sched.lastDay) {
      sched.lastDay = t.tm_yday; logMsg("Scheduled mission starting");
      startMission(schedMission.as<JsonObject>());
      arrived = true;   // fixed post: already at the site
    }
  }
}
