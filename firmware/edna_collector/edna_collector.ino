/*
  eDNA Pod firmware — Team Canopy Keepers (FIRST LEGO League BIOGLOW 2026–27)

  ESP32 DevKit inside the eDNA Pod: a 22 cm canister with an 8-seat filter carousel.
  Talks to the eDNA Collector Console in newline-delimited JSON (docs/PROTOCOL.md)
  over USB serial, Bluetooth LE (Nordic UART Service) and Wi-Fi (access point +
  WebSocket; it also serves the console from LittleFS).

  Mission per site: SELFCHECK → INDEX → TEST → PRIME → SAMPLE → PRESERVE → LOG → RINSE
    INDEX     stepper turns a clean cartridge under the nozzle; the Pod is carried and staked
    PRIME     nozzle up, sample pump flushes the hose to the waste tray
    SAMPLE    servo presses the nozzle onto the cartridge, pump pushes water through the filter;
              the INA219 watches pump current — a rising current means the filter is clogging
    PRESERVE  cartridge drains, then the ethanol pump adds ~2 mL
    RINSE     nozzle lifts, the hose is flushed with site water for the next site
  Everything in loop() is non-blocking, so pause/abort are handled within milliseconds.

  STATUS: written for the Pod build in the "Flow" doc and NOT yet tested on hardware.
  Test each subsystem on its own first (see firmware/README.md).

  Libraries (Arduino Library Manager):
    ArduinoJson 7.x · NimBLE-Arduino 1.4.x · ESPAsyncWebServer + AsyncTCP · AccelStepper
    ESP32Servo · Adafruit INA219 · OneWire · DallasTemperature · TinyGPSPlus   (SD is built in)
*/
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <LittleFS.h>
#include <SPI.h>
#include <SD.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <AccelStepper.h>
#include <ESP32Servo.h>
#include <Adafruit_INA219.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <TinyGPSPlus.h>
#include <time.h>

// ───────────── Identity ─────────────
#define FW_VERSION   "2.0.0"
#define DEVICE_ID    "EDNA-01"           // BLE name + Wi-Fi network name
// Wi-Fi password lives in secrets.h, which is never committed to GitHub.
// Copy secrets.example.h to secrets.h and set your own password (8+ characters).
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Missing secrets.h: copy secrets.example.h to secrets.h and set WIFI_PASS"
#endif

// ───────────── Pin map (matches the Flow doc) ─────────────
// Analog sensors on ADC1 only (ADC2 stops working while Wi-Fi/Bluetooth is on)
#define PIN_TURBIDITY 34   // through a 10k/20k divider (sensor gives up to 4.5 V)
#define PIN_RAIN      35   // rain sensor AO, powered from 3.3 V
#define PIN_PH        36   // optional pH kit, through a divider
#define PIN_FLOAT     39   // rain-reservoir float switch, external 10k pull-up (input-only pin)
#define PIN_HOME      26   // carousel home switch (magnet under seat 1), internal pull-up
#define PIN_ONEWIRE    4   // DS18B20, 4.7k pull-up to 3.3 V
#define PIN_GPS_RX    16   // ← GPS TX
#define PIN_GPS_TX    17   // → GPS RX
#define PIN_SD_CS      5   // SD on VSPI: SCK 18, MISO 19, MOSI 23
#define STEP_PIN      25   // A4988
#define DIR_PIN       33
#define EN_PIN        32   // LOW = driver on
#define PIN_SERVO     13
#define PIN_PUMP_S    14   // sample pump MOSFET (PWM)
#define PIN_PUMP_E    27   // ethanol pump MOSFET
// I2C: SDA 21, SCL 22 → INA219 (0x40), in series with the 11.1 V pump rail

// ───────────── Mechanics (calibrate on the real build) ─────────────
int   SEATS = 8;
int   STEPS_PER_SEAT = 400;              // 200-step motor × 16 microsteps ÷ 8 seats
const int SERVO_UP = 20, SERVO_DOWN = 95; // nozzle lifted / pressed onto the cartridge
const float ETHANOL_ML_S = 0.5f;          // ethanol pump at low PWM, calibrate
const float CLOG_AMPS_RISE = 0.25f;       // stop when pump current rises this much above its start value
const int   PUMP_PWM = 255;               // full speed; lower for gentler flow

