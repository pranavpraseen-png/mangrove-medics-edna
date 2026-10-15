// Real-time 3D twin of the eDNA Pod (Three.js). One renderer, moved between
// the Overview hero and the Live mission stage. Driven by device telemetry.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const MINT = 0xb8e07a, AMBER = 0xe8a23a, BLUE = 0x5ab8ff, RED = 0xff6b6b;

export function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

class CollectorScene {
  init() {
    if (this.ready) return true;
    if (!webglOK()) return false;
    const mobile = matchMedia('(max-width: 860px)').matches;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.canvas = r.domElement;
    this.canvas.setAttribute('aria-label', '3D model of the eDNA Pod');
    this.canvas.setAttribute('role', 'img');

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f2620);
    scene.fog = new THREE.FogExp2(0x0f2620, 0.03);
    const cam = this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    cam.position.set(8.2, 6.2, 8.6);

    this.controls = new OrbitControls(cam, this.canvas);
    this.controls.target.set(0, 2.5, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 6; this.controls.maxDistance = 20;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.autoRotate = !this.reduced;
    this.controls.autoRotateSpeed = 0.6;

    scene.add(new THREE.HemisphereLight(0xbfe9ff, 0x0b1820, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(6, 10, 4); scene.add(key);
    const rim = new THREE.PointLight(MINT, 30, 18, 1.6); rim.position.set(-4, 3, -4); scene.add(rim);
    const warm = new THREE.PointLight(AMBER, 10, 12, 1.8); warm.position.set(4, 2, -3); scene.add(warm);

    this.build();

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), mobile ? 0.45 : 0.7, 0.55, 0.55);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.clock = new THREE.Clock();
    this.ro = new ResizeObserver(() => this.resize());
    this.tele = { seat: 1, press: 0, pumpS: 0, pumpE: 0, rain: 0, state: 'IDLE' };
    this.ready = true;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    return true;
  }

