// A software twin of the eDNA Pod. It speaks exactly the same JSON-lines
// protocol as the ESP32 firmware, so the app runs a full mission with no hardware.

const STEP_NAMES = ['', 'SELFCHECK', 'INDEX', 'TEST', 'PRIME', 'SAMPLE', 'PRESERVE', 'LOG', 'RINSE'];
const SEATS = 8;
const rand = (a, b) => a + Math.random() * (b - a);
const noise = s => (Math.random() - 0.5) * s;

export class SimDevice {
  constructor(write, opts = {}) {
    this.write = obj => write(JSON.stringify(obj));
    this.speed = opts.speed || 10;
    this.simT = 0; this.paused = false; this.abort = false; this.busy = false;
    this.waiters = [];
    this.io = { bat: 12.6, ph: 7.9, ntu: 6, temp: 26.5, ml: 0, target: 0, pumpS: 0, pumpE: 0, cur: 0, seat: 1, press: 0, rain: 0, flow: 0, tube: 0, state: 'IDLE', site: '' };
  }
  boot() {
    this.timer = setInterval(() => this.tick(0.1), 100);
    this.teleTimer = setInterval(() => this.sendTele(), 250);
    setTimeout(() => this.write({ t: 'log', msg: 'Simulator ready — eDNA Pod twin, firmware sim-2.0' }), 50);
  }
  shutdown() { clearInterval(this.timer); clearInterval(this.teleTimer); this.abort = true; this.wake(); }

  tick(dt) {
    if (this.paused) return;
    const d = dt * this.speed;
    this.simT += d;
    const io = this.io;
    io.bat = Math.max(10.8, io.bat - d * (0.00012 + (io.pumpS || io.pumpE ? 0.0004 : 0)));
    io.cur = io.pumpS || io.pumpE ? +(0.22 + (io.pumpS && io.target ? (io.ml / 1000) * (io.ntu / 60) * 0.5 : 0) + noise(0.02)).toFixed(2) : 0;
    this.wake();
  }
  wake() {
    this.waiters = this.waiters.filter(w => {
      if (this.abort || this.simT >= w.at) { w.res(); return false; }
      return true;
    });
  }
  sleep(simSeconds) { return new Promise(res => this.waiters.push({ at: this.simT + simSeconds, res })); }
  check() { if (this.abort) throw new Error('ABORT'); }

  sendTele() {
    const io = this.io;
    this.write({
      t: 'tele', state: io.state, site: io.site, tube: io.tube, seat: io.seat, press: io.press,
      bat: +io.bat.toFixed(2), ph: +(io.ph + noise(0.04)).toFixed(2), ntu: +Math.max(0, io.ntu + noise(1.2)).toFixed(1), temp: +(io.temp + noise(0.1)).toFixed(1),
      ml: Math.round(io.ml), target: io.target, flow: +io.flow.toFixed(2), cur: io.cur,
      pumpS: io.pumpS, pumpE: io.pumpE, rain: io.rain,
      paused: this.paused ? 1 : 0,
    });
  }

  receive(text) {
    let m; try { m = JSON.parse(text); } catch (e) { return this.write({ t: 'err', code: 'PARSE', msg: 'Bad JSON' }); }
    switch (m.cmd) {
      case 'hello': return this.write({ t: 'hello', id: 'EDNA-POD-SIM', fw: 'sim-2.0', seats: SEATS, bat: +this.io.bat.toFixed(2) });
      case 'start': return this.start(m.mission || {});
      case 'pause': this.paused = true; return this.write({ t: 'log', msg: 'Paused — pumps stopped' });
      case 'resume': this.paused = false; return this.write({ t: 'log', msg: 'Resumed' });
      case 'abort': if (this.busy) { this.abort = true; this.paused = false; this.wake(); } return;
      case 'placed': case 'arrived': this.placed = true; return;
      case 'settime': return;
      case 'home': if (this.busy) return this.write({ t: 'err', code: 'BUSY', msg: 'Mission running' }); this.io.seat = 1; this.io.press = 0; return this.write({ t: 'log', msg: 'Carousel homed — seat 1 under the nozzle' });
      case 'speed': this.speed = Math.max(1, Math.min(60, +m.value || 10)); return this.write({ t: 'log', msg: `Sim speed ×${this.speed}` });
      case 'read': return this.write({ t: 'raw', phV: +(2.5 + (7 - this.io.ph) * 0.18 + noise(0.004)).toFixed(3), ntuV: +(4.2 - this.io.ntu * 0.0012 + noise(0.003)).toFixed(3) });
      case 'pump': return this.runPump(m.which || 'S', +m.seconds || 10);
      case 'schedule': return this.write({ t: 'ack', cmd: 'schedule', ok: true, msg: m.mode === 'rain' ? 'Mission stored — starts when the rain sensor stays wet for 2 minutes' : `Mission stored for ${m.mode === 'nightly' ? 'nightly ' + m.time : m.mode}` });
      case 'setcal': return this.write({ t: 'ack', cmd: 'setcal', ok: true });
      default: return this.write({ t: 'err', code: 'CMD', msg: `Unknown command ${m.cmd}` });
    }
  }

