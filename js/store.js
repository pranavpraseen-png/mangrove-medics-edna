// App state: sites, mission plan and rules, samples, lab results, watchlist, custody batches.
// Everything lives in localStorage (works with no internet); export/import as JSON or CSV.
// Agreed field design: docs/DECISIONS.md (seat 1 = field blank, seats 2–7 = 6 samples, seat 8 = flush).
// Pod messages follow protocol v3 (firmware/README.md → "Console protocol").
import { clean, uid, tubeId, nameTube, setTubeResolver, sampleId, siteCode, todayISO, ls, roundCoord, parseSampleId } from './util.js';

const KEY = 'ck-console-v4';
const OLD_KEYS = ['edna-console-v3'];
const listeners = new Set();

export const STATUSES = ['Collected', 'Shipped', 'At lab', 'Results in'];
export const STOP_REASONS = {
  VOLUME: 'Target volume reached',
  TIME: 'Time limit (20 min)',
  CLOG: 'Flow too low — filter clogged',
  AIR: 'Air in line — intake out of water',
  ABORT: 'Stopped by operator',
};
export const SEATS = 8;
export const BLANK_SEAT = 1;
export const FLUSH_SEAT = 8;

function defaults() {
  return {
    version: 1,
    schema: 4,
    settings: {
      deviceName: 'EDNA-01',
      flowMlMin: 85,            // with a filter (assumed 60–100 mL/min; calibrate by 8 Nov)
      pumpCal: [],              // [{seconds, ml}]
      ph: { v7: 2.50, v4: 3.05 },
      ntuZeroV: 4.20,
      carousel: { seats: 8, stepsPerSeat: 400 },
      simSpeed: 10,
    },
    // Stop at 1 L, 20 min, or flow below 20 mL/min. A sample counts only if ≥ 250 mL.
    rules: { targetMl: 1000, blankMl: 1000, flushMl: 250, minValidMl: 250, maxMin: 20, minFlowMlMin: 20, ethanolMl: 2 },
    schedule: { mode: 'now', time: '21:30', tide: '' },
    // What the next mission will do: 2 sites × 3 replicates (or 1 site × 6).
    plan: { date: todayISO(), mode: '2x3', siteA: 'site_gp1', siteB: 'site_gp2', operator: '' },
    sites: [
      { id: 'site_gp1', code: 'GP01', name: 'Green Planet stream (demo)', lat: 25.18412, lon: 55.25563, protected: true, notes: 'Indoor rainforest — written permission needed' },
      { id: 'site_gp2', code: 'GP02', name: 'Green Planet pool (demo)', lat: 25.18431, lon: 55.25588, protected: true, notes: 'Flooded-forest pool' },
      { id: 'site_aq1', code: 'AQ01', name: 'School test tank (demo)', lat: 25.23500, lon: 55.31700, protected: false, notes: 'Practice site' },
    ],
    samples: [],
    results: [],      // [{tube: sampleId, species, common, reads}] (key kept as `tube` for older screens)
    reported: [],     // sample IDs the lab has reported on (including "nothing found")
    watchlist: [
      { species: 'Lithobates catesbeianus', common: 'American bullfrog (example entry)', kind: 'invasive', note: 'Example only — confirm your watchlist with experts' },
      { species: 'Arapaima gigas', common: 'Arapaima (example entry)', kind: 'sensitive', note: 'Example only — locations shown on a 10 km grid' },
      { species: 'Dendrobates tinctorius', common: 'Dyeing poison frog (example entry)', kind: 'sensitive', note: 'Collected for the pet trade — locations rounded' },
    ],
    missions: [],
    batches: [],      // chain-of-custody batches
    confirm: {},      // per cartridge (global number): {id, at, by}
    nextTube: 1,
  };
}

