// Real-time 3D twin of the eDNA Collector (Three.js). One renderer, moved between
// the Overview hero and the Live mission stage. Driven by device telemetry.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const MINT = 0x3fe0b0, AMBER = 0xf5a524, BLUE = 0x5ab8ff, RED = 0xff6b6b;
const COLS = 10, ROWS = 5, PITCH = 0.22, RACK_X0 = -0.99, RACK_Z0 = -0.2, SHELF_Y = 2.6;

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
    this.canvas.setAttribute('aria-label', '3D model of the eDNA Collector');
    this.canvas.setAttribute('role', 'img');

    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1820, 0.035);
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
    this.tele = { gx: 0, gy: 0, pumpS: 0, pumpR: 0, arm: 0, drive: 0, dist: 180, state: 'IDLE' };
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
    const root = this.root = new THREE.Group(); S.add(root);

    // ground: glowing ring + grid + a pool of water
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.9, 4.0, 96), new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; S.add(ring);
    const grid = new THREE.GridHelper(16, 32, 0x1f3d47, 0x13262e); grid.material.transparent = true; grid.material.opacity = 0.55; S.add(grid);
    const water = this.water = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.MeshStandardMaterial({ color: 0x0d4a52, emissive: 0x0b5f5a, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.85 }));
    water.rotation.x = -Math.PI / 2; water.position.set(-3.9, 0.02, 0.4); S.add(water);

    // eDNA particles hovering over the water
    const n = 380, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * 1.5; pos.set([-3.9 + Math.cos(a) * rr, 0.05 + Math.random() * 1.6, 0.4 + Math.sin(a) * rr], i * 3); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ color: MINT, size: 0.05, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    S.add(this.motes);

    // chassis
    const beam = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), alu); m.position.set(x, y, z); root.add(m); return m; };
    for (const y of [0.8, 5.3]) { beam(3, 0.2, 0.2, 0, y, -1.5); beam(3, 0.2, 0.2, 0, y, 1.5); beam(0.2, 0.2, 3, -1.5, y, 0); beam(0.2, 0.2, 3, 1.5, y, 0); }
    for (const x of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) beam(0.2, 4.5, 0.2, x, 3.05, z);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.06, 3), dark); deck.position.y = 0.92; root.add(deck);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.05, 2.9), new THREE.MeshPhysicalMaterial({ color: 0x9fe8d6, transparent: true, opacity: 0.18, roughness: 0.1, metalness: 0 }));
    shelf.position.y = SHELF_Y; root.add(shelf);

    // solar panel
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d'); g.fillStyle = '#0d2347'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#5a7fb8'; g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * 32); g.lineTo(256, i * 32); g.stroke(); }
    const solar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 3.2), [dark, dark, new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), metalness: 0.5, roughness: 0.25 }), dark, dark, dark]);
    solar.position.y = 5.46; root.add(solar);

    // wheels
    this.wheels = [];
    const tyre = new THREE.CylinderGeometry(0.55, 0.55, 0.36, 28);
    for (const x of [-1.25, 1.25]) for (const z of [-1.78, 1.78]) {
      const w = new THREE.Mesh(tyre, this.mat(0x1a1f22, { metalness: 0.1, roughness: 0.9 }));
      w.rotation.x = Math.PI / 2; w.position.set(x, 0.55, z); root.add(w); this.wheels.push(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.38, 6), alu); hub.rotation.x = Math.PI / 2; hub.position.copy(w.position); root.add(hub); this.wheels.push(hub);
    }

    // tube rack: 10 × 5 tubes
    this.tubes = [];
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xd8fff4, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0, side: THREE.DoubleSide });
    const tubeG = new THREE.CylinderGeometry(0.075, 0.06, 0.5, 14, 1, true);
    const liqG = new THREE.CylinderGeometry(0.06, 0.05, 0.36, 12);
    const rack = new THREE.Mesh(new THREE.BoxGeometry(COLS * PITCH + 0.12, 0.08, ROWS * PITCH + 0.12), dark);
    rack.position.set(RACK_X0 + (COLS - 1) * PITCH / 2, SHELF_Y + 0.25, RACK_Z0 + (ROWS - 1) * PITCH / 2); root.add(rack);
    for (let s = 0; s < COLS * ROWS; s++) {
      const x = RACK_X0 + (s % COLS) * PITCH, z = RACK_Z0 + Math.floor(s / COLS) * PITCH;
      const t = new THREE.Mesh(tubeG, glass); t.position.set(x, SHELF_Y + 0.27, z); root.add(t);
      const liq = new THREE.Mesh(liqG, new THREE.MeshStandardMaterial({ color: 0xf5e7b8, emissive: 0x000000, transparent: true, opacity: 0.55 }));
      liq.position.set(x, SHELF_Y + 0.21, z); liq.scale.y = 0.55; root.add(liq);
      this.tubes.push({ t, liq, filled: false });
    }

    // vessels: ethanol + clean water
    const vessel = (x, z, color, h) => {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, h, 24), new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.5, roughness: 0.1 }));
      v.position.set(x, 0.95 + h / 2, z); root.add(v);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 16), dark); cap.position.set(x, 0.95 + h + 0.06, z); root.add(cap);
    };
    vessel(0.6, -0.9, 0xf2d58a, 1.1); vessel(1.1, -0.5, 0x7fc7ff, 1.1);

    // pumps with spinning rotors
    this.rotors = [];
    for (const [x, z] of [[-0.6, 0.9], [0.1, 0.9]]) {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.32, 24), dark); body.rotation.x = Math.PI / 2; body.position.set(x, 1.25, z); root.add(body);
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x334, emissive: MINT, emissiveIntensity: 0 }));
      rotor.position.set(x, 1.25, z + 0.18); root.add(rotor); this.rotors.push(rotor);
    }

    // electronics box + status LED
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.35), this.mat(0x22343b, { metalness: 0.2, roughness: 0.6 })); box.position.set(1.62, 3.4, 0.6); root.add(box);
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), new THREE.MeshBasicMaterial({ color: MINT })); this.led.position.set(1.98, 3.65, 0.6); root.add(this.led);
    const oled = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.22), new THREE.MeshBasicMaterial({ color: 0x0f3b35 })); oled.rotation.y = Math.PI / 2; oled.position.set(1.98, 3.35, 0.6); root.add(oled);

    // ultrasonic sensors
    this.sonar = [];
    for (const z of [-0.5, 0.5]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 16), alu); s.rotation.z = Math.PI / 2; s.position.set(1.62, 1.0, z); root.add(s);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 24, 1, true), new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
      cone.rotation.z = Math.PI / 2; cone.position.set(2.45, 1.0, z); root.add(cone); this.sonar.push(cone);
    }

    // X-Y gantry over the rack
    const GY = 4.4;
    for (const z of [-0.6, 1.2]) { const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.9, 12), alu); rail.rotation.z = Math.PI / 2; rail.position.set(0, GY, z); root.add(rail); }
    this.bridge = new THREE.Group(); root.add(this.bridge);
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 2.0), alu); br.position.set(0, GY, 0.3); this.bridge.add(br);
    this.head = new THREE.Group(); this.bridge.add(this.head);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), this.mat(0x2a3d45)); hb.position.y = GY - 0.18; this.head.add(hb);
    this.drop = new THREE.Group(); this.drop.position.y = GY - 0.32; this.head.add(this.drop);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), alu); shaft.position.y = -0.45; this.drop.add(shaft);
    this.fingers = [];
    for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.08), alu); f.position.set(s * 0.07, -0.95, 0); this.drop.add(f); this.fingers.push(f); }
    this.cart = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: MINT, emissiveIntensity: 0.6 })); this.cart.position.y = -1.02; this.drop.add(this.cart);
    const headGlow = new THREE.PointLight(MINT, 3, 2.5); headGlow.position.y = -1; this.drop.add(headGlow);

    // sampling arm (outside, left)
    this.arm = new THREE.Group(); this.arm.position.set(-1.6, 1.3, 0.4); root.add(this.arm);
    const a1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.14), alu); a1.position.x = -0.75; this.arm.add(a1);
    this.elbow = new THREE.Group(); this.elbow.position.x = -1.5; this.arm.add(this.elbow);
    const j = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), this.mat(0x2a3d45)); this.elbow.add(j);
    const a2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), alu); a2.position.y = -0.65; this.elbow.add(a2);
    this.nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: MINT, emissiveIntensity: 0.4 }));
    this.nozzle.position.y = -1.36; this.elbow.add(this.nozzle);

    // pipe: intake → pump → filter cartridge station → waste
    this.pipePts = [new THREE.Vector3(-3.25, 0.25, 0.4), new THREE.Vector3(-2.6, 1.3, 0.6), new THREE.Vector3(-1.4, 1.35, 0.9), new THREE.Vector3(-0.6, 1.25, 0.9), new THREE.Vector3(-0.9, 2.0, 1.25), new THREE.Vector3(-1.2, 2.9, 1.25), new THREE.Vector3(-0.2, 3.2, 1.35), new THREE.Vector3(1.0, 2.4, 1.4), new THREE.Vector3(1.4, 1.0, 1.35)];
    this.curve = new THREE.CatmullRomCurve3(this.pipePts);
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(this.curve, 160, 0.04, 10), new THREE.MeshPhysicalMaterial({ color: 0xcff7ec, transparent: true, opacity: 0.32, roughness: 0.1 }));
    root.add(pipe);
    const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 18), new THREE.MeshStandardMaterial({ color: 0x24434b, emissive: MINT, emissiveIntensity: 0.15 }));
    holder.position.copy(this.curve.getPoint(0.66)); root.add(holder); this.holder = holder;
    const fn = 70, fpos = new Float32Array(fn * 3);
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    this.flow = new THREE.Points(fg, new THREE.PointsMaterial({ color: MINT, size: 0.09, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flowT = Array.from({ length: fn }, (_, i) => i / fn);
    root.add(this.flow);
  }

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
    this.camera.updateProjectionMatrix();
  }

  slotPos(slot) { return { x: RACK_X0 + (slot % COLS) * PITCH, z: RACK_Z0 + Math.floor(slot / COLS) * PITCH }; }

  setTelemetry(t, gantryCfg) { this.tele = { ...this.tele, ...t }; this.g = gantryCfg || this.g; }
  fillTube(tube, blank) {
    if (!this.ready) return;
    const s = this.tubes[(tube - 1) % this.tubes.length];
    if (!s) return;
    s.filled = true;
    s.liq.material.color.set(blank ? BLUE : MINT);
    s.liq.material.emissive.set(blank ? BLUE : MINT);
    s.liq.material.emissiveIntensity = 0.9;
    s.liq.material.opacity = 0.9;
  }
  setFilled(samples) {
    if (!this.ready) return;
    this.tubes.forEach(s => { s.filled = false; s.liq.material.color.set(0xf5e7b8); s.liq.material.emissive.set(0x000000); s.liq.material.opacity = 0.55; });
    samples.forEach(s => this.fillTube(s.tube, s.blank));
  }

  loop() {
    requestAnimationFrame(this.loop);
    if (!this.container || document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime, T = this.tele;
    // gantry: telemetry mm → scene units
    const g = this.g || { x0: 20, y0: 20, dx: 18, dy: 18 };
    const col = (T.gx - g.x0) / g.dx, row = (T.gy - g.y0) / g.dy;
    const tx = RACK_X0 + col * PITCH, tz = RACK_Z0 + row * PITCH;
    this.bridge.position.x += (Math.max(-1.35, Math.min(1.35, tx)) - this.bridge.position.x) * Math.min(1, dt * 8);
    this.head.position.z += (Math.max(-0.6, Math.min(1.1, tz)) - this.head.position.z) * Math.min(1, dt * 8);
    const sealing = T.state === 'SEAL';
    const dropTarget = sealing ? -0.22 : 0;
    this.drop.position.y += ((4.08 + dropTarget) - this.drop.position.y) * Math.min(1, dt * 4);
    this.fingers.forEach((f, i) => { f.position.x += ((i ? 1 : -1) * (sealing ? 0.05 : 0.08) - f.position.x) * dt * 6; });
    this.cart.visible = T.state === 'SAMPLE' || T.state === 'PRIME' || sealing;
    // arm dip
    const armT = T.arm ? 1 : 0;
    this.arm.rotation.z += ((armT ? -0.45 : 0.15) - this.arm.rotation.z) * Math.min(1, dt * 3);
    this.elbow.rotation.z += ((armT ? 0.45 : -0.2) - this.elbow.rotation.z) * Math.min(1, dt * 3);
    // pumps + flow particles
    const pumping = T.pumpS || T.pumpR;
    this.rotors[0].rotation.z += T.pumpS ? dt * 12 : 0; this.rotors[0].material.emissiveIntensity = T.pumpS ? 1.4 : 0;
    this.rotors[1].rotation.z += T.pumpR ? dt * 12 : 0; this.rotors[1].material.emissiveIntensity = T.pumpR ? 1.4 : 0;
    this.flow.material.opacity += ((pumping ? 0.95 : 0) - this.flow.material.opacity) * dt * 5;
    this.flow.material.color.set(T.pumpR && !T.pumpS ? BLUE : MINT);
    const fp = this.flow.geometry.attributes.position;
    const end = T.vF ? 0.66 : 1;
    this.flowT.forEach((u, i) => {
      let v = u + (pumping ? dt * 0.18 : 0); if (v > end) v -= end; this.flowT[i] = v;
      const p = this.curve.getPoint(Math.min(v, 1)); fp.setXYZ(i, p.x, p.y, p.z);
    });
    fp.needsUpdate = true;
    this.holder.material.emissiveIntensity = T.vF ? 0.9 + Math.sin(t * 6) * 0.3 : 0.15;
    // wheels + sonar
    if (T.drive) this.wheels.forEach(w => { w.rotation.y += dt * 4; });
    this.root.position.x = T.drive ? Math.sin(t * 1.4) * 0.12 : this.root.position.x * 0.95;
    const near = T.dist < 40;
    this.sonar.forEach(c => { c.material.color.set(near ? RED : MINT); c.material.opacity = T.drive ? 0.12 + Math.sin(t * 8) * 0.05 : 0.04; });
    // LED + motes + filled tubes pulse
    this.led.material.color.set(T.state === 'IDLE' ? MINT : (T.paused ? AMBER : (Math.sin(t * 6) > 0 ? MINT : 0x0b3b30)));
    this.motes.rotation.y += dt * 0.05;
    const mp = this.motes.geometry.attributes.position;
    for (let i = 0; i < mp.count; i++) { let y = mp.getY(i) + dt * 0.08; if (y > 1.7) y = 0.05; mp.setY(i, y); }
    mp.needsUpdate = true;
    this.tubes.forEach((s, i) => { if (s.filled) s.liq.material.emissiveIntensity = 0.7 + Math.sin(t * 2 + i) * 0.25; });
    this.water.material.emissiveIntensity = 0.5 + Math.sin(t * 1.3) * 0.12;
    this.controls.update();
    this.composer.render();
  }
}

export const collector = new CollectorScene();
