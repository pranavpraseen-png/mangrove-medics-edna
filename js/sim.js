// A software twin of the eDNA Collector. It speaks exactly the same JSON-lines
// protocol as the ESP32 firmware, so the app runs a full mission with no hardware.

const STEP_NAMES = ['', 'SELFCHECK', 'DRIVE', 'TEST', 'PRIME', 'SAMPLE', 'SEAL', 'LOG', 'RINSE'];
const rand = (a, b) => a + Math.random() * (b - a);
const noise = s => (Math.random() - 0.5) * s;

export class SimDevice {
  constructor(write, opts = {}) {
    this.write = obj => write(JSON.stringify(obj));
    this.speed = opts.speed || 10;
    this.simT = 0; this.paused = false; this.abort = false; this.busy = false;
    this.waiters = [];
    this.io = { bat: 12.6, ph: 7.9, ntu: 6, ml: 0, target: 0, pumpS: 0, pumpR: 0, vW: 0, vF: 0, gx: 0, gy: 0, tx: 0, ty: 0, dist: 180, arm: 0, drive: 0, flow: 0, tube: 0, state: 'IDLE', site: '' };
    this.gantry = { cols: 10, rows: 5, x0: 20, y0: 20, dx: 18, dy: 18 };
  }
  boot() {
    this.timer = setInterval(() => this.tick(0.1), 100);
    this.teleTimer = setInterval(() => this.sendTele(), 250);
    setTimeout(() => this.write({ t: 'log', msg: 'Simulator ready — eDNA Collector twin, firmware sim-1.0' }), 50);
  }
  shutdown() { clearInterval(this.timer); clearInterval(this.teleTimer); this.abort = true; this.wake(); }

