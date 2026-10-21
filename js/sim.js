// A software twin of the eDNA Pod, speaking protocol v3 exactly like firmware 3.0.0
// (firmware/README.md → "Console protocol"), so the console runs a full mission with no hardware.
//
// Mission layout (docs/DECISIONS.md, fixed by the Pod): seat 1 BLANK (always first) → per site:
// seat 8 FLUSH (250 mL site water to waste, no filter) → SAMPLE seats (2–4 site A, 5–7 site B; 2–7 with one site).
// Each filter stops at the target (VOLUME), at 20 min (TIME), when flow < 20 mL/min (CLOG) or when
// the intake sucks air (AIR, after a 2-minute AIR_WAIT).

const ST = ['IDLE', 'SELFCHECK', 'MOVE', 'WAIT', 'SEAL', 'PUMP', 'AIR_WAIT', 'PRESERVE', 'LOG'];
const S = Object.fromEntries(ST.map((n, i) => [n, i]));
const SEATS = 8;
const BOTTLE_MAX_G = 5000;           // sim uses a 5 kg load cell
const rand = (a, b) => a + Math.random() * (b - a);
const noise = s => (Math.random() - 0.5) * s;
const pick = a => a[Math.floor(Math.random() * a.length)];
const pad = n => String(n).padStart(2, '0');
const dateCode = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const isoLocal = d => { const o = -d.getTimezoneOffset(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${o >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(o) / 60))}:${pad(Math.abs(o) % 60)}`; };

export class SimDevice {
  constructor(write, opts = {}) {
    this.write = obj => write(JSON.stringify(obj));
    this.speed = opts.speed || 10;
    this.simT = 0; this.paused = false; this.abort = false; this.busy = false;
    this.waiters = []; this.records = [];
    this.cfg = {};          // test hooks: { clogSeat, airSeat, noFix: 'A'|'B'|'all'|'none' }
    this.manualLoc = null;  // from setloc
    this.cal = { flowMlMin: 85 };
    this.io = { state: 'IDLE', wait: null, job: 0, jobs: 0, role: '', siteCode: '', site: '', rep: 0, seat: 1, press: 0, blankDone: false, samples: 0,
      bat: 12.3, batTemp: 31, cur: 0, ph: null, ntu: null, temp: null, ml: 0, target: 0, pumpSec: 0, flowMlMin: 0, grams: 0, volSrc: 'SCALE',
      pumpS: 0, pumpE: 0, float: 1, leak: 0, sensors: 1, fix: 1, hdop: 1.2, sats: 8, lat: null, lon: null, manualLoc: 0 };
  }
  boot() {
    // Advance by real elapsed time, so a busy page (3D rendering) doesn't slow the simulated Pod down.
    this.lastTick = performance.now();
    this.timer = setInterval(() => { const now = performance.now(); this.tick(Math.min(1, (now - this.lastTick) / 1000)); this.lastTick = now; }, 100);
    this.teleTimer = setInterval(() => this.sendTele(), 500);   // 2 Hz like the firmware
    setTimeout(() => this.write({ t: 'log', msg: 'Simulator ready — eDNA Pod twin, firmware sim-3.0.0, protocol 3' }), 50);
  }
  shutdown() { clearInterval(this.timer); clearInterval(this.teleTimer); this.abort = true; this.wake(); }

  tick(dt) {
    if (this.paused) return;
    const d = dt * this.speed;
    this.simT += d;
    const io = this.io;
    io.bat = Math.max(10.2, io.bat - d * (0.00006 + (io.pumpS || io.pumpE ? 0.0002 : 0)));
    const load = io.pumpS && this.capacity ? Math.min(1, io.ml / this.capacity) : 0;
    io.cur = io.pumpS || io.pumpE ? +(this.air ? 0.11 : 0.24 + load * 0.4 + noise(0.02)).toFixed(2) : 0;
    this.wake();
  }
  wake() { this.waiters = this.waiters.filter(w => { if (this.abort || this.simT >= w.at) { w.res(); return false; } return true; }); }
  sleep(simSeconds) { return new Promise(res => this.waiters.push({ at: this.simT + simSeconds, res })); }
  check() { if (this.abort) throw new Error('ABORT'); }

  sendTele() {
    const io = this.io;
    const v = (x, d) => x == null ? null : +(+x + noise(d)).toFixed(2);
    this.write({
      t: 'tele', state: io.state, wait: io.wait, job: io.job, jobs: io.jobs, role: io.role, siteCode: io.siteCode, site: io.site, rep: io.rep,
      seat: io.seat, tube: io.seat, press: io.press, blankDone: io.blankDone, samples: io.samples,
      bat: +io.bat.toFixed(2), batTemp: +(io.batTemp + noise(0.2)).toFixed(1), cur: io.cur,
      ph: v(io.ph, 0.04), ntu: io.ntu == null ? null : +Math.max(0, io.ntu + noise(1.2)).toFixed(1), temp: v(io.temp, 0.1),
      ml: Math.round(io.ml), target: io.target, pumpSec: Math.round(io.pumpSec), flowMlMin: Math.round(io.flowMlMin), flow: +(io.flowMlMin / 60).toFixed(2),
      grams: Math.round(io.grams), volSrc: io.volSrc, pumpS: io.pumpS, pumpE: io.pumpE, float: io.float, leak: 0, rain: 0, paused: this.paused ? 1 : 0,
      sensors: io.sensors, fix: io.fix, hdop: io.fix ? io.hdop : null, sats: io.sats, lat: io.fix ? io.lat : null, lon: io.fix ? io.lon : null,
      manualLoc: this.manualLoc ? 1 : 0, clock: isoLocal(new Date()),
    });
  }

  receive(text) {
    let m; try { m = JSON.parse(text); } catch (e) { return this.write({ t: 'err', code: 'PARSE', msg: 'Bad JSON' }); }
    const idle = !this.busy;
    switch (m.cmd) {
      case 'hello': return this.write({ t: 'hello', id: 'EDNA-SIM', fw: 'sim-3.0.0', protocol: 3, seats: SEATS, bat: +this.io.bat.toFixed(2),
        hw: { ina219: true, ads1115: true, rtc: true, rtcValid: true, hx711: true, hxCal: true, sd: true, flash: true, waterProbe: true, batProbe: true },
        layout: { blank: 1, flush: 8, samples: [2, 3, 4, 5, 6, 7] } });
      case 'ping': return this.write({ t: 'pong', ms: Math.round(performance.now()) });
      case 'start': return this.start(m.mission || {});
      case 'continue': case 'placed': case 'arrived': case 'emptied': this.cont = { force: !!m.force }; this.wake(); return;
      case 'pause': if (!idle) { this.paused = true; this.io.pumpS = this.io.pumpE = 0; this.write({ t: 'log', msg: 'Paused — pumps stopped' }); } return;
      case 'resume': if (this.paused) { this.paused = false; if (this.io.state === 'AIR_WAIT') this.cont = { force: !!m.force }; this.write({ t: 'log', msg: 'Resumed' }); } return;
      case 'abort': if (this.busy) { this.abort = true; this.paused = false; this.wake(); } return;
      case 'settime': return;
      case 'home': if (!idle) return this.write({ t: 'err', code: 'BUSY', msg: 'Mission running' }); this.io.seat = 1; this.io.press = 0; return this.write({ t: 'ack', cmd: 'home', ok: true, msg: 'Seat 1 found (double magnet)' });
      case 'seat': if (!idle) return this.write({ t: 'err', code: 'BUSY', msg: 'Mission running' }); this.io.seat = Math.max(1, Math.min(8, +m.n || 1)); return this.write({ t: 'ack', cmd: 'seat', ok: true, seat: this.io.seat });
      case 'speed': this.speed = Math.max(1, Math.min(200, +m.value || 10)); return this.write({ t: 'log', msg: `Sim speed ×${this.speed}` });
      case 'simcfg': { const { cmd, ...rest } = m; this.cfg = { ...this.cfg, ...rest }; return this.write({ t: 'ack', cmd: 'simcfg', ok: true }); }
      case 'read': return this.write({ t: 'raw', phV: +(2.5 + noise(0.004)).toFixed(3), ntuV: +(4.2 + noise(0.003)).toFixed(3), ntu: 0.5, ph: 7.0, temp: 25.0, batTemp: this.io.batTemp, grams: Math.round(this.io.grams), hall: 1, float: 1, leak: 0, ads: true });
      case 'pump': if (!idle) return this.write({ t: 'err', code: 'BUSY', msg: 'Mission running' }); return this.runPump(m.which || 'S', Math.max(1, Math.min(600, +m.seconds || 10)));
      case 'setcal': if (m.flowMlMin) this.cal.flowMlMin = +m.flowMlMin; else if (m.mlPerS) this.cal.flowMlMin = +m.mlPerS * 60; return this.write({ t: 'ack', cmd: 'setcal', ok: true, msg: 'Calibration saved' });
      case 'tare': this.io.grams = 0; return this.write({ t: 'ack', cmd: 'tare', ok: true, msg: 'Bottle tared' });
      case 'scalecal': return this.write({ t: 'ack', cmd: 'scalecal', ok: !!m.grams, hxScale: 412.7 });
      case 'setloc':
        if (m.clear) { this.manualLoc = null; return this.write({ t: 'ack', cmd: 'setloc', ok: true, msg: 'Manual location cleared' }); }
        if (typeof m.lat !== 'number' || typeof m.lon !== 'number') return this.write({ t: 'ack', cmd: 'setloc', ok: false, msg: 'Send lat and lon' });
        this.manualLoc = { lat: m.lat, lon: m.lon, label: String(m.label || '').slice(0, 24) };
        return this.write({ t: 'ack', cmd: 'setloc', ok: true, msg: `Manual location ${m.lat.toFixed(6)}, ${m.lon.toFixed(6)} (used when there is no GPS fix)` });
      case 'records': {
        if (!idle) return this.write({ t: 'err', code: 'BUSY', msg: 'Mission running' });
        const src = m.from === 'flash' ? 'flash' : 'sd';
        this.write({ t: 'record', src, line: CSV_HEADER });
        this.records.forEach(line => this.write({ t: 'record', src, line }));
        return this.write({ t: 'records_end', src, n: this.records.length });
      }
      case 'probes': return this.write({ t: 'probes', list: [{ addr: '28FF4A1B2C3D4E01', c: 25.1, role: 'water' }, { addr: '28FF4A1B2C3D4E02', c: this.io.batTemp, role: 'battery' }] });
      case 'sleep': return this.write({ t: 'log', msg: 'Simulator does not sleep' });
      case 'schedule': if (m.mode === 'rain') return this.write({ t: 'ack', cmd: 'schedule', ok: false, msg: 'Rain mode was removed (the pad is now a leak sensor)' });
        return this.write({ t: 'ack', cmd: 'schedule', ok: true, msg: `Mission stored for ${m.mode === 'nightly' ? 'nightly ' + m.time : m.mode}` });
      default: return this.write({ t: 'err', code: 'CMD', msg: `Unknown command ${m.cmd}` });
    }
  }

  async runPump(which, seconds) {
    const k = which === 'E' ? 'pumpE' : 'pumpS';
    this.io[k] = 1;
    this.write({ t: 'log', msg: `Calibration: pump ${which} on for ${seconds} s` });
    await new Promise(r => setTimeout(r, seconds * 1000 / Math.max(1, this.speed / 2)));
    this.io[k] = 0;
    const g = Math.round(this.cal.flowMlMin / 60 * seconds * rand(0.97, 1.03));
    this.write({ t: 'pumped', which, seconds, ...(which === 'S' ? { grams: g, flowMlMin: Math.round(g / seconds * 60) } : {}) });
  }

  step(n, j) {
    const io = this.io;
    io.state = ST[n];
    const d = { t: 'step', n, name: ST[n] };
    if (n && j) Object.assign(d, { job: io.job, jobs: io.jobs, role: j.role, seat: j.seat, site: j.code, siteName: j.name, rep: j.rep, tube: j.seat });
    this.write(d);
  }
  async ask(w, msg, j) {
    const io = this.io;
    io.wait = w; this.cont = null;
    this.step(w === 'AIR' ? S.AIR_WAIT : S.WAIT, j);
    this.write({ t: 'wait', for: w, msg, seat: j.seat, site: j.code });
    const t0 = this.simT;
    while (!this.cont) {
      await new Promise(res => setTimeout(res, 100)); this.check();
      if (w === 'AIR' && this.simT - t0 > 120 && !this.paused) break;   // gives up after 2 min
    }
    const c = this.cont; io.wait = null; this.cont = null;
    return c;
  }
  async waitPause() { while (this.paused) { this.io.pumpS = this.io.pumpE = 0; await new Promise(res => setTimeout(res, 120)); this.check(); } }

  plan(sites) {
    const jobs = [{ role: 'BLANK', seat: 1, code: 'BLANK', name: 'Field blank', rep: 0, site: -1 }];
    const per = sites.length === 1 ? 6 : 3;
    sites.forEach((s, i) => {
      jobs.push({ role: 'FLUSH', seat: 8, code: s.code, name: s.name, rep: 0, site: i });
      for (let r = 1; r <= per; r++) jobs.push({ role: 'SAMPLE', seat: 2 + i * 3 + r - 1, code: s.code, name: s.name, rep: r, site: i });
    });
    return jobs;
  }

  async start(mission) {
    if (this.busy) return this.write({ t: 'err', code: 'BUSY', msg: 'A mission is already running' });
    const sites = (Array.isArray(mission.sites) ? mission.sites : []).map((s, i) => ({
      code: String(s.code || s.id || `ST0${i + 1}`).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || `ST0${i + 1}`,
      name: String(s.name || s.code || `Site ${i + 1}`).slice(0, 40), lat: typeof s.lat === 'number' ? s.lat : null, lon: typeof s.lon === 'number' ? s.lon : null,
    }));
    if (sites.length < 1 || sites.length > 2) return this.write({ t: 'err', code: 'MISSION', msg: 'Mission needs 1 or 2 sites' });
    const r = { targetMl: 1000, blankMl: 1000, flushMl: 250, maxMin: 20, minFlowMlMin: 20, minValidMl: 250, ethanolMl: 2, ...(mission.rules || {}) };
    if (mission.flowMlMin) this.cal.flowMlMin = +mission.flowMlMin; else if (mission.mlPerS) this.cal.flowMlMin = mission.mlPerS * 60;
    const id = String(mission.id || 'm_sim').slice(0, 40);
    const jobs = this.plan(sites);
    this.busy = true; this.abort = false; this.paused = false;
    const io = this.io;
    io.jobs = jobs.length; io.blankDone = false; io.samples = 0;
    this.write({ t: 'mission', id, sites: sites.length, blank: true, source: 'console', jobs: jobs.map(j => ({ role: j.role, seat: j.seat, site: j.code, rep: j.rep })) });

    // Site conditions. GPS can drop out (e.g. indoors at The Green Planet); one filter may clog; rarely one sucks air.
    const water = sites.map((s, i) => ({ ntu: i ? rand(14, 40) : rand(3, 12), ph: rand(7.2, 8.1), temp: rand(24, 27.5) }));
    const noFix = this.cfg.noFix || (Math.random() < 0.45 ? (sites.length > 1 ? 'B' : 'A') : 'none');
    const fixAt = i => !(noFix === 'all' || (noFix === 'A' && i === 0) || (noFix === 'B' && i === 1));
    const sampleSeats = jobs.filter(j => j.role === 'SAMPLE').map(j => j.seat);
    const clogSeat = this.cfg.clogSeat ?? (Math.random() < 0.6 ? pick(sampleSeats) : 0);
    const airSeat = this.cfg.airSeat ?? (Math.random() < 0.08 ? pick(sampleSeats.filter(s => s !== clogSeat)) : 0);
    let samples = 0, valid = 0;
    let cur = null;
    try {
      this.step(S.SELFCHECK, jobs[0]);
      io.press = 0; io.sensors = 1;
      await this.sleep(3); this.check();
      this.write({ t: 'log', msg: `Self-check OK · battery ${io.bat.toFixed(2)} V · GPS ${fixAt(0) ? 'fix' : 'searching'}` });

      for (let k = 0; k < jobs.length; k++) {
        const j = jobs[k]; cur = j;
        io.job = k + 1; io.role = j.role; io.siteCode = j.code; io.site = j.name; io.rep = j.rep;
        if (j.role !== 'BLANK' && !io.blankDone) { this.write({ t: 'err', code: 'BLANK', msg: 'Field blank (seat 1) must be done before any sample' }); throw new Error('ABORT'); }
        const w = j.site >= 0 ? water[j.site] : null;
        const si = j.site >= 0 ? j.site : 0;
        // MOVE
        this.step(S.MOVE, j); io.press = 0;
        await this.sleep(2.5); this.check(); await this.waitPause();
        io.seat = j.seat;
        // WAIT (only when the Pod needs you)
        if (j.role === 'BLANK') await this.ask('BLANK_WATER', 'Seat 1 FIELD BLANK: put the intake in the 1 L distilled-water bottle, then press START', j);
        if (j.role === 'FLUSH') await this.ask('SITE', `Site ${j.code} (${j.name}): fit a NEW bagged intake tube, bleach the nozzle 10 min and rinse, put the intake in the water, then press START`, j);
        this.check();
        const target = j.role === 'BLANK' ? r.blankMl : j.role === 'FLUSH' ? r.flushMl : r.targetMl;
        if (io.grams + target > BOTTLE_MAX_G) { await this.ask('EMPTY_BOTTLE', `Empty the waste bottle (${Math.round(io.grams)} g in it), put it back, then press START`, j); io.grams = 0; this.check(); }
        // sensors + GPS at this site
        const hasFix = fixAt(si);
        io.fix = hasFix ? 1 : 0; io.sats = hasFix ? 6 + Math.floor(Math.random() * 4) : Math.floor(Math.random() * 3); io.hdop = +rand(0.8, 2.2).toFixed(1);
        const ref = sites[si];
        io.lat = ref.lat != null ? +(ref.lat + noise(0.0002)).toFixed(6) : 25.2 + noise(0.01); io.lon = ref.lon != null ? +(ref.lon + noise(0.0002)).toFixed(6) : 55.27 + noise(0.01);
        io.ph = w ? w.ph : null; io.ntu = w ? w.ntu : null; io.temp = w ? w.temp : null;
        // SEAL
        this.step(S.SEAL, j);
        io.press = 1; await this.sleep(1.5); this.check(); await this.waitPause();
        // PUMP
        this.step(S.PUMP, j);
        const startD = new Date();
        io.ml = 0; io.target = target; io.pumpSec = 0; this.air = 0;
        this.capacity = j.role === 'SAMPLE' ? (j.seat === clogSeat ? rand(240, 900) : 2600 + rand(0, 2400) - (w?.ntu || 0) * 25) : 1e6;
        const base = this.cal.flowMlMin * rand(0.88, 1.08);
        let airAt = j.seat === airSeat ? rand(300, 700) : Infinity;
        let stop = 'VOLUME', lowFor = 0, gramsAtStart = io.grams, fixN = 0;
        while (true) {
          const t0 = this.simT;
          await this.sleep(Math.max(0.5, this.speed * 0.1)); this.check(); await this.waitPause();
          const dt = Math.min(60, this.simT - t0);   // actual simulated seconds that passed
          io.pumpS = 1;
          const load = Math.max(0, 1 - io.ml / this.capacity);
          io.flowMlMin = Math.max(0, base * load * (1 + noise(0.05)));
          const add = io.flowMlMin / 60 * dt;
          io.ml = Math.min(target, io.ml + add); io.grams = gramsAtStart + io.ml; io.pumpSec += dt;
          if (io.fix) fixN++;
          if (io.ml >= target) { stop = 'VOLUME'; break; }
          if (io.ml >= airAt && !this.air) {
            this.air = 1; io.pumpS = 0; io.float = 0;
            this.write({ t: 'err', code: 'AIR', msg: `Pumping air at ${Math.round(io.ml)} mL — intake out of the water?` });
            const c = await this.ask('AIR', 'Put the intake back in the water and press START (stops by itself after 2 min)', j);
            io.float = 1;
            if (!c) { stop = 'AIR'; break; }
            this.air = 0; airAt = Infinity; this.step(S.PUMP, j); this.write({ t: 'log', msg: 'Intake back in water — pumping again' });
            continue;
          }
          if (io.flowMlMin < r.minFlowMlMin) { lowFor += dt; if (lowFor >= 5) { stop = 'CLOG'; break; } } else lowFor = 0;
          if (io.pumpSec >= r.maxMin * 60) { stop = 'TIME'; break; }
        }
        io.pumpS = 0; io.flowMlMin = 0; this.air = 0;
        const ml = Math.round(io.ml);
        const m2 = `${j.role} seat ${j.seat} stopped: ${stop} at ${ml} mL`;
        if (stop === 'CLOG' || stop === 'AIR') this.write({ t: 'err', code: stop, msg: m2 }); else this.write({ t: 'log', msg: m2 });
        // PRESERVE (not for flushes)
        if (j.role !== 'FLUSH') {
          this.step(S.PRESERVE, j);
          await this.sleep(3); this.check(); await this.waitPause();
          io.pumpE = 1; await this.sleep(Math.max(2, r.ethanolMl / 0.5)); this.check(); io.pumpE = 0;
          this.write({ t: 'log', msg: `Seat ${j.seat} preserved with ${(+r.ethanolMl).toFixed(1)} mL ≥95% ethanol` });
        }
        // LOG
        this.step(S.LOG, j);
        io.press = 0;
        this.record(j, { id, startD, endD: new Date(), ml, target, stop, r, fixN, ref, si });
        if (j.role === 'SAMPLE') { samples++; if (ml >= r.minValidMl) valid++; io.samples = samples; }
        if (j.role === 'BLANK') io.blankDone = true;
        await this.sleep(1); this.check();
        io.ml = 0; io.target = 0;
        if (jobs[k + 1]?.role === 'FLUSH' && k > 1) { io.sensors = 0; io.fix = 0; this.write({ t: 'log', msg: 'Site finished — GPS and sensors off until you reach the next site' }); }
      }
      this.finish(false, id, samples, valid);
    } catch (err) {
      if (cur && cur.role !== 'FLUSH' && io.ml > 0 && io.state !== 'LOG') this.record(cur, { id, startD: new Date(), endD: new Date(), ml: Math.round(io.ml), target: io.target, stop: 'ABORT', r, fixN: 0, ref: sites[Math.max(0, cur.site)], si: Math.max(0, cur.site) });
      this.finish(true, id, samples, valid, 'Safe stop: pumps off, nozzle up');
    }
  }

  finish(aborted, id, samples, valid, msg) {
    const io = this.io;
    io.pumpS = io.pumpE = 0; io.press = 0; io.flowMlMin = 0; io.wait = null; io.job = 0; io.role = ''; io.siteCode = ''; io.rep = 0;
    this.write({ t: aborted ? 'aborted' : 'done', mission: id, samples, valid, blank: io.blankDone, tubes: samples + (io.blankDone ? 1 : 0), ...(aborted ? { msg } : {}) });
    this.step(S.IDLE);
    this.busy = false; this.abort = false; this.paused = false; this.cont = null;
  }

  record(j, { id, startD, endD, ml, target, stop, r, fixN, ref, si }) {
    const io = this.io;
    const sampleId = `CK-${dateCode(startD)}-${j.code}-S${j.seat}`;
    const valid = j.role === 'FLUSH' ? stop === 'VOLUME' : ml >= r.minValidMl;
    let lat = null, lon = null, hdop = null, loc = 'NONE';
    if (fixN) { lat = io.lat; lon = io.lon; hdop = io.hdop; loc = 'GPS'; }
    else if (this.manualLoc) { lat = this.manualLoc.lat; lon = this.manualLoc.lon; loc = 'MANUAL'; }
    else if (ref && ref.lat != null) { lat = ref.lat; lon = ref.lon; loc = 'MISSION'; }
    const manual = loc === 'MANUAL' || loc === 'MISSION';
    const temp = j.role === 'BLANK' ? null : io.temp, ntu = j.role === 'BLANK' ? null : io.ntu, ph = j.role === 'BLANK' ? null : io.ph;
    const rec = {
      sample_id: sampleId, mission: id, seat: j.seat, role: j.role, site: j.code, site_name: j.name, replicate: j.rep,
      start_time: isoLocal(startD), end_time: isoLocal(endD), volume_mL: ml, target_mL: target, stop_reason: stop, valid,
      volume_source: 'SCALE', pump_s: Math.round(io.pumpSec), lat, lon, hdop: manual ? 'manual' : hdop, loc_source: loc,
      ...(fixN ? { sats: io.sats } : {}), ...(loc === 'MANUAL' && this.manualLoc.label ? { loc_label: this.manualLoc.label } : {}),
      temp_C: temp == null ? null : +temp.toFixed(1), turbidity_NTU: ntu == null ? null : +ntu.toFixed(1), pH: ph == null ? null : +ph.toFixed(2),
      battery_V: +io.bat.toFixed(2), battery_temp_C: +io.batTemp.toFixed(1), ethanol_mL: j.role === 'FLUSH' ? 0 : r.ethanolMl, fw: 'sim-3.0.0',
      saved_sd: true, saved_flash: true,
      // v2 keys
      tube: j.seat, name: j.name, ts: endD.getTime(), ml, target, ph: rec2(ph, 2), ntu: rec2(ntu, 1), temp: rec2(temp, 1), blank: j.role === 'BLANK', clog: stop === 'CLOG',
    };
    const n = v => v == null ? 'NA' : v;
    this.records.push([sampleId, id, j.seat, j.role, j.code, j.rep, rec.start_time, rec.end_time, ml, target, stop, valid ? 1 : 0, 'SCALE', rec.pump_s,
      n(lat), n(lon), manual ? 'manual' : n(hdop), loc, n(rec.temp_C), n(rec.turbidity_NTU), n(rec.pH), rec.battery_V, rec.battery_temp_C, 'sim-3.0.0'].join(','));
    this.write({ t: 'sample', ...rec });
  }
}
const rec2 = (v, d) => v == null ? null : +(+v).toFixed(d);
export const CSV_HEADER = 'sample_id,mission,seat,role,site,replicate,start_time,end_time,volume_mL,target_mL,stop_reason,valid,volume_source,pump_s,lat,lon,hdop,loc_source,temp_C,turbidity_NTU,pH,battery_V,battery_temp_C,fw';
