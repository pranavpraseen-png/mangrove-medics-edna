// App shell: router, status bar, ambient background, loader.
import { $, $$, reducedMotion } from './util.js';
import { VIEWS } from './views.js';
import { link } from './device.js';
import { alerts, onChange, storageOK } from './store.js';
import { ui, waiting } from './mission.js';
import { initMotion, pageIn } from './motion.js';

ui.confirm = true; // this page asks the operator to scan each label before the Pod samples
const view = $('#view');
let cleanup = null;

function route() {
  const name = (location.hash.replace(/^#\//, '') || 'overview').split('?')[0];
  const v = VIEWS[name] || VIEWS.overview;
  const key = VIEWS[name] ? name : 'overview';
  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.warn(e); } }
  cleanup = null;
  $('#viewTitle').textContent = v.title;
  document.title = `${v.title} · eDNA Collector Console`;
  $$('.sidebar nav a').forEach(a => a.classList.toggle('active', a.dataset.route === key));
  document.body.classList.remove('nav-open');
  $('#menuBtn').setAttribute('aria-expanded', 'false');
  cleanup = v.render(view);
  pageIn(view, $('#viewTitle'));
  view.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function statusBar() {
  const p = $('#connPill');
  p.dataset.state = link.connected ? (link.busy ? 'busy' : 'on') : 'off';
  p.querySelector('span').textContent = link.connected ? `${link.info?.id || 'Collector'} · ${link.label}` : 'Not connected';
  const mp = $('#missionPill');
  if (waiting.kind) {
    mp.hidden = false; mp.dataset.state = 'busy';
    const L = { BLANK_WATER: 'blank bottle + scan', SITE: `new site ${waiting.site || ''}`, EMPTY_BOTTLE: 'empty the bottle', WATER: 'intake in water?', AIR: 'intake out of water', SCAN: `scan ${waiting.entry?.id || 'label'}` };
    mp.querySelector('span').textContent = `Pod waiting · ${L[waiting.kind] || waiting.kind.toLowerCase()}`;
  } else if (link.busy && link.step) {
    mp.hidden = false; mp.dataset.state = 'busy';
    mp.querySelector('span').textContent = `${String(link.step.name || '').toLowerCase().replace('_', ' ')}${link.step.seat ? ` · seat ${link.step.seat}` : ''}`;
  } else mp.hidden = true;
}
function bell() {
  const n = alerts().length, b = $('#bellCount');
  b.hidden = !n; b.textContent = n;
  $('#bell').setAttribute('aria-label', n ? `${n} alerts` : 'No alerts');
}

link.addEventListener('status', statusBar);
link.addEventListener('step', statusBar);
link.addEventListener('done', statusBar);
link.addEventListener('aborted', statusBar);
link.addEventListener('await', statusBar);
onChange(bell);

// Offline: the console keeps working with no internet; everything is saved on this device.
function netPill() {
  const p = $('#netPill'); if (!p) return;
  const off = !navigator.onLine, store = storageOK();
  p.hidden = !off && store;
  p.dataset.state = store ? 'busy' : 'off';
  p.querySelector('span').textContent = !store ? 'Not saving — export a backup' : 'Offline · saved on this device';
}
addEventListener('online', netPill); addEventListener('offline', netPill); onChange(netPill);
// Cache the console for offline use (needs https or localhost; silently skipped elsewhere).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  addEventListener('load', () => { navigator.serviceWorker.register('console-sw.js', { scope: './console' }).catch(() => {}); });
}

$('#menuBtn').onclick = () => {
  const open = document.body.classList.toggle('nav-open');
  $('#menuBtn').setAttribute('aria-expanded', String(open));
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('nav-open'); });

// Ambient bioluminescent drift in the background.
function ambient() {
  const c = $('#bg'), g = c.getContext('2d');
  if (reducedMotion()) return;
  let w, h, dots;
  const size = () => {
    w = c.width = innerWidth * devicePixelRatio; h = c.height = innerHeight * devicePixelRatio;
    const n = Math.round(Math.min(90, innerWidth / 16));
    dots = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.8 + .4) * devicePixelRatio, s: Math.random() * .25 + .05, p: Math.random() * 6.28 }));
  };
  size(); addEventListener('resize', size);
  (function frame(t) {
    g.clearRect(0, 0, w, h);
    const glow = g.createRadialGradient(w * .8, h * .1, 0, w * .8, h * .1, w * .6);
    glow.addColorStop(0, 'rgba(40,80,50,.45)'); glow.addColorStop(1, 'rgba(11,24,32,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    dots.forEach(d => {
      d.y -= d.s * devicePixelRatio; if (d.y < -10) { d.y = h + 10; d.x = Math.random() * w; }
      const a = .25 + Math.sin(t / 900 + d.p) * .2;
      g.beginPath(); g.arc(d.x + Math.sin(t / 2000 + d.p) * 8, d.y, d.r, 0, 6.28);
      g.fillStyle = `rgba(184,224,122,${a})`; g.shadowColor = '#B8E07A'; g.shadowBlur = 8 * devicePixelRatio; g.fill();
    });
    g.shadowBlur = 0;
    requestAnimationFrame(frame);
  })(0);
}

addEventListener('hashchange', route);
addEventListener('DOMContentLoaded', () => {});
statusBar();
bell();
netPill();
initMotion();
route();
setTimeout(() => $('#loader').classList.add('gone'), reducedMotion() ? 0 : 1300);
