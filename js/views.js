// All screens of the console. Each view renders into #view and returns a cleanup function.
import { $, $$, esc, loadScript, fmtTime, fmtNum, toast, download, toCSV, parseCSV, countUp, icons, tubeId, todayISO, siteCode, parseSampleId } from './util.js';
import {
  state, save, STATUSES, STOP_REASONS, addSite, updateSite, removeSite, moveSite, importResults, demoResults, alerts, exportJSON, importJSON, resetAll,
  siteById, planLayout, runOrder, freshCarouselStart, activeMission, blankDone, sampleRows, sampleCols, siteResults, displayCoords,
  createBatch, addHandover, nextSiteCode, carouselStart, rowToRecord, addSample,
} from './store.js';
import { link, support } from './device.js';
import { collector } from './scene.js';
import { siteMap } from './map.js';
import { hbars, columns, missionRing } from './charts.js';
import { startMission, startDemo, scheduleMission, planProblems, waiting, confirmCurrent, canConfirm, prescan, pendingLabels, isConfirmed, blankIsDone, needsLocation, setManualLocation } from './mission.js';
import { schematicHTML, bindSchematic } from './schematic.js';
import { tickerHTML } from './motion.js';

const STEPS = [
  ['Self-check', 'Battery, temperature, SD card and load cell checked; the carousel finds seat 1 (double magnet).'],
  ['Field blank first', 'Seat 1: 1 L of distilled water through the whole water path. Scan the blank’s label. No sample can run before it.'],
  ['New site', 'New bagged intake tube, bleach the nozzle 10 min, rinse. 250 mL of site water flushes through the empty seat 8 to waste.'],
  ['Scan', 'Each cartridge’s QR label is scanned before it is filled — the Pod pauses if one is missing.'],
  ['Seal + pump', 'The nozzle seals and water is pulled through the 0.45 µm filter. Stops at 1 L, 20 min, or flow below 20 mL/min.'],
  ['Preserve', 'The cartridge drains, then ≥95% ethanol keeps the DNA safe.'],
  ['Log', 'ID, place, time, volume and stop reason saved to SD, flash and the app. Valid only if ≥ 250 mL.'],
  ['Repeat', '3 replicates per site, 2 sites per mission (or 6 at one site).'],
];
const ROLE_LABEL = e => e.role === 'blank' ? 'Field blank' : e.role === 'flush' ? 'Flush (no filter)' : `${e.siteCode || ''} rep ${e.rep ?? e.replicate}`;
const LOC_LABEL = { gps: 'GPS', pod: 'Pod', manual: 'Manual', plan: 'Planned site', none: 'None' };

// The 3D Pod loads on demand (see scene.js): on wide screens when the stage is visible,
// on phones only after "Show 3D model" is pressed. `setup` runs once it is attached.
function stage(root, sel, setup) {
  return collector.mount($(sel, root), c => {
    c.setFilled(state.samples.filter(s => s.tube > 0)); c.setClean(true); c.setViewShift(0);
    if (setup) setup(c);
  });
}
const lastMission = () => [...state.missions].reverse().find(m => m.layout) || null;
const validTag = s => s.role === 'blank' ? '<span class="tag info">blank</span>' : s.valid ? '<span class="tag ok">valid</span>' : '<span class="tag crit">not valid</span>';
const alertRow = a => `<div class="alert ${a.level}"><span class="dot"></span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`;