// ───────────── Hardware objects ─────────────
AccelStepper carousel(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);
Servo nozzle;
Adafruit_INA219 ina;
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature thermo(&oneWire);
TinyGPSPlus gps;
HardwareSerial GPSSerial(2);
AsyncWebServer http(80);
AsyncWebSocket ws("/ws");
NimBLECharacteristic *bleTx = nullptr;
bool bleConnected = false, inaOK = false, sdOK = false;

// Calibration (RAM; the console re-sends it with every mission)
struct Cal { float v7 = 2.50, v4 = 3.05, ntuZeroV = 4.20, mlPerS = 1.7; } cal;

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

// ───────────── Outgoing: same line to every link (+ SD for samples) ─────────────
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
void sdAppend(const String &line) {
  if (!sdOK) return;
  File f = SD.open("/samples.jsonl", FILE_APPEND);
  if (f) { f.println(line); f.close(); }
}

// ───────────── Actuators & sensors ─────────────
bool pumpS = false, pumpE = false, pressed = false;
void setPumps(bool s, bool e) {
  pumpS = s; pumpE = e;
  analogWrite(PIN_PUMP_S, s ? PUMP_PWM : 0);
  analogWrite(PIN_PUMP_E, e ? 160 : 0);   // slower for the small ethanol dose
}
void press(bool down) { pressed = down; nozzle.write(down ? SERVO_DOWN : SERVO_UP); }
void allStop() { setPumps(false, false); press(false); carousel.stop(); }

int seatNow() { long s = carousel.currentPosition() / STEPS_PER_SEAT; return (int)(((s % SEATS) + SEATS) % SEATS) + 1; }
void seatTo(int seat) {               // always turns forward to the next seat
  long cur = carousel.currentPosition(), base = cur - (cur % ((long)STEPS_PER_SEAT * SEATS));
  long target = base + (long)(seat - 1) * STEPS_PER_SEAT;
  if (target < cur) target += (long)STEPS_PER_SEAT * SEATS;
  digitalWrite(EN_PIN, LOW); carousel.moveTo(target);
}
bool homeCarousel() {                 // short and blocking; only while idle or in SELFCHECK
  press(false); delay(300);
  digitalWrite(EN_PIN, LOW); carousel.setSpeed(300);
  unsigned long t0 = millis();
  while (digitalRead(PIN_HOME) == HIGH && millis() - t0 < 8000) carousel.runSpeed();
  carousel.setCurrentPosition(0);
  return millis() - t0 < 8000;
}

float adcVolts(int pin) { return analogReadMilliVolts(pin) / 1000.0f; }
float ntuNow = 0, phNow = 7, tempNow = 25, batNow = 12.0, ampsNow = 0;
void readWater() {
  float t = 0; for (int i = 0; i < 8; i++) t += adcVolts(PIN_TURBIDITY); t = t / 8 * 1.5f;   // undo the 10k/20k divider
  ntuNow = max(0.0f, (cal.ntuZeroV - t) * 833.0f);                                           // refine in testing
  float v = 0; for (int i = 0; i < 8; i++) v += adcVolts(PIN_PH); v = v / 8 * 1.5f;
  phNow = 7.0f + (v - cal.v7) * (3.0f / (cal.v7 - cal.v4));
  thermo.requestTemperatures(); float c = thermo.getTempCByIndex(0); if (c > -50) tempNow = c;
}
void readPower() {
  if (!inaOK) return;
  batNow = ina.getBusVoltage_V() + ina.getShuntVoltage_mV() / 1000.0f;
  ampsNow = ina.getCurrent_mA() / 1000.0f;
}
bool raining() { return analogRead(PIN_RAIN) < 2000; }   // wet pad pulls AO low; tune in testing

// ───────────── Mission state ─────────────
enum St { IDLE, SELFCHECK, INDEX, TEST, PRIME, SAMPLE, PRESERVE, LOG, RINSE };
const char *ST_NAME[] = { "IDLE", "SELFCHECK", "INDEX", "TEST", "PRIME", "SAMPLE", "PRESERVE", "LOG", "RINSE" };
St st = IDLE;
bool paused = false, placed = false, autoPlaced = false;
JsonDocument mission;
int siteIdx = -1;                    // -1 = field blank
int tube = 1, tubesDone = 0;
float targetMl = 0, sampledMl = 0, startAmps = 0;
bool clogged = false;
unsigned long phaseT = 0, pumpMsAcc = 0, lastPumpTick = 0;
struct Rules { float ntuMurky = 40, clearMl = 1000, murkyMl = 500, maxPumpS = 900, primeMl = 34, rinseMl = 34, ethanolMl = 2; bool blank = true; } rules;

