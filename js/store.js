// App state: sites, mission rules, settings, samples, lab results, watchlist.
// Persisted in localStorage; export/import as JSON.
import { uid, tubeId } from './util.js';

const KEY = 'edna-console-v1';
const listeners = new Set();

export const STATUSES = ['Collected', 'Shipped', 'At lab', 'Results in'];

function defaults() {
  return {
    version: 1,
    settings: {
      deviceName: 'EDNA-01',
      pumpMlPerS: 8.5,          // from the pump calibration wizard
      pumpCal: [],              // [{seconds, ml}]
      ph: { v7: 2.50, v4: 3.05 },// probe voltage at pH 7 and pH 4 (two-point calibration)
      ntuZeroV: 4.20,           // turbidity sensor voltage in clean water
      gantry: { cols: 10, rows: 5, x0: 20, y0: 20, dx: 18, dy: 18 },
      simSpeed: 10,
    },
    rules: { ntuMurky: 40, clearMl: 1000, murkyMl: 500, maxPumpS: 600, primeMl: 100, rinseMl: 100, blank: true },
    schedule: { mode: 'now', time: '21:30', tide: '' },
    sites: [
      { id: 'site_a', name: 'Creek edge A (demo)', lat: 25.1917, lon: 55.3222, protected: true, notes: 'Ras Al Khor — written permission needed' },
      { id: 'site_b', name: 'Creek edge B (demo)', lat: 25.1952, lon: 55.3285, protected: true, notes: 'Mangrove channel — permission needed' },
      { id: 'site_c', name: 'School test pond (demo)', lat: 25.2060, lon: 55.2700, protected: false, notes: 'Practice site' },
    ],
    samples: [],
    results: [],
    watchlist: [
      { species: 'Oreochromis sp.', common: 'Tilapia (example entry)', kind: 'invasive', note: 'Example only — confirm your watchlist with experts' },
    ],
    missions: [],
    nextTube: 1,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const d = defaults();
      return { ...d, ...s, settings: { ...d.settings, ...s.settings, gantry: { ...d.settings.gantry, ...(s.settings || {}).gantry } }, rules: { ...d.rules, ...s.rules } };
    }
  } catch (e) { /* storage blocked or corrupt — start fresh */ }
  return defaults();
}

export const state = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  listeners.forEach(fn => fn(state));
}
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export function resetAll() {
  const d = defaults();
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, d);
  save();
}

export function exportJSON() { return JSON.stringify(state, null, 2); }
export function importJSON(text) {
  const s = JSON.parse(text);
  if (!s || s.version !== 1) throw new Error('Not an eDNA Collector backup file');
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, defaults(), s);
  save();
}

// Sites
export function addSite(site) { state.sites.push({ id: uid('site'), protected: false, notes: '', ...site }); save(); }
export function updateSite(id, patch) { Object.assign(state.sites.find(s => s.id === id) || {}, patch); save(); }
export function removeSite(id) { state.sites = state.sites.filter(s => s.id !== id); save(); }
export function moveSite(id, dir) {
  const i = state.sites.findIndex(s => s.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= state.sites.length) return;
  [state.sites[i], state.sites[j]] = [state.sites[j], state.sites[i]];
  save();
}

// Samples (one per sealed tube)
export function addSample(msg) {
  const s = {
    tube: msg.tube, id: tubeId(msg.tube), site: msg.site, siteName: msg.name || msg.site,
    lat: msg.lat, lon: msg.lon, ts: msg.ts || Date.now(), ml: msg.ml, target: msg.target,
    ph: msg.ph, ntu: msg.ntu, blank: !!msg.blank, clog: !!msg.clog,
    status: 'Collected', mission: msg.mission || '',
  };
  state.samples = state.samples.filter(x => x.tube !== s.tube);
  state.samples.push(s);
  state.nextTube = Math.max(state.nextTube, s.tube + 1);
  save();
  return s;
}

// Lab results
export function importResults(rows) {
  const clean = rows
    .map(r => ({ tube: (r.tube_id || r.tube || '').toUpperCase(), species: r.species || '', common: r.common_name || r.common || '', reads: +(r.reads || r.count || 0) }))
    .filter(r => r.tube && r.species);
  const tubes = new Set(clean.map(r => r.tube));
  state.results = state.results.filter(r => !tubes.has(r.tube)).concat(clean);
  state.samples.forEach(s => { if (tubes.has(s.id)) s.status = 'Results in'; });
  save();
  return clean.length;
}

// Fictional demo results for the samples currently in the registry.
export function demoResults() {
  const pool = [
    ['Periophthalmus waltoni', 'Walton’s mudskipper'], ['Acanthopagrus arabicus', 'Arabian yellowfin seabream'],
    ['Planiliza klunzingeri', 'Klunzinger’s mullet'], ['Austruca sp.', 'Fiddler crab'],
    ['Scylla serrata', 'Mud crab'], ['Phoenicopterus roseus', 'Greater flamingo'],
    ['Chelonia mydas', 'Green turtle'], ['Oreochromis sp.', 'Tilapia'], ['Gerres sp.', 'Silver-biddy'],
  ];
  const rows = [];
  state.samples.forEach((s, i) => {
    if (s.blank) return; // clean blank: no reads
    const n = 3 + ((s.tube * 7) % 4);
    for (let k = 0; k < n; k++) {
      const [sp, common] = pool[(s.tube * 3 + k * 5) % pool.length];
      if (rows.some(r => r.tube_id === s.id && r.species === sp)) continue;
      rows.push({ tube_id: s.id, species: sp, common_name: common, reads: 200 + ((s.tube * 131 + k * 977) % 4800) });
    }
  });
  return importResults(rows);
}

// Alerts derived from data.
export function alerts() {
  const out = [];
  const inv = new Map(state.watchlist.filter(w => w.kind === 'invasive').map(w => [w.species.toLowerCase(), w]));
  state.samples.forEach(s => {
    const res = state.results.filter(r => r.tube === s.id);
    if (s.blank && res.some(r => r.reads > 0)) out.push({ level: 'crit', title: `Blank ${s.id} shows DNA`, text: 'Possible contamination — treat this mission’s results with caution and re-clean the lines.' });
    if (s.clog) out.push({ level: 'warn', title: `${s.id} stopped early`, text: `Filter clogged or time limit reached at ${Math.round(s.ml)} mL.` });
    else if (!s.blank && s.target && s.ml < s.target * 0.8) out.push({ level: 'warn', title: `${s.id} low volume`, text: `${Math.round(s.ml)} of ${s.target} mL filtered.` });
    res.forEach(r => {
      const w = inv.get(r.species.toLowerCase());
      if (w && r.reads > 0) out.push({ level: 'crit', title: `Watchlist species at ${s.siteName}`, text: `${r.species}${r.common ? ` (${r.common})` : ''} detected in ${s.id}.` });
    });
  });
  return out;
}
