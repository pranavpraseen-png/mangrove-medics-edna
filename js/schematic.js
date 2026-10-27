// Live water-path schematic of the Pod, pull-through order (docs/DECISIONS.md):
// stream → mesh pre-filter → intake tube → nozzle → cartridge (filter) → sample pump → filtrate bottle on a load cell.
// The ethanol line tees into the nozzle; the carousel turns to the active seat
// (seat 1 = field blank, seats 2–7 = 6 samples, seat 8 = empty flush seat).
// Driven by device telemetry ('tele', 'step', 'sample'); works with the simulator and real hardware.
import { link } from './device.js';
import { state } from './store.js';
import { fmtNum, tubeId } from './util.js';

const STEP_LABEL = ['Ready', 'Self-check', 'Turning carousel', 'Waiting for you', 'Sealing nozzle', 'Filtering', 'Intake out of water', 'Preserving', 'Logging'];

export function schematicHTML() {
  // carousel seats around (520,150)
  const seats = Array.from({ length: 8 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 4, x = 520 + 70 * Math.cos(a), y = 160 + 70 * Math.sin(a);
    return `<g class="sx-seat" data-i="${i}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="17"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${i + 1}</text></g>`;
  }).join('');
  return `<div class="sx" id="sx">
  <svg class="sx-svg" viewBox="0 0 660 354" role="img" aria-label="Live diagram of the Pod's pull-through water path: intake, cartridge with filter, sample pump, then waste bottle on a load cell">
    <defs>
      <clipPath id="sxCart"><rect x="223" y="166" width="54" height="72" rx="4"/></clipPath>
    </defs>
    <!-- stream + mesh pre-filter on the intake -->
    <path class="sx-stream" d="M0 262 Q 30 252 60 262 T 120 262 L120 300 L0 300Z"/>
    <path class="sx-wave" d="M0 262 Q 30 252 60 262 T 120 262"/>
    <circle class="sx-strainer" cx="50" cy="272" r="11"/>
    <text class="sx-lbl" x="68" y="250">Mesh pre-filter</text>
    <!-- 1 intake tube (new bagged set per site): stream → nozzle -->
    <path class="sx-pipe" d="M50 261 V 30 H 250 V 96"/>
    <path class="sx-flow sx-f-sample" d="M50 261 V 30 H 250 V 96"/>
    <text class="sx-lbl" x="62" y="52">Intake · new tube per site</text>
    <!-- nozzle (moves down when pressed) -->
    <g class="sx-nozzle" id="sxNozzle">
      <rect x="234" y="96" width="32" height="26" rx="3"/>
      <path d="M240 122 h20 l-4 10 h-12z"/>
    </g>
    <text class="sx-lbl" x="226" y="113" text-anchor="end">Nozzle</text>
    <!-- ethanol bottle + pump → nozzle -->
    <rect class="sx-bottle" x="352" y="70" width="34" height="50" rx="6"/>
    <rect class="sx-eth" id="sxEth" x="356" y="88" width="26" height="28" rx="3"/>
    <text class="sx-lbl" x="369" y="138" text-anchor="middle">Ethanol ≥95%</text>
    <path class="sx-pipe" d="M352 109 H 332"/>
    <path class="sx-flow sx-f-eth" d="M352 109 H 332"/>
    <g class="sx-pump sx-pump-e" id="sxPumpE" transform="translate(316 109)">
      <circle r="16" class="sx-body"/><g class="sx-rotor"><circle r="9" class="sx-ring"/><circle cx="0" cy="-9" r="3"/><circle cx="8" cy="5" r="3"/><circle cx="-8" cy="5" r="3"/></g>
    </g>
    <path class="sx-pipe" d="M300 109 H 266"/>
    <path class="sx-flow sx-f-eth" d="M300 109 H 266"/>
    <!-- 2 active cartridge with filter -->
    <rect class="sx-cart" x="223" y="166" width="54" height="72" rx="4"/>
    <g clip-path="url(#sxCart)"><rect class="sx-water" id="sxWater" x="223" y="238" width="54" height="0"/></g>
    <line class="sx-filter" x1="226" y1="226" x2="274" y2="226"/>
    <text class="sx-lbl sx-tube" x="215" y="206" text-anchor="end" id="sxTube">${tubeId(state.nextTube)}</text>
    <text class="sx-lbl" x="215" y="222" text-anchor="end">0.45 µm filter</text>
    <!-- 3 cartridge outlet → sample pump (pump only sees filtered water) -->
    <path class="sx-pipe" d="M250 238 V 268 H 296"/>
    <path class="sx-flow sx-f-sample sx-f-drain" d="M250 238 V 268 H 296"/>
    <g class="sx-pump" id="sxPumpS" transform="translate(324 268)">
      <circle r="28" class="sx-body"/><g class="sx-rotor"><circle r="16" class="sx-ring"/><circle cx="0" cy="-16" r="4.5"/><circle cx="14" cy="8" r="4.5"/><circle cx="-14" cy="8" r="4.5"/></g>
    </g>
    <text class="sx-lbl" x="324" y="314" text-anchor="middle">Sample pump</text>
    <!-- 4 pump → filtrate (waste) bottle on the load cell -->
    <path class="sx-pipe" d="M352 268 H 374"/>
    <path class="sx-flow sx-f-sample sx-f-drain" d="M352 268 H 374"/>
    <rect class="sx-waste" x="374" y="244" width="38" height="40" rx="3"/>
    <rect class="sx-bottle" x="368" y="288" width="50" height="6" rx="1"/>
    <text class="sx-lbl" x="428" y="270">Waste bottle</text>
    <text class="sx-lbl" x="428" y="286">on load cell = volume</text>
    <!-- carousel (top view) -->
    <g class="sx-carousel" id="sxCarousel" style="transform-origin:520px 160px">
      <circle class="sx-plate" cx="520" cy="160" r="98"/>
      ${seats}
    </g>
    <path class="sx-marker" d="M512 40 h16 l-8 14z"/>
    <circle class="sx-hub" cx="520" cy="160" r="34"/>
    <text class="sx-hub-n" x="520" y="157" text-anchor="middle" id="sxSeat">Seat 1</text>
    <text class="sx-hub-l" x="520" y="173" text-anchor="middle" id="sxSeatRole">field blank</text>
    <!-- rain -->
    <g class="sx-rain" id="sxRain">${Array.from({ length: 7 }, (_, i) => `<line x1="${430 + i * 30}" y1="${4 + (i % 3) * 6}" x2="${426 + i * 30}" y2="${16 + (i % 3) * 6}"/>`).join('')}</g>
    <!-- legend -->
    <text class="sx-lbl" x="4" y="332">Pull-through: intake → filter → pump → waste</text>
    <text class="sx-lbl" x="656" y="332" text-anchor="end">Seat 1 blank · 2–7 samples · 8 flush</text>
    <text class="sx-lbl" x="4" y="350">ESP32 · DS3231 clock (GPS-synced) · pumps on logic-level MOSFETs</text>
  </svg>
  <div class="sx-read">
    <div><span>Step</span><b id="sxStep">Ready</b></div>
    <div><span>Filtered</span><b><span id="sxMl">0</span> <small>mL</small></b></div>
    <div><span>Turbidity</span><b><span id="sxNtu">—</span> <small>NTU</small></b></div>
    <div><span>Pump current</span><b><span id="sxCur">—</span> <small>A</small></b></div>
  </div>
</div>`;
}