function migrate(s) {
  // v3 → v4: old samples had no role / seat / stop reason.
  (s.samples || []).forEach(x => {
    if (!x.role) x.role = x.blank ? 'blank' : 'sample';
    if (!x.seat && x.tube) x.seat = (x.tube - 1) % SEATS + 1;
    if (!x.stop_reason) x.stop_reason = x.clog ? 'CLOG' : 'VOLUME';
    if (x.valid == null) x.valid = x.role === 'blank' || (+x.ml || 0) >= 250;
  });
  delete s.rules;
  return s;
}

function load() {
  const d = defaults();
  try {
    let raw = ls.get(KEY), old = false;
    if (!raw) for (const k of OLD_KEYS) { raw = ls.get(k); if (raw) { old = true; break; } }
    if (raw) {
      let s = clean(JSON.parse(raw)) || {};
      if (old || !s.schema) s = migrate(s);
      if (s.settings && s.settings.pumpMlPerS && !s.settings.flowMlMin) s.settings.flowMlMin = Math.round(s.settings.pumpMlPerS * 60);
      if (s.rules) { if (s.rules.maxPumpS && !s.rules.maxMin) s.rules.maxMin = Math.round(s.rules.maxPumpS / 60); ['maxPumpS', 'primeMl', 'rinseMl'].forEach(k => delete s.rules[k]); }
      return {
        ...d, ...s, schema: 4,
        settings: { ...d.settings, ...s.settings, carousel: { ...d.settings.carousel, ...(s.settings || {}).carousel } },
        rules: { ...d.rules, ...s.rules }, plan: { ...d.plan, ...s.plan },
        reported: s.reported || [], batches: s.batches || [], confirm: s.confirm || {},
      };
    }
  } catch (e) { /* storage blocked or corrupt — start fresh */ }
  return d;
}

export const state = load();
nameAll();

let saveFailed = false;
export function save() {
  const ok = ls.set(KEY, JSON.stringify(state));
  if (!ok && !saveFailed) { saveFailed = true; console.warn('Could not save to this browser — export a backup.'); }
  if (ok) saveFailed = false;
  listeners.forEach(fn => { try { fn(state); } catch (e) { console.warn(e); } });
}
export const storageOK = () => !saveFailed;
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
  let s = clean(JSON.parse(text));
  if (!s || s.version !== 1) throw new Error('Not an eDNA Collector backup file');
  if (!s.schema) s = migrate(s);
  const d = defaults();
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, d, s, { schema: 4, rules: { ...d.rules, ...s.rules }, plan: { ...d.plan, ...s.plan } });
  nameAll();
  save();
}

/* ───────────── Sites ───────────── */
export const siteById = id => state.sites.find(s => s.id === id);
export function nextSiteCode(name = '') {
  const letters = (String(name).toUpperCase().replace(/[^A-Z]/g, '') + 'XX').slice(0, 2);
  for (let n = 1; n < 100; n++) { const c = `${letters}${String(n).padStart(2, '0')}`; if (!state.sites.some(s => s.code === c)) return c; }
  return letters + '99';
}
export function addSite(site) {
  const code = siteCode(site.code || nextSiteCode(site.name));
  state.sites.push({ id: uid('site'), protected: false, notes: '', ...site, code });
  save();
}
export function updateSite(id, patch) { Object.assign(state.sites.find(s => s.id === id) || {}, patch); save(); }
export function removeSite(id) { state.sites = state.sites.filter(s => s.id !== id); save(); }
export function moveSite(id, dir) {
  const i = state.sites.findIndex(s => s.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= state.sites.length) return;
  [state.sites[i], state.sites[j]] = [state.sites[j], state.sites[i]];
  save();
}

/* ───────────── Mission layout ─────────────
   Seat 1 = field blank (run first), seats 2–7 = 6 real samples, seat 8 = empty flush seat.
   2×3: seats 2–4 = site A reps 1–3, seats 5–7 = site B reps 1–3.  1×6: seats 2–7 = site A reps 1–6. */
