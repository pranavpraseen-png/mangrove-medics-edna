// Console motion: page wipes, headline reveals, scroll reveals, a cursor ring,
// magnetic buttons, hero parallax, a ticker band and big step call-outs on the Live stage.
// Everything is skipped when the viewer asks for reduced motion.
import { link } from './device.js';

const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE = () => matchMedia('(pointer: fine)').matches;
let io = null;

/* one-time: cursor ring, scroll progress, magnetic buttons, step call-outs */
export function initMotion() {
  if (RM()) return;
  // scroll progress under the top bar
  const bar = document.createElement('div'); bar.className = 'mx-progress'; document.querySelector('.topbar')?.appendChild(bar);
  const onScroll = () => { const h = document.documentElement; const p = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight); bar.style.transform = `scaleX(${p})`; };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  if (FINE()) {
    // cursor ring that grows over anything clickable
    document.body.classList.add('mx-cur');
    const ring = document.createElement('div'); ring.className = 'mx-cursor'; ring.setAttribute('aria-hidden', 'true'); document.body.appendChild(ring);
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
    addEventListener('pointermove', e => { x = e.clientX; y = e.clientY; ring.classList.add('on'); }, { passive: true });
    document.addEventListener('pointerleave', () => ring.classList.remove('on'));
    document.addEventListener('pointerover', e => ring.classList.toggle('big', !!e.target.closest('a,button,select,input,label,.sx-seat,.seat')));
    document.addEventListener('pointerdown', () => ring.classList.add('press'));
    document.addEventListener('pointerup', () => ring.classList.remove('press'));
    (function tick() { rx += (x - rx) * 0.2; ry += (y - ry) * 0.2; ring.style.transform = `translate(${rx}px,${ry}px)`; requestAnimationFrame(tick); })();

    // magnetic buttons
    document.addEventListener('pointermove', e => {
      const b = e.target.closest?.('.btn'); if (!b) return;
      const r = b.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      b.style.transform = `translate(${dx * 0.18}px,${dy * 0.3}px)`;
      b.onpointerleave = () => { b.style.transform = ''; };
    });
  }

  // big step call-out across the Live stage
  link.addEventListener('step', e => {
    const stage = document.querySelector('#liveStage'); if (!stage || !e.detail?.name) return;
    const el = document.createElement('div'); el.className = 'mx-callout';
    el.innerHTML = `<span>${String(e.detail.n).padStart(2, '0')}</span><b></b>`;
    el.querySelector('b').textContent = e.detail.name;
    stage.appendChild(el); setTimeout(() => el.remove(), 1700);
  });
  link.addEventListener('sample', () => {
    const stage = document.querySelector('#liveStage'); if (!stage) return;
    const el = document.createElement('div'); el.className = 'mx-flash'; stage.appendChild(el); setTimeout(() => el.remove(), 900);
  });
}

/* every route change */
export function pageIn(view, title) {
  // headline letters rise
  if (title) {
    title.innerHTML = [...title.textContent].map((c, i) => `<span class="mx-ch" style="--i:${i}">${c === ' ' ? '&nbsp;' : c.replace(/[<>&]/g, '')}</span>`).join('');
    title.setAttribute('aria-label', title.textContent);
  }
  if (RM()) return;
  // leaf wipe across the work area
  const wipe = document.createElement('div'); wipe.className = 'mx-wipe'; wipe.setAttribute('aria-hidden', 'true');
  document.querySelector('.main')?.appendChild(wipe); setTimeout(() => wipe.remove(), 900);

  // panels draw in as they scroll into view
  io?.disconnect();
  io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('mx-in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  const items = view.querySelectorAll('.card, .ov-fact, .ov-loop, .loop li, tbody tr, .site, .alert, .gauge, .io span, .sp, .member');
  items.forEach((el, i) => { el.classList.add('mx-rv'); el.style.setProperty('--d', `${Math.min(i, 12) * 45}ms`); io.observe(el); });
  // fail-safe: never leave something hidden if the observer is late (slow devices, background tabs)
  const sweep = () => view.querySelectorAll('.mx-rv:not(.mx-in)').forEach(el => { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add('mx-in'); });
  setTimeout(sweep, 700); setTimeout(sweep, 1600);
  const onSweep = () => { if (!document.body.contains(view)) return; sweep(); };
  addEventListener('scroll', onSweep, { passive: true });

  // hero parallax: headline and Pod drift against the pointer
  const hero = view.querySelector('.ov-hero');
  if (hero && FINE()) {
    const h = hero.querySelector('.ov-h'), st = hero.querySelector('.ov-stage');
    hero.addEventListener('pointermove', e => {
      const r = hero.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      if (h) h.style.transform = `translate(${px * -22}px,${py * -12}px)`;
      if (st) st.style.transform = `translate(${px * 18}px,${py * 10}px) scale(1.03)`;
    });
    hero.addEventListener('pointerleave', () => { if (h) h.style.transform = ''; if (st) st.style.transform = ''; });
  }
  // scrolling hero zoom-out like the website
  if (hero) {
    const st = hero.querySelector('.ov-stage');
    const onS = () => { if (!document.body.contains(hero)) return removeEventListener('scroll', onS); const p = Math.min(1, scrollY / hero.offsetHeight); hero.style.setProperty('--sp', p.toFixed(3)); };
    addEventListener('scroll', onS, { passive: true }); onS();
    if (st) st.dataset.zoom = '1';
  }

  // values that change pulse once
  view.querySelectorAll('#sxStep, #hState').forEach(el => {
    new MutationObserver(() => { el.classList.remove('mx-pulse'); void el.offsetWidth; el.classList.add('mx-pulse'); }).observe(el, { childList: true, characterData: true, subtree: true });
  });
}

/* ticker band text for the Overview */
export function tickerHTML(items) {
  const row = items.map(t => `<span>${t}</span><i aria-hidden="true">✳</i>`).join('');
  return `<div class="mx-ticker" aria-hidden="true"><div class="mx-track">${row}${row}${row}</div></div>`;
}
