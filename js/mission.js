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
