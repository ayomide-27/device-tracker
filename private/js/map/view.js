import { splitRoute } from './route.js';
import { deviceMarker, endpointMarker, siteMarker, visitMarker } from './markers.js';

const COLORS = {
  route: '#2563eb',
  gap: '#64748b',
  verified: '#16a34a',
  off_site: '#ea580c',
  unplanned: '#7c3aed',
  not_visited: '#6b7280',
};

// What the dashboard calls. Built on a small "engine" (Google Maps or Leaflet) that only knows how to
// add markers, lines and circles. All the thinking about WHAT to draw lives here, once.
//
// engine: { provider, addMarker({lat,lng,element,onClick}), addLine({path,color,weight,dashed,opacity}),
//           addCircle({lat,lng,radiusM,color}), fitBounds(points), panTo(lat,lng,zoom), onMapClick(fn), setCursor(c) }
// every add* returns a handle: { setVisible(bool), remove() }
export function createMapView(engine) {
  const LAYERS = ['devices', 'route', 'visits', 'planned'];
  const handles = Object.fromEntries(LAYERS.map((name) => [name, []]));
  const visible = Object.fromEntries(LAYERS.map((name) => [name, true]));
  const points = Object.fromEntries(LAYERS.map((name) => [name, []]));
  const listeners = {};
  let pick = null;

  const emit = (event, payload) => (listeners[event] ?? []).forEach((fn) => fn(payload));

  function track(layer, handle) {
    handle.setVisible(visible[layer]);
    handles[layer].push(handle);
  }
  function clear(layer) {
    handles[layer].forEach((h) => h.remove());
    handles[layer] = [];
    points[layer] = [];
  }

  engine.onMapClick((latLng) => {
    if (!pick) return;
    const done = pick;
    pick = null;
    engine.setCursor(null);
    done(latLng);
  });

  return {
    provider: engine.provider,

    on(event, fn) {
      (listeners[event] ??= []).push(fn);
    },

    setDevices(devices, selectedId) {
      clear('devices');
      for (const d of devices) {
        if (d.lat === null || d.lng === null) continue;
        points.devices.push({ lat: d.lat, lng: d.lng });
        track('devices', engine.addMarker({
          lat: d.lat,
          lng: d.lng,
          element: deviceMarker({ label: d.label, online: d.online, selected: d.deviceId === selectedId }),
          onClick: () => emit('deviceClick', d),
        }));
      }
    },

    setRoute(routePoints) {
      clear('route');
      if (routePoints.length === 0) return;
      for (const segment of splitRoute(routePoints)) {
        track('route', engine.addLine({
          path: segment.path,
          color: segment.dashed ? COLORS.gap : COLORS.route,
          weight: segment.dashed ? 2 : 4,
          opacity: segment.dashed ? 0.8 : 0.9,
          dashed: segment.dashed,
        }));
      }
      const first = routePoints[0];
      const last = routePoints.at(-1);
      points.route = routePoints.map(({ lat, lng }) => ({ lat, lng }));
      track('route', engine.addMarker({ lat: first.lat, lng: first.lng, element: endpointMarker('start') }));
      if (routePoints.length > 1) track('route', engine.addMarker({ lat: last.lat, lng: last.lng, element: endpointMarker('end') }));
    },

    // visits: [{id, lat, lng, status, name}]
    setVisits(visits) {
      clear('visits');
      for (const v of visits) {
        points.visits.push({ lat: v.lat, lng: v.lng });
        track('visits', engine.addMarker({
          lat: v.lat,
          lng: v.lng,
          element: visitMarker(v.status, v.name),
          onClick: () => emit('visitClick', v),
        }));
      }
    },

    // sites: [{id, name, lat, lng, radiusM, status}] where status is verified | off_site | not_visited
    setSites(sites) {
      clear('planned');
      for (const s of sites) {
        points.planned.push({ lat: s.lat, lng: s.lng });
        track('planned', engine.addCircle({ lat: s.lat, lng: s.lng, radiusM: s.radiusM, color: COLORS[s.status] ?? COLORS.not_visited }));
        track('planned', engine.addMarker({
          lat: s.lat,
          lng: s.lng,
          element: siteMarker(s.status, s.name),
          onClick: () => emit('siteClick', s),
        }));
      }
    },

    setLayerVisible(layer, isVisible) {
      visible[layer] = isVisible;
      handles[layer].forEach((h) => h.setVisible(isVisible));
    },

    // Zooms to what is on the map in the given layers (default: everything shown).
    fit(layers = LAYERS) {
      const all = layers.filter((l) => visible[l]).flatMap((l) => points[l]);
      if (all.length > 0) engine.fitBounds(all);
    },

    panTo: (lat, lng, zoom) => engine.panTo(lat, lng, zoom),

    // Resolves with the next place the supervisor clicks on the map (or null if cancelled).
    pickPoint() {
      this.cancelPick();
      engine.setCursor('crosshair');
      return new Promise((resolve) => {
        pick = resolve;
      });
    },
    cancelPick() {
      if (!pick) return;
      const done = pick;
      pick = null;
      engine.setCursor(null);
      done(null);
    },
  };
}
