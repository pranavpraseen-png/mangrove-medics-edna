// Public website: scroll story, exploded 3D machine, live simulator, map and species database.
import { collector } from './scene.js';
import { link } from './device.js';
import { state, save, onChange, demoResults, alerts } from './store.js';
import { startMission } from './mission.js';
import { siteMap } from './map.js';
import { missionRing } from './charts.js';
import { esc, toast, tubeId, fmtNum } from './util.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const G = window.gsap, ST = window.ScrollTrigger;
if (G && ST) G.registerPlugin(ST);

/* ── smooth scroll ─────────────────────────────────────────── */
let lenis = null;
if (!RM && window.Lenis && G) {
  lenis = new Lenis({ lerp: 0.09 });
  lenis.on('scroll', () => ST && ST.update());
  G.ticker.add(t => lenis.raf(t * 1000));
  G.ticker.lagSmoothing(0);
}
$$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const t = document.querySelector(a.getAttribute('href'));
  if (!t) return;
  e.preventDefault();
  lenis ? lenis.scrollTo(t, { offset: 0, duration: 1.6 }) : t.scrollIntoView({ behavior: RM ? 'auto' : 'smooth' });
}));

/* ── 3D stage manager: one renderer moves between three stages ─ */
const stages = { hero: $('#heroStage'), explode: $('#explodeStage'), sim: $('#simStage') };
let current = null, webgl = true;
function use(name) {
  if (current === name || !webgl) return;
  current = name;
  if (!collector.attach(stages[name])) {
    webgl = false;
    Object.values(stages).forEach(el => el.insertAdjacentHTML('afterbegin', '<p style="position:absolute;inset:0;display:grid;place-items:center;color:#B9C4B5;padding:20px;text-align:center">3D needs WebGL, which this browser has turned off.</p>'));
    return;
  }
  collector.setFilled(state.samples);
  const cam = collector.camera, ctl = collector.controls;
  if (name !== 'explode' && collector.root) collector.root.rotation.y = 0;
  if (name === 'hero') {
    collector.setClean(true); collector.setInteractive(false); ctl.autoRotate = !RM; ctl.autoRotateSpeed = 0.5;
    cam.position.set(11.5, 6.2, 11.5); ctl.target.set(0, 1.5, 0); collector.setViewShift(innerWidth > 900 ? 0.2 : 0);
    collector.explode(0);
  } else if (name === 'explode') {
    collector.setClean(false); collector.setRain(false); collector.setInteractive(false); ctl.autoRotate = false;
    cam.position.set(12, 7, 12); ctl.target.set(0, 2.2, 0); collector.setViewShift(innerWidth > 900 ? 0.16 : 0);
  } else {
    collector.setClean(true); collector.setRain(false); collector.setInteractive(true); ctl.enableZoom = false; ctl.autoRotate = false;
    const narrow = innerWidth < 900;
    cam.position.set(narrow ? 13.5 : 11, narrow ? 8.4 : 7, narrow ? 13.5 : 11.2); ctl.target.set(0, narrow ? 1.2 : 2.1, 0); collector.setViewShift(0);
    collector.explode(0);
  }
  ctl.update();
}
use('hero');