JsonObject site() { return siteIdx >= 0 ? mission["sites"][siteIdx].as<JsonObject>() : JsonObject(); }
const char *siteId() { return siteIdx >= 0 ? (const char *)site()["id"] : "BLANK"; }
const char *siteName() { return siteIdx >= 0 ? (const char *)site()["name"] : "Field blank"; }
int seatFor(int t) { return (t - 1) % SEATS + 1; }

void enter(St s) {
  st = s; phaseT = millis();
  JsonDocument d; d["t"] = "step"; d["n"] = (int)s; d["name"] = ST_NAME[s]; d["site"] = siteId(); d["siteName"] = siteName(); d["tube"] = tube; emit(d);
}
void finishMission(bool aborted, const char *msg = "") {
  allStop(); st = IDLE; paused = false;
  JsonDocument d; d["t"] = aborted ? "aborted" : "done"; d["mission"] = mission["id"]; if (aborted) d["msg"] = msg; else d["tubes"] = tubesDone; emit(d);
}
void goIndex() {
  press(false); placed = autoPlaced || siteIdx < 0;
  seatTo(seatFor(tube));
  enter(INDEX);
  logMsg(String("Carousel → seat ") + seatFor(tube) + " (cartridge " + tube + ")" + (placed ? "" : String(" · carry the Pod to ") + siteName() + " and confirm in the console"));
}
void nextSiteOrDone() {
  siteIdx++;
  if (siteIdx >= (int)mission["sites"].size()) { finishMission(false); return; }
  goIndex();
}
void startMission(JsonObject m) {
  if (st != IDLE) { errMsg("BUSY", "A mission is already running"); return; }
  mission.clear(); mission.set(m);
  JsonObject r = mission["rules"];
  rules.ntuMurky = r["ntuMurky"] | 40; rules.clearMl = r["clearMl"] | 1000; rules.murkyMl = r["murkyMl"] | 500;
  rules.maxPumpS = r["maxPumpS"] | 900; rules.primeMl = r["primeMl"] | 34; rules.rinseMl = r["rinseMl"] | 34;
  rules.ethanolMl = r["ethanolMl"] | 2; rules.blank = r["blank"] | true;
  cal.mlPerS = mission["mlPerS"] | cal.mlPerS;
  if (mission["carousel"].is<JsonObject>()) { SEATS = mission["carousel"]["seats"] | 8; STEPS_PER_SEAT = mission["carousel"]["stepsPerSeat"] | 400; }
  tube = mission["tubeStart"] | 1; tubesDone = 0;
  int needed = mission["sites"].size() + (rules.blank ? 1 : 0), free = SEATS - (tube - 1) % SEATS;
  if (needed > free) logMsg(String("Only ") + free + " clean seats left — swap in a fresh carousel when it fills");
  siteIdx = rules.blank ? -1 : 0;
  JsonDocument d; d["t"] = "mission"; d["id"] = mission["id"]; d["sites"] = mission["sites"].size(); d["blank"] = rules.blank; emit(d);
  enter(SELFCHECK);
}

