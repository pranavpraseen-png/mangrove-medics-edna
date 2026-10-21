// Mission control (protocol v3, firmware/README.md → "Console protocol").
// The Pod runs the fixed layout itself: seat 1 BLANK → per site: seat 8 FLUSH → SAMPLE seats.
// The console:
//  • answers every `wait` (BLANK_WATER, SITE, EMPTY_BOTTLE, WATER, AIR) with a clear prompt + `continue`;
//  • makes the operator scan (or type) each cartridge's QR label: the blank's at BLANK_WATER, and each
//    sample's before it is pumped — labels can be scanned ahead; if one is not scanned when the Pod
//    reaches SEAL, the console sends `pause` and resumes after the scan;
//  • sends `setloc` when there is no GPS fix, so the record carries a typed-in position (loc_source MANUAL).
import { link } from './device.js';
import { state, save, addSample, planLayout, runOrder, freshCarouselStart, siteById, confirmSeat, blankDone, activeMission, STOP_REASONS, layoutEntry, nameAll } from './store.js';
import { collector } from './scene.js';
import { toast, uid, tubeId, nameTube, ymd, todayISO, parseSampleId } from './util.js';

// The console page turns this on; other pages (the website's demo) answer waits automatically.
export const ui = { confirm: false };

// What the console is waiting for the operator to do: { kind, msg, seat, site, entry } or null.
// kind: BLANK_WATER | SITE | EMPTY_BOTTLE | WATER | AIR (from the Pod) or SCAN (console paused the Pod for a label).
export const waiting = { entry: null, kind: null, msg: '', site: '', seat: 0 };
const setWaiting = w => { Object.assign(waiting, { entry: null, kind: null, msg: '', site: '', seat: 0 }, w || {}); link.dispatchEvent(new CustomEvent('await', { detail: w ? { ...waiting } : null })); };

export function planProblems(plan = state.plan) {
  const out = [];
  const A = siteById(plan.siteA), B = siteById(plan.siteB);
  if (!A) out.push('Choose site A');
  if (plan.mode !== '1x6' && !B) out.push('Choose site B (or switch to 1 site × 6)');
  if (plan.mode !== '1x6' && A && B && A.id === B.id) out.push('Site A and site B are the same — use 1 site × 6 instead');
  if (plan.mode !== '1x6' && A && B && A.code === B.code) out.push('Site A and site B need different site codes');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.date || '')) out.push('Set the mission date');
  return out;
}

export function buildMission(opts = {}) {
  const plan = opts.plan || state.plan;
  const tubeStart = opts.tubeStart || freshCarouselStart();
  const layout = planLayout(plan, tubeStart);
  const A = opts.sites?.[0] || siteById(plan.siteA), B = plan.mode === '1x6' ? null : (opts.sites?.[1] || siteById(plan.siteB));
  const site = s => ({ code: s.code, name: String(s.name).slice(0, 40), ...(Number.isFinite(+s.lat) && Number.isFinite(+s.lon) ? { lat: +s.lat, lon: +s.lon } : {}) });
  const R = { ...state.rules, ...(opts.rules || {}) };
  return {
    id: opts.id || `CK-${ymd(plan.date)}-M${uid('').slice(1, 5).toUpperCase()}`,
    sites: [A, B].filter(Boolean).map(site),
    rules: { targetMl: R.targetMl, blankMl: R.blankMl, flushMl: R.flushMl, maxMin: R.maxMin, minFlowMlMin: R.minFlowMlMin, minValidMl: R.minValidMl, ethanolMl: R.ethanolMl },
    flowMlMin: opts.flowMlMin || state.settings.flowMlMin,
    carousel: { stepsPerSeat: state.settings.carousel.stepsPerSeat },
    _layout: layout, _tubeStart: tubeStart, _mode: plan.mode === '1x6' ? '1x6' : '2x3',
  };
}

async function ensureLink(speed) {
  if (link.connected) return true;
  await link.connect('sim', { speed });
  toast('Simulator connected', 'ok', 'No Pod found, so the mission runs on the digital twin.');
  return true;
}

function send(m, extra = {}) {
  const { _layout, _tubeStart, _mode, ...wire } = m;
  state.missions.push({ id: m.id, start: Date.now(), date: state.plan.date, mode: _mode, tubeStart: _tubeStart, layout: _layout, flushes: [], status: 'running', via: link.kind, operator: state.plan.operator, ...extra });
  _layout.forEach(e => { if (e.id) nameTube(e.tube, e.id); });
  state.nextTube = Math.max(state.nextTube, _tubeStart);
  save();
  link.send({ cmd: 'start', mission: wire });
}

