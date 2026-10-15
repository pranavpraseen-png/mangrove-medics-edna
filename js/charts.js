// Lightweight SVG charts in the console's style.
import { esc } from './util.js';

// Horizontal bars: [{label, value, note, color}]
export function hbars(data, { unit = '', max } = {}) {
  if (!data.length) return '<div class="empty">No data yet</div>';
  const m = max || Math.max(...data.map(d => d.value), 1);
  const rowH = 34, W = 640, labelW = 220, barW = W - labelW - 70;
  const H = data.length * rowH + 8;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">
  ${data.map((d, i) => {
    const y = i * rowH + 6, w = Math.max(3, (d.value / m) * barW);
    return `<g class="hb" style="--d:${i * 60}ms">
      <text x="0" y="${y + 17}" fill="#EEF3EF" style="font-size:13px">${esc(d.label)}</text>
      <rect x="${labelW}" y="${y + 4}" width="${barW}" height="18" rx="9" fill="#1F3D47" opacity=".6"/>
      <rect class="hb-bar" x="${labelW}" y="${y + 4}" width="${w}" height="18" rx="9" fill="${d.color || '#3FE0B0'}"/>
      <text x="${labelW + w + 8}" y="${y + 17}" style="font-size:12px">${esc(String(d.value))}${unit}${d.note ? ` · ${esc(d.note)}` : ''}</text>
    </g>`;
  }).join('')}
  </svg>`;
}

// Vertical columns by site with species richness.
export function columns(data, { unit = '' } = {}) {
  if (!data.length) return '<div class="empty">No data yet</div>';
  const W = 640, H = 240, pad = 34, m = Math.max(...data.map(d => d.value), 1);
  const bw = Math.min(70, (W - pad * 2) / data.length - 18);
  const step = (W - pad * 2) / data.length;
  const ticks = [0, Math.ceil(m / 2), m];
  return `<svg viewBox="0 0 ${W} ${H + 40}" role="img" aria-label="Column chart">
    ${ticks.map(t => { const y = H - (t / m) * (H - 20); return `<line x1="${pad}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="#1F3D47"/><text x="${pad - 8}" y="${y + 4}" text-anchor="end">${t}</text>`; }).join('')}
    ${data.map((d, i) => {
      const h = (d.value / m) * (H - 20), x = pad + i * step + (step - bw) / 2;
      return `<rect class="col-bar" x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="8" fill="url(#cg)"/>
      <text x="${x + bw / 2}" y="${H - h - 8}" text-anchor="middle" fill="#EEF3EF" style="font-size:14px;font-weight:700">${d.value}${unit}</text>
      <text x="${x + bw / 2}" y="${H + 20}" text-anchor="middle">${esc(d.label.length > 16 ? d.label.slice(0, 15) + '…' : d.label)}</text>`;
    }).join('')}
    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3FE0B0"/><stop offset="1" stop-color="#1f8e7a"/></linearGradient></defs>
  </svg>`;
}

// The 8-step mission ring.
export function missionRing(active = 0, done = 0) {
  const names = ['Self-check', 'Drive', 'Test water', 'Prime', 'Sample', 'Seal', 'Log', 'Rinse'];
  const cx = 150, cy = 150, r = 112, gap = 0.06;
  const arc = (a0, a1) => {
    const p = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const segs = names.map((n, i) => {
    const a0 = -Math.PI / 2 + i * (Math.PI / 4) + gap, a1 = a0 + Math.PI / 4 - gap * 2;
    const cls = i + 1 === active ? 'on' : (i + 1 < active || i + 1 <= done ? 'done' : '');
    const am = (a0 + a1) / 2, lx = cx + (r + 0) * Math.cos(am), ly = cy + (r + 0) * Math.sin(am);
    return `<path class="seg ${cls}" d="${arc(a0, a1)}"/><text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" style="font-size:11px;font-weight:700;fill:${cls === 'on' ? '#05231b' : '#EEF3EF'}">${i + 1}</text>`;
  }).join('');
  const label = active ? names[active - 1] : 'Ready';
  return `<svg class="ring" viewBox="0 0 300 300" role="img" aria-label="Mission step ${active || 0} of 8: ${label}">
    <circle cx="150" cy="150" r="78" fill="rgba(63,224,176,.06)" stroke="#1F3D47"/>
    ${segs}
    <text x="150" y="140" text-anchor="middle" style="font-size:12px;fill:#A9C2C8;letter-spacing:.15em">STEP ${active || '–'} / 8</text>
    <text x="150" y="170" text-anchor="middle" style="font-size:22px;font-weight:700">${label}</text>
  </svg>`;
}
