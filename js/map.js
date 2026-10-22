// Sampling-site map: Leaflet with OpenStreetMap tiles; if tiles can't load (offline
// in the field), sites still show on a coordinate grid.
// Leaflet is loaded on demand: the grid fallback shows at once and is swapped for the
// real map as soon as leaflet.js arrives.
import { esc, loadScript, loadCSS } from './util.js';

export function siteMap(el, sites, opts = {}) {
  if (window.L) return leafletMap(el, sites, opts);
  let cur = fallback(el, sites, opts.onAdd), last = sites, gone = false;
  loadCSS('vendor/leaflet/leaflet.css');
  loadScript('vendor/leaflet/leaflet.js').then(() => {
    if (gone || !el.isConnected || !window.L) return;
    cur.destroy(); el.innerHTML = ''; el.classList.remove('fallback-map');
    cur = leafletMap(el, last, opts);
  }).catch(() => {});
  return { draw: list => { last = list; cur.draw(list); }, destroy: () => { gone = true; cur.destroy(); } };
}

function leafletMap(el, sites, { onAdd, onSelect } = {}) {
  el.style.position = 'relative';
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([25.2, 55.3], 12);
  let tileErrors = 0;
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  const note = document.createElement('div');
  note.className = 'map-note';
  note.textContent = 'Click the map to add a sampling site';
  el.appendChild(note);
  tiles.on('tileerror', () => {
    tileErrors++;
    if (tileErrors === 4) { note.textContent = 'Map tiles offline — sites shown on a grid. Click to add a site.'; el.querySelector('.leaflet-tile-pane').style.display = 'none'; el.classList.add('fallback-map'); }
  });
  const layer = L.layerGroup().addTo(map);
  const line = L.polyline([], { color: '#24704A', weight: 2, dashArray: '6 6', opacity: .8 }).addTo(map);
  function draw(list) {
    layer.clearLayers();
    list.forEach((s, i) => {
      const icon = L.divIcon({ className: '', html: `<div class="site-pin ${s.protected ? 'prot' : ''}"><b>${i + 1}</b></div>`, iconSize: [28, 28], iconAnchor: [14, 28] });
      L.marker([s.lat, s.lon], { icon }).addTo(layer)
        .bindPopup(`<b>${esc(s.name)}</b>${s.code ? ` <span style="font-family:var(--mono);font-size:12px">${esc(s.code)}</span>` : ''}<br><span style="font-family:var(--mono);font-size:12px">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</span>${s.protected ? '<br><span style="color:#B36B12">Protected — written permission needed</span>' : ''}`)
        .on('click', () => onSelect?.(s));
    });
    line.setLatLngs(list.map(s => [s.lat, s.lon]));
    if (list.length) map.fitBounds(L.latLngBounds(list.map(s => [s.lat, s.lon])).pad(0.4), { maxZoom: 15 });
  }
  map.on('click', e => onAdd?.(+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)));
  draw(sites);
  setTimeout(() => map.invalidateSize(), 200);
  return { draw, destroy: () => map.remove() };
}

function fallback(el, sites, onAdd) {
  el.classList.add('fallback-map');
  el.style.position = 'relative';
  function draw(list) {
    el.innerHTML = '<div class="map-note">Map unavailable — sites placed by coordinates</div>';
    if (!list.length) return;
    const lats = list.map(s => s.lat), lons = list.map(s => s.lon);
    const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
    list.forEach((s, i) => {
      const x = 10 + ((s.lon - c) / ((d - c) || 1)) * 80, y = 90 - ((s.lat - a) / ((b - a) || 1)) * 80;
      const p = document.createElement('div');
      p.style.cssText = `position:absolute;left:${x}%;top:${y}%;transform:translate(-50%,-100%)`;
      p.innerHTML = `<div class="site-pin ${s.protected ? 'prot' : ''}"><b>${i + 1}</b></div>`;
      p.title = s.code ? `${s.code} · ${s.name}` : s.name;
      el.appendChild(p);
    });
  }
  draw(sites);
  return { draw, destroy: () => {} };
}
