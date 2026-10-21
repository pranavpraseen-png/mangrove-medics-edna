/*
  eDNA Pod firmware — Team Canopy Keepers (FIRST LEGO League BIOGLOW 2026–27)

  ESP32 DevKit inside the eDNA Pod with an 8-seat filter carousel.
  Talks to the eDNA Collector Console in newline-delimited JSON over USB serial,
  Bluetooth LE (Nordic UART) and Wi-Fi (WebSocket). See firmware/README.md → "Console protocol".
  A mission can also run with NO console: press the START button.

  ONE MISSION (docs/DECISIONS.md is the source of truth)
    seat 1      FIELD BLANK  1 L distilled water. Always first; samples are refused until it is done.
    seat 8      FLUSH        250 mL of site water to waste, before each site's samples (no filter)
    seats 2–7   SAMPLES      6 real samples = 2 sites × 3 replicates (or 1 site × 6)

  PLUMBING (pull-through): intake → cartridge (filter) → nozzle → sample pump → waste bottle on a load cell.
  The pump only ever touches filtered water, and suction can't burst a tube.

  STOP RULE for every filter: stop at 1 L (VOLUME), at 20 min of pumping (TIME), or when the flow falls
  below 20 mL/min (CLOG or AIR). A sample only counts ("valid") if at least 250 mL went through.

  For each job the Pod goes:  MOVE → (WAIT for you) → SEAL → PUMP → PRESERVE → LOG
    MOVE      nozzle up, stepper turns forward to the seat, the hall sensor must see that seat's magnet
    WAIT      press START (or "continue" in the console) when the Pod asks for something
    SEAL      servo presses the nozzle onto the seat
    PUMP      sample pump runs; volume from the load cell (1 g = 1 mL), clog/air from the pump current
    PRESERVE  drain, then the second pump adds ≥95% ethanol (blank and samples only)
    LOG       record saved to SD (flushed) + flash, read back to check, and sent to the console

  STATUS: NOT yet tested on hardware. Bring up one part at a time (firmware/README.md).

  Libraries (Arduino Library Manager):
    ArduinoJson 7.x · NimBLE-Arduino 1.4.x · ESPAsyncWebServer + AsyncTCP · AccelStepper · ESP32Servo
    Adafruit INA219 · Adafruit ADS1X15 · RTClib · HX711 (Rob Tillaart) · OneWire · DallasTemperature · TinyGPSPlus
*/
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <LittleFS.h>
#include <SPI.h>
#include <SD.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <AccelStepper.h>
#include <ESP32Servo.h>
#include <Adafruit_INA219.h>
#include <Adafruit_ADS1X15.h>
#include <RTClib.h>
#include <HX711.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <TinyGPSPlus.h>
#include <time.h>
#include <sys/time.h>
#include <esp_sleep.h>
#include <driver/gpio.h>

#include "config.h"        // pins and all the numbers you can tune

// ───────────── Identity ─────────────
#define FW_VERSION   "3.0.0"
#define PROTOCOL_VER 3
#define DEVICE_ID    "EDNA-01"           // BLE name + Wi-Fi network name
// Wi-Fi password lives in secrets.h, which is never committed to GitHub.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Missing secrets.h: copy secrets.example.h to secrets.h and set WIFI_PASS"
#endif

// ═════════════ Types (kept above every function so the Arduino builder is happy) ═════════════
enum Role { ROLE_BLANK, ROLE_FLUSH, ROLE_SAMPLE };
const char *ROLE_NAME[] = { "BLANK", "FLUSH", "SAMPLE" };

enum Stop { STOP_NONE, STOP_VOLUME, STOP_TIME, STOP_CLOG, STOP_AIR, STOP_ABORT };
const char *STOP_NAME[] = { "", "VOLUME", "TIME", "CLOG", "AIR", "ABORT" };

enum St { ST_IDLE, ST_SELFCHECK, ST_MOVE, ST_WAIT, ST_SEAL, ST_PUMP, ST_AIR_WAIT, ST_PRESERVE, ST_LOG };
const char *ST_NAME[] = { "IDLE", "SELFCHECK", "MOVE", "WAIT", "SEAL", "PUMP", "AIR_WAIT", "PRESERVE", "LOG" };

enum Wait { WAIT_NONE, WAIT_BLANK_WATER, WAIT_SITE, WAIT_EMPTY_BOTTLE, WAIT_WATER, WAIT_AIR };
const char *WAIT_NAME[] = { "", "BLANK_WATER", "SITE", "EMPTY_BOTTLE", "WATER", "AIR" };

struct Job  { Role role; int seat; int site; int rep; };       // one line of the mission plan
struct Site { char code[9]; char name[41]; double lat, lon; bool hasLoc; };
struct Line { char s[512]; };

// Calibration — saved in the ESP32's flash (Preferences) so a START-button mission has it too
struct Cal {
  float v7 = 2.50, v4 = 3.05;          // pH probe volts in pH 7 and pH 4 buffer
  float ntuZeroV = 4.20;               // turbidity volts in clear water
  float flowMlMin = DEFAULT_FLOW_ML_MIN; // pump flow WITH a filter (used only if there is no load cell)
  int   stepsPerSeat = STEPS_PER_SEAT_DEFAULT;
  float hxScale = HX711_SCALE_DEFAULT; // load-cell counts per gram
  long  hxOffset = 0;                  // load-cell reading with the EMPTY waste bottle on it
  bool  hxCal = false;                 // true after "scalecal" — until then volume uses pump time
  int   idleSleepMin = IDLE_SLEEP_MIN_DEFAULT;
} cal;

struct Rules {                         // defaults = DECISIONS.md; the console may override for bench tests
  float targetMl = TARGET_ML, blankMl = BLANK_ML, flushMl = FLUSH_ML, maxMin = MAX_PUMP_MIN;
  float minFlowMlMin = MIN_FLOW_ML_MIN, minValidMl = MIN_VALID_ML, ethanolMl = ETHANOL_ML;
} rules;

// Everything we measure during one filter run
struct Run {
  bool active;
  uint32_t startUtc, endUtc;
  float targetMl, volumeMl;
  unsigned long pumpMs, lastTickMs, lastSecondMs;
  Stop stop;
  bool useScale; float gramsAtStart;
  float timeBaseMl; unsigned long timeBaseMs;      // used if the load cell drops out mid-run
  double tempSum, ntuSum, phSum; int tempN, ntuN, phN;
  double latSum, lonSum, hdopSum; int fixN, satsMax;
  double baseSum; int baseN; float baseAmps;        // "normal" pump current for this filter
  unsigned long clogSince, airSince, floatDrySince;
  float hist[FLOW_WINDOW_S + 1]; int histN;         // volume once a second, for the flow rate
  float flowMlMin; bool flowKnown;
  bool floatOverride, bottleOverride;
};

struct Sched { char mode[8] = "now"; int hh = -1, mm = -1; bool armed = false; int lastDay = -1; };

// ═════════════ Hardware objects ═════════════
AccelStepper carousel(AccelStepper::DRIVER, PIN_STEP, PIN_DIR);
Servo nozzle;
Adafruit_INA219 ina;
Adafruit_ADS1115 ads;
RTC_DS3231 rtc;
HX711 scale;
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature thermo(&oneWire);
TinyGPSPlus gps;
HardwareSerial GPSSerial(2);
AsyncWebServer http(80);
AsyncWebSocket ws("/ws");
NimBLECharacteristic *bleTx = nullptr;
Preferences prefs;

// Which parts answered at start-up
bool inaOK = false, adsOK = false, rtcOK = false, rtcValid = false, hxOK = false;
bool sdOK = false, flashOK = false, bleConnected = false;
DeviceAddress waterAddr, batAddr; bool waterProbeOK = false, batProbeOK = false;

// Latest sensor values (NAN = unknown → "NA" in the CSV, null in JSON)
float ntuNow = NAN, phNow = NAN, waterTempNow = NAN, batTempNow = NAN, batNow = NAN, ampsNow = 0;
float gramsNow = NAN; unsigned long lastGramsMs = 0;
bool sensorsOn = false; unsigned long sensorsOnSince = 0;

// Mission state
St st = ST_IDLE; Wait waitFor = WAIT_NONE;
Site sites[MAX_SITES]; int siteCount = 0;
Job plan[1 + MAX_SITES + SAMPLE_SEATS]; int jobCount = 0, jobIdx = 0;
char missionId[24] = "";
bool paused = false, autoPlaced = false, blankDone = false, moveRetried = false;
int moveStage = 0, samplesDone = 0, samplesValid = 0;
unsigned long phaseT = 0;
Run run;
bool errorLatched = false, doneLatched = false, hotLatched = false;
struct { bool set = false; double lat = 0, lon = 0; char label[33] = ""; } manualLoc;

// Console / power bookkeeping
unsigned long lastCmdMs = 0, lastActivityMs = 0;
unsigned long calPumpUntil = 0; char calPump = 0; int calPumpS = 0; float calPumpG0 = NAN;
Sched sched; JsonDocument schedMission;
bool gpsSynced = false; unsigned long lastGpsSyncMs = 0;
bool cpuIsSlow = false;

