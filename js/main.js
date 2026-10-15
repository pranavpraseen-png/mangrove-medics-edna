// App shell: router, status bar, ambient background, loader.
import { $, $$, animateIn, spotlight, reducedMotion } from './util.js';
import { VIEWS } from './views.js';
import { link } from './device.js';
import { alerts, onChange } from './store.js';
import './mission.js';

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
  animateIn(view);
  spotlight(view);
  view.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function statusBar() {
  const p = $('#connPill');
  p.dataset.state = link.connected ? (link.busy ? 'busy' : 'on') : 'off';
  p.querySelector('span').textContent = link.connected ? `${link.info?.id || 'Collector'} · ${link.label}` : 'Not connected';
  const mp = $('#missionPill');
  if (link.busy && link.step) {
    mp.hidden = false; mp.dataset.state = 'busy';
    mp.querySelector('span').textContent = `Step ${link.step.n}/8 · ${link.step.name.toLowerCase()}`;
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
onChange(bell);

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
ambient();
statusBar();
bell();
route();
setTimeout(() => $('#loader').classList.add('gone'), reducedMotion() ? 0 : 1300);