  tick(dt) {
    if (this.paused) return;
    const d = dt * this.speed;
    this.simT += d;
    const io = this.io;
    // gantry moves 60 mm/s toward its target
    const step = 60 * d;
    io.gx += Math.max(-step, Math.min(step, io.tx - io.gx));
    io.gy += Math.max(-step, Math.min(step, io.ty - io.gy));
    io.bat = Math.max(10.8, io.bat - d * (0.00012 + (io.pumpS || io.pumpR ? 0.0004 : 0) + (io.drive ? 0.0006 : 0)));
    if (io.drive) io.dist = Math.max(18, Math.min(220, io.dist + noise(40) * d * 0.4));
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
      t: 'tele', state: io.state, site: io.site, tube: io.tube,
      bat: +io.bat.toFixed(2), ph: +(io.ph + noise(0.04)).toFixed(2), ntu: +Math.max(0, io.ntu + noise(1.2)).toFixed(1),
      ml: Math.round(io.ml), target: io.target, flow: +io.flow.toFixed(2),
      pumpS: io.pumpS, pumpR: io.pumpR, vW: io.vW, vF: io.vF,
      gx: Math.round(io.gx), gy: Math.round(io.gy), dist: Math.round(io.dist), arm: io.arm, drive: io.drive,
      paused: this.paused ? 1 : 0,
    });
  }

  receive(text) {
    let m; try { m = JSON.parse(text); } catch (e) { return this.write({ t: 'err', code: 'PARSE', msg: 'Bad JSON' }); }
    switch (m.cmd) {
      case 'hello': return this.write({ t: 'hello', id: 'EDNA-SIM', fw: 'sim-1.0', slots: 50, bat: +this.io.bat.toFixed(2) });
      case 'start': return this.start(m.mission || {});
      case 'pause': this.paused = true; return this.write({ t: 'log', msg: 'Paused — pumps stopped, valves closed' });
      case 'resume': this.paused = false; return this.write({ t: 'log', msg: 'Resumed' });
      case 'abort': if (this.busy) { this.abort = true; this.paused = false; this.wake(); } return;
      case 'arrived': this.arrived = true; return;
      case 'settime': return;
      case 'drive': if (!this.busy) { this.io.drive = 1; clearTimeout(this.dt); this.dt = setTimeout(() => { this.io.drive = 0; }, (+m.ms || 300)); } return;
      case 'home': this.io.tx = 0; this.io.ty = 0; return this.write({ t: 'log', msg: 'Gantry homing' });
      case 'speed': this.speed = Math.max(1, Math.min(60, +m.value || 10)); return this.write({ t: 'log', msg: `Sim speed ×${this.speed}` });
      case 'read': return this.write({ t: 'raw', phV: +(2.5 + (7 - this.io.ph) * 0.18 + noise(0.004)).toFixed(3), ntuV: +(4.2 - this.io.ntu * 0.0012 + noise(0.003)).toFixed(3) });
      case 'pump': return this.runPump(m.which || 'S', +m.seconds || 10);
      case 'schedule': return this.write({ t: 'ack', cmd: 'schedule', ok: true, msg: `Mission stored for ${m.mode === 'nightly' ? 'nightly ' + m.time : m.mode}` });
      case 'setcal': return this.write({ t: 'ack', cmd: 'setcal', ok: true });
      default: return this.write({ t: 'err', code: 'CMD', msg: `Unknown command ${m.cmd}` });
    }
  }

  async runPump(which, seconds) {
    if (this.busy) return this.write({ t: 'err', code: 'BUSY', msg: 'Mission running' });
    const k = which === 'R' ? 'pumpR' : 'pumpS';
    this.io[k] = 1; this.io.vW = 1;
    this.write({ t: 'log', msg: `Calibration: pump ${which} on for ${seconds} s` });
    await new Promise(r => setTimeout(r, seconds * 1000 / Math.max(1, this.speed / 2)));
    this.io[k] = 0; this.io.vW = 0;
    this.write({ t: 'pumped', which, seconds });
  }

  slotXY(tube) {
    const g = this.gantry, slot = (tube - 1) % (g.cols * g.rows);
    return { x: g.x0 + (slot % g.cols) * g.dx, y: g.y0 + Math.floor(slot / g.cols) * g.dy };
  }
  setStep(n, site, tube) {
    this.io.state = STEP_NAMES[n];
    this.write({ t: 'step', n, name: STEP_NAMES[n], site: site?.id || site || '', siteName: site?.name || site || '', tube: tube || 0 });
  }

  async start(mission) {
    if (this.busy) return this.write({ t: 'err', code: 'BUSY', msg: 'A mission is already running' });
    this.busy = true; this.abort = false; this.paused = false;
    const io = this.io;
    const r = { ntuMurky: 40, clearMl: 1000, murkyMl: 500, maxPumpS: 600, primeMl: 100, rinseMl: 100, blank: true, ...(mission.rules || {}) };
    const mlPerS = mission.mlPerS || 8.5;
    if (mission.gantry) this.gantry = { ...this.gantry, ...mission.gantry };
    let tube = mission.tubeStart || 1;
    const sites = (mission.sites || []).map((s, i) => ({ ...s, ntu: i === 1 ? rand(48, 70) : rand(4, 22), ph: rand(7.7, 8.2) }));
    this.write({ t: 'mission', id: mission.id, sites: sites.length, blank: r.blank });
    try {
      // 1 · self-check
      this.setStep(1, { id: 'BASE', name: 'Base' }, 0);
      this.write({ t: 'log', msg: `Battery ${io.bat.toFixed(2)} V · pH probe OK · turbidity OK · ultrasonic OK` });
      io.tx = 0; io.ty = 0; await this.sleep(4); this.check();
      this.write({ t: 'log', msg: 'Gantry homed (0,0)' });

      const doSample = async (site, blank) => {
        // 3 · test water
        this.setStep(3, site, tube);
        io.arm = 1; await this.sleep(3); this.check();
        io.ph = blank ? 7.0 : site.ph; io.ntu = blank ? 0.4 : site.ntu;
        await this.sleep(4); this.check();
        const murky = io.ntu >= r.ntuMurky;
        const target = blank ? 250 : (murky ? r.murkyMl : r.clearMl);
        io.target = target;
        this.write({ t: 'log', msg: blank ? 'Field blank: clean water, 250 mL' : `Water ${murky ? 'MURKY' : 'clear'} (${io.ntu.toFixed(1)} NTU) → target ${target} mL` });
        // 4 · prime
        this.setStep(4, site, tube);
        io.vW = 1; io[blank ? 'pumpR' : 'pumpS'] = 1; io.flow = mlPerS;
        await this.sleep(r.primeMl / mlPerS); this.check();
        io.vW = 0;
        // gantry loads a fresh cartridge in parallel
        // 5 · sample
        this.setStep(5, site, tube);
        io.vF = 1; io.ml = 0;
        let elapsed = 0, clog = false;
        while (io.ml < target) {
          await this.sleep(0.5); this.check();
          while (this.paused) { io.pumpS = io.pumpR = 0; await new Promise(res => setTimeout(res, 150)); this.check(); }
          io[blank ? 'pumpR' : 'pumpS'] = 1;
          const loadFactor = Math.max(0.12, 1 - (io.ml / 1000) * (io.ntu / 140));
          io.flow = mlPerS * loadFactor * (1 + noise(0.06));
          io.ml += io.flow * 0.5; elapsed += 0.5;
          if (elapsed >= r.maxPumpS || loadFactor <= 0.13) { clog = true; break; }
        }
        io.pumpS = io.pumpR = 0; io.vF = 0; io.flow = 0;
        if (clog) this.write({ t: 'err', code: 'CLOG', msg: `Filter slowed — stopped at ${Math.round(io.ml)} mL`, tube });
        // 6 · seal
        this.setStep(6, site, tube);
        io.arm = 0;
        const xy = this.slotXY(tube);
        io.tx = xy.x; io.ty = xy.y;
        await this.sleep(Math.max(3, Math.hypot(io.tx - io.gx, io.ty - io.gy) / 60 + 1.5)); this.check();
        this.write({ t: 'log', msg: `Cartridge sealed in tube ${tube} (slot ${(tube - 1) % 50 + 1})` });
        // 7 · log
        this.setStep(7, site, tube);
        this.write({ t: 'sample', mission: mission.id, tube, site: site.id, name: site.name, lat: site.lat, lon: site.lon, ts: Date.now(), ml: Math.round(io.ml), target, ph: +io.ph.toFixed(2), ntu: +io.ntu.toFixed(1), blank, clog });
        await this.sleep(1.5); this.check();
        // 8 · rinse
        this.setStep(8, site, tube);
        io.vW = 1; io.pumpR = 1; io.flow = mlPerS;
        await this.sleep(r.rinseMl / mlPerS); this.check();
        io.vW = 0; io.pumpR = 0; io.flow = 0; io.ml = 0; io.target = 0;
        tube++;
      };

      if (r.blank) await doSample({ id: 'BLANK', name: 'Field blank', lat: sites[0]?.lat, lon: sites[0]?.lon }, true);
      for (const site of sites) {
        // 2 · drive
        this.setStep(2, site, tube);
        io.drive = 1; io.site = site.name; this.arrived = false;
        const dur = rand(8, 12); let waited = 0;
        while (waited < dur && !this.arrived) { await this.sleep(0.5); waited += 0.5; this.check(); }
        if (Math.random() < 0.35) { io.dist = 24; this.write({ t: 'log', msg: 'Obstacle at 24 cm — stopped, re-routing' }); await this.sleep(2); this.check(); io.dist = 140; }
        io.drive = 0;
        await doSample(site, false);
      }
      io.state = 'IDLE'; io.tx = 0; io.ty = 0;
      this.write({ t: 'done', mission: mission.id, tubes: tube - (mission.tubeStart || 1) });
    } catch (e) {
      io.pumpS = io.pumpR = io.vW = io.vF = io.drive = 0; io.arm = 0; io.flow = 0; io.state = 'IDLE';
      this.write({ t: 'aborted', mission: mission.id, msg: 'Safe stop: pumps off, valves closed, arm raised' });
    }
    this.busy = false; this.abort = false;
  }
}