// ═════════════ Incoming lines from three links → one queue ═════════════
QueueHandle_t inbox;
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

// ═════════════ Outgoing: the same line goes to every link ═════════════
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
void ack(const char *cmd, bool ok, const String &msg = "") {
  JsonDocument d; d["t"] = "ack"; d["cmd"] = cmd; d["ok"] = ok; if (msg.length()) d["msg"] = msg; emit(d);
}

// Numbers that may be unknown: NAN → null in JSON, "NA" in CSV
void putNum(JsonVariant v, float x, int digits) { if (isnan(x)) v.set(nullptr); else v.set(serialized(String(x, digits))); }
String csvNum(float x, int digits) { return isnan(x) ? String("NA") : String(x, digits); }

// ═════════════ Clock: DS3231 RTC, set from GPS when there is a fix ═════════════
uint32_t nowUtc() {                       // seconds since 1970, UTC
  if (rtcOK && rtcValid) return rtc.now().unixtime();
  return (uint32_t)time(nullptr);
}
bool clockValid() { return nowUtc() > 1700000000UL; }
void setClock(uint32_t utc, const char *source) {
  struct timeval tv = { (time_t)utc, 0 }; settimeofday(&tv, nullptr);
  if (rtcOK) { rtc.adjust(DateTime(utc)); rtcValid = true; }
  logMsg(String("Clock set from ") + source);
}
String isoLocal(uint32_t utc) {           // "2026-12-06T10:15:00+04:00"
  if (utc < 1700000000UL) return "";
  time_t t = utc + TZ_OFFSET_S; struct tm tm; gmtime_r(&t, &tm);
  char b[32]; strftime(b, sizeof(b), "%Y-%m-%dT%H:%M:%S", &tm);
  return String(b) + TZ_SUFFIX;
}
String dateCode(uint32_t utc) {           // "20261206" for the sample ID
  if (utc < 1700000000UL) return "00000000";
  time_t t = utc + TZ_OFFSET_S; struct tm tm; gmtime_r(&t, &tm);
  char b[12]; strftime(b, sizeof(b), "%Y%m%d", &tm); return b;
}
void gpsClockTick() {                     // copy satellite time into the RTC (at most once an hour)
  if (!gps.date.isValid() || !gps.time.isValid() || gps.time.age() > 1500 || gps.date.year() < 2025) return;
  if (gpsSynced && millis() - lastGpsSyncMs < 3600000UL) return;
  DateTime dt(gps.date.year(), gps.date.month(), gps.date.day(), gps.time.hour(), gps.time.minute(), gps.time.second());
  setClock(dt.unixtime(), "GPS");
  gpsSynced = true; lastGpsSyncMs = millis();
}
bool gpsFresh() { return sensorsOn && gps.location.isValid() && gps.location.age() < GPS_FRESH_MS; }

// ═════════════ Power switches ═════════════
void sensorsPower(bool on) {             // GPS + turbidity + pH + leak sensor rail
  if (on == sensorsOn) return;
  digitalWrite(PIN_SENSOR_PWR, on ? SENSOR_PWR_ON_LEVEL : !SENSOR_PWR_ON_LEVEL);
  sensorsOn = on; sensorsOnSince = millis();
  if (!on) { ntuNow = NAN; phNow = NAN; }
}
bool sensorsWarm() { return sensorsOn && millis() - sensorsOnSince > SENSOR_WARMUP_MS; }
void driverOn()  { digitalWrite(PIN_EN, LOW); }
void driverOff() { digitalWrite(PIN_EN, HIGH); }    // no holding current between moves (saves ~10 Wh)
bool consoleActive() { return bleConnected || ws.count() > 0 || (lastCmdMs && millis() - lastCmdMs < CONSOLE_TIMEOUT_MS); }
void cpuSlow(bool slow) {
  if (!SLOW_CPU_WHEN_WAITING || slow == cpuIsSlow) return;
  setCpuFrequencyMhz(slow ? 80 : 240); cpuIsSlow = slow;
}

// ═════════════ Actuators ═════════════
bool pumpS = false, pumpE = false, pressed = false;
void setPumps(bool s, bool e) {
  pumpS = s; pumpE = e;
  analogWrite(PIN_PUMP_SAMPLE, s ? PUMP_PWM : 0);
  analogWrite(PIN_PUMP_ETHANOL, e ? ETHANOL_PWM : 0);
}
void press(bool down) { pressed = down; nozzle.write(down ? SERVO_DOWN : SERVO_UP); }
void allStop() { setPumps(false, false); press(false); carousel.stop(); carousel.setCurrentPosition(carousel.currentPosition()); driverOff(); }

// ═════════════ Carousel + hall sensor ═════════════
bool hallActive() { return digitalRead(PIN_HALL) == HALL_ACTIVE_LEVEL; }
long revSteps() { return (long)SEATS * cal.stepsPerSeat; }
long floorMod(long a, long b) { long m = a % b; return m < 0 ? m + b : m; }
int seatNow() { return floorMod(carousel.currentPosition() + cal.stepsPerSeat / 2, revSteps()) / cal.stepsPerSeat + 1; }
void seatTo(int seat) {                  // always turns FORWARD (no backlash) to the seat
  long cur = carousel.currentPosition();
  long target = cur - floorMod(cur, revSteps()) + (long)(seat - 1) * cal.stepsPerSeat;
  if (target < cur) target += revSteps();
  driverOn(); carousel.moveTo(target);
}
// Find seat 1: turn slowly and measure how long each magnet stays "on".
// Seat 1 has a double magnet, so its window is wider than HOME_SPAN_MIN_STEPS.
// Short and blocking (about 11 s for a full turn); only used while nothing else is happening.
bool homeCarousel() {
  press(false); delay(LIFT_MS);
  driverOn(); carousel.setSpeed(HOME_SPEED);
  bool wasOn = hallActive();             // if we start ON a magnet, skip that window (we don't know its start)
  long onStart = -1;
  unsigned long timeout = (unsigned long)(revSteps() * 1.5f / HOME_SPEED * 1000);
  unsigned long t0 = millis();
  while (millis() - t0 < timeout) {
    carousel.runSpeed();
    bool on = hallActive();
    if (on && !wasOn) onStart = carousel.currentPosition();
    if (!on && wasOn && onStart >= 0) {
      long span = carousel.currentPosition() - onStart;
      if (span >= HOME_SPAN_MIN_STEPS) {             // found the double magnet = seat 1
        long centre = onStart + span / 2;
        carousel.setCurrentPosition(carousel.currentPosition() - centre);   // centre of seat 1 = 0
        carousel.runToNewPosition(0);                 // back up a few steps to the centre
        bool ok = hallActive();
        driverOff();
        return ok;
      }
    }
    wasOn = on;
  }
  driverOff();
  return false;
}

// ═════════════ Sensors ═════════════
float adsVolts(int ch) { return ads.computeVolts(ads.readADC_SingleEnded(ch)); }
float turbidityVolts() {                 // volts at the SENSOR (before the divider)
  if (adsOK) return adsVolts(ADS_CH_TURBIDITY) * DIVIDER_GAIN;
  float v = 0; for (int i = 0; i < 8; i++) v += analogReadMilliVolts(PIN_TURB_FALLBACK);   // fallback: ESP32 ADC
  return v / 8 / 1000.0f * DIVIDER_GAIN;
}
float phVolts() { return adsOK ? adsVolts(ADS_CH_PH) * DIVIDER_GAIN : NAN; }   // pH needs the ADS1115
bool leakWet() { return adsOK && sensorsOn && adsVolts(ADS_CH_LEAK) < LEAK_WET_VOLTS; }
bool floatWet() { return digitalRead(PIN_FLOAT) == FLOAT_WET_LEVEL; }

void readWater() {                       // turbidity + pH (only when the sensor rail is warm)
  if (!sensorsWarm()) { ntuNow = NAN; phNow = NAN; return; }
  float t = turbidityVolts();
  ntuNow = max(0.0f, (cal.ntuZeroV - t) * 833.0f);    // DFRobot SEN0189 rough curve, treat as relative
  float v = phVolts();
  phNow = isnan(v) ? NAN : 7.0f + (v - cal.v7) * (3.0f / (cal.v7 - cal.v4));
}
void readPower() {
  if (!inaOK) return;
  batNow = ina.getBusVoltage_V() + ina.getShuntVoltage_mV() / 1000.0f;
  ampsNow = ina.getCurrent_mA() / 1000.0f;
}
// DS18B20s: start a conversion, read it ~800 ms later (no blocking)
unsigned long tempReqMs = 0; bool tempPending = false;
void tempTick() {
  if (!tempPending) { thermo.requestTemperatures(); tempReqMs = millis(); tempPending = true; return; }
  if (millis() - tempReqMs < 800) return;
  tempPending = false;
  if (waterProbeOK) { float c = thermo.getTempC(waterAddr); waterTempNow = c > -50 ? c : NAN; }
  if (batProbeOK)   { float c = thermo.getTempC(batAddr);   batTempNow   = c > -50 ? c : NAN; }
}
void scaleTick() {                       // HX711 gives 10 readings a second
  if (!hxOK || !scale.is_ready()) return;
  float g = scale.get_units(1);
  gramsNow = isnan(gramsNow) ? g : gramsNow + 0.5f * (g - gramsNow);   // light smoothing
  lastGramsMs = millis();
}
bool scaleInUse() { return hxOK && cal.hxCal && !isnan(gramsNow) && millis() - lastGramsMs < 3000; }
bool isZero(const uint8_t *a) { for (int i = 0; i < 8; i++) if (a[i]) return false; return true; }
String addrHex(const uint8_t *a) { char b[17]; for (int i = 0; i < 8; i++) sprintf(b + i * 2, "%02X", a[i]); return b; }
void findProbes() {
  thermo.begin(); thermo.setWaitForConversion(false);
  if (!isZero(WATER_PROBE_ADDR))   { memcpy(waterAddr, WATER_PROBE_ADDR, 8); waterProbeOK = thermo.isConnected(waterAddr); }
  else waterProbeOK = thermo.getAddress(waterAddr, 0);
  if (!isZero(BATTERY_PROBE_ADDR)) { memcpy(batAddr, BATTERY_PROBE_ADDR, 8); batProbeOK = thermo.isConnected(batAddr); }
  else batProbeOK = thermo.getAddress(batAddr, 1);
}