export function carouselStart(tube = state.nextTube) { return Math.floor((Math.max(1, tube) - 1) / SEATS) * SEATS + 1; }
export function freshCarouselStart() {
  const base = carouselStart();
  const used = state.samples.some(s => s.tube >= base && s.tube < base + SEATS) || state.missions.some(m => m.tubeStart === base);
  return used ? base + SEATS : base;
}

export function planLayout(plan = state.plan, tubeStart = freshCarouselStart()) {
  const A = siteById(plan.siteA), B = plan.mode === '1x6' ? A : siteById(plan.siteB);
  if (!A || !B) return [];
  // The firmware names the blank CK-YYYYMMDD-BLANK-S1; samples use the site code.
  const seat = (n, role, site, rep) => ({
    seat: n, tube: tubeStart + n - 1, role, rep,
    site: site?.id || '', siteCode: role === 'blank' ? 'BLANK' : site?.code || '', siteName: site?.name || '', lat: site?.lat, lon: site?.lon,
    id: role === 'flush' ? '' : sampleId(plan.date, role === 'blank' ? 'BLANK' : site.code, n),
  });
  const L = [seat(BLANK_SEAT, 'blank', A, 0)];
  for (let i = 0; i < 6; i++) {
    const second = plan.mode !== '1x6' && i >= 3;
    L.push(seat(i + 2, 'sample', second ? B : A, plan.mode === '1x6' ? i + 1 : (i % 3) + 1));
  }
  L.push(seat(FLUSH_SEAT, 'flush', null, 0));
  return L;
}

// Order the Pod runs the seats: blank → flush @A → A reps → flush @B → B reps.
export function runOrder(layout) {
  const by = n => layout.find(x => x.seat === n);
  const samples = layout.filter(x => x.role === 'sample');
  const out = [by(BLANK_SEAT)];
  let last = null;
  samples.forEach(s => {
    if (s.site !== last) { out.push({ ...by(FLUSH_SEAT), site: s.site, siteCode: s.siteCode, siteName: s.siteName, lat: s.lat, lon: s.lon }); last = s.site; }
    out.push(s);
  });
  return out;
}

export const activeMission = () => state.missions.find(m => m.status === 'running' && m.layout) || null;
export const missionById = id => state.missions.find(m => m.id === id);
export function layoutEntry(tube, missionId) {
  const ms = missionId ? [missionById(missionId)] : state.missions.slice().reverse();
  for (const m of ms) { const e = m?.layout?.find(x => x.tube === tube); if (e) return { ...e, mission: m.id }; }
  return null;
}
export function nameAll() {
  state.missions.forEach(m => (m.layout || []).forEach(e => e.id && nameTube(e.tube, e.id)));
  state.samples.forEach(s => s.tube && nameTube(s.tube, s.id));
}
// tubeId(n): n ≤ 8 is a seat of the running (or last) mission — firmware v3 sends tube = seat.
setTubeResolver(n => {
  if (!n) return '';
  const m = activeMission() || [...state.missions].reverse().find(x => x.layout);
  if (n <= 8) {
    const e = m?.layout?.find(x => x.seat === n);
    if (e) return e.id || 'Seat 8 · flush';
    const p = planLayout(state.plan, freshCarouselStart()).find(x => x.seat === n);
    return p ? (p.id || 'Seat 8 · flush') : '';
  }
  return '';
});

/* ───────────── Samples (one per sealed cartridge) ─────────────
   Accepts the firmware v3 record (sample_id, role BLANK/SAMPLE/FLUSH, site = code, replicate, volume_mL,
   stop_reason, valid, lat/lon, hdop, loc_source GPS/MANUAL/MISSION/NONE, temp_C, turbidity_NTU, pH, …)
   and still understands v2 keys (tube, ml, blank, clog, ph, ntu, temp). FLUSH records are kept on the mission. */
const truthy = v => v === true || v === 1 || /^(1|true|yes)$/i.test(String(v ?? ''));
const num = v => v != null && v !== '' && v !== 'NA' && Number.isFinite(+v) ? +v : null;
const LOC = { GPS: 'gps', MANUAL: 'manual', MISSION: 'plan', NONE: 'none' };
export const siteByCode = code => state.sites.find(s => s.code === code);