export async function startMission({ useSimIfDisconnected = true } = {}) {
  const probs = planProblems();
  if (probs.length) { toast('Mission plan not ready', 'warn', probs[0]); return false; }
  if (state.plan.date !== todayISO()) {
    if (ui.confirm) { toast('Mission date is not today', 'warn', `The Pod stamps today’s date into every sample ID. Set the date to ${todayISO()} and reprint the labels.`); return false; }
    state.plan.date = todayISO();
  }
  if (!link.connected && !useSimIfDisconnected) { toast('Connect to the Pod first', 'warn'); return false; }
  await ensureLink(state.settings.simSpeed);
  if (link.info && link.info.protocol && link.info.protocol < 3) toast('Old Pod firmware', 'warn', 'This console expects protocol 3 — update the firmware.');
  if (link.busy) { toast('A mission is already running', 'warn'); return false; }
  const old = activeMission(); if (old) { old.status = 'interrupted'; old.end = Date.now(); }
  if (link.kind === 'sim') link.send({ cmd: 'speed', value: state.settings.simSpeed });
  send(buildMission());
  return true;
}

// Judging demo: field blank + one site, filtered fast, every step visible on the schematic. Waits answer themselves.
export async function startDemo() {
  await ensureLink(2.5);
  if (link.busy) { toast('A mission is already running', 'warn'); return false; }
  const base = siteById(state.plan.siteA) || state.sites[0] || { lat: 25.2048, lon: 55.2708 };
  const demoSite = { id: '__demo', code: 'DEMO', name: 'Demo stream', lat: base.lat, lon: base.lon };
  state.sites.push(demoSite);
  const m = buildMission({ plan: { date: todayISO(), mode: '1x6', siteA: '__demo' }, rules: { targetMl: 300, blankMl: 300, flushMl: 60, ethanolMl: 1, maxMin: 4 }, flowMlMin: 900 });
  state.sites = state.sites.filter(s => s.id !== '__demo');
  if (link.kind === 'sim') { link.send({ cmd: 'speed', value: 2.5 }); link.send({ cmd: 'simcfg', clogSeat: 0, airSeat: 0, noFix: 'none' }); }
  send(m, { demo: true, auto: true });
  toast('Demo run started', 'ok', 'About 2 minutes: field blank first, then a site flush and 6 small samples. Watch each step light up.');
  return true;
}

export function scheduleMission() {
  if (!link.connected) { toast('Connect to the Pod to store a schedule', 'warn'); return; }
  const probs = planProblems();
  if (probs.length) { toast('Mission plan not ready', 'warn', probs[0]); return; }
  const { _layout, _tubeStart, _mode, ...wire } = buildMission();
  link.send({ cmd: 'schedule', ...state.schedule, mission: wire });
}

/* ── Labels and waits ── */
const curMission = () => activeMission();
const entryBySeat = (seat, role) => curMission()?.layout?.find(x => x.seat === seat && (!role || x.role === role)) || null;
export const isConfirmed = e => !!(e && state.confirm[e.tube]?.at);
export const blankIsDone = () => { const m = curMission(); return !!(link.tele?.blankDone || (m && blankDone(m.id))); };

export function canConfirm(entry) {
  if (!entry) return false;
  if (entry.role === 'sample') return blankIsDone();
  return true;
}

// Unscanned sample labels of the running mission, in run order.
export function pendingLabels() {
  const m = curMission(); if (!m) return [];
  return runOrder(m.layout).filter(e => e.role === 'sample' && !isConfirmed(e) && !state.samples.some(s => s.id === e.id));
}

// Scan ahead: accept any not-yet-scanned sample label of this mission (only after the blank).
export function prescan(text, by = '') {
  const m = curMission(); if (!m) return { ok: false, msg: 'No mission running' };
  const id = parseSampleId(text);
  if (!id) return { ok: false, msg: 'That is not a sample ID (CK-YYYYMMDD-SITE-S#)' };
  const e = m.layout.find(x => x.id === id);
  if (!e) return { ok: false, msg: `${id} is not part of this mission` };
  if (e.role === 'blank') return { ok: false, msg: 'Scan the blank when the Pod asks for the blank bottle' };
  if (!blankIsDone()) return { ok: false, msg: 'Run the field blank (seat 1) first — samples are locked until it is logged' };
  if (isConfirmed(e)) return { ok: true, msg: `${id} already scanned`, entry: e };
  confirmSeat(e.tube, { id, by: by || state.plan.operator || '' });
  // If the Pod is paused waiting for exactly this label, carry on.
  if (waiting.kind === 'SCAN' && waiting.entry?.id === id) { link.send({ cmd: 'resume' }); setWaiting(null); }
  return { ok: true, msg: `${id} scanned`, entry: e };
}