/* ── preloader + hero intro ───────────────────────────────── */
function intro() {
  const pre = $('#pre'), n = $('#preN');
  if (!G || RM) { pre.remove(); return; }
  const o = { v: 0 };
  G.timeline()
    .to(o, { v: 100, duration: 1.3, ease: 'power2.inOut', onUpdate: () => { n.textContent = String(Math.round(o.v)).padStart(3, '0'); } })
    .to(pre, { yPercent: -100, duration: 1, ease: 'expo.inOut' })
    .from('.hero h1 .ln > span', { yPercent: 110, duration: 1.1, stagger: 0.09, ease: 'expo.out' }, '-=0.45')
    .from('.hero .side > *, .hero .meta', { y: 24, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out' }, '-=0.8')
    .add(() => pre.remove());
}
intro();

if (G && ST && !RM) {
  G.to('#heroStage', { scale: 1.18, yPercent: 8, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  G.to('.hero .copy', { yPercent: -30, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: '80% top', scrub: true } });
}

/* ── facts count-up + headings ────────────────────────────── */
$$('[data-count]').forEach(el => {
  const to = +el.dataset.count;
  if (!G || !ST || RM) { el.textContent = to; return; }
  ST.create({ trigger: el, start: 'top 85%', once: true, onEnter: () => { const o = { v: 0 }; G.to(o, { v: to, duration: 1.6, ease: 'power3.out', onUpdate: () => { el.textContent = Math.round(o.v); } }); } });
});

/* ── follow one drop (pinned, scrubbed) ───────────────────── */
(function dropStory() {
  const steps = $$('.drop .step'), bars = $$('.drop .prog b');
  let shown = -1;
  const show = i => {
    if (i === shown) return; shown = i;
    steps.forEach((s, k) => G ? G.to(s, { opacity: k === i ? 1 : 0, y: k === i ? 0 : (k < i ? -20 : 20), duration: 0.5, ease: 'power3.out', overwrite: true }) : (s.style.opacity = k === i ? 1 : 0));
  };
  if (!G || !ST || RM) { show(4); bars.forEach(b => b.style.transform = 'scaleX(1)'); $('#label').setAttribute('opacity', 1); return; }
  const pipe = $('#pipe'), len = pipe.getTotalLength();
  G.set(pipe, { strokeDasharray: len, strokeDashoffset: len });
  G.set('#fill', { scaleY: 0, transformOrigin: '50% 100%' });
  G.set('#bits circle', { opacity: 0, scale: 0, transformOrigin: '50% 50%' });
  G.set('#species .sp', { opacity: 0, x: 60 });
  const bits = $$('#bits circle');
  const tl = G.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: '#drop', start: 'top top', end: '+=420%', scrub: 1, pin: '.drop-pin',
      onUpdate: s => { const p = s.progress * 5; show(Math.min(4, Math.floor(p))); bars.forEach((b, k) => b.style.transform = `scaleX(${Math.max(0, Math.min(1, p - k))})`); },
    },
  });
  // 1 shed
  tl.from('#leaves path', { y: -260, rotation: -8, transformOrigin: '50% 0%', stagger: 0.08, duration: 0.6, ease: 'power2.out' }, 0)
    .to(bits, { opacity: 1, scale: 1, stagger: 0.06, duration: 0.4, ease: 'back.out(3)' }, 0.4)
  // 2 rain
    .fromTo('#raindrop', { y: -120 }, { y: 160, duration: 0.5, ease: 'power2.in' }, 1)
    .to(bits, { x: (i, el) => 980 - +el.getAttribute('cx') + (i - 3) * 3, y: (i, el) => 205 - +el.getAttribute('cy'), duration: 0.3 }, 1.45)
    .to('#raindrop', { y: 600, duration: 0.45, ease: 'power2.in' }, 1.6)
    .to(bits, { y: (i, el) => 640 - +el.getAttribute('cy'), duration: 0.45, ease: 'power2.in' }, 1.6)
    .to('#raindrop', { opacity: 0, duration: 0.1 }, 2.05)
    .fromTo('#ripple', { attr: { r: 8 }, opacity: 1 }, { attr: { r: 140 }, opacity: 0, duration: 0.5, ease: 'power2.out' }, 2.02)
  // 3 catch
    .to(pipe, { strokeDashoffset: 0, duration: 0.5 }, 2.2)
    .to(bits, { x: (i, el) => 1000 - +el.getAttribute('cx'), y: (i, el) => 690 - +el.getAttribute('cy'), stagger: 0.02, duration: 0.15 }, 2.45)
    .to(bits, { x: (i, el) => 1110 - +el.getAttribute('cx'), y: (i, el) => 470 - +el.getAttribute('cy'), stagger: 0.02, duration: 0.2 }, 2.62)
    .to(bits, { x: (i, el) => 1190 - +el.getAttribute('cx') + (i - 3) * 10, y: (i, el) => 345 - +el.getAttribute('cy') + (i % 3) * 8, stagger: 0.02, duration: 0.2 }, 2.84)
    .to('#filterGlow', { opacity: 0.85, duration: 0.15 }, 3.05)
    .to('#filterGlow', { opacity: 0.35, duration: 0.2 }, 3.2)
  // 4 seal
    .to(bits, { opacity: 0, duration: 0.2 }, 3.3)
    .to('#filter', { x: 1240, y: 270, scale: 0.4, opacity: 0, duration: 0.4, ease: 'power2.in' }, 3.3)
    .to('#fill', { scaleY: 1, duration: 0.5, ease: 'power2.out' }, 3.5)
    .to('#label', { opacity: 1, duration: 0.2 }, 3.85)
  // 5 read
    .to('#species .sp', { opacity: 1, x: 0, stagger: 0.12, duration: 0.3, ease: 'power3.out' }, 4.1)
    .to({}, { duration: 0.4 }, 4.6);
  show(0);
})();

