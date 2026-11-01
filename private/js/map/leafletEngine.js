// OpenStreetMap through the Leaflet library (kept in /vendor/leaflet). Used when there is no Google
// Maps key or Google is unavailable.
const BASE = '/vendor/leaflet';
const ABUJA = [9.0765, 7.3986];

function loadLeaflet() {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  return new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${BASE}/leaflet.css`;
    document.head.append(css);
    const script = document.createElement('script');
    script.src = `${BASE}/leaflet.js`;
    script.onload = () => resolve(globalThis.L);
    script.onerror = () => reject(new Error('Could not load the map library'));
    document.head.append(script);
  });
}

export async function createLeafletEngine(container) {
  const L = await loadLeaflet();
  const map = L.map(container, { zoomControl: false }).setView(ABUJA, 12);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const wrap = (layer) => ({
    setVisible: (show) => (show ? map.addLayer(layer) : map.removeLayer(layer)),
    remove: () => map.removeLayer(layer),
  });

  return {
    provider: 'osm',

    addMarker({ lat, lng, element, onClick }) {
      const icon = L.divIcon({ html: element, className: 'pin-holder', iconSize: [28, 28], iconAnchor: [14, 14] });
      const marker = L.marker([lat, lng], { icon, keyboard: false });
      if (onClick) marker.on('click', onClick);
      return wrap(marker);
    },

    addLine({ path, color, weight, dashed, opacity }) {
      return wrap(L.polyline(path.map((p) => [p.lat, p.lng]), { color, weight, opacity, dashArray: dashed ? '6 8' : null }));
    },

    addCircle({ lat, lng, radiusM, color }) {
      return wrap(L.circle([lat, lng], { radius: radiusM, color, weight: 1.5, fillOpacity: 0.12, interactive: false }));
    },

    fitBounds(points) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 17, animate: false });
    },
    // No animation: a move that starts while another is still animating is silently dropped by Leaflet.
    panTo: (lat, lng, zoom) => map.setView([lat, lng], zoom ?? map.getZoom(), { animate: false }),
    onMapClick: (fn) => map.on('click', (e) => fn({ lat: e.latlng.lat, lng: e.latlng.lng })),
    setCursor: (cursor) => {
      map.getContainer().style.cursor = cursor ?? '';
    },
  };
}