const validLoc = l => l && Number.isFinite(l.lat) && Number.isFinite(l.lon) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180;

// Answer what the console is waiting for. scanned = label text; manual = {lat, lon} when no GPS fix; force = override sensor check.
export function confirmCurrent({ scanned = '', manual = null, force = false, by = '' } = {}) {
  const k = waiting.kind, e = waiting.entry;
  if (!k) return { ok: false, msg: 'The Pod is not waiting for anything' };
  if (manual && !validLoc(manual)) return { ok: false, msg: 'Enter a valid latitude and longitude' };
  if (k === 'SCAN' || k === 'BLANK_WATER') {
    if (!e) return { ok: false, msg: 'Unknown seat' };
    if (k === 'SCAN' && !canConfirm(e)) return { ok: false, msg: 'Run the field blank (seat 1) first' };
    const id = parseSampleId(scanned);
    if (!id) return { ok: false, msg: 'Scan or type the sample ID (CK-YYYYMMDD-SITE-S#)' };
    if (id !== e.id) return { ok: false, msg: `Wrong label: ${id}. Seat ${e.seat} needs ${e.id}` };
    confirmSeat(e.tube, { id, by: by || state.plan.operator || '' });
  }
  // New place: the Pod keeps a typed-in location until cleared, so set or clear it for this site.
  if (manual) link.send({ cmd: 'setloc', lat: +manual.lat, lon: +manual.lon, label: String(waiting.site || e?.siteCode || '').slice(0, 24) });
  else if (k === 'BLANK_WATER' || k === 'SITE') link.send({ cmd: 'setloc', clear: true });
  if (k === 'SCAN') link.send({ cmd: 'resume' });
  else link.send({ cmd: 'continue', ...(force ? { force: true } : {}) });
  setWaiting(null);
  return { ok: true };
}

// No GPS fix while sampling (e.g. indoors): type the position; the Pod uses it for every record until the next site.
export const needsLocation = () => !!(curMission() && link.tele && link.tele.fix === 0 && !link.tele.manualLoc && ['PUMP', 'SEAL', 'PRESERVE', 'MOVE', 'WAIT', 'LOG'].includes(link.tele.state));
export function setManualLocation(loc, label = '') {
  if (!validLoc(loc)) return { ok: false, msg: 'Enter a valid latitude and longitude' };
  link.send({ cmd: 'setloc', lat: +loc.lat, lon: +loc.lon, label: String(label || link.tele?.siteCode || '').slice(0, 24) });
  if (link.tele) link.tele.manualLoc = 1;
  return { ok: true };
}

// Pod asks for something.
link.addEventListener('wait', ev => {
  const w = ev.detail || {};
  const m = curMission();
  const role = w.for === 'BLANK_WATER' ? 'blank' : w.for === 'SITE' ? 'flush' : null;
  let entry = role ? entryBySeat(w.seat, role) : entryBySeat(w.seat);
  if (entry && entry.role === 'flush') { const s = m.layout.find(x => x.role === 'sample' && x.siteCode === w.site); if (s) entry = { ...entry, site: s.site, siteCode: s.siteCode, siteName: s.siteName, lat: s.lat, lon: s.lon }; }
  setWaiting({ kind: w.for, msg: w.msg || '', seat: w.seat, site: w.site, entry });
  const auto = !m || m.auto || !ui.confirm;
  if (auto) setTimeout(() => {
    if (waiting.kind !== w.for) return;
    if (entry && entry.role === 'blank') confirmSeat(entry.tube, { id: entry.id, by: m?.demo ? 'demo' : 'auto' });
    link.send({ cmd: 'continue' }); setWaiting(null);
  }, m?.demo ? 1500 : 500);
});