/* ─────────────────────────── Overview ─────────────────────────── */
function overview(root) {
  const al = alerts();
  const sr = siteResults();
  const confirmed = new Set(sr.flatMap(v => v.species.filter(o => o.result === 'confirmed').map(o => o.species)));
  const recent = [...state.samples].sort((a, b) => b.ts - a.ts).slice(0, 6);
  const m = lastMission();
  const ms = m ? state.samples.filter(s => s.mission === m.id) : [];
  const bDone = ms.some(s => s.role === 'blank'), nS = ms.filter(s => s.role === 'sample').length, nV = ms.filter(s => s.role === 'sample' && s.valid).length;
  const validAll = state.samples.filter(s => s.role === 'sample' && s.valid).length;
  root.innerHTML = `
  <section class="ov-hero" aria-label="Pod status">
    <div class="stage ov-stage" id="heroStage"></div>
    <div class="ov-meta"><span>Mission control</span><span>${link.connected ? esc(link.label) : 'Pod not connected'}</span></div>
    <div class="ov-copy">
      <h2 class="ov-h"><span class="ln"><span>1 blank.</span></span><span class="ln"><span>${m ? `${nS} of 6` : '6 samples.'}</span></span><span class="ln"><span><em>${m ? (nS === 6 ? 'done.' : 'filled.') : '1 flush.'}</em></span></span></h2>
      <div class="ov-side">
        <p>${m ? `Last mission ${esc(m.id)}: field blank ${bDone ? 'logged' : 'not run yet'} · ${nV} of ${nS} samples valid (≥ 250 mL).` : 'Seat 1 is the field blank and always runs first. Seats 2–7 hold 6 samples (2 sites × 3 replicates). Seat 8 is empty and flushes the line.'}</p>
        <div class="ov-btns"><a class="btn primary" href="#/planner">Plan a mission</a><button class="btn" id="quickSim">Run a simulated mission</button><button class="btn" id="demoRun">Demo run (judges)</button></div>
      </div>
    </div>
  </section>
  ${tickerHTML(['Every drop has a guest list', 'Field blank first, every mission', '1 blank + 6 samples + 1 flush', 'Not detected is not proof of absence', 'Canopy Keepers · FLL BIOGLOW'])}
  <section class="ov-facts">
    <div class="ov-fact"><b id="sCount">${validAll}</b><span>valid samples</span></div>
    <div class="ov-fact"><b id="siteCount">${state.sites.length}</b><span>sites in the plan</span></div>
    <div class="ov-fact"><b id="spCount">${confirmed.size}</b><span>species confirmed</span></div>
    <div class="ov-fact ${al.length ? 'hot' : ''}"><b id="alCount">${al.length}</b><span>${al.length ? 'alerts to check' : 'alerts. All clear'}</span></div>
  </section>
  <section class="grid">
    <div class="card sx-card">
      <h2>Inside the Pod <span class="sx-live" id="sxLive">Idle</span></h2>
      ${schematicHTML()}
    </div>
    <div class="grid g2">
      <div class="card">
        <h2>Recent samples <a class="h-link" href="#/samples">Open registry</a></h2>
        ${recent.length ? `<div class="table-wrap"><table><thead><tr><th>Sample ID</th><th>Site</th><th>Volume</th><th>When</th></tr></thead><tbody>
          ${recent.map(s => `<tr><td class="mono">${esc(s.id)}</td><td>${esc(s.siteName)}${s.role === 'sample' ? ` <span class="dim">rep ${s.replicate}</span>` : ''}</td><td>${s.ml} mL ${validTag(s)}</td><td class="dim">${fmtTime(s.ts)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No samples yet. Plan a mission, print the labels, and start with the field blank.</div>'}
      </div>
      <div class="card">
        <h2>Alerts <span class="tag ${al.length ? 'crit' : 'ok'}">${al.length ? `${al.length} open` : 'All clear'}</span></h2>
        ${al.length ? al.slice(0, 4).map(alertRow).join('') : '<div class="empty">No alerts. Blanks are clean, every sample is valid and no watchlist species were found.</div>'}
      </div>
    </div>
    <div class="ov-loop">
      <h2 class="big-h">What the Pod does for every cartridge</h2>
      <ol class="loop">${STEPS.map(s => `<li><b>${s[0]}</b><span>${s[1]}</span></li>`).join('')}</ol>
    </div>
  </section>`;
  countUp($('#sCount', root), validAll);
  countUp($('#siteCount', root), state.sites.length);
  countUp($('#spCount', root), confirmed.size);
  countUp($('#alCount', root), al.length);
  $('#quickSim', root).onclick = async () => { if (await startMission()) location.hash = '#/live'; };
  $('#demoRun', root).onclick = async () => { if (await startDemo()) location.hash = '#/live'; };
  const offS = stage(root, '#heroStage', c => {
    c.camera.position.set(11.5, 6.2, 11.5); c.controls.target.set(0, 1.6, 0);
    c.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches; c.controls.autoRotateSpeed = 0.6;
    c.controls.enableZoom = false; c.setViewShift(innerWidth > 900 ? 0.24 : 0); c.controls.update();
  }), offX = bindSchematic(root);
  return () => { offS(); offX(); };
}

/* ─────────────────────────── Connect ─────────────────────────── */
function connect(root) {
  const opts = [
    { k: 'sim', t: 'Simulator', d: 'A digital twin of the Pod. Runs full missions (blank, flush, 6 samples) with realistic data — for training and demos.', ok: true, ic: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/>' },
    { k: 'ble', t: 'Bluetooth', d: 'Wireless link to the Pod in the field — no mobile signal needed (Chrome or Edge on Android, Windows, macOS).', ok: support.bluetooth(), ic: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>' },
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
          <button class="btn" id="recBtn" title="Copy samples.csv from the Pod's SD card into this app">Copy records from Pod</button>
          <button class="btn danger" id="discBtn">Disconnect</button>
        </div>
        <label class="f" style="margin-top:16px">Simulator speed: <b id="spdV">×${state.settings.simSpeed}</b>
          <input type="range" min="1" max="120" value="${state.settings.simSpeed}" id="spd">
        </label>
        <p class="dim" style="font-size:14px;margin-top:10px">If the app won’t connect, the Pod still logs everything to its microSD card. Keep the pencil datasheet as the last backup.</p>
      </div>
      <div class="card"><h2>Protocol log <span class="tag">JSON lines</span></h2><div class="term" id="term"></div></div>
    </div>
  </section>`;
  const info = () => {
    $('#devInfo', root).innerHTML = link.connected
      ? `<div class="grid g2"><div><p class="eyebrow">Link</p><b>${link.label}</b></div><div><p class="eyebrow">Device</p><b class="mono">${esc(link.info?.id || '…')}</b></div>
         <div><p class="eyebrow">Firmware</p><b class="mono">${esc(link.info?.fw || '…')}</b> ${link.info ? (link.info.protocol >= 3 ? '<span class="tag ok">protocol 3</span>' : '<span class="tag warn">old protocol — update</span>') : ''}</div><div><p class="eyebrow">Battery</p><b>${fmtNum(link.tele?.bat ?? link.info?.bat, 2)} V</b></div></div>`
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
  // Records from the SD card (Q117: nothing is lost if the app was not connected during a mission).
  let rec = null;
  const onRec = e => { if (rec) rec.push(e.detail.line); };
  const onRecEnd = () => {
    if (!rec) return;
    const lines = rec; rec = null;
    const rows = parseCSV(lines.join('\n'));
    let added = 0;
    rows.forEach(r => { if (!/^FLUSH$/i.test(r.role || '') && r.sample_id && !state.samples.some(x => x.id === r.sample_id)) { addSample(rowToRecord(r)); added++; } });
    download(`pod-samples-${todayISO()}.csv`, lines.join('\n'), 'text/csv');
    toast(`${rows.length} records copied from the Pod`, 'ok', `${added} new sample${added === 1 ? '' : 's'} added to the registry. A copy was downloaded.`);
  };
  link.addEventListener('record', onRec); link.addEventListener('records_end', onRecEnd);
  $('#recBtn', root).onclick = () => { if (link.busy) return toast('Wait until the mission ends', 'warn'); rec = []; if (!link.send({ cmd: 'records', from: 'sd' })) { rec = null; toast('Not connected', 'warn'); } };
  $('#spd', root).oninput = e => { state.settings.simSpeed = +e.target.value; $('#spdV', root).textContent = `×${e.target.value}`; save(); if (link.kind === 'sim') link.send({ cmd: 'speed', value: +e.target.value }); };
  const off1 = termBind($('#term', root));
  const h = () => info(); link.addEventListener('status', h);
  return () => { off1(); link.removeEventListener('status', h); link.removeEventListener('record', onRec); link.removeEventListener('records_end', onRecEnd); };
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
function seatTable(layout, { samples = [] } = {}) {
  return `<div class="table-wrap"><table class="seat-table"><thead><tr><th>Seat</th><th>Role</th><th>Sample ID</th></tr></thead><tbody>
    ${layout.map(e => {
      const s = samples.find(x => x.tube === e.tube && e.role !== 'flush');
      return `<tr class="r-${e.role}"><td class="mono"><b>${e.seat}</b></td><td>${e.role === 'blank' ? '<span class="tag info">Field blank · first</span>' : e.role === 'flush' ? '<span class="tag">Flush · no filter</span>' : `${esc(e.siteName)} <span class="dim">rep ${e.rep}</span>`}</td>
        <td class="mono">${e.id ? esc(e.id) : '<span class="dim">—</span>'}${s ? ` ${validTag(s)}` : ''}</td></tr>`;
    }).join('')}
  </tbody></table></div>`;
}

function planner(root) {
  const r = state.rules, sch = state.schedule, p = state.plan;
  const siteOpts = sel => `<option value="">— choose —</option>${state.sites.map(s => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(s.code)} · ${esc(s.name)}</option>`).join('')}`;
  root.innerHTML = `
  <section class="grid">
    <div class="grid map-row" id="mapRow">
      <div class="card" style="padding:14px"><div class="map" id="map"></div></div>
      <div class="card">
        <h2>Sites <span class="tag" id="siteN">${state.sites.length}</span></h2>
        <div class="sites" id="sites"></div>
        <form class="form c2" id="addForm" style="margin-top:14px">
          <label class="f">Site name<input type="text" name="name" placeholder="e.g. Forest stream C" required></label>
          <label class="f">Site code (for IDs)<input type="text" name="code" placeholder="auto, e.g. FS01" maxlength="6"></label>
          <label class="f">Latitude<input type="number" step="0.00001" name="lat" placeholder="25.19" required></label>
          <label class="f">Longitude<input type="number" step="0.00001" name="lon" placeholder="55.32" required></label>
          <label class="row" style="grid-column:1/-1;font-size:14px;color:var(--muted)"><input type="checkbox" name="prot"> Protected area (written permission needed)</label>
          <button class="btn" style="grid-column:1/-1">Add site</button>
        </form>
      </div>
    </div>
    <div class="grid g3">
      <div class="card">
        <h2>Mission plan</h2>
        <form class="form" id="planForm">
          <label class="f">Mission date (the Pod stamps the day it samples into every ID)<input type="date" name="date" value="${esc(p.date)}" required></label>
          <label class="f">Layout<select name="mode">
            <option value="2x3" ${p.mode !== '1x6' ? 'selected' : ''}>2 sites × 3 replicates</option>
            <option value="1x6" ${p.mode === '1x6' ? 'selected' : ''}>1 site × 6 replicates</option></select></label>
          <label class="f">Site A (seats 2–4)<select name="siteA">${siteOpts(p.siteA)}</select></label>
          <label class="f" id="siteBRow">Site B (seats 5–7)<select name="siteB">${siteOpts(p.siteB)}</select></label>
          <label class="f">Operator (goes on the custody form)<input type="text" name="operator" value="${esc(p.operator)}" placeholder="Name"></label>
        </form>
      </div>
      <div class="card">
        <h2>Seat layout <span class="tag">1 blank · 6 samples · 1 flush</span></h2>
        <div id="layout"></div>
        <div class="row" style="margin-top:12px"><button class="btn" id="labels">Print QR labels</button></div>
        <p class="dim" style="font-size:14px;margin-top:8px">Print on waterproof label paper, stick on each cartridge, cover with clear tape. You scan each one before the Pod fills it.</p>
      </div>
      <div class="card">
        <h2>Sampling rules</h2>
        <form class="form c2" id="rules">
          <label class="f">Target per filter (mL)<input type="number" name="targetMl" value="${r.targetMl}" min="100" step="50"></label>
          <label class="f">Field blank (mL)<input type="number" name="blankMl" value="${r.blankMl}" min="100" step="50"></label>
          <label class="f">Time limit (min)<input type="number" name="maxMin" value="${r.maxMin}" min="1" max="60"></label>
          <label class="f">Clog below (mL/min)<input type="number" name="minFlowMlMin" value="${r.minFlowMlMin}" min="1" max="200"></label>
          <label class="f">Valid if at least (mL)<input type="number" name="minValidMl" value="${r.minValidMl}" min="50" step="50"></label>
          <label class="f">Site flush, seat 8 (mL)<input type="number" name="flushMl" value="${r.flushMl}" min="0" step="50"></label>
        </form>
        <p class="dim" style="font-size:14px;margin-top:10px">Agreed values: stop at 1 L, 20 min, or flow below 20 mL/min. A sample counts only if ≥ 250 mL. The field blank is always seat 1 and always runs first.</p>
      </div>
    </div>
    <div class="grid g2">
      <div class="card">
        <h2>Schedule</h2>
        <form class="form c2" id="sched">
          <label class="f">When<select name="mode">
            <option value="now" ${sch.mode === 'now' ? 'selected' : ''}>Start now</option>
            <option value="nightly" ${sch.mode === 'nightly' ? 'selected' : ''}>Every night at a set time</option>
            <option value="tide" ${sch.mode === 'tide' ? 'selected' : ''}>After rain (enter time)</option>
</select></label>
          <label class="f">Time<input type="time" name="time" value="${esc(sch.time)}"></label>
          <label class="f">Rain-run time (after a shower)<input type="time" name="tide" value="${esc(sch.tide)}"></label>
        </form>
        <p class="dim" style="font-size:14px;margin-top:10px">Stored missions run on their own (no blank-bottle or site prompts, no label scans), so they do not follow the agreed field method — use them only for tests.</p>
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
  const layout = () => planLayout(state.plan, freshCarouselStart());
  const drawLayout = () => {
    const L = layout();
    $('#siteBRow', root).style.display = state.plan.mode === '1x6' ? 'none' : '';
    $('#layout', root).innerHTML = L.length ? seatTable(L) : `<div class="empty">${esc(planProblems()[0] || 'Choose the sites')}</div>`;
    readyCheck();
  };
  const drawSites = () => {
    $('#siteN', root).textContent = state.sites.length;
    $('#sites', root).innerHTML = state.sites.length ? state.sites.map((s, i) => `
      <div class="site"><span class="n ${s.protected ? 'prot' : ''}">${i + 1}</span>
        <div><b>${esc(s.name)}</b><small><span class="mono" style="color:var(--leaf)">${esc(s.code || '')}</span> · ${(+s.lat).toFixed(4)}, ${(+s.lon).toFixed(4)}</small>${s.protected ? ' <span class="tag warn">protected</span>' : ''}</div>
        <div class="row" style="gap:4px"><button class="icon-btn" data-up="${esc(s.id)}" aria-label="Move up">${icons.up}</button><button class="icon-btn" data-down="${esc(s.id)}" aria-label="Move down">${icons.down}</button><button class="icon-btn" data-del="${esc(s.id)}" aria-label="Remove ${esc(s.name)}">${icons.x}</button></div>
      </div>`).join('') : '<div class="empty">No sites yet. Click the map or use the form.</div>';
    $$('[data-up]', root).forEach(b => b.onclick = () => { moveSite(b.dataset.up, -1); drawSites(); });
    $$('[data-down]', root).forEach(b => b.onclick = () => { moveSite(b.dataset.down, 1); drawSites(); });
    $$('[data-del]', root).forEach(b => b.onclick = () => { removeSite(b.dataset.del); planner(root); });
    map?.draw(state.sites);
    drawLayout();
  };
  const readyCheck = () => {
    const chosen = [siteById(state.plan.siteA), state.plan.mode === '1x6' ? null : siteById(state.plan.siteB)].filter(Boolean);
    const prot = chosen.some(s => s.protected);
    $('#permRow', root).style.display = prot ? '' : 'none';
    const probs = planProblems();
    const flow = state.settings.flowMlMin;
    const est = (state.rules.blankMl + 6 * state.rules.targetMl + 2 * state.rules.flushMl) / flow + 7 * 3 + 2 * 12; // pumping + handling + site cleaning
    const items = [
      [!probs.length, probs.length ? probs[0] : `${state.plan.mode === '1x6' ? '1 site × 6' : '2 sites × 3'} replicates · IDs dated ${esc(state.plan.date)}`],
      [true, `Fresh carousel: cartridges ${tubeId(freshCarouselStart())}… (seat 1 = blank)`],
      [state.settings.pumpCal.length >= 3, state.settings.pumpCal.length >= 3 ? `Pump calibrated (${Math.round(flow)} mL/min)` : `Pump not calibrated — assuming ${Math.round(flow)} mL/min`],
      [!!state.plan.operator, state.plan.operator ? `Operator: ${esc(state.plan.operator)}` : 'Add the operator’s name for the custody form'],
      [link.connected, link.connected ? `Connected via ${link.label}` : 'Not connected — the simulator will be used'],
    ];
    $('#ready', root).innerHTML = items.map(([ok, t]) => `<div class="check-item"><span class="tag ${ok ? 'ok' : 'warn'}">${ok ? 'OK' : 'Check'}</span><span>${t}</span></div>`).join('') + `<p class="dim" style="font-size:14px;margin-top:8px">Estimated field time ≈ ${Math.round(est)} min (1 L takes 10–17 min at 60–100 mL/min)</p>`;
  };
  map = siteMap($('#map', root), state.sites, {
    onAdd: (lat, lon) => { const n = `Site ${state.sites.length + 1}`; addSite({ name: n, lat, lon }); planner(root); toast('Site added', 'ok', 'Pick it as site A or B in the mission plan.'); },
  });
  drawSites();
  $('#addForm', root).onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const code = siteCode(f.get('code') || nextSiteCode(f.get('name')));
    if (state.sites.some(s => s.code === code)) return toast('Site code already used', 'warn', 'Each site needs its own code, e.g. GP01, GP02.');
    addSite({ name: f.get('name'), code, lat: +f.get('lat'), lon: +f.get('lon'), protected: !!f.get('prot') });
    planner(root);
  };
  $('#planForm', root).oninput = e => {
    const f = e.currentTarget;
    state.plan = { date: f.date.value, mode: f.mode.value, siteA: f.siteA.value, siteB: f.siteB.value, operator: f.operator.value.slice(0, 60) };
    save(); drawLayout();
  };
  $('#rules', root).oninput = e => {
    const f = e.currentTarget;
    ['targetMl', 'blankMl', 'minFlowMlMin', 'minValidMl', 'flushMl'].forEach(k => { state.rules[k] = Math.max(0, +f[k].value || 0); });
    state.rules.maxMin = Math.max(1, Math.min(60, +f.maxMin.value || 20));
    save(); readyCheck();
  };
  $('#sched', root).oninput = e => { const f = e.currentTarget; state.schedule = { mode: f.mode.value, time: f.time.value, tide: f.tide.value }; save(); };
  $('#labels', root).onclick = () => { const L = layout().filter(e => e.role !== 'flush'); if (!L.length) return toast('Choose the sites first', 'warn'); printLabels(L.map(e => ({ ...e, date: state.plan.date }))); };
  $('#go', root).onclick = async () => {
    const chosen = [siteById(state.plan.siteA), state.plan.mode === '1x6' ? null : siteById(state.plan.siteB)].filter(Boolean);
    if (chosen.some(s => s.protected) && !$('#perm', root).checked) { toast('Permission needed', 'warn', 'Tick the box to confirm written permission for protected sites.'); return; }
    if (await startMission()) location.hash = '#/live';
  };
  $('#schedBtn', root).onclick = () => scheduleMission();
  return () => map?.destroy();
}

/* ─────────────────────────── Live ─────────────────────────── */
const WAIT_TEXT = {
  BLANK_WATER: ['Seat 1 · field blank', 'Change gloves. Put the intake in the 1 L distilled-water bottle — it runs through the whole water path to prove it is clean. Scan the blank’s label, then continue.', 'Blank bottle ready — run blank'],
  SITE: ['Seat 8 · new site', 'At the new site: fit a NEW bagged intake tube, spray the nozzle with 10% bleach (10 min), rinse, and put the intake in the water. 250 mL of site water then flushes through the empty seat 8 to waste.', 'Intake in water — flush'],
  EMPTY_BOTTLE: ['Empty the waste bottle', 'The waste bottle on the load cell is too full for the next filter. Empty it and put it back.', 'Bottle emptied — continue'],
  WATER: ['Intake not in water', 'The float switch says the intake is dry. Put it just below the surface, away from mud.', 'Intake in water — continue'],
  AIR: ['Pumping air', 'The intake came out of the water. Put it back within 2 minutes, or the filter ends with stop reason AIR.', 'Intake back in — continue'],
  SCAN: ['Scan before sampling', 'The Pod is paused at this cartridge until its label is scanned. Change gloves; intake just below the surface; stand downstream.', 'Confirm ID & sample'],
};
function live(root) {
  root.innerHTML = `
  <section class="grid">
    <div class="live-wrap">
      <div class="card live-stage stage" id="liveStage" data-autorotate="off">
        <div class="live-hud"><span class="tag ok" id="hState">IDLE</span><span class="tag" id="hSite">No site</span><span class="tag info" id="hTube" hidden>—</span></div>
        <div class="live-ctrl">
          <button class="btn primary" id="start">Start mission</button>
          <button class="btn" id="demo">Demo run (judges)</button>
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
            ${gauge('ml', 'Volume', 'mL', 1000)}${gauge('flow', 'Flow', 'mL/min', 120, true)}
          </div>
          <div class="io">
            <span id="io-pumpS"><i></i>Sample pump</span><span id="io-pumpE"><i></i>Ethanol pump</span>
            <span id="io-press"><i></i>Nozzle sealed</span><span id="io-fix"><i></i>GPS fix</span>
          </div>
        </div>
      </div>
    </div>
    <div class="grid g2">
      <div class="card confirm-card" id="confirmCard"></div>
      <div class="card"><h2>Mission sheet <span class="tag" id="sheetTag" hidden></span></h2><div id="sheet"></div>
        <div id="ahead" style="margin-top:14px"></div>
      </div>
    </div>
    <div class="card sx-card">
      <h2>Inside the Pod <span class="sx-live" id="sxLive">Idle</span></h2>
      ${schematicHTML()}
    </div>
    <div class="grid g2">
      <div class="card"><h2>Mission log</h2><div class="term" id="term"></div></div>
      <div class="card"><h2>Carousel <span class="tag" id="seatTag">Seat 1 of 8</span></h2>
        <div class="slotgrid" id="seatGrid" style="grid-template-columns:repeat(8,1fr)"></div>
        <p class="dim" style="font-size:14px;margin-top:10px">Pump current: <b id="cur">—</b> · Water: <b id="temp">—</b> · Battery: <b id="bat">—</b> · Waste bottle: <b id="grams">—</b> · GPS: <b id="gps">—</b></p>
        <p class="dim" style="font-size:13px">B = field blank (seat 1) · 2–7 = samples · F = flush seat 8, no filter.</p>
      </div>
    </div>
  </section>`;
  const off = stage(root, '#liveStage');
  const offX = bindSchematic(root);
  const offT = termBind($('#term', root));
  let draft = { text: '', manual: false, lat: '', lon: '', key: '' };

  const setG = (k, v, max, d, extra = '') => {
    const el = $(`#g-${k}`, root); if (!el) return;
    el.querySelector('.gv').innerHTML = `${fmtNum(v, d)}<small> ${el.dataset.unit}${extra}</small>`;
    el.querySelector('.bar i').style.width = `${Math.max(0, Math.min(100, ((v || 0) / max) * 100))}%`;
  };
  const curMission = () => activeMission() || lastMission();
  const seats = cur => {
    const m = curMission();
    $('#seatTag', root).textContent = `Seat ${cur || 1} of 8`;
    $('#seatGrid', root).innerHTML = Array.from({ length: 8 }, (_, i) => {
      const s = m ? state.samples.find(x => x.mission === m.id && x.seat === i + 1) : null;
      const cls = s ? (s.blank ? 'blank' : s.valid ? 'used' : 'bad') : '';
      return `<span class="${cls}${i === 7 ? ' flushseat' : ''}" style="${(cur || 1) === i + 1 ? 'outline:2px solid var(--mint);outline-offset:1px' : ''}" title="${s ? esc(s.id) : i === 0 ? 'Seat 1: field blank' : i === 7 ? 'Seat 8: flush (no filter)' : `Seat ${i + 1}`}">${i === 0 ? 'B' : i === 7 ? 'F' : i + 1}</span>`;
    }).join('');
  };
  const sheet = () => {
    const m = curMission();
    if (!m) { $('#sheet', root).innerHTML = '<div class="empty">No mission yet. Plan one in the Mission planner.</div>'; $('#sheetTag', root).hidden = true; $('#ahead', root).innerHTML = ''; return; }
    const running = m.status === 'running';
    const bd = running ? blankIsDone() : blankDone(m.id);
    $('#sheetTag', root).textContent = `${m.id} · ${m.status}`; $('#sheetTag', root).hidden = false;
    $('#sheet', root).innerHTML = `<div class="table-wrap"><table class="seat-table"><thead><tr><th>Seat</th><th>Role</th><th>Sample ID</th><th>Status</th></tr></thead><tbody>
      ${m.layout.map(e => {
        const s = state.samples.find(x => x.mission === m.id && x.seat === e.seat && e.role !== 'flush');
        const cur = waiting.kind ? { seat: waiting.seat, role: waiting.entry?.role } : { seat: link.step?.seat, role: String(link.step?.role || '').toLowerCase() };
        const now = running && cur.seat === e.seat && (!cur.role || cur.role === e.role);
        const locked = running && e.role === 'sample' && !bd && !s;
        const fl = (m.flushes || []);
        const status = s ? `${s.ml} mL ${validTag(s)}${s.stop_reason !== 'VOLUME' ? ` <span class="tag warn">${esc(s.stop_reason)}</span>` : ''}${s.manualLocation ? ' <span class="tag">manual loc</span>' : ''}`
          : e.role === 'flush' ? (fl.length ? fl.map(f => `<span class="tag ${f.valid ? '' : 'warn'}">${esc(f.site)} ${f.ml ?? '?'} mL</span>`).join(' ') : '<span class="dim">before each site</span>')
          : locked ? '<button class="btn sm" disabled title="Run the field blank first">Locked — blank first</button>'
          : isConfirmed(e) ? '<span class="tag ok">label scanned</span>'
          : running ? '<span class="dim">scan label</span>' : '<span class="dim">not run</span>';
        return `<tr class="r-${e.role}${now ? ' now' : ''}"><td class="mono"><b>${e.seat}</b></td><td>${e.role === 'blank' ? 'Field blank' : e.role === 'flush' ? 'Flush' : `${esc(e.siteCode)} rep ${e.rep}`}</td><td class="mono">${e.id ? esc(e.id) : '—'}</td><td>${status}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    // Scan ahead
    const pend = running ? pendingLabels() : [];
    const box = $('#ahead', root);
    if (!running) { box.innerHTML = ''; return; }
    if (box.dataset.n === String(pend.length) + bd && box.innerHTML) return;   // keep what is typed
    box.dataset.n = String(pend.length) + bd;
    box.innerHTML = pend.length ? `<label class="f">Scan labels ahead (any order)<input type="text" id="aheadIn" autocomplete="off" spellcheck="false" placeholder="${bd ? 'Scan the next cartridge’s QR label' : 'Locked until the field blank is logged'}" ${bd ? '' : 'disabled'}></label>
      <p class="dim" style="font-size:14px;margin-top:6px">${pend.length} sample label${pend.length === 1 ? '' : 's'} still to scan. If the Pod reaches a cartridge whose label is not scanned, it pauses until you scan it.</p><p class="c-msg" id="aheadMsg"></p>` : '<p class="dim" style="font-size:13px">All sample labels scanned.</p>';
    const ai = $('#aheadIn', root);
    if (ai) ai.onkeydown = ev => { if (ev.key !== 'Enter') return; ev.preventDefault(); const r = prescan(ai.value); $('#aheadMsg', root).textContent = r.ok ? '' : r.msg; if (r.ok) { toast(r.msg, 'ok'); ai.value = ''; box.dataset.n = ''; sheet(); setTimeout(() => $('#aheadIn', root)?.focus(), 30); } else ai.select(); };
  };
  const gpsLine = () => {
    const t = link.tele || {};
    if (t.fix === 1) return { fix: true, html: `<span class="tag ok">GPS fix</span> <span class="mono">${t.lat != null ? `${fmtNum(t.lat, 5)}, ${fmtNum(t.lon, 5)}` : 'position coming'}</span> <span class="dim">${t.sats ? `· ${t.sats} satellites` : ''}${t.hdop ? ` · HDOP ${t.hdop}` : ''}</span>` };
    if (t.manualLoc) return { fix: false, html: '<span class="tag">Manual location set</span> <span class="dim">Used while there is no GPS fix.</span>' };
    if (t.fix === 0) return { fix: false, html: '<span class="tag warn">No GPS fix</span> <span class="dim">Enter the location by hand.</span>' };
    return { fix: null, html: '<span class="tag">GPS —</span>' };
  };
  const locForm = (e, required) => {
    const g = gpsLine();
    const show = draft.manual || required;
    if (!draft.lat && e?.lat != null) { draft.lat = (+e.lat).toFixed(5); draft.lon = (+e.lon).toFixed(5); }
    return `<div class="gps-line" id="cGps">${g.html}</div>
      <label class="row" style="font-size:14px;color:var(--muted);margin:8px 0"><input type="checkbox" id="cMan" ${show ? 'checked' : ''}> Enter location by hand${required ? ' (no GPS fix)' : ' (indoors, no GPS)'}</label>
      <div class="form c3" id="cManBox" ${show ? '' : 'hidden'}>
        <label class="f">Latitude<input type="number" step="0.00001" id="cLat" value="${esc(draft.lat)}"></label>
        <label class="f">Longitude<input type="number" step="0.00001" id="cLon" value="${esc(draft.lon)}"></label>
        <div class="row" style="align-self:end">${'geolocation' in navigator ? '<button class="btn sm" id="cPhone" type="button">Use phone GPS</button>' : ''}</div>
      </div>`;
  };
  const bindLoc = () => {
    const man = $('#cMan', root); if (!man) return;
    man.onchange = ev => { draft.manual = ev.target.checked; $('#cManBox', root).hidden = !ev.target.checked; };
    $('#cLat', root).oninput = ev => { draft.lat = ev.target.value; };
    $('#cLon', root).oninput = ev => { draft.lon = ev.target.value; };
    const ph = $('#cPhone', root);
    if (ph) ph.onclick = () => navigator.geolocation.getCurrentPosition(
      p => { draft.lat = p.coords.latitude.toFixed(5); draft.lon = p.coords.longitude.toFixed(5); $('#cLat', root).value = draft.lat; $('#cLon', root).value = draft.lon; toast('Phone location used', 'ok', `±${Math.round(p.coords.accuracy)} m`); },
      err => toast('Phone GPS not available', 'warn', err.message), { enableHighAccuracy: true, timeout: 15000 });
  };
  const readLoc = () => $('#cMan', root)?.checked ? { lat: parseFloat($('#cLat', root).value), lon: parseFloat($('#cLon', root).value) } : null;

  const confirmCard = () => {
    const el = $('#confirmCard', root);
    const m = activeMission();
    const k = waiting.kind, e = waiting.entry;
    const key = `${k}|${waiting.seat}|${waiting.site}`;
    if (key !== draft.key) draft = { text: '', manual: false, lat: '', lon: '', key };
    if (!m) {
      el.dataset.mode = '';
      el.innerHTML = `<h2>Next step</h2><div class="empty">No mission running.</div><p class="dim" style="font-size:14px;margin-top:8px">When a mission runs, this card tells you exactly what the Pod needs: the blank bottle, the next site, an empty waste bottle — and the QR label to scan before each cartridge is filled.</p>`;
      return;
    }
    if (!k) {
      const t = link.tele || {}, st = link.step;
      const need = needsLocation();
      const head = `<p class="eyebrow">Seat ${t.seat || '—'} · ${esc(String(t.role || '').toLowerCase() || '…')}</p><div class="bigid">${esc(tubeId(t.seat) || '…')}</div>
        <p style="margin-top:10px">${st ? esc(String(st.name).toLowerCase().replace('_', ' ')) : 'Working…'} — stay beside the Pod.${t.target ? ` <b id="cRun">${t.ml} of ${t.target} mL</b>.` : ''}</p>`;
      // Don't rebuild the location form while someone is typing in it — only refresh the status lines.
      if (need && el.dataset.mode === 'loc' && $('#cHead', root)) { $('#cHead', root).innerHTML = head; return; }
      el.dataset.mode = need ? 'loc' : 'run';
      el.innerHTML = `<h2>Next step <span class="tag ok">Pod working</span></h2>
        <div id="cHead">${head}</div>
        ${need ? `<div class="alert warn"><span class="dot"></span><div><b>No GPS fix here</b><small>Type the position so these samples are not placed at the planned point.</small></div></div>${locForm(e || entryNow(), true)}<div class="row" style="margin-top:10px"><button class="btn primary" id="cLocGo">Save location on the Pod</button></div><p class="c-msg" id="cMsg" role="alert"></p>` : ''}`;
      if (need) {
        bindLoc();
        $('#cLocGo', root).onclick = () => { const r = setManualLocation(readLoc() || {}, t.siteCode); if (!r.ok) $('#cMsg', root).textContent = r.msg; else { toast('Manual location sent', 'ok', 'The Pod uses it while there is no GPS fix.'); draft.manual = false; el.dataset.mode = ''; confirmCard(); } };
      }
      return;
    }
    el.dataset.mode = 'wait';
    const [title, help, btn] = WAIT_TEXT[k] || [k, waiting.msg, 'Continue'];
    const scan = k === 'SCAN' || k === 'BLANK_WATER';
    const place = k === 'BLANK_WATER' || k === 'SITE';
    const ok = k !== 'SCAN' || canConfirm(e);
    el.innerHTML = `<h2>${esc(title)} <span class="tag warn">Pod waiting</span></h2>
      ${scan && e ? `<p class="eyebrow">Scan this label · seat ${e.seat}</p><div class="bigid" id="cWant">${esc(e.id)}</div>` : ''}
      ${k === 'SITE' ? `<p class="eyebrow">Site ${esc(waiting.site)}</p><div class="bigid">${esc(e?.siteName || waiting.site)}</div>` : ''}
      <p style="margin-top:8px">${esc(help)}</p>
      ${waiting.msg && k !== 'SCAN' ? `<p class="dim" style="font-size:13px">Pod: “${esc(waiting.msg)}”</p>` : ''}
      ${ok ? '' : '<div class="alert warn"><span class="dot"></span><div><b>Locked</b><small>Run the field blank (seat 1) first. Samples unlock when it is logged.</small></div></div>'}
      ${scan ? `<div class="form" style="margin-top:12px"><label class="f">Scan or type the sample ID<input type="text" id="cScan" autocomplete="off" spellcheck="false" placeholder="CK-YYYYMMDD-SITE-S#" value="${esc(draft.text)}" ${ok ? '' : 'disabled'}></label></div>` : ''}
      ${place ? locForm(e, false) : ''}
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="cGo" ${ok ? '' : 'disabled'}>${esc(btn)}</button>
        ${scan && 'BarcodeDetector' in window ? '<button class="btn" id="cCam" type="button">Scan with camera</button>' : ''}
        ${['WATER', 'AIR', 'EMPTY_BOTTLE'].includes(k) ? '<button class="btn ghost sm" id="cForce" type="button" title="Skip the sensor check (float switch / bottle weight)">Force — sensor is wrong</button>' : ''}
      </div>
      <p class="c-msg" id="cMsg" role="alert"></p>
      <video id="cVid" playsinline muted hidden></video>`;
    const inp = $('#cScan', root);
    if (inp) {
      if (ok) setTimeout(() => inp.focus({ preventScroll: true }), 50);
      inp.oninput = () => { draft.text = inp.value; };
      inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } };
    }
    if (place) bindLoc();
    const cam = $('#cCam', root);
    if (cam) cam.onclick = () => scanCamera($('#cVid', root), id => { inp.value = id; draft.text = id; go(); });
    $('#cGo', root).onclick = () => go();
    const fb = $('#cForce', root); if (fb) fb.onclick = () => go(true);
    function go(force = false) {
      const manual = place ? readLoc() : null;
      const r = confirmCurrent({ scanned: inp ? inp.value : '', manual, force });
      if (!r.ok) { $('#cMsg', root).textContent = r.msg; inp?.select(); return; }
      if (scan && e) toast(`${e.id} confirmed`, 'ok', manual ? 'Manual location sent to the Pod' : '');
    }
  };
  const entryNow = () => { const m = activeMission(); const t = link.tele || {}; return m?.layout?.find(x => x.seat === t.seat) || null; };

  let lastNeed = false;
  const onTele = ev => {
    const t = ev.detail;
    setG('ph', t.ph, 14, 2); setG('ntu', t.ntu, 100, 1); setG('ml', t.ml, t.target || 1000, 0, t.target ? ` / ${t.target}` : '');
    setG('flow', t.flowMlMin ?? (t.flow || 0) * 60, 120, 0);
    ['pumpS', 'pumpE', 'press'].forEach(k => $(`#io-${k}`, root)?.classList.toggle('on', !!t[k]));
    $('#io-fix', root)?.classList.toggle('on', t.fix === 1);
    $('#hState', root).textContent = t.paused ? 'PAUSED' : (t.state || 'IDLE').replace('_', ' ');
    $('#cur', root).textContent = t.cur ? `${fmtNum(t.cur, 2)} A` : '—';
    $('#temp', root).textContent = t.temp != null ? `${fmtNum(t.temp, 1)} °C` : '—';
    $('#bat', root).textContent = t.bat != null ? `${fmtNum(t.bat, 2)} V${t.batTemp != null ? ` · ${fmtNum(t.batTemp, 0)} °C` : ''}` : '—';
    $('#grams', root).textContent = t.grams != null ? `${t.grams} g` : '—';
    $('#gps', root).textContent = t.fix === 1 ? `fix (${t.sats || '?'} sats)` : t.manualLoc ? 'manual location' : t.fix === 0 ? 'no fix' : '—';
    const run = $('#cRun', root); if (run && t.target) run.textContent = `${t.ml} of ${t.target} mL`;
    const gl = $('#cGps', root); if (gl) gl.innerHTML = gpsLine().html;
    const need = needsLocation();
    if (need !== lastNeed && !waiting.kind) { lastNeed = need; confirmCard(); }
    seats(t.seat);
    $('#pause', root).textContent = t.paused ? 'Resume' : 'Pause';
  };
  seats(link.tele?.seat);
  let lastSeat = 0;
  const onStep = ev => {
    const d = ev.detail;
    $('#ring', root).innerHTML = missionRing(d.n || 0);
    $('#hSite', root).textContent = d.siteName || d.site || '—';
    $('#hTube', root).textContent = d.seat ? (tubeId(d.seat) || `Seat ${d.seat}`) : '—'; $('#hTube', root).hidden = !d.seat;
    const on = root.querySelector('#ring .seg.on');
    if (window.gsap && on) gsap.fromTo(on, { opacity: .3 }, { opacity: 1, duration: .5 });
    if (!waiting.kind) confirmCard();
    if (d.seat !== lastSeat) { lastSeat = d.seat; sheet(); }
  };
  const onAwait = () => { confirmCard(); sheet(); };
  const onSample = () => setTimeout(() => { sheet(); seats(link.tele?.seat); if (!waiting.kind) confirmCard(); }, 30);
  const onEnd = () => { $('#ring', root).innerHTML = missionRing(0, 8); $('#hSite', root).textContent = 'Mission finished'; $('#hTube', root).textContent = '—'; $('#hTube', root).hidden = true; $('#hState', root).textContent = 'IDLE'; setTimeout(() => { sheet(); confirmCard(); }, 30); };
  const onStatus = () => { $('#hLink', root).textContent = link.connected ? link.label : 'Not connected'; };
  link.addEventListener('tele', onTele); link.addEventListener('step', onStep); link.addEventListener('await', onAwait); link.addEventListener('sample', onSample);
  link.addEventListener('done', onEnd); link.addEventListener('aborted', onEnd); link.addEventListener('status', onStatus);
  if (link.tele) onTele({ detail: link.tele });
  sheet(); confirmCard();
  $('#start', root).onclick = async () => { if (await startMission()) { sheet(); confirmCard(); } };
  $('#demo', root).onclick = async () => { if (await startDemo()) { sheet(); confirmCard(); } };
  $('#pause', root).onclick = () => { if (!link.connected) return; link.send({ cmd: link.tele?.paused ? 'resume' : 'pause' }); };
  $('#abort', root).onclick = () => { if (link.busy && confirm('Abort the mission? Pumps stop and the nozzle lifts. A used filter still gets its record.')) link.send({ cmd: 'abort' }); };
  return () => {
    stopCamera();
    off(); offT(); offX();
    link.removeEventListener('tele', onTele); link.removeEventListener('step', onStep); link.removeEventListener('await', onAwait); link.removeEventListener('sample', onSample);
    link.removeEventListener('done', onEnd); link.removeEventListener('aborted', onEnd); link.removeEventListener('status', onStatus);
  };
}
const gauge = (k, l, unit, max, amber) => `<div class="gauge" id="g-${k}" data-unit="${unit}"><div class="gl">${l}</div><div class="gv">—<small> ${unit}</small></div><div class="bar ${amber ? 'amber' : ''}"><i></i></div></div>`;

// Camera QR scanning where the browser supports BarcodeDetector (Chrome on Android).
// USB/Bluetooth scanners that type like a keyboard work through the text box instead.
let camStream = null, camTimer = null;
function stopCamera() { clearInterval(camTimer); camTimer = null; camStream?.getTracks().forEach(t => t.stop()); camStream = null; }
async function scanCamera(video, onId) {
  try {
    stopCamera();
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = camStream; video.hidden = false; await video.play();
    camTimer = setInterval(async () => {
      try {
        const codes = await det.detect(video);
        const id = codes.map(c => parseSampleId(c.rawValue)).find(Boolean);
        if (id) { stopCamera(); video.hidden = true; onId(id); }
      } catch (e) { /* keep trying */ }
    }, 300);
    setTimeout(() => { if (camTimer) { stopCamera(); video.hidden = true; toast('No label found', 'warn', 'Type the ID instead.'); } }, 30000);
  } catch (e) { stopCamera(); video.hidden = true; toast('Camera not available', 'warn', 'Type the ID or use a handheld scanner.'); }
}

/* ─────────────────────────── Samples & custody ─────────────────────────── */
function samples(root) {
  root.innerHTML = `
  <section class="grid">
    <div class="card">
      <div class="row" style="margin-bottom:14px">
        <input type="search" id="q" placeholder="Search sample ID or site" style="max-width:260px" aria-label="Search samples">
        <select id="st" style="max-width:200px" aria-label="Filter by status"><option value="">All statuses</option>${STATUSES.map(s => `<option>${s}</option>`).join('')}</select>
        <span class="spacer"></span>
        <button class="btn" id="labels">Print QR labels</button>
        <button class="btn" id="batch">New custody batch</button>
        <button class="btn" id="json">Export JSON</button>
        <button class="btn primary" id="csv">Export CSV</button>
      </div>
      <div class="table-wrap"><table class="samples-table">
        <thead><tr><th><input type="checkbox" id="all" aria-label="Select all"></th><th>Sample ID</th><th>Role</th><th>Site</th><th>Collected</th><th>Volume</th><th>Stop</th><th>Location</th><th>Seal no.</th><th>Status</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
      <p class="dim" style="font-size:14px;margin-top:10px">Valid = at least ${state.rules.minValidMl} mL filtered. Stop reasons: VOLUME (reached target), TIME (20 min), CLOG (flow below ${state.rules.minFlowMlMin} mL/min), AIR (intake out of water). Everything is saved on this device and works offline — export after every mission.</p>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Chain of custody <span class="tag" id="bN">${state.batches.length} batches</span></h2>
        <p>A batch is what travels together to the lab. Give every bag a numbered tamper-evident seal, record each hand-over, and print the form to sign.</p>
        <div id="batches"></div>
      </div>
      <div class="card"><h2>Carousels <span class="tag">B = blank · F = flush</span></h2><div class="slotgrid" id="rack" style="grid-template-columns:repeat(8,1fr)"></div><p class="dim" style="font-size:14px;margin-top:8px">One row per mission carousel: seat 1 blank, seats 2–7 samples, seat 8 flush (no filter).</p></div>
    </div>
  </section>`;
  const sel = new Set();
  const list = () => {
    const q = $('#q', root).value.toLowerCase(), st = $('#st', root).value;
    return [...state.samples].sort((a, b) => b.ts - a.ts || a.seat - b.seat).filter(s => (!q || s.id.toLowerCase().includes(q) || String(s.siteName).toLowerCase().includes(q)) && (!st || s.status === st));
  };
  const draw = () => {
    const L = list();
    $('#rows', root).innerHTML = L.length ? L.map(s => `<tr class="${s.role === 'sample' && !s.valid ? 'invalid' : ''}">
      <td><input type="checkbox" data-sel="${esc(s.id)}" ${sel.has(s.id) ? 'checked' : ''} aria-label="Select ${esc(s.id)}"></td>
      <td class="mono"><b>${esc(s.id)}</b>${s.demo ? ' <span class="tag">demo</span>' : ''}</td>
      <td>${s.role === 'blank' ? '<span class="tag info">Field blank</span>' : `Rep ${s.replicate}`}</td>
      <td>${esc(s.siteName)}</td><td class="dim">${fmtTime(s.ts)}</td>
      <td>${s.ml} <span class="dim">/ ${s.target}</span> mL ${validTag(s)}</td>
      <td><span class="tag ${s.stop_reason === 'VOLUME' ? '' : 'warn'}" title="${esc(STOP_REASONS[s.stop_reason] || '')}">${esc(s.stop_reason)}</span></td>
      <td class="mono" style="font-size:12px">${s.lat != null ? `${(+s.lat).toFixed(4)}, ${(+s.lon).toFixed(4)}` : '—'}<br><span class="tag ${s.manualLocation ? 'warn' : ''}">${LOC_LABEL[s.locSource] || (s.manualLocation ? 'Manual' : 'GPS')}</span></td>
      <td><input type="text" class="seal" data-seal="${esc(s.id)}" value="${esc(s.seal || '')}" placeholder="Seal #" aria-label="Seal number for ${esc(s.id)}"></td>
      <td><select data-status="${esc(s.id)}" aria-label="Status of ${esc(s.id)}">${STATUSES.map(x => `<option ${x === s.status ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td><button class="icon-btn" data-del="${esc(s.id)}" aria-label="Delete ${esc(s.id)}">${icons.x}</button></td></tr>`).join('')
      : `<tr><td colspan="11"><div class="empty">No samples${state.samples.length ? ' match' : ' yet — run a mission'}.</div></td></tr>`;
    const byId = id => state.samples.find(s => s.id === id);
    $$('[data-sel]', root).forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); });
    $$('[data-status]', root).forEach(c => c.onchange = () => { byId(c.dataset.status).status = c.value; save(); });
    $$('[data-seal]', root).forEach(c => c.onchange = () => { byId(c.dataset.seal).seal = c.value.trim().slice(0, 30); save(); });
    $$('[data-del]', root).forEach(b => b.onclick = () => { if (confirm('Delete this sample record?')) { state.samples = state.samples.filter(s => s.id !== b.dataset.del); save(); draw(); } });
    // Carousel rack, one row per mission
    const ms = state.missions.filter(m => m.layout && state.samples.some(s => s.mission === m.id));
    $('#rack', root).innerHTML = ms.length ? ms.map(m => Array.from({ length: 8 }, (_, i) => {
      const s = state.samples.find(x => x.mission === m.id && x.seat === i + 1);
      return `<span class="${s ? (s.blank ? 'blank' : s.valid ? 'used' : 'bad') : ''}" title="${s ? esc(s.id) : `${esc(m.id)}, seat ${i + 1}`}">${i === 0 ? 'B' : i === 7 ? 'F' : i + 1}</span>`;
    }).join('')).join('') : '<span class="dim empty-note">No carousels used yet</span>';
    drawBatches();
  };
  const chosen = () => sel.size ? state.samples.filter(s => sel.has(s.id)) : list();
  const drawBatches = () => {
    $('#bN', root).textContent = `${state.batches.length} batch${state.batches.length === 1 ? '' : 'es'}`;
    $('#batches', root).innerHTML = state.batches.length ? [...state.batches].reverse().map(b => `
      <div class="batch">
        <div class="row"><b class="mono">${esc(b.id)}</b><span class="tag">${b.samples.length} samples</span><span class="dim" style="font-size:13px">${fmtTime(b.created)}</span><span class="spacer"></span>
          <button class="btn sm" data-print="${esc(b.id)}">Print custody form</button></div>
        ${b.handovers.length ? `<ol class="handovers">${b.handovers.map(h => `<li><b>${esc(h.from)}</b> → <b>${esc(h.to) || "—"}</b> · ${fmtTime(h.ts)} · seals ${esc(h.seals)}${h.condition ? ` · ${esc(h.condition)}` : ''}</li>`).join('')}</ol>` : '<p class="dim" style="font-size:14px;margin:6px 0">No hand-overs recorded yet.</p>'}
        <form class="form c3 ho" data-ho="${esc(b.id)}">
          <input type="text" name="from" placeholder="Released by" required aria-label="Released by">
          <input type="text" name="to" placeholder="Received by" required aria-label="Received by">
          <input type="datetime-local" name="ts" aria-label="Date and time">
          <select name="seals" aria-label="Seals"><option>intact</option><option>broken</option></select>
          <input type="text" name="condition" placeholder="Condition / temp" aria-label="Condition">
          <button class="btn sm">Add hand-over</button>
        </form>
      </div>`).join('') : '<div class="empty">No batches yet. Select samples above and press “New custody batch”.</div>';
    $$('[data-print]', root).forEach(b => b.onclick = () => printCustody(state.batches.find(x => x.id === b.dataset.print)));
    $$('[data-ho]', root).forEach(f => f.onsubmit = e => {
      e.preventDefault(); const d = new FormData(f);
      addHandover(f.dataset.ho, { from: String(d.get('from')).slice(0, 60), to: String(d.get('to')).slice(0, 60), ts: Date.parse(d.get('ts')) || Date.now(), seals: d.get('seals'), condition: String(d.get('condition')).slice(0, 80) });
      drawBatches(); toast('Hand-over recorded');
    });
  };
  draw();
  $('#q', root).oninput = draw; $('#st', root).onchange = draw;
  $('#all', root).onchange = e => { list().forEach(s => e.target.checked ? sel.add(s.id) : sel.delete(s.id)); draw(); };
  $('#csv', root).onclick = () => {
    const rows = sampleRows(chosen());
    if (!rows.length) return toast('No samples to export', 'warn');
    download(`ck-samples-${todayISO()}.csv`, toCSV(rows, sampleCols), 'text/csv');
  };
  $('#json', root).onclick = () => {
    const list2 = chosen();
    if (!list2.length) return toast('No samples to export', 'warn');
    download(`ck-samples-${todayISO()}.json`, JSON.stringify({ exported: new Date().toISOString(), team: 'Canopy Keepers', samples: sampleRows(list2), results: state.results.filter(r => list2.some(s => s.id === r.tube)) }, null, 2), 'application/json');
  };
  $('#labels', root).onclick = () => printLabels(chosen().map(s => ({ ...s, rep: s.replicate, date: new Date(s.ts).toISOString().slice(0, 10) })));
  $('#batch', root).onclick = () => {
    const L = sel.size ? state.samples.filter(s => sel.has(s.id)) : state.samples.filter(s => s.status === 'Collected');
    if (!L.length) return toast('Select samples first', 'warn', 'Or collect some — a batch takes every “Collected” sample by default.');
    const noSeal = L.filter(s => !s.seal).length;
    const b = createBatch(L.map(s => s.id));
    L.forEach(s => { if (s.status === 'Collected') s.status = 'Shipped'; });
    if (state.plan.operator) addHandover(b.id, { from: `${state.plan.operator} (collector)`, to: '', ts: Date.now(), seals: 'intact', condition: 'Sealed at site' });
    save(); sel.clear(); draw();
    toast(`Batch ${b.id} created`, noSeal ? 'warn' : 'ok', noSeal ? `${noSeal} sample${noSeal === 1 ? ' has' : 's have'} no seal number yet.` : 'Print the form and sign at every hand-over.');
  };
}

function qrSvg(text) {
  if (!window.qrcode) return '';
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
}
// QR label sheet. The QR holds only the sample ID, so any scanner gives the same string the lab uses.
async function printLabels(list) {
  if (!list.length) return toast('No samples to label', 'warn');
  if (!window.qrcode) { try { await loadScript('vendor/qrcode/qrcode.js'); } catch (e) { toast('QR codes could not load', 'warn', 'Labels will print with the ID as text only.'); } }
  const area = document.getElementById('printArea');
  area.className = 'labels';
  area.innerHTML = list.map(s => `<div class="label">${qrSvg(s.id)}<div><b>${esc(s.id)}</b>${s.role === 'blank' ? `<b class="lb-role">FIELD BLANK</b>seat 1 · run first` : `${esc(s.siteCode || '')} · rep ${esc(s.rep ?? s.replicate)} · seat ${esc(s.seat)}`}<br>${esc(s.role === 'blank' ? '1 L distilled water' : (s.siteName || ''))}<br>${esc(s.date || '')}${s.ml ? ` · ${s.ml} mL` : ' · Vol: ______ mL'}<br>Canopy Keepers · eDNA Pod</div></div>`).join('');
  setTimeout(() => window.print(), 100);
}

function printCustody(b) {
  if (!b) return;
  const S = b.samples.map(id => state.samples.find(s => s.id === id)).filter(Boolean);
  const blanks = S.filter(s => s.role === 'blank').map(s => s.id);
  const area = document.getElementById('printArea');
  area.className = 'doc';
  const blankRows = Math.max(3, 5 - b.handovers.length);
  area.innerHTML = `<div class="coc">
    <h1>Chain of custody — eDNA water filters</h1>
    <table class="kv"><tr><th>Batch</th><td>${esc(b.id)}</td><th>Team</th><td>Canopy Keepers (FLL), The Indian High School, Dubai</td></tr>
      <tr><th>Created</th><td>${new Date(b.created).toLocaleString()}</td><th>Lab</th><td>${esc(b.lab) || '&nbsp;'}</td></tr>
      <tr><th>Samples</th><td>${S.length} (${blanks.length} field blank${blanks.length === 1 ? '' : 's'})</td><th>Preservation</th><td>${esc(b.preservation)}</td></tr>
      <tr><th>Filter</th><td>47 mm, 0.45 µm MCE</td><th>Transport</th><td>${esc(b.transport)}</td></tr></table>
    <h2>Samples</h2>
    <table class="grid-t"><thead><tr><th>#</th><th>Sample ID</th><th>Role</th><th>Site</th><th>Collected</th><th>Volume (mL)</th><th>Stop</th><th>Valid</th><th>Seal no.</th><th>Collected by</th></tr></thead><tbody>
      ${S.map((s, i) => `<tr><td>${i + 1}</td><td class="mono">${esc(s.id)}</td><td>${s.role === 'blank' ? 'Field blank' : `Rep ${s.replicate}`}</td><td>${esc(s.siteName)}${s.manualLocation ? ' *' : ''}</td><td>${new Date(s.ts).toLocaleString()}</td><td>${s.ml}</td><td>${esc(s.stop_reason)}</td><td>${s.role === 'blank' ? '—' : s.valid ? 'yes' : 'NO'}</td><td>${esc(s.seal) || '&nbsp;'}</td><td>${esc(s.collectedBy) || '&nbsp;'}</td></tr>`).join('')}
    </tbody></table>
    <p class="small">* location entered by hand (no GPS fix). Lab: please report results by sample ID, including samples with no detections, and run an extraction blank per batch.</p>
    <h2>Hand-overs</h2>
    <table class="grid-t"><thead><tr><th>Released by (name, signature)</th><th>Received by (name, signature)</th><th>Date &amp; time</th><th>Seals intact?</th><th>Condition / temperature</th></tr></thead><tbody>
      ${b.handovers.map(h => `<tr><td>${esc(h.from)}</td><td>${esc(h.to)}</td><td>${new Date(h.ts).toLocaleString()}</td><td>${esc(h.seals)}</td><td>${esc(h.condition)}</td></tr>`).join('')}
      ${Array.from({ length: blankRows }, () => '<tr class="blankrow"><td></td><td></td><td></td><td></td><td></td></tr>').join('')}
    </tbody></table>
    <p class="small">Keep cool and dark. Freeze at −20 °C if the samples will not reach the lab within 2 weeks. Sign at every hand-over.</p>
  </div>`;
  setTimeout(() => window.print(), 100);
}

/* ─────────────────────────── Results ─────────────────────────── */
const RESULT_TAG = {
  confirmed: '<span class="tag ok">Confirmed</span>',
  'pending-blank': '<span class="tag info">Likely — blank pending</span>',
  possible: '<span class="tag warn">Possible</span>',
  'not-detected': '<span class="tag">Not detected — not proof of absence</span>',
  unreliable: '<span class="tag crit">Unreliable</span>',
};
const dots = (hits, n) => `<span class="dots" aria-hidden="true">${Array.from({ length: Math.max(n, 3) }, (_, i) => `<i class="${i < hits ? 'on' : ''}"></i>`).join('')}</span>`;

function results(root) {
  const al = alerts();
  const sr = siteResults();
  const reads = new Map();
  sr.forEach(v => v.species.forEach(o => { const r = reads.get(o.species) || { species: o.species, common: o.common, reads: 0, invasive: o.invasive }; r.reads += o.reads; reads.set(o.species, r); }));
  const top = [...reads.values()].sort((a, b) => b.reads - a.reads).slice(0, 10);
  const blankTag = b => b.state === 'clean' ? '<span class="tag ok">Blank clean</span>' : b.state === 'contaminated' ? '<span class="tag crit">Blank shows DNA</span>' : b.state === 'pending' ? '<span class="tag info">Blank result pending</span>' : '<span class="tag warn">No field blank</span>';
  root.innerHTML = `
  <section class="grid">
    <div class="card notice">
      <div class="legend">
        <span>${RESULT_TAG.confirmed}<span>detected in 2 or 3 of 3 replicates <b>and</b> the field blank is clean</span></span>
        <span>${RESULT_TAG.possible}<span>detected in 1 of 3 — single detections are unreliable</span></span>
        <span>${RESULT_TAG['not-detected']}</span>
        <span>${RESULT_TAG.unreliable}<span>the blank showed DNA, so the whole site is flagged</span></span>
      </div>
      <p class="dim" style="font-size:14px;margin:10px 0 0">Locations of sensitive species are shown on a ~10 km grid (rounded to 0.1°). Exact points stay with approved scientists and rangers.</p>
    </div>
    <div class="grid g2" id="visits">
      ${sr.length ? sr.map(v => {
        const c = displayCoords(v);
        const contaminated = v.blank.state === 'contaminated';
        return `<div class="card visit">
          <h2>${esc(v.siteName)} <span class="tag">${esc(v.siteCode)}</span></h2>
          <p class="mono" style="font-size:12px;margin:-8px 0 10px">${new Date(v.ts).toLocaleDateString()} · ${esc(v.mission)} · ${c.text}${c.rounded ? ' <span class="tag warn">rounded ~10 km</span>' : ''}</p>
          <div class="row" style="margin-bottom:10px">${blankTag(v.blank)}<span class="tag">${v.n} valid replicate${v.n === 1 ? '' : 's'}</span>${v.invalid ? `<span class="tag crit">${v.invalid} not valid (&lt; ${state.rules.minValidMl} mL)</span>` : ''}${v.reported < v.n ? `<span class="tag info">${v.n - v.reported} awaiting lab</span>` : ''}</div>
          ${contaminated ? `<div class="alert crit"><span class="dot"></span><div><b>Blank contaminated – results unreliable</b><small>The field blank ${esc(v.blank.sample?.id || '')} contained DNA (${esc(v.blank.species.slice(0, 3).join(', '))}). Nothing from this site counts as a detection.</small></div></div>` : ''}
          ${v.species.length || v.missing.length ? `<div class="table-wrap"><table class="res-table"><thead><tr><th>Species</th><th>Detected in</th><th>Result</th></tr></thead><tbody>
            ${v.species.map(o => `<tr class="${contaminated ? 'muted-row' : ''}"><td><b>${esc(o.common || o.species)}</b><br><i class="dim">${esc(o.species)}</i>${o.sensitive ? ' <span class="tag warn">sensitive</span>' : ''}${o.invasive ? ' <span class="tag crit">watchlist</span>' : ''}${o.inBlank ? ' <span class="tag crit">also in blank</span>' : ''}</td>
              <td>${dots(o.hits, o.n)} <b>${o.hits} of ${o.n}</b></td><td>${RESULT_TAG[o.result]}</td></tr>`).join('')}
            ${v.missing.map(o => `<tr class="muted-row"><td><b>${esc(o.common || o.species)}</b><br><i class="dim">${esc(o.species)}</i></td><td>${dots(0, o.n)} <b>0 of ${o.n}</b></td><td>${RESULT_TAG['not-detected']}</td></tr>`).join('')}
          </tbody></table></div>` : `<div class="empty">${v.reported ? 'No DNA detected. Not detected is not proof of absence.' : 'Waiting for lab results.'}</div>`}
        </div>`;
      }).join('') : '<div class="card"><div class="empty">No samples with results yet. Run a mission, then import the lab CSV — or load the demo file below.</div></div>'}
    </div>
    <div class="grid g2">
      <div class="card"><h2>Alerts <span class="tag ${al.length ? 'crit' : 'ok'}">${al.length ? `${al.length} open` : 'All clear'}</span></h2>${al.length ? al.map(alertRow).join('') : '<div class="empty">No alerts.</div>'}</div>
      <div class="card"><h2>Import lab results</h2>
        <div class="drop" id="drop">Drop the lab’s CSV here, or <label style="color:var(--mint);cursor:pointer;text-decoration:underline">browse<input type="file" accept=".csv,text/csv" id="file" hidden></label><br><span class="dim" style="font-size:13px">Columns: sample_id, species, common_name, reads (a row with no species = tested, nothing found)</span></div>
        <div class="row" style="margin-top:12px"><button class="btn" id="demo">Demo results for my samples</button><button class="btn" id="demoFile">Load demo CSV</button><a class="btn ghost" href="docs/sample-results.csv" download>Download demo CSV</a></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="expRes">Export results (public, rounded)</button><button class="btn ghost" id="clear">Clear results</button></div>
        <p class="dim" style="font-size:14px;margin-top:10px">Demo results are fictional, for training only.</p>
      </div>
    </div>
    <div class="grid g2">
      <div class="card chart"><h2>Confirmed species per site</h2>${columns(sr.map(v => ({ label: `${v.siteCode} ${new Date(v.ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}`, value: v.species.filter(o => o.result === 'confirmed').length })))}</div>
      <div class="card chart"><h2>Strongest DNA signals <span class="tag">total reads</span></h2>${hbars(top.map(t => ({ label: t.common || t.species, value: t.reads, color: t.invasive ? 'var(--amber)' : 'var(--moss)', note: t.invasive ? 'watchlist' : '' })))}</div>
    </div>
    <div class="card"><h2>Watchlist <span class="tag">${state.watchlist.length}</span></h2>
      <p><b>Invasive</b> species raise an alert. <b>Sensitive</b> species (threatened, or wanted by poachers) make the app round that site’s coordinates to ~10 km.</p>
      <div class="species" id="wl"></div>
      <form class="form wl-form" id="wlForm">
        <input type="text" name="species" placeholder="Scientific name" required aria-label="Scientific name">
        <input type="text" name="common" placeholder="Common name" aria-label="Common name">
        <select name="kind" aria-label="Kind"><option value="invasive">Invasive (alert)</option><option value="sensitive">Sensitive (round location)</option></select>
        <button class="btn">Add</button>
      </form>
    </div>
  </section>`;
  const drawWL = () => {
    $('#wl', root).innerHTML = state.watchlist.map((w, i) => `<div class="sp"><div><b>${esc(w.common || w.species)}</b> <i>${esc(w.species)}</i> <span class="tag ${w.kind === 'sensitive' ? 'warn' : 'crit'}">${w.kind === 'sensitive' ? 'sensitive' : 'invasive'}</span>${w.note ? `<br><small class="dim">${esc(w.note)}</small>` : ''}</div><button class="icon-btn" data-wdel="${i}" aria-label="Remove">${icons.x}</button></div>`).join('') || '<div class="dim">Empty</div>';
    $$('[data-wdel]', root).forEach(b => b.onclick = () => { state.watchlist.splice(+b.dataset.wdel, 1); save(); results(root); });
  };
  drawWL();
  $('#wlForm', root).onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); state.watchlist.push({ species: String(f.get('species')).slice(0, 120), common: String(f.get('common')).slice(0, 120), kind: f.get('kind') === 'sensitive' ? 'sensitive' : 'invasive', note: '' }); save(); results(root); };
  const load = text => {
    try {
      const n = importResults(parseCSV(text)); const L = importResults.last || {};
      toast(`${n} detections imported`, 'ok', `${L.samples || 0} samples reported${L.created ? ` · ${L.created} added to the registry` : ''}`);
      results(root);
    } catch (err) { toast('Could not read that CSV', 'warn', err.message); }
  };
  $('#file', root).onchange = e => { const f = e.target.files[0]; if (f) f.text().then(load); };
  const drop = $('#drop', root);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) f.text().then(load); };
  $('#demo', root).onclick = () => { if (!state.samples.length) return toast('Run a mission first', 'warn', 'Or press “Load demo CSV”.'); const n = demoResults(); toast(`${n} demo detections loaded`, 'ok', 'Fictional data for training.'); results(root); };
  $('#demoFile', root).onclick = () => fetch('docs/sample-results.csv').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }).then(load).catch(err => toast('Could not load the demo file', 'warn', err.message));
  $('#clear', root).onclick = () => { if (confirm('Clear all lab results?')) { state.results = []; state.reported = []; save(); results(root); } };
  $('#expRes', root).onclick = () => {
    const rows = [];
    sr.forEach(v => {
      const c = displayCoords(v);
      const base = { site_code: v.siteCode, site_name: v.siteName, date: new Date(v.ts).toISOString().slice(0, 10), mission: v.mission, lat: c.lat ?? '', lon: c.lon ?? '', coords_rounded: c.rounded ? 'yes (~10 km)' : 'no', blank: v.blank.state };
      v.species.forEach(o => rows.push({ ...base, species: o.species, common_name: o.common || '', detected_in: o.hits, replicates: o.n, result: o.result }));
      v.missing.forEach(o => rows.push({ ...base, species: o.species, common_name: o.common || '', detected_in: 0, replicates: o.n, result: 'not detected (not proof of absence)' }));
    });
    if (!rows.length) return toast('No results to export', 'warn');
    download(`ck-results-public-${todayISO()}.csv`, toCSV(rows, Object.keys(rows[0])), 'text/csv');
  };
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
        <h2>Pump calibration <span class="tag ${st.pumpCal.length >= 3 ? 'ok' : 'warn'}">${Math.round(st.flowMlMin)} mL/min</span></h2>
        <p>Volume is measured by pump run-time, so calibrate with a filter fitted before every field day (expected about 60–100 mL/min). Put the intake in a bucket and the outlet in a measuring jug.</p>
        <div class="steps">${[0, 1, 2, 3, 4].map(i => `<i class="${i < st.pumpCal.length ? 'on' : ''}"></i>`).join('')}</div>
        <div class="form c3">
          <label class="f">Run time (s)<input type="number" id="pSec" value="30" min="1" max="600"></label>
          <label class="f">Measured volume (mL)<input type="number" id="pMl" placeholder="e.g. 43"></label>
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
        <p class="dim" style="font-size:14px;margin-top:10px" id="phSlope"></p>
        <h2 style="margin-top:18px">Load cell (waste bottle)</h2>
        <p>The Pod weighs the waste bottle: 1 g of water = 1 mL. Tare with the empty bottle, then calibrate with a known weight.</p>
        <div class="row"><button class="btn" id="tare">Tare (empty bottle)</button><label class="f" style="flex:1;min-width:120px">Known weight (g)<input type="number" id="scalG" placeholder="e.g. 500"></label><button class="btn" id="scal" style="align-self:end">Calibrate</button></div>
        <h2 style="margin-top:18px">Turbidity zero</h2>
        <div class="row"><label class="f" style="flex:1">Voltage in clean water<input type="number" step="0.001" id="nz" value="${st.ntuZeroV}"></label><button class="btn" data-cap="nz" style="align-self:end">Capture</button></div>
      </div>
    </div>
    <div class="grid g2">
      <div class="card">
        <h2>Carousel</h2>
        <p>How far the stepper turns between seats. With a 200-step motor at 16 microsteps, 8 seats need 400 steps each. Run 80 moves and check seat 1 still lines up (test 3).</p>
        <form class="form c3" id="gForm">
          <label class="f">Seats<input type="number" name="seats" value="${g.seats}" min="8" max="8" readonly></label>
          <label class="f">Steps per seat<input type="number" name="stepsPerSeat" value="${g.stepsPerSeat}" min="10"></label>
        </form>
        <div class="slotgrid" id="gPrev"></div>
      </div>
      <div class="card">
        <h2>Data <span class="tag ${navigator.onLine ? 'ok' : 'warn'}">${navigator.onLine ? 'online' : 'offline'}</span></h2>
        <p>Everything is stored on this device and the console works with no internet (open it once online first). Keep three copies: the Pod’s microSD, this device, and an exported backup.</p>
        <div class="row"><button class="btn primary" id="exp">Export backup (JSON)</button><button class="btn" id="expCsv">Export samples (CSV)</button><label class="btn">Import backup<input type="file" accept=".json" id="imp" hidden></label><button class="btn danger" id="rst">Reset to demo data</button></div>
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
    $('#pRes', root).innerHTML = `<div class="table-wrap"><table><thead><tr><th>Run</th><th>Seconds</th><th>mL</th><th>mL/min</th></tr></thead><tbody>${runs.map((r, i) => `<tr><td>${i + 1}</td><td>${r.seconds}</td><td>${r.ml}</td><td>${(r.ml / r.seconds * 60).toFixed(0)}</td></tr>`).join('')}</tbody></table></div>
      <p style="margin-top:10px"><b>Mean ${(mean * 60).toFixed(0)} mL/min</b> · spread ±${spread.toFixed(1)}% <span class="tag ${spread <= 5 ? 'ok' : 'warn'}">${spread <= 5 ? 'Within ±5% target' : 'Above ±5% — check tubing'}</span></p>`;
  };
  pRes();
  $('#pRun', root).onclick = () => { if (!link.send({ cmd: 'pump', which: 'S', seconds: +$('#pSec', root).value })) toast('Connect the Pod (or simulator) first', 'warn'); else toast('Pump running', 'ok', 'Measure the water in the jug when it stops, then save the run.'); };
  $('#pAdd', root).onclick = () => {
    const ml = +$('#pMl', root).value, seconds = +$('#pSec', root).value;
    if (!ml || !seconds) return toast('Enter the measured volume', 'warn');
    st.pumpCal.push({ seconds, ml }); if (st.pumpCal.length > 5) st.pumpCal.shift();
    const rates = st.pumpCal.map(r => r.ml / r.seconds);
    st.flowMlMin = Math.round(rates.reduce((a, b) => a + b) / rates.length * 60);
    save(); link.send({ cmd: 'setcal', flowMlMin: st.flowMlMin }); calibrate(root);
  };
  $('#pReset', root).onclick = () => { st.pumpCal = []; save(); calibrate(root); };
  const onPumped = e => { if (e.detail.which === 'S' && e.detail.grams != null) { $('#pMl', root).value = e.detail.grams; toast(`Load cell: ${e.detail.grams} g`, 'ok', 'Check it against the jug, then save the run.'); } };
  link.addEventListener('pumped', onPumped);
  $('#tare', root).onclick = () => link.send({ cmd: 'tare' }) || toast('Connect first', 'warn');
  $('#scal', root).onclick = () => { const g = +$('#scalG', root).value; if (!g) return toast('Enter the known weight in grams', 'warn'); link.send({ cmd: 'scalecal', grams: g }) || toast('Connect first', 'warn'); };
  const slope = () => { const v7 = +$('#v7', root).value, v4 = +$('#v4', root).value; const s = (7 - 4) / (v7 - v4); $('#phSlope', root).textContent = isFinite(s) ? `Slope ${s.toFixed(3)} pH/V · pH = 7 + (V − ${v7}) × ${s.toFixed(3)}` : 'Voltages must differ'; };
  slope();
  let capKey = null;
  $$('[data-cap]', root).forEach(b => b.onclick = () => { capKey = b.dataset.cap; if (!link.send({ cmd: 'read' })) { toast('Connect first', 'warn'); capKey = null; } });
  const onRaw = e => { if (!capKey) return; const v = capKey === 'nz' ? e.detail.ntuV : e.detail.phV; $(`#${capKey}`, root).value = v; capKey = null; slope(); toast(`Captured ${v} V`); };
  if (calRaw) link.removeEventListener('raw', calRaw);
  calRaw = onRaw;
  link.addEventListener('raw', onRaw);
  $('#v7', root).oninput = slope; $('#v4', root).oninput = slope;
  $('#phSave', root).onclick = () => { st.ph = { v7: +$('#v7', root).value, v4: +$('#v4', root).value }; st.ntuZeroV = +$('#nz', root).value; save(); link.send({ cmd: 'setcal', ph: st.ph, ntuZeroV: st.ntuZeroV, flowMlMin: st.flowMlMin, carousel: { stepsPerSeat: st.carousel.stepsPerSeat } }); toast('Calibration saved'); };
  const gPrev = () => {
    const f = $('#gForm', root); g.stepsPerSeat = +f.stepsPerSeat.value || 0; g.seats = 8; save();
    const el = $('#gPrev', root); el.style.gridTemplateColumns = 'repeat(8,1fr)';
    el.innerHTML = Array.from({ length: 8 }, (_, i) => `<span class="${i === 0 ? 'blank' : ''}" title="${i * g.stepsPerSeat} steps from home">${i === 0 ? 'B' : i === 7 ? 'F' : i + 1}</span>`).join('');
  };
  gPrev(); $('#gForm', root).oninput = gPrev;
  $('#exp', root).onclick = () => download(`ck-backup-${todayISO()}.json`, exportJSON(), 'application/json');
  $('#expCsv', root).onclick = () => { const rows = sampleRows(); if (!rows.length) return toast('No samples yet', 'warn'); download(`ck-samples-${todayISO()}.csv`, toCSV(rows, sampleCols), 'text/csv'); };
  $('#imp', root).onchange = e => e.target.files[0]?.text().then(t => { try { importJSON(t); toast('Backup restored'); calibrate(root); } catch (err) { toast('Import failed', 'warn', err.message); } });
  $('#rst', root).onclick = () => { if (confirm('Reset all sites, samples and results to the demo set?')) { resetAll(); collector.setFilled([]); toast('Reset done'); calibrate(root); } };
  $('#dname', root).onchange = e => { st.deviceName = e.target.value; save(); };
  return () => { link.removeEventListener('raw', calRaw); link.removeEventListener('pumped', onPumped); calRaw = null; };
}
let calRaw = null;

/* ─────────────────────────── Help ─────────────────────────── */
function help(root) {
  const team = [['Pranav Praseen', 'Team Captain'], ['Aarav Muralidharan', 'Project Manager'], ['Arnav', 'Researcher'], ['Atharv Prashant Naik', 'Builder'], ['Dipayan Saha', 'Builder · Coder'], ['Gokul Charan Chetty Umapathi', 'Core Values · Robot Design'], ['Lakshanya Devidas Mehatkar', 'Coder'], ['Mugilan G Srinivasan', 'Core Values'], ['Jude Raphael Peter', 'Innovation Project']];
  root.innerHTML = `
  <section class="grid g2">
    <div class="card prose">
      <h2>Quick start</h2>
      <ol>
        <li><b>Calibrate</b> the pump with a filter fitted (5 runs) and the pH probe before each field day.</li>
        <li><b>Plan</b> the mission: date, 2 sites × 3 replicates (or 1 site × 6) and the operator. Open the console once with internet so it works offline in the field.</li>
        <li><b>Print</b> the QR labels at school and stick them on the cartridges: seat 1 is the field blank, seats 2–7 the samples. Seat 8 stays empty for flushing.</li>
        <li><b>Connect</b> by Bluetooth or USB (no mobile signal needed) — or use the simulator to practise.</li>
        <li><b>Run</b> the mission. The Pod asks for the blank bottle first (scan the blank’s label), then for each new site. Scan each sample label before it is filled — ahead of time, or when the Pod pauses for it. Sample seats stay locked until the blank is logged. No GPS fix? Type the location.</li>
        <li><b>Lost the link?</b> The Pod keeps going and saves every record to its SD card and flash. Use “Copy records from Pod” on the Connect page afterwards. The START button runs a mission with no app at all.</li>
        <li><b>Seal &amp; ship</b>: add seal numbers, make a custody batch, print the form, sign at every hand-over. Export CSV/JSON after every mission.</li>
        <li><b>Import</b> the lab’s CSV to see “detected in X of 3” for every species.</li>
      </ol>
      <h3>How to read results</h3>
      <p><b>Confirmed</b> = found in 2 or 3 of 3 replicates with a clean field blank. <b>Possible</b> = 1 of 3. <b>Not detected</b> does not mean absent. If the blank shows DNA, that site is flagged “Blank contaminated – results unreliable”.</p>
      <h3>For developers</h3>
      <p>The app talks to the Pod in newline-delimited JSON over Bluetooth (Nordic UART service), USB serial at 115200 baud, or a WebSocket at <code>/ws</code>. See <a href="docs/PROTOCOL.md">PROTOCOL.md</a> and the ESP32 firmware in <code>/firmware</code>.</p>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card prose">
        <h2>Safety and clean sampling <span class="tag warn">Read first</span></h2>
        <ul>
          <li>An adult supervises every field test and anything with ethanol or bleach.</li>
          <li>Never mix bleach and ethanol. Rinse bleach-cleaned tools with distilled water.</li>
          <li>Fresh gloves for every sample. No fish or meat lunches near the site; pets stay home.</li>
          <li>At each site: 10% bleach on the nozzle for 10 min, rinse, new bagged intake tube, then the 250 mL flush through seat 8.</li>
          <li>Keep ethanol sealed and away from the electronics box.</li>
          <li>Protected forests, reserves and zoo or museum habitats need written permission before any sampling.</li>
          <li>No animals are caught or touched — only water is sampled.</li>
        </ul>
      </div>
      <div class="card">
        <h2><img src="assets/canopy-keepers-logo.svg" alt="" width="40" height="40"> Made by Team Canopy Keepers</h2>
        <div class="team">${team.map(([n, r]) => `<div class="member"><span class="av">${n[0]}</span><div><b>${n}</b><small>${r}</small></div></div>`).join('')}</div>
        <p class="dim" style="margin-top:12px;font-size:14px">FIRST LEGO League · BIOGLOW 2026–27 · Dubai, UAE. Demo results in this app are fictional.</p>
      </div>
    </div>
  </section>`;
}

export const VIEWS = {
  overview: { title: 'Overview', render: overview },
  connect: { title: 'Connect', render: connect },
  planner: { title: 'Mission planner', render: planner },
  live: { title: 'Live mission', render: live },
  samples: { title: 'Samples & custody', render: samples },
  results: { title: 'Biodiversity', render: results },
  calibrate: { title: 'Calibration', render: calibrate },
  help: { title: 'Help & safety', render: help },
};