export function bindSchematic(root) {
  const el = root.querySelector('#sx'); if (!el) return () => {};
  const q = s => el.querySelector(s);
  let lastSeat = 1, turns = 0;
  const paintSeats = () => {
    const base = Math.floor((Math.max(1, state.nextTube) - 1) / 8) * 8;
    el.querySelectorAll('.sx-seat').forEach((g, i) => {
      const s = state.samples.find(x => x.tube === base + i + 1);
      g.classList.toggle('full', !!s && !s.blank); g.classList.toggle('blank', !!s?.blank);
    });
  };
  const setSeat = seat => {
    seat = seat || 1;
    if (seat !== lastSeat) { let d = seat - lastSeat; if (d < 0) d += 8; turns += d; lastSeat = seat; }
    q('#sxCarousel').style.transform = `rotate(${-(turns) * 45}deg)`;
    q('#sxSeat').textContent = `Seat ${seat}`;
    q('#sxSeatRole').textContent = seat === 1 ? 'field blank' : seat === 8 ? 'flush seat' : 'sample';
    el.querySelectorAll('.sx-seat').forEach((g, i) => g.classList.toggle('on', i + 1 === seat));
  };
  const onTele = e => {
    const t = e.detail || {};
    el.classList.toggle('s-on', !!t.pumpS && !t.paused);
    el.classList.toggle('e-on', !!t.pumpE && !t.paused);
    el.classList.toggle('pressed', !!t.press);
    el.classList.toggle('raining', !!t.rain);
    el.classList.toggle('draining', t.state === 'PRESERVE' && !t.pumpE);
    el.classList.toggle('clog', (t.cur || 0) > 0.5);
    const live = root.querySelector('#sxLive'); if (live) { const on = t.state && t.state !== 'IDLE'; live.textContent = t.paused ? 'Paused' : on ? 'Live' : 'Idle'; live.classList.toggle('on', !!on && !t.paused); }
    const frac = t.target ? Math.min(1, (t.ml || 0) / t.target) : 0;
    const w = q('#sxWater'); const h = 60 * frac; w.setAttribute('y', String(226 - h)); w.setAttribute('height', String(h));
    q('#sxMl').textContent = t.ml != null ? (t.target ? `${t.ml} / ${t.target}` : t.ml) : '0';
    q('#sxNtu').textContent = fmtNum(t.ntu, 1);
    q('#sxCur').textContent = t.cur ? fmtNum(t.cur, 2) : '—';
    if (t.tube) q('#sxTube').textContent = tubeId(t.tube);
    setSeat(t.seat);
  };
  const onStep = e => { const n = e.detail?.n || 0; q('#sxStep').textContent = STEP_LABEL[n] || 'Ready'; el.dataset.step = n; };
  const onEnd = () => { q('#sxStep').textContent = 'Ready'; el.className = 'sx'; paintSeats(); const live = root.querySelector('#sxLive'); if (live) { live.textContent = 'Idle'; live.classList.remove('on'); } };
  const onSample = () => setTimeout(paintSeats, 50);
  link.addEventListener('tele', onTele); link.addEventListener('step', onStep);
  link.addEventListener('done', onEnd); link.addEventListener('aborted', onEnd); link.addEventListener('sample', onSample);
  paintSeats(); setSeat(link.tele?.seat || 1); if (link.tele) onTele({ detail: link.tele }); if (link.step) onStep({ detail: link.step });
  return () => { link.removeEventListener('tele', onTele); link.removeEventListener('step', onStep); link.removeEventListener('done', onEnd); link.removeEventListener('aborted', onEnd); link.removeEventListener('sample', onSample); };
}
