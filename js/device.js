// Device link: newline-delimited JSON over Bluetooth LE, USB serial, Wi-Fi WebSocket,
// or the built-in simulator. Every transport speaks the same protocol (docs/PROTOCOL.md).
import { SimDevice } from './sim.js';

// Nordic UART Service — the ESP32 firmware exposes this.
export const NUS = {
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // app → device (write)
  tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // device → app (notify)
};

export const support = {
  bluetooth: () => !!navigator.bluetooth,
  serial: () => !!navigator.serial,
  wifi: () => location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname),
};

class LineSplitter {
  constructor(onLine) { this.buf = ''; this.onLine = onLine; }
  push(text) {
    this.buf += text;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (line) this.onLine(line);
    }
  }
}

class SimTransport {
  constructor(onLine, opts) { this.onLine = onLine; this.opts = opts; this.kind = 'sim'; this.label = 'Simulator'; }
  async connect() { this.dev = new SimDevice(line => this.onLine(line), this.opts); this.dev.boot(); }
  async send(text) { this.dev.receive(text); }
  async disconnect() { this.dev?.shutdown(); }
}

class SerialTransport {
  constructor(onLine, _opts, onClose) { this.split = new LineSplitter(onLine); this.onClose = onClose; this.kind = 'serial'; this.label = 'USB cable'; }
  async connect() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200 });
    this.writer = this.port.writable.getWriter();
    this.reading = this.readLoop();
  }
  async readLoop() {
    const dec = new TextDecoder();
    try {
      while (this.port.readable) {
        this.reader = this.port.readable.getReader();
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          this.split.push(dec.decode(value, { stream: true }));
        }
        this.reader.releaseLock();
      }
    } catch (e) { /* port lost */ }
    this.onClose?.();
  }
  async send(text) { await this.writer.write(new TextEncoder().encode(text + '\n')); }
  async disconnect() {
    try { await this.reader?.cancel(); } catch (e) {}
    try { this.writer?.releaseLock(); } catch (e) {}
    try { await this.port?.close(); } catch (e) {}
  }
}

class BleTransport {
  constructor(onLine, _opts, onClose) { this.split = new LineSplitter(onLine); this.onClose = onClose; this.kind = 'ble'; this.label = 'Bluetooth'; }
  async connect() {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'EDNA' }], optionalServices: [NUS.service] });
    this.device.addEventListener('gattserverdisconnected', () => this.onClose?.());
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(NUS.service);
    this.rx = await svc.getCharacteristic(NUS.rx);
    this.tx = await svc.getCharacteristic(NUS.tx);
    const dec = new TextDecoder();
    this.tx.addEventListener('characteristicvaluechanged', e => this.split.push(dec.decode(e.target.value)));
    await this.tx.startNotifications();
  }
  async send(text) {
    const bytes = new TextEncoder().encode(text + '\n');
    for (let i = 0; i < bytes.length; i += 20) {
      const chunk = bytes.slice(i, i + 20);
      if (this.rx.writeValueWithoutResponse) await this.rx.writeValueWithoutResponse(chunk);
      else await this.rx.writeValue(chunk);
    }
  }
  async disconnect() { try { this.device?.gatt?.disconnect(); } catch (e) {} }
}

class WsTransport {
  constructor(onLine, _opts, onClose) { this.onLine = onLine; this.onClose = onClose; this.kind = 'wifi'; this.label = 'Wi-Fi'; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://${location.host}/ws`);
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('Could not reach the collector over Wi-Fi'));
      this.ws.onclose = () => this.onClose?.();
      const split = new LineSplitter(this.onLine);
      this.ws.onmessage = e => split.push(String(e.data) + '\n');
    });
  }
  async send(text) { this.ws.send(text + '\n'); }
  async disconnect() { try { this.ws?.close(); } catch (e) {} }
}

const KINDS = { sim: SimTransport, serial: SerialTransport, ble: BleTransport, wifi: WsTransport };

// Shared device link used by every view.
class DeviceLink extends EventTarget {
  constructor() { super(); this.t = null; this.info = null; this.tele = null; this.step = null; this.busy = false; this.log = []; }
  get connected() { return !!this.t; }
  get kind() { return this.t?.kind; }
  get label() { return this.t?.label; }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  addLog(dir, text) {
    this.log.push({ dir, text, ts: Date.now() });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    this.emit('line', { dir, text });
  }

  async connect(kind, opts = {}) {
    await this.disconnect();
    const T = KINDS[kind];
    const t = new T(line => this.handle(line), opts, () => { if (this.t === t) { this.t = null; this.busy = false; this.emit('status'); this.addLog('sys', 'Link closed'); } });
    await t.connect();
    this.t = t;
    this.addLog('sys', `Connected via ${t.label}`);
    this.emit('status');
    this.send({ cmd: 'hello' });
    this.send({ cmd: 'settime', ts: Date.now() });
  }
  async disconnect() {
    if (!this.t) return;
    const t = this.t; this.t = null; this.busy = false; this.info = null;
    await t.disconnect();
    this.addLog('sys', 'Disconnected');
    this.emit('status');
  }
  send(obj) {
    if (!this.t) return false;
    const text = JSON.stringify(obj);
    this.addLog('in', text);
    this.t.send(text).catch(e => this.addLog('err', `Send failed: ${e.message}`));
    return true;
  }
  handle(line) {
    let m;
    try { m = JSON.parse(line); } catch (e) { this.addLog('raw', line); return; }
    if (m.t !== 'tele') this.addLog('out', line);
    switch (m.t) {
      case 'hello': this.info = m; this.emit('status'); break;
      case 'tele': this.tele = m; this.emit('tele', m); break;
      case 'step': this.step = m; this.busy = true; this.emit('step', m); this.emit('status'); break;
      case 'done': this.busy = false; this.step = null; this.emit('done', m); this.emit('status'); break;
      case 'aborted': this.busy = false; this.step = null; this.emit('aborted', m); this.emit('status'); break;
      default: this.emit(m.t, m);
    }
  }
}

export const link = new DeviceLink();