// ═════════════ Saved calibration (flash) ═════════════
void loadCal() {
  prefs.begin("pod", true);
  cal.v7 = prefs.getFloat("v7", cal.v7); cal.v4 = prefs.getFloat("v4", cal.v4);
  cal.ntuZeroV = prefs.getFloat("ntu0", cal.ntuZeroV); cal.flowMlMin = prefs.getFloat("flow", cal.flowMlMin);
  cal.stepsPerSeat = prefs.getInt("sps", cal.stepsPerSeat);
  cal.hxScale = prefs.getFloat("hxS", cal.hxScale); cal.hxOffset = prefs.getLong("hxO", cal.hxOffset);
  cal.hxCal = prefs.getBool("hxC", cal.hxCal); cal.idleSleepMin = prefs.getInt("sleep", cal.idleSleepMin);
  prefs.end();
}
void saveCal() {
  prefs.begin("pod", false);
  prefs.putFloat("v7", cal.v7); prefs.putFloat("v4", cal.v4); prefs.putFloat("ntu0", cal.ntuZeroV);
  prefs.putFloat("flow", cal.flowMlMin); prefs.putInt("sps", cal.stepsPerSeat);
  prefs.putFloat("hxS", cal.hxScale); prefs.putLong("hxO", cal.hxOffset); prefs.putBool("hxC", cal.hxCal);
  prefs.putInt("sleep", cal.idleSleepMin);
  prefs.end();
}

// ═════════════ Data safety: append, flush, read back ═════════════
const char *CSV_PATH = "/samples.csv", *JSONL_PATH = "/samples.jsonl";
const char *CSV_HEADER = "sample_id,mission,seat,role,site,replicate,start_time,end_time,volume_mL,target_mL,"
                         "stop_reason,valid,volume_source,pump_s,lat,lon,hdop,loc_source,temp_C,turbidity_NTU,pH,"
                         "battery_V,battery_temp_C,fw";
bool appendVerified(fs::FS &fs, const char *path, const String &line, const char *header) {
  bool isNew = !fs.exists(path);
  File f = fs.open(path, FILE_APPEND);
  if (!f) return false;
  if (isNew && header) f.println(header);
  f.print(line); f.print('\n');
  f.flush(); f.close();                  // flush + close = really on the card now
  File r = fs.open(path, FILE_READ);     // read the last line back and compare
  if (!r) return false;
  size_t need = line.length() + 1;
  if (r.size() < need) { r.close(); return false; }
  r.seek(r.size() - need);
  String back = r.readStringUntil('\n'); r.close();
  return back == line;
}

// ═════════════ Mission plan ═════════════
Job &job() { return plan[jobIdx]; }
const char *siteCodeOf(const Job &j) { return j.site >= 0 ? sites[j.site].code : "BLANK"; }
const char *siteNameOf(const Job &j) { return j.site >= 0 ? sites[j.site].name : "Field blank"; }
float plannedMl(const Job &j) { return j.role == ROLE_BLANK ? rules.blankMl : j.role == ROLE_FLUSH ? rules.flushMl : rules.targetMl; }

// Blank first, then for each site: flush on seat 8, then its replicates on seats 2–7
void buildPlan() {
  jobCount = 0;
  plan[jobCount++] = { ROLE_BLANK, SEAT_BLANK, -1, 0 };
  int reps = SAMPLE_SEATS / siteCount, seat = SEAT_FIRST_SAMPLE;
  for (int s = 0; s < siteCount; s++) {
    plan[jobCount++] = { ROLE_FLUSH, SEAT_FLUSH, s, 0 };
    for (int r = 1; r <= reps; r++) plan[jobCount++] = { ROLE_SAMPLE, seat++, s, r };
  }
}
void cleanCode(const char *in, char *out, size_t n) {   // "aq-01" → "AQ01" (letters and digits only)
  size_t k = 0;
  for (; *in && k < n - 1; in++) if (isalnum((unsigned char)*in)) out[k++] = toupper((unsigned char)*in);
  out[k] = 0;
}
bool loadMission(JsonObjectConst m, String &why) {
  JsonArrayConst arr = m["sites"].as<JsonArrayConst>();
  int n = arr.size();
  if (n < 1 || n > MAX_SITES) { why = String("Mission needs 1 or 2 sites (got ") + n + ")"; return false; }
  siteCount = n;
  for (int i = 0; i < n; i++) {
    JsonObjectConst s = arr[i];
    Site &x = sites[i];
    const char *code = s["code"] | (s["id"] | "");
    cleanCode(code, x.code, sizeof(x.code));
    if (!x.code[0]) snprintf(x.code, sizeof(x.code), "ST%02d", i + 1);
    strlcpy(x.name, s["name"] | x.code, sizeof(x.name));
    x.hasLoc = s["lat"].is<double>() && s["lon"].is<double>();
    x.lat = s["lat"] | 0.0; x.lon = s["lon"] | 0.0;
  }
  strlcpy(missionId, m["id"] | "mission", sizeof(missionId));
  for (char *p = missionId; *p; p++) if (*p == ',' || *p == '"') *p = '_';   // keep the CSV clean
  JsonObjectConst r = m["rules"];
  rules = Rules();
  rules.targetMl = constrain((float)(r["targetMl"] | rules.targetMl), 10.0f, 2000.0f);
  rules.blankMl = constrain((float)(r["blankMl"] | rules.blankMl), 10.0f, 2000.0f);
  rules.flushMl = constrain((float)(r["flushMl"] | rules.flushMl), 50.0f, 1000.0f);
  rules.maxMin = constrain((float)(r["maxMin"] | rules.maxMin), 1.0f, 60.0f);
  rules.minFlowMlMin = r["minFlowMlMin"] | rules.minFlowMlMin;
  rules.minValidMl = r["minValidMl"] | rules.minValidMl;
  rules.ethanolMl = constrain((float)(r["ethanolMl"] | rules.ethanolMl), 0.0f, 10.0f);
  if (r["blank"].is<bool>() && !r["blank"].as<bool>()) logMsg("Note: the field blank always runs first (team rule)");
  // Calibration sent with the mission (kept for next time too)
  bool calChanged = false;
  if (m["flowMlMin"].is<float>()) { cal.flowMlMin = m["flowMlMin"]; calChanged = true; }
  else if (m["mlPerS"].is<float>()) { cal.flowMlMin = m["mlPerS"].as<float>() * 60; calChanged = true; }   // v2 field
  if (m["carousel"]["stepsPerSeat"].is<int>()) { cal.stepsPerSeat = m["carousel"]["stepsPerSeat"]; calChanged = true; }
  if (calChanged) saveCal();
  buildPlan();
  return true;
}