  mat(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.35, ...opts }); }

  build() {
    const S = this.scene;
    const alu = this.mat(0xb8c7cc, { metalness: 0.85, roughness: 0.3 });
    const dark = this.mat(0x15232a, { metalness: 0.3, roughness: 0.7 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x24432f, emissive: MINT, emissiveIntensity: 0.25, metalness: 0.3, roughness: 0.4 });
    const root = this.root = new THREE.Group(); S.add(root);
    this.groups = {}; this.cur = 'frame';
    this.put = m => { if (!this.groups[this.cur]) { this.groups[this.cur] = new THREE.Group(); root.add(this.groups[this.cur]); } this.groups[this.cur].add(m); return m; };
    const at = (m, x, y, z) => { m.position.set(x, y, z); return this.put(m); };

    // ground: glowing ring + grid + a stream pool
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.9, 4.0, 96), new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; S.add(ring);
    const grid = new THREE.GridHelper(16, 32, 0x1f3d47, 0x13262e); grid.material.transparent = true; grid.material.opacity = 0.55; S.add(grid);
    const water = this.water = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.MeshStandardMaterial({ color: 0x0d4a52, emissive: 0x0b5f5a, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.85 }));
    water.rotation.x = -Math.PI / 2; water.position.set(-3.9, 0.02, 0.4); S.add(water);
    const n = 380, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * 1.5; pos.set([-3.9 + Math.cos(a) * rr, 0.05 + Math.random() * 1.6, 0.4 + Math.sin(a) * rr], i * 3); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ color: MINT, size: 0.05, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    S.add(this.motes);

    // body: clear shell with metal rims (so the carousel shows)
    this.cur = 'frame';
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3, 48, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xcff7ec, transparent: true, opacity: 0.13, roughness: 0.08, metalness: 0, side: THREE.DoubleSide, depthWrite: false }));
    at(shell, 0, 1.8, 0);
    for (const y of [0.3, 3.3]) at(new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 10, 64), alu), 0, y, 0).rotation.x = Math.PI / 2;
    at(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.08, 48), dark), 0, 0.3, 0);
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + 0.4; at(new THREE.Mesh(new THREE.BoxGeometry(0.08, 3, 0.08), alu), Math.cos(a) * 1.47, 1.8, Math.sin(a) * 1.47); }

    // waste tray
    this.cur = 'tray';
    at(new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.12, 40), this.mat(0x1d3a33, { metalness: 0.2, roughness: 0.6 })), 0, 0.5, 0);

    // stepper motor under the carousel
    this.cur = 'stepper';
    at(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), this.mat(0x2a3d45)), 0, 0.85, 0);
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), alu), 0, 1.2, 0);

    // 8-seat carousel
    this.cur = 'carousel';
    this.carousel = new THREE.Group(); this.carousel.position.y = 1.3; this.put(this.carousel);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.1, 64), leaf); this.carousel.add(plate);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: MINT })); rim.rotation.x = Math.PI / 2; this.carousel.add(rim);
    this.seats = [];
    const cupMat = new THREE.MeshPhysicalMaterial({ color: 0xe6fff4, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0, side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
      const a = -i * Math.PI / 4, x = Math.cos(a) * 0.85, z = Math.sin(a) * 0.85;
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.42, 20, 1, true), cupMat); cup.position.set(x, 0.26, z); this.carousel.add(cup);
      const ringT = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 8, 24), alu); ringT.rotation.x = Math.PI / 2; ringT.position.set(x, 0.48, z); this.carousel.add(ringT);
      const filt = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 20), new THREE.MeshStandardMaterial({ color: 0xf3eee2, emissive: 0x000000, roughness: 0.8 }));
      filt.position.set(x, 0.38, z); this.carousel.add(filt);
      this.seats.push({ filt, filled: false });
    }
    this.seatTarget = 0;

    // servo + sealing nozzle (fixed above seat position 1, on +x)
    this.cur = 'nozzle';
    at(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.4), this.mat(0x22343b, { metalness: 0.2, roughness: 0.6 })), 1.2, 2.35, 0);
    at(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.08), alu), 0.98, 2.3, 0);
    this.nozzle = new THREE.Group(); this.nozzle.position.set(0.85, 2.2, 0); this.put(this.nozzle);
    const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 14), alu); nz.position.y = 0; this.nozzle.add(nz);
    this.tip = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.08, 18), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: MINT, emissiveIntensity: 0.4 })); this.tip.position.y = -0.28; this.nozzle.add(this.tip);
    const tipGlow = new THREE.PointLight(MINT, 2.5, 2.2); tipGlow.position.y = -0.35; this.nozzle.add(tipGlow);

    // two peristaltic pumps with spinning rotors
    this.cur = 'pumps';
    this.rotors = [];
    for (const [x, z] of [[-0.45, 0.75], [0.25, 0.85]]) {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.3, 24), dark); body.rotation.x = Math.PI / 2; at(body, x, 2.75, z);
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x334, emissive: MINT, emissiveIntensity: 0 }));
      at(rotor, x, 2.75, z + 0.17); this.rotors.push(rotor);
    }

    // ethanol bottle
    this.cur = 'vessels';
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.75, 24), new THREE.MeshPhysicalMaterial({ color: 0xf2d58a, transparent: true, opacity: 0.55, roughness: 0.1 })), -0.65, 2.15, -0.75);
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 16), dark), -0.65, 2.58, -0.75);

    // electronics box on top + status LED
    this.cur = 'brain';
    at(new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.95, 2.5), this.mat(0x22343b, { metalness: 0.2, roughness: 0.6 })), 0, 3.82, 0);
    this.led = at(new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), new THREE.MeshBasicMaterial({ color: MINT })), 1.26, 4.05, 0.7);
    const oled = at(new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ color: 0x0f3b35 })), 1.26, 3.8, 0); oled.rotation.y = Math.PI / 2;
    for (const z of [-0.6, 0.6]) at(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10), alu), -1.26, 3.7, z).rotation.z = Math.PI / 2;

    // rain funnel + rain sensor on top
    this.cur = 'funnel';
    at(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 0.32, 0.8, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x2b4a3a, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide })), 0, 4.72, 0);
    at(new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.035, 8, 64), alu), 0, 5.12, 0).rotation.x = Math.PI / 2;
    this.rainPad = at(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.3), new THREE.MeshStandardMaterial({ color: 0x1b3a5c, emissive: BLUE, emissiveIntensity: 0.1 })), 1.25, 5.0, 0.9);

    // ground stake
    this.cur = 'stake';
    const stake = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.4, 12), alu); stake.rotation.x = Math.PI; at(stake, 0, -0.42, 0);

    // sensor probes on a cable into the stream
    this.cur = 'sensors';
    const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.26, 3.6, -0.6), new THREE.Vector3(-2.2, 2.6, -0.5), new THREE.Vector3(-3.0, 1.0, -0.2), new THREE.Vector3(-3.3, 0.2, -0.1)]);
    this.put(new THREE.Mesh(new THREE.TubeGeometry(cable, 60, 0.025, 6), dark));
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.35, 12), alu), -3.3, 0.12, -0.1);

    // hose: stream strainer → sample pump → nozzle
    this.cur = 'pipe';
    this.pipePts = [new THREE.Vector3(-3.7, 0.12, 0.6), new THREE.Vector3(-2.9, 1.3, 0.6), new THREE.Vector3(-1.7, 2.6, 0.7), new THREE.Vector3(-0.45, 2.75, 0.75), new THREE.Vector3(0.4, 2.85, 0.35), new THREE.Vector3(0.85, 2.6, 0), new THREE.Vector3(0.85, 2.3, 0)];
    this.curve = new THREE.CatmullRomCurve3(this.pipePts);
    this.put(new THREE.Mesh(new THREE.TubeGeometry(this.curve, 160, 0.045, 10), new THREE.MeshPhysicalMaterial({ color: 0xcff7ec, transparent: true, opacity: 0.35, roughness: 0.1 })));
    at(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: MINT, wireframe: true, transparent: true, opacity: 0.6 })), -3.7, 0.12, 0.6);
    const fn = 70, fpos = new Float32Array(fn * 3);
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    this.flow = new THREE.Points(fg, new THREE.PointsMaterial({ color: MINT, size: 0.09, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flowT = Array.from({ length: fn }, (_, i) => i / fn);
    this.put(this.flow);
  }


  // ── extras used by the public website ─────────────────────────
  explode(t) {
    if (!this.ready) return;
    const off = { funnel: [0, 1.8, 0], brain: [0, 1.0, 0], frame: [0, 0, -3.4], pumps: [-0.4, 1.0, 2.6], vessels: [0.8, 0.8, -2.6], nozzle: [2.2, 0.5, 0], carousel: [0, 0, 0], stepper: [0, -0.8, 0], tray: [0, -1.4, 0], stake: [0, -1.4, 0], pipe: [-0.8, 0, 0.6], sensors: [-0.8, -0.4, -0.4] };
    this.exploded = t;
    for (const k in this.groups) { const o = off[k] || [0, 0, 0]; this.groups[k].position.set(o[0] * t, o[1] * t, o[2] * t); }
  }
  partScreen(name) {
    const g = this.groups?.[name]; if (!g || !this.container) return null;
    const box = new THREE.Box3().setFromObject(g); const c = box.getCenter(new THREE.Vector3());
    c.project(this.camera);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    return { x: (c.x + 1) / 2 * w, y: (1 - c.y) / 2 * h, visible: c.z < 1 };
  }
  setRain(on) {
    if (!this.ready) return;
    if (!this.rain) {
      const n = 1600, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 18, Math.random() * 14, (Math.random() - 0.5) * 18], i * 3);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe9ff, size: 0.045, transparent: true, opacity: 0.55, depthWrite: false }));
      this.scene.add(this.rain);
    }
    this.rain.visible = on;
  }
  setViewShift(f) { this.viewShift = f; this.resize(); }
  setInteractive(on) { if (this.controls) { this.controls.enabled = on; this.controls.enableZoom = on; } }

  attach(container) {
    if (!this.init()) return false;
    container.prepend(this.canvas);
    this.container = container;
    this.ro.disconnect(); this.ro.observe(container);
    this.resize();
    this.controls.autoRotate = !this.reduced && container.dataset.autorotate !== 'off';
    return true;
  }
  detach() { this.container = null; this.ro?.disconnect(); this.canvas?.remove(); }

  resize() {
    if (!this.container) return;
    const w = this.container.clientWidth || 600, h = this.container.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    if (this.viewShift) this.camera.setViewOffset(w, h, -w * this.viewShift, 0, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  setTelemetry(t) { this.tele = { ...this.tele, ...t }; }
  fillTube(tube, blank) {
    if (!this.ready) return;
    const s = this.seats[(tube - 1) % 8];
    if (!s) return;
    s.filled = true;
    s.filt.material.color.set(blank ? BLUE : MINT);
    s.filt.material.emissive.set(blank ? BLUE : MINT);
    s.filt.material.emissiveIntensity = 0.9;
  }
  setFilled(samples) {
    if (!this.ready) return;
    this.seats.forEach(s => { s.filled = false; s.filt.material.color.set(0xf3eee2); s.filt.material.emissive.set(0x000000); });
    if (!samples.length) return;
    const last = Math.max(...samples.map(s => Math.floor((s.tube - 1) / 8)));
    samples.filter(s => Math.floor((s.tube - 1) / 8) === last).forEach(s => this.fillTube(s.tube, s.blank));
  }

  loop() {
    requestAnimationFrame(this.loop);
    if (!this.container || document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime, T = this.tele;
    // carousel: seat N sits under the nozzle (+x) when turned (N-1) x 45 degrees
    const seat = T.seat || 1;
    const target = (seat - 1) * Math.PI / 4;
    this.carousel.rotation.y += (target - this.carousel.rotation.y) * Math.min(1, dt * 3);
    // nozzle presses down onto the cartridge while sealed
    const ny = T.press ? 1.98 : 2.25;
    this.nozzle.position.y += (ny - this.nozzle.position.y) * Math.min(1, dt * 5);
    this.tip.material.emissiveIntensity = T.press ? 1.2 + Math.sin(t * 6) * 0.3 : 0.4;
    // pumps + flow particles along the hose
    const pumping = T.pumpS || T.pumpE;
    this.rotors[0].rotation.z += T.pumpS ? dt * 12 : 0; this.rotors[0].material.emissiveIntensity = T.pumpS ? 1.4 : 0;
    this.rotors[1].rotation.z += T.pumpE ? dt * 12 : 0; this.rotors[1].material.emissiveIntensity = T.pumpE ? 1.4 : 0;
    this.flow.material.opacity += ((T.pumpS ? 0.95 : 0) - this.flow.material.opacity) * dt * 5;
    const fp = this.flow.geometry.attributes.position;
    this.flowT.forEach((u, i) => {
      let v = u + (T.pumpS ? dt * 0.2 : 0); if (v > 1) v -= 1; this.flowT[i] = v;
      const p = this.curve.getPoint(v); fp.setXYZ(i, p.x, p.y, p.z);
    });
    fp.needsUpdate = true;
    // the active cartridge glows while filtering; ethanol tints it amber
    const active = this.seats[(seat - 1) % 8];
    if (active && !active.filled) { active.filt.material.emissive.set(T.pumpE ? AMBER : MINT); active.filt.material.emissiveIntensity = pumping && T.press ? 0.5 + Math.sin(t * 5) * 0.3 : 0; }
    this.seats.forEach((s, i) => { if (s.filled) s.filt.material.emissiveIntensity = 0.7 + Math.sin(t * 2 + i) * 0.25; });
    // rain pad + LED
    this.rainPad.material.emissiveIntensity = T.rain ? 0.9 : 0.1;
    this.led.material.color.set(T.state === 'IDLE' ? MINT : (T.paused ? AMBER : (Math.sin(t * 6) > 0 ? MINT : 0x0b3b30)));
    this.motes.rotation.y += dt * 0.05;
    const mp = this.motes.geometry.attributes.position;
    for (let i = 0; i < mp.count; i++) { let y = mp.getY(i) + dt * 0.08; if (y > 1.7) y = 0.05; mp.setY(i, y); }
    mp.needsUpdate = true;
    this.water.material.emissiveIntensity = 0.5 + Math.sin(t * 1.3) * 0.12;
    if (this.rain?.visible) { const rp = this.rain.geometry.attributes.position; for (let i = 0; i < rp.count; i++) { let y = rp.getY(i) - dt * 9; if (y < 0) y = 14; rp.setY(i, y); } rp.needsUpdate = true; }
    this.controls.update();
    this.composer.render();
  }
}

export const collector = new CollectorScene();