export function addSample(msg, extra = {}) {
  const role = String(msg.role || (truthy(msg.blank) ? 'blank' : 'sample')).toLowerCase();
  const sid = parseSampleId(msg.sample_id || msg.id);
  const m = missionById(msg.mission) || (msg.mission ? null : activeMission());
  const L = m?.layout || [];
  const seat = +msg.seat || (msg.tube && +msg.tube <= 8 ? +msg.tube : msg.tube ? (msg.tube - 1) % SEATS + 1 : 0);
  const e = L.find(x => sid && x.id === sid) || L.find(x => x.seat === seat && x.role === role) || layoutEntry(+msg.tube > 8 ? +msg.tube : -1, msg.mission) || {};

  if (role === 'flush') {
    if (m) { (m.flushes = m.flushes || []).push({ site: msg.site, ml: num(msg.volume_mL ?? msg.ml), stop: msg.stop_reason, valid: truthy(msg.valid), ts: Date.parse(msg.end_time || '') || Date.now() }); save(); }
    return { flush: true, site: msg.site, siteName: msg.site_name || msg.name || '', ml: num(msg.volume_mL ?? msg.ml) ?? 0, valid: truthy(msg.valid) };
  }

  const tube = e.tube || (m?.tubeStart ? m.tubeStart + seat - 1 : (+msg.tube > 8 ? +msg.tube : 0));
  const conf = (tube && state.confirm[tube]) || {};
  const ml = Math.round(num(msg.volume_mL ?? msg.ml) ?? 0);
  const target = num(msg.target_mL ?? msg.target) || (role === 'blank' ? state.rules.blankMl : state.rules.targetMl);
  const stop = String(msg.stop_reason || msg.stop || (truthy(msg.clog) ? 'CLOG' : (ml >= target * 0.98 ? 'VOLUME' : 'TIME'))).toUpperCase();
  // Location: what the Pod used (GPS average / manual setloc / mission site) — older firmware: unknown.
  let lat = num(msg.lat), lon = num(msg.lon);
  let locSource = LOC[String(msg.loc_source || '').toUpperCase()] || (lat != null ? (msg.hdop === 'manual' ? 'manual' : 'pod') : 'plan');
  if (lat == null || lon == null) { lat = e.lat ?? null; lon = e.lon ?? null; if (locSource !== 'none' || lat != null) locSource = lat != null ? 'plan' : 'none'; }
  const code = role === 'blank' ? 'BLANK' : (msg.site && String(msg.site).toUpperCase() !== 'BLANK' ? String(msg.site) : e.siteCode || '');
  const site = siteById(e.site) || siteByCode(code) || siteById(msg.site) || {};
  const s = {
    id: sid || e.id || (tube ? tubeId(tube) : `UNKNOWN-${uid('s')}`),
    tube, seat: seat || e.seat || 0,
    mission: msg.mission || e.mission || m?.id || '',
    role, blank: role === 'blank',
    replicate: num(msg.replicate ?? msg.rep) ?? e.rep ?? 0,
    site: site.id || e.site || code, siteCode: role === 'blank' ? 'BLANK' : (code || site.code || ''),
    siteName: role === 'blank' ? `Field blank${site.name ? ` · ${site.name}` : ''}` : (msg.site_name || e.siteName || site.name || msg.name || code),
    lat, lon, hdop: msg.hdop ?? null, locSource,
    gpsFix: locSource === 'gps' || locSource === 'pod', manualLocation: locSource === 'manual' || locSource === 'plan',
    locLabel: msg.loc_label || '',
    ts: Date.parse(msg.end_time || '') || num(msg.ts) || Date.now(),
    startTime: msg.start_time || '', endTime: msg.end_time || '',
    ml, target, stop_reason: STOP_REASONS[stop] ? stop : 'TIME',
    valid: msg.valid != null && msg.valid !== '' ? truthy(msg.valid) : (role === 'blank' ? ml >= state.rules.minValidMl : ml >= state.rules.minValidMl),
    volumeSource: msg.volume_source || '', pumpS: num(msg.pump_s),
    ph: num(msg.pH ?? msg.ph), ntu: num(msg.turbidity_NTU ?? msg.ntu), temp: num(msg.temp_C ?? msg.temp),
    batteryV: num(msg.battery_V), savedSd: msg.saved_sd, savedFlash: msg.saved_flash, fw: msg.fw || '',
    clog: stop === 'CLOG',
    idConfirmed: !!conf.at, collectedBy: conf.by && conf.by !== 'auto' ? conf.by : (state.plan.operator || ''),
    seal: msg.seal || '', status: 'Collected', notes: '',
    demo: !!m?.demo,
    ...extra,
  };
  if (s.tube) nameTube(s.tube, s.id);
  const prev = state.samples.find(x => x.id === s.id);
  if (prev) { s.seal = prev.seal || s.seal; s.status = prev.status === 'Collected' ? s.status : prev.status; }
  state.samples = state.samples.filter(x => x.id !== s.id);
  state.samples.push(s);
  if (s.tube) state.nextTube = Math.max(state.nextTube, s.tube + 1);
  save();
  return s;
}