// ═════════════ Mission state machine ═════════════
void enter(St s) {
  st = s; phaseT = millis();
  JsonDocument d; d["t"] = "step"; d["n"] = (int)s; d["name"] = ST_NAME[s];
  if (s != ST_IDLE && jobCount) {
    const Job &j = job();
    d["job"] = jobIdx + 1; d["jobs"] = jobCount; d["role"] = ROLE_NAME[j.role]; d["seat"] = j.seat;
    d["site"] = siteCodeOf(j); d["siteName"] = siteNameOf(j); d["rep"] = j.rep; d["tube"] = j.seat;
  }
  emit(d);
}
void ask(Wait w, const String &msg) {    // stop and wait for the operator (START button or "continue")
  waitFor = w; enter(w == WAIT_AIR ? ST_AIR_WAIT : ST_WAIT);
  JsonDocument d; d["t"] = "wait"; d["for"] = WAIT_NAME[w]; d["msg"] = msg; d["seat"] = job().seat; d["site"] = siteCodeOf(job());
  emit(d);
}
void saveRecord();
void finishMission(bool aborted, const String &msg = "") {
  if (aborted && run.active && job().role != ROLE_FLUSH && run.volumeMl > 0) {   // a used filter still gets its record
    setPumps(false, false); run.stop = STOP_ABORT; run.endUtc = nowUtc(); saveRecord();
  }
  run.active = false;
  allStop();
  st = ST_IDLE; paused = false; waitFor = WAIT_NONE;
  errorLatched = aborted; doneLatched = !aborted; lastActivityMs = millis();
  JsonDocument d; d["t"] = aborted ? "aborted" : "done"; d["mission"] = missionId;
  d["samples"] = samplesDone; d["valid"] = samplesValid; d["blank"] = blankDone; d["tubes"] = samplesDone + (blankDone ? 1 : 0);
  if (aborted) d["msg"] = msg;
  emit(d);
  enter(ST_IDLE);
}
void beginJob() {
  Job &j = job();
  if (j.role != ROLE_BLANK && !blankDone) {        // safety net: never sample before the blank
    errMsg("BLANK", "Field blank (seat 1) must be done before any sample");
    finishMission(true, "Blank not done"); return;
  }
  run = Run(); moveRetried = false; moveStage = 0;
  enter(ST_MOVE);
}
void startRun() {
  Job &j = job();
  bool floatOverride = run.floatOverride;   // keep the operator's "force" for this filter
  run = Run();
  run.floatOverride = floatOverride;
  run.active = true; run.targetMl = plannedMl(j);
  run.useScale = scaleInUse(); run.gramsAtStart = gramsNow;
  run.startUtc = nowUtc(); run.stop = STOP_NONE;
  logMsg(String(ROLE_NAME[j.role]) + " seat " + j.seat + " · target " + (int)run.targetMl + " mL · volume from " + (run.useScale ? "load cell" : "pump time"));
  enter(ST_SEAL);
}
// Before pumping: is there room in the waste bottle, and is the intake in water?
void readyToPump() {
  Job &j = job();
  if (scaleInUse() && !run.bottleOverride && gramsNow + plannedMl(j) > LOADCELL_MAX_G + BOTTLE_SLACK_G) {
    ask(WAIT_EMPTY_BOTTLE, String("Empty the waste bottle (") + (int)gramsNow + " g in it), put it back, then press START"); return;
  }
  if (j.role != ROLE_BLANK && !floatWet() && !run.floatOverride) {
    ask(WAIT_WATER, "Float switch says the intake is not in water. Put it in, then press START (console can force)"); return;
  }
  startRun();
}
// What happens after the carousel has reached the seat
void afterMove() {
  Job &j = job();
  if (!autoPlaced && j.role == ROLE_BLANK) { ask(WAIT_BLANK_WATER, "Seat 1 FIELD BLANK: put the intake in the 1 L distilled-water bottle, then press START"); return; }
  if (!autoPlaced && j.role == ROLE_FLUSH) {
    ask(WAIT_SITE, String("Site ") + sites[j.site].code + " (" + sites[j.site].name + "): fit a NEW bagged intake tube, bleach the nozzle 10 min and rinse, put the intake in the water, then press START");
    return;
  }
  if (j.role == ROLE_FLUSH) sensorsPower(true);
  readyToPump();
}
void operatorContinue(bool force) {
  lastActivityMs = millis();
  if (st == ST_AIR_WAIT) {
    if (!floatWet() && !force) { errMsg("AIR", "Float still dry — put the intake back in the water (or force from the console)"); return; }
    run.floatOverride = run.floatOverride || force;
    run.clogSince = run.airSince = run.floatDrySince = 0; run.histN = 0; run.flowKnown = false;
    waitFor = WAIT_NONE; setPumps(true, false); run.lastTickMs = run.lastSecondMs = millis();
    logMsg("Intake back in water — pumping again");
    enter(ST_PUMP); return;
  }
  if (st != ST_WAIT) return;
  Wait w = waitFor; waitFor = WAIT_NONE;
  if (w == WAIT_SITE) { sensorsPower(true); logMsg(String("At site ") + sites[job().site].code + " — GPS and sensors on"); }
  if (w == WAIT_EMPTY_BOTTLE && force) run.bottleOverride = true;
  if (w == WAIT_WATER && force) run.floatOverride = true;
  readyToPump();
}
void resumeMission(const char *how) {
  if (!paused) return;
  paused = false; run.lastTickMs = millis();
  if (st == ST_PRESERVE || st == ST_SEAL) phaseT = millis();   // redo the drain + full ethanol dose
  logMsg(String("Resumed") + how);
}
void startMission(JsonObjectConst m, const char *source) {
  if (st != ST_IDLE) { errMsg("BUSY", "A mission is already running"); return; }
  if (hotLatched) { errMsg("HOT", String("Battery is ") + String(batTempNow, 1) + " °C — let it cool below " + (int)BAT_TEMP_OK_C + " °C"); return; }
  String why;
  if (!loadMission(m, why)) { errMsg("MISSION", why); return; }
  if (flashOK) { File f = LittleFS.open("/mission.json", FILE_WRITE); if (f) { serializeJson(m, f); f.close(); } }  // START button reuses it
  jobIdx = 0; blankDone = false; samplesDone = samplesValid = 0; paused = false; waitFor = WAIT_NONE;
  errorLatched = doneLatched = false; lastActivityMs = millis();
  JsonDocument d; d["t"] = "mission"; d["id"] = missionId; d["sites"] = siteCount; d["blank"] = true; d["source"] = source;
  JsonArray jobs = d["jobs"].to<JsonArray>();
  for (int i = 0; i < jobCount; i++) {
    JsonObject o = jobs.add<JsonObject>();
    o["role"] = ROLE_NAME[plan[i].role]; o["seat"] = plan[i].seat; o["site"] = siteCodeOf(plan[i]); o["rep"] = plan[i].rep;
  }
  emit(d);
  sensorsPower(true);                    // GPS starts looking for satellites during the blank
  run = Run();
  enter(ST_SELFCHECK);
}

// Clog or air? Uses the pump current, the float switch and the measured flow.
Stop checkClogOrAir() {
  unsigned long now = millis();
  bool hasBase = run.baseAmps > 0;
  bool hi = hasBase && ampsNow > run.baseAmps + CLOG_AMPS_RISE;
  bool lo = hasBase && ampsNow < run.baseAmps - AIR_AMPS_DROP;
  bool dry = job().role != ROLE_BLANK && !run.floatOverride && !floatWet();
  run.clogSince = hi ? (run.clogSince ? run.clogSince : now) : 0;
  run.airSince = lo ? (run.airSince ? run.airSince : now) : 0;
  run.floatDrySince = dry ? (run.floatDrySince ? run.floatDrySince : now) : 0;
  if (run.clogSince && now - run.clogSince > TRIP_MS) return STOP_CLOG;
  if (run.airSince && now - run.airSince > TRIP_MS) return STOP_AIR;
  if (run.floatDrySince && now - run.floatDrySince > TRIP_MS) return STOP_AIR;
  if (run.useScale && run.flowKnown && run.flowMlMin < rules.minFlowMlMin) {   // flow rule needs the load cell
    if (dry || (hasBase && ampsNow < run.baseAmps - AIR_AMPS_DROP / 2)) return STOP_AIR;
    return STOP_CLOG;
  }
  return STOP_NONE;
}
void updateVolume() {
  if (run.useScale && millis() - lastGramsMs > 3000) {             // load cell stopped answering
    run.useScale = false; run.timeBaseMl = run.volumeMl; run.timeBaseMs = run.pumpMs;
    errMsg("SCALE", "Load cell stopped answering — volume now from pump time");
  }
  if (run.useScale) run.volumeMl = max(0.0f, gramsNow - run.gramsAtStart);   // 1 g of water = 1 mL
  else run.volumeMl = run.timeBaseMl + (run.pumpMs - run.timeBaseMs) / 60000.0f * cal.flowMlMin;
}
void everySecondWhilePumping() {
  Job &j = job();
  float secs = run.pumpMs / 1000.0f;
  // 1. "Normal" current for this filter
  if (inaOK && secs >= BASELINE_FROM_S && secs < BASELINE_TO_S) { run.baseSum += ampsNow; run.baseN++; }
  if (inaOK && secs >= BASELINE_TO_S && run.baseAmps == 0 && run.baseN) run.baseAmps = run.baseSum / run.baseN;
  // 2. Flow over the last FLOW_WINDOW_S seconds
  if (run.histN <= FLOW_WINDOW_S) run.hist[run.histN++] = run.volumeMl;
  else { memmove(run.hist, run.hist + 1, FLOW_WINDOW_S * sizeof(float)); run.hist[FLOW_WINDOW_S] = run.volumeMl; }
  if (run.histN > FLOW_WINDOW_S) {
    run.flowMlMin = (run.hist[FLOW_WINDOW_S] - run.hist[0]) * 60.0f / FLOW_WINDOW_S;
    run.flowKnown = secs >= FLOW_CHECK_AFTER_S;
  } else if (!run.useScale) run.flowMlMin = cal.flowMlMin;
  // 3. Water sensors (not for the blank: the probes are not in the distilled water)
  if (j.role != ROLE_BLANK) {
    readWater();
    if (!isnan(ntuNow)) { run.ntuSum += ntuNow; run.ntuN++; }
    if (!isnan(phNow)) { run.phSum += phNow; run.phN++; }
    if (!isnan(waterTempNow)) { run.tempSum += waterTempNow; run.tempN++; }
  }
  // 4. Average the GPS position while we pump
  if (gpsFresh()) {
    run.latSum += gps.location.lat(); run.lonSum += gps.location.lng(); run.fixN++;
    run.hdopSum += gps.hdop.isValid() ? gps.hdop.hdop() : 99; run.satsMax = max(run.satsMax, (int)gps.satellites.value());
  }
}
void endRun(Stop why) {
  setPumps(false, false);
  run.stop = why; run.endUtc = nowUtc();
  Job &j = job();
  String m = String(ROLE_NAME[j.role]) + " seat " + j.seat + " stopped: " + STOP_NAME[why] + " at " + (int)run.volumeMl + " mL";
  if (why == STOP_CLOG || why == STOP_AIR) errMsg(STOP_NAME[why], m); else logMsg(m);
  if (j.role == ROLE_FLUSH) enter(ST_LOG); else enter(ST_PRESERVE);
}