void missionTick() {
  if (st == IDLE || paused) return;
  unsigned long el = millis() - phaseT;
  switch (st) {
    case SELFCHECK:
      if (el < 50) return;
      readPower();
      if (inaOK && batNow < 10.5f) { errMsg("LOWBAT", String("Battery ") + String(batNow, 2) + " V — charge before sampling"); finishMission(true, "Battery too low"); return; }
      if (!homeCarousel()) errMsg("HOME", "Carousel did not find the home magnet");
      logMsg(String("Self-check OK · battery ") + String(batNow, 2) + " V · GPS " + (gps.location.isValid() ? "fix" : "searching"));
      goIndex();
      break;
    case INDEX:
      if (carousel.distanceToGo() != 0) return;
      digitalWrite(EN_PIN, HIGH);          // motor off between moves (saves power, no hum)
      if (placed) enter(TEST);
      break;
    case TEST:
      if (el < 3000) return;               // let the probes settle
      readWater();
      if (siteIdx < 0) { targetMl = 250; logMsg("Field blank: bottled water, 250 mL"); }
      else { targetMl = ntuNow >= rules.ntuMurky ? rules.murkyMl : rules.clearMl; logMsg(String(ntuNow >= rules.ntuMurky ? "Water MURKY" : "Water clear") + " (" + String(ntuNow, 1) + " NTU) → target " + (int)targetMl + " mL"); }
      enter(PRIME);
      break;
    case PRIME:
      press(false); setPumps(true, false);
      if (el >= (unsigned long)(rules.primeMl / cal.mlPerS * 1000)) { setPumps(false, false); sampledMl = 0; pumpMsAcc = 0; clogged = false; enter(SAMPLE); }
      break;
    case SAMPLE: {
      if (el < 1200) { press(true); return; }         // servo seals first
      if (!pumpS) { setPumps(true, false); lastPumpTick = millis(); startAmps = 0; }
      unsigned long now = millis(); pumpMsAcc += now - lastPumpTick; lastPumpTick = now;
      sampledMl = pumpMsAcc / 1000.0f * cal.mlPerS;
      if (pumpMsAcc > 5000 && startAmps == 0) startAmps = ampsNow;   // baseline once flow is steady
      bool clog = startAmps > 0 && ampsNow - startAmps > CLOG_AMPS_RISE;
      if (sampledMl >= targetMl || clog || pumpMsAcc >= rules.maxPumpS * 1000) {
        clogged = sampledMl < targetMl;
        setPumps(false, false);
        if (clogged) errMsg("CLOG", String(clog ? "Pump current rose" : "Time limit") + " — filter clogging, stopped at " + (int)sampledMl + " mL");
        enter(PRESERVE);
      }
      break;
    }
    case PRESERVE: {
      unsigned long dose = (unsigned long)(rules.ethanolMl / ETHANOL_ML_S * 1000);
      if (el < 3000) return;                          // drain to the waste tray
      if (el < 3000 + dose) { if (!pumpE) setPumps(false, true); return; }
      setPumps(false, false);
      logMsg(String("Cartridge ") + tube + " preserved with " + String(rules.ethanolMl, 1) + " mL ethanol (seat " + seatNow() + ")");
      enter(LOG);
      break;
    }
    case LOG: {
      JsonDocument d; d["t"] = "sample"; d["mission"] = mission["id"]; d["tube"] = tube; d["seat"] = seatNow(); d["site"] = siteId(); d["name"] = siteName();
      JsonObject s = siteIdx >= 0 ? site() : mission["sites"][0].as<JsonObject>();
      if (gps.location.isValid()) { d["lat"] = gps.location.lat(); d["lon"] = gps.location.lng(); }
      else { d["lat"] = s["lat"]; d["lon"] = s["lon"]; }
      time_t nowT = time(nullptr); d["ts"] = nowT > 1700000000 ? (double)nowT * 1000.0 : (double)millis();
      d["ml"] = (int)sampledMl; d["target"] = (int)targetMl; d["ph"] = serialized(String(phNow, 2)); d["ntu"] = serialized(String(ntuNow, 1));
      d["temp"] = serialized(String(tempNow, 1)); d["blank"] = siteIdx < 0; d["clog"] = clogged;
      emit(d);
      String line; serializeJson(d, line); sdAppend(line);
      tubesDone++; enter(RINSE);
      break;
    }
    case RINSE:
      if (el < 800) { press(false); return; }
      setPumps(true, false);
      if (el >= 800 + (unsigned long)(rules.rinseMl / cal.mlPerS * 1000)) { setPumps(false, false); tube++; nextSiteOrDone(); }
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
    JsonDocument d; d["t"] = "hello"; d["id"] = DEVICE_ID; d["fw"] = FW_VERSION; d["seats"] = SEATS; d["bat"] = serialized(String(batNow, 2)); emit(d);
  } else if (!strcmp(cmd, "settime")) {
    struct timeval tv = { (time_t)((m["ts"] | 0.0) / 1000.0), 0 }; settimeofday(&tv, nullptr);
  } else if (!strcmp(cmd, "start")) { autoPlaced = false; startMission(m["mission"].as<JsonObject>()); }
  else if (!strcmp(cmd, "pause")) { if (st != IDLE) { paused = true; setPumps(false, false); logMsg("Paused — pumps stopped"); } }
  else if (!strcmp(cmd, "resume")) { if (paused) { paused = false; lastPumpTick = millis(); logMsg("Resumed"); } }
  else if (!strcmp(cmd, "abort")) { if (st != IDLE) finishMission(true, "Safe stop: pumps off, nozzle lifted"); }
  else if (!strcmp(cmd, "placed") || !strcmp(cmd, "arrived")) { placed = true; if (st == INDEX) logMsg(String("Pod placed at ") + siteName()); }
  else if (!strcmp(cmd, "home")) { if (st == IDLE) { homeCarousel(); logMsg("Carousel homed — seat 1 under the nozzle"); } else errMsg("BUSY", "Mission running"); }
  else if (!strcmp(cmd, "read")) {
    readWater(); JsonDocument d; d["t"] = "raw";
    d["phV"] = serialized(String(adcVolts(PIN_PH) * 1.5f, 3)); d["ntuV"] = serialized(String(adcVolts(PIN_TURBIDITY) * 1.5f, 3)); d["temp"] = serialized(String(tempNow, 1));
    emit(d);
  } else if (!strcmp(cmd, "pump")) {
    if (st != IDLE) { errMsg("BUSY", "Mission running"); return; }
    calPump = (m["which"] | "S")[0]; calPumpS = m["seconds"] | 10; calPumpUntil = millis() + calPumpS * 1000UL;
    setPumps(calPump == 'S', calPump == 'E');
    logMsg(String("Calibration: pump ") + calPump + " on for " + calPumpS + " s");
  } else if (!strcmp(cmd, "setcal")) {
    cal.v7 = m["ph"]["v7"] | cal.v7; cal.v4 = m["ph"]["v4"] | cal.v4; cal.ntuZeroV = m["ntuZeroV"] | cal.ntuZeroV; cal.mlPerS = m["mlPerS"] | cal.mlPerS;
    if (m["carousel"].is<JsonObject>()) { SEATS = m["carousel"]["seats"] | SEATS; STEPS_PER_SEAT = m["carousel"]["stepsPerSeat"] | STEPS_PER_SEAT; }
    JsonDocument d; d["t"] = "ack"; d["cmd"] = "setcal"; d["ok"] = true; emit(d);
  } else if (!strcmp(cmd, "schedule")) {
    strlcpy(sched.mode, m["mode"] | "now", sizeof(sched.mode));
    const char *t = !strcmp(sched.mode, "tide") ? (m["tide"] | "") : (m["time"] | "");
    sched.armed = sscanf(t, "%d:%d", &sched.hh, &sched.mm) == 2 && strcmp(sched.mode, "now");
    schedMission.clear(); schedMission.set(m["mission"]);
    JsonDocument d; d["t"] = "ack"; d["cmd"] = "schedule"; d["ok"] = sched.armed; d["msg"] = sched.armed ? String("Will start at ") + t + (time(nullptr) < 1700000000 ? " (clock not set — reconnect the console)" : "") : String("No time set"); emit(d);
  } else errMsg("CMD", String("Unknown command ") + cmd);
}