// Rows from the Pod's samples.csv (`records` command) or a lab/demo CSV → sample messages.
export function rowToRecord(r) {
  const role = String(r.role || '').toUpperCase() || (/-S1$/.test(r.sample_id || '') ? 'BLANK' : 'SAMPLE');
  const man = truthy(r.manual_location);
  return {
    sample_id: r.sample_id || r.tube_id, mission: r.mission, seat: r.seat, role, site: r.site_code || r.site, site_name: r.site_name,
    replicate: r.replicate, start_time: r.start_time, end_time: r.end_time || r.collected_utc, volume_mL: r.volume_ml, target_mL: r.target_ml,
    stop_reason: r.stop_reason, valid: r.valid, volume_source: r.volume_source, pump_s: r.pump_s, lat: r.lat, lon: r.lon, hdop: r.hdop,
    loc_source: r.loc_source || (r.manual_location != null ? (man ? 'MANUAL' : 'GPS') : ''), temp_C: r.temp_c, turbidity_NTU: r.turbidity_ntu ?? r.ntu, pH: r.ph,
    battery_V: r.battery_v, fw: r.fw, seal: r.seal,
  };
}

export function confirmSeat(tube, data) { state.confirm[tube] = { at: Date.now(), ...data }; save(); }
export const blankDone = missionId => state.samples.some(s => s.mission === missionId && s.role === 'blank');

const CSV_COLS = ['sample_id', 'mission', 'role', 'site_code', 'site_name', 'replicate', 'seat', 'collected_utc', 'lat', 'lon', 'manual_location', 'loc_source', 'hdop', 'volume_mL', 'target_mL', 'stop_reason', 'valid', 'volume_source', 'pH', 'turbidity_NTU', 'temp_C', 'seal', 'collected_by', 'id_scanned', 'status'];
export function sampleRows(list = state.samples) {
  return list.map(s => ({
    sample_id: s.id, mission: s.mission, role: s.role, site_code: s.siteCode, site_name: s.siteName,
    replicate: s.role === 'sample' ? s.replicate : '', seat: s.seat, collected_utc: new Date(s.ts).toISOString(),
    lat: s.lat ?? '', lon: s.lon ?? '', manual_location: s.manualLocation ? 'yes' : 'no',
    loc_source: { gps: 'GPS', manual: 'MANUAL', plan: 'MISSION', pod: 'POD', none: 'NONE' }[s.locSource] || '', hdop: s.hdop ?? '',
    volume_mL: s.ml, target_mL: s.target, stop_reason: s.stop_reason, valid: s.valid ? 'yes' : 'no', volume_source: s.volumeSource || '',
    pH: s.ph ?? '', turbidity_NTU: s.ntu ?? '', temp_C: s.temp ?? '', seal: s.seal || '', collected_by: s.collectedBy || '', id_scanned: s.idConfirmed ? 'yes' : 'no', status: s.status,
  }));
}
export const sampleCols = CSV_COLS;