void missionTick() {
  if (st == ST_IDLE || paused) return;
  unsigned long el = millis() - phaseT;
  switch (st) {
    case ST_SELFCHECK: {
      if (el < 50) return;
      readPower();
      if (inaOK && batNow > BAT_USB_ONLY_V && batNow < BAT_MIN_START_V) { errMsg("LOWBAT", String("Battery ") + String(batNow, 2) + " V — charge before sampling"); finishMission(true, "Battery too low"); return; }
      if (!isnan(batTempNow) && batTempNow >= BAT_TEMP_OK_C) { errMsg("HOT", String("Battery ") + String(batTempNow, 1) + " °C — let it cool first"); finishMission(true, "Battery too hot"); return; }
      if (!batProbeOK) errMsg("NOPROBE", "Battery temperature probe not found — 55 °C cut-off is OFF");
      if (!sdOK) errMsg("SD", "No SD card — records go to flash only");
      if (!scaleInUse()) logMsg("Load cell not calibrated or missing — volume will use pump time × flow");
      if (!homeCarousel()) { errMsg("HOME", "Carousel did not find seat 1 (double magnet)"); finishMission(true, "Homing failed"); return; }
      logMsg(String("Self-check OK · battery ") + (isnan(batNow) ? String("?") : String(batNow, 2)) + " V · GPS " + (gpsFresh() ? "fix" : "searching"));
      jobIdx = 0; beginJob();
      break;
    }
    case ST_MOVE:
      if (moveStage == 0) { press(false); if (el < LIFT_MS) return; seatTo(job().seat); moveStage = 1; return; }
      if (moveStage == 1) { if (carousel.distanceToGo() != 0) return; driverOff(); moveStage = 2; phaseT = millis(); return; }
      if (el < HALL_SETTLE_MS) return;
      if (hallActive()) { afterMove(); return; }
      if (!moveRetried) {                                 // missed the magnet: re-home and try once more
        moveRetried = true;
        errMsg("SEAT", String("No magnet at seat ") + job().seat + " — re-homing and retrying");
        if (!homeCarousel()) { finishMission(true, "Re-homing failed — check the carousel"); return; }
        seatTo(job().seat); moveStage = 1; return;
      }
      errMsg("SEAT", String("Still no magnet at seat ") + job().seat);
      finishMission(true, String("Carousel position not confirmed at seat ") + job().seat + " — stopped so no filter is used by mistake");
      break;
    case ST_WAIT:
      break;                                              // waiting for START / "continue"
    case ST_SEAL:
      press(true);
      if (el < SEAL_MS) return;
      setPumps(true, false); run.lastTickMs = run.lastSecondMs = millis();
      enter(ST_PUMP);
      break;
    case ST_PUMP: {
      unsigned long now = millis();
      if (!pumpS) { setPumps(true, false); run.lastTickMs = now; }     // e.g. after a pause
      run.pumpMs += now - run.lastTickMs; run.lastTickMs = now;
      updateVolume();
      if (now - run.lastSecondMs >= 1000) { run.lastSecondMs += 1000; everySecondWhilePumping(); }
      Stop why = STOP_NONE;
      if (run.volumeMl >= run.targetMl) why = STOP_VOLUME;
      else if (run.pumpMs >= (unsigned long)(rules.maxMin * 60000)) why = STOP_TIME;
      else why = checkClogOrAir();
      if (why == STOP_NONE) return;
      if (why == STOP_AIR && job().role != ROLE_BLANK) {      // blank: air just means the bottle is empty
        setPumps(false, false);
        errMsg("AIR", String("Pumping air at ") + (int)run.volumeMl + " mL — intake out of the water?");
        ask(WAIT_AIR, "Put the intake back in the water and press START (stops by itself after 2 min)");
        return;
      }
      endRun(why);
      break;
    }
    case ST_AIR_WAIT:
      if (el > AIR_GIVE_UP_MS) { waitFor = WAIT_NONE; endRun(STOP_AIR); }
      break;
    case ST_PRESERVE: {
      unsigned long dose = (unsigned long)(rules.ethanolMl / ETHANOL_ML_PER_S * 1000);
      if (el < DRAIN_MS) return;
      if (el < DRAIN_MS + dose) { if (!pumpE) setPumps(false, true); return; }
      setPumps(false, false);
      logMsg(String("Seat ") + job().seat + " preserved with " + String(rules.ethanolMl, 1) + " mL ≥95% ethanol");
      enter(ST_LOG);
      break;
    }
    case ST_LOG: {
      press(false);
      saveRecord();
      Job &j = job();
      if (j.role == ROLE_BLANK) blankDone = true;
      jobIdx++;
      if (jobIdx >= jobCount) { finishMission(false); return; }
      if (plan[jobIdx].role == ROLE_FLUSH && jobIdx > 1) {   // walking to the next site: save power
        sensorsPower(false); logMsg("Site finished — GPS and sensors off until you reach the next site");
      }
      beginJob();
      break;
    }
    default: break;
  }
}

// ═════════════ One record per filter (and per flush) ═════════════
void saveRecord() {
  Job &j = job();
  run.active = false;
  bool valid = j.role == ROLE_FLUSH ? run.stop == STOP_VOLUME : run.volumeMl >= rules.minValidMl;
  if (j.role == ROLE_SAMPLE) { samplesDone++; if (valid) samplesValid++; }
  String id = String("CK-") + dateCode(run.startUtc) + "-" + siteCodeOf(j) + "-S" + j.seat;

  // Where? GPS average → manual entry → mission's site position → unknown
  float lat = NAN, lon = NAN, hdop = NAN; const char *locSrc = "NONE";
  if (run.fixN) { lat = run.latSum / run.fixN; lon = run.lonSum / run.fixN; hdop = run.hdopSum / run.fixN; locSrc = "GPS"; }
  else if (manualLoc.set) { lat = manualLoc.lat; lon = manualLoc.lon; locSrc = "MANUAL"; }
  else if (j.site >= 0 && sites[j.site].hasLoc) { lat = sites[j.site].lat; lon = sites[j.site].lon; locSrc = "MISSION"; }
  bool manual = !strcmp(locSrc, "MANUAL") || !strcmp(locSrc, "MISSION");
  float temp = run.tempN ? run.tempSum / run.tempN : NAN;
  float ntu = run.ntuN ? run.ntuSum / run.ntuN : NAN;
  float ph = run.phN ? run.phSum / run.phN : NAN;
  readPower();

  JsonDocument d;
  d["t"] = "sample";
  d["sample_id"] = id; d["mission"] = missionId; d["seat"] = j.seat; d["role"] = ROLE_NAME[j.role];
  d["site"] = siteCodeOf(j); d["site_name"] = siteNameOf(j); d["replicate"] = j.rep;
  d["start_time"] = isoLocal(run.startUtc); d["end_time"] = isoLocal(run.endUtc);
  putNum(d["volume_mL"], run.volumeMl, 0); d["target_mL"] = (int)run.targetMl;
  d["stop_reason"] = STOP_NAME[run.stop]; d["valid"] = valid;
  d["volume_source"] = run.useScale ? "SCALE" : "TIME"; d["pump_s"] = (int)(run.pumpMs / 1000);
  putNum(d["lat"], lat, 6); putNum(d["lon"], lon, 6);
  if (manual) d["hdop"] = "manual"; else putNum(d["hdop"], hdop, 1);
  d["loc_source"] = locSrc; if (run.fixN) d["sats"] = run.satsMax;
  if (!strcmp(locSrc, "MANUAL") && manualLoc.label[0]) d["loc_label"] = manualLoc.label;
  putNum(d["temp_C"], temp, 1); putNum(d["turbidity_NTU"], ntu, 1); putNum(d["pH"], ph, 2);
  putNum(d["battery_V"], batNow, 2); putNum(d["battery_temp_C"], batTempNow, 1);
  d["ethanol_mL"] = j.role == ROLE_FLUSH ? 0 : rules.ethanolMl; d["fw"] = FW_VERSION;

  String csv = id + "," + missionId + "," + j.seat + "," + ROLE_NAME[j.role] + "," + siteCodeOf(j) + "," + j.rep + "," +
               isoLocal(run.startUtc) + "," + isoLocal(run.endUtc) + "," + csvNum(run.volumeMl, 0) + "," + (int)run.targetMl + "," +
               STOP_NAME[run.stop] + "," + (valid ? "1" : "0") + "," + (run.useScale ? "SCALE" : "TIME") + "," + (int)(run.pumpMs / 1000) + "," +
               csvNum(lat, 6) + "," + csvNum(lon, 6) + "," + (manual ? String("manual") : csvNum(hdop, 1)) + "," + locSrc + "," +
               csvNum(temp, 1) + "," + csvNum(ntu, 1) + "," + csvNum(ph, 2) + "," + csvNum(batNow, 2) + "," + csvNum(batTempNow, 1) + "," + FW_VERSION;

  // Save: SD (CSV + JSON lines) and the ESP32's own flash, each read back to check
  String jsonLine; serializeJson(d, jsonLine);
  if (!sdOK) sdOK = SD.begin(PIN_SD_CS);              // card pushed back in? try once more
  bool okSd = sdOK && appendVerified(SD, CSV_PATH, csv, CSV_HEADER) && appendVerified(SD, JSONL_PATH, jsonLine, nullptr);
  bool okFlash = flashOK && appendVerified(LittleFS, CSV_PATH, csv, CSV_HEADER);
  if (!okSd) sdOK = false;
  if (!okSd || !okFlash) errMsg("SAVE", String("Record ") + id + (okSd ? "" : " NOT on SD") + (okFlash ? "" : " NOT in flash") + " — write it on the paper field sheet");

  // Old (v2) field names so an older console still shows something
  d["tube"] = j.seat; d["name"] = siteNameOf(j); d["ts"] = (double)run.endUtc * 1000.0; d["ml"] = (int)run.volumeMl;
  d["target"] = (int)run.targetMl; d["blank"] = j.role == ROLE_BLANK; d["clog"] = run.stop == STOP_CLOG;
  putNum(d["ph"], ph, 2); putNum(d["ntu"], ntu, 1); putNum(d["temp"], temp, 1);
  d["saved_sd"] = okSd; d["saved_flash"] = okFlash;
  emit(d);
}

