// App state: sites, mission rules, settings, samples, lab results, watchlist.
// Persisted in localStorage; export/import as JSON.
import { clean, uid, tubeId } from './util.js';

const KEY = 'edna-console-v3';
const listeners = new Set();

export const STATUSES = ['Collected', 'Shipped', 'At lab', 'Results in'];

function defaults() {
  return {
    version: 1,
    settings: {
      deviceName: 'EDNA-01',
      pumpMlPerS: 1.7,          // from the pump calibration wizard (≈100 mL/min)
      pumpCal: [],              // [{seconds, ml}]
      ph: { v7: 2.50, v4: 3.05 },// probe voltage at pH 7 and pH 4 (two-point calibration)
      ntuZeroV: 4.20,           // turbidity sensor voltage in clean water
      carousel: { seats: 8, stepsPerSeat: 400 }, // 200-step motor × 16 microsteps ÷ 8 seats
      simSpeed: 10,
    },
    rules: { ntuMurky: 40, clearMl: 1000, murkyMl: 500, maxPumpS: 900, primeMl: 34, rinseMl: 34, ethanolMl: 2, blank: true },
    schedule: { mode: 'now', time: '21:30', tide: '' },
    sites: [
      { id: 'site_a', name: 'Rainforest stream (demo)', lat: 25.20690, lon: 55.26180, protected: true, notes: 'Indoor rainforest — written permission needed' },
      { id: 'site_b', name: 'Canopy rain catcher (demo)', lat: 25.20720, lon: 55.26210, protected: true, notes: 'Rain dripping through the canopy' },
      { id: 'site_c', name: 'School test tank (demo)', lat: 25.23500, lon: 55.31700, protected: false, notes: 'Practice site' },
    ],
    samples: [],
    results: [],
    watchlist: [
      { species: 'Lithobates catesbeianus', common: 'American bullfrog (example entry)', kind: 'invasive', note: 'Example only — confirm your watchlist with experts' },
    ],
    missions: [],
    nextTube: 1,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = clean(JSON.parse(raw)) || {};
      const d = defaults();
      return { ...d, ...s, settings: { ...d.settings, ...s.settings, carousel: { ...d.settings.carousel, ...(s.settings || {}).carousel } }, rules: { ...d.rules, ...s.rules } };
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
  if (text.length > 5_000_000) throw new Error('File is too large');
  const s = clean(JSON.parse(text));
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
    .slice(0, 20000)
    .map(r => clean({ tube: String(r.tube_id || r.tube || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''), species: String(r.species || ''), common: String(r.common_name || r.common || ''), reads: Math.max(0, Math.min(1e9, Math.round(+(r.reads || r.count || 0)) || 0)) }))
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
    ['Choloepus didactylus', 'Two-toed sloth'], ['Ramphastos toco', 'Toco toucan'],
    ['Anodorhynchus hyacinthinus', 'Hyacinth macaw'], ['Coendou prehensilis', 'Prehensile-tailed porcupine'],
    ['Atta cephalotes', 'Leaf-cutter ant'], ['Dendrobates tinctorius', 'Dyeing poison frog'],
    ['Paracheirodon innesi', 'Neon tetra'], ['Lithobates catesbeianus', 'American bullfrog'], ['Pterophyllum scalare', 'Freshwater angelfish'],
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