/* ───────────── Lab results ─────────────
   CSV columns: sample_id (or tube_id), species, common_name, reads.
   A row with no species (or "none") means the lab tested that sample and found nothing.
   Extra columns (role, site_code, site_name, replicate, seat, volume_mL, stop_reason, lat, lon, collected_utc, mission)
   let a lab file add samples that are not in this registry yet (e.g. the demo file). */
export function importResults(rows) {
  const out = [], reported = new Set();
  let created = 0;
  rows.slice(0, 20000).forEach(raw => {
    const r = clean(raw) || {};
    const id = parseSampleId(r.sample_id || r.tube_id || r.tube) || String(r.sample_id || r.tube_id || r.tube || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!id) return;
    reported.add(id);
    if (!state.samples.some(s => s.id === id) && (r.role || r.site_code)) { createFromRow(id, r); created++; }
    const species = String(r.species || '').trim();
    const reads = Math.max(0, Math.min(1e9, Math.round(+(r.reads || r.count || 0)) || 0));
    if (!species || /^\(?none\)?$/i.test(species) || reads === 0) return;
    out.push({ tube: id, species, common: String(r.common_name || r.common || ''), reads });
  });
  const dedup = new Map(out.map(r => [`${r.tube}|${r.species}`, r]));
  state.results = state.results.filter(r => !reported.has(r.tube)).concat([...dedup.values()]);
  state.reported = [...new Set([...state.reported, ...reported])];
  state.samples.forEach(s => { if (reported.has(s.id)) s.status = 'Results in'; });
  save();
  const n = dedup.size;
  importResults.last = { detections: n, samples: reported.size, created };
  return n;
}

function createFromRow(id, r) {
  const rec = rowToRecord({ ...r, sample_id: id });
  const code = rec.site;
  if (code && String(rec.role).toUpperCase() !== 'BLANK' && !siteByCode(code) && r.lat && r.lon) {
    state.sites.push({ id: uid('site'), code, name: r.site_name || code, lat: +r.lat, lon: +r.lon, protected: false, notes: 'Added from a lab file' });
  }
  if (!rec.mission) { const m = id.match(/^CK-(\d{8})-/); rec.mission = m ? `CK-${m[1]}` : ''; }
  addSample(rec, { status: 'Results in', idConfirmed: true, demo: /demo/i.test(r.data_type || r.note || ''), collectedBy: r.collected_by || '' });
}

// Fictional demo results for the samples in the registry: realistic replicate patterns
// (some species in 3/3, some 2/3, some only 1/3), clean blanks.
export function demoResults() {
  const pool = [
    ['Choloepus didactylus', 'Linnaeus’s two-toed sloth'], ['Ramphastos toco', 'Toco toucan'],
    ['Arapaima gigas', 'Arapaima'], ['Pygocentrus nattereri', 'Red-bellied piranha'],
    ['Dendrobates tinctorius', 'Dyeing poison frog'], ['Paracheirodon innesi', 'Neon tetra'],
    ['Pterophyllum scalare', 'Freshwater angelfish'], ['Iguana iguana', 'Green iguana'],
    ['Lithobates catesbeianus', 'American bullfrog'], ['Potamotrygon motoro', 'Ocellate river stingray'],
  ];
  const rows = [];
  const visits = new Map();
  state.samples.forEach(s => {
    if (s.role === 'blank') { rows.push({ sample_id: s.id, species: '', reads: 0 }); return; }
    const k = `${s.mission}|${s.site}`;
    if (!visits.has(k)) visits.set(k, []);
    visits.get(k).push(s);
  });
  let v = 0;
  visits.forEach(list => {
    list.sort((a, b) => a.replicate - b.replicate);
    const off = v++ * 3;
    // pattern per species: which replicate indexes detect it
    const patterns = [[0, 1, 2], [0, 1, 2], [0, 2], [1, 2], [1], [0, 1, 2]];
    patterns.forEach((pat, i) => {
      const [sp, common] = pool[(off + i) % pool.length];
      pat.forEach(j => {
        const s = list[j];
        if (!s || !s.valid) return;
        rows.push({ sample_id: s.id, species: sp, common_name: common, reads: 180 + ((s.seat * 131 + i * 977 + off * 37) % 4200) });
      });
    });
    list.forEach(s => { if (!rows.some(r => r.sample_id === s.id)) rows.push({ sample_id: s.id, species: '', reads: 0 }); });
  });
  return importResults(rows);
}