// ═════════════ Safety: battery heat and low voltage (checked once a second) ═════════════
unsigned long lowSince = 0;
void safetyCheck() {
  bool running = st != ST_IDLE;
  if (!isnan(batTempNow) && batTempNow >= BAT_TEMP_CUTOFF_C) {
    if (!hotLatched || running || pumpS || pumpE) {
      errMsg("HOT", String("Battery ") + String(batTempNow, 1) + " °C — everything stopped (limit " + (int)BAT_TEMP_CUTOFF_C + " °C). Move it to shade.");
      calPumpUntil = 0; setPumps(false, false);
      if (running) finishMission(true, "Battery too hot");
    }
    hotLatched = true;
  } else if (!isnan(batTempNow) && batTempNow < BAT_TEMP_OK_C) hotLatched = false;

  if (inaOK && batNow > BAT_USB_ONLY_V && batNow < BAT_CUTOFF_V) {
    if (!lowSince) lowSince = millis();
    if (millis() - lowSince > BAT_LOW_TRIP_MS && (running || pumpS || pumpE)) {
      errMsg("LOWBAT", String("Battery ") + String(batNow, 2) + " V — below " + String(BAT_CUTOFF_V, 1) + " V, stopping");
      calPumpUntil = 0; setPumps(false, false);
      if (running) finishMission(true, "Battery low");
      lowSince = 0;
    }
  } else lowSince = 0;

  static bool leakWarned = false;                   // floor leak sensor: warn once per mission
  if (running && !leakWarned && leakWet()) { leakWarned = true; errMsg("LEAK", "Water on the box floor — check the cartridge seals"); }
  if (!running) leakWarned = false;
}

// ═════════════ START button and status LED ═════════════
bool btnDown = false, btnArmed = false, btnLongDone = false; unsigned long btnChangeMs = 0;
void startFromButton() {
  JsonDocument m;
  bool loaded = false;
  if (flashOK && LittleFS.exists("/mission.json")) {
    File f = LittleFS.open("/mission.json", FILE_READ);
    if (f) { loaded = !deserializeJson(m, f); f.close(); }
  }
  if (!loaded) {                                     // nothing from the console yet: 2 sites × 3
    m.clear(); m["id"] = "button";
    JsonArray s = m["sites"].to<JsonArray>();
    JsonObject a = s.add<JsonObject>(); a["code"] = "ST01"; a["name"] = "Site 1";
    JsonObject b = s.add<JsonObject>(); b["code"] = "ST02"; b["name"] = "Site 2";
  }
  logMsg(loaded ? "START button: running the last mission from the console" : "START button: default mission (2 sites × 3)");
  autoPlaced = false;
  startMission(m.as<JsonObjectConst>(), "button");
}
void onShortPress() {
  lastActivityMs = millis();
  if (st == ST_IDLE) {
    if (errorLatched || doneLatched) { errorLatched = doneLatched = false; logMsg("Ready"); return; }
    startFromButton(); return;
  }
  if (st == ST_WAIT || st == ST_AIR_WAIT) { operatorContinue(false); return; }
  if (paused) { resumeMission(" (button)"); return; }
  logMsg("Mission running — hold START for 3 s to stop it safely");
}
void onLongPress() {
  if (st != ST_IDLE) finishMission(true, "Stopped with the START button");
}
void buttonTick() {
  if (!START_BUTTON_FITTED) return;
  bool down = digitalRead(PIN_START_BTN) == LOW;
  unsigned long now = millis();
  if (!btnArmed) { if (!down) { btnArmed = true; btnChangeMs = now; } return; }   // ignore the press that woke us
  if (now - btnChangeMs < BTN_DEBOUNCE_MS) return;
  if (down && !btnDown) { btnDown = true; btnChangeMs = now; btnLongDone = false; }
  else if (!down && btnDown) { btnDown = false; btnChangeMs = now; if (!btnLongDone) onShortPress(); }
  else if (down && !btnLongDone && now - btnChangeMs >= BTN_LONG_MS) { btnLongDone = true; onLongPress(); }
}
const char *ledPattern() {
  if (st == ST_IDLE) return errorLatched ? LED_ERROR : doneLatched ? LED_DONE : LED_READY;
  if (paused) return LED_PAUSED;
  if (st == ST_AIR_WAIT || (st == ST_WAIT && waitFor == WAIT_WATER)) return LED_WATER;
  if (st == ST_WAIT) return LED_WAIT;
  return LED_RUNNING;
}
void ledTick() { const char *p = ledPattern(); digitalWrite(PIN_LED, p[(millis() / 100) % 20] == '#'); }

// ═════════════ Deep sleep while idle (wake with the START button) ═════════════
void goToDeepSleep() {
  logMsg("Going to deep sleep — press START to wake");
  allStop(); sensorsPower(false); digitalWrite(PIN_LED, LOW);
  if (hxOK) scale.power_down();
  delay(100);
  // Hold the stepper driver OFF and both pumps OFF while asleep (these pins would float otherwise)
  pinMode(PIN_EN, OUTPUT); digitalWrite(PIN_EN, HIGH);
  pinMode(PIN_PUMP_SAMPLE, OUTPUT); digitalWrite(PIN_PUMP_SAMPLE, LOW);
  pinMode(PIN_PUMP_ETHANOL, OUTPUT); digitalWrite(PIN_PUMP_ETHANOL, LOW);
  gpio_hold_en((gpio_num_t)PIN_EN); gpio_hold_en((gpio_num_t)PIN_PUMP_SAMPLE); gpio_hold_en((gpio_num_t)PIN_PUMP_ETHANOL);
  gpio_deep_sleep_hold_en();
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_START_BTN, 0);   // button pulls the pin LOW
  esp_deep_sleep_start();
}
void sleepTick() {
  if (!START_BUTTON_FITTED || st != ST_IDLE || calPumpUntil || sched.armed || cal.idleSleepMin <= 0 || consoleActive()) { if (consoleActive()) lastActivityMs = millis(); return; }
  if (millis() - lastActivityMs > (unsigned long)cal.idleSleepMin * 60000UL) goToDeepSleep();
}