/* ── exploded machine (pinned, scrubbed) ──────────────────── */
(function explodeStory() {
  const tags = $$('.tag3d');
  let t = 0;
  function place() {
    if (current === 'explode') {
      tags.forEach(el => {
        const p = collector.partScreen(el.dataset.part);
        if (!p) return;
        el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
        el.style.opacity = t > 0.35 && p.visible ? Math.min(1, (t - 0.35) * 3) : 0;
      });
    }
    requestAnimationFrame(place);
  }
  place();
  if (!G || !ST || RM) { t = 0.8; ST && ST.create({ trigger: '#explode', start: 'top bottom', onEnter: () => collector.explode(0.8) }); return; }
  ST.create({
    trigger: '#explode', start: 'top top', end: '+=260%', scrub: 1, pin: '.explode-pin',
    onUpdate: s => {
      const p = s.progress;
      t = p < 0.15 ? 0 : p > 0.85 ? 1 : (p - 0.15) / 0.7;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      collector.explode(e);
      if (collector.root) collector.root.rotation.y = -0.5 + p * 1.4;
    },
  });
  G.from('.explode .head > *', { y: 40, opacity: 0, stagger: 0.1, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '#explode', start: 'top 60%' } });
})();

/* ── horizontal mission loop ──────────────────────────────── */
(function loop() {
  const track = $('.loop-track');
  if (!G || !ST || RM) { track.style.overflowX = 'auto'; return; }
  const dist = () => track.scrollWidth - innerWidth + 80;
  G.to(track, { x: () => -dist(), ease: 'none', scrollTrigger: { trigger: '.loop', start: 'top top', end: () => `+=${dist()}`, pin: '.loop-pin', scrub: 1, invalidateOnRefresh: true } });
})();

/* ── live simulator ───────────────────────────────────────── */
(function sim() {
  const ring = $('#simRing'), log = $('#simLog');
  ring.innerHTML = missionRing(0);
  const add = (txt, cls = '') => { const d = document.createElement('div'); d.textContent = txt; if (cls) d.style.color = cls; log.appendChild(d); while (log.childNodes.length > 80) log.firstChild.remove(); log.scrollTop = log.scrollHeight; };
  add('Ready. Press “Start mission” — the Pod’s digital twin will run a blank plus every planned site.', '#B9C4B5');
  link.addEventListener('tele', e => {
    const t = e.detail;
    $('#rPh').textContent = fmtNum(t.ph, 2); $('#rNtu').textContent = fmtNum(t.ntu, 1);
    $('#rMl').textContent = t.target ? `${t.ml}/${t.target}` : t.ml; $('#rBat').textContent = fmtNum(t.bat, 2);
    $('#hudState').textContent = t.paused ? 'PAUSED' : t.state;
    $('#simPause').textContent = t.paused ? 'Resume' : 'Pause';
  });
  link.addEventListener('step', e => { ring.innerHTML = missionRing(e.detail.n); if (e.detail.tube) $('#hudTube').textContent = tubeId(e.detail.tube); add(`Step ${e.detail.n}/8 · ${e.detail.name.toLowerCase()} · ${e.detail.siteName}`); });
  link.addEventListener('log', e => add(e.detail.msg, '#B9C4B5'));
  link.addEventListener('sample', e => add(`Preserved ${tubeId(e.detail.tube)} · seat ${e.detail.seat || '?'} · ${e.detail.name} · ${e.detail.ml} mL${e.detail.blank ? ' · field blank' : ''}`, '#B8E07A'));
  link.addEventListener('err', e => add(`! ${e.detail.msg}`, '#E8A23A'));
  link.addEventListener('done', e => { ring.innerHTML = missionRing(0, 8); add(`Mission complete — ${e.detail.tubes} cartridges. Scroll down to the database.`, '#B8E07A'); });
  link.addEventListener('aborted', e => { ring.innerHTML = missionRing(0); add(`Safe stop. ${e.detail.msg}`, '#E8A23A'); });
  $('#simStart').onclick = async () => {
    state.settings.simSpeed = Math.max(state.settings.simSpeed || 10, 40); save();
    if (await startMission()) add('Mission sent to the Pod.', '#B9C4B5');
  };
  $('#simPause').onclick = () => link.connected && link.send({ cmd: link.tele?.paused ? 'resume' : 'pause' });
  $('#simAbort').onclick = () => link.busy && link.send({ cmd: 'abort' });
})();

