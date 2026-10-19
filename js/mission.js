// Mission control: builds missions from the plan, starts them on the device and
// records what comes back (samples, errors, completion) no matter which view is open.
import { link } from './device.js';
import { state, save, addSample } from './store.js';
import { collector } from './scene.js';
import { toast, uid, tubeId } from './util.js';

export function buildMission() {
  return {
    id: uid('m'),
    sites: state.sites.map(s => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon })),
    rules: { ...state.rules },
    tubeStart: state.nextTube,
    mlPerS: state.settings.pumpMlPerS,
    carousel: state.settings.carousel,
  };
}

export async function startMission({ useSimIfDisconnected = true } = {}) {
  if (!state.sites.length) { toast('Add at least one site first', 'warn'); return false; }
  if (!link.connected) {
    if (!useSimIfDisconnected) { toast('Connect to the Pod first', 'warn'); return false; }
    await link.connect('sim', { speed: state.settings.simSpeed });
    toast('Simulator connected', 'ok', 'No Pod found, so the mission runs on the digital twin.');
  }
  if (link.busy) { toast('A mission is already running', 'warn'); return false; }
  const m = buildMission();
  state.missions.push({ id: m.id, start: Date.now(), sites: m.sites.length, status: 'running', via: link.kind });
  save();
  if (link.kind === 'sim') link.send({ cmd: 'speed', value: state.settings.simSpeed });
  link.send({ cmd: 'start', mission: m });
  return true;
}

// Judging demo: one short site, no field blank, ~1.5–2 min, every step visible on the schematic.
let demoActive = false;
export async function startDemo() {
  if (!link.connected) {
    await link.connect('sim', { speed: 1.5 });
    toast('Simulator connected', 'ok', 'No Pod found, so the demo runs on the digital twin.');
  }
  if (link.busy) { toast('A mission is already running', 'warn'); return false; }
  const base = state.sites[0] || { lat: 25.2048, lon: 55.2708 };
  const m = {
    id: uid('m'),
    sites: [{ id: 'DEMO', name: 'Demo stream', lat: base.lat, lon: base.lon }],
    rules: { ...state.rules, blank: false, clearMl: 100, murkyMl: 100, primeMl: 10, rinseMl: 10, ethanolMl: 1, maxPumpS: 90 },
    tubeStart: state.nextTube,
    mlPerS: state.settings.pumpMlPerS,
    carousel: state.settings.carousel,
  };
  state.missions.push({ id: m.id, start: Date.now(), sites: 1, status: 'running', via: link.kind, demo: true });
  save();
  demoActive = true;
  if (link.kind === 'sim') link.send({ cmd: 'speed', value: 1.5 });
  link.send({ cmd: 'start', mission: m });
  toast('Demo run started', 'ok', 'One cartridge, about 2 minutes. Watch each step light up.');
  return true;
}
link.addEventListener('step', e => {
  if (demoActive && e.detail.n === 2) setTimeout(() => { if (demoActive) link.send({ cmd: 'placed' }); }, 2500);
});
link.addEventListener('done', () => { demoActive = false; });
link.addEventListener('aborted', () => { demoActive = false; });

export function scheduleMission() {
  if (!link.connected) { toast('Connect to the Pod to store a schedule', 'warn'); return; }
  link.send({ cmd: 'schedule', ...state.schedule, mission: buildMission() });
}

// Global listeners
link.addEventListener('tele', e => collector.setTelemetry(e.detail));
link.addEventListener('sample', e => {
  const s = addSample(e.detail);
  collector.fillTube(s.tube, s.blank);
  toast(`${s.id} preserved`, s.clog ? 'warn' : 'ok', `${s.siteName} · ${s.ml} mL · pH ${s.ph} · ${s.ntu} NTU${s.blank ? ' · field blank' : ''}`);
});
link.addEventListener('err', e => toast(e.detail.code === 'CLOG' ? 'Filter clogged — stopped early' : `Device: ${e.detail.msg}`, 'warn', e.detail.code === 'CLOG' ? e.detail.msg : ''));
link.addEventListener('done', e => {
  const m = state.missions.find(x => x.id === e.detail.mission); if (m) { m.status = 'complete'; m.end = Date.now(); save(); }
  toast('Mission complete', 'ok', `${e.detail.tubes} cartridges filled. Ship them to the lab from the Sample registry.`);
});
link.addEventListener('aborted', e => {
  const m = state.missions.find(x => x.id === e.detail.mission); if (m) { m.status = 'aborted'; m.end = Date.now(); save(); }
  toast('Mission aborted', 'warn', e.detail.msg);
});
link.addEventListener('ack', e => { if (e.detail.cmd === 'schedule') toast('Schedule stored on the Pod', 'ok', e.detail.msg || ''); });

export const nextTubeLabel = () => tubeId(state.nextTube);
