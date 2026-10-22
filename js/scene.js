// Light stand-in for the 3D twin (scene3d.js). Importing this costs nothing:
// three.js is only downloaded when a 3D stage is actually shown.
//  - wide screens: loads when the stage scrolls into view
//  - phones / Save-Data: shows a "Show 3D model" button instead
// Telemetry and filled seats are remembered and handed over once 3D is ready.
let real = null, loading = null, wanted = false;
const tele = {};

export function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}
export function _register(c) { real = c; }
export function load3d() {
  if (!loading) loading = import('./scene3d.js').then(m => m.collector).catch(e => { loading = null; throw e; });
  return loading;
}
const autoLoad = () => wanted || (matchMedia('(min-width: 861px)').matches && !(navigator.connection && navigator.connection.saveData));
const FALLBACK = '<div class="webgl-fallback">3D view needs WebGL, which this browser has turned off.<br>Everything else works normally.</div>';

export const collector = {
  get ready() { return !!(real && real.ready); },
  get camera() { return real && real.camera; },
  get controls() { return real && real.controls; },
  setTelemetry(t) { Object.assign(tele, t); if (real && real.ready) real.setTelemetry(t); },
  fillTube(tube, blank) { if (real) real.fillTube(tube, blank); },
  setFilled(samples) { if (real) real.setFilled(samples); },
  detach() { if (real) real.detach(); },
  // Put the 3D Pod into `el` when it makes sense; onReady(real) runs after attach.
  // Returns a cleanup function for the view.
  mount(el, onReady) {
    let dead = false, io = null, btn = null;
    const fail = msg => { if (dead) return; el.classList.remove('stage-off', 'stage-loading'); el.insertAdjacentHTML('afterbegin', msg || FALLBACK); };
    if (!webglOK()) { fail(); return () => {}; }
    const go = () => {
      wanted = true;
      if (btn) { btn.remove(); btn = null; }
      el.classList.remove('stage-off'); el.classList.add('stage-loading');
      load3d().then(c => {
        el.classList.remove('stage-loading');
        if (dead) return;
        if (!c.attach(el)) return fail();
        c.setTelemetry(tele);
        if (onReady) onReady(c);
      }).catch(() => fail('<div class="webgl-fallback">The 3D model could not load (no connection?).<br>Everything else works normally.</div>'));
    };
    if (autoLoad()) {
      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); io = null; go(); } }, { rootMargin: '200px' });
        io.observe(el);
      } else go();
    } else {
      el.classList.add('stage-off');
      btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn show3d';
      btn.textContent = 'Show 3D model';
      btn.setAttribute('aria-label', 'Show the 3D model of the Pod (downloads about 1 MB)');
      btn.onclick = go;
      el.prepend(btn);
    }
    return () => { dead = true; if (io) io.disconnect(); if (real && real.container === el) real.detach(); };
  },
};
