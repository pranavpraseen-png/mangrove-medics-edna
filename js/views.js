// All screens of the console. Each view renders into #view and returns a cleanup function.
import { $, $$, esc, fmtTime, fmtNum, toast, download, toCSV, parseCSV, countUp, icons, tubeId } from './util.js';
import { state, save, STATUSES, addSite, updateSite, removeSite, moveSite, importResults, demoResults, alerts, exportJSON, importJSON, resetAll } from './store.js';
import { link, support } from './device.js';
import { collector } from './scene.js';
import { siteMap } from './map.js';
import { hbars, columns, missionRing } from './charts.js';
import { startMission, scheduleMission } from './mission.js';

const STEPS = [
  ['Self-check', 'Battery, sensors and GPS checked; the carousel finds seat 1.'],
  ['Index', 'The carousel turns a clean cartridge under the nozzle; place the Pod at the site.'],
  ['Test the water', 'pH and turbidity decide how much water to filter.'],
  ['Prime', 'Site water flushes the hose to waste, nozzle lifted.'],
  ['Sample', 'The servo seals the nozzle and the pump pushes water through the 0.45 µm filter.'],
  ['Preserve', 'The cartridge drains, then 2 mL of ethanol keeps the DNA safe.'],
  ['Log', 'Cartridge, seat, place, time, volume and sensors saved to SD and the app.'],
  ['Rinse', 'Nozzle lifts and site water flushes the hose; one field blank per mission.'],
];

function stage(root, sel) {
  const el = $(sel, root);
  const ok = collector.attach(el);
  if (!ok) el.innerHTML = '<div class="webgl-fallback">3D view needs WebGL, which this browser has turned off.<br>Everything else works normally.</div>';
  else collector.setFilled(state.samples);
  return () => collector.detach();
}