/* ── map ──────────────────────────────────────────────────── */
(function mapSec() {
  let map = null;
  const list = () => {
    const bySite = {};
    state.samples.filter(s => !s.blank).forEach(s => { const sp = new Set(state.results.filter(r => r.tube === s.id && r.reads > 0).map(r => r.species)); bySite[s.site] = bySite[s.site] || { tubes: 0, sp: new Set() }; bySite[s.site].tubes++; sp.forEach(x => bySite[s.site].sp.add(x)); });
    $('#siteList').innerHTML = state.sites.map((s, i) => {
      const b = bySite[s.id];
      return `<div class="row"><span class="i">${i + 1}</span><div><b>${esc(s.name)}</b><small>${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}${s.protected ? ' · permission needed' : ''}</small></div><span class="s">${b ? (b.sp.size ? `${b.sp.size} species` : `${b.tubes} tube${b.tubes > 1 ? 's' : ''}`) : 'Planned'}</span></div>`;
    }).join('') + `<div style="padding:22px"><a class="btn dark" href="console.html#/planner">Plan a mission <span class="arr">→</span></a></div>`;
  };
  const init = () => {
    if (map) return;
    map = siteMap($('#siteMap'), state.sites);
    document.querySelectorAll('#siteMap .site-pin').forEach(p => { p.className = 'pin ok'; });
  };
  list();
  if (ST) ST.create({ trigger: '#map', start: 'top 120%', once: true, onEnter: init }); else init();
  onChange(list);
})();