  async runPump(which, seconds) {
    if (this.busy) return this.write({ t: 'err', code: 'BUSY', msg: 'Mission running' });
    const k = which === 'E' ? 'pumpE' : 'pumpS';
    this.io[k] = 1;
    this.write({ t: 'log', msg: `Calibration: pump ${which} on for ${seconds} s` });
    await new Promise(r => setTimeout(r, seconds * 1000 / Math.max(1, this.speed / 2)));
    this.io[k] = 0;
    this.write({ t: 'pumped', which, seconds });
  }

  seatOf(tube) { return (tube - 1) % SEATS + 1; }
  setStep(n, site, tube) {
    this.io.state = STEP_NAMES[n];
    this.write({ t: 'step', n, name: STEP_NAMES[n], site: site?.id || site || '', siteName: site?.name || site || '', tube: tube || 0 });
  }

  async start(mission) {
    if (this.busy) return this.write({ t: 'err', code: 'BUSY', msg: 'A mission is already running' });
    this.busy = true; this.abort = false; this.paused = false;
    const io = this.io;
    const r = { ntuMurky: 40, clearMl: 1000, murkyMl: 500, maxPumpS: 600, primeMl: 100, rinseMl: 100, ethanolMl: 2, blank: true, ...(mission.rules || {}) };
    const mlPerS = mission.mlPerS || 1.7;
    let tube = mission.tubeStart || 1;
    const sites = (mission.sites || []).map((s, i) => ({ ...s, ntu: i === 1 ? rand(48, 70) : rand(4, 22), ph: rand(7.7, 8.2) }));
    this.write({ t: 'mission', id: mission.id, sites: sites.length, blank: r.blank });
    try {
      // 1 · self-check
      this.setStep(1, { id: 'BASE', name: 'Base' }, 0);
      this.write({ t: 'log', msg: `Battery ${io.bat.toFixed(2)} V · turbidity OK · temperature OK · GPS fix` });
      io.press = 0; await this.sleep(4); this.check();
      this.write({ t: 'log', msg: 'Carousel homed — magnet found at seat 1' });

      const doSample = async (site, blank) => {
        // 3 · test water
        this.setStep(3, site, tube);
        await this.sleep(3); this.check();
        io.ph = blank ? 7.0 : site.ph; io.ntu = blank ? 0.4 : site.ntu;
        await this.sleep(4); this.check();
        const murky = io.ntu >= r.ntuMurky;
        const target = blank ? 250 : (murky ? r.murkyMl : r.clearMl);
        io.target = target;
        this.write({ t: 'log', msg: blank ? 'Field blank: clean water, 250 mL' : `Water ${murky ? 'MURKY' : 'clear'} (${io.ntu.toFixed(1)} NTU) → target ${target} mL` });
        // 4 · prime (nozzle lifted, water goes to waste)
        this.setStep(4, site, tube);
        io.press = 0; io.pumpS = 1; io.flow = mlPerS;
        await this.sleep(Math.min(20, r.primeMl / mlPerS)); this.check();
        io.pumpS = 0;
        // 5 · sample: servo presses the nozzle onto the cartridge
        this.setStep(5, site, tube);
        io.press = 1; await this.sleep(1.5); this.check();
        io.ml = 0;
        let elapsed = 0, clog = false;
        while (io.ml < target) {
          const stepS = Math.max(0.5, this.speed * 0.1);   // one simulator tick per loop
          await this.sleep(stepS); this.check();
          while (this.paused) { io.pumpS = io.pumpE = 0; await new Promise(res => setTimeout(res, 150)); this.check(); }
          io.pumpS = 1;
          const loadFactor = Math.max(0.12, 1 - (io.ml / 1000) * (io.ntu / 140));
          io.flow = mlPerS * loadFactor * (1 + noise(0.06));
          io.ml = Math.min(target, io.ml + io.flow * stepS); elapsed += stepS;
          if (elapsed >= r.maxPumpS || loadFactor <= 0.13) { clog = true; break; }
        }
        io.pumpS = io.pumpE = 0; io.flow = 0;
        if (clog) this.write({ t: 'err', code: 'CLOG', msg: `Pump current rose — filter clogging, stopped at ${Math.round(io.ml)} mL`, tube });
        // 6 · preserve: drain, then 2 mL ethanol onto the filter
        this.setStep(6, site, tube);
        await this.sleep(3); this.check();
        io.pumpE = 1; await this.sleep(Math.max(2, r.ethanolMl / 0.5)); this.check(); io.pumpE = 0;
        this.write({ t: 'log', msg: `Cartridge ${tube} preserved with ${r.ethanolMl} mL ethanol (seat ${io.seat})` });
        // 7 · log
        this.setStep(7, site, tube);
        this.write({ t: 'sample', mission: mission.id, tube, seat: io.seat, site: site.id, name: site.name, lat: site.lat, lon: site.lon, ts: Date.now(), ml: Math.round(io.ml), target, ph: +io.ph.toFixed(2), ntu: +io.ntu.toFixed(1), temp: +io.temp.toFixed(1), blank, clog });
        await this.sleep(1.5); this.check();
        // 8 · rinse: nozzle lifts, hose flushed to waste
        this.setStep(8, site, tube);
        io.press = 0; await this.sleep(1); io.pumpS = 1; io.flow = mlPerS;
        await this.sleep(Math.min(20, r.rinseMl / mlPerS)); this.check();
        io.pumpS = 0; io.flow = 0; io.ml = 0; io.target = 0;
        tube++;
      };

      // 2 · index: the carousel turns a clean cartridge under the nozzle; the Pod is carried to the site
      const index = async (site) => {
        this.setStep(2, site, tube);
        io.site = site.name; io.press = 0;
        io.seat = this.seatOf(tube);
        this.write({ t: 'log', msg: `Carousel → seat ${io.seat} (cartridge ${tube})` });
        await this.sleep(2); this.check();
        if (site.id === 'BLANK') return;
        this.placed = false;
        const dur = rand(6, 9); let waited = 0;
        while (waited < dur && !this.placed) { await this.sleep(0.5); waited += 0.5; this.check(); }
        this.write({ t: 'log', msg: `Pod placed at ${site.name}` });
      };
      const needed = sites.length + (r.blank ? 1 : 0), free = SEATS - ((tube - 1) % SEATS);
      if (needed > free) this.write({ t: 'log', msg: `Only ${free} clean seats left — swap in a fresh carousel when asked` });
      if (r.blank) { const b = { id: 'BLANK', name: 'Field blank', lat: sites[0]?.lat, lon: sites[0]?.lon }; await index(b); await doSample(b, true); }
      for (const site of sites) {
        await index(site);
        await doSample(site, false);
      }
      io.state = 'IDLE'; io.press = 0;
      this.write({ t: 'done', mission: mission.id, tubes: tube - (mission.tubeStart || 1) });
    } catch (e) {
      io.pumpS = io.pumpE = 0; io.press = 0; io.flow = 0; io.state = 'IDLE';
      this.write({ t: 'aborted', mission: mission.id, msg: 'Safe stop: pumps off, nozzle lifted' });
    }
    this.busy = false; this.abort = false;
  }
}