/* ───────────── Results rule ─────────────
   "Confirmed" = detected in 2–3 of 3 replicates with a clean field blank.
   "Possible"  = 1 of 3.  "Not detected" is not proof of absence.
   If the blank shows DNA, the whole site visit is flagged unreliable. */
const lower = s => String(s || '').toLowerCase();
export const isSensitive = sp => state.watchlist.some(w => w.kind === 'sensitive' && lower(w.species) === lower(sp));
export const isInvasive = sp => state.watchlist.some(w => w.kind !== 'sensitive' && lower(w.species) === lower(sp));

export function blankState(missionId) {
  const b = state.samples.find(s => s.mission === missionId && s.role === 'blank');
  if (!b) return { state: 'missing', sample: null, species: [] };
  const hits = state.results.filter(r => r.tube === b.id && r.reads > 0);
  if (hits.length) return { state: 'contaminated', sample: b, species: hits.map(r => r.species) };
  if (state.reported.includes(b.id) || b.status === 'Results in') return { state: 'clean', sample: b, species: [] };
  return { state: 'pending', sample: b, species: [] };
}

export function siteResults() {
  const visits = new Map();
  state.samples.filter(s => s.role === 'sample').forEach(s => {
    const k = `${s.mission}|${s.site || s.siteCode}`;
    if (!visits.has(k)) visits.set(k, { key: k, mission: s.mission, site: s.site, siteCode: s.siteCode, siteName: s.siteName, reps: [], ts: s.ts });
    const v = visits.get(k); v.reps.push(s); v.ts = Math.min(v.ts, s.ts);
  });
  const out = [];
  visits.forEach(v => {
    v.reps.sort((a, b) => a.replicate - b.replicate);
    const valid = v.reps.filter(s => s.valid);
    const site = siteById(v.site) || {};
    const lats = valid.map(s => s.lat).filter(x => x != null), lons = valid.map(s => s.lon).filter(x => x != null);
    v.lat = lats.length ? lats.reduce((a, b) => a + b) / lats.length : site.lat ?? null;
    v.lon = lons.length ? lons.reduce((a, b) => a + b) / lons.length : site.lon ?? null;
    v.n = valid.length;
    v.invalid = v.reps.length - valid.length;
    v.reported = valid.filter(s => state.reported.includes(s.id) || s.status === 'Results in').length;
    v.blank = blankState(v.mission);
    const sp = new Map();
    valid.forEach(s => state.results.filter(r => r.tube === s.id && r.reads > 0).forEach(r => {
      const o = sp.get(r.species) || { species: r.species, common: r.common, hits: 0, reads: 0, reps: [] };
      o.hits++; o.reads += r.reads; o.reps.push(s.replicate); if (!o.common && r.common) o.common = r.common;
      sp.set(r.species, o);
    }));
    v.species = [...sp.values()].map(o => {
      o.n = v.n;
      o.inBlank = v.blank.species.some(b => lower(b) === lower(o.species));
      o.sensitive = isSensitive(o.species);
      o.invasive = isInvasive(o.species);
      if (v.blank.state === 'contaminated') o.result = 'unreliable';
      else if (o.hits >= 2 && v.blank.state === 'clean') o.result = 'confirmed';
      else if (o.hits >= 2) o.result = 'pending-blank';
      else o.result = 'possible';
      return o;
    }).sort((a, b) => b.hits - a.hits || b.reads - a.reads);
    v.sensitive = v.species.some(o => o.sensitive);
    out.push(v);
  });
  // Species found at another site in the same mission but not here → "not detected" rows.
  out.forEach(v => {
    const others = new Map();
    out.filter(o => o !== v && o.mission === v.mission).forEach(o => o.species.forEach(s => others.set(s.species, s.common)));
    v.missing = [...others].filter(([sp]) => !v.species.some(s => s.species === sp)).map(([species, common]) => ({ species, common, hits: 0, n: v.n, result: 'not-detected' }));
  });
  return out.sort((a, b) => b.ts - a.ts);
}