/* ─────────────────────────── Overview ─────────────────────────── */
function overview(root) {
  const species = new Set(state.results.filter(r => r.reads > 0).map(r => r.species));
  const al = alerts();
  const recent = [...state.samples].sort((a, b) => b.ts - a.ts).slice(0, 5);
  root.innerHTML = `
  <section class="grid">
    <div class="card hero">
      <div class="hero-copy">
        <p class="eyebrow">eDNA Collector · Mission control</p>
        <h2>Find the animals <em>nobody can see</em> — from one bottle of water.</h2>
        <p>Plan sampling missions, watch the Pod work in real time, track every cartridge from the field to the lab, and see which species live in your water.</p>
        <div class="row" style="margin-top:6px">
          <a class="btn primary" href="#/planner">Plan a mission</a>
          <button class="btn" id="quickSim">Run a demo mission</button>
        </div>
      </div>
      <div class="stage" id="heroStage"><span class="stage-label">Live 3D twin · drag to orbit</span></div>
    </div>
    <div class="grid g4">
      ${stat('tube', state.samples.length, 'Cartridges filled', 'sCount')}
      ${stat('pin', state.sites.length, 'Sites in the plan', 'siteCount')}
      ${stat('dna', species.size, 'Species detected', 'spCount')}
      ${stat('bell', al.length, 'Open alerts', 'alCount')}
    </div>
    <div class="grid g2">
      <div class="card">
        <h2>Recent samples <a class="tag info" href="#/samples" style="margin-left:auto;text-decoration:none">Registry →</a></h2>
        ${recent.length ? `<div class="table-wrap"><table><thead><tr><th>Cartridge</th><th>Site</th><th>Volume</th><th>When</th></tr></thead><tbody>
          ${recent.map(s => `<tr><td class="mono">${esc(s.id)}${s.blank ? ' <span class="tag info">blank</span>' : ''}</td><td>${esc(s.siteName)}</td><td>${s.ml} mL</td><td class="dim">${fmtTime(s.ts)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No samples yet — run a mission to fill the carousel.</div>'}
      </div>
      <div class="card">
        <h2>Alerts <span class="tag ${al.length ? 'crit' : 'ok'}">${al.length ? `${al.length} open` : 'All clear'}</span></h2>
        ${al.length ? al.slice(0, 4).map(alertRow).join('') : '<div class="empty">No alerts. Blanks are clean and no watchlist species detected.</div>'}
      </div>
    </div>
    <div class="card">
      <h2>One clean loop at every site</h2>
      <div class="grid g4">${STEPS.map((s, i) => `<div class="anim"><p class="eyebrow">Step ${i + 1}</p><b>${s[0]}</b><p class="muted" style="margin:4px 0 0;font-size:14px">${s[1]}</p></div>`).join('')}</div>
    </div>
  </section>`;
  countUp($('#sCount', root), state.samples.length);
  countUp($('#siteCount', root), state.sites.length);
  countUp($('#spCount', root), species.size);
  countUp($('#alCount', root), al.length);
  $('#quickSim', root).onclick = async () => { if (await startMission()) location.hash = '#/live'; };
  return stage(root, '#heroStage');
}
const stat = (ic, v, l, id) => `<div class="card stat"><span class="ic">${icons[ic]}</span><span class="v" id="${id}">${v}</span><span class="l">${l}</span></div>`;
const alertRow = a => `<div class="alert ${a.level}"><span class="dot"></span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`;

/* ─────────────────────────── Connect ─────────────────────────── */
function connect(root) {
  const opts = [
    { k: 'sim', t: 'Simulator', d: 'A digital twin of the Pod. Runs full missions with realistic sensor data — perfect for training and demos.', ok: true, ic: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/>' },
    { k: 'ble', t: 'Bluetooth', d: 'Wireless link to the Pod in the field (Chrome or Edge on Android, Windows, macOS).', ok: support.bluetooth(), ic: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>' },
    { k: 'serial', t: 'USB cable', d: 'Plug the Pod into a laptop. Most reliable for setup and calibration (Chrome or Edge).', ok: support.serial(), ic: '<path d="M10 3h4v5h-4zM8 8h8v6a4 4 0 0 1-8 0zM12 18v3"/>' },
    { k: 'wifi', t: 'Wi-Fi (on the Pod)', d: 'Join the Pod’s Wi-Fi “EDNA-01” and open http://192.168.4.1 — the Pod serves this same app.', ok: support.wifi(), ic: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>' },
  ];
  root.innerHTML = `
  <section class="grid">
    <div class="grid g4">
      ${opts.map(o => `<div class="card conn-opt ${link.kind === o.k ? 'active' : ''}" data-k="${o.k}">
        <span class="big"><svg viewBox="0 0 24 24">${o.ic}</svg></span>
        <h3>${o.t}</h3><p>${o.d}</p>
        <div class="spacer"></div>
        ${o.ok ? `<button class="btn ${o.k === 'sim' ? 'primary' : ''}" data-connect="${o.k}">${link.kind === o.k ? 'Reconnect' : 'Connect'}</button>`
               : `<span class="tag warn">${o.k === 'wifi' ? 'Open the app from the Pod’s address' : 'Not supported in this browser'}</span>`}
      </div>`).join('')}
    </div>
    <div class="grid g2">
      <div class="card">
        <h2>Device</h2>
        <div id="devInfo"></div>
        <div class="row" style="margin-top:14px">
          <button class="btn" id="homeBtn">Home carousel</button>
          <button class="btn" id="readBtn">Read sensors</button>
          <button class="btn danger" id="discBtn">Disconnect</button>
        </div>
        <label class="f" style="margin-top:16px">Simulator speed: <b id="spdV">×${state.settings.simSpeed}</b>
          <input type="range" min="1" max="40" value="${state.settings.simSpeed}" id="spd">
        </label>
      </div>
      <div class="card"><h2>Protocol log <span class="tag">JSON lines</span></h2><div class="term" id="term"></div></div>
    </div>
  </section>`;
  const info = () => {
    $('#devInfo', root).innerHTML = link.connected
      ? `<div class="grid g2"><div><p class="eyebrow">Link</p><b>${link.label}</b></div><div><p class="eyebrow">Device</p><b class="mono">${esc(link.info?.id || '…')}</b></div>
         <div><p class="eyebrow">Firmware</p><b class="mono">${esc(link.info?.fw || '…')}</b></div><div><p class="eyebrow">Battery</p><b>${fmtNum(link.tele?.bat ?? link.info?.bat, 2)} V</b></div></div>`
      : '<p>No Pod connected. Pick a link above — or start with the simulator.</p>';
    $$('.conn-opt', root).forEach(c => c.classList.toggle('active', c.dataset.k === link.kind));
  };
  info();
  $$('[data-connect]', root).forEach(b => b.onclick = async () => {
    const k = b.dataset.connect;
    try { await link.connect(k, { speed: state.settings.simSpeed }); toast(`Connected via ${link.label}`); }
    catch (e) { if (e.name !== 'NotFoundError') toast('Could not connect', 'warn', e.message); }
    connect(root);
  });
  $('#discBtn', root).onclick = () => link.disconnect();
  $('#homeBtn', root).onclick = () => link.send({ cmd: 'home' }) || toast('Not connected', 'warn');
  $('#readBtn', root).onclick = () => link.send({ cmd: 'read' }) || toast('Not connected', 'warn');
  $('#spd', root).oninput = e => { state.settings.simSpeed = +e.target.value; $('#spdV', root).textContent = `×${e.target.value}`; save(); if (link.kind === 'sim') link.send({ cmd: 'speed', value: +e.target.value }); };
  const off1 = termBind($('#term', root));
  const h = () => info(); link.addEventListener('status', h);
  return () => { off1(); link.removeEventListener('status', h); };
}

function termBind(el) {
  const line = ({ dir, text }) => {
    const d = document.createElement('div');
    d.className = dir === 'in' ? 'in' : dir === 'sys' ? 'sys' : dir === 'err' ? 'err' : (text.includes('"sample"') || text.includes('"done"') ? 'ok' : '');
    d.textContent = `${dir === 'in' ? '→ ' : dir === 'sys' ? '· ' : '← '}${text}`;
    el.appendChild(d);
    while (el.childNodes.length > 250) el.firstChild.remove();
    el.scrollTop = el.scrollHeight;
  };
  link.log.slice(-120).forEach(line);
  const h = e => line(e.detail);
  link.addEventListener('line', h);
  return () => link.removeEventListener('line', h);
}

/* ─────────────────────────── Planner ─────────────────────────── */
function planner(root) {
  const r = state.rules, sch = state.schedule;
  root.innerHTML = `
  <section class="grid">
    <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr)">
      <div class="card" style="padding:14px"><div class="map" id="map"></div></div>
      <div class="card">
        <h2>Sites <span class="tag" id="siteN">${state.sites.length}</span></h2>
        <div class="sites" id="sites"></div>
        <form class="form c2" id="addForm" style="margin-top:14px">
          <label class="f" style="grid-column:1/-1">Site name<input type="text" name="name" placeholder="e.g. Forest stream C" required></label>
          <label class="f">Latitude<input type="number" step="0.00001" name="lat" placeholder="25.19" required></label>
          <label class="f">Longitude<input type="number" step="0.00001" name="lon" placeholder="55.32" required></label>
          <label class="row" style="grid-column:1/-1;font-size:14px;color:var(--muted)"><input type="checkbox" name="prot"> Protected area (written permission needed)</label>
          <button class="btn" style="grid-column:1/-1">Add site</button>
        </form>
      </div>
    </div>
    <div class="grid g3">
      <div class="card">
        <h2>Sampling rules</h2>
        <form class="form c2" id="rules">
          <label class="f">Murky above (NTU)<input type="number" name="ntuMurky" value="${r.ntuMurky}" min="1"></label>
          <label class="f">Max pump time (s)<input type="number" name="maxPumpS" value="${r.maxPumpS}" min="30"></label>
          <label class="f">Clear water target (mL)<input type="number" name="clearMl" value="${r.clearMl}" min="50" step="50"></label>
          <label class="f">Murky water target (mL)<input type="number" name="murkyMl" value="${r.murkyMl}" min="50" step="50"></label>
          <label class="f">Prime volume (mL)<input type="number" name="primeMl" value="${r.primeMl}" min="0" step="10"></label>
          <label class="f">Rinse volume (mL)<input type="number" name="rinseMl" value="${r.rinseMl}" min="0" step="10"></label>
          <label class="row" style="grid-column:1/-1;font-size:14px;color:var(--muted)"><input type="checkbox" name="blank" ${r.blank ? 'checked' : ''}> Take a field blank each mission (recommended)</label>
        </form>
      </div>
      <div class="card">
        <h2>Schedule</h2>
        <form class="form" id="sched">
          <label class="f">When<select name="mode">
            <option value="now" ${sch.mode === 'now' ? 'selected' : ''}>Start now</option>
            <option value="nightly" ${sch.mode === 'nightly' ? 'selected' : ''}>Every night at a set time</option>
            <option value="tide" ${sch.mode === 'tide' ? 'selected' : ''}>After rain (enter time)</option>
            <option value="rain" ${sch.mode === 'rain' ? 'selected' : ''}>When the rain sensor gets wet</option></select></label>
          <label class="f">Time<input type="time" name="time" value="${sch.time}"></label>
          <label class="f">Rain-run time (after a shower)<input type="time" name="tide" value="${sch.tide}"></label>
          <p class="dim" style="font-size:13px">Scheduled missions are stored on the Pod so it can sample on its own — for example right after rain, when canopy DNA washes down. With the funnel on, the rain sensor can start it too.</p>
        </form>
      </div>
      <div class="card">
        <h2>Ready check</h2>
        <div id="ready"></div>
        <label class="row" id="permRow" style="font-size:14px;color:var(--muted);margin:12px 0"><input type="checkbox" id="perm"> We have written permission for every protected site</label>
        <div class="row"><button class="btn primary" id="go">Send mission &amp; start</button><button class="btn" id="schedBtn">Store schedule</button></div>
      </div>
    </div>
  </section>`;
  let map;
  const drawSites = () => {
    $('#siteN', root).textContent = state.sites.length;
    $('#sites', root).innerHTML = state.sites.length ? state.sites.map((s, i) => `
      <div class="site"><span class="n ${s.protected ? 'prot' : ''}">${i + 1}</span>
        <div><b>${esc(s.name)}</b><small>${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</small>${s.protected ? ' <span class="tag warn">protected</span>' : ''}</div>
        <div class="row" style="gap:4px"><button class="icon-btn" data-up="${esc(s.id)}" aria-label="Move up">${icons.up}</button><button class="icon-btn" data-down="${esc(s.id)}" aria-label="Move down">${icons.down}</button><button class="icon-btn" data-del="${esc(s.id)}" aria-label="Remove ${esc(s.name)}">${icons.x}</button></div>
      </div>`).join('') : '<div class="empty">No sites yet. Click the map or use the form.</div>';
    $$('[data-up]', root).forEach(b => b.onclick = () => { moveSite(b.dataset.up, -1); drawSites(); });
    $$('[data-down]', root).forEach(b => b.onclick = () => { moveSite(b.dataset.down, 1); drawSites(); });
    $$('[data-del]', root).forEach(b => b.onclick = () => { removeSite(b.dataset.del); drawSites(); });
    map?.draw(state.sites);
    readyCheck();
  };
  const readyCheck = () => {
    const prot = state.sites.some(s => s.protected);
    $('#permRow', root).style.display = prot ? '' : 'none';
    const est = state.sites.length * ((state.rules.clearMl + state.rules.primeMl + state.rules.rinseMl) / state.settings.pumpMlPerS + 60) + (state.rules.blank ? 120 : 0);
    const items = [
      [state.sites.length > 0, `${state.sites.length} site${state.sites.length === 1 ? '' : 's'} planned`],
      [state.sites.length + (state.rules.blank ? 1 : 0) <= 8 - ((state.nextTube - 1) % 8), state.sites.length + (state.rules.blank ? 1 : 0) <= 8 - ((state.nextTube - 1) % 8) ? `Cartridges ${tubeId(state.nextTube)} → ${tubeId(state.nextTube + state.sites.length + (state.rules.blank ? 1 : 0) - 1)} · ${8 - ((state.nextTube - 1) % 8)} clean seats` : `Only ${8 - ((state.nextTube - 1) % 8)} clean seats — swap in a fresh carousel`],
      [state.settings.pumpCal.length >= 3, state.settings.pumpCal.length >= 3 ? `Pump calibrated (${state.settings.pumpMlPerS} mL/s)` : 'Pump not calibrated — using default 1.7 mL/s'],
      [link.connected, link.connected ? `Connected via ${link.label}` : 'Not connected — the simulator will be used'],
    ];
    $('#ready', root).innerHTML = items.map(([ok, t]) => `<div class="check-item"><span class="tag ${ok ? 'ok' : 'warn'}">${ok ? 'OK' : 'Check'}</span><span>${t}</span></div>`).join('') + `<p class="dim" style="font-size:13px;margin-top:8px">Estimated field time ≈ ${Math.round(est / 60)} min</p>`;
  };
  map = siteMap($('#map', root), state.sites, {
    onAdd: (lat, lon) => { addSite({ name: `Site ${state.sites.length + 1}`, lat, lon }); drawSites(); toast('Site added', 'ok', 'Rename it in the list if you like.'); },
  });
  drawSites();
  $('#addForm', root).onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    addSite({ name: f.get('name'), lat: +f.get('lat'), lon: +f.get('lon'), protected: !!f.get('prot') });
    e.target.reset(); drawSites();
  };
  $('#rules', root).oninput = e => {
    const f = e.currentTarget;
    ['ntuMurky', 'maxPumpS', 'clearMl', 'murkyMl', 'primeMl', 'rinseMl'].forEach(k => { state.rules[k] = +f[k].value || 0; });
    state.rules.blank = f.blank.checked; save(); readyCheck();
  };
  $('#sched', root).oninput = e => { const f = e.currentTarget; state.schedule = { mode: f.mode.value, time: f.time.value, tide: f.tide.value }; save(); };
  $('#go', root).onclick = async () => {
    if (state.sites.some(s => s.protected) && !$('#perm', root).checked) { toast('Permission needed', 'warn', 'Tick the box to confirm written permission for protected sites.'); return; }
    if (await startMission()) location.hash = '#/live';
  };
  $('#schedBtn', root).onclick = () => scheduleMission();
  return () => map?.destroy();
}

/* ─────────────────────────── Live ─────────────────────────── */
function live(root) {
  root.innerHTML = `
  <section class="grid">
    <div class="live-wrap">
      <div class="card live-stage stage" id="liveStage" data-autorotate="off">
        <div class="live-hud"><span class="tag ok" id="hState">IDLE</span><span class="tag" id="hSite">No site</span><span class="tag info" id="hTube">Next ${tubeId(state.nextTube)}</span></div>
        <div class="live-ctrl">
          <button class="btn primary" id="start">Start mission</button>
          <button class="btn" id="pause">Pause</button>
          <button class="btn danger" id="abort">Abort</button>
          <span class="spacer"></span>
          <span class="tag" id="hLink">${link.connected ? link.label : 'Not connected'}</span>
        </div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="card ring-wrap" id="ring">${missionRing(link.step?.n || 0)}</div>
        <div class="card">
          <div class="gauges">
            ${gauge('ph', 'pH', '', 14)}${gauge('ntu', 'Turbidity', 'NTU', 100, true)}
            ${gauge('ml', 'Volume', 'mL', 1000)}${gauge('bat', 'Battery', 'V', 12.8)}
          </div>
          <div class="io">
            <span id="io-pumpS"><i></i>Sample pump</span><span id="io-pumpE"><i></i>Ethanol pump</span>
            <span id="io-press"><i></i>Nozzle sealed</span><span id="io-rain"><i></i>Rain</span>
          </div>
        </div>
      </div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Mission log</h2><div class="term" id="term"></div></div>
      <div class="card"><h2>Carousel <span class="tag" id="seatTag">Seat 1 of 8</span></h2>
        <div class="slotgrid" id="seatGrid" style="grid-template-columns:repeat(8,1fr)"></div>
        <p class="dim" style="font-size:13px;margin-top:10px">Pump current: <b id="cur">—</b> · Water temperature: <b id="temp">—</b> · Rain sensor: <b id="rain">dry</b></p>
        <div style="margin-top:10px"><b>Carry the Pod to the site</b><p class="dim" style="font-size:13px;margin:2px 0 8px">While the carousel turns, stake the Pod on the bank and drop the strainer in the water. Then tap the button.</p>
          <button class="btn primary sm" id="arrived" disabled>Pod in place — start sampling</button></div>
      </div>
    </div>
  </section>`;
  const off = stage(root, '#liveStage');
  const offT = termBind($('#term', root));
  const onTele = e => {
    const t = e.detail;
    setG('ph', t.ph, 14, 2); setG('ntu', t.ntu, 100, 1); setG('ml', t.ml, t.target || 1000, 0, t.target ? ` / ${t.target}` : ''); setG('bat', t.bat, 12.8, 2);
    ['pumpS', 'pumpE', 'press', 'rain'].forEach(k => $(`#io-${k}`, root)?.classList.toggle('on', !!t[k]));
    $('#hState', root).textContent = t.paused ? 'PAUSED' : t.state;
    $('#cur', root).textContent = t.cur ? `${fmtNum(t.cur, 2)} A${t.cur > 0.5 ? ' — clogging' : ''}` : '—';
    $('#temp', root).textContent = t.temp != null ? `${fmtNum(t.temp, 1)} °C` : '—';
    $('#rain', root).textContent = t.rain ? 'wet' : 'dry';
    seats(t.seat);
    $('#pause', root).textContent = t.paused ? 'Resume' : 'Pause';
  };
  const setG = (k, v, max, d, extra = '') => {
    const el = $(`#g-${k}`, root); if (!el) return;
    el.querySelector('.gv').innerHTML = `${fmtNum(v, d)}<small> ${el.dataset.unit}${extra}</small>`;
    el.querySelector('.bar i').style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  };
  const seats = cur => {
    const base = Math.floor((state.nextTube - 1) / 8) * 8;
    $('#seatTag', root).textContent = `Seat ${cur || 1} of 8`;
    $('#seatGrid', root).innerHTML = Array.from({ length: 8 }, (_, i) => { const s = state.samples.find(x => x.tube === base + i + 1); return `<span class="${s ? (s.blank ? 'blank' : 'used') : ''}" style="${(cur || 1) === i + 1 ? 'outline:2px solid var(--mint);outline-offset:1px' : ''}" title="${s ? esc(s.id) : `Seat ${i + 1}`}">${i + 1}</span>`; }).join('');
  };
  seats(link.tele?.seat);
  const onStep = e => {
    $('#arrived', root).disabled = e.detail.n !== 2;
    $('#ring', root).innerHTML = missionRing(e.detail.n);
    $('#hSite', root).textContent = e.detail.siteName || '—';
    if (e.detail.tube) $('#hTube', root).textContent = `Tube ${tubeId(e.detail.tube)}`;
    const on = root.querySelector('#ring .seg.on');
    if (window.gsap && on) gsap.fromTo(on, { opacity: .3 }, { opacity: 1, duration: .5 });
  };
  const onEnd = () => { $('#ring', root).innerHTML = missionRing(0, 8); $('#hSite', root).textContent = 'Mission finished'; $('#hTube', root).textContent = `Next ${tubeId(state.nextTube)}`; $('#hState', root).textContent = 'IDLE'; };
  const onStatus = () => { $('#hLink', root).textContent = link.connected ? link.label : 'Not connected'; };
  link.addEventListener('tele', onTele); link.addEventListener('step', onStep);
  link.addEventListener('done', onEnd); link.addEventListener('aborted', onEnd); link.addEventListener('status', onStatus);
  if (link.tele) onTele({ detail: link.tele });
  $('#start', root).onclick = () => startMission();
  $('#arrived', root).disabled = link.step?.n !== 2;
  $('#arrived', root).onclick = () => { link.send({ cmd: 'placed' }); $('#arrived', root).disabled = true; };
  $('#pause', root).onclick = () => { if (!link.connected) return; link.send({ cmd: link.tele?.paused ? 'resume' : 'pause' }); };
  $('#abort', root).onclick = () => { if (link.busy && confirm('Abort the mission? Pumps stop and the nozzle lifts.')) link.send({ cmd: 'abort' }); };
  return () => { off(); offT(); link.removeEventListener('tele', onTele); link.removeEventListener('step', onStep); link.removeEventListener('done', onEnd); link.removeEventListener('aborted', onEnd); link.removeEventListener('status', onStatus); };
}
const gauge = (k, l, unit, max, amber) => `<div class="gauge" id="g-${k}" data-unit="${unit}"><div class="gl">${l}</div><div class="gv">—<small> ${unit}</small></div><div class="bar ${amber ? 'amber' : ''}"><i></i></div></div>`;

/* ─────────────────────────── Samples ─────────────────────────── */
function samples(root) {
  root.innerHTML = `
  <section class="grid">
    <div class="card">
      <div class="row" style="margin-bottom:14px">
        <input type="search" id="q" placeholder="Search cartridge or site" style="max-width:260px" aria-label="Search samples">
        <select id="st" style="max-width:200px" aria-label="Filter by status"><option value="">All statuses</option>${STATUSES.map(s => `<option>${s}</option>`).join('')}</select>
        <span class="spacer"></span>
        <button class="btn" id="ship">Mark selected shipped</button>
        <button class="btn" id="labels">Print QR labels</button>
        <button class="btn primary" id="csv">Export lab manifest (CSV)</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th><input type="checkbox" id="all" aria-label="Select all"></th><th>Cartridge</th><th>Site</th><th>Collected</th><th>Volume</th><th>pH</th><th>NTU</th><th>Type</th><th>Status</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Carousels <span class="tag">8 seats each · ${Math.ceil(state.samples.length / 8) || 0} used</span></h2><div class="slotgrid" id="rack" style="grid-template-columns:repeat(8,1fr)"></div><p class="dim" style="font-size:13px;margin-top:8px">One row per carousel. A full carousel goes in the fridge, then to the lab, and a fresh one clicks in.</p></div>
      <div class="card"><h2>Chain of custody</h2><p>Every cartridge has a QR label that encodes its ID, site, time and volume. Scan it at each hand-over so the lab result always matches the right place and time.</p>
        <div class="row">${STATUSES.map((s, i) => `<span class="tag ${i === 3 ? 'ok' : ''}">${i + 1}. ${s}</span>`).join('')}</div></div>
    </div>
  </section>`;
  const sel = new Set();
  const list = () => {
    const q = $('#q', root).value.toLowerCase(), st = $('#st', root).value;
    return [...state.samples].sort((a, b) => b.tube - a.tube).filter(s => (!q || s.id.toLowerCase().includes(q) || s.siteName.toLowerCase().includes(q)) && (!st || s.status === st));
  };
  const draw = () => {
    const L = list();
    $('#rows', root).innerHTML = L.length ? L.map(s => `<tr>
      <td><input type="checkbox" data-sel="${s.tube}" ${sel.has(s.tube) ? 'checked' : ''} aria-label="Select ${esc(s.id)}"></td>
      <td class="mono"><b>${esc(s.id)}</b></td><td>${esc(s.siteName)}</td><td class="dim">${fmtTime(s.ts)}</td>
      <td>${s.ml}${s.target ? ` <span class="dim">/ ${s.target}</span>` : ''} mL ${s.clog ? '<span class="tag warn">clog</span>' : ''}</td>
      <td>${fmtNum(s.ph, 2)}</td><td>${fmtNum(s.ntu, 1)}</td><td>${s.blank ? '<span class="tag info">Field blank</span>' : '<span class="tag">Sample</span>'}</td>
      <td><select data-status="${s.tube}" aria-label="Status of ${esc(s.id)}">${STATUSES.map(x => `<option ${x === s.status ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td><button class="icon-btn" data-del="${s.tube}" aria-label="Delete ${esc(s.id)}">${icons.x}</button></td></tr>`).join('')
      : `<tr><td colspan="10"><div class="empty">No samples${state.samples.length ? ' match' : ' yet — run a mission'}.</div></td></tr>`;
    $$('[data-sel]', root).forEach(c => c.onchange = () => { c.checked ? sel.add(+c.dataset.sel) : sel.delete(+c.dataset.sel); });
    $$('[data-status]', root).forEach(c => c.onchange = () => { state.samples.find(s => s.tube === +c.dataset.status).status = c.value; save(); });
    $$('[data-del]', root).forEach(b => b.onclick = () => { if (confirm('Delete this sample record?')) { state.samples = state.samples.filter(s => s.tube !== +b.dataset.del); save(); draw(); } });
    const used = new Map(state.samples.map(s => [s.tube - 1, s]));
    const rows = Math.max(1, Math.ceil(Math.max(state.nextTube - 1, state.samples.length) / 8));
    $('#rack', root).innerHTML = Array.from({ length: rows * 8 }, (_, i) => { const s = used.get(i); return `<span class="${s ? (s.blank ? 'blank' : 'used') : ''}" title="${s ? esc(s.id) : `Carousel ${Math.floor(i / 8) + 1}, seat ${i % 8 + 1}`}">${i % 8 + 1}</span>`; }).join('');
  };
  draw();
  $('#q', root).oninput = draw; $('#st', root).onchange = draw;
  $('#all', root).onchange = e => { list().forEach(s => e.target.checked ? sel.add(s.tube) : sel.delete(s.tube)); draw(); };
  $('#ship', root).onclick = () => { if (!sel.size) return toast('Select cartridges first', 'warn'); state.samples.forEach(s => { if (sel.has(s.tube)) s.status = 'Shipped'; }); save(); draw(); toast(`${sel.size} cartridges marked shipped`); };
  $('#csv', root).onclick = () => {
    const rows = (sel.size ? state.samples.filter(s => sel.has(s.tube)) : state.samples).map(s => ({ tube_id: s.id, site: s.siteName, lat: s.lat, lon: s.lon, collected: new Date(s.ts).toISOString(), volume_ml: s.ml, ph: s.ph, ntu: s.ntu, field_blank: s.blank ? 'yes' : 'no', status: s.status }));
    if (!rows.length) return toast('No samples to export', 'warn');
    download('edna-lab-manifest.csv', toCSV(rows, Object.keys(rows[0])), 'text/csv');
  };
  $('#labels', root).onclick = () => printLabels(sel.size ? state.samples.filter(s => sel.has(s.tube)) : state.samples);
}

function printLabels(list) {
  if (!list.length) return toast('No samples to label', 'warn');
  const area = document.getElementById('printArea');
  area.innerHTML = list.map(s => {
    let qr = '';
    if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(`EDNA|${s.id}|${s.siteName}|${new Date(s.ts).toISOString()}|${s.ml}mL${s.blank ? '|BLANK' : ''}`); q.make(); qr = q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); }
    return `<div class="label">${qr}<div><b>${esc(s.id)}</b>${esc(s.siteName)}<br>${new Date(s.ts).toLocaleString()}<br>${s.ml} mL · pH ${s.ph} · ${s.ntu} NTU${s.blank ? '<br><b>FIELD BLANK</b>' : ''}<br>Canopy Keepers · eDNA Pod</div></div>`;
  }).join('');
  setTimeout(() => window.print(), 100);
}

/* ─────────────────────────── Results ─────────────────────────── */
function results(root) {
  const al = alerts();
  const inv = new Set(state.watchlist.filter(w => w.kind === 'invasive').map(w => w.species.toLowerCase()));
  const bySite = new Map();
  state.samples.filter(s => !s.blank).forEach(s => {
    const sp = new Set(state.results.filter(r => r.tube === s.id && r.reads > 0).map(r => r.species));
    if (!bySite.has(s.siteName)) bySite.set(s.siteName, new Set());
    sp.forEach(x => bySite.get(s.siteName).add(x));
  });
  const reads = new Map();
  state.results.forEach(r => { if (!state.samples.find(s => s.id === r.tube)?.blank) { const k = r.species; const o = reads.get(k) || { species: k, common: r.common, reads: 0, tubes: 0 }; o.reads += r.reads; o.tubes++; reads.set(k, o); } });
  const top = [...reads.values()].sort((a, b) => b.reads - a.reads).slice(0, 10);
  root.innerHTML = `
  <section class="grid">
    <div class="grid g2">
      <div class="card"><h2>Alerts <span class="tag ${al.length ? 'crit' : 'ok'}">${al.length ? `${al.length} open` : 'All clear'}</span></h2>${al.length ? al.map(alertRow).join('') : '<div class="empty">No alerts.</div>'}</div>
      <div class="card"><h2>Import lab results</h2>
        <div class="drop" id="drop">Drop the lab’s CSV here, or <label style="color:var(--mint);cursor:pointer;text-decoration:underline">browse<input type="file" accept=".csv,text/csv" id="file" hidden></label><br><span class="dim" style="font-size:13px">Columns: tube_id, species, common_name, reads</span></div>
        <div class="row" style="margin-top:12px"><button class="btn" id="demo">Load demo results</button><a class="btn ghost" href="docs/sample-results.csv" download>Sample CSV</a><button class="btn ghost" id="clear">Clear results</button></div>
        <p class="dim" style="font-size:13px;margin-top:10px">Demo results are fictional, for training only.</p>
      </div>
    </div>
    <div class="grid g2">
      <div class="card chart"><h2>Species per site</h2>${columns([...bySite].map(([k, v]) => ({ label: k, value: v.size })))}</div>
      <div class="card chart"><h2>Strongest DNA signals <span class="tag">total reads</span></h2>${hbars(top.map(t => ({ label: t.common || t.species, value: t.reads, color: inv.has(t.species.toLowerCase()) ? '#F5A524' : '#B8E07A', note: inv.has(t.species.toLowerCase()) ? 'watchlist' : '' })))}</div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Species list by site</h2>${bySite.size ? [...bySite].map(([site, set]) => `<p class="eyebrow" style="margin-top:12px">${esc(site)}</p><div class="species">${[...set].map(sp => { const r = reads.get(sp); const bad = inv.has(sp.toLowerCase()); return `<div class="sp"><div><b>${esc(r?.common || sp)}</b> <i>${esc(sp)}</i></div>${bad ? '<span class="tag crit">Watchlist</span>' : '<span class="tag ok">Detected</span>'}</div>`; }).join('') || '<div class="dim">No detections</div>'}</div>`).join('') : '<div class="empty">Import results to see species.</div>'}</div>
      <div class="card"><h2>Watchlist <span class="tag">${state.watchlist.length}</span></h2>
        <p>Species you want an alert for — e.g. invasive species named by your experts.</p>
        <div class="species" id="wl"></div>
        <form class="form c3" id="wlForm" style="margin-top:12px">
          <input type="text" name="species" placeholder="Scientific name" required aria-label="Scientific name">
          <input type="text" name="common" placeholder="Common name" aria-label="Common name">
          <button class="btn">Add to watchlist</button>
        </form>
      </div>
    </div>
  </section>`;
  const drawWL = () => {
    $('#wl', root).innerHTML = state.watchlist.map((w, i) => `<div class="sp"><div><b>${esc(w.common || w.species)}</b> <i>${esc(w.species)}</i>${w.note ? `<br><small class="dim">${esc(w.note)}</small>` : ''}</div><button class="icon-btn" data-wdel="${i}" aria-label="Remove">${icons.x}</button></div>`).join('') || '<div class="dim">Empty</div>';
    $$('[data-wdel]', root).forEach(b => b.onclick = () => { state.watchlist.splice(+b.dataset.wdel, 1); save(); results(root); });
  };
  drawWL();
  $('#wlForm', root).onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); state.watchlist.push({ species: f.get('species'), common: f.get('common'), kind: 'invasive', note: '' }); save(); results(root); };
  const load = text => { try { const n = importResults(parseCSV(text)); toast(`${n} detections imported`); results(root); } catch (err) { toast('Could not read that CSV', 'warn', err.message); } };
  $('#file', root).onchange = e => { const f = e.target.files[0]; if (f) f.text().then(load); };
  const drop = $('#drop', root);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) f.text().then(load); };
  $('#demo', root).onclick = () => { if (!state.samples.length) return toast('Run a mission first', 'warn', 'Demo results are generated for the cartridges in your registry.'); const n = demoResults(); toast(`${n} demo detections loaded`, 'ok', 'Fictional data for training.'); results(root); };
  $('#clear', root).onclick = () => { if (confirm('Clear all lab results?')) { state.results = []; save(); results(root); } };
  if (window.gsap && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const hb = root.querySelectorAll('.hb-bar'), cb = root.querySelectorAll('.col-bar');
    if (hb.length) gsap.from(hb, { attr: { width: 0 }, duration: 1, stagger: .05, ease: 'power3.out' });
    if (cb.length) gsap.from(cb, { scaleY: 0, transformOrigin: '50% 100%', duration: .9, stagger: .07, ease: 'power3.out' });
  }
}

/* ─────────────────────────── Calibration ─────────────────────────── */
function calibrate(root) {
  const st = state.settings, g = st.carousel;
  root.innerHTML = `
  <section class="grid">
    <div class="grid g2">
      <div class="card">
        <h2>Pump calibration <span class="tag ${st.pumpCal.length >= 3 ? 'ok' : 'warn'}">${st.pumpMlPerS} mL/s</span></h2>
        <p>Volume is measured by pump run-time, so calibrate before every event. Put the intake in a bucket and the outlet in a measuring jug.</p>
        <div class="steps">${[0, 1, 2, 3, 4].map(i => `<i class="${i < st.pumpCal.length ? 'on' : ''}"></i>`).join('')}</div>
        <div class="form c3">
          <label class="f">Run time (s)<input type="number" id="pSec" value="10" min="2" max="120"></label>
          <label class="f">Measured volume (mL)<input type="number" id="pMl" placeholder="e.g. 86"></label>
          <div class="row" style="align-self:end"><button class="btn" id="pRun">Run pump</button><button class="btn primary" id="pAdd">Save run</button></div>
        </div>
        <div id="pRes" style="margin-top:12px"></div>
        <button class="btn ghost sm" id="pReset" style="margin-top:8px">Clear runs</button>
      </div>
      <div class="card">
        <h2>pH probe · two-point</h2>
        <p>Dip the probe in pH 7 buffer, capture; rinse; pH 4 buffer, capture.</p>
        <div class="form c2">
          <label class="f">Voltage at pH 7<input type="number" step="0.001" id="v7" value="${st.ph.v7}"></label>
          <label class="f">Voltage at pH 4<input type="number" step="0.001" id="v4" value="${st.ph.v4}"></label>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn" data-cap="v7">Capture pH 7</button><button class="btn" data-cap="v4">Capture pH 4</button><button class="btn primary" id="phSave">Save &amp; send</button></div>
        <p class="dim" style="font-size:13px;margin-top:10px" id="phSlope"></p>
        <h2 style="margin-top:18px">Turbidity zero</h2>
        <div class="row"><label class="f" style="flex:1">Voltage in clean water<input type="number" step="0.001" id="nz" value="${st.ntuZeroV}"></label><button class="btn" data-cap="nz" style="align-self:end">Capture</button></div>
      </div>
    </div>
    <div class="grid g2">
      <div class="card">
        <h2>Carousel</h2>
        <p>How far the stepper turns between seats. With a 200-step motor at 16 microsteps, 8 seats need 400 steps each. Run 80 moves and check seat 1 still lines up (test 3).</p>
        <form class="form c3" id="gForm">
          <label class="f">Seats<input type="number" name="seats" value="${g.seats}" min="1" max="16"></label>
          <label class="f">Steps per seat<input type="number" name="stepsPerSeat" value="${g.stepsPerSeat}" min="10"></label>
        </form>
        <div class="slotgrid" id="gPrev"></div>
      </div>
      <div class="card">
        <h2>Data</h2>
        <p>Everything is stored in this browser. Back it up after every mission and before the competition.</p>
        <div class="row"><button class="btn primary" id="exp">Export backup</button><label class="btn">Import backup<input type="file" accept=".json" id="imp" hidden></label><button class="btn danger" id="rst">Reset to demo data</button></div>
        <h2 style="margin-top:22px">Device name</h2>
        <input type="text" id="dname" value="${esc(st.deviceName)}" aria-label="Device name">
      </div>
    </div>
  </section>`;
  const pRes = () => {
    const runs = st.pumpCal;
    if (!runs.length) { $('#pRes', root).innerHTML = '<span class="dim">No runs yet — aim for 5.</span>'; return; }
    const rates = runs.map(r => r.ml / r.seconds), mean = rates.reduce((a, b) => a + b) / rates.length;
    const spread = (Math.max(...rates) - Math.min(...rates)) / 2 / mean * 100;
    $('#pRes', root).innerHTML = `<div class="table-wrap"><table><thead><tr><th>Run</th><th>Seconds</th><th>mL</th><th>mL/s</th></tr></thead><tbody>${runs.map((r, i) => `<tr><td>${i + 1}</td><td>${r.seconds}</td><td>${r.ml}</td><td>${(r.ml / r.seconds).toFixed(2)}</td></tr>`).join('')}</tbody></table></div>
      <p style="margin-top:10px"><b>Mean ${mean.toFixed(2)} mL/s</b> · spread ±${spread.toFixed(1)}% <span class="tag ${spread <= 5 ? 'ok' : 'warn'}">${spread <= 5 ? 'Within ±5% target' : 'Above ±5% — check tubing'}</span></p>`;
  };
  pRes();
  $('#pRun', root).onclick = () => { if (!link.send({ cmd: 'pump', which: 'S', seconds: +$('#pSec', root).value })) toast('Connect the Pod (or simulator) first', 'warn'); else toast('Pump running', 'ok', 'Measure the water in the jug when it stops, then save the run.'); };
  $('#pAdd', root).onclick = () => {
    const ml = +$('#pMl', root).value, seconds = +$('#pSec', root).value;
    if (!ml || !seconds) return toast('Enter the measured volume', 'warn');
    st.pumpCal.push({ seconds, ml }); if (st.pumpCal.length > 5) st.pumpCal.shift();
    const rates = st.pumpCal.map(r => r.ml / r.seconds);
    st.pumpMlPerS = +(rates.reduce((a, b) => a + b) / rates.length).toFixed(2);
    save(); calibrate(root);
  };
  $('#pReset', root).onclick = () => { st.pumpCal = []; save(); calibrate(root); };
  const slope = () => { const v7 = +$('#v7', root).value, v4 = +$('#v4', root).value; const s = (7 - 4) / (v7 - v4); $('#phSlope', root).textContent = isFinite(s) ? `Slope ${s.toFixed(3)} pH/V · pH = 7 + (V − ${v7}) × ${s.toFixed(3)}` : 'Voltages must differ'; };
  slope();
  let capKey = null;
  $$('[data-cap]', root).forEach(b => b.onclick = () => { capKey = b.dataset.cap; if (!link.send({ cmd: 'read' })) { toast('Connect first', 'warn'); capKey = null; } });
  const onRaw = e => { if (!capKey) return; const v = capKey === 'nz' ? e.detail.ntuV : e.detail.phV; $(`#${capKey}`, root).value = v; capKey = null; slope(); toast(`Captured ${v} V`); };
  if (calRaw) link.removeEventListener('raw', calRaw);
  calRaw = onRaw;
  link.addEventListener('raw', onRaw);
  $('#v7', root).oninput = slope; $('#v4', root).oninput = slope;
  $('#phSave', root).onclick = () => { st.ph = { v7: +$('#v7', root).value, v4: +$('#v4', root).value }; st.ntuZeroV = +$('#nz', root).value; save(); link.send({ cmd: 'setcal', ph: st.ph, ntuZeroV: st.ntuZeroV, mlPerS: st.pumpMlPerS, carousel: st.carousel }); toast('Calibration saved'); };
  const gPrev = () => {
    const f = $('#gForm', root); ['seats', 'stepsPerSeat'].forEach(k => g[k] = +f[k].value || 0); save();
    const el = $('#gPrev', root); el.style.gridTemplateColumns = `repeat(${g.seats},1fr)`;
    el.innerHTML = Array.from({ length: g.seats }, (_, i) => `<span title="${i * g.stepsPerSeat} steps from home">${i + 1}</span>`).join('');
  };
  gPrev(); $('#gForm', root).oninput = gPrev;
  $('#exp', root).onclick = () => download(`edna-backup-${new Date().toISOString().slice(0, 10)}.json`, exportJSON(), 'application/json');
  $('#imp', root).onchange = e => e.target.files[0]?.text().then(t => { try { importJSON(t); toast('Backup restored'); calibrate(root); } catch (err) { toast('Import failed', 'warn', err.message); } });
  $('#rst', root).onclick = () => { if (confirm('Reset all sites, samples and results to the demo set?')) { resetAll(); collector.setFilled([]); toast('Reset done'); calibrate(root); } };
  $('#dname', root).onchange = e => { st.deviceName = e.target.value; save(); };
  return () => { link.removeEventListener('raw', calRaw); calRaw = null; };
}
let calRaw = null;

/* ─────────────────────────── Help ─────────────────────────── */
function help(root) {
  const team = [['Pranav', 'Team Captain'], ['Araav', 'Project Manager'], ['Arnav', 'Researcher'], ['Atharv', 'Builder'], ['Dipayan', 'Material Manager · electronics'], ['Gokul', 'Coder'], ['Lakshanya', 'Creative Designer · testing'], ['Jude Mugalian', 'Communicator']];
  root.innerHTML = `
  <section class="grid g2">
    <div class="card prose">
      <h2>Quick start</h2>
      <ol>
        <li><b>Calibrate</b> the pump (5 runs) and the pH probe before each field day.</li>
        <li><b>Plan</b> sites on the map, check the sampling rules, keep the field blank on.</li>
        <li><b>Connect</b> by Bluetooth or USB — or use the simulator to practise.</li>
        <li><b>Start</b> the mission and watch it live. Abort stops the pumps and lifts the nozzle.</li>
        <li><b>Label</b> cartridges with QR codes, export the lab manifest and ship them cool.</li>
        <li><b>Import</b> the lab’s CSV to see species per site and alerts.</li>
      </ol>
      <h3>How a sample stays clean</h3>
      <p>Prime with site water → seal the nozzle → filter → preserve with ethanol → flush the hose, a fresh cartridge at every site, and one bottled-water blank per mission. If the blank shows DNA, the app raises a contamination alert.</p>
      <h3>For developers</h3>
      <p>The app talks to the Pod in newline-delimited JSON over Bluetooth (Nordic UART service), USB serial at 115200 baud, or a WebSocket at <code>/ws</code>. See <a href="docs/PROTOCOL.md">PROTOCOL.md</a> and the ESP32 firmware in <code>/firmware</code>.</p>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card prose">
        <h2>Safety rules <span class="tag warn">Read first</span></h2>
        <ul>
          <li>An adult supervises every field test and anything with ethanol or bleach.</li>
          <li>Never mix bleach and ethanol. Rinse bleach-cleaned tools with distilled water.</li>
          <li>Keep ethanol sealed and away from the electronics box.</li>
          <li>Electronics stay in the sealed box above the waterline; know where the main switch is.</li>
          <li>Protected forests, reserves and zoo or museum habitats need written permission before any sampling.</li>
          <li>No animals are caught or touched — only water is sampled.</li>
        </ul>
      </div>
      <div class="card">
        <h2><img src="assets/canopy-keepers-logo.svg" alt="" width="40" height="40"> Made by Team Canopy Keepers</h2>
        <div class="team">${team.map(([n, r]) => `<div class="member"><span class="av">${n[0]}</span><div><b>${n}</b><small>${r}</small></div></div>`).join('')}</div>
        <p class="dim" style="margin-top:12px;font-size:13px">FIRST LEGO League · BIOGLOW 2026–27 · Dubai, UAE. Demo results in this app are fictional.</p>
      </div>
    </div>
  </section>`;
}

export const VIEWS = {
  overview: { title: 'Overview', render: overview },
  connect: { title: 'Connect', render: connect },
  planner: { title: 'Mission planner', render: planner },
  live: { title: 'Live mission', render: live },
  samples: { title: 'Sample registry', render: samples },
  results: { title: 'Biodiversity', render: results },
  calibrate: { title: 'Calibration', render: calibrate },
  help: { title: 'Help & safety', render: help },
};