// ═════════════ Commands from the console ═════════════
void sendHello() {
  JsonDocument d; d["t"] = "hello"; d["id"] = DEVICE_ID; d["fw"] = FW_VERSION; d["protocol"] = PROTOCOL_VER; d["seats"] = SEATS;
  putNum(d["bat"], batNow, 2);
  JsonObject hw = d["hw"].to<JsonObject>();
  hw["ina219"] = inaOK; hw["ads1115"] = adsOK; hw["rtc"] = rtcOK; hw["rtcValid"] = rtcValid; hw["hx711"] = hxOK; hw["hxCal"] = cal.hxCal;
  hw["sd"] = sdOK; hw["flash"] = flashOK; hw["waterProbe"] = waterProbeOK; hw["batProbe"] = batProbeOK;
  JsonObject lay = d["layout"].to<JsonObject>();
  lay["blank"] = SEAT_BLANK; lay["flush"] = SEAT_FLUSH;
  JsonArray s = lay["samples"].to<JsonArray>(); for (int i = 0; i < SAMPLE_SEATS; i++) s.add(SEAT_FIRST_SAMPLE + i);
  emit(d);
}
void sendRecords(const char *from) {
  bool useSd = !strcmp(from, "sd");
  if (useSd ? !sdOK : !flashOK) { errMsg("SAVE", String("No ") + from + " storage"); return; }
  fs::FS &fs = useSd ? (fs::FS &)SD : (fs::FS &)LittleFS;
  File f = fs.open(CSV_PATH, FILE_READ);
  int n = 0;
  if (f) {
    while (f.available()) {
      String line = f.readStringUntil('\n'); line.trim();
      if (!line.length()) continue;
      JsonDocument d; d["t"] = "record"; d["src"] = from; d["line"] = line; emit(d); n++;
    }
    f.close();
  }
  JsonDocument d; d["t"] = "records_end"; d["src"] = from; d["n"] = n; emit(d);
}
void sendProbes() {
  JsonDocument d; d["t"] = "probes";
  JsonArray a = d["list"].to<JsonArray>();
  thermo.setWaitForConversion(true); thermo.requestTemperatures(); thermo.setWaitForConversion(false); tempPending = false;
  int n = thermo.getDeviceCount();
  for (int i = 0; i < n; i++) {
    DeviceAddress ad; if (!thermo.getAddress(ad, i)) continue;
    JsonObject o = a.add<JsonObject>(); o["addr"] = addrHex(ad); putNum(o["c"], thermo.getTempC(ad), 2);
    o["role"] = (waterProbeOK && !memcmp(ad, waterAddr, 8)) ? "water" : (batProbeOK && !memcmp(ad, batAddr, 8)) ? "battery" : "?";
  }
  emit(d);
}

void handle(const char *line) {
  lastCmdMs = lastActivityMs = millis();
  JsonDocument m;
  if (deserializeJson(m, line)) { errMsg("PARSE", "Bad JSON"); return; }
  const char *cmd = m["cmd"] | "";
  bool idle = st == ST_IDLE;
  if (!strcmp(cmd, "hello")) sendHello();
  else if (!strcmp(cmd, "ping")) { JsonDocument d; d["t"] = "pong"; d["ms"] = millis(); emit(d); }
  else if (!strcmp(cmd, "settime")) {
    uint32_t utc = (uint32_t)((m["ts"] | 0.0) / 1000.0);
    if (utc < 1700000000UL) { ack("settime", false, "Bad time"); return; }
    if (!gpsSynced && (!clockValid() || abs((long)utc - (long)nowUtc()) > 2)) setClock(utc, "console");   // GPS time wins
  }
  else if (!strcmp(cmd, "start")) { autoPlaced = false; startMission(m["mission"].as<JsonObjectConst>(), "console"); }
  else if (!strcmp(cmd, "pause")) { if (!idle) { paused = true; setPumps(false, false); logMsg("Paused — pumps stopped"); } }
  else if (!strcmp(cmd, "resume")) {
    if (st == ST_AIR_WAIT) operatorContinue(m["force"] | false);
    else if (paused) resumeMission("");
  }
  else if (!strcmp(cmd, "continue") || !strcmp(cmd, "placed") || !strcmp(cmd, "arrived") || !strcmp(cmd, "emptied")) {
    if (st == ST_WAIT || st == ST_AIR_WAIT) operatorContinue(m["force"] | false);
    else if (!idle) logMsg("Nothing to confirm right now");
  }
  else if (!strcmp(cmd, "abort")) { if (!idle) finishMission(true, "Safe stop: pumps off, nozzle lifted"); }
  else if (!strcmp(cmd, "home")) {
    if (!idle) { errMsg("BUSY", "Mission running"); return; }
    bool ok = homeCarousel();
    if (ok) logMsg("Carousel homed — seat 1 under the nozzle"); else errMsg("HOME", "Did not find seat 1 (double magnet)");
    ack("home", ok);
  }
  else if (!strcmp(cmd, "seat")) {                       // bench test: go to a seat and check its magnet
    if (!idle) { errMsg("BUSY", "Mission running"); return; }
    int s = m["n"] | 1; if (s < 1 || s > SEATS) { ack("seat", false, "Seat 1–8"); return; }
    press(false); delay(LIFT_MS); seatTo(s);
    while (carousel.distanceToGo() != 0) carousel.run();
    driverOff(); delay(HALL_SETTLE_MS);
    bool ok = hallActive();
    if (!ok) errMsg("SEAT", String("No magnet at seat ") + s);
    JsonDocument d; d["t"] = "ack"; d["cmd"] = "seat"; d["ok"] = ok; d["seat"] = s; emit(d);
  }
  else if (!strcmp(cmd, "read")) {
    bool wasOn = sensorsOn; sensorsPower(true); if (!wasOn) delay(SENSOR_WARMUP_MS + 100);
    readWater(); scaleTick();
    JsonDocument d; d["t"] = "raw";
    putNum(d["phV"], phVolts(), 3); putNum(d["ntuV"], turbidityVolts(), 3); putNum(d["ntu"], ntuNow, 1); putNum(d["ph"], phNow, 2);
    putNum(d["temp"], waterTempNow, 1); putNum(d["batTemp"], batTempNow, 1); putNum(d["grams"], gramsNow, 1);
    d["hall"] = (int)hallActive(); d["float"] = (int)floatWet(); d["leak"] = (int)leakWet(); d["ads"] = adsOK;
    emit(d);
  }
  else if (!strcmp(cmd, "pump")) {
    if (!idle) { errMsg("BUSY", "Mission running"); return; }
    if (hotLatched) { errMsg("HOT", "Battery too hot"); return; }
    calPump = (m["which"] | "S")[0]; calPumpS = constrain((int)(m["seconds"] | 10), 1, 600);
    calPumpUntil = millis() + calPumpS * 1000UL; calPumpG0 = gramsNow;
    setPumps(calPump == 'S', calPump == 'E');
    logMsg(String("Calibration: pump ") + calPump + " on for " + calPumpS + " s");
  }
  else if (!strcmp(cmd, "setcal")) {
    cal.v7 = m["ph"]["v7"] | cal.v7; cal.v4 = m["ph"]["v4"] | cal.v4; cal.ntuZeroV = m["ntuZeroV"] | cal.ntuZeroV;
    if (m["flowMlMin"].is<float>()) cal.flowMlMin = m["flowMlMin"];
    else if (m["mlPerS"].is<float>()) cal.flowMlMin = m["mlPerS"].as<float>() * 60;
    cal.stepsPerSeat = m["carousel"]["stepsPerSeat"] | cal.stepsPerSeat;
    cal.idleSleepMin = m["idleSleepMin"] | cal.idleSleepMin;
    if (m["hxScale"].is<float>()) { cal.hxScale = m["hxScale"]; cal.hxCal = true; if (hxOK) scale.set_scale(cal.hxScale); }
    saveCal(); ack("setcal", true);
  }
  else if (!strcmp(cmd, "tare")) {                       // EMPTY waste bottle on the load cell
    if (!hxOK) { ack("tare", false, "No HX711"); return; }
    scale.tare(20); cal.hxOffset = scale.get_offset(); gramsNow = 0; saveCal();
    ack("tare", true, "Empty bottle = 0 g");
  }
  else if (!strcmp(cmd, "scalecal")) {                   // known weight on top of the empty bottle
    float g = m["grams"] | 0.0f;
    if (!hxOK || g <= 0) { ack("scalecal", false, hxOK ? "Send grams > 0" : "No HX711"); return; }
    scale.calibrate_scale(g, 20); cal.hxScale = scale.get_scale(); cal.hxCal = true; gramsNow = NAN; saveCal();
    JsonDocument d; d["t"] = "ack"; d["cmd"] = "scalecal"; d["ok"] = true; d["hxScale"] = cal.hxScale; emit(d);
  }
  else if (!strcmp(cmd, "setloc")) {                     // indoor tests: no GPS, type the position in
    if (m["clear"] | false) { manualLoc.set = false; ack("setloc", true, "Manual location cleared"); return; }
    if (!m["lat"].is<double>() || !m["lon"].is<double>()) { ack("setloc", false, "Send lat and lon"); return; }
    manualLoc.set = true; manualLoc.lat = m["lat"]; manualLoc.lon = m["lon"]; strlcpy(manualLoc.label, m["label"] | "", sizeof(manualLoc.label));
    ack("setloc", true, String("Manual location ") + String(manualLoc.lat, 6) + ", " + String(manualLoc.lon, 6) + " (used when there is no GPS fix)");
  }
  else if (!strcmp(cmd, "records")) { if (idle) sendRecords(m["from"] | "sd"); else errMsg("BUSY", "Mission running"); }
  else if (!strcmp(cmd, "probes")) sendProbes();
  else if (!strcmp(cmd, "sleep")) { if (idle) goToDeepSleep(); else errMsg("BUSY", "Mission running"); }
  else if (!strcmp(cmd, "schedule")) {
    strlcpy(sched.mode, m["mode"] | "now", sizeof(sched.mode));
    if (!strcmp(sched.mode, "rain")) { sched.armed = false; ack("schedule", false, "Rain mode removed: the rain pad is now the floor leak sensor"); return; }
    const char *t = !strcmp(sched.mode, "tide") ? (m["tide"] | "") : (m["time"] | "");
    sched.armed = sscanf(t, "%d:%d", &sched.hh, &sched.mm) == 2 && strcmp(sched.mode, "now");
    schedMission.clear(); schedMission.set(m["mission"]);
    ack("schedule", sched.armed, sched.armed ? String("Will start at ") + t + (clockValid() ? "" : " (clock not set — reconnect the console)") : String("No time set"));
  }
  else errMsg("CMD", String("Unknown command ") + cmd);
}