// Coordinates to show for a site visit: rounded to ~10 km (0.1°) if any sensitive species was found there.
export function displayCoords(v, sensitive = v.sensitive) {
  if (v.lat == null || v.lon == null) return { text: '—', rounded: false };
  if (sensitive) return { lat: roundCoord(v.lat, 1), lon: roundCoord(v.lon, 1), text: `${roundCoord(v.lat, 1).toFixed(1)}, ${roundCoord(v.lon, 1).toFixed(1)}`, rounded: true };
  return { lat: v.lat, lon: v.lon, text: `${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}`, rounded: false };
}

/* ───────────── Chain of custody ───────────── */
export function createBatch(ids, info = {}) {
  const d = new Date();
  const n = state.batches.filter(b => b.created && new Date(b.created).toDateString() === d.toDateString()).length + 1;
  const b = {
    id: `CK-B${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${n}`,
    created: Date.now(), samples: [...ids], lab: info.lab || '', preservation: info.preservation || '≥95% ethanol (ethanol shipped with filter)',
    transport: info.transport || 'Cool box with ice packs, dark', handovers: [],
  };
  state.batches.push(b);
  save();
  return b;
}
export function addHandover(batchId, h) {
  const b = state.batches.find(x => x.id === batchId); if (!b) return;
  b.handovers.push({ from: h.from || '', to: h.to || '', ts: h.ts || Date.now(), condition: h.condition || '', seals: h.seals || 'intact' });
  save();
}

/* ───────────── Alerts ───────────── */
export function alerts() {
  const out = [];
  const seenBlank = new Set();
  state.samples.forEach(s => {
    if (s.role === 'blank' && !seenBlank.has(s.mission)) {
      seenBlank.add(s.mission);
      const b = blankState(s.mission);
      if (b.state === 'contaminated') out.push({ level: 'crit', title: `Blank ${s.id} shows DNA`, text: `Blank contaminated – results from this mission are unreliable (${b.species.slice(0, 3).join(', ')}). Re-clean the lines and check gloves, tubing and the lab.` });
    }
    if (s.role === 'sample' && !s.valid) out.push({ level: 'warn', title: `${s.id} not valid`, text: `Only ${Math.round(s.ml)} mL filtered (${STOP_REASONS[s.stop_reason] || s.stop_reason}). A sample counts only if ≥ ${state.rules.minValidMl} mL.` });
    else if (s.stop_reason === 'AIR') out.push({ level: 'warn', title: `${s.id} stopped: air in line`, text: `Intake came out of the water at ${Math.round(s.ml)} mL.` });
  });
  siteResults().forEach(v => v.species.forEach(o => {
    if (o.invasive && o.result !== 'unreliable') out.push({ level: 'crit', title: `Watchlist species at ${v.siteName}`, text: `${o.species}${o.common ? ` (${o.common})` : ''} detected in ${o.hits} of ${o.n} replicates.` });
  }));
  return out;
}

export { roundCoord };