// Gate: no sample is pumped until its label has been scanned.
link.addEventListener('step', ev => {
  const st = ev.detail;
  if (st.name === 'SEAL' && String(st.role).toUpperCase() === 'SAMPLE') {
    const m = curMission();
    const e = entryBySeat(st.seat, 'sample');
    if (!e || !m) return;
    if (m.auto || !ui.confirm) { if (!isConfirmed(e)) confirmSeat(e.tube, { id: e.id, by: m.demo ? 'demo' : 'auto' }); return; }
    if (!isConfirmed(e)) { link.send({ cmd: 'pause' }); setWaiting({ kind: 'SCAN', seat: e.seat, site: e.siteCode, entry: e, msg: `Scan the label on seat ${e.seat} before it is filled` }); }
    return;
  }
  // Pod moved on (e.g. START button pressed on the Pod itself): clear the prompt.
  if (waiting.kind && waiting.kind !== 'SCAN' && st.name !== 'WAIT' && st.name !== 'AIR_WAIT') setWaiting(null);
});

/* ── Global listeners ── */
link.addEventListener('tele', e => collector.setTelemetry(e.detail));
link.addEventListener('sample', e => {
  const s = addSample(e.detail);
  if (s.flush) { toast(`Line flushed at ${s.site}`, s.valid ? 'ok' : 'warn', `${s.ml} mL of site water through empty seat 8 to waste.`); return; }
  collector.fillTube(s.tube || s.seat, s.blank);
  const stop = s.stop_reason !== 'VOLUME' ? ` · ${STOP_REASONS[s.stop_reason] || s.stop_reason}` : '';
  toast(`${s.id} ${s.role === 'blank' ? 'field blank logged' : s.valid ? 'valid' : 'NOT valid'}`, s.valid ? (stop ? 'warn' : 'ok') : 'crit',
    `${s.siteName}${s.role === 'sample' ? ` rep ${s.replicate}` : ''} · ${s.ml} mL${stop}${s.manualLocation ? ' · manual location' : ''}`);
  if (s.role === 'blank') toast('Blank done — samples unlocked', 'ok', 'Scan the sample labels (seats 2–7) as you go.');
  if (e.detail.saved_sd === false || e.detail.saved_flash === false) toast('Record not saved on every copy', 'crit', 'Write it on the paper datasheet.');
});
const ERR_TITLE = {
  CLOG: 'Filter clogged — stopped early', AIR: 'Air in the line', SEAT: 'Carousel: seat magnet missing', HOME: 'Carousel could not find seat 1',
  LOWBAT: 'Battery low', HOT: 'Battery too hot — everything stopped', LEAK: 'Water inside the box!', BLANK: 'Blank must run first',
  MISSION: 'Pod rejected the mission', SAVE: 'Record not saved — write it on paper', SD: 'No SD card', SCALE: 'Load cell problem', NOPROBE: 'Battery temperature probe missing',
};
link.addEventListener('err', e => {
  const c = e.detail.code;
  const crit = ['HOT', 'LEAK', 'SAVE', 'BLANK', 'MISSION', 'HOME'].includes(c);
  toast(ERR_TITLE[c] || `Device: ${c || 'error'}`, crit ? 'crit' : 'warn', e.detail.msg || '');
  if (c === 'MISSION') { const m = curMission(); if (m) { m.status = 'rejected'; m.end = Date.now(); save(); } setWaiting(null); }
});
function endMission(e, status) {
  const m = state.missions.find(x => x.id === e.detail.mission) || activeMission();
  if (m) { m.status = status; m.end = Date.now(); state.nextTube = Math.max(state.nextTube, (m.tubeStart || state.nextTube) + 8); }
  save();
  setWaiting(null);
  return m;
}
link.addEventListener('done', e => {
  const m = endMission(e, 'complete');
  const n = state.samples.filter(s => s.mission === m?.id && s.role === 'sample');
  toast('Mission complete', 'ok', `Blank + ${e.detail.samples ?? n.length} samples (${e.detail.valid ?? n.filter(s => s.valid).length} valid). Seal, add seal numbers and make a custody batch.`);
});
link.addEventListener('aborted', e => { endMission(e, 'aborted'); toast('Mission aborted', 'warn', e.detail.msg); });
link.addEventListener('ack', e => {
  const d = e.detail;
  if (d.cmd === 'schedule') toast(d.ok ? 'Schedule stored on the Pod' : 'Schedule refused', d.ok ? 'ok' : 'warn', d.msg || '');
  else if (d.cmd === 'setloc' && !d.ok) toast('Location not accepted', 'warn', d.msg || '');
});
link.addEventListener('status', () => { if (!link.connected && waiting.kind) setWaiting(null); });

nameAll();
export const nextTubeLabel = () => tubeId(state.nextTube);
export { layoutEntry };