// ───────────── Telemetry ─────────────
void telemetry() {
  JsonDocument d; d["t"] = "tele"; d["state"] = ST_NAME[st]; d["site"] = siteName(); d["tube"] = tube; d["seat"] = seatNow(); d["press"] = (int)pressed;
  d["bat"] = serialized(String(batNow, 2)); d["ph"] = serialized(String(phNow, 2)); d["ntu"] = serialized(String(ntuNow, 1)); d["temp"] = serialized(String(tempNow, 1));
  d["ml"] = (int)sampledMl; d["target"] = (int)targetMl; d["flow"] = serialized(String(pumpS ? cal.mlPerS : 0, 2)); d["cur"] = serialized(String(ampsNow, 2));
  d["pumpS"] = (int)pumpS; d["pumpE"] = (int)pumpE; d["rain"] = (int)raining(); d["paused"] = (int)paused;
  emit(d);
}

// ───────────── Setup / loop ─────────────
void setup() {
  Serial.begin(115200);
  inbox = xQueueCreate(8, sizeof(Line));
  pinMode(PIN_PUMP_S, OUTPUT); pinMode(PIN_PUMP_E, OUTPUT); setPumps(false, false);
  pinMode(EN_PIN, OUTPUT); digitalWrite(EN_PIN, HIGH);
  pinMode(PIN_HOME, INPUT_PULLUP); pinMode(PIN_FLOAT, INPUT);
  analogReadResolution(12);
  carousel.setMaxSpeed(1200); carousel.setAcceleration(800);
  nozzle.attach(PIN_SERVO, 500, 2400); press(false);

  Wire.begin(21, 22);
  inaOK = ina.begin();
  thermo.begin();
  GPSSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  sdOK = SD.begin(PIN_SD_CS);

  WiFi.softAP(DEVICE_ID, WIFI_PASS);
  if (LittleFS.begin(true)) http.serveStatic("/", LittleFS, "/").setDefaultFile("console.html");
  ws.onEvent(onWs); http.addHandler(&ws); http.begin();

  NimBLEDevice::init(DEVICE_ID);
  NimBLEServer *srv = NimBLEDevice::createServer(); srv->setCallbacks(new SrvCB());
  NimBLEService *svc = srv->createService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
  NimBLECharacteristic *rx = svc->createCharacteristic("6E400002-B5A3-F393-E0A9-E50E24DCCA9E", NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCB());
  bleTx = svc->createCharacteristic("6E400003-B5A3-F393-E0A9-E50E24DCCA9E", NIMBLE_PROPERTY::NOTIFY);
  svc->start();
  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising(); adv->addServiceUUID(svc->getUUID()); adv->start();

  setenv("TZ", "UTC-4", 1); tzset();   // POSIX sign is inverted: UTC-4 means UTC+4 (Dubai)
  readPower();
  logMsg(String("eDNA Pod ") + FW_VERSION + " ready · Wi-Fi " + DEVICE_ID + " · http://192.168.4.1" + (sdOK ? " · SD OK" : " · no SD card"));
}

