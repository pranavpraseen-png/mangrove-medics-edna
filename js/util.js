// Small shared helpers.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export const tubeId = n => `CK-T${String(n).padStart(3, '0')}`;

export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
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