/* ── species database ─────────────────────────────────────── */
(function db() {
  let filter = 'all';
  const table = $('#dbTable');
  function rows() {
    const watch = new Set(state.watchlist.map(w => w.species.toLowerCase()));
    const sp = new Map();
    state.results.forEach(r => {
      const s = state.samples.find(x => x.id === r.tube);
      if (!s || s.blank || r.reads <= 0) return;
      const o = sp.get(r.species) || { species: r.species, common: r.common, reads: 0, tubes: new Set(), sites: new Set(), last: 0, watch: watch.has(r.species.toLowerCase()) };
      o.reads += r.reads; o.tubes.add(r.tube); o.sites.add(s.siteName); o.last = Math.max(o.last, s.ts);
      sp.set(r.species, o);
    });
    return [...sp.values()].sort((a, b) => b.reads - a.reads);
  }
  function render(animate) {
    const q = $('#dbSearch').value.trim().toLowerCase();
    const all = rows();
    const max = Math.max(1, ...all.map(r => r.reads));
    const list = all.filter(r => (filter === 'all' || r.watch) && (!q || `${r.species} ${r.common} ${[...r.tubes].join(' ')} ${[...r.sites].join(' ')}`.toLowerCase().includes(q)));
    table.innerHTML = `<div class="db-row h"><span>Species</span><span class="hide-m">Sites</span><span class="hide-m">Cartridges</span><span>DNA reads</span><span class="hide-m">Signal</span></div>` +
      (list.length ? list.map(r => `<div class="db-row"><span><b>${esc(r.common || r.species)}</b>${r.watch ? '<span class="w">WATCHLIST</span>' : ''}<br><i>${esc(r.species)}</i></span><span class="hide-m">${esc([...r.sites].join(', '))}</span><span class="hide-m mono">${esc([...r.tubes].join(' '))}</span><span class="mono">${r.reads.toLocaleString()}</span><span class="hide-m"><span class="db-bars"><span style="width:${(r.reads / max * 100).toFixed(1)}%"></span></span></span></div>`).join('')
        : `<div class="db-empty">${all.length ? 'No species match.' : state.samples.length ? 'Cartridges are filled — load the lab results to see who was there.' : 'No cartridges yet. Run the simulator above, then load the demo lab results.'}</div>`);
    $('#sTubes').textContent = state.samples.length;
    $('#sSpecies').textContent = all.length;
    $('#sSites').textContent = new Set(state.samples.filter(s => !s.blank).map(s => s.site)).size;
    $('#sAlerts').textContent = alerts().length;
    if (animate && G && !RM && table.querySelector('.db-row:not(.h)')) G.from('#dbTable .db-row:not(.h)', { y: 24, opacity: 0, stagger: 0.04, duration: 0.6, ease: 'power3.out' });
  }
  $('#dbSearch').addEventListener('input', () => render(false));
  $$('.chip').forEach(c => c.onclick = () => { filter = c.dataset.f; $$('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === c))); render(true); });
  $('#dbDemo').onclick = () => {
    if (!state.samples.length) { toast('Run the simulator first', 'warn', 'Demo results are made for the cartridges it fills.'); const t = $('#sim'); lenis ? lenis.scrollTo(t) : t.scrollIntoView(); return; }
    const n = demoResults(); toast(`${n} demo detections loaded`, 'ok', 'Fictional data for training.'); render(true);
  };
  render(false);
  onChange(() => render(false));
  if (ST) ST.create({ trigger: '#db', start: 'top 70%', once: true, onEnter: () => render(true) });
})();

/* ── footer marquee ───────────────────────────────────────── */
(function marquee() {
  const el = $('#footBig'); el.textContent = el.textContent.repeat(4);
  if (G && !RM) G.to(el, { xPercent: -50, duration: 30, ease: 'none', repeat: -1 });
})();

if (G && ST && !RM) {
  $$('.sec-head').forEach(h => G.from(h.children, { y: 50, opacity: 0, duration: 1, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: h, start: 'top 80%' } }));
  G.from('.fact', { y: 60, opacity: 0, duration: 1, stagger: 0.12, ease: 'expo.out', scrollTrigger: { trigger: '.facts', start: 'top 85%' } });
  G.from('.member', { y: 40, opacity: 0, duration: 0.8, stagger: 0.06, ease: 'power3.out', scrollTrigger: { trigger: '.team', start: 'top 85%' } });
  G.from('.seat-c', { y: 30, opacity: 0, duration: 0.7, stagger: 0.05, ease: 'power3.out', scrollTrigger: { trigger: '.seatbar', start: 'top 85%' } });
  G.from('.num-c', { y: 50, opacity: 0, duration: 0.9, stagger: 0.07, ease: 'expo.out', scrollTrigger: { trigger: '.nums', start: 'top 85%' } });
  G.from('.tl li', { y: 40, opacity: 0, duration: 0.8, stagger: 0.07, ease: 'power3.out', scrollTrigger: { trigger: '.tl', start: 'top 85%' } });
  G.from('.sponsor', { y: 40, opacity: 0, duration: 0.8, stagger: 0.1, ease: 'power3.out', scrollTrigger: { trigger: '.sponsors', start: 'top 90%' } });
}
if (ST) {
  ST.create({ trigger: '.hero', start: 'top bottom', end: 'bottom top', onToggle: s => s.isActive && use('hero') });
  ST.create({ trigger: '#explode', start: 'top bottom', end: 'bottom top', onToggle: s => s.isActive && use('explode') });
  ST.create({ trigger: '#sim', start: 'top bottom', end: 'bottom top', onToggle: s => s.isActive && use('sim') });
}
{ const nav = document.querySelector('.nav'); const f = () => nav.classList.toggle('solid', scrollY > innerHeight * 0.6); addEventListener('scroll', f, { passive: true }); f(); }
addEventListener('load', () => ST && ST.refresh());
