// Small shared helpers.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Make outside data safe: device messages, imported backups, lab CSVs and saved state.
// Strips characters that could break out of HTML, blocks prototype-pollution keys, caps sizes.
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function clean(v, depth = 0) {
  if (depth > 8) return null;
  if (typeof v === 'string') return v.replace(/[<>"`\u0000-\u001f\u007f]/g, '').slice(0, 500);
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean' || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 5000).map(x => clean(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).slice(0, 200)) if (!BAD_KEYS.has(k)) o[clean(k)] = clean(v[k], depth + 1);
    return o;
  }
  return null;
}

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

// Cartridge counter → label. Once a mission is planned, each cartridge number is
// mapped to its real sample ID (CK-YYYYMMDD-SITE-SEAT) so every screen shows the same name.
// Firmware v3 reports `tube` = seat (1–8); older messages used a running cartridge number. The store
// registers a resolver that turns either into the real sample ID of the current mission.
const tubeNames = new Map();
let tubeResolver = null;
export const nameTube = (tube, id) => { if (tube && id) tubeNames.set(+tube, id); };
export const setTubeResolver = fn => { tubeResolver = fn; };
export const tubeId = n => (tubeResolver && tubeResolver(+n)) || tubeNames.get(+n) || `Seat ${(((+n || 1) - 1) % 8) + 1}`;

// Sample IDs: CK-YYYYMMDD-SITE-SEAT, e.g. CK-20261206-AQ01-S3 (docs/DECISIONS.md).
export const ymd = (d = new Date()) => {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10).replace(/-/g, '');
  const x = new Date(d); return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`;
};
export const todayISO = () => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export const siteCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'SITE';  // firmware: letters/digits, max 8
export const sampleId = (date, code, seat) => `CK-${ymd(date)}-${siteCode(code)}-S${seat}`;
export const SAMPLE_ID_RE = /CK-\d{8}-[A-Z0-9]{1,8}-S[1-8]/;
// Pull a sample ID out of whatever a scanner or keyboard gives us.
export const parseSampleId = text => (String(text || '').toUpperCase().replace(/\s+/g, '').match(SAMPLE_ID_RE) || [''])[0];

// Coordinates for sensitive species are shown on a ~10 km grid (0.1°), per GBIF guidance (Q147).
export const roundCoord = (v, dp = 1) => (v == null || v === '' || !Number.isFinite(+v)) ? null : +(+v).toFixed(dp);

// localStorage that never throws (private mode, blocked storage, quota).
export const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const fmtNum = (v, d = 1) => (v == null || Number.isNaN(+v)) ? '—' : (+v).toFixed(d);

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function toast(msg, kind = 'ok', sub = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="dot"></span><div><b>${esc(msg)}</b>${sub ? `<div class="muted" style="font-size:13px">${esc(sub)}</div>` : ''}</div>`;
  box.appendChild(el);
  if (window.gsap && !reducedMotion()) gsap.from(el, { x: 40, opacity: 0, duration: .4, ease: 'power3.out' });
  setTimeout(() => {
    if (window.gsap && !reducedMotion()) gsap.to(el, { opacity: 0, x: 40, duration: .35, onComplete: () => el.remove() });
    else el.remove();
  }, 4200);
}

export function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function toCSV(rows, cols) {
  const q = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n');
}

export function parseCSV(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  // Lines starting with # are comments (used to label demo files).
  text = text.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function animateIn(root) {
  if (!window.gsap || reducedMotion()) return;
  const items = root.querySelectorAll('.card, .anim');
  if (!items.length) return;
  gsap.fromTo(items, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: .55, stagger: .05, ease: 'power3.out', clearProps: 'transform' });
}

export function countUp(el, to, dec = 0) {
  if (!el) return;
  if (!window.gsap || reducedMotion()) { el.textContent = (+to).toFixed(dec); return; }
  const o = { v: 0 };
  gsap.to(o, { v: +to, duration: 1.2, ease: 'power2.out', onUpdate: () => { el.textContent = o.v.toFixed(dec); } });
}

// Card spotlight follows the pointer.
export function spotlight(root) {
  root.querySelectorAll('.card').forEach(c => {
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', `${e.clientX - r.left}px`);
      c.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });
}

export const icons = {
  tube: '<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v13a2 2 0 0 0 4 0V3"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/></svg>',
  dna: '<svg viewBox="0 0 24 24"><path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12s10 6 10 6M8 7h8M8 17h8"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 10l6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
};