String serialBuf;
unsigned long lastTele = 0, lastSched = 0, rainSince = 0;
void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { pushLine(serialBuf.c_str(), serialBuf.length()); serialBuf = ""; }
    else if (c != '\r' && serialBuf.length() < 500) serialBuf += c;
  }
  Line l; while (xQueueReceive(inbox, &l, 0) == pdTRUE) handle(l.s);
  while (GPSSerial.available()) gps.encode(GPSSerial.read());
  if (gps.time.isValid() && gps.date.isValid() && time(nullptr) < 1700000000) {   // GPS sets the clock in the field
    struct tm t = {}; t.tm_year = gps.date.year() - 1900; t.tm_mon = gps.date.month() - 1; t.tm_mday = gps.date.day();
    t.tm_hour = gps.time.hour(); t.tm_min = gps.time.minute(); t.tm_sec = gps.time.second();
    setenv("TZ", "UTC0", 1); tzset(); time_t utc = mktime(&t); setenv("TZ", "UTC-4", 1); tzset();
    struct timeval tv = { utc, 0 }; settimeofday(&tv, nullptr);
  }

  carousel.run();
  if (calPumpUntil && millis() > calPumpUntil) {
    setPumps(false, false); calPumpUntil = 0;
    JsonDocument d; d["t"] = "pumped"; d["which"] = String(calPump); d["seconds"] = calPumpS; emit(d);
  }
  missionTick();

  if (millis() - lastTele > 250) { lastTele = millis(); readPower(); if (st == TEST || st == SAMPLE) readWater(); telemetry(); ws.cleanupClients(); }

  // Rain mode: a stored mission starts when the pad stays wet for 2 min and the reservoir float is up
  if (st == IDLE && !strcmp(sched.mode, "rain") && schedMission.size()) {
    if (raining()) { if (!rainSince) rainSince = millis(); } else rainSince = 0;
    if (rainSince && millis() - rainSince > 120000 && digitalRead(PIN_FLOAT) == LOW) {
      rainSince = 0; logMsg("Rain detected — canopy sample starting");
      autoPlaced = true; startMission(schedMission.as<JsonObject>());
    }
  }
  // Timed schedule (nightly / after-rain time)
  if (sched.armed && st == IDLE && millis() - lastSched > 10000) {
    lastSched = millis();
    time_t now = time(nullptr); struct tm t; localtime_r(&now, &t);
    if (now > 1700000000 && t.tm_hour == sched.hh && t.tm_min == sched.mm && t.tm_yday != sched.lastDay) {
      sched.lastDay = t.tm_yday; logMsg("Scheduled mission starting");
      autoPlaced = true; startMission(schedMission.as<JsonObject>());   // staked already: no confirm needed
    }
  }
}