// ═════════════ Telemetry (twice a second) ═════════════
void telemetry() {
  bool hasJob = st != ST_IDLE && jobCount;
  JsonDocument d; d["t"] = "tele"; d["state"] = ST_NAME[st];
  d["wait"] = waitFor == WAIT_NONE ? nullptr : WAIT_NAME[waitFor];
  if (hasJob) {
    const Job &j = job();
    d["job"] = jobIdx + 1; d["jobs"] = jobCount; d["role"] = ROLE_NAME[j.role]; d["siteCode"] = siteCodeOf(j); d["site"] = siteNameOf(j); d["rep"] = j.rep;
  }
  d["seat"] = seatNow(); d["tube"] = seatNow(); d["press"] = (int)pressed;
  d["blankDone"] = blankDone; d["samples"] = samplesDone;
  putNum(d["bat"], batNow, 2); putNum(d["batTemp"], batTempNow, 1); putNum(d["cur"], ampsNow, 2);
  putNum(d["ph"], phNow, 2); putNum(d["ntu"], ntuNow, 1); putNum(d["temp"], waterTempNow, 1);
  d["ml"] = (int)run.volumeMl; d["target"] = (int)run.targetMl; d["pumpSec"] = (int)(run.pumpMs / 1000);
  float flow = pumpS ? (run.useScale ? (run.histN > 1 ? run.flowMlMin : NAN) : cal.flowMlMin) : 0;
  putNum(d["flowMlMin"], flow, 0); putNum(d["flow"], isnan(flow) ? NAN : flow / 60.0f, 2);   // "flow" = mL/s (v2)
  putNum(d["grams"], scaleInUse() ? gramsNow : NAN, 0); d["volSrc"] = (st == ST_PUMP ? run.useScale : scaleInUse()) ? "SCALE" : "TIME";
  d["pumpS"] = (int)pumpS; d["pumpE"] = (int)pumpE; d["float"] = (int)floatWet(); d["leak"] = (int)leakWet(); d["rain"] = (int)leakWet();
  d["paused"] = (int)paused; d["sensors"] = (int)sensorsOn;
  d["fix"] = (int)gpsFresh(); if (gpsFresh()) { putNum(d["hdop"], gps.hdop.hdop(), 1); d["sats"] = gps.satellites.value(); }
  d["manualLoc"] = manualLoc.set; d["clock"] = isoLocal(clockValid() ? nowUtc() : 0);
  emit(d);
}

// ═════════════ Setup / loop ═════════════
void setup() {
  // Release the pins we held during deep sleep
  gpio_hold_dis((gpio_num_t)PIN_EN); gpio_hold_dis((gpio_num_t)PIN_PUMP_SAMPLE); gpio_hold_dis((gpio_num_t)PIN_PUMP_ETHANOL);
  gpio_deep_sleep_hold_dis();

  Serial.begin(115200);
  inbox = xQueueCreate(8, sizeof(Line));
  pinMode(PIN_PUMP_SAMPLE, OUTPUT); pinMode(PIN_PUMP_ETHANOL, OUTPUT); setPumps(false, false);
  pinMode(PIN_EN, OUTPUT); driverOff();
  pinMode(PIN_SENSOR_PWR, OUTPUT); digitalWrite(PIN_SENSOR_PWR, !SENSOR_PWR_ON_LEVEL);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_HALL, INPUT_PULLUP); pinMode(PIN_FLOAT, INPUT); pinMode(PIN_START_BTN, INPUT);
  analogReadResolution(12);
  carousel.setMaxSpeed(1200); carousel.setAcceleration(800);
  nozzle.attach(PIN_SERVO, 500, 2400); press(false);
  loadCal();

  Wire.begin(PIN_SDA, PIN_SCL);
  inaOK = ina.begin();
  adsOK = ads.begin(0x48); if (adsOK) ads.setGain(GAIN_ONE);     // ±4.096 V range (inputs are ≤ 3.3 V)
  rtcOK = rtc.begin();
  if (rtcOK && !rtc.lostPower()) {                               // the coin cell kept the time
    rtcValid = true; struct timeval tv = { (time_t)rtc.now().unixtime(), 0 }; settimeofday(&tv, nullptr);
  }
  scale.begin(PIN_HX711_DT, PIN_HX711_SCK, true);
  hxOK = scale.wait_ready_timeout(1000);
  if (hxOK) { scale.set_offset(cal.hxOffset); scale.set_scale(cal.hxScale); }
  findProbes();
  GPSSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, -1);
  sdOK = SD.begin(PIN_SD_CS);

  WiFi.softAP(DEVICE_ID, WIFI_PASS);
  flashOK = LittleFS.begin(true);
  if (flashOK) http.serveStatic("/", LittleFS, "/").setDefaultFile("console.html");   // also serves /samples.csv
  ws.onEvent(onWs); http.addHandler(&ws); http.begin();

  NimBLEDevice::init(DEVICE_ID);
  NimBLEServer *srv = NimBLEDevice::createServer(); srv->setCallbacks(new SrvCB());
  NimBLEService *svc = srv->createService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
  NimBLECharacteristic *rx = svc->createCharacteristic("6E400002-B5A3-F393-E0A9-E50E24DCCA9E", NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCB());
  bleTx = svc->createCharacteristic("6E400003-B5A3-F393-E0A9-E50E24DCCA9E", NIMBLE_PROPERTY::NOTIFY);
  svc->start();
  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising(); adv->addServiceUUID(svc->getUUID()); adv->start();

  readPower();
  lastActivityMs = millis();
  bool woke = esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0;
  logMsg(String("eDNA Pod ") + FW_VERSION + (woke ? " woke up (START) — press START again to begin" : " ready") +
         " · Wi-Fi " + DEVICE_ID + " · http://192.168.4.1" + (sdOK ? " · SD OK" : " · no SD card") +
         (rtcValid ? " · clock OK" : " · clock NOT set") + (hxOK ? (cal.hxCal ? " · load cell OK" : " · load cell needs scalecal") : " · no load cell"));
}

String serialBuf;
unsigned long lastTele = 0, lastSched = 0, lastSecond = 0;
void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { pushLine(serialBuf.c_str(), serialBuf.length()); serialBuf = ""; }
    else if (c != '\r' && serialBuf.length() < 500) serialBuf += c;
  }
  Line l; while (xQueueReceive(inbox, &l, 0) == pdTRUE) handle(l.s);
  while (GPSSerial.available()) gps.encode(GPSSerial.read());

  carousel.run();                                     // keep the stepper moving smoothly
  bool moving = carousel.isRunning();
  buttonTick(); ledTick(); scaleTick();
  if (!moving) {
    gpsClockTick(); tempTick();
    if (calPumpUntil && millis() > calPumpUntil) {
      setPumps(false, false); calPumpUntil = 0;
      JsonDocument d; d["t"] = "pumped"; d["which"] = String(calPump); d["seconds"] = calPumpS;
      if (!isnan(calPumpG0) && scaleInUse()) { float g = gramsNow - calPumpG0; putNum(d["grams"], g, 1); putNum(d["flowMlMin"], g * 60.0f / calPumpS, 1); }
      emit(d);
    }
  }
  missionTick();

  if (!moving && millis() - lastTele > TELE_MS) {       // (BLE sending pauses the loop, so not while moving)
    lastTele = millis(); readPower(); if (st == ST_IDLE) readWater(); telemetry(); ws.cleanupClients();
  }
  if (!moving && millis() - lastSecond > 1000) {
    lastSecond = millis(); safetyCheck();
    if (st == ST_IDLE) sensorsPower(consoleActive());  // idle: sensors on only while someone is watching
    cpuSlow(st == ST_WAIT || st == ST_AIR_WAIT);
    sleepTick();
  }

  // Timed schedule (nightly / after-rain time). Scheduled missions skip the "place the Pod" waits.
  if (sched.armed && st == ST_IDLE && millis() - lastSched > 10000) {
    lastSched = millis();
    uint32_t now = nowUtc(); time_t loc = now + TZ_OFFSET_S; struct tm t; gmtime_r(&loc, &t);
    if (clockValid() && t.tm_hour == sched.hh && t.tm_min == sched.mm && t.tm_yday != sched.lastDay) {
      sched.lastDay = t.tm_yday; logMsg("Scheduled mission starting");
      autoPlaced = true; startMission(schedMission.as<JsonObjectConst>(), "schedule");
    }
  }
}
